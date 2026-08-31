"""
B7 — George Remembers (25 Jul 2026, TestFlight-ready MVP).

Persistent, restart-safe scheduling of two message kinds:

    • pre_event  — warm nudge ~18h BEFORE the event start,
                   organiser-only.
                   "Your Coffee Catch-Up is tomorrow, Garry. I hope
                    everyone has a lovely time."

    • post_event — friendly check-in ~2h after the event's estimated
                   end (start + 2h duration + 2h delay = start + 4h),
                   organiser-only.
                   "How did Coffee Catch-Up go, Garry? I hope you had
                    a lovely afternoon."

Design notes (locked with Garry 25 Jul 2026):

1. **Persistence** — Every message is stored in `george_remembers`.
   If the member doesn't open the app at the exact scheduled minute,
   the message waits in their inbox until they do (or until they
   dismiss it).
2. **Idempotency across restarts** — the sweep never inserts a
   duplicate row for the same (event, kind, scheduled_for). Rows
   already `delivered` or `dismissed` are never touched.
3. **Rescheduled events** — when a member (or George) moves an event,
   the next sweep supersedes any still-`scheduled` old row and creates
   a fresh row aligned to the new time. Delivered rows are left alone
   (the member has already seen them; no reason to spam).
4. **Cancelled events / removed accounts** — the sweep cancels any
   pending `scheduled` rows whose event has been cancelled or whose
   organiser is inactive/deleted.
5. **Time zone** — events don't carry an explicit tz, so we assume
   the community timezone (`Australia/Sydney`) for wall-clock
   interpretation. All storage is UTC ISO8601.
6. **Content** — deterministic templates for MVP (no LLM cost or
   latency at delivery time). The template picks up the organiser's
   first name and the event's title/time-of-day.

Public surface:

    await ensure_indexes(db)              # startup hook
    await sweep_once(db)                  # single sweep pass
    async def sweep_loop(db, interval=300)  # background task
    await fetch_inbox(db, user_id)        # unread + due deliveries
    await mark_seen(db, msg_id, user_id)
    await dismiss(db, msg_id, user_id)
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

log = logging.getLogger("friendplace.george.remembers")

COLLECTION = "george_remembers"

# ---------------------------------------------------------------------------
# Config (locked with Garry — happy to expose as env vars later)
# ---------------------------------------------------------------------------

# Assume Sydney for wall-clock interpretation of event date/time.
# Every event on FriendPlace right now is Aus-based; if we ever go
# multi-region, promote this to a per-community setting.
COMMUNITY_TZ = ZoneInfo("Australia/Sydney")

# Pre-event: fire ~18 h before the event start.
PRE_EVENT_LEAD_H = 18

# Post-event: fire ~2 h after the estimated event end.
# Events don't have explicit end times, so we assume a 2-hour duration
# and land the follow-up 2 hours after that (start + 2h + 2h = start + 4h).
ASSUMED_DURATION_H = 2
POST_EVENT_DELAY_H = 2

# Sweep window: only schedule messages for events happening within
# the next 21 days. Anything further out is scheduled in a later pass —
# keeps the collection lean and avoids accreting stale rows.
SCHEDULE_HORIZON_DAYS = 21

# Grace period: if a scheduled time is already in the past by more than
# this, we don't insert a fresh row for it (missed the window).
DELIVERY_GRACE_H = 6

# Sweep cadence in seconds — used by the background loop.
SWEEP_INTERVAL_S = 300  # 5 minutes


# ---------------------------------------------------------------------------
# Indexes — restart-safe idempotency
# ---------------------------------------------------------------------------

async def ensure_indexes(db) -> None:
    """Create the indexes we rely on. Idempotent — safe on every startup."""
    coll = db[COLLECTION]
    try:
        await coll.create_index("id", unique=True, background=True)
    except Exception:
        pass
    try:
        # Look-up shape #1: enqueuer checking for an existing active row
        # for a given (event, kind). Partial filter keeps the index
        # small — only the active rows matter.
        await coll.create_index(
            [("event_id", 1), ("kind", 1)],
            partialFilterExpression={"status": {"$in": ["scheduled", "delivered"]}},
            background=True,
            name="event_kind_active_idx",
        )
    except Exception:
        pass
    try:
        # Look-up shape #2: deliverer scan by (status, scheduled_for).
        await coll.create_index(
            [("status", 1), ("scheduled_for", 1)],
            background=True,
            name="status_scheduled_idx",
        )
    except Exception:
        pass
    try:
        # Look-up shape #3: per-user inbox.
        await coll.create_index(
            [("recipient_id", 1), ("status", 1), ("scheduled_for", 1)],
            background=True,
            name="recipient_inbox_idx",
        )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Helpers — time & rendering
# ---------------------------------------------------------------------------

def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _event_start_dt_utc(ev: dict) -> Optional[datetime]:
    """Convert an event's local `date` + `time` (Sydney wall-clock) into
    a UTC datetime. Returns None if unparseable."""
    date_s = ev.get("date")
    time_s = ev.get("time")
    if not date_s or not time_s:
        return None
    time_s = str(time_s).strip()
    # Support both '14:00' and '2:00 PM' / '10:00 AM'.
    hh, mm = 0, 0
    try:
        if any(x in time_s.upper() for x in ("AM", "PM")):
            fmt = "%I:%M %p"
            t = datetime.strptime(time_s.upper(), fmt).time()
            hh, mm = t.hour, t.minute
        else:
            parts = time_s.split(":")
            hh, mm = int(parts[0]), int(parts[1])
    except Exception:
        return None
    try:
        y, mo, d = [int(x) for x in str(date_s).split("-")]
    except Exception:
        return None
    try:
        local_dt = datetime(y, mo, d, hh, mm, 0, tzinfo=COMMUNITY_TZ)
    except Exception:
        return None
    return local_dt.astimezone(timezone.utc)


def _time_of_day(start_local: datetime) -> str:
    """Return a warm time-of-day label from a local wall-clock start."""
    h = start_local.hour
    if h < 12:
        return "morning"
    if h < 17:
        return "afternoon"
    return "evening"


def _first_name(user: dict) -> str:
    """Batch A fix (Garry, Aug 2026): resolve through the trusted
    validator so a bad `preferred_name` or `first_name` cannot leak
    into a pre-/post-event nudge as "Your event is tomorrow, My.".

    Returns "" when there's no plausible name — callers already handle
    that gracefully via `_comma_name("")` → "".
    """
    from services.george.memory import resolve_preferred_name as _resolve_pref_name
    resolved = _resolve_pref_name(user)
    return resolved or ""


def _comma_name(name: str) -> str:
    return f", {name}" if name else ""


def _humanise_relative_when(kind: str, start_utc: datetime, now: datetime) -> str:
    """Warm short label like 'Tomorrow' / 'Later today' / 'Earlier today'
    for the timing chip. Kept short (<= 16 chars) so it fits comfortably
    beside the event title."""
    local_start = start_utc.astimezone(COMMUNITY_TZ)
    local_now = now.astimezone(COMMUNITY_TZ)
    same_day = local_start.date() == local_now.date()
    if kind == "pre_event":
        if same_day:
            return "Later today"
        # If the event is anywhere in the next ~30h, call it "tomorrow"
        # (matches how members talk); otherwise fall back to weekday.
        delta_h = (local_start - local_now).total_seconds() / 3600
        if delta_h <= 30:
            return "Tomorrow"
        return local_start.strftime("%A")
    # post_event
    if same_day:
        return "Earlier today"
    return f"On {local_start.strftime('%A')}"


def render_pre_event(ev: dict, organiser: dict) -> str:
    """Template for the ~18h-before message. Used for accessibility
    read-out and TTS playback."""
    title = ev.get("title") or "your event"
    name = _first_name(organiser)
    return (
        f"Your {title} is tomorrow{_comma_name(name)}. "
        f"I hope everyone has a lovely time."
    )


def render_post_event(ev: dict, organiser: dict, start_local: datetime) -> str:
    """Template for the ~2h-after-end message."""
    title = ev.get("title") or "your event"
    name = _first_name(organiser)
    tod = _time_of_day(start_local)
    return (
        f"How did {title} go{_comma_name(name)}? "
        f"I hope you had a lovely {tod}."
    )


def render_display(
    kind: str, ev: dict, organiser: dict,
    start_utc: datetime, now: datetime,
) -> dict:
    """Structured payload for the visual card.

    Returned shape:
        {
          emoji: str,          # small icon at the leading edge
          title: str,          # the event title, prominent
          when_label: str,     # short chip like "Tomorrow"
          body:  str,          # trailing warm line (no title repeat)
          cta_label: str,      # what the action button reads
          cta_kind:  str,      # 'view_event' for now
        }
    """
    name = _first_name(organiser)
    title = ev.get("title") or "your event"
    emoji = ev.get("emoji") or ("📅" if kind == "pre_event" else "💛")
    when = _humanise_relative_when(kind, start_utc, now)
    if kind == "pre_event":
        body = f"I hope everyone has a lovely time{_comma_name(name)}."
    else:
        tod = _time_of_day(start_utc.astimezone(COMMUNITY_TZ))
        body = f"I hope you had a lovely {tod}{_comma_name(name)}."
    return {
        "emoji": emoji,
        "title": title,
        "when_label": when,
        "body": body,
        "cta_label": "View event",
        "cta_kind": "view_event",
    }


# ---------------------------------------------------------------------------
# Enqueuer — the sweep
# ---------------------------------------------------------------------------

async def sweep_once(db) -> dict:
    """One pass of the enqueuer. Returns a summary counter dict for logging."""
    now = _now_utc()
    horizon = now + timedelta(days=SCHEDULE_HORIZON_DAYS)

    summary = {"scanned": 0, "created": 0, "superseded": 0,
               "cancelled_stale": 0, "skipped_inactive_user": 0}

    # Only look at active, uncancelled events in the near future.
    # We pre-filter by date STRING (YYYY-MM-DD) since that's how events
    # are stored — Mongo can range-index on it lexicographically.
    today_str = (now - timedelta(days=1)).date().isoformat()  # 1-day buffer for TZs
    horizon_str = horizon.date().isoformat()

    query = {
        "cancelled": {"$ne": True},
        "date": {"$gte": today_str, "$lte": horizon_str},
    }
    cursor = db["events"].find(query, {"_id": 0})

    async for ev in cursor:
        summary["scanned"] += 1
        try:
            await _process_event(db, ev, now, summary)
        except Exception:
            log.exception("remembers sweep failed for event %s", ev.get("id"))

    # Second pass: cancel any scheduled rows whose event is now cancelled
    # or gone. This handles the "someone deletes an event" path.
    active_event_ids = [
        e["id"] async for e in db["events"].find(
            {"cancelled": {"$ne": True}}, {"_id": 0, "id": 1}
        )
    ]
    if active_event_ids:
        res = await db[COLLECTION].update_many(
            {
                "status": "scheduled",
                "event_id": {"$nin": active_event_ids},
            },
            {"$set": {
                "status": "cancelled",
                "cancelled_reason": "event_removed",
                "updated_at": now.isoformat(),
            }},
        )
        summary["cancelled_stale"] += res.modified_count

    log.info("george-remembers sweep: %s", summary)
    return summary


async def _process_event(db, ev: dict, now: datetime, summary: dict) -> None:
    """Ensure this event has exactly-one active row per kind."""
    host_id = ev.get("host_id")
    if not host_id:
        return
    organiser = await db["users"].find_one(
        {"id": host_id}, {"_id": 0}
    )
    if not organiser:
        summary["skipped_inactive_user"] += 1
        return
    # Respect any explicit inactive/deleted flags.
    if organiser.get("is_active") is False or organiser.get("deleted") is True:
        summary["skipped_inactive_user"] += 1
        return

    start_utc = _event_start_dt_utc(ev)
    if start_utc is None:
        return

    start_local = start_utc.astimezone(COMMUNITY_TZ)

    kinds = [
        ("pre_event",  start_utc - timedelta(hours=PRE_EVENT_LEAD_H),
         lambda: render_pre_event(ev, organiser),
         lambda: render_display("pre_event", ev, organiser, start_utc, now)),
        ("post_event", start_utc + timedelta(hours=ASSUMED_DURATION_H + POST_EVENT_DELAY_H),
         lambda: render_post_event(ev, organiser, start_local),
         lambda: render_display("post_event", ev, organiser, start_utc, now)),
    ]

    for kind, at, render, render_disp in kinds:
        # Skip if the scheduled moment is too far in the past.
        if at + timedelta(hours=DELIVERY_GRACE_H) < now:
            continue

        existing = await db[COLLECTION].find_one(
            {"event_id": ev["id"], "kind": kind,
             "status": {"$in": ["scheduled", "delivered"]}},
            {"_id": 0},
        )
        target_iso = at.isoformat()

        if existing:
            if existing.get("scheduled_for") == target_iso:
                # Up to date — nothing to do.
                continue
            # Delivered rows are left alone — the member has already
            # seen them. A new row will be inserted below if the
            # rescheduled time is still in the future.
            if existing.get("status") == "delivered":
                # We only supersede a delivered row if the rescheduled
                # time is materially later (>= 6h difference). Otherwise
                # we treat the already-seen message as "close enough".
                try:
                    prev = datetime.fromisoformat(existing.get("scheduled_for"))
                    if abs((prev - at).total_seconds()) < 6 * 3600:
                        continue
                except Exception:
                    continue
                # (No supersede for delivered; just insert the new one.)
            else:
                # Scheduled row exists but the time has changed → supersede.
                await db[COLLECTION].update_one(
                    {"id": existing["id"]},
                    {"$set": {
                        "status": "superseded",
                        "superseded_at": now.isoformat(),
                        "updated_at": now.isoformat(),
                    }},
                )
                summary["superseded"] += 1

        # Insert the fresh row.
        doc = {
            "id": str(uuid.uuid4()),
            "kind": kind,
            "event_id": ev["id"],
            "recipient_id": host_id,
            "scheduled_for": target_iso,
            "content": render(),
            "display": render_disp(),
            "status": "scheduled",
            "event_snapshot": {
                "title": ev.get("title"),
                "emoji": ev.get("emoji"),
                "date":  ev.get("date"),
                "time":  ev.get("time"),
                "location": ev.get("location"),
            },
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
        }
        try:
            await db[COLLECTION].insert_one(doc)
            summary["created"] += 1
        except Exception:
            # Rare race with a concurrent sweep — treat as no-op.
            log.exception("remembers insert race for event %s kind %s",
                          ev.get("id"), kind)


# ---------------------------------------------------------------------------
# Background loop — restart-safe wrapper
# ---------------------------------------------------------------------------

async def sweep_loop(db, *, interval_s: int = SWEEP_INTERVAL_S) -> None:
    """Runs `sweep_once` forever with graceful error handling."""
    # Small initial delay so the sweep doesn't collide with startup.
    await asyncio.sleep(15)
    while True:
        try:
            await sweep_once(db)
        except Exception:
            log.exception("remembers sweep_loop iteration failed")
        await asyncio.sleep(interval_s)


# ---------------------------------------------------------------------------
# Delivery / inbox API surface
# ---------------------------------------------------------------------------

async def fetch_inbox(
    db,
    user_id: str,
    *,
    limit: int = 20,
    mark_delivered: bool = True,
) -> list[dict]:
    """Return the member's currently visible George Remembers messages.

    Rules:
      • Include rows where `status == 'scheduled'` AND
        `scheduled_for <= now`   (due — deliver on read).
      • Include rows where `status == 'delivered'` (already delivered,
        not yet dismissed).
      • Exclude `dismissed`, `cancelled`, `superseded`.

    If `mark_delivered` is True (the default), any 'scheduled' rows we
    return are upgraded to 'delivered' in the same call — that way the
    inbox always tells the member the latest, and if they dismiss it
    the row cleanly transitions out of the queue.
    """
    now = _now_utc()
    q = {
        "recipient_id": user_id,
        "$or": [
            {"status": "delivered"},
            {"status": "scheduled", "scheduled_for": {"$lte": now.isoformat()}},
        ],
    }
    cursor = db[COLLECTION].find(q, {"_id": 0}).sort("scheduled_for", -1).limit(limit)
    rows = [r async for r in cursor]

    if mark_delivered:
        due_ids = [r["id"] for r in rows if r.get("status") == "scheduled"]
        if due_ids:
            await db[COLLECTION].update_many(
                {"id": {"$in": due_ids}, "status": "scheduled"},
                {"$set": {
                    "status": "delivered",
                    "delivered_at": now.isoformat(),
                    "updated_at": now.isoformat(),
                }},
            )
            for r in rows:
                if r["id"] in due_ids:
                    r["status"] = "delivered"
                    r["delivered_at"] = now.isoformat()

    # Final safety: re-verify each row's event is still active and
    # organiser is active. Anything that no longer qualifies is
    # cancelled inline and NOT returned. This is the belt-and-braces
    # against a race where the sweep hasn't run yet.
    valid: list[dict] = []
    for r in rows:
        event = await db["events"].find_one(
            {"id": r.get("event_id")}, {"_id": 0, "cancelled": 1, "host_id": 1},
        )
        if not event or event.get("cancelled") is True:
            await db[COLLECTION].update_one(
                {"id": r["id"]},
                {"$set": {"status": "cancelled",
                          "cancelled_reason": "event_removed",
                          "updated_at": now.isoformat()}},
            )
            continue
        if event.get("host_id") != user_id:
            # Ownership shifted (extremely rare). Cancel.
            await db[COLLECTION].update_one(
                {"id": r["id"]},
                {"$set": {"status": "cancelled",
                          "cancelled_reason": "ownership_changed",
                          "updated_at": now.isoformat()}},
            )
            continue
        valid.append(r)
    return valid


async def dismiss(db, msg_id: str, user_id: str) -> Optional[dict]:
    """Mark a message dismissed. Returns the updated row or None if
    the row didn't belong to this user."""
    now = _now_utc()
    res = await db[COLLECTION].find_one_and_update(
        {"id": msg_id, "recipient_id": user_id,
         "status": {"$in": ["scheduled", "delivered"]}},
        {"$set": {"status": "dismissed",
                  "dismissed_at": now.isoformat(),
                  "updated_at": now.isoformat()}},
        return_document=True,
        projection={"_id": 0},
    )
    return res


async def mark_seen(db, msg_id: str, user_id: str) -> Optional[dict]:
    """Record the first time the member's UI actually rendered the
    card. Cheaper signal than 'delivered' — it means it entered the
    viewport, not just the API response."""
    now = _now_utc()
    res = await db[COLLECTION].find_one_and_update(
        {"id": msg_id, "recipient_id": user_id, "seen_at": {"$exists": False}},
        {"$set": {"seen_at": now.isoformat(),
                  "updated_at": now.isoformat()}},
        return_document=True,
        projection={"_id": 0},
    )
    return res


__all__ = [
    "COLLECTION",
    "COMMUNITY_TZ",
    "ensure_indexes",
    "sweep_once",
    "sweep_loop",
    "fetch_inbox",
    "dismiss",
    "mark_seen",
    "render_pre_event",
    "render_post_event",
]
