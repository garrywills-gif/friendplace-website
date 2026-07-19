"""Append-only audit trail for MCGS.

Every mutation across the platform writes one row to
`mcgs_activity_log`. It's the safety net — retention forever, no
update or delete surface anywhere. Higher-level services also write
fast per-entity transitions (e.g. `signals.state_transitions[]`), so
this log is the *global* cross-entity view.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def log_activity(
    db: Any,
    *,
    actor_id: Optional[str],
    actor_kind: str,                      # "human" | "george" | "system" | "scheduled"
    action: str,                          # short verb, e.g. "signal.resolve"
    entity_ref: dict,                     # {kind, id}
    before: Optional[dict] = None,
    after: Optional[dict] = None,
    george_involved: bool = False,
    case_id: Optional[str] = None,
    channel: str = "api",                 # "bridge" | "ask_george_voice" | "ask_george_text" | "api" | "scheduled"
    notes: Optional[str] = None,
) -> dict:
    """Insert a single row into `mcgs_activity_log`.

    Never raises for auditing failures — logs a warning and returns an
    empty dict so callers don't have to wrap us in try/except. The
    activity log is a safety net, not a critical path.
    """
    row = {
        "id": str(uuid.uuid4()),
        "at": _now_iso(),
        "actor_id": actor_id,
        "actor_kind": actor_kind,
        "action": action,
        "entity_ref": entity_ref,
        "before": before,
        "after": after,
        "george_involved": george_involved,
        "case_id": case_id,
        "channel": channel,
        "notes": notes,
    }
    try:
        await db.mcgs_activity_log.insert_one(dict(row))
    except Exception:
        import logging
        logging.getLogger("friendplace.mcgs.audit").exception(
            "activity_log insert failed for action=%s entity=%s", action, entity_ref,
        )
        return {}
    return row


async def ensure_indexes(db: Any) -> None:
    """Create indexes for `mcgs_activity_log`. Idempotent."""
    coll = db.mcgs_activity_log
    await coll.create_index([("at", -1)])
    await coll.create_index([("entity_ref.kind", 1), ("entity_ref.id", 1)])
    await coll.create_index([("actor_id", 1), ("at", -1)])
    await coll.create_index([("case_id", 1)])
