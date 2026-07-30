"""Launch settings — the FriendPlace Launch Manager.

Single document in the ``settings`` collection with ``_id = "launch"``.
Everything lives in one place so the public countdown ribbon, the
MCGS Launch Manager, and George's launch-readiness observation all
read from the same source of truth.

Timezone contract (locked with Garry 30 July 2026):
- Storage: ALWAYS UTC ISO-8601.
- MCGS Launch Manager: displays Sydney time as canonical.
- Public countdown: ticks naturally in each visitor's local browser time.

Non-dismissible during the countdown window — visitors see it from the
moment ``enabled=True`` until the doors open. This is intentional per
Garry: "if you've decided to announce publicly, everyone should see it".
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any, Optional

log = logging.getLogger("friendplace.launch")

COLLECTION = "settings"
DOCUMENT_ID = "launch"

# ─── URL validation (Store links) ────────────────────────────────────────
_APPSTORE_RE = re.compile(r"^https://(apps|itunes)\.apple\.com/", re.I)
_PLAYSTORE_RE = re.compile(r"^https://play\.google\.com/", re.I)


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _to_iso(dt: datetime | None) -> str | None:
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def _parse_iso(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        s = str(value)
        # Accept "Z" suffix or "+00:00" — datetime.fromisoformat handles the latter.
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


# ─── Read / write ────────────────────────────────────────────────────────
DEFAULTS: dict[str, Any] = {
    "enabled": False,
    "launch_at": None,                # ISO UTC — the canonical launch moment
    "timezone_hint": "Australia/Sydney",
    "appstore_url": "",
    "playstore_url": "",
    "press_kit_ready": False,
    "launch_complete": False,
    "founding_target": 100,           # how many RYIs count as "ready"
    "welcome_message": "🦋 The doors are open. Welcome to FriendPlace.",
    "updated_at": None,
    "updated_by": None,
}


async def get_settings(db: Any) -> dict:
    """Load the launch settings doc, merged with defaults."""
    doc = await db[COLLECTION].find_one({"_id": DOCUMENT_ID}) or {}
    doc.pop("_id", None)
    merged = {**DEFAULTS, **doc}
    return merged


async def save_settings(db: Any, *, patch: dict, updated_by: str | None = None) -> dict:
    """Validate & upsert. Rejects invalid store URLs (must be App/Play Store)."""
    allowed = set(DEFAULTS.keys()) - {"updated_at", "updated_by"}
    update: dict[str, Any] = {}

    for key, value in (patch or {}).items():
        if key not in allowed:
            continue
        if key == "launch_at":
            if value in (None, ""):
                update[key] = None
            else:
                dt = _parse_iso(value)
                if not dt:
                    raise ValueError("launch_at must be an ISO datetime")
                update[key] = _to_iso(dt)
        elif key == "appstore_url":
            v = (value or "").strip()
            if v and not _APPSTORE_RE.match(v):
                raise ValueError("appstore_url must be an https://apps.apple.com/... link")
            update[key] = v
        elif key == "playstore_url":
            v = (value or "").strip()
            if v and not _PLAYSTORE_RE.match(v):
                raise ValueError("playstore_url must be an https://play.google.com/... link")
            update[key] = v
        elif key in ("enabled", "press_kit_ready", "launch_complete"):
            update[key] = bool(value)
        elif key == "founding_target":
            try:
                n = int(value)
                if n < 0:
                    raise ValueError()
                update[key] = n
            except Exception:
                raise ValueError("founding_target must be a non-negative integer")
        elif key == "timezone_hint":
            update[key] = (str(value) or "Australia/Sydney").strip() or "Australia/Sydney"
        elif key == "welcome_message":
            m = (str(value) or "").strip()
            update[key] = m[:200] or DEFAULTS["welcome_message"]

    update["updated_at"] = _to_iso(_now_utc())
    if updated_by:
        update["updated_by"] = updated_by

    await db[COLLECTION].update_one(
        {"_id": DOCUMENT_ID}, {"$set": update}, upsert=True,
    )
    return await get_settings(db)


# ─── Derived status ──────────────────────────────────────────────────────
def is_live(settings: dict, *, now: datetime | None = None) -> bool:
    """The doors are open when either the admin has flipped launch_complete
    manually, or the launch datetime has passed."""
    if settings.get("launch_complete"):
        return True
    launch_at = _parse_iso(settings.get("launch_at"))
    if not launch_at:
        return False
    return (now or _now_utc()) >= launch_at


def public_status(settings: dict, *, now: datetime | None = None) -> dict:
    """Payload for the public ``GET /api/public/launch-status`` endpoint.

    Store links are ONLY exposed when the countdown has finished — this
    is a deliberate anti-premature-click safeguard so a leaked App Store
    URL can't be hit before the app is approved and available.
    """
    live = is_live(settings, now=now)
    enabled = bool(settings.get("enabled"))
    launch_at = settings.get("launch_at")
    body: dict[str, Any] = {
        "enabled": enabled,
        "launch_at": launch_at,
        "is_live": live,
        "welcome_message": settings.get("welcome_message") or DEFAULTS["welcome_message"],
        # Only surface store links after the doors are open.
        "appstore_url": settings.get("appstore_url") if live else "",
        "playstore_url": settings.get("playstore_url") if live else "",
    }
    return body


# ─── George's Launch Readiness (deterministic observation) ───────────────
async def readiness_observation(db: Any, settings: dict) -> dict:
    """Rule-based observation surfaced in MCGS + George's surface context.
    Deliberately deterministic — Garry sees the same reasoning every time.
    Returns a small dict the UI can render directly.
    """
    live = is_live(settings)
    launch_at = _parse_iso(settings.get("launch_at"))
    enabled = bool(settings.get("enabled"))
    has_app = bool((settings.get("appstore_url") or "").strip())
    has_play = bool((settings.get("playstore_url") or "").strip())
    press = bool(settings.get("press_kit_ready"))

    # Founding registrations (best-effort; safe on missing collection).
    founding_current = 0
    try:
        founding_current = await db["interest_registrations"].count_documents(
            {"is_test": {"$ne": True}}
        )
    except Exception:
        pass
    founding_target = int(settings.get("founding_target") or 0)

    checklist = {
        "launch_date_set":     bool(launch_at),
        "countdown_enabled":   enabled,
        "appstore_link":       has_app,
        "playstore_link":      has_play,
        "founding_target_met": founding_target > 0 and founding_current >= founding_target,
        "press_kit_ready":     press,
        "launch_complete":     live,
    }

    if live:
        text = f"The doors have been open since {launch_at.strftime('%d %B %Y at %H:%M UTC') if launch_at else 'launch day'}. There's nothing more to prepare — the anticipation has done its work."
        tone = "live"
    elif not launch_at:
        text = "No launch date is set yet. When you've picked a day, I'll help you turn on the countdown."
        tone = "wait"
    elif enabled and (not has_app or not has_play):
        missing = []
        if not has_app: missing.append("App Store")
        if not has_play: missing.append("Google Play")
        plural = len(missing) > 1
        text = (
            f"The countdown is live, but the {' and '.join(missing)} link"
            f"{'s' if plural else ''} {'aren' if plural else 'isn'}'t set yet. "
            f"Visitors will land here at zero and won't know where to go — "
            f"I'd add {'them' if plural else 'it'} before we get any closer."
        )
        tone = "warn"
    elif not enabled and (not has_app or not has_play):
        text = "The launch date is set, but the store listings aren't in yet. I'd wait until the App Store listing is approved before enabling the public countdown."
        tone = "wait"
    elif not enabled:
        text = "Launch countdown isn't enabled yet. When you're happy with the launch date, I can help you turn it on."
        tone = "wait"
    else:
        # Enabled + date set + store links present.
        outstanding = []
        if not press: outstanding.append("Press kit")
        if founding_target > 0 and founding_current < founding_target:
            outstanding.append(
                f"Founding registrations ({founding_current} of {founding_target})"
            )
        if not outstanding:
            text = "Everything needed for launch is ready. When the countdown reaches zero, the doors open on their own."
            tone = "ready"
        else:
            joined = " and ".join(outstanding)
            text = f"Countdown is running and the essentials are in place. {joined} still to sort out — I'll keep them on the list until they're done."
            tone = "ready"

    return {
        "text": text,
        "tone": tone,             # "ready" | "wait" | "warn" | "live"
        "checklist": checklist,
        "founding": {"current": founding_current, "target": founding_target},
    }
