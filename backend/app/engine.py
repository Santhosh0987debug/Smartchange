"""Deterministic difference engine, plan generator, verification. No LLM involved."""
import json
from typing import Dict, Any, List, Tuple

PARAM_LABELS = {"speed_rpm": "Speed", "temperature_c": "Temperature", "pressure_bar": "Pressure"}
PARAM_UNITS = {"speed_rpm": "RPM", "temperature_c": "°C", "pressure_bar": "bar"}
COMPONENT_LABELS = {"nozzle": "Nozzle", "fixture": "Container fixture"}

CATEGORY_COMPONENT = "component_replacement"
CATEGORY_PARAMETER = "parameter_adjustment"
CATEGORY_NONE = "no_change_required"

# Machine statuses that block new changeover plans outright.
BLOCKED_STATUSES = ("Offline", "Fault")
# Statuses that allow planning but raise a warning.
WARNING_STATUSES = ("Maintenance", "Changeover")


def split_config(cfg: dict) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    return cfg.get("components", {}), cfg.get("parameters", {})


def compare_states(source: dict, target: dict) -> List[Dict[str, Any]]:
    """Return ordered list of differences (legacy shape + enrichment).

    Keys: {kind, key, label, source_value, target_value, unit, category,
    change_required, validation}. Kept for backward compatibility; new code
    should prefer compare_full()."""
    out = []
    for c in compare_full(source, {"components": target.get("components", {}),
                                   "parameters": target.get("parameters", {})}):
        if c["change_required"]:
            entry = dict(c)
            entry["source_value"] = c["current_value"]
            out.append(entry)
    return out


def validate_target_value(kind: str, key: str, target_value: Any, target_cfg: dict) -> Tuple[str, str]:
    """Validation status of a target value against the approved product config.

    Returns (status, message) with status 'valid' | 'invalid'. Missing values
    are never assumed correct — they are reported invalid.
    """
    if target_value is None or (isinstance(target_value, str) and not target_value.strip()):
        return ("invalid", f"Target {key} is missing from the approved configuration.")
    if kind == "parameter":
        ranges = (target_cfg.get("ranges") or {})
        if key in ranges:
            try:
                lo, hi = float(ranges[key][0]), float(ranges[key][1])
                tv = float(target_value)  # type: ignore[arg-type]
                if lo <= tv <= hi:
                    return ("valid", f"Within approved range [{lo}, {hi}].")
                return ("invalid", f"Target {tv} outside approved range [{lo}, {hi}].")
            except (TypeError, ValueError, IndexError):
                return ("invalid", f"Target {key} is not numeric.")
        try:
            float(target_value)  # type: ignore[arg-type]
            return ("valid", "Numeric value present (no range configured).")
        except (TypeError, ValueError):
            return ("invalid", f"Target {key} is not numeric.")
    return ("valid", "Component specified in approved configuration.")


def compare_full(source: dict, target_cfg: dict) -> List[Dict[str, Any]]:
    """Compare every known component/parameter, changed or matching.

    Each entry: {kind, key, label, category, current_value, target_value, unit,
    change_required, validation: {status, message}}. Deterministic key order.
    """
    s_comp, s_par = split_config(source or {})
    t_comp, t_par = split_config(target_cfg or {})
    out: List[Dict[str, Any]] = []
    for key in sorted(set(list(s_comp.keys()) + list(t_comp.keys()))):
        sv, tv = s_comp.get(key), t_comp.get(key)
        changed = sv != tv
        status, message = validate_target_value("component", key, tv, target_cfg)
        out.append({"kind": "component", "key": key,
                    "label": COMPONENT_LABELS.get(key, key),
                    "category": CATEGORY_COMPONENT if changed else CATEGORY_NONE,
                    "current_value": sv, "target_value": tv, "unit": "",
                    "change_required": changed,
                    "validation": {"status": status, "message": message}})
    for key in sorted(set(list(s_par.keys()) + list(t_par.keys()))):
        sv, tv = s_par.get(key), t_par.get(key)
        try:
            changed = not (sv is not None and tv is not None
                           and abs(float(sv) - float(tv)) < 1e-9)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            changed = sv != tv
        status, message = validate_target_value("parameter", key, tv, target_cfg)
        out.append({"kind": "parameter", "key": key,
                    "label": PARAM_LABELS.get(key, key),
                    "category": CATEGORY_PARAMETER if changed else CATEGORY_NONE,
                    "current_value": sv, "target_value": tv,
                    "unit": PARAM_UNITS.get(key, ""),
                    "change_required": changed,
                    "validation": {"status": status, "message": message}})
    return out


def check_eligibility(machine_status: str, target_active: bool) -> Tuple[bool, List[str], List[str]]:
    """Machine eligibility for a new changeover plan.

    Returns (eligible, errors, warnings). Offline/Fault and inactive targets
    block planning; Maintenance/Changeover warn but allow it.
    """
    errors: List[str] = []
    warnings: List[str] = []
    if machine_status in BLOCKED_STATUSES:
        errors.append(f"Machine is '{machine_status}' — changeover planning is blocked.")
    elif machine_status in WARNING_STATUSES:
        warnings.append(f"Machine is '{machine_status}' — confirm it is safe before starting.")
    if not target_active:
        errors.append("Target product is inactive — activate it before planning.")
    return (len(errors) == 0, errors, warnings)


SAFETY_NOTE_LOTO = "LOTO required: stop line, verify zero pressure on PG-02, heat gloves above 60°C. See SOP-FILL-001 v3.0."
SAFETY_NOTE_NOZZLE = "Torque 25 Nm, lubricant FG-11, never bypass interlock. See SOP-FILL-001 v3.0."
SAFETY_NOTE_PARAM = "Confirm value inside approved product range before applying. See MAN-FILL-02 v5.2."


def generate_plan(diffs: List[Dict[str, Any]], source: dict | None = None,
                  target: dict | None = None) -> List[Dict[str, Any]]:
    """Deterministic ordered task list with prerequisites. Never invents new procedures.

    Each task: {step_id, sequence_number, task_type, category, description,
    instructions, component, parameter, current_value, target_value,
    prerequisites, safety_notes, verification_criteria, requires_confirmation,
    expected_duration_seconds (estimate), status}.
    Empty diffs -> empty plan (caller reports "No change required").
    """
    tasks: List[Dict[str, Any]] = []
    if not diffs:
        return tasks
    seq = 1
    s_comp, s_par = split_config(source or {})

    def current_of(kind, key):
        return (s_comp if kind == "component" else s_par).get(key)

    def add(task_type, category, title, instructions, component=None, parameter=None,
            current_value=None, target_value=None, prereqs=None, safety="",
            criteria="", requires_confirmation=True, duration=120):
        nonlocal seq
        tasks.append({"step_id": f"S{seq:02d}", "sequence_number": seq,
                      "task_type": task_type, "category": category,
                      "description": title, "instructions": instructions,
                      "component": component, "parameter": parameter,
                      "current_value": None if current_value is None else str(current_value),
                      "target_value": None if target_value is None else str(target_value),
                      "prerequisites": prereqs or [], "safety_notes": safety,
                      "verification_criteria": criteria,
                      "requires_confirmation": requires_confirmation,
                      "expected_duration_seconds": duration, "status": "PENDING"})
        seq += 1

    comp_diffs = {d["key"]: d for d in diffs if d["kind"] == "component"}
    # Canonical process order (speed, temperature, pressure), then any extras alphabetically.
    param_order = ["speed_rpm", "temperature_c", "pressure_bar"]
    param_diffs = sorted(
        [d for d in diffs if d["kind"] == "parameter"],
        key=lambda d: (param_order.index(d["key"]) if d["key"] in param_order else len(param_order),
                       d["key"]))

    # 1. Simulated stop / safe-state confirmation before any change task.
    add("physical", "safety", "Lockout/tagout: stop line and verify zero pressure",
        "Stop the line, engage lockout/tagout and confirm gauge PG-02 reads zero before touching any component.",
        None, None, None, None, [], SAFETY_NOTE_LOTO,
        "Zero pressure confirmed and LOTO engaged.", True, 120)
    safety_seq = 1
    # 2-3. Component replacements before parameter adjustments.
    if "nozzle" in comp_diffs:
        d = comp_diffs["nozzle"]
        add("physical", CATEGORY_COMPONENT, f"Replace nozzle with {d['target_value']} (torque 25 Nm)",
            f"Remove the {current_of('component', 'nozzle')} nozzle, fit the {d['target_value']} nozzle "
            "with food-grade lubricant FG-11 torqued to 25 Nm.",
            "nozzle", None, current_of("component", "nozzle"), d["target_value"],
            [safety_seq], SAFETY_NOTE_NOZZLE,
            f"Nozzle recorded as installed: {d['target_value']}.", True, 300)
    if "fixture" in comp_diffs:
        d = comp_diffs["fixture"]
        add("physical", CATEGORY_COMPONENT,
            f"Replace container fixture with {d['target_value']} (confirm seating pin clicks)",
            f"Swap the {current_of('component', 'fixture')} fixture for the {d['target_value']} fixture "
            "using the quick-release clamps.",
            "fixture", None, current_of("component", "fixture"), d["target_value"],
            [safety_seq], SAFETY_NOTE_LOTO,
            f"Fixture recorded as installed: {d['target_value']}.", True, 240)
    # 4+. Parameter adjustments depend on safety + component swaps.
    phys_seqs = [t["sequence_number"] for t in tasks if t["sequence_number"] != safety_seq]
    for d in param_diffs:
        unit = f" {d['unit']}" if d["unit"] else ""
        add("configuration", CATEGORY_PARAMETER,
            f"Set {d['label']} to {d['target_value']}{unit}",
            f"Enter {d['target_value']}{unit} for {d['label']} in the simulated controller, "
            "then apply the configuration.",
            None, d["key"], current_of("parameter", d["key"]), d["target_value"],
            [safety_seq] + phys_seqs, SAFETY_NOTE_PARAM,
            f"{d['key']} reads {d['target_value']}{unit}.", False, 90)
    # Final configuration verification depends on everything.
    all_prev = [t["sequence_number"] for t in tasks]
    add("verification", "verification",
        "Run final verification: components, parameters, mandatory tasks",
        "Run verification and resolve every mismatch before completing the changeover.",
        None, None, None, None, all_prev,
        "Do not mark READY until verification passes.",
        "All component, parameter and mandatory-task checks PASS.", True, 120)
    return tasks


def validate_parameters(target_cfg: dict, requested: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """Check requested params against target ranges. Returns (ok, errors)."""
    ranges = target_cfg.get("ranges", {})
    params = target_cfg.get("parameters", {})
    errors = []
    for k, v in requested.items():
        if k not in params:
            errors.append(f"Unknown parameter '{k}'.")
            continue
        try:
            fv = float(v)
        except (TypeError, ValueError):
            errors.append(f"Invalid numeric value for {PARAM_LABELS.get(k, k)}: {v!r}.")
            continue
        if k in ranges:
            lo, hi = ranges[k]
            if not (lo <= fv <= hi):
                errors.append(
                    f"{PARAM_LABELS.get(k, k)} {fv} out of approved range [{lo}, {hi}].")
    return (len(errors) == 0, errors)


def verify_state(target_cfg: dict, components: Dict[str, Any], parameters: Dict[str, Any],
                 tasks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Deterministic verification. Each check: {check_name, expected_value,
    actual_value, result, reason}.

    Discrete values (e.g. nozzle type) require exact matches. Numerics compare
    exactly — no silent rounding. Missing values are failures, never assumed.
    """
    checks: List[Dict[str, Any]] = []
    t_comp, t_par = split_config(target_cfg)
    for k, tv in t_comp.items():
        av = components.get(k)
        if av is None:
            checks.append({"check_name": f"component:{k}", "expected_value": str(tv),
                           "actual_value": None, "result": "FAIL",
                           "reason": f"No value recorded for component '{k}'."})
        elif av == tv:
            checks.append({"check_name": f"component:{k}", "expected_value": str(tv),
                           "actual_value": str(av), "result": "PASS", "reason": None})
        else:
            checks.append({"check_name": f"component:{k}", "expected_value": str(tv),
                           "actual_value": str(av), "result": "FAIL",
                           "reason": f"Expected {k}={tv}, found {av}. Complete the replacement step."})
    for k, tv in t_par.items():
        av = parameters.get(k)
        if av is None:
            checks.append({"check_name": f"parameter:{k}", "expected_value": str(tv),
                           "actual_value": None, "result": "FAIL",
                           "reason": f"No value recorded for parameter '{k}'."})
            continue
        try:
            same = abs(float(av) - float(tv)) < 1e-9
            numeric = True
        except (TypeError, ValueError):
            same, numeric = False, False
        if same:
            checks.append({"check_name": f"parameter:{k}", "expected_value": str(tv),
                           "actual_value": str(av), "result": "PASS", "reason": None})
        elif not numeric:
            checks.append({"check_name": f"parameter:{k}", "expected_value": str(tv),
                           "actual_value": str(av), "result": "FAIL",
                           "reason": f"Invalid (non-numeric) value for '{k}': {av!r}."})
        else:
            checks.append({"check_name": f"parameter:{k}", "expected_value": str(tv),
                           "actual_value": str(av), "result": "FAIL",
                           "reason": f"Expected {k}={tv}, found {av}. Apply the correct value."})
    mandatory = [t for t in tasks if t["task_type"] in ("physical", "configuration")]
    incomplete = [t for t in mandatory if t.get("status") != "COMPLETED"]
    if not incomplete:
        checks.append({"check_name": "tasks:mandatory_completed",
                       "expected_value": f"{len(mandatory)} completed",
                       "actual_value": f"{len(mandatory)} completed",
                       "result": "PASS", "reason": None})
    else:
        seqs = sorted(t.get("sequence_number") for t in incomplete)
        checks.append({"check_name": "tasks:mandatory_completed",
                       "expected_value": f"{len(mandatory)} completed",
                       "actual_value": f"{len(mandatory) - len(incomplete)} completed",
                       "result": "FAIL",
                       "reason": f"Mandatory steps incomplete: {seqs}. Operator confirmation missing."})
    return checks
