"""Phase 4 tests: step lifecycle, notes, audit trail, critical-issue blocking, progress."""
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def make_co(mid="FILL-01", target="B"):
    co = client.post("/api/changeovers", json={"machine_id": mid, "target_product_id": target}).json()
    return co["id"], {t["sequence_number"]: t for t in co["tasks"]}


def test_step_endpoints_by_id_and_step_id():
    cid, tasks = make_co()
    # start by plan step_id
    r = client.post(f"/api/changeovers/{cid}/steps/S01/start", json={"operator_id": "demo-operator"}).json()
    assert r["status"] == "IN_PROGRESS" and r["step_id"] == "S01"
    # complete by database id
    r2 = client.post(f"/api/changeovers/{cid}/steps/{tasks[1]['id']}/complete",
                     json={"operator_id": "demo-operator"}).json()
    assert r2["status"] == "COMPLETED"
    assert client.post(f"/api/changeovers/{cid}/steps/NOPE/start").status_code == 404
    assert client.post("/api/changeovers/99999/steps/S01/start").status_code == 404
    assert client.get("/api/changeovers/99999").status_code == 404


def test_duplicate_and_terminal_transitions_rejected():
    cid, tasks = make_co()
    client.post(f"/api/changeovers/{cid}/steps/S01/start", json={})
    dup = client.post(f"/api/changeovers/{cid}/steps/S01/start", json={})
    assert dup.status_code == 409
    client.post(f"/api/changeovers/{cid}/steps/S01/complete", json={})
    for verb in ("start", "complete"):
        r = client.post(f"/api/changeovers/{cid}/steps/S01/{verb}", json={})
        assert r.status_code == 409, (verb, r.text)
    # FAILED steps retry via start, never jump straight to completed
    client.post(f"/api/changeovers/{cid}/steps/S02/start", json={})
    client.post(f"/api/changeovers/{cid}/steps/S02/fail", json={"reason": "Seized fitting"})
    assert client.post(f"/api/changeovers/{cid}/steps/S02/complete", json={}).status_code == 409
    retry = client.post(f"/api/changeovers/{cid}/steps/S02/start", json={}).json()
    assert retry["status"] == "IN_PROGRESS"
    done = client.post(f"/api/changeovers/{cid}/steps/S02/complete", json={}).json()
    assert done["status"] == "COMPLETED"


def test_step_notes_and_audit_trail():
    cid, tasks = make_co()
    client.post(f"/api/changeovers/{cid}/steps/S01/start", json={"operator_id": "supervisor"})
    n = client.post(f"/api/changeovers/{cid}/steps/S01/notes",
                    json={"note": "Line stopped, gauge at zero.", "operator_id": "supervisor"})
    assert n.status_code == 201
    assert client.post(f"/api/changeovers/{cid}/steps/S01/notes",
                       json={"note": "   "}).status_code == 422
    detail = client.get(f"/api/changeovers/{cid}").json()
    assert any(x["note"] == "Line stopped, gauge at zero." and x["operator"] == "supervisor"
               for x in detail["notes"])
    actions = [(a["action"], a["details"].get("previous"), a["details"].get("new"), a["actor"])
               for a in detail["audit_trail"]]
    assert ("in_progress", "PENDING", "IN_PROGRESS", "supervisor") in actions
    assert any(a["action"] == "note" for a in detail["audit_trail"])
    assert any(a["action"] == "created" for a in detail["audit_trail"])


def test_critical_issue_blocks_execution_until_resolved():
    cid, tasks = make_co()
    iss = client.post(f"/api/changeovers/{cid}/issues",
                      json={"task_id": tasks[1]["id"], "category": "safety",
                            "severity": "critical", "description": "Interlock fault"}).json()
    assert iss["severity"] == "critical"
    assert client.post(f"/api/changeovers/{cid}/steps/S01/start", json={}).status_code == 409
    assert client.post(f"/api/changeovers/{cid}/verify").status_code == 409
    # non-critical issues do not block
    minor = client.post(f"/api/changeovers/{cid}/issues",
                        json={"category": "general", "severity": "minor", "description": "Scuff mark"})
    assert minor.status_code == 201
    # resolve the critical issue -> execution resumes
    assert client.patch(f"/api/issues/{iss['id']}/resolve").json()["resolution_status"] == "RESOLVED"
    assert client.patch(f"/api/issues/{iss['id']}/resolve").status_code == 409  # no double resolve
    assert client.post(f"/api/changeovers/{cid}/steps/S01/start", json={}).status_code == 200
    detail = client.get(f"/api/changeovers/{cid}").json()
    open_crit = [i for i in detail["issues"] if i["severity"] == "critical" and i["resolution_status"] == "OPEN"]
    assert not open_crit
    assert any(a["action"] == "resolved" for a in detail["audit_trail"])


def test_issue_validation():
    cid, tasks = make_co()
    assert client.post(f"/api/changeovers/{cid}/issues",
                       json={"severity": "extreme", "description": "x"}).status_code == 422
    assert client.post(f"/api/changeovers/{cid}/issues",
                       json={"description": "   "}).status_code == 422
    assert client.post(f"/api/changeovers/{cid}/issues",
                       json={"task_id": 99999, "description": "x"}).status_code == 404
    # closed changeovers reject new issues
    co = client.post("/api/changeovers", json={"machine_id": "FILL-01", "target_product_id": "A"}).json()
    client.post(f"/api/changeovers/{co['id']}/complete")
    assert client.post(f"/api/changeovers/{co['id']}/issues",
                       json={"description": "late"}).status_code == 400


def test_progress_math_and_persistence():
    cid, tasks = make_co()
    d0 = client.get(f"/api/changeovers/{cid}").json()
    assert d0["progress"] == {"total": 7, "completed": 0, "in_progress": 0, "failed": 0,
                              "pending": 7, "percent": 0, "estimated_remaining_seconds": 1050}
    client.post(f"/api/changeovers/{cid}/steps/S01/start", json={})
    client.post(f"/api/changeovers/{cid}/steps/S01/complete", json={})
    d1 = client.get(f"/api/changeovers/{cid}").json()  # reloaded: progress persisted
    assert d1["progress"]["completed"] == 1 and d1["progress"]["percent"] == 14
    assert d1["progress"]["estimated_remaining_seconds"] == 1050 - 120
    assert d1["tasks"][0]["status"] == "COMPLETED"


def test_patch_fail_requires_reason():
    cid, tasks = make_co()
    r = client.patch(f"/api/changeovers/{cid}/tasks/{tasks[1]['id']}", json={"status": "FAILED"})
    assert r.status_code == 422
    ok = client.patch(f"/api/changeovers/{cid}/tasks/{tasks[1]['id']}",
                      json={"status": "FAILED", "reason": "Broken1999"})
    assert ok.status_code == 200 and ok.json()["status"] == "FAILED"


def test_changeovers_list():
    cid, _ = make_co()
    open_list = client.get("/api/changeovers", params={"status": "IN_PROGRESS"}).json()
    assert open_list["total"] >= 1
    assert all(c["status"] == "IN_PROGRESS" for c in open_list["items"])
    assert any(c["id"] == cid and c["tasks_total"] == 7 for c in open_list["items"])
    by_machine = client.get("/api/changeovers", params={"machine_id": "FILL-01"}).json()
    assert all(c["machine_id"] == "FILL-01" for c in by_machine["items"])
