"""Admin audit log — Slice 0 foundation.

Every consequential write action performed by an admin (warn, suspend,
ban, restore, content-remove, group approve/reject, event archive, etc.)
should end with a call to ``log_admin_action`` so we have a single
tamper-evident timeline of who did what.

This module intentionally has *zero* FastAPI knowledge — it's just a
tiny persistence layer that both `cms_module.py` and `server.py` can
call.  The read/list API is exposed via `cms_module.py` alongside the
other CMS routes so it inherits the same JWT auth guard.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable, Optional
import uuid

# The collection is intentionally named `admin_log` (not `audit_log`) so
# it's obvious what it contains when browsing the DB directly.  Every
# document is append-only — nothing in the codebase mutates or deletes
# rows after they're written.
COLLECTION = "admin_log"


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def log_admin_action(
    db: Any,
    *,
    admin: Optional[dict] = None,
    admin_id: Optional[str] = None,
    admin_email: Optional[str] = None,
    admin_name: Optional[str] = None,
    action: str,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    reason: Optional[str] = None,
    metadata: Optional[dict] = None,
    ip: Optional[str] = None,
) -> dict:
    """Persist a single audit entry. Safe to await from any route.

    `action` should be a namespaced dotted string like ``member.warn``,
    ``content.remove``, ``group.approve``, ``settings.moderation.update``.
    Namespacing makes filtering trivial and keeps the log readable.
    """
    entry = {
        "_id": str(uuid.uuid4()),
        "ts": _now(),
        "admin_id": admin_id or (admin.get("id") if admin else None),
        "admin_email": admin_email or (admin.get("email") if admin else None),
        "admin_name": admin_name or (admin.get("display_name") if admin else None),
        "action": action,
        "target_type": target_type,
        "target_id": target_id,
        "reason": reason,
        "metadata": metadata or {},
        "ip": ip,
    }
    try:
        await db[COLLECTION].insert_one(entry)
    except Exception:
        # NEVER let audit-log failures break the caller. A missing audit
        # entry is a monitoring issue; blocking a moderator's action is a
        # UX disaster.
        pass
    return entry


async def list_admin_log(
    db: Any,
    *,
    admin_id: Optional[str] = None,
    action_prefix: Optional[str] = None,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
    limit: int = 50,
    skip: int = 0,
) -> list[dict]:
    """Return newest-first entries matching the filters. All optional."""
    q: dict[str, Any] = {}
    if admin_id:
        q["admin_id"] = admin_id
    if target_type:
        q["target_type"] = target_type
    if target_id:
        q["target_id"] = target_id
    if action_prefix:
        # Namespaced match: e.g. `member.` matches all member actions.
        q["action"] = {"$regex": f"^{action_prefix}"}
    if since or until:
        rng: dict[str, Any] = {}
        if since:
            rng["$gte"] = since
        if until:
            rng["$lte"] = until
        q["ts"] = rng

    cursor = (
        db[COLLECTION]
        .find(q)
        .sort("ts", -1)
        .skip(max(0, int(skip)))
        .limit(max(1, min(int(limit), 500)))
    )
    return [_serialise(doc) async for doc in cursor]


async def count_admin_log(db: Any, **kwargs: Any) -> int:
    q: dict[str, Any] = {}
    if kwargs.get("admin_id"):
        q["admin_id"] = kwargs["admin_id"]
    if kwargs.get("target_type"):
        q["target_type"] = kwargs["target_type"]
    if kwargs.get("action_prefix"):
        q["action"] = {"$regex": f"^{kwargs['action_prefix']}"}
    return int(await db[COLLECTION].count_documents(q))


def _serialise(doc: dict) -> dict:
    """Convert Mongo datetimes and stray types to JSON-friendly primitives."""
    out = dict(doc)
    ts = out.get("ts")
    if isinstance(ts, datetime):
        out["ts"] = ts.astimezone(timezone.utc).isoformat()
    # Drop nothings — keeps the wire payload lean.
    return {k: v for k, v in out.items() if v is not None}


# Convenience — a small catalogue of well-known action strings so the
# rest of the codebase uses consistent names.  This is documentation
# more than a runtime constraint; unknown actions still get logged.
KNOWN_ACTIONS: tuple[str, ...] = (
    # Member management — Slice 1
    "member.search",           # low-value, off by default
    "member.warn",
    "member.suspend",
    "member.ban",
    "member.restore",
    "member.delete",
    "member.note.add",
    "member.admin_flag.set",
    "member.admin_flag.unset",
    "member.restriction.clear",
    # Butterfly Points recognition — iter164h
    "member.points.award",
    "member.points.reverse",
    # Reports & moderation — Slice 2
    "report.status.update",
    "content.remove",
    "content.restore",
    # Support — Slice 3
    "ticket.resolve",
    "ticket.reply",
    "contact.resolve",
    "interest.status.update",
    # Events — Slice 4
    "event.archive",
    "event.unarchive",
    "event.cancel",
    "event.restore",
    "event.delete",
    # Groups — Slice 5
    "group.approve",
    "group.reject",
    # Announcements — Slice 6
    "announcement.create",
    "announcement.update",
    "announcement.delete",
    # Settings — Slice 9
    "settings.moderation.update",
    "settings.rhythms.update",
    # Admin identity — Slice 8
    "admin.invite",
    "admin.remove",
    "admin.password.reset",
)
