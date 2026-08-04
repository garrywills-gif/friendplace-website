"""
Period-over-period comparison calculator.

Given a current ``value`` and a ``previous_value``, produce a fully-formed
``PeriodComparison`` including delta and direction. Kept as a standalone
helper so query modules never re-implement % arithmetic.
"""

from __future__ import annotations

from .types import Direction, PeriodComparison, TimeRange

_FLAT_TOLERANCE = 1e-9  # values considered equal for direction purposes


def build_comparison(
    *,
    current_value: float,
    previous_value: float,
    previous_time_range: TimeRange,
) -> PeriodComparison:
    """Compute delta / percentage-change / direction."""
    delta_absolute = current_value - previous_value

    if previous_value == 0:
        # Percent change is undefined; encode as ``None`` rather than
        # inventing an "∞%" that George would parrot uncritically.
        delta_pct: float | None = None
        direction = _direction_from(delta_absolute)
    else:
        delta_pct = (delta_absolute / previous_value) * 100.0
        direction = _direction_from(delta_pct)

    return PeriodComparison(
        previous_time_range=previous_time_range,
        previous_value=previous_value,
        delta_absolute=delta_absolute,
        delta_pct=delta_pct,
        direction=direction,
    )


def _direction_from(v: float) -> Direction:
    if abs(v) <= _FLAT_TOLERANCE:
        return Direction.FLAT
    return Direction.UP if v > 0 else Direction.DOWN


__all__ = ["build_comparison"]
