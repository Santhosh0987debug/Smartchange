"""Seed data: 3 machines, 3 products, sample SOP documents.

Idempotent: init_db() inserts missing rows and refreshes the demo product
configurations to the spec values below, but never touches user-created
records and never overwrites a machine's live status or current product.
"""
import json

MACHINES = [
    {"id": "FILL-01", "name": "Filling Machine 01", "machine_type": "Filling",
     "line": "Line A", "location": "Hall 1", "status": "Operational", "current_product_id": "A"},
    {"id": "FILL-02", "name": "Filling Machine 02", "machine_type": "Filling",
     "line": "Line A", "location": "Hall 1", "status": "Operational", "current_product_id": "A"},
    {"id": "PACK-01", "name": "Packaging Machine 01", "machine_type": "Packaging",
     "line": "Line B", "location": "Hall 2", "status": "Operational", "current_product_id": "C"},
]
# Backwards compatibility for older imports.
MACHINE = MACHINES[0]

USERS = [
    {"id": "demo-operator", "name": "Demo Operator", "role": "operator"},
    {"id": "supervisor", "name": "Production Supervisor", "role": "supervisor"},
    {"id": "engineer", "name": "Manufacturing Engineer", "role": "engineer"},
]

PRODUCTS = [
    {
        "id": "A", "product_code": "PROD-A", "name": "Product A — Standard 500 ml",
        "description": "Standard 500 ml fill on Line A.",
        "revision": "v2.1",
        "configuration": {
            "components": {"nozzle": "A-Type", "fixture": "500 ml"},
            "parameters": {"speed_rpm": 100, "temperature_c": 70, "pressure_bar": 2.5},
            "ranges": {
                "speed_rpm": [80, 120], "temperature_c": [60, 80], "pressure_bar": [2.0, 3.0],
            },
            "units": {"speed_rpm": "RPM", "temperature_c": "°C", "pressure_bar": "bar"},
            "estimated_changeover_seconds": 720,
        },
    },
    {
        "id": "B", "product_code": "PROD-B", "name": "Product B — Premium 750 ml",
        "description": "Premium 750 ml high-flow fill on Line A.",
        "revision": "v2.1",
        "configuration": {
            "components": {"nozzle": "B-Type", "fixture": "750 ml"},
            "parameters": {"speed_rpm": 120, "temperature_c": 75, "pressure_bar": 3.0},
            "ranges": {
                "speed_rpm": [100, 140], "temperature_c": [65, 85], "pressure_bar": [2.5, 3.5],
            },
            "units": {"speed_rpm": "RPM", "temperature_c": "°C", "pressure_bar": "bar"},
            "estimated_changeover_seconds": 720,
        },
    },
    {
        "id": "C", "product_code": "PROD-C", "name": "Product C — Compact 250 ml",
        "description": "Compact 250 ml fill on Line B.",
        "revision": "v1.4",
        "configuration": {
            "components": {"nozzle": "C-Type", "fixture": "250 ml"},
            "parameters": {"speed_rpm": 90, "temperature_c": 65, "pressure_bar": 2.0},
            "ranges": {
                "speed_rpm": [70, 110], "temperature_c": [55, 75], "pressure_bar": [1.5, 2.5],
            },
            "units": {"speed_rpm": "RPM", "temperature_c": "°C", "pressure_bar": "bar"},
            "estimated_changeover_seconds": 840,
        },
    },
]

DOCUMENTS = [
    {
        "title": "SOP-FILL-001 Changeover Safety Procedure",
        "revision": "v3.0", "approval_status": "Approved", "effective_date": "2026-01-15",
        "content": (
            "Before any nozzle or fixture replacement: stop the line, engage lockout/tagout (LOTO), "
            "verify zero pressure on gauge PG-02, wear heat gloves above 60C. "
            "Nozzle replacement requires torque wrench 25 Nm and food-grade lubricant FG-11. "
            "Fixture replacement for 250/500/750 ml uses quick-release clamps; confirm seating pin clicks. "
            "Never bypass the safety interlock. Contact supervisor if pressure does not vent within 60 seconds."
        ),
    },
    {
        "title": "MAN-FILL-02 Filling Machine Operating Manual (excerpt)",
        "revision": "v5.2", "approval_status": "Approved", "effective_date": "2025-11-01",
        "content": (
            "Operating ranges: speed 80-160 RPM, temperature 60-90 C, pressure 2.0-4.0 bar. "
            "Product A runs at 100 RPM / 70 C / 2.5 bar with A-Type nozzle and 500 ml fixture. "
            "Product B runs at 120 RPM / 75 C / 3.0 bar with B-Type nozzle and 750 ml fixture. "
            "Product C runs at 90 RPM / 65 C / 2.0 bar with C-Type nozzle and 250 ml fixture. "
            "B-Type nozzle has a wider orifice for high-viscosity fill; using A-Type nozzle for Product B "
            "causes underfill and pressure faults. Always purge 3 cycles after temperature change."
        ),
    },
    {
        "title": "TSG-FILL-07 Troubleshooting Guide (excerpt)",
        "revision": "v1.8", "approval_status": "Approved", "effective_date": "2026-03-10",
        "content": (
            "Symptom: verification reports pressure mismatch. Cause: operator entered old recipe value "
            "or gauge not yet stabilized — wait 30 s and re-apply. Symptom: underfill on Product B. "
            "Cause: wrong nozzle (A-Type still installed) or 500 ml fixture still fitted. "
            "Fix: reinstall B-Type nozzle torqued to 25 Nm and 750 ml fixture, then re-verify. "
            "Symptom: temperature fault. Cause: setpoint outside product range. "
            "Always re-run verification after any correction."
        ),
    },
]


def product_config(pid: str) -> dict:
    for p in PRODUCTS:
        if p["id"] == pid:
            return p["configuration"]
    raise KeyError(pid)
