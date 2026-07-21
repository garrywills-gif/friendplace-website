"""
B6 — Conversational event editing (Garry, 25 Jul 2026).

This module houses the *service layer* for George's event-edit tools.
It does NOT depend on the LLM or the SSE conversation loop — those
sit on top in a later session. Everything here is directly callable
from HTTP handlers or Python tests, which keeps the audit + safety
rails testable in isolation.

Design notes carried over from Garry's scope:

* **Audit-first.** Every mutation writes an immutable row to the
  `event_edits` collection. The schema is deliberately denormalised
  (editor name + event title snapshots) so Mission Control and B7
  (George Remembers) can render human sentences without joining
  users/events at read time — and history keeps rendering correctly
  even after the underlying event is renamed or deleted.

* **Permissions defence-in-depth.** Every service call re-checks
  that the editor is either the host_id of the event OR flagged
  `is_admin`. HTTP-level auth is still required upstream; this is
  the "belt AND braces" layer.

* **Severity taxonomy.** A change is *significant* when any of the
  affected fields is in `SIGNIFICANT_FIELDS`, or when the action is
  `cancel` / `restore` / `visibility`. Everything else is *minor*.
  Front-end confirmation copy diverges based on this flag.

* **Undo is a first-class audit row**, not an in-place rewrite.
  Undo writes a new `event_edits` row whose `reverses_edit_id`
  points back to the original, and stamps `reversed_by_edit_id`
  on that original row. Two-way link makes MC history rendering
  trivial ("This change was undone by …").
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Field-level severity map. A change is *significant* when it touches
# any field in this set — those are the ones that require an explicit
# confirmation chip in George's chat (e.g. "Yes, move to Fri 26 Jul").
SIGNIFICANT_FIELDS: set[str] = {
    "date",
    "time",
    "location",       # a full-location swap is significant enough
    "capacity",       # locked with Garry 25 Jul 2026 (Session 2) — capacity
                      # changes are consequential for who can attend, so
                      # George should always confirm before applying.
    "cancelled",      # state change from cancel/restore action
    "visibility",     # public → friends etc.
}

# All fields George is allowed to edit via natural conversation. Order
# matters only for the summary line (fields are described in this order
# in the "you changed X, Y, Z" sentence).
EDITABLE_FIELDS: list[str] = [
    "title", "emoji", "description", "date", "time",
    "location", "capacity", "notes", "visibility",
]

COLL_EVENT_EDITS = "event_edits"


# ---------------------------------------------------------------------------
# Pydantic models — schema-of-record for `event_edits`
# ---------------------------------------------------------------------------

class EventEditChange(BaseModel):
    """One field's before/after inside an audit row."""
    field: str
    old: Any = None
    new: Any = None


class EventEditAudit(BaseModel):
    """The row we persist to `event_edits` on every mutation.

    Denormalised on purpose: `editor_name` and `event_title_at_edit`
    are snapshots so Mission Control history and B7 memory prompts
    keep rendering correctly even if the user or event changes later.
    """
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    event_id: str
    event_title_at_edit: str = ""
    editor_id: str
    editor_name: str = ""
    editor_kind: str  # 'organiser' | 'admin'
    source: str       # 'george' | 'event_ui' | 'admin_ui' | 'api'
    severity: str     # 'minor' | 'significant'
    action: str       # 'update' | 'cancel' | 'restore' | 'undo'
    changes: list[EventEditChange] = []
    summary: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    # Two-way link between an undo row and the row it reverses. Only
    # ever populated by the `undo_last_edit` helper.
    reverses_edit_id: Optional[str] = None
    reversed_by_edit_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def classify_severity(changed_fields: list[str], action: str) -> str:
    """Return 'significant' or 'minor'.
    Any cancel/restore/visibility action is always significant.
    Otherwise: significant if any changed field is in SIGNIFICANT_FIELDS.
    """
    if action in ("cancel", "restore"):
        return "significant"
    if any(f in SIGNIFICANT_FIELDS for f in changed_fields):
        return "significant"
    return "minor"


def summarise(changes: list[EventEditChange], action: str, event_title: str,
              editor_name: str, source: str) -> str:
    """Build the human sentence Mission Control renders in its feed and
    George uses in the "Done — I've …" chat reply.

    Kept intentionally warm and specific — Mission Control preview
    lines like *"George helped Margaret update Book Club yesterday"*
    are assembled at read-time from this summary + timestamps.
    """
    who = editor_name or "Someone"
    via = "with George" if source == "george" else ""
    title = event_title or "an event"
    if action == "cancel":
        return f"{who} cancelled {title}{(' ' + via) if via else ''}".strip()
    if action == "restore":
        return f"{who} restored {title}{(' ' + via) if via else ''}".strip()
    if action == "undo":
        return f"{who} undid a change to {title}{(' ' + via) if via else ''}".strip()

    if not changes:
        return f"{who} saved {title} with no changes".strip()

    field_labels = {
        "title": "the title", "emoji": "the emoji", "description": "the description",
        "date": "the date", "time": "the time", "location": "the location",
        "capacity": "the capacity", "notes": "the notes", "visibility": "who can see it",
    }
    parts = [field_labels.get(c.field, c.field) for c in changes]
    if len(parts) == 1:
        what = parts[0]
    elif len(parts) == 2:
        what = f"{parts[0]} and {parts[1]}"
    else:
        what = ", ".join(parts[:-1]) + f", and {parts[-1]}"
    line = f"{who} updated {what} on {title}"
    if via:
        line += f" {via}"
    return line


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------

async def _load_actor_context(db, event_id: str, actor_id: str) -> dict:
    """Fetch the event + actor, raise a shape the router can turn into
    a 403/404 cleanly. Returns {'event', 'actor', 'kind'}.
    """
    ev = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not ev:
        raise EventEditError("event_not_found", "Event not found.")
    actor = await db.users.find_one({"id": actor_id}, {"_id": 0})
    if not actor:
        raise EventEditError("actor_not_found", "Actor not found.")
    is_host = ev.get("host_id") == actor_id
    is_admin = bool(actor.get("is_admin"))
    if not (is_host or is_admin):
        raise EventEditError(
            "forbidden",
            "That\u2019s someone else\u2019s event \u2014 only the organiser or an admin can edit it.",
        )
    return {"event": ev, "actor": actor, "kind": "organiser" if is_host else "admin"}


class EventEditError(Exception):
    """Service-level error the router maps to HTTPException codes."""
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


# ---------------------------------------------------------------------------
# match — find candidate events the actor can edit
# ---------------------------------------------------------------------------

async def match_events(db, actor_id: str, query: str = "", limit: int = 5) -> list[dict]:
    """Return up to `limit` events the actor is allowed to edit that
    plausibly match `query`. Optimised for George's clarifying step
    so the LLM never has to guess against the full events collection.

    Matching strategy (cheap + good enough for MVP):
      1. Only events where `host_id == actor_id` (organisers) OR every
         upcoming event if the actor is admin.
      2. Not cancelled, not archived.
      3. Rank by (title contains query) → (date within next 30 days).

    `query` is lowercased and split on whitespace; each token must
    appear somewhere in `title|location|description` for a match.
    """
    actor = await db.users.find_one({"id": actor_id}, {"_id": 0})
    if not actor:
        return []
    is_admin = bool(actor.get("is_admin"))

    q: dict = {"cancelled": {"$ne": True}, "archived": {"$ne": True}}
    if not is_admin:
        q["host_id"] = actor_id

    cursor = db.events.find(q, {"_id": 0}).sort("date", 1)
    all_events = await cursor.to_list(500)

    if not query:
        return all_events[:limit]

    tokens = [t.lower() for t in query.split() if t.strip()]
    scored: list[tuple[int, dict]] = []
    for ev in all_events:
        haystack = " ".join(str(ev.get(k) or "") for k in ("title", "location", "description")).lower()
        if not all(t in haystack for t in tokens):
            continue
        # Rank: earlier date first, exact-title match slight bonus.
        title = str(ev.get("title") or "").lower()
        bonus = -1 if any(t in title for t in tokens) else 0
        scored.append((bonus, ev))
    scored.sort(key=lambda x: (x[0], x[1].get("date", "")))
    return [ev for _, ev in scored[:limit]]


# ---------------------------------------------------------------------------
# apply — write field-level changes + audit
# ---------------------------------------------------------------------------

async def apply_edit(
    db,
    *,
    event_id: str,
    actor_id: str,
    changes: dict[str, Any],
    source: str = "george",
    reverses_edit_id: Optional[str] = None,
    action_override: Optional[str] = None,
) -> dict:
    """Apply a set of field-level changes atomically, write the audit
    row, and return `{ event, audit }`.

    `changes` is a dict of `{field: new_value}`. Only whitelisted
    fields are respected — extras are silently dropped so a
    misbehaving LLM can't set an admin flag.
    """
    ctx = await _load_actor_context(db, event_id, actor_id)
    ev = ctx["event"]
    actor = ctx["actor"]

    # Filter to whitelisted fields and diff against the current values.
    diffs: list[EventEditChange] = []
    update: dict[str, Any] = {}
    for field in EDITABLE_FIELDS:
        if field not in changes:
            continue
        new = changes[field]
        old = ev.get(field)
        if new is None and old is None:
            continue
        # Normalise strings to trimmed
        if isinstance(new, str):
            new = new.strip()
        if new == old:
            continue
        diffs.append(EventEditChange(field=field, old=old, new=new))
        update[field] = new

    if not diffs and not action_override:
        raise EventEditError("no_changes", "Nothing to update.")

    # Reset reminder-sent flags on date/time change so notifications re-fire.
    if any(c.field in ("date", "time") for c in diffs):
        for f in ("reminder_24h_sent", "reminder_2h_sent", "reminder_now_sent"):
            update[f] = None

    if update:
        update["updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.events.update_one({"id": event_id}, {"$set": update})

    action = action_override or ("undo" if reverses_edit_id else "update")
    severity = classify_severity([c.field for c in diffs], action)
    editor_name = _display_name(actor)

    audit = EventEditAudit(
        event_id=event_id,
        event_title_at_edit=str(ev.get("title") or ""),
        editor_id=actor_id,
        editor_name=editor_name,
        editor_kind=ctx["kind"],
        source=source,
        severity=severity,
        action=action,
        changes=diffs,
        summary=summarise(diffs, action, str(ev.get("title") or ""), editor_name, source),
        reverses_edit_id=reverses_edit_id,
    )
    await db[COLL_EVENT_EDITS].insert_one(audit.dict())

    # Two-way link on undo.
    if reverses_edit_id:
        await db[COLL_EVENT_EDITS].update_one(
            {"id": reverses_edit_id},
            {"$set": {"reversed_by_edit_id": audit.id}},
        )

    updated_ev = await db.events.find_one({"id": event_id}, {"_id": 0})
    return {"event": updated_ev, "audit": audit.dict()}


# ---------------------------------------------------------------------------
# cancel / restore
# ---------------------------------------------------------------------------

async def cancel_event(db, *, event_id: str, actor_id: str, source: str = "george") -> dict:
    ctx = await _load_actor_context(db, event_id, actor_id)
    ev = ctx["event"]
    if ev.get("cancelled"):
        raise EventEditError("already_cancelled", "This event is already cancelled.")

    await db.events.update_one(
        {"id": event_id},
        {"$set": {
            "cancelled": True,
            "cancelled_at": datetime.now(timezone.utc).isoformat(),
            "cancelled_by": actor_id,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    editor_name = _display_name(ctx["actor"])
    audit = EventEditAudit(
        event_id=event_id,
        event_title_at_edit=str(ev.get("title") or ""),
        editor_id=actor_id,
        editor_name=editor_name,
        editor_kind=ctx["kind"],
        source=source,
        severity="significant",
        action="cancel",
        changes=[EventEditChange(field="cancelled", old=False, new=True)],
        summary=summarise([], "cancel", str(ev.get("title") or ""), editor_name, source),
    )
    await db[COLL_EVENT_EDITS].insert_one(audit.dict())
    updated_ev = await db.events.find_one({"id": event_id}, {"_id": 0})
    return {"event": updated_ev, "audit": audit.dict()}


async def restore_event(db, *, event_id: str, actor_id: str, source: str = "george") -> dict:
    ctx = await _load_actor_context(db, event_id, actor_id)
    ev = ctx["event"]
    if not ev.get("cancelled"):
        raise EventEditError("not_cancelled", "This event isn\u2019t cancelled.")

    await db.events.update_one(
        {"id": event_id},
        {"$set": {
            "cancelled": False,
            "restored_at": datetime.now(timezone.utc).isoformat(),
            "restored_by": actor_id,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }, "$unset": {"cancelled_at": "", "cancelled_by": ""}},
    )
    editor_name = _display_name(ctx["actor"])
    audit = EventEditAudit(
        event_id=event_id,
        event_title_at_edit=str(ev.get("title") or ""),
        editor_id=actor_id,
        editor_name=editor_name,
        editor_kind=ctx["kind"],
        source=source,
        severity="significant",
        action="restore",
        changes=[EventEditChange(field="cancelled", old=True, new=False)],
        summary=summarise([], "restore", str(ev.get("title") or ""), editor_name, source),
    )
    await db[COLL_EVENT_EDITS].insert_one(audit.dict())
    updated_ev = await db.events.find_one({"id": event_id}, {"_id": 0})
    return {"event": updated_ev, "audit": audit.dict()}


# ---------------------------------------------------------------------------
# undo — reverse the most-recent (non-undo) audit row for an event
# ---------------------------------------------------------------------------

async def undo_last_edit(db, *, event_id: str, actor_id: str, source: str = "george") -> dict:
    """Reverse the most recent user-initiated edit on `event_id` (skips
    prior undo rows so repeated undos walk further back in history).

    Only the editor who *made* the change can undo it, unless the
    caller is an admin — matches the "your own edit or an admin"
    principle from Garry's scope.
    """
    ctx = await _load_actor_context(db, event_id, actor_id)
    ev = ctx["event"]

    latest = await db[COLL_EVENT_EDITS].find_one(
        {"event_id": event_id, "action": {"$in": ["update", "cancel", "restore"]},
         "reversed_by_edit_id": {"$in": [None, ""]}},
        {"_id": 0},
        sort=[("created_at", -1)],
    )
    if not latest:
        raise EventEditError("nothing_to_undo", "There\u2019s nothing to undo on this event.")

    if latest["editor_id"] != actor_id and not ctx["actor"].get("is_admin"):
        raise EventEditError(
            "forbidden_undo",
            "Only the person who made the change can undo it \u2014 or an admin.",
        )

    action = latest["action"]
    if action == "cancel":
        # Reverse of cancel is restore.
        result = await restore_event(db=db, event_id=event_id, actor_id=actor_id, source=source)
    elif action == "restore":
        result = await cancel_event(db=db, event_id=event_id, actor_id=actor_id, source=source)
    else:
        # Rebuild the reverse-change dict from the original diff.
        reverse_changes = {c["field"]: c["old"] for c in latest["changes"]}
        result = await apply_edit(
            db=db, event_id=event_id, actor_id=actor_id,
            changes=reverse_changes, source=source,
            reverses_edit_id=latest["id"], action_override="undo",
        )
    # Ensure the reverses_edit_id linkage is stamped even when the
    # underlying helper wasn't `apply_edit` (cancel/restore reverses).
    if result["audit"].get("reverses_edit_id") != latest["id"]:
        await db[COLL_EVENT_EDITS].update_one(
            {"id": result["audit"]["id"]},
            {"$set": {"reverses_edit_id": latest["id"]}},
        )
        await db[COLL_EVENT_EDITS].update_one(
            {"id": latest["id"]},
            {"$set": {"reversed_by_edit_id": result["audit"]["id"]}},
        )
        result["audit"]["reverses_edit_id"] = latest["id"]
    _ = ev  # (event context is unused after ctx check — kept for future hooks)
    return result


# ---------------------------------------------------------------------------
# history — Mission Control feed helper
# ---------------------------------------------------------------------------

async def event_history(db, event_id: str, limit: int = 25) -> list[dict]:
    """Return the audit trail for a single event, newest-first."""
    cursor = db[COLL_EVENT_EDITS].find({"event_id": event_id}, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(limit)


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def _display_name(user_doc: dict) -> str:
    """Pick the warmest name we have for the actor — first name if present,
    otherwise username, otherwise the id. Used for MC/B7 summary lines."""
    for key in ("first_name", "display_name", "name", "username"):
        v = user_doc.get(key)
        if v and isinstance(v, str) and v.strip():
            return v.strip().split()[0] if key == "name" else v.strip()
    return str(user_doc.get("id") or "Someone")
