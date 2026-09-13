"""Outreach organisations store (iter160a).

Collection: outreach_organisations
Fields:
    id, organisation_name, contact_name, email, phone, category, tags,
    suburb, state, notes, status, last_contact_at, last_reply_at,
    communications (append-only history), created_at, updated_at,
    created_by, is_test

Contact status is denormalised into `status` for fast filtering AND
computed on the fly in services/crm/status.py for consistency. Send
worker + mark_replied() keep this field in sync.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import re
import uuid

COLL_ORGS = "outreach_organisations"

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

    await db[COLL_ORGS].update_one(
        query, {"$set": set_doc, "$setOnInsert": set_on_insert}, upsert=True,
    )
    return await db[COLL_ORGS].find_one(query, {"_id": 0}) or {}


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


__all__ = [
    "COLL_ORGS", "OUTREACH_STATUSES", "OUTREACH_CATEGORIES",
    "normalise_category", "category_label",
    "upsert_org", "get_org", "list_orgs", "delete_org",
    "touch_last_contact", "log_communication", "mark_replied",
    "ensure_indexes",
]
