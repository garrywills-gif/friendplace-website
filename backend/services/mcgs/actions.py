"""MCGS Action Preview execution.

Everything George proposes lands here as an *executable*. The endpoints
that call these functions accept only ``confirmed=True`` bodies from an
authenticated admin \u2014 which is how the voice safeguard is enforced
(voice can create the proposal, but a human click confirms the action).

Every execution:

* Runs the underlying side-effect (email send, submission decision).
* Records the actor + whether George was involved in `mcgs_activity_log`.
* Resolves any linked MCGS Case so the Signal Feed clears the item.

Design refs:
- ``/app/memory/mcgs-architecture.md`` \u00a74 (Action Preview pattern)
- ``/app/memory/mcgs-phase1-plan.md`` \u00a74.3
"""

from __future__ import annotations

import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from .signals import transition_case, get_case
from .audit import log_activity

log = logging.getLogger("friendplace.mcgs.actions")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Ticket reply
# ---------------------------------------------------------------------------

async def execute_ticket_reply(
    db: Any,
    *,
    ticket_id: str,
    reply_text: str,
    admin: dict,
    george_involved: bool,
    george_reasoning: Optional[str] = None,
    case_id: Optional[str] = None,
) -> dict:
    """Send an email reply to a support ticket + close the ticket + resolve
    the linked MCGS Case."""
    ticket = await db.support_tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise ValueError(f"ticket not found: {ticket_id}")

    reply = (reply_text or "").strip()
    if not reply:
        raise ValueError("reply_text is empty")

    # Send the email via Resend (existing email_service).
    try:
        from email_service import send_email
        support_from = (os.getenv("SUPPORT_EMAIL") or "support@friendplace.com.au").strip()
        html_body = (
            f"<p>Hi {ticket.get('name') or 'there'},</p>"
            f"<p>{reply.replace(chr(10), '</p><p>')}</p>"
            "<p>&mdash;<br>The FriendPlace Team</p>"
        )
        text_body = (
            f"Hi {ticket.get('name') or 'there'},\n\n"
            f"{reply}\n\n"
            "—\nThe FriendPlace Team"
        )
        await send_email(
            to=ticket.get("email") or "",
            subject=f"Re: {ticket.get('subject') or 'your FriendPlace ticket'}",
            html=html_body,
            text=text_body,
            reply_to=support_from,
        )
    except Exception:
        log.exception("email send failed during ticket reply")
        raise RuntimeError("Sorry — the email couldn't be delivered. The ticket is unchanged.")

    now = _now_iso()
    reply_record = {
        "id": str(uuid.uuid4()),
        "reply_text": reply,
        "sent_at": now,
        "sent_by": admin.get("id"),
        "sent_by_name": admin.get("name") or admin.get("email"),
        "george_involved": bool(george_involved),
        "george_reasoning": george_reasoning,
    }
    await db.support_tickets.update_one(
        {"id": ticket_id},
        {
            "$set": {"status": "resolved", "updated_at": now, "last_reply_at": now},
            "$push": {"replies": reply_record},
        },
    )

    await log_activity(
        db,
        actor_id=admin.get("id"),
        actor_kind="human",
        action="support.ticket.reply_sent",
        entity_ref={"kind": "support_ticket", "id": ticket_id},
        before={"status": ticket.get("status")},
        after={"status": "resolved", "reply_id": reply_record["id"]},
        george_involved=bool(george_involved),
        case_id=case_id,
        channel="bridge",
        notes=(george_reasoning or None),
    )

    # Resolve linked Case (if provided).
    if case_id:
        try:
            case = await get_case(db, case_id)
            if case and case.get("status") in {"NEW", "SEEN", "IN_REVIEW", "SNOOZED", "ESCALATED"}:
                await transition_case(
                    db,
                    case_id=case_id,
                    to_state="RESOLVED",
                    actor_id=admin.get("id"),
                    actor_kind="human",
                    via_channel="bridge",
                    resolved_action="replied via George",
                )
        except Exception:
            log.exception("case resolution after ticket reply failed")

    return {"ok": True, "reply_id": reply_record["id"], "case_resolved": bool(case_id)}


# ---------------------------------------------------------------------------
# Event submission decision
# ---------------------------------------------------------------------------

async def execute_submission_decision(
    db: Any,
    *,
    submission_id: str,
    decision: str,            # "approve" | "reject" | "changes_requested"
    note: Optional[str],
    admin: dict,
    george_involved: bool,
    george_reasoning: Optional[str] = None,
    case_id: Optional[str] = None,
) -> dict:
    """Execute a decision on an event submission."""
    if decision not in {"approve", "reject", "changes_requested"}:
        raise ValueError(f"unknown decision: {decision}")

    sub = await db.cms_event_submissions.find_one({"id": submission_id}, {"_id": 0})
    if not sub:
        raise ValueError(f"submission not found: {submission_id}")
    if sub.get("status") != "pending":
        raise ValueError(f"submission is already {sub.get('status')}")

    result: dict[str, Any] = {"ok": True, "decision": decision}
    now = _now_iso()

    if decision == "approve":
        # Same shape as the existing cms_module approval flow: promote to
        # a draft cms_event (never auto-publish).
        event_id = str(uuid.uuid4())
        slug_base = re.sub(r"[^a-z0-9]+", "-", (sub.get("event_title") or "event").lower()).strip("-") or "event"
        slug = slug_base
        n = 1
        while await db.cms_events.find_one({"slug": slug}):
            n += 1
            slug = f"{slug_base}-{n}"
        cover_b64 = sub.get("cover_image_base64")
        cover_url = cover_b64 if isinstance(cover_b64, str) and cover_b64.startswith("data:") else ""
        event_doc = {
            "id": event_id, "slug": slug,
            "title": sub.get("event_title") or "",
            "description": sub.get("description") or "",
            "body_html": "", "cover_image_url": cover_url,
            "starts_at": sub.get("event_starts_at"),
            "ends_at": sub.get("event_ends_at"),
            "timezone": "Australia/Sydney",
            "is_online": False,
            "venue_name": sub.get("venue_name") or "",
            "venue_address": sub.get("venue_address") or "",
            "venue_url": "", "meeting_url": "",
            "capacity": sub.get("capacity"),
            "rsvp_deadline_at": "",
            "cost_type": sub.get("cost_type") or "free",
            "cost_display": sub.get("cost_display") or ("Free" if (sub.get("cost_type") or "free") == "free" else ""),
            "organiser_name": sub.get("organisation_name") or "",
            "organiser_contact": sub.get("contact_email") or "",
            "accessibility_info": sub.get("accessibility_info") or "",
            "sponsors": [],
            "status": "draft",
            "hidden": False,
            "created_at": now, "updated_at": now,
            "created_by": f"submission:{sub.get('submission_ref')}",
        }
        await db.cms_events.insert_one(dict(event_doc))
        await db.cms_event_submissions.update_one(
            {"id": submission_id},
            {"$set": {"status": "approved", "resulting_event_id": event_id, "updated_at": now, "reviewer_notes": note}},
        )
        result.update({"event_id": event_id, "event_slug": slug})

    elif decision == "reject":
        await db.cms_event_submissions.update_one(
            {"id": submission_id},
            {"$set": {"status": "rejected", "reviewer_notes": (note or "").strip() or None, "updated_at": now}},
        )
        # Send a warm rejection email (best-effort).
        try:
            from email_service import send_email
            support_from = (os.getenv("SUPPORT_EMAIL") or "support@friendplace.com.au").strip()
            reason_html = f"<br><em>{note.strip()}</em>" if note else ""
            await send_email(
                to=sub.get("contact_email") or "",
                subject=f"Your event submission — {sub.get('submission_ref')}",
                html=(
                    f"<p>Hi {sub.get('contact_name') or 'there'},</p>"
                    f"<p>Thanks for submitting <strong>{sub.get('event_title') or 'your event'}</strong> for FriendPlace.</p>"
                    f"<p>After review, we weren&rsquo;t able to publish this listing on this occasion.{reason_html}</p>"
                    "<p>You&rsquo;re very welcome to submit another event any time.</p>"
                    "<p>💜 The FriendPlace Team</p>"
                ),
                text=(
                    f"Hi {sub.get('contact_name') or 'there'},\n\n"
                    f"Thanks for submitting {sub.get('event_title') or 'your event'} for FriendPlace.\n\n"
                    "After review, we weren't able to publish this listing on this occasion."
                    + (f"\n\nReason: {note.strip()}\n" if note else "")
                    + "\nYou're very welcome to submit another event any time.\n\n💜 The FriendPlace Team"
                ),
                reply_to=support_from,
            )
        except Exception:
            log.exception("submission rejection email failed")

    else:  # changes_requested
        await db.cms_event_submissions.update_one(
            {"id": submission_id},
            {"$set": {"status": "changes_requested", "reviewer_notes": (note or "").strip() or None, "updated_at": now}},
        )

    await log_activity(
        db,
        actor_id=admin.get("id"),
        actor_kind="human",
        action=f"event_submission.{decision}",
        entity_ref={"kind": "event_submission", "id": submission_id},
        before={"status": "pending"},
        after={"status": {"approve": "approved", "reject": "rejected", "changes_requested": "changes_requested"}[decision]},
        george_involved=bool(george_involved),
        case_id=case_id,
        channel="bridge",
        notes=(george_reasoning or None),
    )

    # Resolve linked Case.
    if case_id:
        try:
            case = await get_case(db, case_id)
            if case and case.get("status") in {"NEW", "SEEN", "IN_REVIEW", "SNOOZED", "ESCALATED"}:
                await transition_case(
                    db,
                    case_id=case_id,
                    to_state="RESOLVED",
                    actor_id=admin.get("id"),
                    actor_kind="human",
                    via_channel="bridge",
                    resolved_action=f"{decision} via George",
                )
        except Exception:
            log.exception("case resolution after submission decision failed")

    return result
