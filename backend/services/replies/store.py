"""Inbound replies store (iter160b).

Collection: ``inbound_replies``

Represents a message that came IN to us (email reply, phone call
follow-up, in-person conversation). Populated by the manual
"Log a reply" UI in the CRM Navigator > Replies area — no email
inbox webhook required.

Doc shape::
    {
      id:             uuid,
      from_email:     lower-cased sender email,
      from_name:      free-form,
      subject:        "",
      body:           "",
      channel:        "email" | "phone" | "in_person" | "sms" | "other",
      campaign_id:    optional — which campaign spurred this reply,
      campaign_name:  denormalised label,
      related_send_id: optional marketing_sends.id we can point at,
      outreach_id:    optional outreach_organisations.id,
      founder_id:     optional founding_members.id,
      received_at:    iso timestamp of the actual reply arrival,
      created_at:     iso timestamp of when we logged it,
      created_by:     admin email/id who logged it,
      read:           bool,
      resolved:       bool,          # we've replied back
      resolved_at:    iso | None,
      resolved_by:    admin email | None,
      notes:          free-form,
    }

Status handshake with the unified CRM status service:
  * Creating a reply here bumps a matching outreach org's status to
    ``awaiting_reply`` and stamps ``last_reply_at``.
  * Resolving a reply here bumps that same org to ``replied`` (via
    ``mark_replied(direction='outbound')`` — the outbound reply
    itself will normally do it, but we handle "resolve without send"
    as well for admins who reply outside FriendPlace).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import re
import uuid

COLL_REPLIES = "inbound_replies"

REPLY_CHANNELS = ("email", "phone", "in_person", "sms", "other")

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _lower(x: Optional[str]) -> str:
    return (x or "").strip().lower()


async def create_reply(
    db,
    *,
    from_email: str,
    from_name: str = "",
    subject: str = "",
    body: str = "",
    channel: str = "email",
    campaign_id: Optional[str] = None,
    related_send_id: Optional[str] = None,
    received_at: Optional[str] = None,
    notes: str = "",
    created_by: Optional[str] = None,
) -> Dict[str, Any]:
    """Log a new inbound reply.

    Also — as a courtesy — updates the matching outreach organisation
    (if any) into ``awaiting_reply`` so the unified CRM status stays
    consistent with the Replies inbox.
    """
    email = _lower(from_email)
    if not email or not _EMAIL_RE.match(email):
        raise ValueError(f"Not a valid email: {from_email!r}")
    if channel not in REPLY_CHANNELS:
        raise ValueError(f"channel must be one of {REPLY_CHANNELS}")

    now = _iso_now()

    # Optional look-ups so we can denormalise for the UI.
    campaign_name: Optional[str] = None
    if campaign_id:
        try:
            camp = await db.campaigns.find_one(
                {"id": campaign_id},
                {"_id": 0, "name": 1, "subject": 1, "template": 1},
            )
            if camp:
                campaign_name = camp.get("name") or camp.get("subject") or camp.get("template")
        except Exception:
            campaign_name = None

    outreach_id: Optional[str] = None
    try:
        org = await db.outreach_organisations.find_one(
            {"email": email}, {"_id": 0, "id": 1},
        )
        if org:
            outreach_id = org.get("id")
    except Exception:
        outreach_id = None

    founder_id: Optional[str] = None
    try:
        fm = await db.founding_members.find_one(
            {"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}},
            {"_id": 0, "id": 1},
        )
        if fm:
            founder_id = fm.get("id")
    except Exception:
        founder_id = None

    doc: Dict[str, Any] = {
        "id":              str(uuid.uuid4()),
        "from_email":      email,
        "from_name":       (from_name or "").strip(),
        "subject":         (subject or "").strip(),
        "body":            (body or "").strip(),
        "channel":         channel,
        "campaign_id":     campaign_id,
        "campaign_name":   campaign_name,
        "related_send_id": related_send_id,
        "outreach_id":     outreach_id,
        "founder_id":      founder_id,
        "received_at":     received_at or now,
        "created_at":      now,
        "created_by":      created_by,
        "read":            False,
        "resolved":        False,
        "resolved_at":     None,
        "resolved_by":     None,
        "notes":           (notes or "").strip(),
    }
    await db[COLL_REPLIES].insert_one(doc)

    # Keep the outreach org's denormalised status coherent.
    if outreach_id:
        try:
            from services.outreach.store import mark_replied as _mr
            await _mr(
                db, org_id=outreach_id,
                subject=doc["subject"], body=doc["body"],
                campaign_id=campaign_id, direction="inbound",
                logged_by=created_by,
                at=doc["received_at"],  # respect backdated timestamps
            )
        except Exception:
            pass

    return await db[COLL_REPLIES].find_one({"id": doc["id"]}, {"_id": 0}) or doc


async def list_replies(
    db,
    *,
    read: Optional[bool] = None,
    resolved: Optional[bool] = None,
    campaign_id: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = 200,
) -> List[Dict[str, Any]]:
    query: Dict[str, Any] = {}
    if read is not None:
        query["read"] = bool(read)
    if resolved is not None:
        query["resolved"] = bool(resolved)
    if campaign_id:
        query["campaign_id"] = campaign_id
    if q and q.strip():
        needle = q.strip()
        query["$or"] = [
            {"from_email":    {"$regex": needle, "$options": "i"}},
            {"from_name":     {"$regex": needle, "$options": "i"}},
            {"subject":       {"$regex": needle, "$options": "i"}},
            {"body":          {"$regex": needle, "$options": "i"}},
            {"campaign_name": {"$regex": needle, "$options": "i"}},
        ]
    cur = db[COLL_REPLIES].find(query, {"_id": 0}).sort("received_at", -1).limit(int(limit))
    return [row async for row in cur]


async def get_reply(db, reply_id: str) -> Optional[Dict[str, Any]]:
    return await db[COLL_REPLIES].find_one({"id": reply_id}, {"_id": 0})


async def mark_read(db, reply_id: str, *, read: bool = True) -> Optional[Dict[str, Any]]:
    await db[COLL_REPLIES].update_one({"id": reply_id}, {"$set": {"read": bool(read)}})
    return await get_reply(db, reply_id)


async def mark_resolved(
    db, reply_id: str, *,
    resolved: bool = True, resolved_by: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    now = _iso_now() if resolved else None
    await db[COLL_REPLIES].update_one(
        {"id": reply_id},
        {"$set": {
            "resolved":    bool(resolved),
            "resolved_at": now,
            "resolved_by": resolved_by if resolved else None,
            "read":        True if resolved else False,  # resolving implies read
        }},
    )
    row = await get_reply(db, reply_id)
    # Nudge the matching outreach org to "replied" when marked resolved.
    if row and resolved and row.get("outreach_id"):
        try:
            from services.outreach.store import mark_replied as _mr
            await _mr(
                db, org_id=row["outreach_id"],
                subject=row.get("subject") or "",
                body="(marked resolved from Replies inbox)",
                campaign_id=row.get("campaign_id"),
                direction="outbound",
                logged_by=resolved_by,
            )
        except Exception:
            pass
    return row


async def resolve_replies_for_email(
    db, *,
    from_email: str,
    resolved_by: Optional[str] = None,
    send_id: Optional[str] = None,
) -> int:
    """Auto-resolve all unresolved replies from a given email.

    Called by the marketing send worker when we actually respond to
    someone whose reply we hadn't yet marked resolved.
    Returns the number of rows updated.
    """
    email = _lower(from_email)
    if not email:
        return 0
    now = _iso_now()
    result = await db[COLL_REPLIES].update_many(
        {"from_email": email, "resolved": {"$ne": True}},
        {"$set": {
            "resolved":       True,
            "resolved_at":    now,
            "resolved_by":    resolved_by,
            "resolved_via":   send_id,
            "read":           True,
        }},
    )
    return int(result.modified_count or 0)


async def delete_reply(db, reply_id: str) -> bool:
    r = await db[COLL_REPLIES].delete_one({"id": reply_id})
    return r.deleted_count > 0


async def unread_count(db) -> int:
    return int(await db[COLL_REPLIES].count_documents({"read": {"$ne": True}}))


async def awaiting_count(db) -> int:
    return int(await db[COLL_REPLIES].count_documents({"resolved": {"$ne": True}}))


async def ensure_indexes(db) -> None:
    await db[COLL_REPLIES].create_index("from_email")
    await db[COLL_REPLIES].create_index("received_at")
    await db[COLL_REPLIES].create_index("campaign_id")
    await db[COLL_REPLIES].create_index("read")
    await db[COLL_REPLIES].create_index("resolved")


__all__ = [
    "COLL_REPLIES", "REPLY_CHANNELS",
    "create_reply", "list_replies", "get_reply",
    "mark_read", "mark_resolved", "resolve_replies_for_email",
    "delete_reply", "unread_count", "awaiting_count",
    "ensure_indexes",
]
