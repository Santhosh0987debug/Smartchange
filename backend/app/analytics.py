"""Analytics aggregations over persisted records.

Every metric is computed from the database — nothing is hardcoded. Empty
datasets yield zeros/None (division-by-zero is impossible by construction).
Estimated durations come from planned task estimates; actual durations from
recorded start/completion timestamps.
"""
from datetime import datetime, timedelta
from sqlalchemy import func
from sqlalchemy.orm import Session

from . import models

SIMULATED_PREFIX = "demo-seed"


def parse_range(date_from: str | None, date_to: str | None):
    """Parse YYYY-MM-DD bounds to datetimes. Raises ValueError on bad input."""
    start = datetime.strptime(date_from, "%Y-%m-%d") if date_from else None
    end = None
    if date_to:
        end = datetime.strptime(date_to, "%Y-%m-%d") + timedelta(days=1)
    if start and end and start >= end:
        raise ValueError("date_from must be before date_to")
    return start, end


def scoped_changeovers(db: Session, start=None, end=None, machine_id=None,
                       product_id=None, status=None):
    q = db.query(models.Changeover)
    if start:
        q = q.filter(models.Changeover.started_at >= start)
    if end:
        q = q.filter(models.Changeover.started_at < end)
    if machine_id:
        q = q.filter(models.Changeover.machine_id == machine_id)
    if product_id:
        q = q.filter((models.Changeover.source_product_id == product_id)
                      | (models.Changeover.target_product_id == product_id))
    if status:
        q = q.filter(models.Changeover.status == status)
    return q


def changeover_ids(query) -> list[int]:
    return [r[0] for r in query.with_entities(models.Changeover.id).all()]


def task_counts(db: Session, ids: list[int]) -> dict[int, int]:
    if not ids:
        return {}
    rows = (db.query(models.ChangeoverTask.changeover_id, func.count(models.ChangeoverTask.id))
            .filter(models.ChangeoverTask.changeover_id.in_(ids))
            .group_by(models.ChangeoverTask.changeover_id).all())
    return {cid: n for cid, n in rows}


def latest_run_outcomes(db: Session, ids: list[int]) -> dict[int, bool | None]:
    """Latest verification run outcome per changeover (None = never ran)."""
    out: dict[int, bool | None] = {cid: None for cid in ids}
    if not ids:
        return out
    rows = (db.query(models.VerificationResult.changeover_id,
                     models.VerificationResult.run_number,
                     models.VerificationResult.result)
            .filter(models.VerificationResult.changeover_id.in_(ids)).all())
    per_run: dict[tuple[int, int], bool] = {}
    for cid, run, result in rows:
        key = (cid, run or 1)
        per_run[key] = per_run.get(key, True) and (result == "PASS")
    best_run: dict[int, int] = {}
    for (cid, run), passed in per_run.items():
        if cid not in best_run or run > best_run[cid]:
            best_run[cid] = run
            out[cid] = passed
    return out


def open_issue_counts(db: Session, ids: list[int]) -> dict[int, int]:
    if not ids:
        return {}
    rows = (db.query(models.Issue.changeover_id, func.count(models.Issue.id))
            .filter(models.Issue.changeover_id.in_(ids),
                    models.Issue.resolution_status == "OPEN")
            .group_by(models.Issue.changeover_id).all())
    return {cid: n for cid, n in rows}


def kpis(db: Session, start=None, end=None, machine_id=None, product_id=None) -> dict:
    base = scoped_changeovers(db, start, end, machine_id, product_id)
    total = base.count()
    completed = base.filter(models.Changeover.status == "COMPLETED").count()
    failed = base.filter(models.Changeover.status == "FAILED").count()
    abandoned = base.filter(models.Changeover.status == "ABANDONED").count()
    in_progress = base.filter(models.Changeover.status == "IN_PROGRESS").count()
    durations = [r[0] for r in base.filter(models.Changeover.status == "COMPLETED",
                                           models.Changeover.actual_duration_seconds.isnot(None))
                 .with_entities(models.Changeover.actual_duration_seconds).all()]
    avg_duration = round(sum(durations) / len(durations)) if durations else None
    comp_ids = [r[0] for r in base.filter(models.Changeover.status == "COMPLETED")
                .with_entities(models.Changeover.id).all()]
    counts = task_counts(db, comp_ids)
    avg_changes = round(sum(counts.values()) / len(counts), 1) if counts else None
    ids = changeover_ids(base)
    if ids:
        checks = (db.query(models.VerificationResult.result, func.count(models.VerificationResult.id))
                  .filter(models.VerificationResult.changeover_id.in_(ids))
                  .group_by(models.VerificationResult.result).all())
        check_map = {r: n for r, n in checks}
        passed_checks = check_map.get("PASS", 0)
        total_checks = sum(check_map.values())
        pairs = (db.query(models.VerificationResult.changeover_id,
                          models.VerificationResult.run_number)
                 .filter(models.VerificationResult.changeover_id.in_(ids))
                 .distinct().subquery())
        runs = db.query(func.count()).select_from(pairs).scalar() or 0
    else:
        passed_checks, total_checks, runs = 0, 0, 0
    # issues in scope (join through changeovers)
    iq = db.query(models.Issue)
    if ids:
        iq = iq.filter(models.Issue.changeover_id.in_(ids))
    else:
        iq = iq.filter(models.Issue.id == -1)
    open_issues = iq.filter(models.Issue.resolution_status == "OPEN").count()
    resolved_issues = iq.filter(models.Issue.resolution_status == "RESOLVED").count()
    return {
        "total_changeovers": total,
        "completed_changeovers": completed,
        "failed_changeovers": failed,
        "abandoned_changeovers": abandoned,
        "in_progress_changeovers": in_progress,
        "success_rate": round(completed / total * 100, 1) if total else 0.0,
        "avg_duration_seconds": avg_duration,
        "avg_changes": avg_changes,
        "verification_pass_rate": round(passed_checks / total_checks * 100, 1) if total_checks else 0.0,
        "verification_checks": total_checks,
        "verification_runs": runs,
        "open_issues": open_issues,
        "resolved_issues": resolved_issues,
    }
