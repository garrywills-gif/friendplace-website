"""MCGS Rhythms — collection names + index setup.

Idempotent. Called from `server.py::_ensure_mcgs_indexes` on startup.
See `/app/memory/mcgs-phase2-plan.md` §Architecture additions.
"""

from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------------------
# Collection names — one source of truth
# ---------------------------------------------------------------------------

COLL_BRIEFINGS = "mcgs_briefings"
COLL_MILESTONES = "mcgs_milestones_awarded"
COLL_ADMIN_ACTIVITY = "mcgs_admin_activity"
COLL_RHYTHM_SETTINGS = "mcgs_rhythm_settings"


async def ensure_indexes(db: Any) -> None:
    """Create/refresh indexes for the Rhythms collections. Idempotent."""
    # Briefings — one row per Rhythm delivery, idempotent per admin/day.
    br = db[COLL_BRIEFINGS]
    # Unique daily key per admin/rhythm so restarts don't re-send.
    await br.create_index(
        [("admin_id", 1), ("rhythm_type", 1), ("date_key", 1)],
        unique=True,
        name="uniq_admin_rhythm_date",
    )
    await br.create_index([("admin_id", 1), ("delivered_at", -1)])
    await br.create_index([("status", 1), ("scheduled_for", 1)])

    # Milestones — once per (milestone_key, period).
    ms = db[COLL_MILESTONES]
    await ms.create_index(
        [("milestone_key", 1), ("period_key", 1)],
        unique=True,
        name="uniq_milestone_period",
    )
    await ms.create_index([("awarded_at", -1)])

    # Admin activity heartbeat.
    act = db[COLL_ADMIN_ACTIVITY]
    await act.create_index(
        [("admin_id", 1)], unique=True, name="uniq_admin_activity",
    )

    # Rhythm settings — one per admin.
    st = db[COLL_RHYTHM_SETTINGS]
    await st.create_index(
        [("admin_id", 1)], unique=True, name="uniq_admin_rhythm_settings",
    )
