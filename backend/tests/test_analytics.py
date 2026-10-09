"""Phase 7 tests: KPIs, filters, history, CSV export, post-edit history."""
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def start(mid, target, operator="demo-operator"):
    co = client.post("/api/changeovers",
                     json={"machine_id": mid, "target_product_id": target, "operator_id": operator}).json()
    return co["id"], {t["sequence_number"]: t for t in co["tasks"]}


def do(cid, tid):
    assert client.post(f"/api/changeovers/{cid}/steps/{tid}/start", json={}).status_code == 200
    r = client.post(f"/api/changeovers/{cid}/steps/{tid}/complete", json={})
    assert r.status_code == 200, r.text


def finish_physical(cid, tasks):
    for seq in sorted(tasks):
        t = tasks[seq]
        if t["task_type"] == "physical":
            for p in t["prerequisites"]:
                if tasks[p]["status"] != "COMPLETED":
                    do(cid, tasks[p]["id"])
                    tasks[p]["status"] = "COMPLETED"
            do(cid, t["id"])
            tasks[seq]["status"] = "COMPLETED"


def test_empty_database_metrics():
    ov = client.get("/api/analytics/overview").json()
    assert ov["kpis"]["total_changeovers"] == 0
    assert ov["kpis"]["success_rate"] == 0.0
    assert ov["kpis"]["avg_duration_seconds"] is None
    assert ov["kpis"]["avg_changes"] is None
    assert ov["kpis"]["verification_pass_rate"] == 0.0
    assert ov["definitions"]["success_rate"]
    assert client.get("/api/analytics/changeovers-over-time").json() == []
    assert client.get("/api/analytics/machine-performance").json() == []
    v = client.get("/api/analytics/verification").json()
    assert v == {"pass": 0, "fail": 0, "total": 0, "pass_rate": 0.0, "runs": 0, "by_check": []}
    assert client.get("/api/analytics/common-changes").json() == {"parameters": [], "components": []}
    assert client.get("/api/analytics/issues").json()["total"] == 0
    h = client.get("/api/analytics/changeovers").json()
    assert h == {"items": [], "total": 0, "page": 1, "page_size": 20}
    csv = client.get("/api/reports/changeovers").text
    assert csv.splitlines()[0].startswith("id,machine_id,source_product")


def test_kpis_rates_and_breakdowns():
    cid, tasks = start("FILL-01", "B")
    finish_physical(cid, tasks)
    client.post(f"/api/changeovers/{cid}/apply-configuration",
                json={"parameters": {"speed_rpm": 120, "temperature_c": 75, "pressure_bar": 3.0}})
    assert client.post(f"/api/changeovers/{cid}/verify").json()["passed"] is True
    done = client.post(f"/api/changeovers/{cid}/complete").json()
    assert done["status"] == "COMPLETED"
    # a failed one: physical done, params untouched
    cid2, tasks2 = start("FILL-02", "B")
    finish_physical(cid2, tasks2)
    assert client.post(f"/api/changeovers/{cid2}/verify").json()["passed"] is False
    assert client.post(f"/api/changeovers/{cid2}/complete").status_code == 409
    client.post(f"/api/changeovers/{cid2}/issues", json={"severity": "major", "description": "Demo issue"})

    ov = client.get("/api/analytics/overview").json()["kpis"]
    assert ov["total_changeovers"] == 2
    assert ov["completed_changeovers"] == 1 and ov["failed_changeovers"] == 1
    assert ov["success_rate"] == 50.0
    assert ov["avg_duration_seconds"] == done["actual_duration_seconds"]
    assert ov["avg_changes"] == 7.0
    assert ov["open_issues"] == 1 and ov["resolved_issues"] == 0
    ver = client.get("/api/analytics/verification").json()
    assert ver["pass"] + ver["fail"] == ver["total"] > 0
    assert ver["pass_rate"] == round(ver["pass"] / ver["total"] * 100, 1)
    assert ov["verification_pass_rate"] == ver["pass_rate"]
    assert ov["verification_runs"] == ver["runs"] >= 2
    assert any(b["check"] == "parameter:pressure_bar" for b in ver["by_check"])

    cc = client.get("/api/analytics/common-changes").json()
    assert {p["parameter"] for p in cc["parameters"]} == {"speed_rpm", "temperature_c", "pressure_bar"}
    assert {c["component"] for c in cc["components"]} == {"nozzle", "fixture"}

    mp = client.get("/api/analytics/machine-performance").json()
    by_id = {m["machine_id"]: m for m in mp}
    assert by_id["FILL-01"]["completed"] == 1 and by_id["FILL-02"]["failed"] == 1
    assert by_id["FILL-01"]["avg_seconds"] == done["actual_duration_seconds"]
    assert by_id["FILL-02"]["avg_seconds"] is None

    ot = client.get("/api/analytics/changeovers-over-time").json()
    assert sum(b["total"] for b in ot) == 2
    assert sum(b["completed"] for b in ot) == 1 and sum(b["failed"] for b in ot) == 1

    iss = client.get("/api/analytics/issues").json()
    assert iss["open"] == 1 and iss["total"] == 1
    assert any(c["category"] == "general" and c["open"] == 1 for c in iss["by_category"])
    assert any(s["severity"] == "major" for s in iss["by_severity"])

    dc = client.get("/api/analytics/duration-comparison").json()
    assert len(dc["items"]) == 1 and dc["items"][0]["actual_seconds"] == done["actual_duration_seconds"]
    assert dc["items"][0]["estimated_seconds"] == 1050
    assert "not measured" not in dc["note"] and "Estimated" in dc["note"]


def test_filters_and_validation():
    cid, _ = start("FILL-01", "B")
    assert client.get("/api/analytics/overview", params={"machine_id": "FILL-02"}).json()["kpis"]["total_changeovers"] == 0
    assert client.get("/api/analytics/overview", params={"machine_id": "FILL-01"}).json()["kpis"]["total_changeovers"] == 1
    assert client.get("/api/analytics/overview", params={"product_id": "B"}).json()["kpis"]["total_changeovers"] == 1
    assert client.get("/api/analytics/overview", params={"product_id": "C"}).json()["kpis"]["total_changeovers"] == 0
    assert client.get("/api/analytics/overview", params={"date_from": "2999-01-01"}).json()["kpis"]["total_changeovers"] == 0
    assert client.get("/api/analytics/overview", params={"date_from": "2020-01-01", "date_to": "2999-01-01"}).json()["kpis"]["total_changeovers"] == 1
    bad = client.get("/api/analytics/overview", params={"date_from": "2026-05-01", "date_to": "2026-01-01"})
    assert bad.status_code == 422
    assert client.get("/api/analytics/overview", params={"date_from": "not-a-date"}).status_code == 422
    assert client.get("/api/analytics/changeovers", params={"sort": "bogus"}).status_code == 422
    hist = client.get("/api/analytics/changeovers", params={"status": "IN_PROGRESS"}).json()
    assert hist["total"] == 1 and all(r["status"] == "IN_PROGRESS" for r in hist["items"])
    assert client.get("/api/analytics/changeovers", params={"machine_id": "FILL-02"}).json()["total"] == 0


def test_history_rows_sorting_search_pagination():
    start("FILL-01", "B")
    start("FILL-02", "C")
    h = client.get("/api/analytics/changeovers", params={"page_size": 1}).json()
    assert h["total"] == 2 and len(h["items"]) == 1
    desc = client.get("/api/analytics/changeovers", params={"sort": "-id"}).json()["items"]
    asc = client.get("/api/analytics/changeovers", params={"sort": "id"}).json()["items"]
    assert desc[0]["id"] > desc[-1]["id"] and asc[0]["id"] < asc[-1]["id"]
    q = client.get("/api/analytics/changeovers", params={"q": "FILL-02"}).json()
    assert q["total"] == 1 and q["items"][0]["machine_id"] == "FILL-02"
    row = client.get("/api/analytics/changeovers", params={"machine_id": "FILL-01"}).json()["items"][0]
    assert row["changes"] == 7 and row["verification"] == "NOT_RUN" and row["issues_open"] == 0
    assert row["simulated"] is False and set(row) >= {"id", "source", "target", "started_at", "baseline_duration_seconds"}


def test_csv_export_and_formula_guard():
    assert client.post("/api/machines", json={"id": "=EVIL", "name": "Tricky",
                                              "current_product_id": "A"}).status_code == 201
    cid, _ = start("=EVIL", "B", operator="+cmd")
    csv = client.get("/api/reports/changeovers").text
    lines = csv.splitlines()
    assert lines[0] == ("id,machine_id,source_product,target_product,status,operator,started_at,"
                        "completed_at,actual_duration_seconds,baseline_duration_seconds,"
                        "planned_changes,verification_outcome")
    assert len(lines) == 2
    assert "'=EVIL" in csv and "'+cmd" in csv
    assert "\n=EVIL" not in csv.replace("'=EVIL", "")
    scoped = client.get("/api/reports/changeovers", params={"machine_id": "FILL-01"}).text
    assert "=EVIL" not in scoped.replace("'=EVIL", "")
    summ = client.get("/api/reports/summary").text
    assert summ.splitlines()[0] == "metric,value" and "total_changeovers,1" in summ


def test_history_survives_edits():
    cid, _ = start("FILL-01", "B")
    client.put("/api/products/B", json={"name": "Product B — Renamed"})
    client.put("/api/machines/FILL-01", json={"name": "Filler One Renamed"})
    row = client.get("/api/analytics/changeovers", params={"machine_id": "FILL-01"}).json()["items"][0]
    assert row["source"] == "A" and row["target"] == "B"
    detail = client.get(f"/api/changeovers/{cid}").json()
    assert detail["target_config"]["parameters"]["pressure_bar"] == 3.0
    assert len(detail["tasks"]) == 7
