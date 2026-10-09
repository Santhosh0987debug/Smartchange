"""RAG-lite assistant: keyword retrieval over approved docs, with citations + abstention.
Core workflow never depends on this module."""
import re
from typing import List, Dict, Any

STOPWORDS = set("the a an and or of to in on for with is are was were be by as at from what why how when which who whose whos do does did can should must explain describe tell give me my i we you it this that these those".split())


def is_approved(status: str) -> bool:
    return (status or "").strip().lower() == "approved"


def tokens(text: str) -> set:
    words = re.findall(r"[a-z0-9]+", (text or "").lower())
    return {w for w in words if w not in STOPWORDS and len(w) > 2}


def retrieve(question: str, docs: List[Any], top_k: int = 3) -> List[Dict[str, Any]]:
    scored = []
    qtok = tokens(question)
    for d in docs:
        content = d.content if hasattr(d, "content") else d.get("content", "")
        dtok = tokens(content + " " + (d.title if hasattr(d, "title") else d.get("title", "")))
        overlap = len(qtok & dtok)
        # small boost for exact parameter/component mentions
        content_l = content.lower()
        for t in qtok:
            if t in ("nozzle", "pressure", "temperature", "speed", "fixture", "loto", "torque", "verification"):
                if t in content_l:
                    overlap += 1
        if overlap > 0:
            scored.append((overlap, d))
    scored.sort(key=lambda x: -x[0])
    out = []
    for score, d in scored[:top_k]:
        title = d.title if hasattr(d, "title") else d["title"]
        rev = d.revision if hasattr(d, "revision") else d.get("revision", "")
        status = d.approval_status if hasattr(d, "approval_status") else d.get("approval_status", "")
        content = d.content if hasattr(d, "content") else d.get("content", "")
        # extract best sentence
        sentences = re.split(r"(?<=[.!?])\s+", content)
        qwords = tokens(question)
        best = max(sentences, key=lambda s: len(tokens(s) & qwords), default=content[:300])
        out.append({"title": title, "revision": rev, "approval_status": status,
                    "score": score, "passage": best.strip()})
    return out


def answer(question: str, docs: List[Any], top_k: int = 3) -> Dict[str, Any]:
    passages = retrieve(question, docs, top_k)
    if not passages:
        return {"answer": ("I don't have approved documentation covering that question. "
                           "Please consult your supervisor or process engineer before proceeding."),
                "sources": [], "grounded": False}
    approved = [p for p in passages if is_approved(p["approval_status"])]
    if not approved:
        return {"answer": ("Retrieved documents are not in APPROVED status; I cannot provide "
                           "procedural guidance. Please request supervisor review."),
                "sources": passages, "grounded": False}
    bullets = "\n".join(f"- {p['passage']} [{p['title']} {p['revision']}]" for p in approved)
    return {"answer": (f"Based on approved documents:\n{bullets}\n\n"
                       "If this conflicts with posted work instructions, follow the posted instruction "
                       "and escalate to your supervisor — I cannot resolve conflicting safety guidance."),
            "sources": approved, "grounded": True}
