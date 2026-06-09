"""Severity classification rules for PulseHub vitals."""

from __future__ import annotations


def classify(metric: str, value: float) -> str:
    """Return severity: 'normal' | 'warning' | 'critical'."""
    if metric == "glucose":
        if value < 54 or value > 250:
            return "critical"
        if value <= 70 or value > 180:
            return "warning"
        return "normal"
    if metric == "hr":
        if value < 40 or value > 120:
            return "critical"
        if value <= 50 or value > 100:
            return "warning"
        return "normal"
    if metric == "spo2":
        if value < 90:
            return "critical"
        if value < 95:
            return "warning"
        return "normal"
    return "normal"


def risk_level_from_latest(latest_vitals: list[dict]) -> str:
    """
    Given a list of latest vitals (one per metric), return the worst severity
    as the patient's current risk level: 'critical' > 'warning' > 'normal'.
    """
    rank = {"normal": 0, "warning": 1, "critical": 2}
    worst = "normal"
    for v in latest_vitals:
        sev = v.get("severity", "normal")
        if rank.get(sev, 0) > rank[worst]:
            worst = sev
    return worst
