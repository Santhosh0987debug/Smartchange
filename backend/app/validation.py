"""Server-side validation for product setup configurations.

Units are stored consistently: speed in RPM, temperature in °C, pressure in
bar, fixture as a '<ml> ml' string. Anything outside the absolute bounds or
with missing keys is rejected — the API never persists an invalid config.
"""
import re
from typing import Any

REQUIRED_COMPONENTS = ("nozzle", "fixture")
REQUIRED_PARAMETERS = ("speed_rpm", "temperature_c", "pressure_bar")

# Absolute plausibility bounds for this prototype's filling-machine family.
BOUNDS = {
    "speed_rpm": (50.0, 200.0, "RPM"),
    "temperature_c": (20.0, 120.0, "°C"),
    "pressure_bar": (0.5, 6.0, "bar"),
}


def parse_fixture_ml(fixture: Any) -> float | None:
    """Parse e.g. '750 ml' -> 750.0. Returns None when unparseable."""
    if not isinstance(fixture, str):
        return None
    m = re.search(r"(\d+(?:\.\d+)?)\s*ml", fixture.lower())
    return float(m.group(1)) if m else None


def validate_product_configuration(cfg: Any) -> list[str]:
    """Return a list of human-readable errors; empty means valid."""
    errors: list[str] = []
    if not isinstance(cfg, dict):
        return ["Configuration must be a JSON object."]
    components = cfg.get("components")
    parameters = cfg.get("parameters")
    if not isinstance(components, dict):
        errors.append("Configuration requires a 'components' object.")
    else:
        for key in REQUIRED_COMPONENTS:
            val = components.get(key)
            if not isinstance(val, str) or not val.strip():
                errors.append(f"Component '{key}' must be a non-empty string.")
        ml = parse_fixture_ml((components or {}).get("fixture"))
        if isinstance((components or {}).get("fixture"), str) and ml is None:
            errors.append("Fixture must state the container size, e.g. '750 ml'.")
        elif ml is not None and ml <= 0:
            errors.append("Fixture container size must be greater than 0 ml.")
    if not isinstance(parameters, dict):
        errors.append("Configuration requires a 'parameters' object.")
    else:
        for key in REQUIRED_PARAMETERS:
            val = parameters.get(key)
            try:
                num = float(val)  # type: ignore[arg-type]
            except (TypeError, ValueError):
                errors.append(f"Parameter '{key}' must be numeric.")
                continue
            lo, hi, unit = BOUNDS[key]
            if not (lo <= num <= hi):
                errors.append(
                    f"Parameter '{key}' ({num} {unit}) outside plausible range [{lo}, {hi} {unit}].")
    ranges = cfg.get("ranges")
    if ranges is not None:
        if not isinstance(ranges, dict):
            errors.append("'ranges' must be an object mapping parameter to [min, max].")
        else:
            params = parameters if isinstance(parameters, dict) else {}
            for key, bounds in ranges.items():
                if (not isinstance(bounds, (list, tuple)) or len(bounds) != 2):
                    errors.append(f"Range for '{key}' must be [min, max].")
                    continue
                try:
                    lo, hi = float(bounds[0]), float(bounds[1])
                except (TypeError, ValueError):
                    errors.append(f"Range for '{key}' must be numeric [min, max].")
                    continue
                if lo > hi:
                    errors.append(f"Range for '{key}' has min greater than max.")
                target = params.get(key)
                try:
                    t = float(target)  # type: ignore[arg-type]
                    if not (lo <= t <= hi):
                        errors.append(f"Target {key}={t} lies outside its range [{lo}, {hi}].")
                except (TypeError, ValueError):
                    pass
    return errors
