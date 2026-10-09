"""Phase 3 tests: difference engine, eligibility, plan generation, preview/create semantics."""
import json
from fastapi.testclient import TestClient
from app.main import app
from app.engine import compare_full, generate_plan, check_eligibility

client = TestClient(app)

A_CFG = {"components": {"nozzle": "A-Type", "fixture": "500 ml"},
         "parameters": {"speed_rpm": 100, "temperature_c": 70, "pressure_bar": 2.5}}
B_CFG = {"components": {"nozzle": "B-Type", "fixture": "750 ml"},
         "parameters": {"speed_rpm": 120, "temperature_c": 75, "pressure_bar": 3.0},
         "ranges": {"speed_rpm": [100, 140], "temperature_c": [65, 85], "pressure_bar": [2.5, 3.5]}}


def test_engine_five_param_demo():
    comp = compare_full(A_CFG, B_CFG)
    assert len(comp) == 5
    assert all(c["change_required"] for c in comp)
    cats = sorted(c["category"] for c in comp)
    assert cats == ["component_replacement"] * 2 + ["parameter_adjustment"] * 3
    assert all(c["validation"]["status"] == "valid" for c in comp)
    keys = [(c["kind"], c["key"]) for c in comp]
    assert keys == sorted(keys), "deterministic key order"


def test_engine_single_and_no_change():
    one = {"components": dict(A_CFG["components"]),
           "parameters": dict(A_CFG["parameters"], speed_rpm=120)}
    comp = compare_full(A_CFG, one)
    changed = [c for c in comp if c["change_required"]]
    assert len(comp) == 5 and len(changed) == 1 and changed[0]["key"] == "speed_rpm"
    same = compare_full(A_CFG, A_CFG)
    assert len(same) == 5 and not any(c["change_required"] for c in same)
    assert generate_plan([], A_CFG, A_CFG) == []


def test_engine_eligibility():
    ok, errs, warns = check_eligibility("Operational", True)
    assert ok and not errs and not warns
    ok, errs, warns = check_eligibility("Offline", True)
    assert not ok and errs and not warns
    ok, errs, warns = check_eligibility("Fault", True)
    assert not ok and errs
    ok, errs, warns = check_eligibility("Maintenance", True)
    assert ok and not errs and warns
    ok, errs, warns = check_eligibility("Operational", False)
    assert not ok and errs


def test_preview_demo_scenario():
    pv = client.post("/api/changeovers/preview",
                     json={"machine_id": "FILL-01", "target_product_id": "B"}).json()
    assert pv["change_count"] == 5
    assert len(pv["differences"]) == 5
    assert len(pv["comparison"]) == 5  # all params, changed or matching
    assert pv["no_change_required"] is False
    assert pv["estimated_duration_seconds"] == 1050  # 120+300+240+90*3+120
    assert "not measured" in pv["duration_estimate_note"]
    assert pv["eligibility"] == {"eligible": True, "errors": [], "warnings": []}
    assert pv["machine"]["id"] == "FILL-01" and pv["target_product"]["id"] == "B"
    assert pv["current_config"]["parameters"]["speed_rpm"] == 100
    assert pv["target_config"]["parameters"]["speed_rpm"] == 120
    seqs = [t["sequence_number"] for t in pv["tasks"]]
    assert seqs == [1, 2, 3, 4, 5, 6, 7]
    assert [t["step_id"] for t in pv["tasks"]] == ["S01", "S02", "S03", "S04", "S05", "S06", "S07"]
    kinds = [(t["task_type"], t["category"]) for t in pv["tasks"]]
    assert kinds[0] == ("physical", "safety")
    assert kinds[1][1] == "component_replacement" and kinds[2][1] == "component_replacement"
    assert all(k[1] == "parameter_adjustment" for k in kinds[3:6])
    assert kinds[6] == ("verification", "verification")
    # safety first, components before parameters, verification last with full prereqs
    assert pv["tasks"][0]["prerequisites"] == []
    assert pv["tasks"][6]["prerequisites"] == [1, 2, 3, 4, 5, 6]
    assert pv["tasks"][1]["current_value"] == "A-Type"
    assert pv["tasks"][3]["current_value"] == "100"
    assert all(t["verification_criteria"] for t in pv["tasks"])
    assert pv["tasks"][0]["requires_confirmation"] is True
    assert pv["tasks"][3]["requires_confirmation"] is False
    # determinism: same inputs -> same plan
    pv2 = client.post("/api/changeovers/preview",
                      json={"machine_id": "FILL-01", "target_product_id": "B"}).json()
    assert pv["tasks"] == pv2["tasks"]


def test_preview_single_change_and_no_change():
    client.post("/api/products", json={"id": "S1", "product_code": "PROD-S1", "name": "Speed trial",
                                       "configuration": {
                                           "components": dict(A_CFG["components"]),
                                           "parameters": dict(A_CFG["parameters"], speed_rpm=110)}})
    pv = client.post("/api/changeovers/preview",
                     json={"machine_id": "FILL-01", "target_product_id": "S1"}).json()
    assert pv["change_count"] == 1
    assert [t["category"] for t in pv["tasks"]] == ["safety", "parameter_adjustment", "verification"]
    no = client.post("/api/changeovers/preview",
                     json={"machine_id": "FILL-01", "target_product_id": "A"}).json()
    assert no["no_change_required"] is True and no["tasks"] == [] and no["change_count"] == 0
    assert no["estimated_duration_seconds"] == 0
    # empty plan still completes honestly (state already matches)
    co = client.post("/api/changeovers", json={"machine_id": "FILL-01", "target_product_id": "A"}).json()
    assert co["tasks"] == []
    assert client.post(f"/api/changeovers/{co['id']}/verify").json()["passed"] is True
    done = client.post(f"/api/changeovers/{co['id']}/complete").json()
    assert done["status"] == "COMPLETED"


def test_preview_missing_and_invalid():
    assert client.post("/api/changeovers/preview",
                       json={"machine_id": "NOPE", "target_product_id": "B"}).status_code == 404
    assert client.post("/api/changeovers/preview",
                       json={"machine_id": "FILL-01", "target_product_id": "NOPE"}).status_code == 404
    client.post("/api/machines", json={"id": "EMPTY-01", "name": "No state yet"})
    r = client.post("/api/changeovers/preview",
                    json={"machine_id": "EMPTY-01", "target_product_id": "A"})
    assert r.status_code == 404  # missing current configuration is never assumed correct


def test_eligibility_blocks_and_warns():
    client.put("/api/machines/FILL-02", json={"status": "Offline"})
    pv = client.post("/api/changeovers/preview",
                     json={"machine_id": "FILL-02", "target_product_id": "B"}).json()
    assert pv["eligibility"]["eligible"] is False and pv["eligibility"]["errors"]
    bad = client.post("/api/changeovers", json={"machine_id": "FILL-02", "target_product_id": "B"})
    assert bad.status_code == 422
    client.put("/api/machines/FILL-02", json={"status": "Maintenance"})
    pv2 = client.post("/api/changeovers/preview",
                      json={"machine_id": "FILL-02", "target_product_id": "B"}).json()
    assert pv2["eligibility"]["eligible"] is True and pv2["eligibility"]["warnings"]
    ok = client.post("/api/changeovers", json={"machine_id": "FILL-02", "target_product_id": "B"})
    assert ok.status_code == 200
    client.put("/api/products/B", json={"active": False})
    pv3 = client.post("/api/changeovers/preview",
                      json={"machine_id": "FILL-01", "target_product_id": "B"}).json()
    assert pv3["eligibility"]["eligible"] is False
    assert client.post("/api/changeovers",
                       json={"machine_id": "FILL-01", "target_product_id": "B"}).status_code == 422


def test_preview_does_not_mutate():
    before_co = client.get("/api/analytics/changeovers").json()["items"]
    before_st = client.get("/api/machines/FILL-01/state").json()
    before_m = client.get("/api/machines/FILL-01").json()
    for _ in range(3):
        client.post("/api/changeovers/preview", json={"machine_id": "FILL-01", "target_product_id": "B"})
    after_co = client.get("/api/analytics/changeovers").json()["items"]
    after_st = client.get("/api/machines/FILL-01/state").json()
    after_m = client.get("/api/machines/FILL-01").json()
    assert len(before_co) == len(after_co)
    assert before_st == after_st
    assert before_m["status"] == after_m["status"]
    assert before_m["configuration_version"] == after_m["configuration_version"]


def test_create_persists_previewed_steps():
    pv = client.post("/api/changeovers/preview",
                     json={"machine_id": "FILL-01", "target_product_id": "B"}).json()
    co = client.post("/api/changeovers", json={"machine_id": "FILL-01", "target_product_id": "B"}).json()
    detail = client.get(f"/api/changeovers/{co['id']}").json()
    assert len(detail["tasks"]) == len(pv["tasks"]) == 7
    for pt, st in zip(pv["tasks"], detail["tasks"]):
        assert st["step_id"] == pt["step_id"]
        assert st["sequence_number"] == pt["sequence_number"]
        assert st["current_value"] == pt["current_value"]
        assert st["verification_criteria"] == pt["verification_criteria"]
        assert st["status"] == "PENDING"


def test_task_status_flow():
    co = client.post("/api/changeovers", json={"machine_id": "FILL-01", "target_product_id": "B"}).json()
    tasks = {t["sequence_number"]: t for t in co["tasks"]}
    # invalid status rejected
    bad = client.patch(f"/api/changeovers/{co['id']}/tasks/{tasks[1]['id']}",
                       json={"status": "DONE"})
    assert bad.status_code == 400
    # IN_PROGRESS allowed but prerequisites still enforced
    param = next(t for t in co["tasks"] if t["task_type"] == "configuration")
    assert client.patch(f"/api/changeovers/{co['id']}/tasks/{param['id']}",
                        json={"status": "IN_PROGRESS"}).status_code == 409
    ok = client.patch(f"/api/changeovers/{co['id']}/tasks/{tasks[1]['id']}",
                      json={"status": "IN_PROGRESS"}).json()
    assert ok["status"] == "IN_PROGRESS"
    # FAILED is recordable (reason required) and blocks completion
    noreason = client.patch(f"/api/changeovers/{co['id']}/tasks/{tasks[1]['id']}", json={"status": "FAILED"})
    assert noreason.status_code == 422
    direct = client.patch(f"/api/changeovers/{co['id']}/tasks/{tasks[2]['id']}",
                          json={"status": "COMPLETED"})
    assert direct.status_code == 409  # must be started before completing
    fail = client.patch(f"/api/changeovers/{co['id']}/tasks/{tasks[1]['id']}",
                        json={"status": "FAILED", "reason": "Gauge would not vent"}).json()
    blocked = client.post(f"/api/changeovers/{co['id']}/complete")
    assert blocked.status_code == 409
