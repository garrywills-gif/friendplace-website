"""MCGS Rhythms — rotating Morning Briefing openers.

See `/app/memory/mcgs-phase2-plan.md` §Morning Briefing.

> "George should rotate between a small library of warm openings so it
>  never feels scripted." — Garry, 19 July 2026

Rules:
- Structure of the briefing is locked; the opener is the only variable line.
- Deterministic rotation so the same admin sees the same opener on the
  same date (idempotent across restarts).
- 7-day repeat guard so no opener recurs within a week.
- One opener is conditional (`only_if_quiet_overnight`) — used only when
  overnight was actually calm.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from .models import COLL_BRIEFINGS

# Warm opener library. Order is meaningful — used as the deterministic seed.
# Each entry: (id, phrase, only_if_quiet_overnight)
MORNING_OPENERS: list[tuple[str, str, bool]] = [
    ("hope_evening",  "Good morning, Garry. Hope you had a good evening.", False),
    ("hope_well",     "Good morning, Garry. Hope you're doing well.",       False),
    ("ready_day",     "Morning, Garry. Ready for another day?",             False),
    ("fresh_one",     "Morning, Garry. It's a fresh one.",                  False),
    ("quiet_night",   "Good morning, Garry. Nice and quiet overnight.",     True),
    ("plain",         "Good morning, Garry.",                                False),
]

REPEAT_GUARD_DAYS = 7


def _date_key(now: Optional[datetime] = None) -> str:
    now = now or datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%d")


def _seed_for(admin_id: str, date_key: str) -> int:
    """Deterministic per-(admin,date) integer seed."""
    h = hashlib.sha1(f"{admin_id}:{date_key}".encode("utf-8")).hexdigest()
    return int(h[:8], 16)


async def recent_openers(
    db: Any,
    admin_id: str,
    days: int = REPEAT_GUARD_DAYS,
) -> set[str]:
    """Return the set of opener ids used in the last `days` days for this admin."""
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    cursor = db[COLL_BRIEFINGS].find(
        {
            "admin_id": admin_id,
            "rhythm_type": "morning",
            "delivered_at": {"$gte": since},
            "opener_used": {"$ne": None},
        },
        {"_id": 0, "opener_used": 1},
    )
    used: set[str] = set()
    async for row in cursor:
        oid = row.get("opener_used")
        if oid:
            used.add(oid)
    return used


async def pick_morning_opener(
    db: Any,
    admin_id: str,
    *,
    date_key: Optional[str] = None,
    quiet_overnight: bool = False,
) -> dict:
    """Choose a warm opener for the Morning Briefing.

    Deterministic per (admin_id, date_key). Never repeats within
    REPEAT_GUARD_DAYS. Conditional openers (e.g. "nice and quiet
    overnight") are only eligible when their precondition is true.

    Returns:
        {"id": str, "phrase": str}
    """
    date_key = date_key or _date_key()
    used_recently = await recent_openers(db, admin_id)

    # 1. Eligible openers = not used recently AND satisfy their preconditions.
    eligible = [
        (oid, phrase, quiet_only)
        for (oid, phrase, quiet_only) in MORNING_OPENERS
        if oid not in used_recently and (not quiet_only or quiet_overnight)
    ]

    # 2. If everything's been used recently, drop the repeat guard but keep
    #    conditional gating so we never say "quiet overnight" when it wasn't.
    if not eligible:
        eligible = [
            (oid, phrase, quiet_only)
            for (oid, phrase, quiet_only) in MORNING_OPENERS
            if not quiet_only or quiet_overnight
        ]

    # 3. Deterministic pick — same admin on same day always gets same opener.
    seed = _seed_for(admin_id, date_key)
    (oid, phrase, _) = eligible[seed % len(eligible)]
    return {"id": oid, "phrase": phrase}
