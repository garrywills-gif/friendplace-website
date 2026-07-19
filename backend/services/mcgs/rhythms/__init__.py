"""MCGS Phase 2 — Rhythms package.

See `/app/memory/mcgs-phase2-plan.md` for the full design.

Sub-modules:
- `models`     — collection names + index setup
- `settings`   — per-admin schedule/channel preferences
- `activity`   — admin heartbeat + inactivity checks
- `openers`    — rotating morning opener library

Milestones B–F (composer, delivery, scheduler, milestones)
will land as separate modules that import from these primitives.
"""

from .models import (
    COLL_BRIEFINGS,
    COLL_MILESTONES,
    COLL_ADMIN_ACTIVITY,
    COLL_RHYTHM_SETTINGS,
    ensure_indexes,
)
from .settings import (
    DEFAULT_SETTINGS,
    get_rhythm_settings,
    update_rhythm_settings,
)
from .activity import (
    record_admin_heartbeat,
    get_admin_activity,
    is_admin_active,
    minutes_since_last_seen,
)
from .openers import (
    MORNING_OPENERS,
    pick_morning_opener,
    recent_openers,
)

__all__ = [
    # models
    "COLL_BRIEFINGS",
    "COLL_MILESTONES",
    "COLL_ADMIN_ACTIVITY",
    "COLL_RHYTHM_SETTINGS",
    "ensure_indexes",
    # settings
    "DEFAULT_SETTINGS",
    "get_rhythm_settings",
    "update_rhythm_settings",
    # activity
    "record_admin_heartbeat",
    "get_admin_activity",
    "is_admin_active",
    "minutes_since_last_seen",
    # openers
    "MORNING_OPENERS",
    "pick_morning_opener",
    "recent_openers",
]
