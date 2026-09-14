"""Reminders store — Mongo CRUD.

Schema:
    id            str (uuid4)
    title         str (1..200)
    note          str (0..1000)  - optional
    due_at        ISO datetime str (UTC)
    recurrence    "none" | "daily" | "weekly" | "monthly"
    status        "pending" | "completed" | "cancelled"
    created_at    ISO datetime str (UTC)
    completed_at  ISO datetime str (UTC) | None
    created_by    admin_email (audit trail)
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

COLL_REMINDERS = "reminders"
REMINDER_RECURRENCE = ["none", "daily", "weekly", "monthly"]
REMINDER_STATUSES = ["pending", "completed", "cancelled"]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _validate_recurrence(v: Any) -> str:
    v = (v or "none").strip().lower()
    if v not in REMINDER_RECURRENCE:
        raise ValueError(f"invalid recurrence: {v!r} (must be one of {REMINDER_RECURRENCE})")
    return v


def _validate_due_at(v: Any) -> str:
    if not v:
        raise ValueError("due_at is required")
    if isinstance(v, datetime):
        dt = v if v.tzinfo else v.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    s = str(v).strip()
    # Accept both trailing-Z and offset forms.
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception as e:
        raise ValueError(f"invalid due_at: {v!r} ({e})") from e
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _validate_title(v: Any) -> str:
    s = str(v or "").strip()
    if not s:
        raise ValueError("title is required")
    if len(s) > 200:
        raise ValueError("title too long (max 200)")
    return s


def _validate_note(v: Any) -> str:
    s = str(v or "").strip()
    if len(s) > 1000:
        raise ValueError("note too long (max 1000)")
    return s


async def create_reminder(
    db: Any,
    *,
    title: str,
    due_at: Any,
    recurrence: str = "none",
    note: str = "",
    created_by: Optional[str] = None,
) -> dict:
    """Create a reminder. Returns the persisted document (id populated)."""
    doc = {
        "id":           str(uuid.uuid4()),
        "title":        _validate_title(title),
        "note":         _validate_note(note),
        "due_at":       _validate_due_at(due_at),
        "recurrence":   _validate_recurrence(recurrence),
        "status":       "pending",
        "created_at":   _now_iso(),
        "completed_at": None,
        "created_by":   (created_by or "").strip() or None,
    }
    await db[COLL_REMINDERS].insert_one(dict(doc))
    return doc


async def list_reminders(
    db: Any,
    *,
    status: Optional[str] = None,
    limit: int = 200,
) -> list[dict]:
    q: dict = {}
    if status:
        s = status.strip().lower()
        if s not in REMINDER_STATUSES:
            raise ValueError(f"invalid status: {status!r}")
        q["status"] = s
    cursor = db[COLL_REMINDERS].find(q, {"_id": 0}).sort("due_at", 1).limit(int(limit or 200))
    return [d async for d in cursor]


async def get_reminder(db: Any, reminder_id: str) -> Optional[dict]:
    return await db[COLL_REMINDERS].find_one({"id": reminder_id}, {"_id": 0})


async def complete_reminder(db: Any, reminder_id: str) -> Optional[dict]:
    """Mark completed. If recurring, roll the due_at forward by one
    period so it becomes a fresh pending reminder for next time."""
    doc = await get_reminder(db, reminder_id)
    if not doc:
        return None
    now = _now_iso()
    if doc.get("recurrence", "none") == "none":
        await db[COLL_REMINDERS].update_one(
            {"id": reminder_id},
            {"$set": {"status": "completed", "completed_at": now}},
        )
    else:
        # Roll forward: advance due_at by one period, keep status=pending,
        # log completed_at so we know the last tick was checked off.
        try:
            due = datetime.fromisoformat(doc["due_at"].replace("Z", "+00:00"))
        except Exception:
            due = datetime.now(timezone.utc)
        delta = {
            "daily":   timedelta(days=1),
            "weekly":  timedelta(days=7),
            "monthly": timedelta(days=30),
        }.get(doc["recurrence"], timedelta(days=1))
        new_due = (due + delta).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        await db[COLL_REMINDERS].update_one(
            {"id": reminder_id},
            {"$set": {"due_at": new_due, "completed_at": now}},
        )
    return await get_reminder(db, reminder_id)


async def delete_reminder(db: Any, reminder_id: str) -> bool:
    r = await db[COLL_REMINDERS].delete_one({"id": reminder_id})
    return r.deleted_count > 0


async def update_reminder(
    db: Any, reminder_id: str, *,
    title: Optional[str] = None,
    note: Optional[str] = None,
    due_at: Optional[str] = None,
    recurrence: Optional[str] = None,
    status: Optional[str] = None,
) -> Optional[dict]:
    updates: dict = {}
    if title is not None:      updates["title"] = _validate_title(title)
    if note is not None:       updates["note"] = _validate_note(note)
    if due_at is not None:     updates["due_at"] = _validate_due_at(due_at)
    if recurrence is not None: updates["recurrence"] = _validate_recurrence(recurrence)
    if status is not None:
        s = status.strip().lower()
        if s not in REMINDER_STATUSES:
            raise ValueError(f"invalid status: {status!r}")
        updates["status"] = s
        if s == "completed":
            updates["completed_at"] = _now_iso()
    if not updates:
        return await get_reminder(db, reminder_id)
    r = await db[COLL_REMINDERS].update_one({"id": reminder_id}, {"$set": updates})
    if r.matched_count == 0:
        return None
    return await get_reminder(db, reminder_id)


async def ensure_indexes(db: Any) -> None:
    await db[COLL_REMINDERS].create_index("id", unique=True)
    await db[COLL_REMINDERS].create_index("status")
    await db[COLL_REMINDERS].create_index("due_at")
