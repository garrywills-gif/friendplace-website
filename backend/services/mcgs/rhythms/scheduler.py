"""MCGS Rhythms — APScheduler wiring.

Milestone C. One AsyncIOScheduler for the process, with per-admin
timezone-aware cron jobs. Every admin's rhythm settings drive their
own schedule:

- Morning Briefing on weekdays at `morning_weekday_at` in admin's tz.
- Morning Briefing on weekends at `morning_weekend_at` in admin's tz.
- Midday Pulse / EOD Wrap-up land in later milestones — the scheduler
  is designed so those hooks slot in cleanly.

Design rules Garry locked in on 2026-07-19:
- **One briefing per day.** The composer is idempotent by unique index;
  if Garry asks Ask George for his briefing before the cron fires,
  that becomes today's briefing and the cron simply delivers to
  secondary channels.
- **Dedup across channels.** Delivery respects `bridge_seen_at`.
- **Timezone from settings.** Admin edits their tz, we reschedule.
- **Never send from a restarted mid-morning process.** Composer
  idempotency prevents duplicate rows; delivery idempotency prevents
  duplicate emails/pushes.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from .composer import compose_morning_briefing
from .delivery import deliver_briefing
from .settings import get_rhythm_settings

log = logging.getLogger("friendplace.mcgs.rhythms.scheduler")

# Process-singleton scheduler. Created lazily on first `start_scheduler`
# call so we don't spin one up in unit tests that don't need it.
_scheduler: Optional[AsyncIOScheduler] = None
_db_ref: Any = None


def _parse_hhmm(value: str, default_h: int, default_m: int) -> tuple[int, int]:
    try:
        h, m = value.split(":", 1)
        return int(h), int(m)
    except Exception:
        return default_h, default_m


def _job_id(admin_id: str, kind: str) -> str:
    return f"mcgs.rhythms.{kind}.{admin_id}"


# ---------------------------------------------------------------------------
# Job function
# ---------------------------------------------------------------------------

async def run_morning_briefing(admin_id: str) -> None:
    """APScheduler entry-point for the Morning Briefing.

    - Composes (idempotent by unique index).
    - Delivers to secondary channels honoring dedup + settings.
    - Never raises — scheduler failures must not crash the loop.
    """
    if _db_ref is None:
        log.error("scheduler ran with no db reference")
        return
    try:
        settings = await get_rhythm_settings(_db_ref, admin_id)
        if settings.get("vacation_mode"):
            log.info("morning briefing skipped for %s — vacation mode", admin_id)
            return
        row = await compose_morning_briefing(
            _db_ref,
            admin_id,
            timezone_name=settings.get("timezone"),
        )
        outcome = await deliver_briefing(_db_ref, row, settings)
        log.info("morning briefing delivered for %s: %s", admin_id, outcome)
    except Exception:
        log.exception("morning briefing scheduler job failed for %s", admin_id)


# ---------------------------------------------------------------------------
# Scheduling API
# ---------------------------------------------------------------------------

async def reschedule_admin(admin_id: str) -> None:
    """Rebuild all rhythm jobs for a single admin.

    Idempotent — replaces existing jobs by id. Safe to call after any
    settings change.
    """
    global _scheduler
    if _scheduler is None or _db_ref is None:
        return
    settings = await get_rhythm_settings(_db_ref, admin_id)
    tz_name = settings.get("timezone") or "Australia/Melbourne"

    # Weekday morning.
    h, m = _parse_hhmm(settings.get("morning_weekday_at") or "07:00", 7, 0)
    _scheduler.add_job(
        run_morning_briefing,
        trigger=CronTrigger(day_of_week="mon-fri", hour=h, minute=m, timezone=tz_name),
        args=[admin_id],
        id=_job_id(admin_id, "morning-weekday"),
        replace_existing=True,
        misfire_grace_time=60 * 30,  # forgive up to 30 min misfire; idempotent anyway.
    )
    # Weekend morning.
    h, m = _parse_hhmm(settings.get("morning_weekend_at") or "08:30", 8, 30)
    _scheduler.add_job(
        run_morning_briefing,
        trigger=CronTrigger(day_of_week="sat,sun", hour=h, minute=m, timezone=tz_name),
        args=[admin_id],
        id=_job_id(admin_id, "morning-weekend"),
        replace_existing=True,
        misfire_grace_time=60 * 30,
    )
    log.info(
        "Rescheduled rhythms for admin %s (tz=%s, weekday=%s, weekend=%s)",
        admin_id,
        tz_name,
        settings.get("morning_weekday_at"),
        settings.get("morning_weekend_at"),
    )


async def start_scheduler(db: Any) -> None:
    """Start the process singleton scheduler and register every admin's
    rhythm jobs.

    Called from `server.py` on startup. Safe to call multiple times —
    subsequent calls are no-ops.
    """
    global _scheduler, _db_ref
    _db_ref = db
    if _scheduler is not None:
        return
    _scheduler = AsyncIOScheduler(timezone="UTC")
    _scheduler.start()
    log.info("MCGS Rhythms scheduler started.")

    # Register every existing admin.
    async for admin in db.cms_admins.find({}, {"_id": 0, "id": 1}):
        aid = admin.get("id")
        if aid:
            try:
                await reschedule_admin(aid)
            except Exception:
                log.exception("initial reschedule failed for %s", aid)


def scheduler_status() -> dict:
    """Return a compact snapshot of the current job table — useful for
    debugging and for a small "schedule" surface in the UI."""
    if _scheduler is None:
        return {"running": False, "jobs": []}
    jobs: list[dict] = []
    for job in _scheduler.get_jobs():
        try:
            next_run = job.next_run_time.isoformat() if job.next_run_time else None
        except Exception:
            next_run = None
        jobs.append({
            "id": job.id,
            "next_run_at": next_run,
            "trigger": str(job.trigger),
        })
    return {"running": _scheduler.running, "jobs": jobs}
