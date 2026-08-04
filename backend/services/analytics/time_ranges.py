"""
Named time ranges + automatic previous-period pairing.

All windows are UTC. ``start`` is inclusive and ``end`` is exclusive so
adjacent windows tile perfectly (yesterday.end == today.start).
"""

from __future__ import annotations

from calendar import monthrange
from datetime import datetime, timedelta, timezone
from enum import Enum

from .types import TimeRange


class NamedRange(str, Enum):
    """Named ranges George / dashboards can request."""

    TODAY = "today"
    YESTERDAY = "yesterday"
    THIS_WEEK = "this_week"
    LAST_WEEK = "last_week"
    THIS_MONTH = "this_month"
    LAST_MONTH = "last_month"
    THIS_QUARTER = "this_quarter"
    LAST_QUARTER = "last_quarter"
    ALL_TIME = "all_time"


LABELS: dict[NamedRange, str] = {
    NamedRange.TODAY: "Today",
    NamedRange.YESTERDAY: "Yesterday",
    NamedRange.THIS_WEEK: "This week",
    NamedRange.LAST_WEEK: "Last week",
    NamedRange.THIS_MONTH: "This month",
    NamedRange.LAST_MONTH: "Last month",
    NamedRange.THIS_QUARTER: "This quarter",
    NamedRange.LAST_QUARTER: "Last quarter",
    NamedRange.ALL_TIME: "All-time",
}


# ---------------------------------------------------------------------------
# Range builders
# ---------------------------------------------------------------------------


def _start_of_day(dt: datetime) -> datetime:
    return dt.replace(hour=0, minute=0, second=0, microsecond=0)


def _start_of_week(dt: datetime) -> datetime:
    """Monday 00:00 UTC of the week containing ``dt``."""
    d = _start_of_day(dt)
    return d - timedelta(days=d.weekday())


def _start_of_month(dt: datetime) -> datetime:
    return _start_of_day(dt).replace(day=1)


def _start_of_quarter(dt: datetime) -> datetime:
    q_month = ((dt.month - 1) // 3) * 3 + 1
    return _start_of_day(dt).replace(month=q_month, day=1)


def _add_months(dt: datetime, months: int) -> datetime:
    """Safe ``dt + N months``, clamping day if needed."""
    m = dt.month - 1 + months
    year = dt.year + m // 12
    month = m % 12 + 1
    day = min(dt.day, monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)


def range_for(kind: NamedRange, *, now: datetime | None = None) -> TimeRange:
    """Resolve a named range to a concrete ``TimeRange``."""
    now = now or datetime.now(timezone.utc)
    label = LABELS[kind]

    if kind == NamedRange.TODAY:
        start = _start_of_day(now)
        end = start + timedelta(days=1)
    elif kind == NamedRange.YESTERDAY:
        end = _start_of_day(now)
        start = end - timedelta(days=1)
    elif kind == NamedRange.THIS_WEEK:
        start = _start_of_week(now)
        end = start + timedelta(days=7)
    elif kind == NamedRange.LAST_WEEK:
        this_week_start = _start_of_week(now)
        start = this_week_start - timedelta(days=7)
        end = this_week_start
    elif kind == NamedRange.THIS_MONTH:
        start = _start_of_month(now)
        end = _add_months(start, 1)
    elif kind == NamedRange.LAST_MONTH:
        this_month = _start_of_month(now)
        start = _add_months(this_month, -1)
        end = this_month
    elif kind == NamedRange.THIS_QUARTER:
        start = _start_of_quarter(now)
        end = _add_months(start, 3)
    elif kind == NamedRange.LAST_QUARTER:
        this_q = _start_of_quarter(now)
        start = _add_months(this_q, -3)
        end = this_q
    elif kind == NamedRange.ALL_TIME:
        start = datetime(2020, 1, 1, tzinfo=timezone.utc)
        end = now + timedelta(days=1)
    else:  # pragma: no cover
        raise ValueError(f"Unknown NamedRange: {kind}")

    return TimeRange(key=kind.value, label=label, start=start, end=end)


def previous_range_for(kind: NamedRange, *, now: datetime | None = None) -> TimeRange | None:
    """Return the natural previous-period pairing for a named range.

    Used for automatic ``PeriodComparison`` generation. Returns ``None`` for
    ranges where a period-over-period comparison doesn't make sense
    (``all_time``).
    """
    pairing: dict[NamedRange, NamedRange] = {
        NamedRange.TODAY: NamedRange.YESTERDAY,
        NamedRange.YESTERDAY: NamedRange.YESTERDAY,  # 2 days ago handled below
        NamedRange.THIS_WEEK: NamedRange.LAST_WEEK,
        NamedRange.LAST_WEEK: NamedRange.LAST_WEEK,
        NamedRange.THIS_MONTH: NamedRange.LAST_MONTH,
        NamedRange.LAST_MONTH: NamedRange.LAST_MONTH,
        NamedRange.THIS_QUARTER: NamedRange.LAST_QUARTER,
        NamedRange.LAST_QUARTER: NamedRange.LAST_QUARTER,
    }
    if kind == NamedRange.ALL_TIME:
        return None

    # For "yesterday"/"last_*" ranges we want the equivalent period one step
    # earlier — shift the window by its own duration.
    if kind in {
        NamedRange.YESTERDAY,
        NamedRange.LAST_WEEK,
        NamedRange.LAST_MONTH,
        NamedRange.LAST_QUARTER,
    }:
        current = range_for(kind, now=now)
        duration = current.end - current.start
        return TimeRange(
            key=f"{kind.value}_prev",
            label=f"Previous {LABELS[kind].lower()}",
            start=current.start - duration,
            end=current.start,
        )

    prev_kind = pairing[kind]
    return range_for(prev_kind, now=now)


__all__ = ["NamedRange", "LABELS", "range_for", "previous_range_for"]
