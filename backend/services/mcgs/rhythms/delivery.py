"""MCGS Rhythms — multi-channel delivery.

Bridge is the source of truth. Email and push are secondary channels
that *only* fire if the Bridge card hasn't been seen yet at delivery
time. This is Garry's rule (2026-07-19):

> "If I've already read today's briefing on the Bridge, George shouldn't
>  send me the same information again by email later."

Delivery is idempotent per (briefing_id, channel) via
`channels_delivered` on the briefing row.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from .models import COLL_BRIEFINGS

log = logging.getLogger("friendplace.mcgs.rhythms.delivery")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# HTML rendering — same content as the Bridge, just wrapped for email.
# Rule: never generate a different version per channel.
# ---------------------------------------------------------------------------

def _render_email_html(content: dict, admin_display_name: Optional[str] = None) -> str:
    """Render the composed briefing as a minimal, warm HTML email.

    We keep the styling gentle — the email brings Garry back to the
    Bridge, it isn't the destination.
    """
    opener = content.get("opener_line") or ""
    cont = content.get("continuity_line")
    noticed = content.get("noticed_line")
    sections = content.get("sections") or []
    moments = [m for m in (content.get("celebrated_moments") or []) if m]
    rec = content.get("recommendation") or ""

    parts: list[str] = []
    parts.append(
        "<div style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;"
        "max-width:560px;margin:0 auto;padding:24px;color:#0F172A;line-height:1.6\">"
    )
    parts.append(
        f"<div style=\"font-size:12px;font-weight:800;color:#0F766E;letter-spacing:0.05em;"
        "margin-bottom:10px\">🦋  MORNING BRIEFING</div>"
    )
    parts.append(f"<div style=\"font-size:18px;font-weight:600\">{_escape(opener)}</div>")
    if cont:
        parts.append(
            f"<p style=\"font-style:italic;color:#334155;margin:12px 0 0\">{_escape(cont)}</p>"
        )
    if noticed:
        parts.append(
            "<div style=\"margin-top:16px;padding:12px 14px;background:#FEFCE8;"
            "border:1px solid #FEF08A;border-radius:12px;color:#713F12\">"
            f"{_escape(noticed)}</div>"
        )
    for s in sections:
        heading = s.get("heading")
        bullets = s.get("bullets") or []
        if not heading or not bullets:
            continue
        parts.append(
            f"<div style=\"margin-top:18px;font-size:13px;font-weight:800;"
            f"color:#0F172A;letter-spacing:0.02em\">{_escape(heading)}</div>"
        )
        parts.append("<ul style=\"margin:6px 0 0 20px;padding:0\">")
        for b in bullets:
            parts.append(f"<li style=\"margin-bottom:4px\">{_escape(b)}</li>")
        parts.append("</ul>")
    for m in moments:
        parts.append(
            "<div style=\"margin-top:14px;padding:12px 14px;background:#FEFCE8;"
            "border:1px solid #FEF08A;border-radius:12px;color:#713F12\">✨ "
            f"{_escape(m)}</div>"
        )
    if rec:
        heading = _escape(content.get("recommendation_heading") or "Where I'd start")
        parts.append(
            "<div style=\"margin-top:20px;font-size:13px;font-weight:800;"
            f"color:#0F172A\">{heading}</div>"
            "<div style=\"margin-top:6px;padding:10px 14px;background:#F0FDFA;"
            "border:1px solid #CCFBF1;border-radius:12px\">"
            f"{_escape(rec)}</div>"
        )
    parts.append(
        "<div style=\"margin-top:24px;color:#94A3B8;font-size:12px\">— George</div>"
    )
    parts.append("</div>")
    return "".join(parts)


def _render_email_text(content: dict) -> str:
    """Fallback plaintext for the email — same content, no styling."""
    lines: list[str] = []
    lines.append(content.get("opener_line") or "")
    if content.get("continuity_line"):
        lines.append("")
        lines.append(content["continuity_line"])
    if content.get("noticed_line"):
        lines.append("")
        lines.append(content["noticed_line"])
    for s in content.get("sections") or []:
        heading = s.get("heading") or ""
        bullets = s.get("bullets") or []
        if not heading or not bullets:
            continue
        lines.append("")
        lines.append(heading)
        for b in bullets:
            lines.append(f"  • {b}")
    for m in content.get("celebrated_moments") or []:
        if not m:
            continue
        lines.append("")
        lines.append(m)
    if content.get("recommendation"):
        lines.append("")
        lines.append(content.get("recommendation_heading") or "Where I'd start")
        lines.append(f"  • {content['recommendation']}")
    lines.append("")
    lines.append("— George")
    return "\n".join(lines)


def _escape(s: str) -> str:
    return (
        (s or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


# ---------------------------------------------------------------------------
# Channel dispatch
# ---------------------------------------------------------------------------

async def _admin_row(db: Any, admin_id: str) -> Optional[dict]:
    return await db.cms_admins.find_one(
        {"id": admin_id},
        {"_id": 0, "email": 1, "display_name": 1, "id": 1},
    )


async def _mark_channel_delivered(
    db: Any, briefing_id: str, channel: str,
) -> None:
    await db[COLL_BRIEFINGS].update_one(
        {"id": briefing_id},
        {"$addToSet": {"channels_delivered": channel}},
    )


async def _refresh_briefing(db: Any, briefing_id: str) -> Optional[dict]:
    return await db[COLL_BRIEFINGS].find_one({"id": briefing_id}, {"_id": 0})


def _midday_is_genuinely_important(briefing_row: dict, settings: dict) -> bool:
    """Garry's rule: Midday push only if genuinely important.

    Approvals-queue depth alone doesn't warrant a push. New P0/P1
    signals or a Milestone signal do. The admin can also flip the
    `midday_push_enabled` setting off entirely.
    """
    if not settings.get("midday_push_enabled", True):
        return False
    sources = briefing_row.get("grounded_sources") or {}
    if sources.get("new_p0"):
        return True
    if sources.get("new_p1"):
        return True
    if sources.get("new_milestones"):
        return True
    return False


async def deliver_briefing(
    db: Any,
    briefing_row: dict,
    settings: dict,
) -> dict:
    """Route a briefing to secondary channels.

    Bridge is already the primary channel (the row itself is the Bridge
    card). This function is idempotent — rerunning it never re-delivers
    a channel that's already in `channels_delivered`.

    Dedup rule: skip email/push if `bridge_seen_at` is set. That's
    Garry's "don't re-send what I already read" rule.

    Channel policy varies by rhythm type (Garry's matrix, 2026-07-19):
      - morning   : Bridge + email + push
      - midday    : Bridge + push (no routine emails, silent by default)
      - eod       : Bridge + optional email (no push unless urgent)
      - milestone : Bridge only (folded into next Rhythm)

    Returns a dict describing what happened per channel.
    """
    briefing_id = briefing_row.get("id")
    admin_id = briefing_row.get("admin_id")
    rhythm_type = briefing_row.get("rhythm_type", "morning")
    if not briefing_id or not admin_id:
        return {"skipped": "missing_ids"}

    # Per-rhythm channel policy — Garry's delivery matrix, 2026-07-19.
    if rhythm_type == "midday":
        allow_email, allow_push = False, True
    elif rhythm_type == "eod":
        allow_email, allow_push = True, False
    elif rhythm_type == "milestone":
        allow_email, allow_push = False, False
    else:  # morning + anything else
        allow_email, allow_push = True, True

    # Always work from the latest row so a race between Bridge-view and
    # the scheduler is resolved by the freshest bridge_seen_at.
    latest = await _refresh_briefing(db, briefing_id) or briefing_row
    channels_done = set(latest.get("channels_delivered") or [])
    bridge_seen = bool(latest.get("bridge_seen_at"))

    content = latest.get("content_json") or {}
    admin = await _admin_row(db, admin_id)

    outcome: dict[str, Any] = {
        "briefing_id": briefing_id,
        "already_seen_on_bridge": bridge_seen,
        "channels": {},
    }

    # -----------------------------------------------------------------
    # Email channel
    # -----------------------------------------------------------------
    channel = "email"
    if channel in channels_done:
        outcome["channels"][channel] = "already_delivered"
    elif not allow_email:
        outcome["channels"][channel] = "not_in_policy"
    elif not settings.get("email_channel_enabled"):
        outcome["channels"][channel] = "disabled"
    elif bridge_seen:
        outcome["channels"][channel] = "skipped_seen_on_bridge"
    elif not admin or not admin.get("email"):
        outcome["channels"][channel] = "skipped_no_admin_email"
    else:
        ok = False
        try:
            # Imported lazily so unit tests without email creds still
            # load this module.
            from email_service import send_email, is_configured

            if not is_configured():
                outcome["channels"][channel] = "skipped_email_not_configured"
            else:
                greeting_date = latest.get("date_key") or ""
                subject = f"🦋 Morning Briefing · {greeting_date}"
                html = _render_email_html(content, admin.get("display_name"))
                text = _render_email_text(content)
                ok = await send_email(
                    to=admin["email"],
                    subject=subject,
                    html=html,
                    text=text,
                )
                if ok:
                    await _mark_channel_delivered(db, briefing_id, channel)
                    outcome["channels"][channel] = "delivered"
                else:
                    outcome["channels"][channel] = "send_failed"
        except Exception as exc:
            log.exception("morning briefing email failed")
            outcome["channels"][channel] = f"error:{exc}"

    # -----------------------------------------------------------------
    # Push channel
    # -----------------------------------------------------------------
    # Push is best-effort: the admin_id may or may not map to a
    # mobile-app user_id. We look up by email (case-insensitive) so if
    # Garry has a mobile app account with the same email, we can push.
    # If no match, we log and skip cleanly — Bridge + email still cover
    # him.
    channel = "push"
    if channel in channels_done:
        outcome["channels"][channel] = "already_delivered"
    elif not allow_push:
        outcome["channels"][channel] = "not_in_policy"
    elif not settings.get("push_channel_enabled"):
        outcome["channels"][channel] = "disabled"
    elif rhythm_type == "midday" and not _midday_is_genuinely_important(briefing_row, settings):
        outcome["channels"][channel] = "skipped_not_genuinely_important"
    elif bridge_seen:
        outcome["channels"][channel] = "skipped_seen_on_bridge"
    else:
        try:
            # Locate the mobile user_id linked to this admin, if any.
            user_id = None
            if admin and admin.get("email"):
                user = await db.users.find_one(
                    {"email": {"$regex": f"^{admin['email']}$", "$options": "i"}},
                    {"_id": 0, "id": 1},
                )
                if user:
                    user_id = user.get("id")
            if not user_id:
                outcome["channels"][channel] = "skipped_no_linked_mobile_user"
            else:
                # Import lazily so this module stays importable even if
                # the push helper is unavailable in a test harness.
                from push import send_push  # type: ignore[import-untyped]
                rec = (content.get("recommendation") or "").strip()
                title = "Morning briefing ready"
                body = rec[:120] if rec else "George has your briefing on The Bridge."
                await send_push(
                    recipients=[user_id],
                    data={
                        "title": title,
                        "message": body,
                        "type": "mcgs_morning_briefing",
                        "action_url": "/admin/bridge",
                        "briefing_id": briefing_id,
                    },
                )
                await _mark_channel_delivered(db, briefing_id, channel)
                outcome["channels"][channel] = "delivered"
        except Exception as exc:
            log.exception("morning briefing push failed (non-blocking)")
            outcome["channels"][channel] = f"error:{exc}"

    outcome["delivered_at"] = _now_iso()
    return outcome
