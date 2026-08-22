"""iter162 — Mission Control Reminders (small, launch-safe V1).

Scope:
  - George can create one-off + recurring (daily/weekly/monthly) reminders
    from chat, only after explicit admin request.
  - Reminders never send emails, publish content, or trigger moderation.
  - George MUST wait for the save-success before claiming a reminder exists;
    tools return only what's confirmed in Mongo.

Public surface:
  - services.reminders.store  — Mongo CRUD helpers
  - services.reminders.router — /api/mcgs/reminders REST endpoints
"""
from .store import (
    COLL_REMINDERS,
    REMINDER_RECURRENCE,
    REMINDER_STATUSES,
    create_reminder,
    list_reminders,
    get_reminder,
    complete_reminder,
    delete_reminder,
    update_reminder,
    ensure_indexes,
)

__all__ = [
    "COLL_REMINDERS", "REMINDER_RECURRENCE", "REMINDER_STATUSES",
    "create_reminder", "list_reminders", "get_reminder",
    "complete_reminder", "delete_reminder", "update_reminder",
    "ensure_indexes",
]
