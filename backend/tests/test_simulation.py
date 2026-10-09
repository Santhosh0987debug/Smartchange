"""Phase 5 tests: simulator separation, verification runs, safe finalization (A-E + edges)."""
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def start(mid, target):
    co = client.post("/api/changeovers", json={"machine_id": mid, "target_product_id": target}).json()
    return co["id"], {t["sequence_number"]: t for t in co["tasks"]}


def do(cid, tid):
    assert client.post(f"/api/changeovers/{cid}/steps/{tid}/start", json={}).status_code == 200
    r = client.post(f"/api/changeovers/{cid}/steps/{tid}/complete", json={})
    assert r.status_code == 200, r.text


def complete_physical(cid, tasks):
    for seq in sorted(tasks):
        t = tasks[seq]
        if t["task_type"] == "physical":
            for p in t["prerequisites"]:
                if tasks[p]["status"] != "COMPLETED":
                    do(cid, tasks[p]["id"])
                    tasks[p]["status"] = "COMPLETED"
            do(cid, t["id"])
            tasks[seq]["status"] = "COMPLETED"


def test_scenario_a_successful_changeover():
    cid, tasks = start("FILL-01", "B")
    complete_physical(cid, tasks)
    ap = client.post(f"/api/changeovers/{cid}/simulation/apply", json={})  # unknown route -> 404
    assert ap.status_code in (404, 405)
    ap = client.post(f"/api/changeovers/{cid}/apply-configuration",
                     json={"parameters": {"speed_rpm": 120, "temperature_c": 75, "pressure_bar": 3.0}})
    assert ap.status_code == 200
    # simulated vs official stay separate until finalize
    sim = client.get(f"/api/changeovers/{cid}/simulation").json()
    assert sim["simulated"]["parameters"]["pressure_bar"] == 3.0
    assert sim["official"]["parameters"]["pressure_bar"] == 2.5
    assert sim["initial"]["parameters"]["pressure_bar"] == 2.5
    assert sim["simulated_status"] == "APPLIED"
    ver = client.post(f"/api/changeovers/{cid}/verify").json()
    assert ver["passed"] is True and ver["run"] == 1 and ver["overall"] == "VERIFIED"
    assert all(c["result"] == "PASS" for c in ver["checks"])
    assert len(ver["checks"]) == 6  # 5 params + mandatory tasks
    done = client.post(f"/api/changeovers/{cid}/complete").json()
    assert done["status"] == "COMPLETED" and done["ready"] is True
    st = client.get("/api/machines/FILL-01/state").json()
    assert st["product_id"] == "B" and st["parameters"]["pressure_bar"] == 3.0
    assert st["verification_status"] == "VERIFIED"
    overall = client.get(f"/api/changeovers/{cid}/verification").json()
    assert overall["overall"] == "READY"


def test_scenario_b_wrong_temperature_blocks_ready():
    cid, tasks = start("FILL-01", "B")
    complete_physical(cid, tasks)
    client.post(f"/api/changeovers/{cid}/apply-configuration",
                json={"parameters": {"speed_rpm": 120, "temperature_c": 80, "pressure_bar": 3.0}})
    ver = client.post(f"/api/changeovers/{cid}/verify").json()
    assert ver["passed"] is False and ver["overall"] == "FAILED"
    temp = next(c for c in ver["checks"] if c["check_name"] == "parameter:temperature_c")
    assert temp["result"] == "FAIL" and "75" in (temp["reason"] or "")
    blocked = client.post(f"/api/changeovers/{cid}/complete")
    assert blocked.status_code == 409
    # official state untouched
    st = client.get("/api/machines/FILL-01/state").json()
    assert st["product_id"] == "A" and st["parameters"]["temperature_c"] == 70


def test_scenario_c_missing_task_bypass_rejected():
    cid, tasks = start("FILL-01", "B")
    # only safety done; fixture + params untouched
    do(cid, tasks[1]["id"])
    ver = client.post(f"/api/changeovers/{cid}/verify").json()
    assert ver["passed"] is False
    mand = next(c for c in ver["checks"] if c["check_name"] == "tasks:mandatory_completed")
    assert mand["result"] == "FAIL" and mand["reason"]
    assert client.post(f"/api/changeovers/{cid}/complete").status_code == 409
    # changeover marked FAILED, official state preserved
    assert client.get(f"/api/changeovers/{cid}").json()["status"] == "FAILED"
    assert client.get("/api/machines/FILL-01/state").json()["product_id"] == "A"


def test_scenario_d_critical_issue_blocks_finalize():
    cid, tasks = start("FILL-01", "B")
    complete_physical(cid, tasks)
    client.post(f"/api/changeovers/{cid}/apply-configuration",
                json={"parameters": {"speed_rpm": 120, "temperature_c": 75, "pressure_bar": 3.0}})
    assert client.post(f"/api/changeovers/{cid}/verify").json()["passed"] is True
    iss = client.post(f"/api/changeovers/{cid}/issues",
                      json={"severity": "critical", "description": "Guard open"}).json()
    assert client.post(f"/api/changeovers/{cid}/complete").status_code == 409
    assert client.get("/api/machines/FILL-01/state").json()["product_id"] == "A"
    client.patch(f"/api/issues/{iss['id']}/resolve")
    done = client.post(f"/api/changeovers/{cid}/complete").json()
    assert done["status"] == "COMPLETED"


def test_scenario_e_retry_keeps_run_history():
    cid, tasks = start("FILL-01", "B")
    complete_physical(cid, tasks)
    client.post(f"/api/changeovers/{cid}/apply-configuration",
                json={"parameters": {"speed_rpm": 120, "temperature_c": 80, "pressure_bar": 3.0}})
    first = client.post(f"/api/changeovers/{cid}/verify").json()
    assert first["passed"] is False and first["run"] == 1
    client.post(f"/api/changeovers/{cid}/apply-configuration", json={"parameters": {"temperature_c": 75}})
    second = client.post(f"/api/changeovers/{cid}/verify").json()
    assert second["passed"] is True and second["run"] == 2
    hist = client.get(f"/api/changeovers/{cid}/verification").json()
    assert [r["run"] for r in hist["runs"]] == [1, 2]
    assert hist["runs"][0]["passed"] is False and hist["runs"][1]["passed"] is True
    assert hist["overall"] == "VERIFIED"
    # every stored check carries id + timestamp; failures carry reasons
    for run in hist["runs"]:
        for c in run["checks"]:
            assert c["id"] and c["at"]
    assert any(c["reason"] for c in hist["runs"][0]["checks"] if c["result"] == "FAIL")


def test_invalid_values_and_ids():
    cid, _ = start("FILL-01", "B")
    bad = client.post(f"/api/changeovers/{cid}/apply-configuration",
                      json={"parameters": {"speed_rpm": "fast"}})
    assert bad.status_code == 422
    out = client.post(f"/api/changeovers/{cid}/apply-configuration",
                      json={"parameters": {"pressure_bar": 99}})
    assert out.status_code == 422
    assert client.post("/api/changeovers/99999/verify").status_code == 404
    assert client.get("/api/changeovers/99999/verification").status_code == 404
    assert client.get("/api/changeovers/99999/simulation").status_code == 404
    assert client.post("/api/changeovers/99999/complete").status_code == 404


def test_repeat_finalize_and_official_untouched_on_reject():
    cid, tasks = start("FILL-02", "B")
    complete_physical(cid, tasks)
    client.post(f"/api/changeovers/{cid}/apply-configuration",
                json={"parameters": {"speed_rpm": 120, "temperature_c": 75, "pressure_bar": 3.0}})
    client.post(f"/api/changeovers/{cid}/verify")
    assert client.post(f"/api/changeovers/{cid}/complete").status_code == 200
    again = client.post(f"/api/changeovers/{cid}/complete")
    assert again.status_code == 400  # no duplicate finalization
    # failed finalize path leaves no new VERIFIED row: count before/after
    cid2, tasks2 = start("FILL-02", "C")
    before = client.get("/api/machines/FILL-02/state").json()
    assert client.post(f"/api/changeovers/{cid2}/complete").status_code == 409
    after = client.get("/api/machines/FILL-02/state").json()
    assert before == after
