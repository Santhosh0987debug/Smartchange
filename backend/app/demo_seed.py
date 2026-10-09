"""Repeatable demo-history seed for the analytics dashboard.

Creates a small set of COMPLETED / FAILED / ABANDONED / IN_PROGRESS changeovers
with realistic timestamps, verification runs, and issues — all attributed to
the `demo-seed` operator and audited as simulated records.

* Idempotent: does nothing if demo-seed records already exist.
* Never touches machines, official states, products, or user-created records.
* Run explicitly:  cd backend && python -m app.demo_seed
"""
import json
from datetime import datetime, timedelta

from .database import SessionLocal
from . import models, seed
from .engine import compare_states, generate_plan

OPERATOR = "demo-seed"

# (machine, source, target, days_ago, duration_s, outcome, issues)
# outcome: "completed" (all checks pass) | "failed" (temperature check fails)
#          | "abandoned" | "open" (in progress, partial tasks)
SCENARIOS = [
    ("FILL-01", "A", "B", 6, 720, "completed", []),
    ("FILL-02", "A", "B", 5, 840, "completed", [("minor", "general", "Scuff on guard", True)]),
    ("FILL-01", "B", "C", 4, 900, "completed", []),
    ("PACK-01", "C", "B", 3, 660, "completed", []),
    ("FILL-02", "A", "C", 2, None, "failed", [("minor", "general", "Gauge slow to settle", False)]),
    ("FILL-01", "A", "B", 1, None, "abandoned", []),
    ("FILL-02", "B", "A", 0, None, "open", []),
]


def build_tasks(source_id: str, target_id: str) -> list[dict]:
    s = seed.product_config(source_id)
    t = seed.product_config(target_id)
    source = {"components": s["components"], "parameters": s["parameters"]}
    target = {"components": t["components"], "parameters": t["parameters"]}
    return generate_plan(compare_states(source, target), source, target)


def run() -> bool:
    db = SessionLocal()
    try:
        if db.query(models.Changeover).filter_by(operator_id=OPERATOR).first():
            print("demo-seed records already present — nothing to do.")
            return False
        now = datetime.utcnow()
        for mid, src, tgt, days_ago, duration, outcome, issues in SCENARIOS:
            tcfg = seed.product_config(tgt)
            started = now - timedelta(days=days_ago, hours=2)
            completed = (started + timedelta(seconds=duration)
                         if outcome == "completed" and duration else None)
            co = models.Changeover(
                machine_id=mid, source_product_id=src, target_product_id=tgt,
                status={"completed": "COMPLETED", "failed": "FAILED",
                        "abandoned": "ABANDONED", "open": "IN_PROGRESS"}[outcome],
                operator_id=OPERATOR, started_at=started, completed_at=completed,
                baseline_duration_seconds=1080, actual_duration_seconds=duration,
                source_snapshot_json=json.dumps(
                    {"components": seed.product_config(src)["components"],
                     "parameters": seed.product_config(src)["parameters"]}),
                target_snapshot_json=json.dumps(
                    {"components": tcfg["components"], "parameters": tcfg["parameters"]}))
            db.add(co)
            db.flush()
            plan = build_tasks(src, tgt)
            done_cutoff = {"completed": len(plan), "failed": max(len(plan) - 2, 1),
                           "abandoned": 2, "open": 1}[outcome]
            for t in plan:
                st = "COMPLETED" if t["sequence_number"] <= done_cutoff else "PENDING"
                db.add(models.ChangeoverTask(
                    changeover_id=co.id, step_id=t["step_id"],
                    sequence_number=t["sequence_number"], task_type=t["task_type"],
                    category=t["category"], description=t["description"],
                    instructions=t.get("instructions"), component=t["component"],
                    parameter=t["parameter"], current_value=t["current_value"],
                    target_value=t["target_value"], prerequisites=json.dumps(t["prerequisites"]),
                    safety_notes=t["safety_notes"],
                    verification_criteria=t["verification_criteria"],
                    requires_confirmation=t["requires_confirmation"],
                    expected_duration_seconds=t["expected_duration_seconds"], status=st,
                    completed_at=completed if st == "COMPLETED" else None))
            # verification runs: all-pass for completed; temp failure otherwise.
            # Abandoned/open runs never verified — no rows (outcome NOT_RUN).
            if outcome in ("completed", "failed"):
                checks = []
                for k, v in tcfg["components"].items():
                    checks.append((f"component:{k}", str(v), str(v), "PASS", None))
                for k, v in tcfg["parameters"].items():
                    if outcome == "failed" and k == "temperature_c":
                        checks.append((f"parameter:{k}", str(v), str(float(v) + 5),
                                       "FAIL", f"Expected {k}={v}, found {float(v) + 5}."))
                    else:
                        checks.append((f"parameter:{k}", str(v), str(v), "PASS", None))
                checks.append(("tasks:mandatory_completed",
                               "done", "done" if outcome == "completed" else "partial",
                               "PASS" if outcome == "completed" else "FAIL",
                               None if outcome == "completed" else "Mandatory steps incomplete."))
                first_run = [(n, e, a, r, reason) for n, e, a, r, reason in checks]
                if outcome == "completed" and src == "B" and tgt == "C":
                    # one retry story: first run failed on temperature, second passed
                    retry_first = []
                    for n, e, a, r, reason in first_run:
                        if n == "parameter:temperature_c":
                            retry_first.append((n, e, str(float(e) + 5), "FAIL",
                                                f"Expected {n}={e}."))
                        else:
                            retry_first.append((n, e, a, r, reason))
                    for n, e, a, r, reason in retry_first:
                        db.add(models.VerificationResult(
                            changeover_id=co.id, run_number=1, check_name=n,
                            expected_value=e, actual_value=a, result=r, reason=reason,
                            checked_at=started + timedelta(minutes=10)))
                    run_no, at = 2, (completed or started) + timedelta(minutes=-5)
                else:
                    run_no, at = 1, (completed or started) + timedelta(minutes=-5)
                for n, e, a, r, reason in first_run:
                    db.add(models.VerificationResult(
                        changeover_id=co.id, run_number=run_no, check_name=n,
                        expected_value=e, actual_value=a, result=r, reason=reason, checked_at=at))
            for sev, cat, desc, resolved in issues:
                db.add(models.Issue(changeover_id=co.id, category=cat, severity=sev,
                                    description=desc,
                                    resolution_status="RESOLVED" if resolved else "OPEN",
                                    created_at=started + timedelta(minutes=30)))
            db.add(models.AuditEvent(actor_id=OPERATOR, entity_type="changeover",
                                     entity_id=str(co.id), action="seeded",
                                     details_json=json.dumps({"simulated": True, "outcome": outcome}),
                                     timestamp=started))
        db.commit()
        print(f"demo-seed inserted {len(SCENARIOS)} simulated changeovers.")
        return True
    finally:
        db.close()


if __name__ == "__main__":
    run()
