"""
Presence & Status — business logic.

Implements FriendPlace's presence/status feature per the LOCKED design
doc at `/app/memory/design-presence-and-status.md`. Reading that first
will save you a lot of head-scratching about precedence and auto-clear.

Scope of this module (Commit 1 of 3):
  • One MongoDB collection: `member_status` (upsert-per-user).
  • Six pure functions the router + hooks call:
      - get_status(db, user_id) → dict          (effective + raw)
      - set_manual(db, user_id, status)         (manual toggle)
      - heartbeat(db, user_id)                  (bump last_seen_at)
      - list_looking(db, viewer_id, scope)      (banner data)
      - status_for_users(db, ids)               (batch lookup)
      - auto_clear(db, user_id, trigger, evt)   (server-side triggers)
  • ensure_indexes(db) — called at startup.
  • compute_effective_status(doc) — the ONLY source of truth for what
    glyph any consumer displays. Callers pass a `member_status` doc
    (nullable) and receive the current effective status string.

This module has ZERO knowledge of routing, WebSockets, or the wire
format. The router (`router.py`) owns HTTP shape. Broadcast hooks live
in the calling code (e.g. the DM message handler in server.py calls
`auto_clear(...)` and then broadcasts if that returns True).
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any, Iterable, Optional

# ─── Constants ──────────────────────────────────────────────────────

COLL = "member_status"

# Manual status keys members can set.
MANUAL_LOOKING = "looking"
MANUAL_HAPPY = "happy"
MANUAL_BUSY = "busy"
MANUAL_KEYS = {MANUAL_LOOKING, MANUAL_HAPPY, MANUAL_BUSY}

# Effective statuses returned to clients.
EFFECTIVE_ORDER = ("offline", "looking", "in_cafe", "busy", "happy", "online")

# TTLs per manual status (seconds).
TTL_LOOKING = 60 * 60          # 60 min per LOCKED spec §5 answer
TTL_HAPPY   = 24 * 60 * 60     # 24 h
TTL_BUSY    = 4 * 60 * 60      # 4 h
TTL_BY_KEY  = {
    MANUAL_LOOKING: TTL_LOOKING,
    MANUAL_HAPPY:   TTL_HAPPY,
    MANUAL_BUSY:    TTL_BUSY,
}

# Presence threshold — no heartbeat for this many seconds → offline.
OFFLINE_AFTER_SEC = 5 * 60

# Auto-clear trigger names (audit trail on the returned event).
TRIG_DM_MESSAGE    = "dm_message"
TRIG_CAFE_JOIN     = "cafe_join"
TRIG_CAFE_JOINED_BY = "cafe_joined_by"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware(dt: Optional[datetime]) -> Optional[datetime]:
    """MongoDB returns naive datetimes (assumed UTC). Coerce to aware so
    comparisons with `_utc_now()` don't raise."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


# ─── Indexes ────────────────────────────────────────────────────────

async def ensure_indexes(db) -> None:
    """Idempotent — safe to call on every startup."""
    await db[COLL].create_index("user_id", unique=True)
    # Partial: only non-null manual statuses. Powers the "who's looking" query.
    await db[COLL].create_index(
        [("manual_status", 1), ("manual_status_set_at", -1)],
        partialFilterExpression={"manual_status": {"$type": "string"}},
    )
    await db[COLL].create_index("manual_status_expires_at")
    await db[COLL].create_index(
        "in_cafe_table_id",
        partialFilterExpression={"in_cafe_table_id": {"$type": "string"}},
    )


# ─── Core compute ───────────────────────────────────────────────────

def compute_effective_status(doc: Optional[dict]) -> str:
    """LOCKED precedence: Offline > Looking > In FP Café > Busy right now
       > Happy to connect > Online. `doc` may be None (no record yet)."""
    now = _utc_now()
    if not doc:
        return "offline"

    last_seen = _as_aware(doc.get("last_seen_at"))
    if not last_seen or (now - last_seen).total_seconds() > OFFLINE_AFTER_SEC:
        return "offline"

    manual = doc.get("manual_status")
    exp = _as_aware(doc.get("manual_status_expires_at"))
    manual_active = bool(manual in MANUAL_KEYS and exp and exp > now)

    if manual_active and manual == MANUAL_LOOKING:
        return "looking"
    if doc.get("in_cafe_table_id"):
        return "in_cafe"
    if manual_active and manual == MANUAL_BUSY:
        return "busy"
    if manual_active and manual == MANUAL_HAPPY:
        return "happy"
    return "online"


def _shape(doc: Optional[dict], user_id: str) -> dict:
    """Client-facing view of a status doc."""
    effective = compute_effective_status(doc)
    return {
        "user_id": user_id,
        "effective": effective,
        "manual": (doc or {}).get("manual_status"),
        "manual_set_at": (doc or {}).get("manual_status_set_at"),
        "manual_expires_at": (doc or {}).get("manual_status_expires_at"),
        "in_cafe_table_id": (doc or {}).get("in_cafe_table_id"),
        "last_seen_at": (doc or {}).get("last_seen_at"),
    }


# ─── Public API used by router.py + hooks ───────────────────────────

async def get_status(db, user_id: str) -> dict:
    doc = await db[COLL].find_one({"user_id": user_id})
    return _shape(doc, user_id)


async def set_manual(db, user_id: str, status: Optional[str]) -> dict:
    """Set or clear the manual status. Pass None (or 'clear'/'') to clear.

    Setting manual_status to a valid key resets manual_status_set_at to
    `now`. That timestamp is critical — the DM auto-clear hook only
    fires on messages whose `created_at > manual_status_set_at` (§2
    clarification, Garry Feb 2026)."""
    now = _utc_now()
    if status in (None, "", "clear"):
        update = {
            "$set": {
                "manual_status": None,
                "manual_status_set_at": None,
                "manual_status_expires_at": None,
                "updated_at": now,
            },
            "$setOnInsert": {"user_id": user_id, "last_seen_at": now},
        }
    else:
        if status not in MANUAL_KEYS:
            raise ValueError(f"invalid manual status: {status!r}")
        ttl = TTL_BY_KEY[status]
        update = {
            "$set": {
                "manual_status": status,
                "manual_status_set_at": now,
                "manual_status_expires_at": now + timedelta(seconds=ttl),
                "updated_at": now,
                "last_seen_at": now,  # setting a manual status counts as activity
            },
            "$setOnInsert": {"user_id": user_id},
        }
    await db[COLL].update_one({"user_id": user_id}, update, upsert=True)
    return await get_status(db, user_id)


async def heartbeat(db, user_id: str) -> None:
    """Bump last_seen_at. Called every 60s from the client while foregrounded.

    iter154 (June 2026): the DM/Chats list, coffee-table peer view and
    several older endpoints read presence from `db.users.last_seen_at`
    — a legacy collection separate from `member_status`. Writing to
    just `member_status` here silently left every "who's online" surface
    off by the age of the last DB write. We mirror the timestamp to
    `db.users.last_seen_at` on every heartbeat so BOTH systems stay in
    sync until we eventually consolidate them. Locked with Garry.
    """
    now = _utc_now()
    await db[COLL].update_one(
        {"user_id": user_id},
        {
            "$set": {"last_seen_at": now, "updated_at": now},
            "$setOnInsert": {"user_id": user_id},
        },
        upsert=True,
    )
    # Mirror to the legacy users.last_seen_at column. Best-effort —
    # a failure here must not fail the heartbeat because member_status
    # (the modern collection) has already been updated above.
    try:
        await db.users.update_one({"id": user_id}, {"$set": {"last_seen_at": now.isoformat()}})
    except Exception:
        pass


async def sign_off(db, user_id: str) -> None:
    """Immediately mark a user as offline. Called by the client on
    logout / sign-out so their status reflects reality within the
    same 30s poll cycle instead of decaying naturally over the
    5-minute stale-heartbeat window.

    Approach: back-date last_seen_at to 10 minutes ago (2× the
    5-minute offline threshold in compute_effective_status) and clear
    any manual status. Also drops café presence so a user who signs
    out while seated doesn't linger in the café roster.

    Bug fix (Garry, 25 Jun 2026): admin signed out at 10:09pm and
    still showed 🟢 online on other members' devices at 10:14pm — the
    5-minute offline decay was too slow, and observers who cached
    admin's status just before he logged out held onto "online" until
    the next batch refresh at t+30s. This endpoint gives every
    observer a definitive "offline" answer immediately.
    """
    from datetime import timedelta as _td
    stale = _utc_now() - _td(minutes=10)
    now = _utc_now()
    await db[COLL].update_one(
        {"user_id": user_id},
        {
            "$set": {
                "last_seen_at": stale,
                "manual_status": None,
                "manual_status_set_at": None,
                "manual_status_expires_at": None,
                "in_cafe_table_id": None,
                "in_cafe_since": None,
                "updated_at": now,
            },
            "$setOnInsert": {"user_id": user_id},
        },
        upsert=True,
    )


async def set_in_cafe(db, user_id: str, table_id: Optional[str]) -> None:
    """Called by the café join/leave handlers. `table_id=None` means the
    member left the café."""
    now = _utc_now()
    if table_id:
        await db[COLL].update_one(
            {"user_id": user_id},
            {
                "$set": {
                    "in_cafe_table_id": table_id,
                    "in_cafe_since": now,
                    "last_seen_at": now,
                    "updated_at": now,
                },
                "$setOnInsert": {"user_id": user_id},
            },
            upsert=True,
        )
    else:
        await db[COLL].update_one(
            {"user_id": user_id},
            {
                "$set": {
                    "in_cafe_table_id": None,
                    "in_cafe_since": None,
                    "updated_at": now,
                },
            },
        )


# ─── The Looking list ───────────────────────────────────────────────

async def list_looking(
    db,
    viewer_id: str,
    scope: str = "nearby",
    limit: int = 30,
) -> list[dict]:
    """Return members currently `looking`, filtered per the LOCKED
    privacy rules in design doc §7:
      • Never include the viewer themselves.
      • Never include members the viewer has blocked, nor members who
        have blocked the viewer.
      • For `scope='nearby'` (default): only include members whose
        Nearby Opt-In is enabled AND whose suburb matches the viewer's.
      • `scope='friends'`: only members who are the viewer's friends.
      • `scope='all'`: everyone `looking` (respecting blocks) — reserved
        for admin/debug; clients use nearby by default.

    Expired `manual_status_expires_at` docs are filtered out.
    """
    now = _utc_now()
    # Motor stores tz-aware datetimes but returns naive on read from
    # some Mongo versions. For the query itself we pass tz-aware which
    # PyMongo accepts and normalizes to UTC internally.
    q: dict = {
        "manual_status": MANUAL_LOOKING,
        "manual_status_expires_at": {"$gt": now.replace(tzinfo=None)},
        "last_seen_at": {"$gt": (now - timedelta(seconds=OFFLINE_AFTER_SEC)).replace(tzinfo=None)},
        "user_id": {"$ne": viewer_id},
    }

    # Load candidate status docs first (small set).
    docs = await db[COLL].find(q).sort("manual_status_set_at", -1).to_list(200)
    if not docs:
        return []

    candidate_ids = [d["user_id"] for d in docs]

    # Blocks (bidirectional).
    viewer = await db.users.find_one({"id": viewer_id}, {"blocked_ids": 1, "suburb": 1})
    viewer_blocked = set(viewer.get("blocked_ids") or []) if viewer else set()
    # Members who have blocked the viewer.
    blocked_by_them = await db.users.find(
        {"id": {"$in": candidate_ids}, "blocked_ids": viewer_id},
        {"id": 1},
    ).to_list(len(candidate_ids))
    hidden_by_block = viewer_blocked | {u["id"] for u in blocked_by_them}

    # Scope filter.
    id_filter: dict = {"id": {"$in": [x for x in candidate_ids if x not in hidden_by_block]}}
    if scope == "nearby":
        id_filter["nearby_opt_in"] = True
        if viewer and viewer.get("suburb"):
            id_filter["suburb"] = viewer["suburb"]
    elif scope == "friends":
        friend_rels = await db.friendships.find(
            {"$or": [{"user_a": viewer_id}, {"user_b": viewer_id}], "status": "accepted"},
            {"user_a": 1, "user_b": 1},
        ).to_list(500)
        friend_ids = {r["user_a"] if r["user_b"] == viewer_id else r["user_b"] for r in friend_rels}
        id_filter["id"] = {"$in": [x for x in id_filter["id"]["$in"] if x in friend_ids]}
    # 'all' scope: no additional filter beyond blocks.

    users = await db.users.find(
        id_filter,
        {"id": 1, "name": 1, "first_name": 1, "username": 1, "avatar_url": 1, "suburb": 1, "_id": 0},
    ).to_list(limit)
    by_id = {u["id"]: u for u in users}

    # Preserve the original sort (newest looking first).
    out: list[dict] = []
    for d in docs:
        u = by_id.get(d["user_id"])
        if not u:
            continue
        # Real member accounts store the display name in `first_name`;
        # the historical `name` field only exists on synthetic test
        # fixtures. Fall back through both plus username so the banner
        # never renders the generic "Member" placeholder unless the
        # account genuinely lacks any name at all.
        display = u.get("name") or u.get("first_name") or u.get("username")
        out.append({
            "user_id": u["id"],
            "name": display,
            "avatar_url": u.get("avatar_url"),
            "suburb": u.get("suburb"),
            "since": d.get("manual_status_set_at"),
            "in_cafe_table_id": d.get("in_cafe_table_id"),
        })
        if len(out) >= limit:
            break
    return out


async def status_for_users(db, ids: Iterable[str]) -> dict[str, str]:
    """Batch lookup used by list-view screens (Find Friends, DMs, groups, etc.)
    Returns { user_id: effective_status }."""
    ids_list = list({x for x in ids if x})
    if not ids_list:
        return {}
    docs = await db[COLL].find({"user_id": {"$in": ids_list}}).to_list(len(ids_list))
    by_id = {d["user_id"]: d for d in docs}
    return {uid: compute_effective_status(by_id.get(uid)) for uid in ids_list}


# ─── Auto-off triggers ──────────────────────────────────────────────

async def auto_clear(
    db,
    user_id: str,
    trigger: str,
    event_time: Optional[datetime] = None,
) -> bool:
    """Called by other subsystems when something happens that should
    end the member's "Looking for a chat" session.

    Returns True if the manual status was actually cleared (caller
    should broadcast a `status_change` to any subscribed WebSocket).
    Returns False if the member wasn't looking anyway (no-op).

    For `trigger='dm_message'`, `event_time` MUST be provided — the
    caller passes the message's `created_at`. If that timestamp is
    older than the member's `manual_status_set_at`, we DO NOT clear
    (this is the "historical thread" exclusion Garry required).

    For café triggers (`cafe_join` / `cafe_joined_by`), `event_time`
    is optional and defaults to `now`. Any café-join event is by
    definition a new contact, so there is no historical exclusion.
    """
    doc = await db[COLL].find_one({"user_id": user_id})
    if not doc or doc.get("manual_status") != MANUAL_LOOKING:
        return False

    set_at = _as_aware(doc.get("manual_status_set_at"))
    now = _utc_now()

    if trigger == TRIG_DM_MESSAGE:
        if event_time is None:
            # Defensive: caller should have supplied it. Refuse to clear
            # rather than risk clearing on a historical message.
            return False
        event_time = _as_aware(event_time)
        if set_at and event_time <= set_at:
            return False  # historical message — must not clear (Garry Feb 2026)
    elif trigger in (TRIG_CAFE_JOIN, TRIG_CAFE_JOINED_BY):
        pass  # no time gate
    else:
        return False  # unknown trigger — refuse silently

    result = await db[COLL].update_one(
        {"user_id": user_id, "manual_status": MANUAL_LOOKING},
        {"$set": {
            "manual_status": None,
            "manual_status_set_at": None,
            "manual_status_expires_at": None,
            "auto_cleared_at": now,
            "auto_cleared_reason": trigger,
            "updated_at": now,
        }},
    )
    return result.modified_count == 1
