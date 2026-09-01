"""MCGS Rhythms — Milestone Recognition (Milestone F).

Quiet, ambient. Watches for meaningful community achievements and
lands them as `Milestone` Signals (category=milestone, priority=P3) so
they surface inline on the Bridge AND get folded into the next Rhythm
via the existing `celebrated_moments` composer field.

Rules Garry locked in (2026-07-19):
- Idempotent by `(milestone_key, period_key)` — never celebrated twice.
- Never celebrated during a safety-sensitive window (any open P0 safety
  Signal in the last 24h).
- Language celebrates humans, not statistics — the copy stays with the
  composer, this module just plants the seed.

Tracked milestones (v1):
- Total members cross a round threshold (100, 500, 1k, 5k, 10k, 50k, 100k).
- Total friendships (users.friends length aggregate) cross a round
  threshold (100, 1k, 10k, 100k).
- First organisation reaches 100 events.
- Every open support ticket cleared (first time in ≥7 days).
- No safeguarding incidents for 30 consecutive days.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from .models import COLL_MILESTONES

log = logging.getLogger("friendplace.mcgs.rhythms.milestones")


# ---------------------------------------------------------------------------
# Thresholds
# ---------------------------------------------------------------------------

MEMBER_THRESHOLDS = [100, 500, 1_000, 5_000, 10_000, 50_000, 100_000]
FRIENDSHIP_THRESHOLDS = [100, 1_000, 10_000, 100_000]
ORG_EVENT_THRESHOLDS = [100]  # first org to 100 events


def _round_words(n: int) -> str:
    """Turn a threshold into a "for humans" phrase (rule 9 of the composer)."""
    mapping = {
        100: "our hundredth",
        500: "our five-hundredth",
        1_000: "our thousandth",
        5_000: "our five-thousandth",
        10_000: "our ten-thousandth",
        50_000: "our fifty-thousandth",
        100_000: "our hundred-thousandth",
    }
    return mapping.get(n, f"our {n:,}th")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Safety-sensitive window
# ---------------------------------------------------------------------------

async def _in_safety_sensitive_window(db: Any) -> bool:
    """Any open P0 signal in the safety category in the last 24 hours."""
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    return await db.mcgs_signals.count_documents({
        "category": "risk",
        "priority": "P0",
        "status": {"$in": ["NEW", "SEEN", "IN_REVIEW", "ESCALATED"]},
        "created_at": {"$gte": since},
    }) > 0


# ---------------------------------------------------------------------------
# Idempotency
# ---------------------------------------------------------------------------

async def _already_awarded(db: Any, key: str, period: str) -> bool:
    row = await db[COLL_MILESTONES].find_one(
        {"milestone_key": key, "period_key": period},
        {"_id": 0, "_id_only": 1},
    )
    return row is not None


async def _award(
    db: Any, *, milestone_key: str, period_key: str, value_at_award: Any,
    subject: str, body: str,
) -> str:
    """Record the award AND create a Milestone Signal. Returns signal_id."""
    now = _now_iso()
    signal_id = str(uuid.uuid4())
    case_id = str(uuid.uuid4())

    # Signal first — the Rhythm composers read from mcgs_signals.
    await db.mcgs_signals.insert_one({
        "id": signal_id,
        "case_id": case_id,
        "priority": "P3",
        "status": "NEW",
        "category": "milestone",
        "subject": subject,
        "body": body,
        "producer": "milestones",
        "entity_ref": {"kind": "milestone", "id": milestone_key},
        "created_at": now,
        "updated_at": now,
        "channels_available": ["bridge"],
        "prompt_injection_suspected": False,
    })

    # Award record — idempotency guard.
    try:
        await db[COLL_MILESTONES].insert_one({
            "id": str(uuid.uuid4()),
            "milestone_key": milestone_key,
            "period_key": period_key,
            "value_at_award": value_at_award,
            "signal_id": signal_id,
            "awarded_at": now,
        })
    except Exception:
        # Race with a parallel scan — the unique index caught it. Roll
        # back the signal so we don't end up with a dangling one.
        log.warning("milestone award raced for %s/%s — rolling back signal",
                    milestone_key, period_key)
        await db.mcgs_signals.delete_one({"id": signal_id})
        return ""

    log.info("Milestone awarded: %s (%s = %s)", milestone_key, period_key, value_at_award)
    return signal_id


# ---------------------------------------------------------------------------
# Detectors
# ---------------------------------------------------------------------------

async def _scan_member_thresholds(db: Any) -> list[str]:
    total = await db.users.count_documents({})
    awarded: list[str] = []
    for t in MEMBER_THRESHOLDS:
        if total < t:
            break
        key = f"members_{t}"
        period = "lifetime"
        if await _already_awarded(db, key, period):
            continue
        sid = await _award(
            db,
            milestone_key=key,
            period_key=period,
            value_at_award=total,
            subject=f"Reached {_round_words(t)} member",
            body=(
                f"{_round_words(t).capitalize()} member has joined FriendPlace. "
                "Worth naming quietly in the next Rhythm."
            ),
        )
        if sid:
            awarded.append(sid)
    return awarded


async def _scan_friendship_thresholds(db: Any) -> list[str]:
    # Sum of len(friends) across all users / 2 (each friendship is mutual).
    pipeline = [
        {"$project": {"n": {"$size": {"$ifNull": ["$friends", []]}}}},
        {"$group": {"_id": None, "total": {"$sum": "$n"}}},
    ]
    total_pairs = 0
    async for row in db.users.aggregate(pipeline):
        total_pairs = int((row.get("total") or 0) / 2)
    awarded: list[str] = []
    for t in FRIENDSHIP_THRESHOLDS:
        if total_pairs < t:
            break
        key = f"friendships_{t}"
        period = "lifetime"
        if await _already_awarded(db, key, period):
            continue
        sid = await _award(
            db,
            milestone_key=key,
            period_key=period,
            value_at_award=total_pairs,
            subject=f"Reached {_round_words(t)} friendship",
            body=(
                f"{_round_words(t).capitalize()} friendship has formed on FriendPlace. "
                "Quietly worth naming."
            ),
        )
        if sid:
            awarded.append(sid)
    return awarded


async def _scan_org_event_thresholds(db: Any) -> list[str]:
    """First organisation to cross ORG_EVENT_THRESHOLDS. Uses cms_events.organisation_id."""
    awarded: list[str] = []
    for t in ORG_EVENT_THRESHOLDS:
        # Look up top org by published event count.
        pipeline = [
            {"$match": {"status": "published", "organisation_id": {"$exists": True, "$ne": None}}},
            {"$group": {"_id": "$organisation_id", "n": {"$sum": 1}}},
            {"$match": {"n": {"$gte": t}}},
            {"$sort": {"n": -1}},
            {"$limit": 1},
        ]
        top = None
        async for row in db.cms_events.aggregate(pipeline):
            top = row
        if not top:
            continue
        org_id = top["_id"]
        key = f"org_{org_id}_events_{t}"
        period = "lifetime"
        if await _already_awarded(db, key, period):
            continue
        # Fetch org name for warmth.
        org = await db.outreach_organisations.find_one({"id": org_id}, {"_id": 0, "name": 1})
        name = (org or {}).get("name") or "An organisation"
        sid = await _award(
            db,
            milestone_key=key,
            period_key=period,
            value_at_award=top["n"],
            subject=f"{name} reached {t} events",
            body=f"{name} has now run {t} events on FriendPlace — a lovely milestone.",
        )
        if sid:
            awarded.append(sid)
    return awarded


async def _scan_tickets_cleared(db: Any) -> list[str]:
    """First time in ≥7 days that every open support-ticket CASE is cleared.

    Sourced from `mcgs_cases` (the Bridge) — not the raw `support_tickets`
    collection — so this milestone only fires when the ADMIN sees a
    zero on the Bridge. Same source-of-truth as George's morning/EOD
    briefings (see `rhythms/facts.py::_open_tickets`).
    """
    open_tickets = await db.mcgs_cases.count_documents(
        {
            "case_key": {"$regex": "^support_ticket:"},
            "status": {"$in": ["NEW", "SEEN", "IN_REVIEW", "SNOOZED", "ESCALATED"]},
        },
    )
    if open_tickets > 0:
        return []
    # Idempotency: award once per calendar-week key.
    week_key = datetime.now(timezone.utc).strftime("%G-W%V")
    key = "tickets_all_clear"
    if await _already_awarded(db, key, week_key):
        return []
    # Only award if we haven't been all-clear in the last 7 days.
    last = await db[COLL_MILESTONES].find_one(
        {"milestone_key": key},
        {"_id": 0, "awarded_at": 1},
        sort=[("awarded_at", -1)],
    )
    if last:
        try:
            when = datetime.fromisoformat(last["awarded_at"].replace("Z", "+00:00"))
            if (datetime.now(timezone.utc) - when) < timedelta(days=7):
                return []
        except Exception:
            pass
    sid = await _award(
        db,
        milestone_key=key,
        period_key=week_key,
        value_at_award=0,
        subject="Support queue is clear",
        body=(
            "Every open support ticket is cleared for the first time in a week — "
            "worth a quiet moment of recognition."
        ),
    )
    return [sid] if sid else []


async def _scan_safeguarding_streak(db: Any) -> list[str]:
    """No safeguarding incidents (P0 or P1 risk signals) for 30 consecutive days."""
    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    n = await db.mcgs_signals.count_documents({
        "category": "risk",
        "priority": {"$in": ["P0", "P1"]},
        "created_at": {"$gte": since},
    })
    if n > 0:
        return []
    month_key = datetime.now(timezone.utc).strftime("%Y-%m")
    key = "safeguarding_streak_30d"
    if await _already_awarded(db, key, month_key):
        return []
    sid = await _award(
        db,
        milestone_key=key,
        period_key=month_key,
        value_at_award=30,
        subject="Thirty days without a safeguarding incident",
        body=(
            "Thirty consecutive days with no safeguarding incidents. "
            "The community's care for each other is showing."
        ),
    )
    return [sid] if sid else []


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

async def scan_milestones(db: Any) -> dict:
    """Run every detector. Skip celebration entirely if we're in a
    safety-sensitive window. Returns a summary dict."""
    if await _in_safety_sensitive_window(db):
        log.info("Milestone scan paused — safety-sensitive window active.")
        return {"paused": True, "reason": "safety_sensitive_window", "awarded": []}

    awarded: list[str] = []
    try:
        awarded.extend(await _scan_member_thresholds(db))
        awarded.extend(await _scan_friendship_thresholds(db))
        awarded.extend(await _scan_org_event_thresholds(db))
        awarded.extend(await _scan_tickets_cleared(db))
        awarded.extend(await _scan_safeguarding_streak(db))
    except Exception:
        log.exception("Milestone scan encountered an error (non-fatal)")

    return {"paused": False, "awarded": awarded, "count": len(awarded)}
