"""Data layer for the MCGS combined email inbox.

Two collections:
  • ``inbox_mailboxes`` — the managed FriendPlace addresses. Data-driven
    so new mailboxes can be added from MCGS with no code change.
  • ``inbox_messages``  — every stored message (inbound + our outbound
    replies), threaded by ``thread_id``.

Nothing here talks to a mail provider — inbound arrives via the webhook
in ``router.py`` and outbound reuses the existing Resend ``email_service``.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

COLL_MAILBOXES = "inbox_mailboxes"
COLL_MESSAGES = "inbox_messages"

# Initial FriendPlace addresses (seeded once; editable from MCGS after).
DEFAULT_MAILBOXES: List[Dict[str, str]] = [
    {"address": "hello@friendplace.com.au",     "label": "Hello"},
    {"address": "support@friendplace.com.au",   "label": "Support"},
    {"address": "enquiries@friendplace.com.au", "label": "Enquiries"},
    {"address": "garry@friendplace.com.au",     "label": "Garry"},
    {"address": "privacy@friendplace.com.au",   "label": "Privacy"},
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _norm_addr(a: Optional[str]) -> str:
    return (a or "").strip().lower()


def _norm_subject(s: Optional[str]) -> str:
    """Strip Re:/Fwd: prefixes and collapse whitespace for threading."""
    s = (s or "").strip()
    prev = None
    while prev != s:
        prev = s
        s = re.sub(r"^\s*(re|fwd|fw)\s*:\s*", "", s, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", s).strip().lower()


def _snippet(text: Optional[str], html: Optional[str], n: int = 140) -> str:
    body = (text or "")
    if not body and html:
        body = re.sub(r"<[^>]+>", " ", html)
    body = re.sub(r"\s+", " ", body).strip()
    return body[:n]


# ─── mailboxes ────────────────────────────────────────────────────────

async def seed_default_mailboxes(db) -> None:
    """Insert the initial FriendPlace addresses if absent. Idempotent."""
    for m in DEFAULT_MAILBOXES:
        addr = _norm_addr(m["address"])
        existing = await db[COLL_MAILBOXES].find_one({"address": addr})
        if not existing:
            await db[COLL_MAILBOXES].insert_one({
                "id": str(uuid.uuid4()),
                "address": addr,
                "label": m.get("label") or addr.split("@")[0].title(),
                "active": True,
                "created_at": _now(),
            })


async def list_mailboxes(db) -> List[Dict[str, Any]]:
    rows = await db[COLL_MAILBOXES].find(
        {"active": {"$ne": False}}, {"_id": 0}
    ).sort("created_at", 1).to_list(200)
    return rows


async def add_mailbox(db, address: str, label: Optional[str] = None) -> Dict[str, Any]:
    addr = _norm_addr(address)
    if not addr or "@" not in addr:
        raise ValueError("A valid email address is required")
    existing = await db[COLL_MAILBOXES].find_one({"address": addr})
    if existing:
        # Re-activate if it was previously removed. Idempotent.
        await db[COLL_MAILBOXES].update_one(
            {"address": addr},
            {"$set": {"active": True, "label": label or existing.get("label") or addr.split("@")[0].title()}},
        )
        return await db[COLL_MAILBOXES].find_one({"address": addr}, {"_id": 0})
    row = {
        "id": str(uuid.uuid4()),
        "address": addr,
        "label": label or addr.split("@")[0].title(),
        "active": True,
        "created_at": _now(),
    }
    await db[COLL_MAILBOXES].insert_one(row)
    return {k: v for k, v in row.items() if k != "_id"}


async def remove_mailbox(db, mailbox_id: str) -> bool:
    """Soft-remove a mailbox from the managed list. Stored messages are
    kept (they simply stop appearing under a live mailbox chip)."""
    res = await db[COLL_MAILBOXES].update_one(
        {"id": mailbox_id}, {"$set": {"active": False}}
    )
    return res.matched_count > 0


# ─── messages ─────────────────────────────────────────────────────────

async def _resolve_thread_id(
    db, *, mailbox: str, in_reply_to: Optional[str],
    references: Optional[List[str]], subject: Optional[str],
) -> str:
    """Find the thread a new message belongs to, else start a new one.

    1. Match any referenced provider message-id (In-Reply-To/References).
    2. Fall back to a normalised subject within the same mailbox.
    3. Otherwise a fresh thread id.
    """
    ref_ids = [r for r in (references or []) if r]
    if in_reply_to:
        ref_ids.insert(0, in_reply_to)
    if ref_ids:
        hit = await db[COLL_MESSAGES].find_one(
            {"$or": [
                {"message_id": {"$in": ref_ids}},
                {"provider_message_id": {"$in": ref_ids}},
            ]},
            {"_id": 0, "thread_id": 1},
        )
        if hit and hit.get("thread_id"):
            return hit["thread_id"]

    norm = _norm_subject(subject)
    if norm:
        hit = await db[COLL_MESSAGES].find_one(
            {"mailbox": mailbox, "subject_norm": norm},
            {"_id": 0, "thread_id": 1},
        )
        if hit and hit.get("thread_id"):
            return hit["thread_id"]

    return str(uuid.uuid4())


async def store_inbound(db, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Persist one inbound email. ``payload`` is already normalised by the
    router into: to, from_email, from_name, subject, text, html,
    message_id, in_reply_to, references (list), received_at."""
    mailbox = _norm_addr(payload.get("to"))
    subject = payload.get("subject") or "(no subject)"
    thread_id = await _resolve_thread_id(
        db, mailbox=mailbox,
        in_reply_to=payload.get("in_reply_to"),
        references=payload.get("references"),
        subject=subject,
    )
    doc = {
        "id": str(uuid.uuid4()),
        "mailbox": mailbox,
        "direction": "inbound",
        "from_email": _norm_addr(payload.get("from_email")),
        "from_name": (payload.get("from_name") or "").strip(),
        "to_email": mailbox,
        "subject": subject,
        "subject_norm": _norm_subject(subject),
        "text": payload.get("text") or "",
        "html": payload.get("html") or "",
        "snippet": _snippet(payload.get("text"), payload.get("html")),
        "message_id": payload.get("message_id") or "",
        "provider_message_id": payload.get("message_id") or "",
        "in_reply_to": payload.get("in_reply_to") or "",
        "references": payload.get("references") or [],
        "thread_id": thread_id,
        "read": False,
        "archived_at": None,
        "archived_by": None,
        "received_at": payload.get("received_at") or _now(),
        "created_at": _now(),
    }
    await db[COLL_MESSAGES].insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


async def store_outbound_reply(
    db, *, parent: Dict[str, Any], mailbox: str, to_email: str,
    subject: str, text: str, html: str, message_id: Optional[str],
    sent_by: Optional[str],
) -> Dict[str, Any]:
    doc = {
        "id": str(uuid.uuid4()),
        "mailbox": mailbox,
        "direction": "outbound",
        "from_email": mailbox,
        "from_name": "FriendPlace",
        "to_email": _norm_addr(to_email),
        "subject": subject,
        "subject_norm": _norm_subject(subject),
        "text": text or "",
        "html": html or "",
        "snippet": _snippet(text, html),
        "message_id": message_id or "",
        "provider_message_id": message_id or "",
        "in_reply_to": parent.get("message_id") or "",
        "references": (parent.get("references") or []) + ([parent.get("message_id")] if parent.get("message_id") else []),
        "thread_id": parent.get("thread_id"),
        "read": True,
        "archived_at": None,
        "archived_by": None,
        "received_at": _now(),
        "created_at": _now(),
        "sent_by": sent_by,
    }
    await db[COLL_MESSAGES].insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


def _active_arch_q(archived: bool) -> Dict[str, Any]:
    return {"archived_at": {"$ne": None}} if archived else {"archived_at": None}


async def list_messages(
    db, *, mailbox: Optional[str] = None, read: Optional[bool] = None,
    archived: bool = False, limit: int = 200,
) -> Dict[str, Any]:
    """Combined inbox: newest inbound message per thread, plus per-mailbox
    unread counts for the filter chips."""
    lim = max(1, min(int(limit or 200), 500))
    q: Dict[str, Any] = {"direction": "inbound", **_active_arch_q(archived)}
    if mailbox:
        q["mailbox"] = _norm_addr(mailbox)
    if read is not None:
        q["read"] = read

    docs = await db[COLL_MESSAGES].find(q, {"_id": 0}).sort("received_at", -1).to_list(lim * 3)

    # Collapse to one row per thread (the newest inbound message).
    seen: set = set()
    rows: List[Dict[str, Any]] = []
    for d in docs:
        tid = d.get("thread_id") or d["id"]
        if tid in seen:
            continue
        seen.add(tid)
        rows.append(d)
        if len(rows) >= lim:
            break

    # Per-mailbox active unread counts (for chips + the sidebar badge).
    mailboxes = await list_mailboxes(db)
    per_mailbox: List[Dict[str, Any]] = []
    total_unread = 0
    for mb in mailboxes:
        c = await db[COLL_MESSAGES].count_documents({
            "direction": "inbound", "archived_at": None,
            "read": False, "mailbox": mb["address"],
        })
        total_unread += c
        per_mailbox.append({**mb, "unread": c})

    return {
        "count": len(rows),
        "rows": rows,
        "mailboxes": per_mailbox,
        "total_unread": total_unread,
    }


async def get_thread(db, message_id: str) -> Optional[Dict[str, Any]]:
    msg = await db[COLL_MESSAGES].find_one({"id": message_id}, {"_id": 0})
    if not msg:
        return None
    thread = await db[COLL_MESSAGES].find(
        {"thread_id": msg.get("thread_id")}, {"_id": 0}
    ).sort("received_at", 1).to_list(500)
    if not thread:
        thread = [msg]
    return {"message": msg, "thread": thread}


async def set_read(db, message_id: str, read: bool) -> Optional[Dict[str, Any]]:
    res = await db[COLL_MESSAGES].update_one(
        {"id": message_id}, {"$set": {"read": bool(read)}}
    )
    if res.matched_count == 0:
        return None
    return await db[COLL_MESSAGES].find_one({"id": message_id}, {"_id": 0})


async def archive_message(db, message_id: str, by: Optional[str]) -> Optional[Dict[str, Any]]:
    existing = await db[COLL_MESSAGES].find_one({"id": message_id}, {"_id": 0})
    if not existing:
        return None
    if not existing.get("archived_at"):
        await db[COLL_MESSAGES].update_one(
            {"id": message_id},
            {"$set": {"archived_at": _now(), "archived_by": by}},
        )
    return await db[COLL_MESSAGES].find_one({"id": message_id}, {"_id": 0})


async def restore_message(db, message_id: str) -> Optional[Dict[str, Any]]:
    res = await db[COLL_MESSAGES].update_one(
        {"id": message_id}, {"$set": {"archived_at": None, "archived_by": None}}
    )
    if res.matched_count == 0:
        return None
    return await db[COLL_MESSAGES].find_one({"id": message_id}, {"_id": 0})


async def unread_count(db) -> int:
    return await db[COLL_MESSAGES].count_documents({
        "direction": "inbound", "archived_at": None, "read": False,
    })


async def ensure_inbox_indexes(db) -> None:
    await db[COLL_MAILBOXES].create_index("address", unique=True)
    await db[COLL_MESSAGES].create_index("thread_id")
    await db[COLL_MESSAGES].create_index([("mailbox", 1), ("received_at", -1)])
    await db[COLL_MESSAGES].create_index([("direction", 1), ("read", 1), ("archived_at", 1)])
    await db[COLL_MESSAGES].create_index("message_id")


__all__ = [
    "DEFAULT_MAILBOXES", "COLL_MAILBOXES", "COLL_MESSAGES",
    "seed_default_mailboxes", "list_mailboxes", "add_mailbox", "remove_mailbox",
    "store_inbound", "store_outbound_reply",
    "list_messages", "get_thread", "set_read",
    "archive_message", "restore_message", "unread_count",
    "ensure_inbox_indexes",
]
