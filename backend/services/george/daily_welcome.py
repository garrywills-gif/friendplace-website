"""George's daily welcome — the "walking into your favourite café" hello.

Storage-driven so Garry (or any future admin) can add, retire, or
seasonally schedule greetings without touching code. See
`/app/memory/design-morning-welcome.md` for the design intent.

Two collections:
- ``george_greetings``: the pool. Each row is one line of greeting
  (opener OR invitation), scoped to a time-of-day band, optionally
  seasonal (valid_from / valid_to inclusive).
- ``george_daily_welcome_state``: per-user "last greeted on calendar
  date X" bookkeeping so the greeting fires exactly once per local
  calendar day.

Locked with Garry, 1 Aug 2026.
"""
from __future__ import annotations

import logging
import random
import uuid
from datetime import datetime, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

log = logging.getLogger("friendplace.george.daily_welcome")

GREETINGS_COLLECTION = "george_greetings"
STATE_COLLECTION = "george_daily_welcome_state"
DEFAULT_TZ = "Australia/Melbourne"

# ── Bands ─────────────────────────────────────────────────────────────
BANDS = ("morning", "afternoon", "evening")


def band_for_hour(hour: int) -> str:
    """Locked with Garry, 1 Aug 2026:
      morning  05:00 - 11:59
      afternoon 12:00 - 16:59
      evening   17:00 - 04:59  (wraps midnight)
    """
    if 5 <= hour <= 11:
        return "morning"
    if 12 <= hour <= 16:
        return "afternoon"
    return "evening"  # 17-23 and 0-4


def _today_key(tz_name: str) -> str:
    """YYYYMMDD in the user's local timezone. Different days = different keys."""
    try:
        tz = ZoneInfo(tz_name or DEFAULT_TZ)
    except Exception:
        tz = ZoneInfo(DEFAULT_TZ)
    return datetime.now(tz).strftime("%Y%m%d")


# ── Indexes ──────────────────────────────────────────────────────────
async def ensure_indexes(db: Any) -> None:
    try:
        await db[GREETINGS_COLLECTION].create_index("kind")
        await db[GREETINGS_COLLECTION].create_index("band")
        await db[GREETINGS_COLLECTION].create_index("active")
        await db[GREETINGS_COLLECTION].create_index("valid_from")
        await db[GREETINGS_COLLECTION].create_index("valid_to")
        await db[STATE_COLLECTION].create_index("user_id", unique=True)
    except Exception as e:
        log.warning("daily_welcome ensure_indexes: %s", e)


# ── Seed the initial pool from Garry's approved wording ──────────────
_SEED_ROWS: list[dict] = [
    # Morning openers
    {"band": "morning",   "kind": "opener",       "text": "Good morning, {first_name}."},
    {"band": "morning",   "kind": "opener",       "text": "Morning, {first_name}."},
    {"band": "morning",   "kind": "opener",       "text": "Lovely to see you this morning, {first_name}."},
    # Afternoon openers
    {"band": "afternoon", "kind": "opener",       "text": "Good afternoon, {first_name}."},
    {"band": "afternoon", "kind": "opener",       "text": "Nice to see you this afternoon, {first_name}."},
    {"band": "afternoon", "kind": "opener",       "text": "Hope you're having a lovely day, {first_name}."},
    # Evening openers
    {"band": "evening",   "kind": "opener",       "text": "Good evening, {first_name}."},
    {"band": "evening",   "kind": "opener",       "text": "It's lovely to see you this evening, {first_name}."},
    {"band": "evening",   "kind": "opener",       "text": "I hope you've had a good day, {first_name}."},
    # Warm thoughts — non-question follow-ups. Some are cross-band, some tuned.
    {"band": "any",       "kind": "warm_thought", "text": "It's lovely to see you."},
    {"band": "any",       "kind": "warm_thought", "text": "I hope today brings a little something to smile about."},
    {"band": "any",       "kind": "warm_thought", "text": "I hope today has something lovely in store."},
    {"band": "morning",   "kind": "warm_thought", "text": "Hope the day is treating you kindly so far."},
    {"band": "evening",   "kind": "warm_thought", "text": "I hope you've had a gentle day."},
    # Invitations (the "what's your moment" prompt and its softer variants)
    {"band": "any",       "kind": "invitation",   "text": "\u2728 What's your moment today?", "weight": 4},
    {"band": "any",       "kind": "invitation",   "text": "I wonder what today will bring."},
    {"band": "any",       "kind": "invitation",   "text": "What's the little something on your mind today?"},
]


async def seed_defaults(db: Any) -> dict:
    """Idempotent seed. Only inserts rows that don't already have the
    same text — so admins can rename or retire an entry without it
    coming back on the next backend restart."""
    inserted = 0
    for row in _SEED_ROWS:
        existing = await db[GREETINGS_COLLECTION].find_one({"text": row["text"]})
        if existing:
            continue
        doc = {
            "id": str(uuid.uuid4()),
            "band": row["band"],
            "kind": row["kind"],
            "text": row["text"],
            "weight": int(row.get("weight", 1)),
            "active": True,
            "valid_from": None,
            "valid_to": None,
            "notes": row.get("notes"),
            "created_at": datetime.now(timezone.utc),
            "created_by": "seed",
        }
        await db[GREETINGS_COLLECTION].insert_one(doc)
        inserted += 1
    return {"inserted": inserted}


# ── Pool query ────────────────────────────────────────────────────────
async def _pool(
    db: Any,
    *,
    kind: str,
    band: str,
    now_utc: datetime,
    active_contexts: Optional[set[str]] = None,
) -> list[dict]:
    """Return the active pool of rows for the given kind+band, honouring
    seasonal windows. Bands can match the row's band OR the wildcard
    "any" — invitations use "any" so one pool serves all times of day.

    Context-aware filtering (Garry, 1 Aug 2026):
        Each greeting document may declare a `context_conflicts` array —
        surface tags describing UI it would echo if shown. When any of
        the caller's `active_contexts` appears in that array, the row
        is dropped. This lets us teach George "don't ask what's your
        moment today when the interface is already asking" without
        hard-coding an exception into the endpoint.

        The field is optional; older greetings without it are always
        kept. Passing `active_contexts=None` or an empty set disables
        filtering entirely.
    """
    q: dict = {
        "kind": kind,
        "active": True,
        "band": {"$in": [band, "any"]},
        "$and": [
            {"$or": [{"valid_from": None}, {"valid_from": {"$lte": now_utc}}]},
            {"$or": [{"valid_to": None}, {"valid_to": {"$gte": now_utc}}]},
        ],
    }
    proj = {"_id": 0, "id": 1, "band": 1, "kind": 1, "text": 1, "weight": 1, "context_conflicts": 1}
    rows: list[dict] = []
    async for r in db[GREETINGS_COLLECTION].find(q, proj):
        # Client-side context filter — small pools, so cheaper and
        # clearer than trying to express it in the Mongo query.
        if active_contexts:
            conflicts = r.get("context_conflicts") or []
            if any(tag in active_contexts for tag in conflicts):
                continue
        rows.append(r)
    return rows


def _weighted_choice(rows: list[dict]) -> Optional[dict]:
    if not rows:
        return None
    weights = [max(1, int(r.get("weight", 1) or 1)) for r in rows]
    return random.choices(rows, weights=weights, k=1)[0]


# ── The public entry point ────────────────────────────────────────────
async def get_daily_welcome(
    db: Any,
    *,
    user: dict,
    tz_name: Optional[str] = None,
    force: bool = False,
    active_contexts: Optional[list[str]] = None,
) -> dict:
    """Return the greeting payload for this user's first-open-of-day.

    Args:
        user: the current user document (or a slim {id, first_name} shape).
        tz_name: user's local timezone (defaults to DEFAULT_TZ).
        force: skip the once-per-day gate (used by previews and by
            Mission Control to sanity-check the pool).
        active_contexts: surface-context tags currently visible on the
            caller's screen (e.g. ["home:share_a_moment_hero"]). Any
            greeting whose `context_conflicts` intersects with this
            list is filtered out — so George doesn't echo what the UI
            is already saying. Optional; None disables filtering.

    Returns:
        {
          shown: True,
          opener: "Morning, Margaret.",
          invitation: "✨ What's your moment today?",
          callback: "I hope your dentist appointment went well." | None,
          band: "morning",
          date: "20260801",
        }
        OR {shown: False} if already greeted today.
    """
    user_id = str(user.get("id") or "")
    # Batch A fix (Garry, Aug 2026 — "George called me 'My'"): resolve
    # the display name through the trusted validator so a bad
    # preferred_name from onboarding, or a bad first_name, can never
    # leak into a greeting. Falls back to first_name (also validated)
    # then to no-name at all. NEVER substitutes another field.
    from services.george.memory import (
        resolve_preferred_name as _resolve_pref_name,
        pick_recall_thought as _pick_recall_thought,
    )
    first_name = _resolve_pref_name(user) or ""
    tz_name = tz_name or user.get("timezone") or DEFAULT_TZ
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo(DEFAULT_TZ)
    now_local = datetime.now(tz)
    now_utc = datetime.now(timezone.utc)
    today = now_local.strftime("%Y%m%d")
    band = band_for_hour(now_local.hour)

    # Once-per-calendar-day gate.
    if user_id and not force:
        existing = await db[STATE_COLLECTION].find_one(
            {"user_id": user_id}, {"_id": 0, "last_date": 1},
        )
        if existing and existing.get("last_date") == today:
            return {"shown": False}

    def _fmt(txt: str) -> str:
        """Substitute the member's name into a template. When we
        DON'T have a trusted name, we render the greeting without a
        name entirely — never as ", ." or with a placeholder. This
        collapses "Good morning, {first_name}." to "Good morning."
        cleanly."""
        raw = txt or ""
        if not first_name:
            # Strip a leading comma+space right before {first_name} so
            # "Good morning, {first_name}." → "Good morning."
            # rather than "Good morning, ."
            raw = raw.replace(", {first_name}", "")
            # Also handle a stray space+placeholder ("Hello {first_name}.")
            raw = raw.replace(" {first_name}", "")
            # Anything remaining is a bare {first_name} — drop it.
            raw = raw.replace("{first_name}", "")
            return raw
        return raw.replace("{first_name}", first_name)

    # Choose the SHAPE of the greeting first — that's what makes George
    # feel human rather than templated.
    #
    # Rhythm locked with Garry, 1 Aug 2026:
    #   > Greeting → one warm thought OR one invitation → done.
    #   > Never both. The shorter George is, the more natural he feels.
    #
    # Shape distribution (three shapes only, no combined thought+invitation):
    #   30% opener only
    #   35% opener + warm_thought
    #   35% opener + invitation
    #
    # If a callback fires today, it takes the place of the warm_thought
    # (see below) — a callback IS a warm thought, just a specific one.
    _SHAPES = (
        ("opener_only",         30),
        ("opener_thought",      35),
        ("opener_invitation",   35),
    )
    shape = random.choices(
        [s[0] for s in _SHAPES], weights=[s[1] for s in _SHAPES], k=1,
    )[0]

    # Normalise the active-context list into a frozen set the pool
    # helper can cheaply intersect against each row's context_conflicts.
    active_ctx: set[str] = {c.strip() for c in (active_contexts or []) if c and c.strip()}

    # Draw the opener (always).
    opener_row = _weighted_choice(
        await _pool(db, kind="opener", band=band, now_utc=now_utc, active_contexts=active_ctx),
    )
    opener_text = _fmt(opener_row["text"]) if opener_row else (
        f"Hello, {first_name}." if first_name else "Hello."
    )

    warm_thought_text: Optional[str] = None
    invitation_text: Optional[str] = None

    # Batch A (Garry, Aug 2026 — "George should remember the person"):
    # If the member has any interests recorded, occasionally use a
    # warm memory-aware recall line ("How's the garden going?") in
    # place of a generic warm thought. Rate-limited to roughly one
    # in three eligible days so it feels like a natural human aside,
    # never a mechanical recap.
    if "thought" in shape:
        used_recall = False
        recall_line = _pick_recall_thought(user)
        if recall_line:
            # Deterministic per-day gate — same member+day always
            # yields the same True/False, so a member can't game it
            # by refreshing. Roughly 1 in 3 eligible days.
            import hashlib as _hl
            gate_key = f"{user_id}-{today}-recall"
            if int(_hl.sha1(gate_key.encode()).hexdigest(), 16) % 3 == 0:
                warm_thought_text = recall_line
                used_recall = True

        if not used_recall:
            wt_row = _weighted_choice(
                await _pool(db, kind="warm_thought", band=band, now_utc=now_utc, active_contexts=active_ctx),
            )
            if wt_row:
                wt_text = _fmt(wt_row["text"])
                # Small phrase-collision guard: some openers already say
                # "lovely to see you" or "nice to see you", so pairing them
                # with the "It's lovely to see you." warm thought reads
                # duplicative. Drop the warm thought in that case rather
                # than pick a different one — natural conversation often
                # is just the opener.
                _o_lower = opener_text.lower()
                _w_lower = wt_text.lower()
                collides = (
                    ("lovely to see you" in _o_lower and "lovely to see you" in _w_lower)
                    or ("nice to see you" in _o_lower and "lovely to see you" in _w_lower)
                    or ("hope" in _o_lower and _w_lower.startswith("i hope"))
                )
                if not collides:
                    warm_thought_text = wt_text

    if "invitation" in shape:
        inv_row = _weighted_choice(
            await _pool(db, kind="invitation", band=band, now_utc=now_utc, active_contexts=active_ctx),
        )
        if inv_row:
            invitation_text = _fmt(inv_row["text"])

    # Occasional callback from George Remembers ("hope the dentist went
    # well" etc). When we wire that feature, if a caring callback
    # exists it REPLACES the warm_thought slot for the day (a callback
    # IS a warm thought — just a specific, personal one). Falling back
    # to None here so the shape stays valid until Remembers ships.
    callback: Optional[str] = None
    if callback and shape == "opener_thought":
        warm_thought_text = callback

    # Bookkeep. Do it even for force=True so a preview doesn't leave the
    # user greeting-less on their real open — actually, only bookkeep
    # when NOT forced, so admins can preview without burning the user's
    # once-per-day slot.
    if user_id and not force:
        await db[STATE_COLLECTION].update_one(
            {"user_id": user_id},
            {
                "$set": {
                    "user_id": user_id,
                    "last_date": today,
                    "last_at": now_utc,
                    "last_band": band,
                    "last_shape": shape,
                    "last_opener_id": opener_row.get("id") if opener_row else None,
                },
            },
            upsert=True,
        )

    return {
        "shown": True,
        "opener": opener_text,
        "warm_thought": warm_thought_text,
        "invitation": invitation_text,
        "callback": callback,
        "shape": shape,
        "band": band,
        "date": today,
    }


# ── Admin CRUD helpers ────────────────────────────────────────────────
async def list_greetings(db: Any) -> list[dict]:
    proj = {"_id": 0}
    rows: list[dict] = []
    async for r in db[GREETINGS_COLLECTION].find({}, proj).sort([("band", 1), ("kind", 1), ("text", 1)]):
        for k in ("created_at", "valid_from", "valid_to"):
            v = r.get(k)
            if hasattr(v, "isoformat"):
                r[k] = v.isoformat()
        rows.append(r)
    return rows


async def upsert_greeting(db: Any, patch: dict) -> dict:
    now = datetime.now(timezone.utc)
    gid = patch.get("id") or str(uuid.uuid4())
    # Normalise context_conflicts — accept a list of strings, dedupe,
    # strip whitespace, drop empties. This is the surface-tag field
    # that lets admins teach George "don't say this here" without
    # hard-coding an exception (Garry, 1 Aug 2026).
    raw_ctx = patch.get("context_conflicts") or []
    if isinstance(raw_ctx, str):
        raw_ctx = [t.strip() for t in raw_ctx.split(",")]
    ctx_conflicts = sorted({t.strip() for t in raw_ctx if isinstance(t, str) and t.strip()})
    doc = {
        "id": gid,
        "band": patch.get("band") or "any",
        "kind": patch.get("kind") or "opener",
        "text": (patch.get("text") or "").strip(),
        "weight": max(1, int(patch.get("weight") or 1)),
        "active": bool(patch.get("active", True)),
        "valid_from": patch.get("valid_from"),
        "valid_to": patch.get("valid_to"),
        "notes": patch.get("notes"),
        "context_conflicts": ctx_conflicts,
        "updated_at": now,
    }
    if not doc["text"]:
        raise ValueError("Greeting text is required")
    if doc["band"] not in ("morning", "afternoon", "evening", "any"):
        raise ValueError(f"Unknown band: {doc['band']}")
    if doc["kind"] not in ("opener", "invitation", "warm_thought", "seasonal"):
        raise ValueError(f"Unknown kind: {doc['kind']}")
    await db[GREETINGS_COLLECTION].update_one(
        {"id": gid},
        {"$set": doc, "$setOnInsert": {"created_at": now, "created_by": patch.get("created_by") or "admin"}},
        upsert=True,
    )
    saved = await db[GREETINGS_COLLECTION].find_one({"id": gid}, {"_id": 0})
    for k in ("created_at", "updated_at", "valid_from", "valid_to"):
        v = (saved or {}).get(k)
        if hasattr(v, "isoformat"):
            saved[k] = v.isoformat()
    return saved or doc


async def delete_greeting(db: Any, gid: str) -> bool:
    r = await db[GREETINGS_COLLECTION].delete_one({"id": gid})
    return r.deleted_count > 0
