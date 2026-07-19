"""MCGS Rhythms — per-admin settings.

Schedule + channel preferences. Admin-configurable from day one, with
safe defaults locked with Garry on 19 July 2026.

See `/app/memory/mcgs-phase2-plan.md` §Architecture additions.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Optional

from .models import COLL_RHYTHM_SETTINGS

# ---------------------------------------------------------------------------
# Defaults (locked with Garry 2026-07-19)
# ---------------------------------------------------------------------------

DEFAULT_SETTINGS: dict[str, Any] = {
    "timezone": "Australia/Melbourne",
    # Morning: weekdays 07:00, weekends 08:30 AEST.
    "morning_weekday_at": "07:00",
    "morning_weekend_at": "08:30",
    # Midday exception-based scan — evaluated at 12:30, silent by default.
    "midday_at": "12:30",
    # EOD target — considerate deferral rules apply (see activity.py).
    "eod_at": "18:00",
    "eod_inactivity_wait_minutes": 30,
    # Channels
    "email_channel_enabled": True,
    "push_channel_enabled": True,
    "eod_email_enabled": True,
    "midday_push_enabled": True,
    # Optional quiet hours (24h HH:MM) — no push during this window.
    "quiet_hours_start": "22:00",
    "quiet_hours_end": "06:30",
    # Vacation mode
    "vacation_mode": False,
}

_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_TIME_FIELDS = {
    "morning_weekday_at",
    "morning_weekend_at",
    "midday_at",
    "eod_at",
    "quiet_hours_start",
    "quiet_hours_end",
}
_BOOL_FIELDS = {
    "email_channel_enabled",
    "push_channel_enabled",
    "eod_email_enabled",
    "midday_push_enabled",
    "vacation_mode",
}
_INT_FIELDS = {"eod_inactivity_wait_minutes"}
_STR_FIELDS = {"timezone"}


class RhythmSettingsError(ValueError):
    """Invalid rhythm settings input."""


def _validate_patch(patch: dict[str, Any]) -> dict[str, Any]:
    """Validate an incoming settings patch. Returns a sanitised dict."""
    if not isinstance(patch, dict):
        raise RhythmSettingsError("Settings must be an object.")
    cleaned: dict[str, Any] = {}
    for key, value in patch.items():
        if key not in DEFAULT_SETTINGS:
            # Silently ignore unknown keys — no surprise persistence.
            continue
        if key in _TIME_FIELDS:
            if not isinstance(value, str) or not _TIME_RE.match(value):
                raise RhythmSettingsError(f"{key} must be HH:MM (24h)")
            cleaned[key] = value
        elif key in _BOOL_FIELDS:
            if not isinstance(value, bool):
                raise RhythmSettingsError(f"{key} must be a boolean")
            cleaned[key] = value
        elif key in _INT_FIELDS:
            if not isinstance(value, int) or value < 0 or value > 240:
                raise RhythmSettingsError(f"{key} must be an integer 0..240")
            cleaned[key] = value
        elif key in _STR_FIELDS:
            if not isinstance(value, str) or not value.strip():
                raise RhythmSettingsError(f"{key} must be a non-empty string")
            # We do NOT resolve tz here — Milestone C's scheduler will
            # validate against pytz/zoneinfo when it wires cron.
            cleaned[key] = value.strip()
    return cleaned


async def get_rhythm_settings(db: Any, admin_id: str) -> dict[str, Any]:
    """Return the admin's rhythm settings, merged with defaults."""
    row = await db[COLL_RHYTHM_SETTINGS].find_one(
        {"admin_id": admin_id}, {"_id": 0},
    ) or {}
    merged = {**DEFAULT_SETTINGS, **{k: v for k, v in row.items() if k in DEFAULT_SETTINGS}}
    merged["admin_id"] = admin_id
    merged["updated_at"] = row.get("updated_at")
    return merged


async def update_rhythm_settings(
    db: Any,
    admin_id: str,
    patch: dict[str, Any],
) -> dict[str, Any]:
    """Merge-patch the admin's rhythm settings. Only known keys are stored."""
    cleaned = _validate_patch(patch)
    if not cleaned:
        return await get_rhythm_settings(db, admin_id)
    now = datetime.now(timezone.utc).isoformat()
    await db[COLL_RHYTHM_SETTINGS].update_one(
        {"admin_id": admin_id},
        {"$set": {**cleaned, "updated_at": now}, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    return await get_rhythm_settings(db, admin_id)
