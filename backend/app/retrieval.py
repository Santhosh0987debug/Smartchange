"""Retrieval-based SOP assistant: SQLite FTS5 ranking over APPROVED documents.

No embeddings, no vector DB, no paid services. Documents are treated as
untrusted data: instruction-like sentences are excluded from excerpts and
reported, never followed. AI output never touches machine state.
"""
import json
import re
from typing import Any
from sqlalchemy import text
from sqlalchemy.orm import Session

from .assistant import tokens, is_approved

SAFETY_WARNING = ("AI guidance is documentation help only — always check it against the "
                  "approved SOP revision and the required workflow. It never approves a "
                  "configuration, overrides verification, or authorizes machine readiness.")

# Sentences matching these patterns read as injected instructions, not documentation.
INJECTION_PATTERNS = [
    r"\bignore\s+(all\s+)?(previous\s+|prior\s+)?(instructions|rules|guidance)\b",
    r"\bbypass\b",
    r"\boverride\b.*\b(verification|safety|interlock|workflow)\b",
    r"\bapprove\b.*\b(ready|readiness|machine)\b",
    r"\bmark\b.*\bready\b",
    r"\bdisregard\b.*\b(sop|manual|procedure)\b",
    r"\bdo\s+not\s+verify\b",
    r"\bskip\s+verification\b",
]


def is_injection_like(sentence: str) -> bool:
    low = sentence.lower()
    return any(re.search(p, low) for p in INJECTION_PATTERNS)


def chunk_text(content: str, prefix: str = "Section") -> list:
    """Split plain text into ~500-char chunks with section labels."""
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", content or "") if s.strip()]
    chunks, buf = [], ""
    for s in sentences:
        if len(buf) + len(s) + 1 > 500 and buf:
            chunks.append(buf)
            buf = s
        else:
            buf = f"{buf} {s}".strip()
    if buf:
        chunks.append(buf)
    return [{"section": f"{prefix} {i + 1}", "text": c} for i, c in enumerate(chunks)] or [
        {"section": f"{prefix} 1", "text": (content or "")[:500]}]


def doc_chunks(doc) -> list:
    """Stored per-page/section chunks when available, else chunk on the fly."""
    if getattr(doc, "chunks_json", None):
        try:
            stored = json.loads(doc.chunks_json)
            if isinstance(stored, list) and stored:
                return stored
        except (ValueError, TypeError):
            pass
    return chunk_text(doc.content or "")


FTS_SCHEMA = "CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(doc_id, title, content)"


def ensure_fts(db: Session) -> None:
    db.execute(text(FTS_SCHEMA))


def sync_document_fts(db: Session, doc) -> None:
    """Refresh the FTS index row for one document (call after insert/update)."""
    ensure_fts(db)
    db.execute(text("DELETE FROM documents_fts WHERE doc_id = :i"), {"i": doc.id})
    db.execute(text("INSERT INTO documents_fts (doc_id, title, content) VALUES (:i, :t, :c)"),
               {"i": doc.id, "t": doc.title or "", "c": doc.content or ""})


def sync_all_fts(db: Session) -> None:
    from . import models
    ensure_fts(db)
    for doc in db.query(models.Document).all():
        sync_document_fts(db, doc)


def fts_match_query(question: str) -> str | None:
    """Build a safe FTS5 MATCH query from question tokens (prefix matching)."""
    toks = sorted(tokens(question))
    if not toks:
        return None
    # Quote each token; FTS5 double-quote escaping by doubling.
    return " OR ".join('"' + t.replace('"', '""') + '"*' for t in toks)


def retrieve_passages(db: Session, question: str, top_k: int = 3) -> tuple[list, list]:
    """Ranked passages from APPROVED documents only.

    Returns (passages, limitations). Each passage: {doc_id, title, revision,
    section, text, score}. Archived/Draft docs are never authoritative.
    """
    from . import models
    limitations: list[str] = []
    ensure_fts(db)
    match = fts_match_query(question)
    docs: list = []
    if match:
        try:
            rows = db.execute(
                text("""SELECT d.id FROM documents_fts f
                        JOIN documents d ON d.id = f.doc_id
                        WHERE documents_fts MATCH :q
                        ORDER BY rank LIMIT 20"""), {"q": match}).fetchall()
            ids = [r[0] for r in rows]
            if ids:
                docs = db.query(models.Document).filter(models.Document.id.in_(ids)).all()
        except Exception:
            docs = []
    if not docs:
        # FTS found nothing: fall back to token-overlap scan of approved docs.
        docs = db.query(models.Document).all()
    approved = [d for d in docs if is_approved(d.approval_status)]
    if not approved:
        return [], limitations
    qtok = tokens(question)
    scored: list[tuple[float, Any, dict]] = []
    for d in approved:
        for ch in doc_chunks(d):
            overlap = len(qtok & tokens(ch["text"]))
            if overlap > 0:
                scored.append((overlap + (0.5 if qtok & tokens(d.title or "") else 0), d, ch))
    scored.sort(key=lambda x: -x[0])
    passages, excluded = [], 0
    for score, d, ch in scored:
        if len(passages) >= top_k * 2:  # gather spares; sanitize below
            break
        passages.append({"doc_id": d.id, "title": d.title, "revision": d.revision,
                         "approval_status": d.approval_status, "section": ch.get("section", "?"),
                         "text": ch.get("text", ""), "score": score})
    # Sanitize: drop injection-like sentences, splitting chunks when needed.
    clean: list = []
    dropped = 0
    for p in passages:
        sentences = [s for s in re.split(r"(?<=[.!?])\s+", p["text"]) if s.strip()]
        kept = [s for s in sentences if not is_injection_like(s)]
        dropped += len(sentences) - len(kept)
        if not kept:
            excluded += 1
            continue
        p = dict(p, text=" ".join(kept).strip())
        clean.append(p)
        if len(clean) >= top_k:
            break
    if excluded or dropped:
        limitations.append(f"{excluded + dropped} retrieved passage(s)/sentence(s) contained "
                           "instruction-like text and were excluded as untrusted input.")
    if len({p["doc_id"] for p in clean}) > 1:
        limitations.append("Answer draws from multiple documents — check each cited revision; "
                           "if they conflict, stop and request human review.")
    return clean, limitations


def build_live_data(db: Session, machine_id=None, target_product_id=None, changeover_id=None) -> dict | None:
    """Real backend data for context questions. Always labeled live data —
    the assistant must never fabricate machine state."""
    from . import models
    live: dict = {}
    if machine_id:
        m = db.query(models.Machine).filter_by(id=machine_id).first()
        if m:
            st = (db.query(models.MachineState)
                  .filter_by(machine_id=machine_id, verification_status="VERIFIED")
                  .order_by(models.MachineState.id.desc()).first())
            live["machine"] = {"id": m.id, "name": m.name, "status": m.status,
                               "current_product_id": m.current_product_id,
                               "state": ({"product_id": st.product_id,
                                          "components": json.loads(st.component_state_json),
                                          "parameters": json.loads(st.parameter_state_json)}
                                         if st else None)}
    if target_product_id:
        p = db.query(models.Product).filter_by(id=target_product_id).first()
        if p:
            live["target_product"] = {"id": p.id, "name": p.name, "revision": p.revision,
                                      "configuration": json.loads(p.configuration_json)}
    if changeover_id:
        co = db.query(models.Changeover).filter_by(id=changeover_id).first()
        if co:
            n = db.query(models.ChangeoverTask).filter_by(changeover_id=co.id).count()
            done = db.query(models.ChangeoverTask).filter_by(changeover_id=co.id, status="COMPLETED").count()
            live["changeover"] = {"id": co.id, "status": co.status,
                                  "route": f"{co.source_product_id}->{co.target_product_id}",
                                  "tasks_completed": done, "tasks_total": n}
    return live or None
