"""MCGS Rhythms — grounded fact gathering for the Morning Briefing.

Everything here is a deterministic read from Mongo. No LLM calls, no
inferences. The composer then hands these grounded facts to Sonnet
with the strict instruction *"speak from these facts only."*

Why split out from the composer? So we can:
1. Unit-test the facts without spending LLM tokens.
2. Attach the facts as `grounded_sources` on the briefing row for audit.
3. Let the composer make relevance decisions from a single, honest input.

See `/app/memory/mcgs-phase2-plan.md` §1 and
`/app/memory/mcgs-architecture.md` §4 (Grounded answers only).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from .models import COLL_BRIEFINGS

# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

_OPEN_STATES = {"NEW", "SEEN", "IN_REVIEW", "SNOOZED", "ESCALATED"}


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Overnight window — the "since I last spoke to you" cursor
# ---------------------------------------------------------------------------

async def _overnight_since(db: Any, admin_id: str) -> str:
    """Return the ISO cursor for what counts as "overnight".

    Priority:
    1. The delivered_at of yesterday's EOD wrap-up (if any).
    2. Otherwise, yesterday's Morning Briefing delivered_at.
    3. Otherwise, 18 hours ago (a reasonable default).

    This lets George continue the previous evening's thread — "I'll keep
    watch overnight" → "It stayed fairly quiet overnight".
    """
    prior = await db[COLL_BRIEFINGS].find_one(
        {
            "admin_id": admin_id,
            "rhythm_type": {"$in": ["eod", "morning"]},
            "status": {"$in": ["delivered", "seen", "acknowledged"]},
        },
        {"_id": 0, "delivered_at": 1, "rhythm_type": 1},
        sort=[("delivered_at", -1)],
    )
    if prior and prior.get("delivered_at"):
        return prior["delivered_at"]
    return _iso(datetime.now(timezone.utc) - timedelta(hours=18))


async def _last_eod(db: Any, admin_id: str) -> Optional[dict]:
    """Return yesterday's End-of-Day wrap-up if we produced one.

    The composer uses its `sign_off_line` (if any) so the morning
    naturally continues the previous evening's thread.
    """
    return await db[COLL_BRIEFINGS].find_one(
        {
            "admin_id": admin_id,
            "rhythm_type": "eod",
            "status": {"$in": ["delivered", "seen", "acknowledged"]},
        },
        {"_id": 0},
        sort=[("delivered_at", -1)],
    )


# ---------------------------------------------------------------------------
# Grounded readers
# ---------------------------------------------------------------------------

async def _signals_since(db: Any, since_iso: str, priority: list[str]) -> list[dict]:
    return await db.mcgs_signals.find(
        {
            "created_at": {"$gte": since_iso},
            "priority": {"$in": priority},
        },
        {
            "_id": 0,
            "id": 1,
            "priority": 1,
            "category": 1,
            "status": 1,
            "subject": 1,
            "producer": 1,
            "created_at": 1,
            "case_id": 1,
        },
    ).sort([("priority", 1), ("created_at", -1)]).to_list(50)


async def _open_signals_by_priority(db: Any) -> dict[str, int]:
    pipeline = [
        {"$match": {"status": {"$in": list(_OPEN_STATES)}}},
        {"$group": {"_id": "$priority", "n": {"$sum": 1}}},
    ]
    counts: dict[str, int] = {}
    async for row in db.mcgs_signals.aggregate(pipeline):
        counts[row["_id"]] = row["n"]
    return counts


async def _pending_submissions(db: Any) -> int:
    return await db.cms_event_submissions.count_documents({"status": "pending"})


async def _open_tickets(db: Any) -> int:
    # Open OR in_progress — both need eyes.
    return await db.support_tickets.count_documents(
        {"status": {"$in": ["open", "in_progress"]}}
    )


async def _upcoming_events_today(db: Any) -> list[dict]:
    today = datetime.now(timezone.utc).date().isoformat()
    return await db.cms_events.find(
        {"status": "published", "start_date": today},
        {"_id": 0, "id": 1, "title": 1, "start_date": 1, "start_time": 1,
         "location_name": 1, "rsvp_count": 1, "capacity": 1},
    ).sort([("start_time", 1)]).to_list(10)


async def _upcoming_events_next_days(db: Any, days: int = 3) -> list[dict]:
    today = datetime.now(timezone.utc).date()
    future = (today + timedelta(days=days)).isoformat()
    return await db.cms_events.find(
        {
            "status": "published",
            "start_date": {"$gte": today.isoformat(), "$lte": future},
        },
        {"_id": 0, "id": 1, "title": 1, "start_date": 1, "start_time": 1,
         "location_name": 1, "rsvp_count": 1, "capacity": 1},
    ).sort([("start_date", 1), ("start_time", 1)]).to_list(15)


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------

async def gather_morning_facts(db: Any, admin_id: str) -> dict:
    """Read everything the morning composer needs. No LLM, no inference.

    Returns a dict with grounded facts + a `was_quiet_overnight` boolean
    the opener rotation uses.
    """
    since_iso = await _overnight_since(db, admin_id)
    last_eod = await _last_eod(db, admin_id)

    new_p0 = await _signals_since(db, since_iso, ["P0"])
    new_p1 = await _signals_since(db, since_iso, ["P1"])
    new_p2 = await _signals_since(db, since_iso, ["P2"])
    new_milestones = await db.mcgs_signals.find(
        {
            "created_at": {"$gte": since_iso},
            "category": "milestone",
        },
        {"_id": 0, "id": 1, "subject": 1, "priority": 1, "created_at": 1},
    ).sort([("created_at", -1)]).to_list(10)

    open_counts = await _open_signals_by_priority(db)
    pending_subs = await _pending_submissions(db)
    open_tickets = await _open_tickets(db)
    events_today = await _upcoming_events_today(db)
    events_soon = await _upcoming_events_next_days(db, days=3)

    # "Quiet overnight" = zero new P0/P1 signals AND no new tickets AND no new submissions.
    # This gates the `nice and quiet overnight` opener honestly.
    new_tickets_overnight = await db.support_tickets.count_documents(
        {"created_at": {"$gte": since_iso}}
    )
    new_subs_overnight = await db.cms_event_submissions.count_documents(
        {"created_at": {"$gte": since_iso}}
    )
    was_quiet_overnight = (
        not new_p0
        and not new_p1
        and new_tickets_overnight == 0
        and new_subs_overnight == 0
    )

    return {
        "generated_at": _iso_now(),
        "overnight_since": since_iso,
        "last_eod": {
            "delivered_at": (last_eod or {}).get("delivered_at"),
            "sign_off_line": (last_eod or {}).get("sign_off_line"),
        } if last_eod else None,
        # New since the cursor — the actual "overnight" story:
        "new_signals": {
            "P0": new_p0,
            "P1": new_p1,
            "P2": new_p2,
        },
        "new_signal_counts": {
            "P0": len(new_p0),
            "P1": len(new_p1),
            "P2": len(new_p2),
        },
        "new_milestones": new_milestones,
        "new_tickets_overnight": new_tickets_overnight,
        "new_submissions_overnight": new_subs_overnight,
        # Current standing state — the "what's open" story:
        "open_signal_counts": open_counts,
        "pending_submissions": pending_subs,
        "open_tickets": open_tickets,
        # Today's calendar:
        "events_today": events_today,
        "events_next_days": events_soon,
        # Opener gate:
        "was_quiet_overnight": was_quiet_overnight,
    }
