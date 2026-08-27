"""Outreach organisations store (iter160a).

Collection: outreach_organisations
Fields:
    id, organisation_name, contact_name, email, phone, category, tags,
    suburb, state, notes, status, last_contact_at, last_reply_at,
    communications (append-only history), created_at, updated_at,
    created_by, is_test, outreach_number

Contact status is denormalised into `status` for fast filtering AND
computed on the fly in services/crm/status.py for consistency. Send
worker + mark_replied() keep this field in sync.

iter164ah — Permanent outreach numbering:
    Each outreach organisation gets its own permanent sequential
    integer id, stored as ``outreach_number``, starting at 20001. The
    number is allocated by an atomic counter (see
    ``next_outreach_number``) — never reused on delete, never derived
    from a row count, never collides on concurrent creates. It is
    intentionally in a completely separate namespace from Founding
    Member numbering, so #20001 (outreach) and #0001 (founder) can
    co-exist without ambiguity.

    Historical guarantee: when an outreach organisation is used in a
    campaign, the number is COPIED onto the campaign recipient row
    (see cms_module._campaign_send_worker) so a sent campaign still
    shows #20001 even after the active outreach record is deleted.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import re
import uuid

COLL_ORGS = "outreach_organisations"
COLL_COUNTERS = "counters"                 # iter164ah: atomic sequence store
OUTREACH_NUMBER_KEY = "outreach_number"    # counter doc _id
OUTREACH_NUMBER_START = 20000              # first allocated will be 20001

# State machine for a single outreach target.
OUTREACH_STATUSES = [
    "not_contacted",     # created but no email sent yet
    "contacted",         # we've emailed them, no reply yet
    "awaiting_reply",    # they replied to us; we owe them a response
    "replied",           # we've replied since; conversation warm
    "joined",            # they took the action (share/promote/sign up)
    "declined",          # they said no thanks
    "bounced",           # email address is bad
    "unsubscribed",      # opted out
]

# Suggested categories - free-form allowed too.
OUTREACH_CATEGORIES = [
    "retirement_village",
    "community_centre",
    "library",
    "council",
    "club",
    "church",
    "aged_care",
    "advocacy_group",
    "other",
]

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalise_category(raw: str | None) -> str | None:
    """iter161b (25 Feb 2026): free-form category matching.

    Users shouldn't have to type underscores. "Retirement village",
    "retirement village", "RETIREMENT_VILLAGE" and "retirement_village"
    all mean the same category. This helper canonicalises any input
    to the snake_case form used as the stored value, so filters match
    reliably regardless of how the admin typed the category.

    Rules:
      - lower-case
      - trim outer whitespace
      - collapse runs of whitespace and dashes into a single underscore
      - strip punctuation other than underscore

    Passes through None / empty untouched.
    """
    if raw is None:
        return None
    s = str(raw).strip().lower()
    if not s:
        return None
    # Collapse any run of whitespace / hyphen / underscore into a single `_`.
    s = re.sub(r"[\s\-_]+", "_", s)
    # Drop any character that isn't a-z, 0-9 or underscore.
    s = re.sub(r"[^a-z0-9_]", "", s)
    # Trim leading/trailing underscores that punctuation stripping may leave.
    s = s.strip("_")
    return s or None


def category_label(key: str | None) -> str:
    """Human-friendly label for an outreach category key.

    e.g. "retirement_village" → "Retirement village",
    "aged_care" → "Aged care", "other" → "Other".
    """
    if not key:
        return ""
    parts = str(key).replace("-", "_").split("_")
    if not parts:
        return ""
    return " ".join([parts[0].capitalize()] + [p.lower() for p in parts[1:]])


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalise_email(email: str) -> str:
    return (email or "").strip().lower()


def _validate(payload: Dict[str, Any]) -> Dict[str, Any]:
    org = (payload.get("organisation_name") or "").strip()
    email = _normalise_email(payload.get("email") or "")
    if not org:
        raise ValueError("organisation_name is required")
    if not email:
        raise ValueError("email is required")
    if not _EMAIL_RE.match(email):
        raise ValueError(f"Not a valid email: {email!r}")

    status = (payload.get("status") or "not_contacted").strip()
    if status not in OUTREACH_STATUSES:
        raise ValueError(f"status must be one of {OUTREACH_STATUSES}")
    return {
        "organisation_name": org,
        "email":             email,
        "contact_name":      (payload.get("contact_name") or "").strip(),
        "phone":             (payload.get("phone") or "").strip(),
        "category":          (payload.get("category") or "").strip(),
        "tags":              [str(t).strip() for t in (payload.get("tags") or []) if str(t).strip()],
        "suburb":            (payload.get("suburb") or "").strip(),
        "state":             (payload.get("state") or "").strip(),
        "notes":             (payload.get("notes") or ""),
        "status":            status,
    }


async def upsert_org(
    db,
    payload: Dict[str, Any],
    *,
    org_id: Optional[str] = None,
    created_by: Optional[str] = None,
) -> Dict[str, Any]:
    """Create or update an outreach org. Idempotent on (org_id) OR (email).

    Quick-add works with only organisation_name + email; other fields
    default to empty. Status defaults to 'not_contacted'.

    iter164ah: on INSERT (new organisation), a permanent
    ``outreach_number`` is allocated from the atomic counter. Updates
    to an existing organisation do NOT re-allocate the number.
    """
    v = _validate(payload)
    now = _iso_now()

    if org_id:
        query = {"id": org_id}
    else:
        query = {"email": v["email"]}

    set_doc = {**v, "updated_at": now}
    set_on_insert = {
        "id":              str(uuid.uuid4()),
        "created_at":      now,
        "created_by":      created_by,
        "communications":  [],
        "last_contact_at": None,
        "last_reply_at":   None,
        "is_test":         bool(payload.get("is_test", False)),
    }

    res = await db[COLL_ORGS].update_one(
        query, {"$set": set_doc, "$setOnInsert": set_on_insert}, upsert=True,
    )
    # iter164ah: allocate the outreach_number ONLY when we actually
    # inserted a new document. Doing the upsert first and *then*
    # allocating guarantees we never burn a number on a no-op update.
    if res.upserted_id is not None:
        next_num = await next_outreach_number(db)
        await db[COLL_ORGS].update_one(
            {"_id": res.upserted_id},
            {"$set": {"outreach_number": next_num}},
        )
    return await db[COLL_ORGS].find_one(query, {"_id": 0}) or {}


# ─── iter164ah: atomic outreach numbering ──────────────────────────
async def next_outreach_number(db) -> int:
    """Atomically allocate the next permanent outreach number.

    Uses ``findOneAndUpdate`` with ``$inc`` on a single counter
    document — safe under concurrent writes. Numbers start at 20001
    and are strictly monotonic. Deletion of an outreach organisation
    does NOT rewind the counter, so numbers are never reused.

    The counter is intentionally in its own namespace so Founding
    Member numbering (which uses ``interest_registrations`` +
    ``founder_number``) is completely unaffected.
    """
    doc = await db[COLL_COUNTERS].find_one_and_update(
        {"_id": OUTREACH_NUMBER_KEY},
        {"$inc": {"seq": 1},
         "$setOnInsert": {"created_at": _iso_now()}},
        upsert=True,
        # Ensure we always get the *incremented* value back.
        return_document=True,  # ReturnDocument.AFTER
    )
    # First-ever call: counter doc didn't exist, $setOnInsert wrote
    # {"_id": key, "seq": 1, ...}. We want the very first allocated
    # number to be OUTREACH_NUMBER_START + 1 = 20001, so map through
    # the base offset here.
    seq = int((doc or {}).get("seq") or 0)
    return OUTREACH_NUMBER_START + seq


async def bump_outreach_counter_high_water(db, high: int) -> None:
    """Advance the counter so future allocations resume above ``high``.

    Used by the backfill so that if the highest-existing
    ``outreach_number`` is (say) 20050, the next NEW create returns
    20051 — even if the counter doc hasn't been touched before.
    Never decrements.
    """
    if high <= OUTREACH_NUMBER_START:
        return
    new_seq = int(high) - OUTREACH_NUMBER_START
    await db[COLL_COUNTERS].update_one(
        {"_id": OUTREACH_NUMBER_KEY},
        {"$max": {"seq": new_seq},
         "$setOnInsert": {"created_at": _iso_now()}},
        upsert=True,
    )


async def backfill_outreach_numbers(db) -> Dict[str, int]:
    """One-shot: assign an ``outreach_number`` to every existing
    organisation that doesn't yet have one, in a stable order
    (oldest ``created_at`` first, ``id`` as tie-break).

    Idempotent — safe to call on every boot. Returns a small summary
    ``{"assigned": N, "already_numbered": M, "high_water": max}``.
    """
    stats = {"assigned": 0, "already_numbered": 0, "high_water": OUTREACH_NUMBER_START}
    # 1. High-water: bump the counter so it never regresses below any
    #    number that already exists on a row.
    highest = await db[COLL_ORGS].find_one(
        {"outreach_number": {"$exists": True, "$type": "int"}},
        {"_id": 0, "outreach_number": 1},
        sort=[("outreach_number", -1)],
    )
    if highest and int(highest.get("outreach_number") or 0) > OUTREACH_NUMBER_START:
        stats["high_water"] = int(highest["outreach_number"])
        await bump_outreach_counter_high_water(db, stats["high_water"])

    # 2. Count already-numbered rows (for the summary).
    stats["already_numbered"] = await db[COLL_ORGS].count_documents(
        {"outreach_number": {"$exists": True, "$type": "int"}},
    )

    # 3. Assign numbers to the un-numbered ones in a stable order.
    cursor = db[COLL_ORGS].find(
        {"outreach_number": {"$exists": False}},
        {"_id": 1, "id": 1, "created_at": 1},
    ).sort([("created_at", 1), ("id", 1)])
    async for row in cursor:
        num = await next_outreach_number(db)
        await db[COLL_ORGS].update_one(
            {"_id": row["_id"]},
            {"$set": {"outreach_number": num}},
        )
        stats["assigned"] += 1
        if num > stats["high_water"]:
            stats["high_water"] = num
    return stats


async def get_org(db, org_id: str) -> Optional[Dict[str, Any]]:
    return await db[COLL_ORGS].find_one({"id": org_id}, {"_id": 0})


async def list_orgs(
    db,
    *,
    q: Optional[str] = None,
    category: Optional[str] = None,
    status: Optional[str] = None,
    tags_any: Optional[List[str]] = None,
    limit: int = 500,
) -> List[Dict[str, Any]]:
    query: Dict[str, Any] = {"is_test": {"$ne": True}}
    if category:
        query["category"] = category
    if status:
        query["status"] = status
    if tags_any:
        query["tags"] = {"$in": list(tags_any)}
    if q and q.strip():
        needle = q.strip()
        query["$or"] = [
            {"organisation_name": {"$regex": needle, "$options": "i"}},
            {"contact_name":      {"$regex": needle, "$options": "i"}},
            {"email":             {"$regex": needle, "$options": "i"}},
            {"suburb":            {"$regex": needle, "$options": "i"}},
        ]
    cur = db[COLL_ORGS].find(query, {"_id": 0}).sort("updated_at", -1).limit(int(limit))
    return [row async for row in cur]


async def delete_org(db, org_id: str) -> bool:
    r = await db[COLL_ORGS].delete_one({"id": org_id})
    return r.deleted_count > 0


async def touch_last_contact(
    db, *,
    email: str,
    campaign_id: Optional[str] = None,
    subject: Optional[str] = None,
    send_id: Optional[str] = None,
) -> None:
    """Called from the campaign send worker + marketing send.

    Bumps last_contact_at, appends to communications history, and
    transitions status -> 'contacted' if we were 'not_contacted'.
    Idempotent on send_id (we don't re-log the same send).
    """
    email = _normalise_email(email)
    if not email:
        return
    org = await db[COLL_ORGS].find_one({"email": email}, {"_id": 0})
    if not org:
        return  # not an outreach org - just a marketing_contact
    now = _iso_now()
    entry = {
        "kind":        "outbound",
        "at":          now,
        "campaign_id": campaign_id,
        "send_id":     send_id,
        "subject":     subject,
    }
    # Skip duplicate log for the same send_id.
    if send_id and any((c.get("send_id") == send_id) for c in (org.get("communications") or [])):
        return
    set_doc = {"last_contact_at": now, "updated_at": now}
    if org.get("status") in (None, "not_contacted"):
        set_doc["status"] = "contacted"
    await db[COLL_ORGS].update_one(
        {"email": email},
        {"$set": set_doc, "$push": {"communications": entry}},
    )


async def mark_replied(
    db, *,
    org_id: Optional[str] = None,
    email: Optional[str] = None,
    subject: Optional[str] = None,
    body: Optional[str] = None,
    campaign_id: Optional[str] = None,
    direction: str = "inbound",   # "inbound" = they replied to us
    logged_by: Optional[str] = None,
    at: Optional[str] = None,     # override timestamp (e.g. backdated inbound)
) -> Optional[Dict[str, Any]]:
    """Log a reply from (or to) an outreach org.

    direction="inbound"  -> status becomes "awaiting_reply", last_reply_at bumps.
    direction="outbound" -> we sent a reply; status becomes "replied".
    Returns the updated org (or None if org not found).

    ``at`` lets callers backdate the timestamp (used when manually
    logging a reply that arrived earlier — see iter160b Replies inbox).
    """
    query: Dict[str, Any] = {}
    if org_id:
        query["id"] = org_id
    elif email:
        query["email"] = _normalise_email(email)
    else:
        raise ValueError("mark_replied requires org_id or email")

    org = await db[COLL_ORGS].find_one(query, {"_id": 0})
    if not org:
        return None
    now = _iso_now()
    stamp = at or now
    entry = {
        "kind":        f"reply_{direction}",
        "at":          stamp,
        "subject":     subject,
        "body":        body,
        "campaign_id": campaign_id,
        "logged_by":   logged_by,
    }
    set_doc: Dict[str, Any] = {"updated_at": now}
    if direction == "inbound":
        set_doc["last_reply_at"] = stamp
        set_doc["status"] = "awaiting_reply"
    else:  # outbound reply from us
        set_doc["last_contact_at"] = stamp
        set_doc["status"] = "replied"
    await db[COLL_ORGS].update_one(query, {"$set": set_doc, "$push": {"communications": entry}})
    return await db[COLL_ORGS].find_one(query, {"_id": 0})


async def log_communication(
    db, *,
    org_id: str,
    kind: str,             # "note" | "call" | "meeting" | ...
    body: str = "",
    logged_by: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Free-form entry on the timeline (call notes, in-person meeting, etc.)."""
    now = _iso_now()
    entry = {"kind": kind, "at": now, "body": body, "logged_by": logged_by}
    r = await db[COLL_ORGS].update_one(
        {"id": org_id},
        {"$set": {"updated_at": now}, "$push": {"communications": entry}},
    )
    if r.matched_count == 0:
        return None
    return await db[COLL_ORGS].find_one({"id": org_id}, {"_id": 0})


async def ensure_indexes(db) -> None:
    await db[COLL_ORGS].create_index("email", unique=True)
    await db[COLL_ORGS].create_index("status")
    await db[COLL_ORGS].create_index("category")
    await db[COLL_ORGS].create_index("updated_at")
    await db[COLL_ORGS].create_index("last_contact_at")
    await db[COLL_ORGS].create_index("last_reply_at")
    # iter164ah — permanent, sparse-unique numbering. Sparse so
    # rows created before this migration (and rows currently mid-
    # backfill) don't trip the constraint.
    await db[COLL_ORGS].create_index(
        "outreach_number", unique=True, sparse=True, name="uniq_outreach_number",
    )
    # Backfill any un-numbered rows in a stable order — idempotent.
    try:
        await backfill_outreach_numbers(db)
    except Exception:
        # Backfill is best-effort at boot; surface via logs only so a
        # single bad row can't hold the API back from starting.
        import logging
        logging.getLogger("friendplace.outreach").exception(
            "outreach_number backfill failed",
        )


__all__ = [
    "COLL_ORGS", "OUTREACH_STATUSES", "OUTREACH_CATEGORIES",
    "OUTREACH_NUMBER_START",
    "normalise_category", "category_label",
    "upsert_org", "get_org", "list_orgs", "delete_org",
    "touch_last_contact", "log_communication", "mark_replied",
    "ensure_indexes",
    "next_outreach_number", "backfill_outreach_numbers",
    "bump_outreach_counter_high_water",
]
