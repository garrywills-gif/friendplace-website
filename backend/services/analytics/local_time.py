"""
Australia/Sydney local-time helpers for date-bounded analytics queries.

Why this exists
---------------
Every ``created_at`` in FriendPlace's Mongo store is written as an ISO-8601
UTC string (see ``server.now_iso()``). Historically, dashboards like the
Founding Members CRM and George's analytics tools computed "today" as
``datetime.now(timezone.utc).replace(hour=0, ...)`` — i.e. the UTC-midnight
day boundary. That is subtly wrong for an Australian audience:

* Sydney is UTC+10 (AEST) or UTC+11 (AEDT — during daylight saving,
  first Sunday of October → first Sunday of April).
* Registrations that land in the *early hours* of Sydney's day fall into
  the *previous* UTC day. The dashboard therefore reports "New Today: 0"
  even when there is clearly a new registration dated *today* in Sydney
  local time.

This module is the single source of truth for local-day boundaries. Every
Founding Members / interest-registration query that needs "today",
"yesterday", "this week" etc. MUST use these helpers so the CMS dashboard,
George's analytics tools, and any future feature all reconcile.

We rely on ``zoneinfo.ZoneInfo("Australia/Sydney")``, which reads the
system tzdata and correctly switches between AEDT and AEST automatically.

Public API
----------
* ``SYDNEY_TZ``                  – zoneinfo object.
* ``sydney_now()``               – current time in Sydney.
* ``sydney_day_bounds(offset)``  – (start_dt_utc, end_dt_utc) for a
                                    Sydney-local day. ``offset=0`` → today,
                                    ``offset=-1`` → yesterday.
* ``sydney_day_iso(offset)``     – same as above but ISO strings, ready
                                    for direct Mongo string comparison.
* ``sydney_named_range(kind)``   – named window ("today" / "yesterday" /
                                    "this_week" / "last_week" /
                                    "this_month" / "last_month"), returned
                                    as ``(start_iso, end_iso)`` UTC strings.
* ``sydney_today_iso()``         – shortcut for the "today" case.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal, Tuple

from zoneinfo import ZoneInfo

SYDNEY_TZ = ZoneInfo("Australia/Sydney")


NamedLocalRange = Literal[
    "today",
    "yesterday",
    "this_week",
    "last_week",
    "this_month",
    "last_month",
    "this_year",
]


def sydney_now() -> datetime:
    """Current time in Australia/Sydney (tz-aware)."""
    return datetime.now(SYDNEY_TZ)


def _sydney_midnight(local_dt: datetime) -> datetime:
    """00:00 local of ``local_dt`` (still tz-aware in Sydney)."""
    return local_dt.replace(hour=0, minute=0, second=0, microsecond=0)


def _to_utc(dt: datetime) -> datetime:
    """Convert a tz-aware datetime to UTC."""
    if dt.tzinfo is None:
        raise ValueError("_to_utc requires a tz-aware datetime")
    return dt.astimezone(timezone.utc)


def sydney_day_bounds(
    offset_days: int = 0,
    *,
    now: datetime | None = None,
) -> Tuple[datetime, datetime]:
    """Return the UTC-tz-aware (start, end) datetime pair for a
    Sydney-local day. ``offset_days=0`` → today, ``-1`` → yesterday,
    ``-7`` → same weekday last week.

    Boundaries: ``start`` inclusive, ``end`` exclusive (so adjacent
    days tile without gap or overlap).
    """
    base = (now or sydney_now()).astimezone(SYDNEY_TZ)
    local_start = _sydney_midnight(base) + timedelta(days=offset_days)
    local_end = local_start + timedelta(days=1)
    return _to_utc(local_start), _to_utc(local_end)


def sydney_day_iso(
    offset_days: int = 0,
    *,
    now: datetime | None = None,
) -> Tuple[str, str]:
    """String form of :func:`sydney_day_bounds` — ISO-8601 UTC with
    ``+00:00`` suffix, ready to compare against ``created_at`` strings
    stored via ``server.now_iso()``.
    """
    start, end = sydney_day_bounds(offset_days, now=now)
    return start.isoformat(), end.isoformat()


def sydney_today_iso(*, now: datetime | None = None) -> Tuple[str, str]:
    """Convenience shortcut for the very common "today in Sydney" case."""
    return sydney_day_iso(0, now=now)


def _sydney_week_start(local_dt: datetime) -> datetime:
    """Monday 00:00 local of the week containing ``local_dt``."""
    midnight = _sydney_midnight(local_dt)
    return midnight - timedelta(days=midnight.weekday())


def _sydney_month_start(local_dt: datetime) -> datetime:
    """1st of the month, 00:00 local."""
    return _sydney_midnight(local_dt).replace(day=1)


def _add_months(dt: datetime, months: int) -> datetime:
    """Safe local month arithmetic (clamps day if needed)."""
    from calendar import monthrange

    m = dt.month - 1 + months
    year = dt.year + m // 12
    month = m % 12 + 1
    day = min(dt.day, monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)


def sydney_named_range(
    kind: NamedLocalRange,
    *,
    now: datetime | None = None,
) -> Tuple[str, str]:
    """Return ``(start_iso_utc, end_iso_utc)`` for a Sydney-local named
    window. Boundaries: ``start`` inclusive, ``end`` exclusive.

    Supported kinds:
        - "today"        — today (Sydney local)
        - "yesterday"    — yesterday (Sydney local)
        - "this_week"    — Monday 00:00 → next Monday 00:00
        - "last_week"    — previous Monday → this Monday
        - "this_month"   — 1st 00:00 → 1st of next month 00:00
        - "last_month"   — 1st of prev month → 1st of this month
        - "this_year"    — Jan 1 00:00 → Jan 1 of next year 00:00
    """
    base = (now or sydney_now()).astimezone(SYDNEY_TZ)

    if kind == "today":
        start_local = _sydney_midnight(base)
        end_local = start_local + timedelta(days=1)
    elif kind == "yesterday":
        end_local = _sydney_midnight(base)
        start_local = end_local - timedelta(days=1)
    elif kind == "this_week":
        start_local = _sydney_week_start(base)
        end_local = start_local + timedelta(days=7)
    elif kind == "last_week":
        this_week = _sydney_week_start(base)
        start_local = this_week - timedelta(days=7)
        end_local = this_week
    elif kind == "this_month":
        start_local = _sydney_month_start(base)
        end_local = _add_months(start_local, 1)
    elif kind == "last_month":
        this_month = _sydney_month_start(base)
        start_local = _add_months(this_month, -1)
        end_local = this_month
    elif kind == "this_year":
        start_local = _sydney_midnight(base).replace(month=1, day=1)
        end_local = start_local.replace(year=start_local.year + 1)
    else:
        raise ValueError(f"Unknown Sydney named range: {kind!r}")

    return _to_utc(start_local).isoformat(), _to_utc(end_local).isoformat()


__all__ = [
    "SYDNEY_TZ",
    "NamedLocalRange",
    "sydney_now",
    "sydney_day_bounds",
    "sydney_day_iso",
    "sydney_today_iso",
    "sydney_named_range",
]
