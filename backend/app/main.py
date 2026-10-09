"""SmartChange FastAPI backend — all state changes validated server-side."""
import io
import json
import os
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func
from sqlalchemy.orm import Session

from .database import Base, engine, get_db, SessionLocal
from . import models, schemas, seed, config
from .config import APP_NAME, APP_VERSION, FRONTEND_ORIGINS
from .engine import (compare_states, compare_full, check_eligibility, generate_plan,
                       validate_parameters, verify_state)
from .validation import validate_product_configuration
from .retrieval import (sync_document_fts, sync_all_fts, retrieve_passages, build_live_data,
                        SAFETY_WARNING)
from .providers import provider_status, generate, ProviderError
from .assistant import answer as assistant_answer

app = FastAPI(title=APP_NAME, version=APP_VERSION)
app.add_middleware(CORSMiddleware, allow_origins=FRONTEND_ORIGINS, allow_methods=["*"], allow_headers=["*"])


# ---------- helpers ----------
def to_product_out(p: models.Product) -> schemas.ProductOut:
    return schemas.ProductOut(id=p.id, product_code=p.product_code, name=p.name,
                              description=p.description,
                              configuration=json.loads(p.configuration_json),
                              revision=p.revision, active=p.active,
                              created_at=str(p.created_at) if p.created_at else None,
                              updated_at=str(p.updated_at) if p.updated_at else None)


def to_machine_out(m: models.Machine) -> schemas.MachineOut:
    return schemas.MachineOut(id=m.id, name=m.name, machine_type=m.machine_type,
                              line=m.line, location=m.location, status=m.status,
                              current_product_id=m.current_product_id,
                              configuration_version=m.configuration_version,
                              created_at=str(m.created_at) if m.created_at else None,
                              updated_at=str(m.updated_at) if m.updated_at else None)


def latest_state(db: Session, machine_id: str):
    return (db.query(models.MachineState)
            .filter(models.MachineState.machine_id == machine_id)
            .order_by(models.MachineState.id.desc()).first())


def official_state(db: Session, machine_id: str):
    """Latest VERIFIED state — the official machine configuration.

    Simulated (PENDING) rows are never official and must not leak into
    previews, the machine overview, or finalization sources.
    """
    return (db.query(models.MachineState)
            .filter(models.MachineState.machine_id == machine_id,
                    models.MachineState.verification_status == "VERIFIED")
            .order_by(models.MachineState.id.desc()).first())


def current_full_config(db: Session, machine_id: str) -> dict:
    st = official_state(db, machine_id)
    if not st:
        raise HTTPException(404, "No verified machine state — cannot compare configurations")
    return {"components": json.loads(st.component_state_json),
            "parameters": json.loads(st.parameter_state_json)}


def audit(db: Session, actor: str, entity_type: str, entity_id: str, action: str, details: dict):
    db.add(models.AuditEvent(actor_id=actor, entity_type=entity_type, entity_id=str(entity_id),
                             action=action, details_json=json.dumps(details)))


def task_to_out(t: models.ChangeoverTask) -> schemas.TaskOut:
    return schemas.TaskOut(id=t.id, step_id=t.step_id, sequence_number=t.sequence_number,
                           task_type=t.task_type, category=t.category,
                           description=t.description, instructions=t.instructions,
                           component=t.component, parameter=t.parameter,
                           current_value=t.current_value, target_value=t.target_value,
                           prerequisites=json.loads(t.prerequisites or "[]"),
                           safety_notes=t.safety_notes or "",
                           verification_criteria=t.verification_criteria or "",
                           requires_confirmation=bool(t.requires_confirmation),
                           expected_duration_seconds=t.expected_duration_seconds, status=t.status)


def get_changeover(db: Session, cid: int) -> models.Changeover:
    co = db.query(models.Changeover).filter(models.Changeover.id == cid).first()
    if not co:
        raise HTTPException(404, "Changeover not found")
    return co


# ---------- step transition service ----------
# Allowed transitions. COMPLETED is terminal; FAILED steps retry via IN_PROGRESS.
STEP_TRANSITIONS = {
    "PENDING": ("IN_PROGRESS", "FAILED"),
    "IN_PROGRESS": ("COMPLETED", "FAILED"),
    "FAILED": ("IN_PROGRESS",),
    "COMPLETED": (),
}


def resolve_step(db: Session, cid: int, ref: str) -> models.ChangeoverTask:
    """Find a step by database id or by plan step_id (e.g. 'S02')."""
    t = None
    if ref.isdigit():
        t = db.query(models.ChangeoverTask).filter_by(id=int(ref), changeover_id=cid).first()
    if t is None:
        t = db.query(models.ChangeoverTask).filter_by(step_id=ref, changeover_id=cid).first()
    if t is None:
        raise HTTPException(404, f"Step '{ref}' not found in changeover {cid}")
    return t


def open_critical_issues(db: Session, cid: int) -> int:
    return (db.query(models.Issue)
            .filter_by(changeover_id=cid, resolution_status="OPEN", severity="critical").count())


def check_prerequisites(db: Session, cid: int, t: models.ChangeoverTask):
    prereqs = json.loads(t.prerequisites or "[]")
    if not prereqs:
        return
    sibs = {x.sequence_number: x for x in db.query(models.ChangeoverTask).filter_by(changeover_id=cid).all()}
    for p in prereqs:
        s = sibs.get(p)
        if not s or s.status != "COMPLETED":
            raise HTTPException(409, f"Prerequisite step {p} is not completed")


def transition_step(db: Session, co: models.Changeover, t: models.ChangeoverTask,
                    to: str, operator: str, reason: str | None = None) -> models.ChangeoverTask:
    """Single authority for operator-driven step transitions. Raises HTTPException
    on invalid/duplicate transitions, unmet prerequisites, or critical blocks."""
    if co.status in ("COMPLETED", "ABANDONED"):
        raise HTTPException(400, "Changeover is closed")
    if to not in ("IN_PROGRESS", "COMPLETED", "FAILED"):
        raise HTTPException(400, "Status must be IN_PROGRESS, COMPLETED, or FAILED")
    if to not in STEP_TRANSITIONS.get(t.status, ()):
        if t.status == "COMPLETED":
            raise HTTPException(409, f"Step {t.sequence_number} is already COMPLETED")
        if t.status == "FAILED" and to == "COMPLETED":
            raise HTTPException(409, f"Step {t.sequence_number} FAILED — retry it (start) before completing")
        if t.status == "PENDING" and to == "COMPLETED":
            raise HTTPException(409, f"Step {t.sequence_number} must be started before completing")
        raise HTTPException(409, f"Cannot move step {t.sequence_number} from {t.status} to {to}")
    if to in ("IN_PROGRESS", "COMPLETED"):
        check_prerequisites(db, co.id, t)
        blocked = open_critical_issues(db, co.id)
        if blocked:
            raise HTTPException(409, f"Blocked: {blocked} open critical issue(s) must be resolved first")
    if to == "FAILED" and not (reason or "").strip():
        raise HTTPException(422, "A failure reason is required")
    prev = t.status
    t.status = to
    if to == "COMPLETED":
        t.completed_at = datetime.utcnow()
        sync_pending_state(db, co)
    details: dict = {"changeover": co.id, "seq": t.sequence_number,
                     "previous": prev, "new": to}
    if reason:
        details["reason"] = reason
    audit(db, operator, "task", t.id, to.lower(), details)
    db.commit()
    db.refresh(t)
    return t


def session_progress(tasks: list) -> dict:
    total = len(tasks)
    completed = sum(1 for t in tasks if t.status == "COMPLETED")
    in_progress = sum(1 for t in tasks if t.status == "IN_PROGRESS")
    failed = sum(1 for t in tasks if t.status == "FAILED")
    remaining = sum(t.expected_duration_seconds or 0 for t in tasks if t.status != "COMPLETED")
    return {"total": total, "completed": completed, "in_progress": in_progress,
            "failed": failed, "pending": total - completed - in_progress - failed,
            "percent": round(completed / total * 100) if total else 100,
            "estimated_remaining_seconds": remaining}


def session_audit_trail(db: Session, cid: int, task_ids: list[int]) -> tuple[list, list]:
    """Audit entries + execution notes for a changeover, oldest first."""
    q = db.query(models.AuditEvent).filter(
        ((models.AuditEvent.entity_type == "changeover") & (models.AuditEvent.entity_id == str(cid))) |
        ((models.AuditEvent.entity_type == "task") & (models.AuditEvent.entity_id.in_([str(i) for i in task_ids]))) |
        ((models.AuditEvent.entity_type == "issue") & (models.AuditEvent.entity_id == str(cid)))
    ).order_by(models.AuditEvent.id).limit(200).all()
    trail, notes = [], []
    for a in q:
        try:
            details = json.loads(a.details_json or "{}")
        except (ValueError, TypeError):
            details = {}
        entry = {"entity": a.entity_type, "entity_id": a.entity_id, "action": a.action,
                 "actor": a.actor_id, "at": str(a.timestamp), "details": details}
        trail.append(entry)
        if a.action == "note":
            notes.append({"task_id": int(a.entity_id) if a.entity_type == "task" else None,
                          "note": details.get("note", ""), "operator": a.actor_id,
                          "at": str(a.timestamp)})
    return trail, notes


# ---------- startup seed ----------
def init_db():
    """Idempotent demo seed. Inserts missing rows; refreshes the demo (A/B/C)
    product configurations to the spec values; backfills new machine fields.
    Never touches user-created records and never overwrites a machine's live
    status or current product."""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        for spec in seed.MACHINES:
            m = db.query(models.Machine).filter_by(id=spec["id"]).first()
            if not m:
                db.add(models.Machine(**spec))
            else:
                # Backfill descriptive fields only; live state is preserved.
                for field in ("name", "machine_type", "line", "location"):
                    if not getattr(m, field) and spec.get(field):
                        setattr(m, field, spec[field])
        for u in seed.USERS:
            if not db.query(models.User).filter_by(id=u["id"]).first():
                db.add(models.User(**u))
        for p in seed.PRODUCTS:
            row = db.query(models.Product).filter_by(id=p["id"]).first()
            if not row:
                db.add(models.Product(id=p["id"], product_code=p["product_code"], name=p["name"],
                                      description=p.get("description"),
                                      configuration_json=json.dumps(p["configuration"]),
                                      revision=p["revision"], active=True))
            else:
                # Demo products are owned by the spec; user products are untouched.
                row.product_code = p["product_code"]
                row.name = p["name"]
                row.description = p.get("description")
                row.configuration_json = json.dumps(p["configuration"])
                row.revision = p["revision"]
        for d in seed.DOCUMENTS:
            if not db.query(models.Document).filter_by(title=d["title"]).first():
                db.add(models.Document(**d))
        # Normalize legacy all-caps approval values to the managed vocabulary.
        for d in db.query(models.Document).all():
            norm = {"APPROVED": "Approved", "DRAFT": "Draft", "ARCHIVED": "Archived"}.get(
                (d.approval_status or "").strip())
            if norm and d.approval_status != norm:
                d.approval_status = norm
        db.commit()
        sync_all_fts(db)
        db.commit()
        # Every machine needs at least one recorded state for previews.
        for spec in seed.MACHINES:
            if not latest_state(db, spec["id"]):
                cfg = seed.product_config(spec["current_product_id"])
                db.add(models.MachineState(machine_id=spec["id"],
                                           product_id=spec["current_product_id"],
                                           component_state_json=json.dumps(cfg["components"]),
                                           parameter_state_json=json.dumps(cfg["parameters"]),
                                           verification_status="VERIFIED"))
        db.commit()
    finally:
        db.close()


init_db()


@app.on_event("startup")
def startup_seed():
    init_db()


# ---------- users ----------
@app.get("/api/users", response_model=list[schemas.UserOut])
def list_users(db: Session = Depends(get_db)):
    return [schemas.UserOut(id=u.id, name=u.name, role=u.role, active=u.active)
            for u in db.query(models.User).filter_by(active=True).all()]


# ---------- machines & products ----------
def paginate(query, page: int, page_size: int) -> dict:
    page = max(1, page)
    page_size = min(100, max(1, page_size))
    total = query.count()
    rows = query.offset((page - 1) * page_size).limit(page_size).all()
    return {"items": rows, "total": total, "page": page, "page_size": page_size}


@app.get("/api/machines")
def list_machines(q: Optional[str] = None, status: Optional[str] = None,
                  line: Optional[str] = None, page: int = 1, page_size: int = 20,
                  db: Session = Depends(get_db)):
    query = db.query(models.Machine).order_by(models.Machine.id)
    if q:
        like = f"%{q}%"
        query = query.filter(models.Machine.id.ilike(like) | models.Machine.name.ilike(like)
                             | models.Machine.line.ilike(like) | models.Machine.location.ilike(like))
    if status:
        query = query.filter(models.Machine.status == status)
    if line:
        query = query.filter(models.Machine.line == line)
    result = paginate(query, page, page_size)
    result["items"] = [to_machine_out(m).model_dump() for m in result["items"]]
    return result


@app.get("/api/machines/{mid}")
def get_machine(mid: str, db: Session = Depends(get_db)):
    m = db.query(models.Machine).filter_by(id=mid).first()
    if not m:
        raise HTTPException(404, "Machine not found")
    out = to_machine_out(m).model_dump()
    st = official_state(db, mid)
    out["latest_state"] = ({
        "product_id": st.product_id,
        "components": json.loads(st.component_state_json),
        "parameters": json.loads(st.parameter_state_json),
        "verification_status": st.verification_status,
        "recorded_at": str(st.recorded_at),
    } if st else None)
    return out


@app.post("/api/machines", status_code=201)
def create_machine(req: schemas.MachineCreate, db: Session = Depends(get_db)):
    if db.query(models.Machine).filter_by(id=req.id).first():
        raise HTTPException(409, f"Machine '{req.id}' already exists")
    if req.status not in schemas.ALLOWED_MACHINE_STATUSES:
        raise HTTPException(422, f"Invalid status '{req.status}'. "
                                 f"Allowed: {', '.join(schemas.ALLOWED_MACHINE_STATUSES)}")
    product_id = (req.current_product_id or "").strip() or None
    cfg = None
    if product_id:
        prod = db.query(models.Product).filter_by(id=product_id).first()
        if not prod:
            raise HTTPException(422, f"Unknown product '{req.current_product_id}'")
        cfg = json.loads(prod.configuration_json)
    m = models.Machine(id=req.id, name=req.name, machine_type=req.machine_type, line=req.line,
                       location=req.location, status=req.status,
                       current_product_id=product_id)
    db.add(m)
    if cfg:
        db.add(models.MachineState(machine_id=req.id, product_id=product_id,
                                   component_state_json=json.dumps(cfg["components"]),
                                   parameter_state_json=json.dumps(cfg["parameters"]),
                                   verification_status="VERIFIED"))
    audit(db, "api", "machine", req.id, "created", {"name": req.name})
    db.commit()
    db.refresh(m)
    return to_machine_out(m).model_dump()


@app.put("/api/machines/{mid}")
def update_machine(mid: str, req: schemas.MachineUpdate, db: Session = Depends(get_db)):
    m = db.query(models.Machine).filter_by(id=mid).first()
    if not m:
        raise HTTPException(404, "Machine not found")
    data = req.model_dump(exclude_unset=True)
    if "status" in data and data["status"] not in schemas.ALLOWED_MACHINE_STATUSES:
        raise HTTPException(422, f"Invalid status '{data['status']}'. "
                                 f"Allowed: {', '.join(schemas.ALLOWED_MACHINE_STATUSES)}")
    if "current_product_id" in data:
        product_id = (data["current_product_id"] or "").strip() or None
        if product_id and not db.query(models.Product).filter_by(id=product_id).first():
            raise HTTPException(422, f"Unknown product '{data['current_product_id']}'")
        data["current_product_id"] = product_id
    for key, value in data.items():
        setattr(m, key, value)
    m.configuration_version += 1
    m.updated_at = datetime.utcnow()
    audit(db, "api", "machine", mid, "updated", data)
    db.commit()
    db.refresh(m)
    return to_machine_out(m).model_dump()


@app.delete("/api/machines/{mid}")
def delete_machine(mid: str, db: Session = Depends(get_db)):
    m = db.query(models.Machine).filter_by(id=mid).first()
    if not m:
        raise HTTPException(404, "Machine not found")
    refs = db.query(models.Changeover).filter_by(machine_id=mid).count()
    if refs:
        raise HTTPException(409, f"Cannot delete machine '{mid}': {refs} recorded changeover(s) "
                                 "reference it. History must be preserved.")
    db.query(models.MachineState).filter_by(machine_id=mid).delete()
    audit(db, "api", "machine", mid, "deleted", {})
    db.delete(m)
    db.commit()
    return {"deleted": mid}


@app.get("/api/machines/{mid}/state", response_model=schemas.StateOut)
def machine_state(mid: str, db: Session = Depends(get_db)):
    m = db.query(models.Machine).filter_by(id=mid).first()
    if not m:
        raise HTTPException(404, "Machine not found")
    st = official_state(db, mid)
    if not st:
        raise HTTPException(404, "No verified state recorded")
    return schemas.StateOut(machine_id=mid, product_id=st.product_id,
                            components=json.loads(st.component_state_json),
                            parameters=json.loads(st.parameter_state_json),
                            verification_status=st.verification_status,
                            recorded_at=str(st.recorded_at))


@app.get("/api/products")
def list_products(q: Optional[str] = None, active: Optional[bool] = None,
                  page: int = 1, page_size: int = 20,
                  db: Session = Depends(get_db)):
    query = db.query(models.Product).order_by(models.Product.id)
    if q:
        like = f"%{q}%"
        query = query.filter(models.Product.id.ilike(like) | models.Product.name.ilike(like)
                             | models.Product.product_code.ilike(like))
    if active is not None:
        query = query.filter(models.Product.active == active)
    result = paginate(query, page, page_size)
    result["items"] = [to_product_out(p).model_dump() for p in result["items"]]
    return result


@app.get("/api/products/{pid}", response_model=schemas.ProductOut)
def get_product(pid: str, db: Session = Depends(get_db)):
    p = db.query(models.Product).filter_by(id=pid).first()
    if not p:
        raise HTTPException(404, "Product not found")
    return to_product_out(p)


@app.post("/api/products", status_code=201)
def create_product(req: schemas.ProductCreate, db: Session = Depends(get_db)):
    if db.query(models.Product).filter_by(id=req.id).first():
        raise HTTPException(409, f"Product '{req.id}' already exists")
    if db.query(models.Product).filter_by(product_code=req.product_code).first():
        raise HTTPException(409, f"Product code '{req.product_code}' is already used")
    errors = validate_product_configuration(req.configuration)
    if errors:
        raise HTTPException(422, "; ".join(errors))
    p = models.Product(id=req.id, product_code=req.product_code, name=req.name,
                       description=req.description,
                       configuration_json=json.dumps(req.configuration),
                       revision=req.revision, active=req.active)
    db.add(p)
    audit(db, "api", "product", req.id, "created", {"product_code": req.product_code})
    db.commit()
    db.refresh(p)
    return to_product_out(p).model_dump()


@app.put("/api/products/{pid}")
def update_product(pid: str, req: schemas.ProductUpdate, db: Session = Depends(get_db)):
    p = db.query(models.Product).filter_by(id=pid).first()
    if not p:
        raise HTTPException(404, "Product not found")
    data = req.model_dump(exclude_unset=True)
    if "product_code" in data:
        other = db.query(models.Product).filter_by(product_code=data["product_code"]).first()
        if other and other.id != pid:
            raise HTTPException(409, f"Product code '{data['product_code']}' is already used")
        p.product_code = data["product_code"]
    if "name" in data:
        p.name = data["name"]
    if "description" in data:
        p.description = data["description"]
    if "configuration" in data:
        errors = validate_product_configuration(data["configuration"])
        if errors:
            raise HTTPException(422, "; ".join(errors))
        p.configuration_json = json.dumps(data["configuration"])
    if "revision" in data:
        p.revision = data["revision"]
    if "active" in data:
        p.active = data["active"]
    p.updated_at = datetime.utcnow()
    audit(db, "api", "product", pid, "updated", {"fields": sorted(data.keys())})
    db.commit()
    db.refresh(p)
    return to_product_out(p).model_dump()


@app.delete("/api/products/{pid}")
def delete_product(pid: str, db: Session = Depends(get_db)):
    p = db.query(models.Product).filter_by(id=pid).first()
    if not p:
        raise HTTPException(404, "Product not found")
    blockers = []
    using_machines = db.query(models.Machine).filter_by(current_product_id=pid).count()
    if using_machines:
        blockers.append(f"{using_machines} machine(s) currently run it")
    states = db.query(models.MachineState).filter_by(product_id=pid).count()
    if states:
        blockers.append(f"{states} recorded machine state(s) reference it")
    cos = (db.query(models.Changeover)
           .filter((models.Changeover.source_product_id == pid)
                   | (models.Changeover.target_product_id == pid)).count())
    if cos:
        blockers.append(f"{cos} recorded changeover(s) reference it")
    if blockers:
        raise HTTPException(409, f"Cannot delete product '{pid}': " + "; ".join(blockers)
                                 + ". History must be preserved — deactivate it instead.")
    audit(db, "api", "product", pid, "deleted", {})
    db.delete(p)
    db.commit()
    return {"deleted": pid}


# ---------- preview & create ----------
DURATION_ESTIMATE_NOTE = ("Estimated durations are application-generated planning aids, "
                          "not measured production data.")


def build_preview(db: Session, machine_id: str, target_product_id: str):
    """Read-only comparison + ordered plan. Never mutates saved state."""
    m = db.query(models.Machine).filter_by(id=machine_id).first()
    if not m:
        raise HTTPException(404, "Machine not found")
    tp = db.query(models.Product).filter_by(id=target_product_id).first()
    if not tp:
        raise HTTPException(404, "Target product not found")
    st = official_state(db, machine_id)
    if not st:
        raise HTTPException(404, "No verified machine state — cannot compare configurations")
    source = {"components": json.loads(st.component_state_json),
              "parameters": json.loads(st.parameter_state_json)}
    target_full = json.loads(tp.configuration_json)
    target_cmp = {"components": target_full["components"], "parameters": target_full["parameters"]}
    comparison = compare_full(source, target_full)
    diffs = [c for c in comparison if c["change_required"]]
    # legacy differences shape (with source_value alias) for backward compatibility
    legacy_diffs = [dict(c, source_value=c["current_value"]) for c in diffs]
    plan = generate_plan(diffs, source, target_full)
    eligible, errors, warnings = check_eligibility(m.status, tp.active)
    total = sum(t["expected_duration_seconds"] for t in plan)
    return {"machine": to_machine_out(m).model_dump(),
            "target_product": to_product_out(tp).model_dump(),
            "current_config": source,
            "target_config": target_cmp,
            "comparison": comparison,
            "differences": legacy_diffs,
            "tasks": plan,
            "change_count": len(diffs),
            "no_change_required": len(diffs) == 0,
            "estimated_duration_seconds": total,
            "duration_estimate_note": DURATION_ESTIMATE_NOTE,
            "eligibility": {"eligible": eligible, "errors": errors, "warnings": warnings},
            # backward-compatible aliases
            "machine_id": machine_id, "source_product_id": st.product_id,
            "target_product_id": target_product_id}


@app.post("/api/changeovers/preview")
def preview(req: schemas.PreviewRequest, db: Session = Depends(get_db)):
    return build_preview(db, req.machine_id, req.target_product_id)


@app.post("/api/changeovers")
def create_changeover(req: schemas.CreateChangeoverRequest, db: Session = Depends(get_db)):
    prev = build_preview(db, req.machine_id, req.target_product_id)
    if not prev["eligibility"]["eligible"]:
        raise HTTPException(422, "; ".join(prev["eligibility"]["errors"]))
    m = db.query(models.Machine).filter_by(id=req.machine_id).first()
    tp = db.query(models.Product).filter_by(id=req.target_product_id).first()
    target_full = json.loads(tp.configuration_json)
    co = models.Changeover(machine_id=req.machine_id, source_product_id=prev["source_product_id"],
                           target_product_id=req.target_product_id, status="IN_PROGRESS",
                           operator_id=req.operator_id,
                           baseline_duration_seconds=target_full.get("estimated_changeover_seconds", 1080) + 360,
                           source_snapshot_json=json.dumps(current_full_config(db, req.machine_id)),
                           target_snapshot_json=json.dumps({"components": target_full["components"],
                                                            "parameters": target_full["parameters"]}))
    db.add(co)
    db.flush()
    for t in prev["tasks"]:
        db.add(models.ChangeoverTask(changeover_id=co.id, step_id=t["step_id"],
                                     sequence_number=t["sequence_number"],
                                     task_type=t["task_type"], category=t["category"],
                                     description=t["description"], instructions=t["instructions"],
                                     component=t["component"], parameter=t["parameter"],
                                     current_value=t["current_value"], target_value=t["target_value"],
                                     prerequisites=json.dumps(t["prerequisites"]),
                                     safety_notes=t["safety_notes"],
                                     verification_criteria=t["verification_criteria"],
                                     requires_confirmation=t["requires_confirmation"],
                                     expected_duration_seconds=t["expected_duration_seconds"],
                                     status="PENDING"))
    m.status = "CHANGEOVER"
    audit(db, req.operator_id, "changeover", co.id, "created",
          {"machine": req.machine_id, "target": req.target_product_id, "diffs": len(prev["differences"])})
    db.commit()
    db.refresh(co)
    tasks = db.query(models.ChangeoverTask).filter_by(changeover_id=co.id).order_by(models.ChangeoverTask.sequence_number).all()
    return {"id": co.id, "machine_id": co.machine_id, "source_product_id": co.source_product_id,
            "target_product_id": co.target_product_id, "status": co.status,
            "differences": prev["differences"], "tasks": [task_to_out(t).model_dump() for t in tasks]}


@app.get("/api/changeovers/{cid}")
def get_session(cid: int, db: Session = Depends(get_db)):
    co = get_changeover(db, cid)
    tasks = db.query(models.ChangeoverTask).filter_by(changeover_id=cid).order_by(models.ChangeoverTask.sequence_number).all()
    # Simulated view: explicit simulation row wins, else source + completed effects.
    # Read-only here — the official (VERIFIED) state is never exposed as working.
    working, _sim = resolve_working(db, co, tasks)
    target = json.loads(co.target_snapshot_json)
    verifs = db.query(models.VerificationResult).filter_by(changeover_id=cid).order_by(models.VerificationResult.id.desc()).limit(20).all()
    issues = db.query(models.Issue).filter_by(changeover_id=cid).all()
    task_dicts = [task_to_out(t).model_dump() for t in tasks]
    trail, notes = session_audit_trail(db, cid, [t.id for t in tasks])
    return {"id": co.id, "machine_id": co.machine_id, "source_product_id": co.source_product_id,
            "target_product_id": co.target_product_id, "status": co.status, "operator_id": co.operator_id,
            "started_at": str(co.started_at), "completed_at": str(co.completed_at) if co.completed_at else None,
            "initial_config": json.loads(co.source_snapshot_json),
            "working_config": working, "target_config": target,
            "tasks": task_dicts,
            "progress": session_progress(tasks),
            "verification": [{"check_name": v.check_name, "expected_value": v.expected_value,
                              "actual_value": v.actual_value, "result": v.result} for v in verifs],
            "issues": [{"id": i.id, "task_id": i.task_id, "category": i.category,
                        "severity": i.severity, "description": i.description,
                        "resolution_status": i.resolution_status,
                        "created_at": str(i.created_at)} for i in issues],
            "audit_trail": trail, "notes": notes}


def coerce_num(v):
    try:
        f = float(v)
        return int(f) if f.is_integer() else f
    except (TypeError, ValueError):
        return v


@app.get("/api/changeovers/{cid}/tasks")
def list_tasks(cid: int, db: Session = Depends(get_db)):
    get_changeover(db, cid)
    tasks = db.query(models.ChangeoverTask).filter_by(changeover_id=cid).order_by(models.ChangeoverTask.sequence_number).all()
    return [task_to_out(t).model_dump() for t in tasks]


@app.patch("/api/changeovers/{cid}/tasks/{tid}")
def update_task(cid: int, tid: int, req: schemas.TaskUpdate, db: Session = Depends(get_db)):
    """Legacy transition route — same rules as the step endpoints below."""
    co = get_changeover(db, cid)
    t = db.query(models.ChangeoverTask).filter_by(id=tid, changeover_id=cid).first()
    if not t:
        raise HTTPException(404, "Task not found")
    return task_to_out(transition_step(db, co, t, req.status, req.operator_id, req.reason)).model_dump()


@app.get("/api/changeovers")
def list_changeovers(status: Optional[str] = None, machine_id: Optional[str] = None,
                     page: int = 1, page_size: int = 20, db: Session = Depends(get_db)):
    query = db.query(models.Changeover).order_by(models.Changeover.id.desc())
    if status:
        query = query.filter(models.Changeover.status == status)
    if machine_id:
        query = query.filter(models.Changeover.machine_id == machine_id)
    result = paginate(query, page, page_size)
    items = []
    for c in result["items"]:
        n_tasks = db.query(models.ChangeoverTask).filter_by(changeover_id=c.id).count()
        n_done = db.query(models.ChangeoverTask).filter_by(changeover_id=c.id, status="COMPLETED").count()
        items.append({"id": c.id, "machine_id": c.machine_id, "source_product_id": c.source_product_id,
                      "target_product_id": c.target_product_id, "status": c.status,
                      "operator_id": c.operator_id, "started_at": str(c.started_at),
                      "completed_at": str(c.completed_at) if c.completed_at else None,
                      "tasks_total": n_tasks, "tasks_completed": n_done})
    result["items"] = items
    return result


@app.post("/api/changeovers/{cid}/steps/{ref}/start")
def start_step(cid: int, ref: str, body: Optional[dict] = None, db: Session = Depends(get_db)):
    co = get_changeover(db, cid)
    t = resolve_step(db, cid, ref)
    op = (body or {}).get("operator_id", "demo-operator")
    return task_to_out(transition_step(db, co, t, "IN_PROGRESS", op)).model_dump()


@app.post("/api/changeovers/{cid}/steps/{ref}/complete")
def complete_step(cid: int, ref: str, req: schemas.StepAction, db: Session = Depends(get_db)):
    co = get_changeover(db, cid)
    t = resolve_step(db, cid, ref)
    if req.note:
        audit(db, req.operator_id, "task", t.id, "note",
              {"changeover": cid, "seq": t.sequence_number, "note": req.note})
    return task_to_out(transition_step(db, co, t, "COMPLETED", req.operator_id)).model_dump()


@app.post("/api/changeovers/{cid}/steps/{ref}/fail")
def fail_step(cid: int, ref: str, req: schemas.StepAction, db: Session = Depends(get_db)):
    co = get_changeover(db, cid)
    t = resolve_step(db, cid, ref)
    return task_to_out(transition_step(db, co, t, "FAILED", req.operator_id, req.reason)).model_dump()


@app.post("/api/changeovers/{cid}/steps/{ref}/notes", status_code=201)
def add_step_note(cid: int, ref: str, req: schemas.StepNote, db: Session = Depends(get_db)):
    co = get_changeover(db, cid)
    t = resolve_step(db, cid, ref)
    if co.status in ("COMPLETED", "ABANDONED"):
        raise HTTPException(400, "Changeover is closed")
    if not req.note.strip():
        raise HTTPException(422, "Note must not be empty")
    audit(db, req.operator_id, "task", t.id, "note",
          {"changeover": cid, "seq": t.sequence_number, "note": req.note})
    db.commit()
    return {"changeover_id": cid, "task_id": t.id, "note": req.note, "operator": req.operator_id}


def find_simulation(db: Session, co: models.Changeover):
    """Simulated (PENDING) row belonging to this changeover, if any.

    Falls back to a legacy unassociated PENDING row recorded after the
    changeover started (pre-association rows); callers adopt it by setting
    changeover_id before committing.
    """
    row = (db.query(models.MachineState)
           .filter_by(machine_id=co.machine_id, verification_status="PENDING", changeover_id=co.id)
           .order_by(models.MachineState.id.desc()).first())
    if row is not None:
        return row
    legacy = (db.query(models.MachineState)
              .filter_by(machine_id=co.machine_id, verification_status="PENDING")
              .order_by(models.MachineState.id.desc()).first())
    if legacy is not None and legacy.changeover_id is None \
            and legacy.recorded_at and co.started_at and legacy.recorded_at >= co.started_at:
        return legacy
    return None


def resolve_working(db: Session, co: models.Changeover, tasks: list):
    """Simulated working config: explicit simulation row wins, otherwise the
    source snapshot overlaid with completed-task effects. Never touches the
    official (VERIFIED) machine state."""
    working = json.loads(co.source_snapshot_json)
    sim = find_simulation(db, co)
    if sim is not None:
        working = {"components": json.loads(sim.component_state_json),
                   "parameters": json.loads(sim.parameter_state_json)}
    else:
        for t in tasks:
            if t.status == "COMPLETED":
                if t.task_type == "configuration" and t.parameter:
                    working["parameters"][t.parameter] = coerce_num(t.target_value)
                if t.task_type == "physical" and t.component:
                    working["components"][t.component] = t.target_value
    return working, sim


def sync_pending_state(db: Session, co: models.Changeover):
    """Rebuild PENDING simulated state from source snapshot + completed tasks + last applied params."""
    working = json.loads(co.source_snapshot_json)
    tasks = db.query(models.ChangeoverTask).filter_by(changeover_id=co.id).all()
    for t in tasks:
        if t.status == "COMPLETED":
            if t.task_type == "configuration" and t.parameter:
                working["parameters"][t.parameter] = coerce_num(t.target_value)
            if t.task_type == "physical" and t.component:
                working["components"][t.component] = t.target_value
    # merge any previously applied explicit params (this changeover's simulation row)
    pend = find_simulation(db, co)
    if pend is not None:
        old = {"components": json.loads(pend.component_state_json),
               "parameters": json.loads(pend.parameter_state_json)}
        # keep explicit param edits, but completed tasks win
        for k, v in old["parameters"].items():
            working["parameters"].setdefault(k, v)
        for k, v in old["components"].items():
            working["components"].setdefault(k, v)
        pend.component_state_json = json.dumps(working["components"])
        pend.parameter_state_json = json.dumps(working["parameters"])
        pend.changeover_id = co.id
    else:
        db.add(models.MachineState(machine_id=co.machine_id, product_id=None, changeover_id=co.id,
                                   component_state_json=json.dumps(working["components"]),
                                   parameter_state_json=json.dumps(working["parameters"]),
                                   verification_status="PENDING"))


@app.post("/api/changeovers/{cid}/apply-configuration")
def apply_configuration(cid: int, req: schemas.ApplyConfigRequest, db: Session = Depends(get_db)):
    co = get_changeover(db, cid)
    if co.status in ("COMPLETED", "ABANDONED"):
        raise HTTPException(400, "Changeover is closed")
    tp = db.query(models.Product).filter_by(id=co.target_product_id).first()
    target_full = json.loads(tp.configuration_json)
    ok, errors = validate_parameters(target_full, req.parameters)
    if not ok:
        raise HTTPException(422, "; ".join(errors))
    # prerequisite: configuration tasks' prereqs must be satisfied before applying that param
    tasks = db.query(models.ChangeoverTask).filter_by(changeover_id=cid).all()
    by_param = {t.parameter: t for t in tasks if t.task_type == "configuration" and t.parameter}
    sibs = {x.sequence_number: x for x in tasks}
    for k in req.parameters:
        t = by_param.get(k)
        if t:
            for p in json.loads(t.prerequisites or "[]"):
                s = sibs.get(p)
                if not s or s.status != "COMPLETED":
                    raise HTTPException(409, f"Cannot apply {k}: prerequisite step {p} incomplete")
    working, sim = resolve_working(db, co, tasks)
    for k, v in req.parameters.items():
        working["parameters"][k] = coerce_num(v)
    if sim is not None:
        sim.changeover_id = co.id  # adopt legacy rows explicitly
        sim.component_state_json = json.dumps(working["components"])
        sim.parameter_state_json = json.dumps(working["parameters"])
        sim.recorded_at = datetime.utcnow()
    else:
        db.add(models.MachineState(machine_id=co.machine_id, product_id=None, changeover_id=co.id,
                                   component_state_json=json.dumps(working["components"]),
                                   parameter_state_json=json.dumps(working["parameters"]),
                                   verification_status="PENDING"))
    # auto-complete matching configuration tasks when applied value equals target
    target = json.loads(co.target_snapshot_json)
    for t in tasks:
        if t.task_type == "configuration" and t.parameter in req.parameters:
            try:
                if abs(float(req.parameters[t.parameter]) - float(target["parameters"][t.parameter])) < 1e-9:
                    # only auto-complete if prereqs satisfied
                    blocked = any((sibs.get(p) is None or sibs.get(p).status != "COMPLETED")
                                  for p in json.loads(t.prerequisites or "[]"))
                    if not blocked:
                        t.status = "COMPLETED"
                        t.completed_at = datetime.utcnow()
            except (TypeError, ValueError):
                pass
    audit(db, req.operator_id, "changeover", cid, "apply_configuration", {"parameters": req.parameters})
    db.commit()
    return {"working_config": working, "applied": req.parameters}


def next_run_number(db: Session, cid: int) -> int:
    top = (db.query(models.VerificationResult)
           .filter_by(changeover_id=cid).order_by(models.VerificationResult.run_number.desc()).first())
    return (top.run_number or 0) + 1 if top else 1


def persist_verification_run(db: Session, cid: int, checks: list) -> int:
    """Store one verification run. History is append-only — reruns never erase prior rows."""
    run = next_run_number(db, cid)
    for c in checks:
        db.add(models.VerificationResult(changeover_id=cid, run_number=run,
                                         check_name=c["check_name"],
                                         expected_value=c["expected_value"],
                                         actual_value=c["actual_value"], result=c["result"],
                                         reason=c.get("reason")))
    return run


def verification_runs(db: Session, cid: int) -> list[dict]:
    rows = (db.query(models.VerificationResult).filter_by(changeover_id=cid)
            .order_by(models.VerificationResult.run_number, models.VerificationResult.id).all())
    runs: dict[int, dict] = {}
    for v in rows:
        run = runs.setdefault(v.run_number or 1, {"run": v.run_number or 1, "at": str(v.checked_at),
                                                  "checks": []})
        run["checks"].append({"id": v.id, "check_name": v.check_name,
                              "expected_value": v.expected_value, "actual_value": v.actual_value,
                              "result": v.result, "reason": v.reason, "at": str(v.checked_at)})
    out = []
    for run in sorted(runs.values(), key=lambda r: r["run"]):
        run["passed"] = all(c["result"] == "PASS" for c in run["checks"])
        out.append(run)
    return out


def overall_verification_status(db: Session, co: models.Changeover) -> str:
    """PENDING (never ran) | FAILED (latest run failed) | VERIFIED (latest passed) | READY (finalized)."""
    if co.status == "COMPLETED":
        return "READY"
    runs = verification_runs(db, co.id)
    if not runs:
        return "PENDING"
    return "VERIFIED" if runs[-1]["passed"] else "FAILED"


@app.post("/api/changeovers/{cid}/verify")
def verify(cid: int, body: Optional[dict] = None, db: Session = Depends(get_db)):
    co = get_changeover(db, cid)
    blocked = open_critical_issues(db, cid)
    if blocked:
        raise HTTPException(409, f"Blocked: {blocked} open critical issue(s) must be resolved first")
    target = json.loads(co.target_snapshot_json)
    tasks = db.query(models.ChangeoverTask).filter_by(changeover_id=cid).all()
    task_dicts = [{"task_type": t.task_type, "status": t.status, "sequence_number": t.sequence_number} for t in tasks]
    working, sim = resolve_working(db, co, tasks)
    checks = verify_state(target, working["components"], working["parameters"], task_dicts)
    run = persist_verification_run(db, cid, checks)
    passed = all(c["result"] == "PASS" for c in checks)
    failures = [c for c in checks if c["result"] == "FAIL"]
    # mark verification task
    for t in tasks:
        if t.task_type == "verification":
            if passed:
                t.status = "COMPLETED"
                t.completed_at = datetime.utcnow()
    if sim is not None:
        sim.component_state_json = json.dumps(working["components"])
        sim.parameter_state_json = json.dumps(working["parameters"])
    audit(db, "system", "changeover", cid, "verify",
          {"run": run, "passed": passed, "failures": len(failures)})
    db.commit()
    hints = []
    for f in failures:
        if f["check_name"].startswith("parameter:"):
            hints.append(f"Correct {f['check_name'].split(':')[1]}: expected {f['expected_value']}, got {f['actual_value']}.")
        elif f["check_name"].startswith("component:"):
            hints.append(f"Install required {f['check_name'].split(':')[1]}: expected {f['expected_value']}, found {f['actual_value']}.")
        elif f["check_name"] == "tasks:mandatory_completed":
            hints.append("Complete all mandatory physical/configuration tasks (prerequisites enforced).")
    return {"passed": passed, "run": run, "overall": overall_verification_status(db, co),
            "checks": checks, "failures": failures, "guidance": hints,
            "ready": False, "note": "READY only after /complete with all checks passing."}


@app.get("/api/changeovers/{cid}/verification")
def get_verification(cid: int, db: Session = Depends(get_db)):
    co = get_changeover(db, cid)
    return {"changeover_id": cid, "overall": overall_verification_status(db, co),
            "runs": verification_runs(db, cid)}


@app.get("/api/changeovers/{cid}/simulation")
def get_simulation(cid: int, db: Session = Depends(get_db)):
    """Initial vs target vs simulated configurations. Simulation rows are
    explicitly associated and never double as official machine state."""
    co = get_changeover(db, cid)
    tasks = db.query(models.ChangeoverTask).filter_by(changeover_id=cid).all()
    working, sim = resolve_working(db, co, tasks)
    official = official_state(db, co.machine_id)
    return {"changeover_id": cid, "machine_id": co.machine_id,
            "initial": json.loads(co.source_snapshot_json),
            "target": json.loads(co.target_snapshot_json),
            "simulated": working,
            "simulated_status": "APPLIED" if sim is not None else "UNTOUCHED",
            "simulated_at": str(sim.recorded_at) if sim is not None else None,
            "official": ({"components": json.loads(official.component_state_json),
                          "parameters": json.loads(official.parameter_state_json),
                          "product_id": official.product_id} if official else None),
            "note": "Simulated values only — the official machine state changes on finalize."}


@app.post("/api/changeovers/{cid}/complete")
def complete(cid: int, body: Optional[dict] = None, db: Session = Depends(get_db)):
    co = get_changeover(db, cid)
    if co.status == "COMPLETED":
        raise HTTPException(400, "Already completed")
    blocked = open_critical_issues(db, cid)
    if blocked:
        raise HTTPException(409, f"Blocked: {blocked} open critical issue(s) must be resolved first")
    operator = (body or {}).get("operator_id", co.operator_id or "demo-operator")
    # re-run verification deterministically (finalization gate)
    target = json.loads(co.target_snapshot_json)
    tasks = db.query(models.ChangeoverTask).filter_by(changeover_id=cid).all()
    working, _sim = resolve_working(db, co, tasks)
    task_dicts = [{"task_type": t.task_type, "status": t.status, "sequence_number": t.sequence_number} for t in tasks]
    checks = verify_state(target, working["components"], working["parameters"], task_dicts)
    if not all(c["result"] == "PASS" for c in checks):
        co.status = "FAILED"
        run = persist_verification_run(db, cid, checks)
        audit(db, operator, "changeover", cid, "finalize_rejected",
              {"run": run, "failures": sum(1 for c in checks if c["result"] == "FAIL")})
        db.commit()
        raise HTTPException(409, {"message": "Verification failed — READY blocked", "checks": checks})
    # All gates passed: single transaction below persists official state + product + completion.
    # Any exception before commit leaves the previous official state untouched.
    try:
        db.add(models.MachineState(machine_id=co.machine_id, product_id=co.target_product_id,
                                   component_state_json=json.dumps(working["components"]),
                                   parameter_state_json=json.dumps(working["parameters"]),
                                   verification_status="VERIFIED"))
        m = db.query(models.Machine).filter_by(id=co.machine_id).first()
        m.status = "READY"
        m.current_product_id = co.target_product_id
        m.configuration_version += 1
        co.status = "COMPLETED"
        co.completed_at = datetime.utcnow()
        co.actual_duration_seconds = int((co.completed_at - co.started_at).total_seconds())
        audit(db, operator, "changeover", cid, "completed", {"target": co.target_product_id})
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"status": "COMPLETED", "machine_id": co.machine_id, "new_product": co.target_product_id,
            "verified_config": working, "ready": True,
            "note": "Simulated READY only — does not authorize real machine operation.",
            "actual_duration_seconds": co.actual_duration_seconds}


@app.post("/api/changeovers/{cid}/abandon")
def abandon(cid: int, body: Optional[dict] = None, db: Session = Depends(get_db)):
    co = get_changeover(db, cid)
    if co.status == "COMPLETED":
        raise HTTPException(400, "Already completed")
    co.status = "ABANDONED"
    m = db.query(models.Machine).filter_by(id=co.machine_id).first()
    m.status = "READY"  # revert to last verified state, do NOT adopt target
    audit(db, (body or {}).get("operator_id", "demo-operator"), "changeover", cid, "abandoned", {})
    db.commit()
    return {"status": "ABANDONED", "note": "Last verified state preserved."}


# ---------- issues ----------
@app.post("/api/changeovers/{cid}/issues", status_code=201)
def report_issue(cid: int, req: schemas.IssueCreate, db: Session = Depends(get_db)):
    co = get_changeover(db, cid)
    if co.status in ("COMPLETED", "ABANDONED"):
        raise HTTPException(400, "Changeover is closed")
    if req.severity not in schemas.ISSUE_SEVERITIES:
        raise HTTPException(422, f"Invalid severity '{req.severity}'. "
                                 f"Allowed: {', '.join(schemas.ISSUE_SEVERITIES)}")
    if req.task_id is not None:
        resolve_step(db, cid, str(req.task_id))  # validates the step belongs here
    if not req.description.strip():
        raise HTTPException(422, "Issue description is required")
    i = models.Issue(changeover_id=cid, task_id=req.task_id, category=req.category,
                     severity=req.severity, description=req.description.strip(),
                     resolution_status="OPEN")
    db.add(i)
    audit(db, req.operator_id, "issue", cid, "reported",
          {"category": req.category, "severity": req.severity, "task_id": req.task_id})
    db.commit()
    db.refresh(i)
    return {"id": i.id, "severity": i.severity, "resolution_status": i.resolution_status}


@app.patch("/api/issues/{iid}/resolve")
def resolve_issue(iid: int, body: Optional[dict] = None, db: Session = Depends(get_db)):
    i = db.query(models.Issue).filter_by(id=iid).first()
    if not i:
        raise HTTPException(404, "Issue not found")
    if i.resolution_status == "RESOLVED":
        raise HTTPException(409, "Issue is already resolved")
    i.resolution_status = "RESOLVED"
    # Simulated resolution workflow: prototype has no role-based authorization.
    # Resolution is attributed and audited; a future phase must gate this by role.
    audit(db, (body or {}).get("operator_id", "demo-operator"), "issue", i.changeover_id,
          "resolved", {"issue_id": iid, "simulated": True})
    db.commit()
    return {"id": i.id, "resolution_status": i.resolution_status}


# ---------- analytics ----------
@app.get("/api/analytics/summary")
def analytics_summary(db: Session = Depends(get_db)):
    all_co = db.query(models.Changeover).all()
    done = [c for c in all_co if c.status == "COMPLETED"]
    avg = (sum(c.actual_duration_seconds or 0 for c in done) / len(done)) if done else 0
    fails = db.query(models.VerificationResult).filter_by(result="FAIL").count()
    issues = db.query(models.Issue).count()
    by_transition: dict[str, dict] = {}
    for c in done:
        key = f"{c.source_product_id}->{c.target_product_id}"
        by_transition.setdefault(key, {"count": 0, "total_s": 0})
        by_transition[key]["count"] += 1
        by_transition[key]["total_s"] += c.actual_duration_seconds or 0
    transitions = [{"transition": k, "count": v["count"],
                    "avg_seconds": round(v["total_s"] / v["count"]) if v["count"] else 0}
                   for k, v in by_transition.items()]
    # baseline comparison: baseline 18 min (1080 s) manual sim
    assisted = avg or 0
    reduction = round((1080 - assisted) / 1080 * 100, 1) if assisted else 0
    return {"completed_changeovers": len(done), "total_changeovers": len(all_co),
            "avg_assisted_seconds": round(avg),
            "simulated_baseline_seconds": 1080,
            "simulated_time_reduction_pct": reduction,
            "verification_failures": fails,
            "issues_reported": issues,
            "by_transition": transitions,
            "baseline_note": "Baseline is a simulated manual estimate (18 min); values reflect prototype test runs, not factory data."}


@app.get("/api/analytics/changeovers")
def analytics_history(q: Optional[str] = None, status: Optional[str] = None,
                      machine_id: Optional[str] = None, product_id: Optional[str] = None,
                      date_from: Optional[str] = None, date_to: Optional[str] = None,
                      sort: str = "-started_at", page: int = 1, page_size: int = 20,
                      db: Session = Depends(get_db)):
    from . import analytics as az
    try:
        start, end = az.parse_range(date_from, date_to)
    except ValueError as e:
        raise HTTPException(422, str(e))
    query = az.scoped_changeovers(db, start, end, machine_id, product_id, status)
    if q:
        like = f"%{q}%"
        query = query.filter(models.Changeover.machine_id.ilike(like)
                             | models.Changeover.operator_id.ilike(like))
    sort_map = {"started_at": models.Changeover.started_at,
                "-started_at": models.Changeover.started_at.desc(),
                "duration": models.Changeover.actual_duration_seconds,
                "-duration": models.Changeover.actual_duration_seconds.desc(),
                "id": models.Changeover.id, "-id": models.Changeover.id.desc()}
    if sort not in sort_map:
        raise HTTPException(422, f"Invalid sort '{sort}'. Allowed: {sorted(sort_map)}")
    query = query.order_by(sort_map[sort])
    result = paginate(query, page, page_size)
    rows = result["items"]
    ids = [c.id for c in rows]
    counts = az.task_counts(db, ids)
    outcomes = az.latest_run_outcomes(db, ids)
    open_issues = az.open_issue_counts(db, ids)
    items = []
    for c in rows:
        outcome = outcomes.get(c.id)
        items.append({"id": c.id, "machine_id": c.machine_id,
                      "source": c.source_product_id, "target": c.target_product_id,
                      "status": c.status, "operator": c.operator_id,
                      "simulated": (c.operator_id or "").startswith(az.SIMULATED_PREFIX),
                      "started_at": str(c.started_at),
                      "completed_at": str(c.completed_at) if c.completed_at else None,
                      "actual_duration_seconds": c.actual_duration_seconds,
                      "baseline_duration_seconds": c.baseline_duration_seconds,
                      "changes": counts.get(c.id, 0),
                      "verification": ("PASS" if outcome is True else
                                       "FAIL" if outcome is False else "NOT_RUN"),
                      "issues_open": open_issues.get(c.id, 0)})
    result["items"] = items
    return result


@app.get("/api/analytics/overview")
def analytics_overview(machine_id: Optional[str] = None, product_id: Optional[str] = None,
                       status: Optional[str] = None,
                       date_from: Optional[str] = None, date_to: Optional[str] = None,
                       db: Session = Depends(get_db)):
    from . import analytics as az
    try:
        start, end = az.parse_range(date_from, date_to)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return {"filters": {"machine_id": machine_id, "product_id": product_id, "status": status,
                        "date_from": date_from, "date_to": date_to},
            "kpis": az.kpis(db, start, end, machine_id, product_id),
            "definitions": {
                "success_rate": "COMPLETED / total changeovers × 100",
                "avg_duration_seconds": "mean recorded actual duration of COMPLETED changeovers",
                "avg_changes": "mean planned-step count of COMPLETED changeovers",
                "verification_pass_rate": "PASS verification checks / all recorded checks × 100",
                "estimated": "application-generated plan estimates, not measured data"}}


@app.get("/api/analytics/changeovers-over-time")
def analytics_over_time(machine_id: Optional[str] = None, status: Optional[str] = None,
                        date_from: Optional[str] = None, date_to: Optional[str] = None,
                        db: Session = Depends(get_db)):
    from . import analytics as az
    try:
        start, end = az.parse_range(date_from, date_to)
    except ValueError as e:
        raise HTTPException(422, str(e))
    rows = (az.scoped_changeovers(db, start, end, machine_id, None, status)
            .with_entities(models.Changeover.started_at, models.Changeover.status).all())
    buckets: dict[str, dict] = {}
    for started, st in rows:
        day = str(started.date()) if started else "unknown"
        b = buckets.setdefault(day, {"date": day, "total": 0, "completed": 0,
                                     "failed": 0, "abandoned": 0, "in_progress": 0})
        b["total"] += 1
        if st == "COMPLETED":
            b["completed"] += 1
        elif st == "FAILED":
            b["failed"] += 1
        elif st == "ABANDONED":
            b["abandoned"] += 1
        elif st == "IN_PROGRESS":
            b["in_progress"] += 1
    return sorted(buckets.values(), key=lambda b: b["date"])


@app.get("/api/analytics/machine-performance")
def analytics_machine_performance(date_from: Optional[str] = None, date_to: Optional[str] = None,
                                  db: Session = Depends(get_db)):
    from . import analytics as az
    try:
        start, end = az.parse_range(date_from, date_to)
    except ValueError as e:
        raise HTTPException(422, str(e))
    rows = (az.scoped_changeovers(db, start, end)
            .with_entities(models.Changeover.machine_id, models.Changeover.status,
                           models.Changeover.actual_duration_seconds).all())
    machines: dict[str, dict] = {}
    for mid, st, dur in rows:
        m = machines.setdefault(mid, {"machine_id": mid, "total": 0, "completed": 0,
                                      "failed": 0, "durations": []})
        m["total"] += 1
        if st == "COMPLETED":
            m["completed"] += 1
            if dur is not None:
                m["durations"].append(dur)
        elif st == "FAILED":
            m["failed"] += 1
    out = []
    for m in machines.values():
        durs = m.pop("durations")
        m["avg_seconds"] = round(sum(durs) / len(durs)) if durs else None
        out.append(m)
    return sorted(out, key=lambda m: m["machine_id"])


@app.get("/api/analytics/verification")
def analytics_verification(machine_id: Optional[str] = None, product_id: Optional[str] = None,
                           date_from: Optional[str] = None, date_to: Optional[str] = None,
                           db: Session = Depends(get_db)):
    from . import analytics as az
    try:
        start, end = az.parse_range(date_from, date_to)
    except ValueError as e:
        raise HTTPException(422, str(e))
    ids = az.changeover_ids(az.scoped_changeovers(db, start, end, machine_id, product_id))
    if not ids:
        return {"pass": 0, "fail": 0, "total": 0, "pass_rate": 0.0, "runs": 0, "by_check": []}
    rows = (db.query(models.VerificationResult.check_name, models.VerificationResult.result,
                     func.count(models.VerificationResult.id))
            .filter(models.VerificationResult.changeover_id.in_(ids))
            .group_by(models.VerificationResult.check_name, models.VerificationResult.result).all())
    by_check: dict[str, dict] = {}
    passed = failed = 0
    for check, result, n in rows:
        b = by_check.setdefault(check, {"check": check, "pass": 0, "fail": 0})
        if result == "PASS":
            b["pass"] += n
            passed += n
        else:
            b["fail"] += n
            failed += n
    runs = 0
    if ids:
        pairs = (db.query(models.VerificationResult.changeover_id,
                          models.VerificationResult.run_number)
                 .filter(models.VerificationResult.changeover_id.in_(ids))
                 .distinct().subquery())
        runs = db.query(func.count()).select_from(pairs).scalar() or 0
    total = passed + failed
    return {"pass": passed, "fail": failed, "total": total,
            "pass_rate": round(passed / total * 100, 1) if total else 0.0,
            "runs": runs, "by_check": sorted(by_check.values(), key=lambda b: b["check"])}


@app.get("/api/analytics/common-changes")
def analytics_common_changes(machine_id: Optional[str] = None, product_id: Optional[str] = None,
                             date_from: Optional[str] = None, date_to: Optional[str] = None,
                             db: Session = Depends(get_db)):
    from . import analytics as az
    try:
        start, end = az.parse_range(date_from, date_to)
    except ValueError as e:
        raise HTTPException(422, str(e))
    ids = az.changeover_ids(az.scoped_changeovers(db, start, end, machine_id, product_id))
    if not ids:
        return {"parameters": [], "components": []}
    prows = (db.query(models.ChangeoverTask.parameter, func.count(models.ChangeoverTask.id))
             .filter(models.ChangeoverTask.changeover_id.in_(ids),
                     models.ChangeoverTask.task_type == "configuration")
             .group_by(models.ChangeoverTask.parameter)
             .order_by(func.count(models.ChangeoverTask.id).desc()).all())
    crows = (db.query(models.ChangeoverTask.component, func.count(models.ChangeoverTask.id))
             .filter(models.ChangeoverTask.changeover_id.in_(ids),
                     models.ChangeoverTask.task_type == "physical",
                     models.ChangeoverTask.component.isnot(None))
             .group_by(models.ChangeoverTask.component)
             .order_by(func.count(models.ChangeoverTask.id).desc()).all())
    return {"parameters": [{"parameter": k, "count": n} for k, n in prows],
            "components": [{"component": k, "count": n} for k, n in crows]}


@app.get("/api/analytics/issues")
def analytics_issues(machine_id: Optional[str] = None,
                     date_from: Optional[str] = None, date_to: Optional[str] = None,
                     db: Session = Depends(get_db)):
    from . import analytics as az
    try:
        start, end = az.parse_range(date_from, date_to)
    except ValueError as e:
        raise HTTPException(422, str(e))
    cids = az.changeover_ids(az.scoped_changeovers(db, start, end, machine_id))
    q = db.query(models.Issue)
    if machine_id:
        q = q.filter(models.Issue.changeover_id.in_(cids) if cids else models.Issue.id == -1)
    open_n = q.filter(models.Issue.resolution_status == "OPEN").count()
    resolved = q.filter(models.Issue.resolution_status == "RESOLVED").count()
    cat = (db.query(models.Issue.category, models.Issue.resolution_status,
                    func.count(models.Issue.id))
           .filter(models.Issue.changeover_id.in_(cids) if cids or machine_id else True)
           .group_by(models.Issue.category, models.Issue.resolution_status).all())
    by_cat: dict[str, dict] = {}
    for category, status, n in cat:
        b = by_cat.setdefault(category or "general", {"category": category or "general", "open": 0, "resolved": 0})
        if status == "OPEN":
            b["open"] += n
        else:
            b["resolved"] += n
    sev = (db.query(models.Issue.severity, func.count(models.Issue.id))
           .filter(models.Issue.changeover_id.in_(cids) if cids or machine_id else True)
           .group_by(models.Issue.severity).all())
    return {"open": open_n, "resolved": resolved, "total": open_n + resolved,
            "by_category": sorted(by_cat.values(), key=lambda b: b["category"]),
            "by_severity": [{"severity": s or "minor", "count": n} for s, n in sev]}


@app.get("/api/analytics/duration-comparison")
def analytics_duration_comparison(machine_id: Optional[str] = None, product_id: Optional[str] = None,
                                  date_from: Optional[str] = None, date_to: Optional[str] = None,
                                  limit: int = 20, db: Session = Depends(get_db)):
    """Estimated (planned) vs actual (recorded) durations for COMPLETED changeovers."""
    from . import analytics as az
    try:
        start, end = az.parse_range(date_from, date_to)
    except ValueError as e:
        raise HTTPException(422, str(e))
    rows = (az.scoped_changeovers(db, start, end, machine_id, product_id, status="COMPLETED")
            .order_by(models.Changeover.id.desc()).limit(min(limit, 50)).all())
    out = []
    for c in rows:
        est = (db.query(func.coalesce(func.sum(models.ChangeoverTask.expected_duration_seconds), 0))
               .filter(models.ChangeoverTask.changeover_id == c.id).scalar()) or 0
        out.append({"id": c.id, "label": f"#{c.id} {c.source_product_id}->{c.target_product_id}",
                    "estimated_seconds": int(est),
                    "actual_seconds": c.actual_duration_seconds})
    return {"note": "Estimated durations are application-generated plan estimates; "
                    "actual durations are recorded from start/completion timestamps.",
            "items": out}


def csv_cell(value) -> str:
    """Escape a CSV field; guard against spreadsheet formula injection."""
    s = "" if value is None else str(value)
    if s[:1] in ("=", "+", "-", "@"):
        s = "'" + s
    if any(ch in s for ch in ('"', ",", "\n", "\r")):
        s = '"' + s.replace('"', '""') + '"'
    return s


@app.get("/api/reports/changeovers")
def report_changeovers(status: Optional[str] = None, machine_id: Optional[str] = None,
                       product_id: Optional[str] = None,
                       date_from: Optional[str] = None, date_to: Optional[str] = None,
                       db: Session = Depends(get_db)):
    from fastapi.responses import PlainTextResponse
    from . import analytics as az
    try:
        start, end = az.parse_range(date_from, date_to)
    except ValueError as e:
        raise HTTPException(422, str(e))
    rows = (az.scoped_changeovers(db, start, end, machine_id, product_id, status)
            .order_by(models.Changeover.id).all())
    ids = [c.id for c in rows]
    counts = az.task_counts(db, ids)
    outcomes = az.latest_run_outcomes(db, ids)
    header = ["id", "machine_id", "source_product", "target_product", "status", "operator",
              "started_at", "completed_at", "actual_duration_seconds", "baseline_duration_seconds",
              "planned_changes", "verification_outcome"]
    lines = [",".join(header)]
    for c in rows:
        outcome = outcomes.get(c.id)
        lines.append(",".join(csv_cell(v) for v in [
            c.id, c.machine_id, c.source_product_id, c.target_product_id, c.status, c.operator_id,
            str(c.started_at), str(c.completed_at) if c.completed_at else "",
            c.actual_duration_seconds, c.baseline_duration_seconds, counts.get(c.id, 0),
            "PASS" if outcome is True else "FAIL" if outcome is False else "NOT_RUN"]))
    body = "\n".join(lines) + "\n"
    return PlainTextResponse(body, media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=changeovers.csv"})


@app.get("/api/reports/summary")
def report_summary(machine_id: Optional[str] = None, product_id: Optional[str] = None,
                   date_from: Optional[str] = None, date_to: Optional[str] = None,
                   db: Session = Depends(get_db)):
    from fastapi.responses import PlainTextResponse
    from . import analytics as az
    try:
        start, end = az.parse_range(date_from, date_to)
    except ValueError as e:
        raise HTTPException(422, str(e))
    kpis = az.kpis(db, start, end, machine_id, product_id)
    lines = ["metric,value"]
    for key in sorted(kpis):
        lines.append(f"{csv_cell(key)},{csv_cell(kpis[key])}")
    return PlainTextResponse("\n".join(lines) + "\n", media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=analytics-summary.csv"})


# ---------- assistant & docs ----------
@app.post("/api/assistant/query")
def assistant_query(req: schemas.AssistantQuery, db: Session = Depends(get_db)):
    docs = db.query(models.Document).all()
    return assistant_answer(req.question, docs, req.top_k)


def to_document_out(d: models.Document) -> schemas.DocumentOut:
    preview = (d.content or "")[:300]
    return schemas.DocumentOut(id=d.id, title=d.title, description=d.description,
                               category=d.category, revision=d.revision,
                               approval_status=d.approval_status,
                               effective_date=d.effective_date or "",
                               filename=d.filename, mime_type=d.mime_type,
                               size_bytes=d.size_bytes,
                               processing_status=d.processing_status or "READY",
                               preview=preview, content_length=len(d.content or ""),
                               uploaded_at=str(d.uploaded_at) if d.uploaded_at else None)


@app.get("/api/documents")
def list_docs(q: Optional[str] = None, category: Optional[str] = None,
              status: Optional[str] = None, page: int = 1, page_size: int = 20,
              db: Session = Depends(get_db)):
    query = db.query(models.Document).order_by(models.Document.id.desc())
    if q:
        like = f"%{q}%"
        query = query.filter(models.Document.title.ilike(like)
                             | models.Document.description.ilike(like))
    if category:
        query = query.filter(models.Document.category == category)
    if status:
        query = query.filter(models.Document.approval_status == status)
    result = paginate(query, page, page_size)
    result["items"] = [to_document_out(d).model_dump() for d in result["items"]]
    return result


@app.get("/api/documents/{doc_id}")
def get_document(doc_id: int, db: Session = Depends(get_db)):
    d = db.query(models.Document).filter_by(id=doc_id).first()
    if not d:
        raise HTTPException(404, "Document not found")
    return to_document_out(d).model_dump()


@app.get("/api/documents/{doc_id}/content")
def get_document_content(doc_id: int, db: Session = Depends(get_db)):
    d = db.query(models.Document).filter_by(id=doc_id).first()
    if not d:
        raise HTTPException(404, "Document not found")
    return {"id": d.id, "title": d.title, "revision": d.revision,
            "approval_status": d.approval_status, "content": d.content or ""}


def extract_upload_text(filename: str, data: bytes) -> tuple[str, str, list | None]:
    """Validate + extract plain text. Returns (content, mime, chunks). Never executes files."""
    ext = os.path.splitext(filename or "")[1].lower()
    if ext not in config.DOCS_ALLOWED_EXTENSIONS:
        raise HTTPException(422, f"Only {sorted(config.DOCS_ALLOWED_EXTENSIONS)} files are accepted")
    limit = int(config.DOCS_MAX_MB * 1024 * 1024)
    if len(data) > limit:
        raise HTTPException(413, f"File exceeds the {config.DOCS_MAX_MB:g} MB upload limit")
    if not data:
        raise HTTPException(422, "Uploaded file is empty")
    if ext == ".txt":
        try:
            content = data.decode("utf-8")
        except UnicodeDecodeError:
            raise HTTPException(422, "Text file is not valid UTF-8")
        return content, "text/plain", None
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        pages = [(i + 1, (pg.extract_text() or "")) for i, pg in enumerate(reader.pages)]
    except Exception:
        raise HTTPException(422, "PDF could not be parsed (malformed file)")
    chunks = [{"section": f"Page {n}", "text": t.strip()} for n, t in pages if t.strip()]
    content = "\n\n".join(t for _, t in pages).strip()
    if not content:
        raise HTTPException(422, "PDF contains no extractable text")
    return content, "application/pdf", chunks


@app.post("/api/documents/upload", status_code=201)
async def upload_document(title: str = Form(...), description: str = Form(""),
                          category: str = Form(""), revision: str = Form("v1.0"),
                          file: UploadFile = File(...), db: Session = Depends(get_db)):
    title = (title or "").strip()
    if not title:
        raise HTTPException(422, "Document title is required")
    if len(title) > 200:
        raise HTTPException(422, "Document title is too long (max 200 characters)")
    revision = (revision or "").strip() or "v1.0"
    if len(revision) > 32:
        raise HTTPException(422, "Revision is too long (max 32 characters)")
    data = await file.read()
    content, mime, chunks = extract_upload_text(file.filename or "", data)
    safe_name = os.path.basename(file.filename or "")[:120]
    d = models.Document(title=title, description=(description or "").strip() or None,
                        category=(category or "").strip() or None,
                        revision=revision,
                        approval_status="Draft", effective_date="",
                        filename=safe_name, mime_type=mime, size_bytes=len(data),
                        processing_status="READY", content=content,
                        chunks_json=(json.dumps(chunks) if chunks else None))
    db.add(d)
    db.flush()
    sync_document_fts(db, d)
    audit(db, "api", "document", d.id, "uploaded",
          {"title": title, "mime": mime, "bytes": len(data)})
    db.commit()
    db.refresh(d)
    return to_document_out(d).model_dump()


def transition_document(db: Session, doc_id: int, operator: str, to: str) -> models.Document:
    d = db.query(models.Document).filter_by(id=doc_id).first()
    if not d:
        raise HTTPException(404, "Document not found")
    allowed = {"Draft": ("Approved",), "Approved": ("Archived",), "Archived": ()}
    current = (d.approval_status or "Draft").strip()
    # Normalize legacy all-caps seed values.
    norm = {"APPROVED": "Approved", "DRAFT": "Draft", "ARCHIVED": "Archived"}.get(current, current)
    if to not in allowed.get(norm, ()):
        raise HTTPException(409, f"Cannot move document from '{d.approval_status}' to '{to}'")
    d.approval_status = to
    audit(db, operator, "document", doc_id, to.lower(), {"title": d.title, "revision": d.revision})
    db.commit()
    db.refresh(d)
    return d


@app.post("/api/documents/{doc_id}/approve")
def approve_document(doc_id: int, req: schemas.DocumentActor, db: Session = Depends(get_db)):
    return to_document_out(transition_document(db, doc_id, req.operator_id, "Approved")).model_dump()


@app.post("/api/documents/{doc_id}/archive")
def archive_document(doc_id: int, req: schemas.DocumentActor, db: Session = Depends(get_db)):
    return to_document_out(transition_document(db, doc_id, req.operator_id, "Archived")).model_dump()


# ---------- AI SOP assistant ----------
@app.get("/api/ai/status")
def ai_status(db: Session = Depends(get_db)):
    approved = db.query(models.Document).all()
    approved = [d for d in approved if (d.approval_status or "").lower() == "approved"]
    return {"provider": provider_status(),
            "retrieval": "sqlite-fts5",
            "documents_total": db.query(models.Document).count(),
            "documents_approved": len(approved)}


@app.post("/api/ai/ask")
def ai_ask(req: schemas.AiAskRequest, db: Session = Depends(get_db)):
    if req.machine_id and not db.query(models.Machine).filter_by(id=req.machine_id).first():
        raise HTTPException(404, f"Unknown machine '{req.machine_id}'")
    if req.target_product_id and not db.query(models.Product).filter_by(id=req.target_product_id).first():
        raise HTTPException(404, f"Unknown product '{req.target_product_id}'")
    if req.changeover_id and not db.query(models.Changeover).filter_by(id=req.changeover_id).first():
        raise HTTPException(404, f"Unknown changeover '{req.changeover_id}'")
    passages, limitations = retrieve_passages(db, req.question, req.top_k)
    live = build_live_data(db, req.machine_id, req.target_product_id, req.changeover_id)
    warnings = [SAFETY_WARNING]
    if not passages:
        return {"answer": ("The approved documentation does not provide a reliable answer to "
                           "that question. Please consult your supervisor or process engineer."),
                "sources": [], "excerpts": [], "provider": provider_status(),
                "limitations": limitations, "warnings": warnings,
                "live_data": live, "grounded": False}
    try:
        text_out, prov = generate(req.question, passages)
    except ProviderError as e:
        raise HTTPException(502, str(e))
    sources = [{"doc_id": p["doc_id"], "title": p["title"], "revision": p["revision"],
                "section": p["section"]} for p in passages]
    return {"answer": text_out, "sources": sources,
            "excerpts": [p["text"] for p in passages],
            "provider": prov, "limitations": limitations, "warnings": warnings,
            "live_data": live, "grounded": True}


@app.get("/api/health")
def health():
    return {"ok": True}
