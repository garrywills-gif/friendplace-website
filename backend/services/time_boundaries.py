"""Shared time-window helpers for CRM / analytics counting.

Single source of truth for "today" so the Founding Members dashboard
card and George's ``founding_members_summary`` tool can't drift apart.

The community timezone is ``Australia/Sydney``. All calendar-day
boundaries ("today", "yesterday") are computed in Sydney and then
converted to a UTC ISO-8601 string suitable for comparing against
``created_at`` values that are themselves stored as UTC ISO strings.

Why not compare local times directly? ``interest_registrations.created_at``
is written as ``datetime.now(timezone.utc).isoformat()`` (UTC-suffixed
ISO strings), so we compare in UTC to get a lexicographic-safe range
match without having to touch every existing document.
"""

from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

#: Australia/Sydney is the canonical FriendPlace community timezone.
#: See ``backend/services/george/remembers.py`` for the original locking
#: of this choice.
COMMUNITY_TZ = ZoneInfo("Australia/Sydney")


def sydney_today_start_utc() -> datetime:
    """Return the UTC datetime that corresponds to *now-in-Sydney*
    00:00:00 (start of the current Sydney calendar day)."""
    now_syd = datetime.now(COMMUNITY_TZ)
    start_syd = now_syd.replace(hour=0, minute=0, second=0, microsecond=0)
    return start_syd.astimezone(timezone.utc)


def sydney_today_start_iso() -> str:
    """UTC ISO string form of :func:`sydney_today_start_utc`, safe to
    compare lexicographically against stored ``created_at`` strings.

    Example (Sydney AEDT, UTC+11):
        >>> # It's 10:00 AEDT on 2026-11-04.
        >>> sydney_today_start_iso()
        '2026-11-03T13:00:00+00:00'
    """
    return sydney_today_start_utc().isoformat()


def sydney_days_ago_start_iso(days: int) -> str:
    """Return the UTC ISO string of *N days ago* in Sydney calendar terms.

    ``days=0`` == today's start (same as :func:`sydney_today_start_iso`).
    ``days=1`` == yesterday's start.
    ``days=7`` == the start of the day 7 Sydney days ago.
    """
    from datetime import timedelta
    start = sydney_today_start_utc() - timedelta(days=max(0, int(days)))
    return start.isoformat()
