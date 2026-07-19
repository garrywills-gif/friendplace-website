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
from .midday import compose_midday_pulse
from .eod import compose_eod_wrapup
from .delivery import deliver_briefing
from .settings import get_rhythm_settings
from .activity import minutes_since_last_seen

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


async def run_midday_pulse(admin_id: str) -> None:
    """APScheduler entry-point for the Midday Pulse.

    Silent-by-default: composer returns `status: skipped` unless the
    material-change gate is met. When it fires, we deliver to Bridge
    (always) and push (only if genuinely important — see delivery.py).
    """
    if _db_ref is None:
        log.error("scheduler ran with no db reference")
        return
    try:
        settings = await get_rhythm_settings(_db_ref, admin_id)
        if settings.get("vacation_mode"):
            return
        row = await compose_midday_pulse(
            _db_ref,
            admin_id,
            timezone_name=settings.get("timezone"),
        )
        if row.get("status") == "skipped":
            log.info(
                "midday pulse skipped for %s (%s)",
                admin_id, row.get("skip_reason"),
            )
            return
        outcome = await deliver_briefing(_db_ref, row, settings)
        log.info("midday pulse delivered for %s: %s", admin_id, outcome)
    except Exception:
        log.exception("midday pulse scheduler job failed for %s", admin_id)


# EOD "considerate-deferral" cutoff — if Garry is still active by this
# hour (local), we skip EOD entirely for the day. Preserves the "George
# shouldn't feel like a scheduler; he should feel considerate" rule.
EOD_CUTOFF_HOUR = 22  # 10pm local


async def run_eod_wrapup(admin_id: str) -> None:
    """APScheduler entry-point for the End-of-Day Wrap-up.

    Considerate-deferral rule (Garry, 19 July 2026):
    - If Garry is still actively using MCGS at EOD time, DO NOT interrupt.
    - Wait until he's been inactive for `eod_inactivity_wait_minutes`
      (default 30), then deliver.
    - If he stays active into the evening (past EOD_CUTOFF_HOUR local),
      skip entirely — silence beats interruption.

    Implementation: the cron fires every 15 minutes from `eod_at` onward.
    Each fire evaluates the rule and either composes+delivers, or defers,
    or skips (marking today as "skipped_still_active").
    """
    if _db_ref is None:
        log.error("scheduler ran with no db reference")
        return
    try:
        settings = await get_rhythm_settings(_db_ref, admin_id)
        if settings.get("vacation_mode"):
            return

        # Import lazily to keep this module cheap to import.
        from .models import COLL_BRIEFINGS
        from datetime import datetime as _dt, timezone as _tz
        from zoneinfo import ZoneInfo

        tz_name = settings.get("timezone") or "Australia/Melbourne"
        try:
            tz = ZoneInfo(tz_name)
        except Exception:
            tz = ZoneInfo("Australia/Melbourne")
        local_now = _dt.now(_tz.utc).astimezone(tz)
        date_key = local_now.strftime("%Y-%m-%d")

        # Already handled today? (delivered OR explicitly skipped)
        existing = await _db_ref[COLL_BRIEFINGS].find_one(
            {"admin_id": admin_id, "rhythm_type": "eod", "date_key": date_key},
            {"_id": 0, "status": 1},
        )
        if existing:
            return  # nothing to do — one wrap-up per day

        # If we're past the cutoff hour and Garry has been active recently,
        # skip the day entirely. Record a "skipped" row so we don't retry.
        wait_minutes = int(settings.get("eod_inactivity_wait_minutes") or 30)
        idle_minutes = await minutes_since_last_seen(_db_ref, admin_id)

        past_cutoff = local_now.hour >= EOD_CUTOFF_HOUR
        # `idle_minutes` is None if the admin has never pinged — treat
        # as "inactive enough" so testing without heartbeats still works.
        garry_is_active = (
            idle_minutes is not None and idle_minutes < wait_minutes
        )

        if garry_is_active and not past_cutoff:
            log.info(
                "EOD deferred for %s — active %.1f min ago (wait %d min)",
                admin_id, idle_minutes or 0.0, wait_minutes,
            )
            return  # next 15-min tick will re-evaluate

        if past_cutoff and garry_is_active:
            # He stayed active into the evening — skip entirely.
            await _db_ref[COLL_BRIEFINGS].insert_one({
                "id": f"eod-skip-{admin_id}-{date_key}",
                "admin_id": admin_id,
                "rhythm_type": "eod",
                "date_key": date_key,
                "status": "skipped",
                "skip_reason": "still_active_past_cutoff",
                "created_at": _dt.now(_tz.utc).isoformat(),
            })
            log.info(
                "EOD skipped for %s — still active past %d:00 cutoff",
                admin_id, EOD_CUTOFF_HOUR,
            )
            return

        # He's been inactive long enough — deliver the wrap-up.
        row = await compose_eod_wrapup(
            _db_ref,
            admin_id,
            timezone_name=tz_name,
        )
        outcome = await deliver_briefing(_db_ref, row, settings)
        log.info("EOD wrap-up delivered for %s: %s", admin_id, outcome)
    except Exception:
        log.exception("EOD wrap-up scheduler job failed for %s", admin_id)


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
    # Midday pulse (exception-based). Runs every day — the composer's
    # material-change gate decides whether anything actually happens.
    h, m = _parse_hhmm(settings.get("midday_at") or "12:30", 12, 30)
    _scheduler.add_job(
        run_midday_pulse,
        trigger=CronTrigger(hour=h, minute=m, timezone=tz_name),
        args=[admin_id],
        id=_job_id(admin_id, "midday"),
        replace_existing=True,
        misfire_grace_time=60 * 30,
    )
    # End-of-Day wrap-up (considerate deferral). Fires every 15 minutes
    # from `eod_at` through the cutoff hour so we can wait out Garry's
    # session inactivity without hard-coding a single tick.
    eh, em = _parse_hhmm(settings.get("eod_at") or "18:00", 18, 0)
    _scheduler.add_job(
        run_eod_wrapup,
        trigger=CronTrigger(
            hour=f"{eh}-{EOD_CUTOFF_HOUR - 1}",
            minute=f"{em}/15" if em else "*/15",
            timezone=tz_name,
        ),
        args=[admin_id],
        id=_job_id(admin_id, "eod"),
        replace_existing=True,
        misfire_grace_time=60 * 30,
    )
    log.info(
        "Rescheduled rhythms for admin %s (tz=%s, weekday=%s, weekend=%s, midday=%s, eod=%s)",
        admin_id,
        tz_name,
        settings.get("morning_weekday_at"),
        settings.get("morning_weekend_at"),
        settings.get("midday_at"),
        settings.get("eod_at"),
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
