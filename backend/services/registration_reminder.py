"""
Registration reminder service — fires exactly ONE friendly nudge, 24
hours after someone starts /public/register-interest, if (and only if)
they're still `pending_confirmation` with no `founder_number`.

Context (Neo, Feb 2026 — Vik's missing FMN):
    Our two-phase register-interest flow lets a visitor abandon between
    the first screen (which saves `pending_confirmation`) and the
    confirmation tap ("That's my hello"), which is the only place a
    Founding Member number is drawn. Vik is a real example — the
    timeline said "Registered as Founding Member" but no number was
    allocated and no acknowledgement email was sent. This service
    sends one gentle reminder to help those visitors finish.

Guarantees (per Garry's spec):
    • Fires exactly ONCE per registration. The row stamps
      `reminder_sent_at` + `reminder_message_id` on success so a
      restart cannot double-send.
    • RE-CHECKS the row's status + founder_number right before
      sending (status may have flipped between the eligibility scan
      and the actual send).
    • Respects `email_suppressions` via
      `services.suppression.is_suppressed`.
    • Only touches rows marked `reminder_eligible: True`. Phase 1
      inserts are stamped this way from the iter where this service
      landed; EVERY pre-existing pending row lacks the field (or has
      `False`), so no legacy abandonee is ever retro-emailed.
    • Writes a `history[]` entry on the row so the CRM timeline shows
      the reminder.
    • Never crashes the app — any transport / template failure is
      logged and the row's `reminder_sent_at` stays unset so a later
      successful attempt can still happen (but a *second* attempt
      stamps `reminder_failed_at` to avoid tight loops).

Loop cadence: 5 minutes. Each pass selects at most a small batch so
one hiccup can't fan out into a stampede.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from html import escape as _html_escape
from typing import Any

logger = logging.getLogger("friendplace.registration_reminder")

# How long after Phase 1 before we nudge.
_WAIT_HOURS = 24

# How often the background loop wakes up to look for eligible rows.
_POLL_SECONDS = 300  # 5 minutes

# Soft upper bound on batch size so one DB hiccup can't fan into a
# stampede of thousands of parallel sends. 24h window + 5-minute poll
# means we'd typically only see 0-5 eligible rows per pass anyway.
_BATCH_LIMIT = 50


def _finish_url(reg_id: str) -> str:
    """Build the public resume URL the member taps from the email.

    The website hosts a lightweight `register-interest/finish?rid=...`
    page that re-uses the Phase 2 confirm endpoint under the hood, so
    the member's existing details, companion choice, and founder-number
    draw are all honoured. The link is bound to the specific reg_id so
    it cannot be guessed or re-used to create a NEW registration.
    """
    base = (os.getenv("PUBLIC_WEB_BASE_URL")
            or os.getenv("WEBSITE_BASE_URL")
            or "https://friendplace.com.au").rstrip("/")
    return f"{base}/register-interest/finish?rid={reg_id}"


def _reminder_template(first_name: str, companion: str, finish_url: str) -> tuple[str, str, str]:
    """Warm, singular reminder — subject, HTML, text."""
    name = first_name or "friend"
    host = "Georgia" if (companion or "").lower() == "georgia" else "George"
    subject = f"One quick tap to finish, {name} \u2014 your Founding Member spot is waiting"
    safe_name = _html_escape(name)
    safe_url  = _html_escape(finish_url, quote=True)
    html = (
        f"<p>Hi {safe_name},</p>"
        f"<p>You started your Founding Member registration yesterday and the "
        f"details are all saved \u2014 we just need one last tap to lock in "
        f"your spot and send your Founding Member number.</p>"
        f"<p style='margin: 24px 0;'>"
        f"<a href=\"{safe_url}\" style=\"display:inline-block;background:#0F766E;"
        f"color:#FFFFFF;text-decoration:none;padding:12px 22px;border-radius:999px;"
        f"font-weight:700;\">Finish my registration</a>"
        f"</p>"
        f"<p style='font-size:14px;color:#64748B;'>The link resumes exactly where "
        f"you left off \u2014 no new form to fill in. If you'd rather not continue, "
        f"you can safely ignore this email and we won't nudge you again.</p>"
        f"<p>Warmly,<br/>{host} at FriendPlace</p>"
    )
    text = (
        f"Hi {name},\n\n"
        f"You started your Founding Member registration yesterday. One last "
        f"tap locks in your spot and sends your Founding Member number:\n\n"
        f"{finish_url}\n\n"
        f"The link resumes exactly where you left off. If you'd rather not "
        f"continue, you can safely ignore this email \u2014 we won't nudge "
        f"you again.\n\n"
        f"Warmly,\n{host} at FriendPlace\n"
    )
    return subject, html, text


async def _eligible_cursor(db, cutoff_iso: str):
    """Row filter — must satisfy every guard the service promises."""
    query: dict[str, Any] = {
        "reminder_eligible": True,
        "status": "pending_confirmation",
        "$or": [
            {"founder_number": {"$exists": False}},
            {"founder_number": None},
            {"founder_number": 0},
        ],
        "reminder_sent_at":   {"$exists": False},
        "merged_into":        None,
        "is_test":            {"$ne": True},
        "is_reserved":        {"$ne": True},
        "created_at":         {"$lt": cutoff_iso},
    }
    return db.interest_registrations.find(query, {"_id": 0}).sort("created_at", 1).limit(_BATCH_LIMIT)


async def _still_eligible(db, reg_id: str) -> dict | None:
    """Re-check the row RIGHT BEFORE sending so we never nudge a row
    that confirmed in the few seconds between batch scan and send."""
    row = await db.interest_registrations.find_one(
        {
            "id": reg_id,
            "status": "pending_confirmation",
            "reminder_sent_at": {"$exists": False},
            "$or": [
                {"founder_number": {"$exists": False}},
                {"founder_number": None},
                {"founder_number": 0},
            ],
        },
        {"_id": 0},
    )
    return row


async def _send_one(db, row: dict) -> None:
    reg_id = row.get("id")
    email  = (row.get("email") or "").strip().lower()
    if not reg_id or not email:
        return

    # Suppressions check (unsubscribe / hard bounce / spam complaint).
    try:
        from services.suppression import is_suppressed
        if await is_suppressed(db, email):
            # Mark so we never try again for this row.
            await db.interest_registrations.update_one(
                {"id": reg_id},
                {"$set": {
                    "reminder_skipped_at": datetime.now(timezone.utc).isoformat(),
                    "reminder_skip_reason": "suppressed",
                }},
            )
            return
    except Exception:
        logger.exception("suppression check failed for reg %s", reg_id)
        # Fail-safe: refuse to send if we can't verify suppression.
        return

    # Final liveness re-check (race-safe).
    fresh = await _still_eligible(db, reg_id)
    if not fresh:
        return

    first_name = (fresh.get("first_name") or "").strip() or "friend"
    companion  = (fresh.get("companion_choice") or "george").lower()
    finish_url = _finish_url(reg_id)
    subject, html_body, text_body = _reminder_template(first_name, companion, finish_url)

    # Send via the standard transport so Resend bounces / unsubscribes
    # feed back into the suppressions pipeline.
    try:
        from email_service import send_email_detailed
        result = await send_email_detailed(
            to=email,
            subject=subject,
            html=html_body,
            text=text_body,
        )
    except Exception:
        logger.exception("reminder send failed for %s", reg_id)
        return

    now = datetime.now(timezone.utc).isoformat()
    if getattr(result, "ok", False):
        try:
            await db.interest_registrations.update_one(
                {"id": reg_id, "reminder_sent_at": {"$exists": False}},
                {"$set": {
                    "reminder_sent_at":    now,
                    "reminder_message_id": getattr(result, "message_id", None),
                    "reminder_source":     "registration_reminder.service",
                }, "$push": {
                    "history": {
                        "at": now,
                        "kind": "reminder_sent",
                        "reason": "email_sent",
                        "template": "registration_reminder",
                        "subject": subject,
                        "message_id": getattr(result, "message_id", None),
                        "actor_email": "system",
                        "actor_id": "registration_reminder",
                    },
                }},
            )
            logger.info("registration reminder sent reg=%s to=%s msg=%s", reg_id, email, getattr(result, "message_id", None))
        except Exception:
            logger.exception("reminder bookkeeping update failed for %s", reg_id)
    else:
        # Record the attempt so we don't retry on the next pass. One
        # genuine ask is enough — if the first try didn't land, chasing
        # it harder isn't what the member asked for.
        try:
            await db.interest_registrations.update_one(
                {"id": reg_id},
                {"$set": {
                    "reminder_failed_at": now,
                    "reminder_failure_reason": getattr(result, "error", None) or "unknown",
                }},
            )
        except Exception:
            logger.exception("reminder failure bookkeeping update failed for %s", reg_id)


async def _once(db) -> int:
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=_WAIT_HOURS)).isoformat()
    cur = await _eligible_cursor(db, cutoff_iso=cutoff)
    sent = 0
    async for row in cur:
        await _send_one(db, row)
        sent += 1
    return sent


async def run_loop(db) -> None:
    """Long-lived background loop. Never crashes the app."""
    logger.info(
        "registration_reminder loop starting (wait_hours=%d poll_seconds=%d)",
        _WAIT_HOURS, _POLL_SECONDS,
    )
    # Small warm-up delay so startup migrations finish first.
    await asyncio.sleep(30)
    while True:
        try:
            batch = await _once(db)
            if batch:
                logger.info("registration_reminder processed %d row(s)", batch)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("registration_reminder pass failed (will retry)")
        try:
            await asyncio.sleep(_POLL_SECONDS)
        except asyncio.CancelledError:
            raise


__all__ = ["run_loop"]
