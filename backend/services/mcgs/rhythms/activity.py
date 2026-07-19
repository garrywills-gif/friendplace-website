"""MCGS Rhythms — admin activity heartbeat.

Used by the End-of-Day considerate-deferral rule:

- If Garry is still actively using MCGS at his EOD target time, do not
  interrupt. Wait until he's been inactive for ~30 minutes, then
  deliver. If he stays active into the evening, skip entirely.

Every authenticated MCGS API call records a heartbeat via
`record_admin_heartbeat`. `is_admin_active` and
`minutes_since_last_seen` power the deferral logic in
Milestone E's scheduler.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from .models import COLL_ADMIN_ACTIVITY

# Any authenticated MCGS API call within this window counts as "active".
ACTIVE_WINDOW_MINUTES = 5


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


async def record_admin_heartbeat(
    db: Any,
    admin_id: str,
    route: Optional[str] = None,
) -> None:
    """Upsert the admin's last-seen timestamp. Best-effort, never raises."""
    if not admin_id:
        return
    try:
        now = _now_utc().isoformat()
        await db[COLL_ADMIN_ACTIVITY].update_one(
            {"admin_id": admin_id},
            {
                "$set": {
                    "admin_id": admin_id,
                    "last_seen_at": now,
                    "last_route": route,
                },
                "$setOnInsert": {"session_started_at": now},
            },
            upsert=True,
        )
    except Exception:
        # Heartbeats must never break API calls.
        pass


async def get_admin_activity(db: Any, admin_id: str) -> Optional[dict]:
    """Return the raw activity row, or None if never seen."""
    if not admin_id:
        return None
    return await db[COLL_ADMIN_ACTIVITY].find_one(
        {"admin_id": admin_id}, {"_id": 0},
    )


def _parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None


async def minutes_since_last_seen(db: Any, admin_id: str) -> Optional[float]:
    """Return minutes since last heartbeat, or None if never seen."""
    row = await get_admin_activity(db, admin_id)
    if not row:
        return None
    last = _parse_iso(row.get("last_seen_at"))
    if not last:
        return None
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    delta = _now_utc() - last
    return max(delta.total_seconds() / 60.0, 0.0)


async def is_admin_active(
    db: Any,
    admin_id: str,
    window_minutes: int = ACTIVE_WINDOW_MINUTES,
) -> bool:
    """True if the admin has pinged within the last `window_minutes`."""
    mins = await minutes_since_last_seen(db, admin_id)
    if mins is None:
        return False
    return mins <= window_minutes
