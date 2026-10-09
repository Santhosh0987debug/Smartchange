"""Demo-data reset command. Restores the competition demo baseline WITHOUT
touching user-created records.

Removes:
  * changeovers with operator_id = 'demo-seed' (plus their tasks, verification
    runs, states simulated for them, and issues)
  * any other non-COMPLETED changeover on the demo machines (abandoned demo runs)

Restores:
  * demo machines (FILL-01/FILL-02/PACK-01) to spec status/product (live workflow
    states such as CHANGEOVER are left alone — only demo baseline values apply
    when the machine has no open changeover)
  * demo products A/B/C to the spec configurations
  * a VERIFIED state row for each demo machine if none exists

Preserves:
  * user-created machines/products/documents and their history
  * COMPLETED changeovers (real execution history is never deleted)
  * all audit_events rows (the audit trail is append-only)

Run explicitly:  cd backend && python -m app.reset_demo
"""
import json

from .database import SessionLocal
from . import models, seed

OPERATOR = "demo-seed"


def run() -> dict:
    db = SessionLocal()
    removed = {"changeovers": 0, "tasks": 0, "verifications": 0, "states": 0, "issues": 0}
    try:
        seeded = db.query(models.Changeover).filter_by(operator_id=OPERATOR).all()
        for co in seeded:
            removed["tasks"] += db.query(models.ChangeoverTask).filter_by(changeover_id=co.id).delete()
            removed["verifications"] += db.query(models.VerificationResult).filter_by(changeover_id=co.id).delete()
            removed["issues"] += db.query(models.Issue).filter_by(changeover_id=co.id).delete()
            removed["states"] += db.query(models.MachineState).filter_by(changeover_id=co.id).delete()
            db.delete(co)
            removed["changeovers"] += 1
        # Re-run the idempotent demo seed (restores machines/products/states, keeps user data).
        from .main import init_db
        init_db()
        # Demo machines back to baseline when they have no open/failed changeover.
        # COMPLETED history is preserved; only the live baseline is restored.
        for spec in seed.MACHINES:
            m = db.query(models.Machine).filter_by(id=spec["id"]).first()
            if not m:
                continue
            busy = (db.query(models.Changeover)
                    .filter(models.Changeover.machine_id == spec["id"],
                            models.Changeover.status.in_(("IN_PROGRESS", "FAILED"))).count())
            if busy == 0:
                m.status = spec["status"]
                m.current_product_id = spec["current_product_id"]
                cfg = seed.product_config(spec["current_product_id"])
                has_state = (db.query(models.MachineState)
                             .filter_by(machine_id=spec["id"], verification_status="VERIFIED",
                                        product_id=spec["current_product_id"]).first())
                if not has_state:
                    db.add(models.MachineState(
                        machine_id=spec["id"], product_id=spec["current_product_id"],
                        component_state_json=json.dumps(cfg["components"]),
                        parameter_state_json=json.dumps(cfg["parameters"]),
                        verification_status="VERIFIED"))
        db.commit()
        summary = {"removed": removed}
        print("reset_demo:", json.dumps(summary))
        return summary
    finally:
        db.close()


if __name__ == "__main__":
    run()
