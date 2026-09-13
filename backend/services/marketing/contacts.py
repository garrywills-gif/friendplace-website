"""Marketing contacts (iter159).

A lightweight address book that grows organically as the admin sends
emails from the Send Email screen or campaign runner. Idempotent
upsert keyed on email — no duplicates.

Fields intentionally match the human-facing form on the Send Email
page:  name, email, recipient_type ("person" | "organisation"),
organisation_name, suburb, notes, tags.

Not to be confused with `founding_members` or `users` — this is a
marketing outreach list, separate from the FriendPlace membership.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import uuid

COLL_CONTACTS = "marketing_contacts"


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def upsert_contact(
    db,
    *,
    email: str,
    name: str = "",
    recipient_type: str = "person",
    organisation_name: str = "",
    suburb: str = "",
    notes: Optional[str] = None,
    tags: Optional[List[str]] = None,
    last_send_id: Optional[str] = None,
    last_send_status: Optional[str] = None,
) -> Dict[str, Any]:
    """Upsert on lowercase email. Returns the merged row (without _id)."""
    email = (email or "").strip().lower()
    if not email:
        raise ValueError("email is required")

    now = _iso_now()
    set_doc: Dict[str, Any] = {
        "email":            email,
        "recipient_type":   recipient_type or "person",
        "updated_at":       now,
    }
    if name:
        set_doc["name"] = name
    if organisation_name:
        set_doc["organisation_name"] = organisation_name
    if suburb:
        set_doc["suburb"] = suburb
    if notes is not None:
        set_doc["notes"] = notes
    if tags is not None:
        set_doc["tags"] = list(tags)
    if last_send_id:
        set_doc["last_send_id"] = last_send_id
        set_doc["last_send_at"] = now
    if last_send_status:
        set_doc["last_send_status"] = last_send_status

    set_on_insert = {
        "id":         str(uuid.uuid4()),
        "created_at": now,
    }
    inc_doc: Dict[str, Any] = {}
    if last_send_id:
        inc_doc["send_count"] = 1
    else:
        # Ensure the field exists on first insert even with no send yet.
        set_on_insert["send_count"] = 0

    update: Dict[str, Any] = {
        "$set":         set_doc,
        "$setOnInsert": set_on_insert,
    }
    if inc_doc:
        update["$inc"] = inc_doc

    await db[COLL_CONTACTS].update_one({"email": email}, update, upsert=True)
    row = await db[COLL_CONTACTS].find_one({"email": email}, {"_id": 0})
    return row or {}


async def list_contacts(
    db,
    *,
    limit: int = 200,
    recipient_type: Optional[str] = None,
    q: Optional[str] = None,
) -> List[Dict[str, Any]]:
    query: Dict[str, Any] = {}
    if recipient_type:
        query["recipient_type"] = recipient_type
    if q:
        needle = q.strip()
        if needle:
            query["$or"] = [
                {"email":             {"$regex": needle, "$options": "i"}},
                {"name":              {"$regex": needle, "$options": "i"}},
                {"organisation_name": {"$regex": needle, "$options": "i"}},
            ]
    cur = db[COLL_CONTACTS].find(query, {"_id": 0}).sort("updated_at", -1).limit(int(limit))
    return [row async for row in cur]


async def get_contact(db, email: str) -> Optional[Dict[str, Any]]:
    return await db[COLL_CONTACTS].find_one({"email": email.strip().lower()}, {"_id": 0})


async def ensure_indexes(db) -> None:
    await db[COLL_CONTACTS].create_index("email", unique=True)
    await db[COLL_CONTACTS].create_index("recipient_type")
    await db[COLL_CONTACTS].create_index("updated_at")


__all__ = [
    "COLL_CONTACTS",
    "upsert_contact",
    "list_contacts",
    "get_contact",
    "ensure_indexes",
]
