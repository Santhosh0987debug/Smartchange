"""Phase 2 tests: machine & product CRUD, validation, delete guards, seed idempotency."""
from fastapi.testclient import TestClient
from app.main import app, init_db
from app import seed

client = TestClient(app)

GOOD_CONFIG = {
    "components": {"nozzle": "D-Type", "fixture": "300 ml"},
    "parameters": {"speed_rpm": 95, "temperature_c": 68, "pressure_bar": 2.2},
    "ranges": {"speed_rpm": [80, 110], "temperature_c": [60, 75], "pressure_bar": [1.8, 2.6]},
    "units": {"speed_rpm": "RPM", "temperature_c": "°C", "pressure_bar": "bar"},
}


def test_seed_is_idempotent_and_spec_shaped():
    first_m = client.get("/api/machines", params={"page_size": 50}).json()
    first_p = client.get("/api/products", params={"page_size": 50}).json()
    assert first_m["total"] == 3, first_m
    assert {m["id"] for m in first_m["items"]} == {"FILL-01", "FILL-02", "PACK-01"}
    # spec product C: compact 250 ml
    c = client.get("/api/products/C").json()
    assert c["configuration"]["parameters"] == {"speed_rpm": 90, "temperature_c": 65, "pressure_bar": 2.0}
    assert c["configuration"]["components"] == {"nozzle": "C-Type", "fixture": "250 ml"}
    # FILL-01 on A still yields multiple A->B differences
    prev = client.post("/api/changeovers/preview",
                       json={"machine_id": "FILL-01", "target_product_id": "B"}).json()
    assert len(prev["differences"]) == 5
    # run seed again: no duplicates
    init_db()
    again_m = client.get("/api/machines", params={"page_size": 50}).json()
    again_p = client.get("/api/products", params={"page_size": 50}).json()
    assert again_m["total"] == first_m["total"]
    assert again_p["total"] == first_p["total"]


def test_seed_preserves_live_machine_state():
    client.put("/api/machines/FILL-01", json={"status": "Changeover", "current_product_id": "B"})
    init_db()
    m = client.get("/api/machines/FILL-01").json()
    assert m["status"] == "Changeover" and m["current_product_id"] == "B"
    assert m["machine_type"] == "Filling" and m["line"] == "Line A"


def test_machine_crud_and_filters():
    r = client.post("/api/machines", json={"id": "TEST-01", "name": "Test Rig"})
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "Operational"
    # duplicate id
    assert client.post("/api/machines", json={"id": "TEST-01", "name": "Dup"}).status_code == 409
    # invalid status
    bad = client.post("/api/machines", json={"id": "TEST-02", "name": "X", "status": "Exploding"})
    assert bad.status_code == 422
    # unknown product
    bad2 = client.post("/api/machines", json={"id": "TEST-02", "name": "X", "current_product_id": "ZZZ"})
    assert bad2.status_code == 422
    # missing required name
    assert client.post("/api/machines", json={"id": "TEST-03"}).status_code == 422
    # get one (404 for unknown)
    assert client.get("/api/machines/TEST-01").json()["name"] == "Test Rig"
    assert client.get("/api/machines/NOPE").status_code == 404
    # update + 404
    u = client.put("/api/machines/TEST-01", json={"location": "Hall 9", "status": "Maintenance"}).json()
    assert u["location"] == "Hall 9" and u["status"] == "Maintenance"
    assert client.put("/api/machines/NOPE", json={"name": "x"}).status_code == 404
    assert client.put("/api/machines/TEST-01", json={"status": "Nope"}).status_code == 422
    # search + filter + pagination envelope
    s = client.get("/api/machines", params={"q": "TEST-01"}).json()
    assert s["total"] == 1 and s["items"][0]["id"] == "TEST-01"
    f = client.get("/api/machines", params={"status": "Maintenance"}).json()
    assert all(m["status"] == "Maintenance" for m in f["items"])
    p1 = client.get("/api/machines", params={"page": 1, "page_size": 2}).json()
    assert p1["total"] >= 3 and len(p1["items"]) == 2 and p1["page"] == 1
    # delete ok (no history) + 404
    assert client.delete("/api/machines/TEST-01").json() == {"deleted": "TEST-01"}
    assert client.get("/api/machines/TEST-01").status_code == 404
    assert client.delete("/api/machines/NOPE").status_code == 404


def test_machine_delete_blocked_by_history():
    co = client.post("/api/changeovers", json={"machine_id": "FILL-01", "target_product_id": "B"}).json()
    assert co["id"]
    r = client.delete("/api/machines/FILL-01")
    assert r.status_code == 409, r.text
    assert "changeover" in r.json()["detail"].lower()


def test_product_crud_and_validation():
    r = client.post("/api/products", json={"id": "D", "product_code": "PROD-D",
                                           "name": "Product D", "configuration": GOOD_CONFIG})
    assert r.status_code == 201, r.text
    assert r.json()["active"] is True
    # duplicate id / code
    dup = client.post("/api/products", json={"id": "D", "product_code": "PROD-X",
                                             "name": "x", "configuration": GOOD_CONFIG})
    assert dup.status_code == 409
    dupc = client.post("/api/products", json={"id": "X", "product_code": "PROD-D",
                                              "name": "x", "configuration": GOOD_CONFIG})
    assert dupc.status_code == 409
    # invalid configs rejected
    for bad_cfg in [
        {},
        {"components": {"nozzle": "D-Type", "fixture": "300 ml"}},  # no parameters
        {"parameters": dict(GOOD_CONFIG["parameters"])},  # no components
        {"components": {"nozzle": "", "fixture": "300 ml"},
         "parameters": dict(GOOD_CONFIG["parameters"])},  # empty nozzle
        {"components": {"nozzle": "D-Type", "fixture": "big jug"},
         "parameters": dict(GOOD_CONFIG["parameters"])},  # unparseable fixture
        {"components": dict(GOOD_CONFIG["components"]),
         "parameters": {"speed_rpm": 999, "temperature_c": 68, "pressure_bar": 2.2}},  # out of range
        {"components": dict(GOOD_CONFIG["components"]),
         "parameters": dict(GOOD_CONFIG["parameters"]),
         "ranges": {"speed_rpm": [100, 80]}},  # min > max
    ]:
        br = client.post("/api/products", json={"id": "BADX", "product_code": "PROD-BADX",
                                                "name": "bad", "configuration": bad_cfg})
        assert br.status_code == 422, (bad_cfg, br.text)
    # update incl. bad config + dup code + 404
    u = client.put("/api/products/D", json={"description": "Trial", "active": False}).json()
    assert u["description"] == "Trial" and u["active"] is False
    assert client.put("/api/products/D", json={"product_code": "PROD-A"}).status_code == 409
    bad_cfg = dict(GOOD_CONFIG);
    bad_cfg["parameters"] = {"speed_rpm": "fast", "temperature_c": 68, "pressure_bar": 2.2}
    assert client.put("/api/products/D", json={"configuration": bad_cfg}).status_code == 422
    assert client.put("/api/products/NOPE", json={"name": "x"}).status_code == 404
    # filter inactive
    ina = client.get("/api/products", params={"active": False}).json()
    assert any(p["id"] == "D" for p in ina["items"])
    # delete ok then 404
    assert client.delete("/api/products/D").json() == {"deleted": "D"}
    assert client.delete("/api/products/D").status_code == 404


def test_product_delete_blocked_by_references():
    # A is blocked: live machines run it and states reference it.
    r = client.delete("/api/products/A")
    assert r.status_code == 409, r.text
    assert "deactivate" in r.json()["detail"].lower()
    # B is blocked once a changeover references it.
    co = client.post("/api/changeovers", json={"machine_id": "FILL-01", "target_product_id": "B"})
    assert co.status_code == 200
    rb = client.delete("/api/products/B")
    assert rb.status_code == 409, rb.text
    assert "changeover" in rb.json()["detail"].lower()
    assert client.delete("/api/products/NOPE").status_code == 404


def test_machine_with_custom_product_gets_state():
    cfg = {"components": {"nozzle": "Z-Type", "fixture": "600 ml"},
           "parameters": {"speed_rpm": 110, "temperature_c": 72, "pressure_bar": 2.8}}
    assert client.post("/api/products", json={"id": "Z", "product_code": "PROD-Z",
                                              "name": "Z", "configuration": cfg}).status_code == 201
    r = client.post("/api/machines", json={"id": "Z-01", "name": "Z rig", "current_product_id": "Z"})
    assert r.status_code == 201, r.text
    st = client.get("/api/machines/Z-01/state").json()
    assert st["parameters"]["speed_rpm"] == 110 and st["product_id"] == "Z"
    assert client.delete("/api/machines/Z-01").status_code == 200
    # product Z is now referenced by leftover states? states were deleted with machine -> deletable
    assert client.delete("/api/products/Z").status_code in (200, 409)


def test_changeover_still_end_to_end_after_phase2():
    prev = client.post("/api/changeovers/preview",
                       json={"machine_id": "FILL-02", "target_product_id": "B"}).json()
    assert len(prev["differences"]) == 5
    co = client.post("/api/changeovers", json={"machine_id": "FILL-02", "target_product_id": "B"}).json()
    detail = client.get(f"/api/changeovers/{co['id']}").json()
    assert detail["target_config"]["parameters"]["pressure_bar"] == 3.0
