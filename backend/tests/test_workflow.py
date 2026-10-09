from fastapi.testclient import TestClient
from app.main import app
import os

# use temp db for tests
os.environ["DATABASE_URL"] = "sqlite:///./test_smart.db"

client = TestClient(app)


def test_demo_a_to_b_with_correction():
    # machines + state
    r = client.get("/api/machines")
    assert r.status_code == 200 and len(r.json()) >= 1
    mid = "FILL-01"
    st = client.get(f"/api/machines/{mid}/state").json()
    assert st["product_id"] == "A"
    assert st["parameters"]["pressure_bar"] == 2.5

    # preview B
    prev = client.post("/api/changeovers/preview",
                       json={"machine_id": mid, "target_product_id": "B"}).json()
    assert len(prev["differences"]) == 5, prev["differences"]
    assert len(prev["tasks"]) >= 6

    # create
    co = client.post("/api/changeovers",
                     json={"machine_id": mid, "target_product_id": "B"}).json()
    cid = co["id"]
    tasks = {t["sequence_number"]: t for t in co["tasks"]}

    # prerequisite enforcement: completing a param task before safety must fail
    param_task = next(t for t in co["tasks"] if t["task_type"] == "configuration")
    bad = client.patch(f"/api/changeovers/{cid}/tasks/{param_task['id']}",
                       json={"status": "COMPLETED"})
    assert bad.status_code == 409

    # complete safety + physical tasks (start each step before completing it)
    def start_and_complete(tid):
        rs = client.patch(f"/api/changeovers/{cid}/tasks/{tid}", json={"status": "IN_PROGRESS"})
        assert rs.status_code == 200, rs.text
        rc = client.patch(f"/api/changeovers/{cid}/tasks/{tid}", json={"status": "COMPLETED"})
        assert rc.status_code == 200, rc.text
        return rc.json()

    for t in sorted(co["tasks"], key=lambda x: x["sequence_number"]):
        if t["task_type"] == "physical":
            # complete its prereqs first (safety)
            for p in t["prerequisites"]:
                pt = tasks[p]
                if pt["status"] != "COMPLETED":
                    tasks[p] = start_and_complete(pt["id"])
            tasks[t["sequence_number"]] = start_and_complete(t["id"])

    # apply WRONG pressure -> verification must fail
    ap = client.post(f"/api/changeovers/{cid}/apply-configuration",
                     json={"parameters": {"speed_rpm": 120, "temperature_c": 75, "pressure_bar": 2.5}})
    assert ap.status_code == 200
    ver = client.post(f"/api/changeovers/{cid}/verify").json()
    assert ver["passed"] is False
    assert any("pressure" in g.lower() for g in ver["guidance"]), ver

    # complete must be blocked
    bad_done = client.post(f"/api/changeovers/{cid}/complete")
    assert bad_done.status_code == 409

    # correct pressure + verify + complete
    ap2 = client.post(f"/api/changeovers/{cid}/apply-configuration",
                      json={"parameters": {"pressure_bar": 3.0}})
    assert ap2.status_code == 200
    ver2 = client.post(f"/api/changeovers/{cid}/verify").json()
    assert ver2["passed"] is True, ver2
    done = client.post(f"/api/changeovers/{cid}/complete").json()
    assert done["status"] == "COMPLETED" and done["ready"] is True

    # next changeover starts from B
    st2 = client.get(f"/api/machines/{mid}/state").json()
    assert st2["product_id"] == "B"
    assert st2["parameters"]["pressure_bar"] == 3.0


def test_assistant_grounded_and_abstains():
    ok = client.post("/api/assistant/query", json={"question": "Which nozzle does Product B need?"}).json()
    assert ok["grounded"] is True and len(ok["sources"]) > 0
    no = client.post("/api/assistant/query",
                     json={"question": "What is the CEO's favorite color and stock tip?"}).json()
    assert no["grounded"] is False
