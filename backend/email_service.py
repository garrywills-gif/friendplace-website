"""
Email service — thin wrapper around the Resend API.

Design goals:
    - **Graceful degradation**: if `RESEND_API_KEY` isn't set (e.g. in dev),
      `send_email(...)` returns `False` and logs a warning so the calling
      endpoint still succeeds. The password-reset flow still stores the
      code server-side, so an operator can look it up in Mongo if needed.
    - **Sandbox-friendly**: while the FriendPlace domain is being verified,
      we use Resend's `onboarding@resend.dev` sender. Note that this
      sender is only allowed to email the *Resend account owner's own
      address* — external recipients require domain verification. Once
      `RESEND_FROM_EMAIL` is set (to something like
      `noreply@friendplace.com.au`) we automatically start using it.
    - **Threadpool-safe**: Resend's Python SDK is synchronous. We call it
      inside `asyncio.to_thread(...)` so the FastAPI event loop never
      blocks on the outbound HTTPS request.

Environment variables (all optional; endpoint keeps working without them):
    RESEND_API_KEY         — obtained from https://resend.com/api-keys
    RESEND_FROM_EMAIL      — sender address (default: onboarding@resend.dev)
    RESEND_FROM_NAME       — display name (default: FriendPlace)
    RESEND_REPLY_TO        — where replies should go (e.g. hello@friendplace.com.au).
                             Applied automatically to every outbound email.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Optional

try:
    import resend  # type: ignore[import-untyped]
except ImportError:  # pragma: no cover — resend is in requirements.txt
    resend = None  # type: ignore[assignment]

logger = logging.getLogger("friendplace.email")


def _config() -> tuple[Optional[str], str, str, Optional[str]]:
    """Return (api_key, from_email, from_name, reply_to) at call-time.

    Re-read from env on every call so operators can toggle values via
    supervisorctl without a full backend rebuild.
    """
    api_key = os.getenv("RESEND_API_KEY") or None
    from_email = (os.getenv("RESEND_FROM_EMAIL") or "onboarding@resend.dev").strip()
    from_name = (os.getenv("RESEND_FROM_NAME") or "FriendPlace").strip()
    reply_to = (os.getenv("RESEND_REPLY_TO") or "").strip() or None
    return api_key, from_email, from_name, reply_to


def is_configured() -> bool:
    """Return True iff an outbound email would actually be attempted."""
    api_key, _, _, _ = _config()
    return bool(api_key) and resend is not None


async def send_email(
    *,
    to: str,
    subject: str,
    html: str,
    text: Optional[str] = None,
    reply_to: Optional[str] = None,
    attachments: Optional[list] = None,
) -> bool:
    """Send a transactional email via Resend.

    Returns:
        True   — Resend accepted the message (HTTP 200).
        False  — Not configured, resend SDK missing, or the API rejected
                 the request. Always logs the cause; never raises.

    Notes:
        - `to` is a single recipient. If you need bulk-send, extend to
          accept a list.
        - `html` is the primary body. `text` is optional; Resend will
          auto-generate a plaintext version if omitted.
        - `attachments` accepts Resend's shape: a list of dicts with
          `filename` + either `content` (base64 str) or `path` (URL).
          Used e.g. for ICS calendar attachments on event RSVPs.
    """
    api_key, from_email, from_name, env_reply_to = _config()
    if not api_key or resend is None:
        logger.warning(
            "email.send skipped: RESEND_API_KEY not set (to=%s subject=%r)",
            _redact_email(to), subject,
        )
        return False

    from_field = f"{from_name} <{from_email}>" if from_name else from_email
    # Per-call `reply_to` wins over the env default so specific flows
    # (e.g. a support ticket reply) can still override for that message.
    effective_reply_to = reply_to or env_reply_to

    def _send_sync() -> dict:
        # Set the api_key on every call so a rotated key takes effect
        # without needing a restart.
        resend.api_key = api_key
        params: dict = {
            "from": from_field,
            "to": [to],
            "subject": subject,
            "html": html,
        }
        if text:
            params["text"] = text
        if effective_reply_to:
            params["reply_to"] = effective_reply_to
        if attachments:
            params["attachments"] = attachments
        return resend.Emails.send(params)  # type: ignore[no-any-return]

    try:
        result = await asyncio.to_thread(_send_sync)
        msg_id = (result or {}).get("id") if isinstance(result, dict) else None
        logger.info(
            "email.send ok: to=%s subject=%r id=%s",
            _redact_email(to), subject, msg_id,
        )
        return True
    except Exception as e:
        # Resend raises `resend.exceptions.ResendError` (a subclass of
        # `Exception`) for API-side failures — invalid key, unverified
        # sender, rate limit, etc. Log the specific message so operators
        # can act on it, but never leak the error text to the caller.
        logger.warning(
            "email.send failed: to=%s subject=%r err=%s",
            _redact_email(to), subject, e,
        )
        return False


def _redact_email(addr: str) -> str:
    """Return an obfuscated form suitable for logging (`j***@example.com`)."""
    if not addr or "@" not in addr:
        return "<invalid>"
    local, _, domain = addr.partition("@")
    if len(local) <= 1:
        return f"*@{domain}"
    return f"{local[0]}***@{domain}"


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------
# Each template returns (subject, html_body, plaintext_body). Keep them
# in one place so branding tweaks are trivial and consistent.

# Brand palette used across every FriendPlace email. Mirrors the app.
_INK_NAVY = "#17326B"        # primary brand text
_INK_NAVY_DEEP = "#0B1F45"   # deep footer bg
_INK_TEAL = "#0F766E"        # accent (code chip, links)
_INK_SKY = "#38BDF8"         # PLACE-half of the wordmark
_INK_MINT = "#5EEAD4"        # tagline colour on dark bg
_INK_BODY = "#334155"        # slate-700 body copy
_INK_MUTED = "#64748B"       # slate-500 subtle copy
_BG_SOFT = "#F8FAFC"         # slate-50 background


def _load_butterfly_icon_b64() -> str:
    """Load the pre-computed base64 butterfly icon at import time.

    Kept in a sidecar file (`_butterfly_icon_b64.txt`) rather than
    inlined here so this module stays readable. The icon is a small
    (240×240, ~21KB) PNG of the FriendPlace butterfly on the exact
    same navy `#0B1F45` background as the email — no lighter card
    edges, no white canvas.

    Falls back to an empty string if the sidecar is missing so the
    footer degrades to text-only rather than crashing the send.
    """
    import os
    path = os.path.join(os.path.dirname(__file__), "_butterfly_icon_b64.txt")
    try:
        with open(path, "r") as fh:
            return fh.read().strip()
    except Exception:
        return ""


_BUTTERFLY_ICON_B64 = _load_butterfly_icon_b64()


def _branded_footer_html() -> str:
    """The shared "FriendPlace" branded footer.

    Rendered as **pure HTML/CSS with a single inline data-URI butterfly**
    icon at the top. There is no externally-hosted image and no lighter
    "card" region — every pixel is either the butterfly artwork itself
    (on the same navy the email uses) or the surrounding navy `#0B1F45`.

    Why data-URI instead of a hosted `<img src="https://…">`:
      - No CDN, no domain-verification lag, no third-party fetch.
      - The banner PNG we previously used had a slightly lighter
        internal "card" boundary — visible as a white/lighter box
        against the darker email surround. Embedding a tightly-cropped
        butterfly on the exact same navy eliminates that seam.
      - 21KB is well within every mail client's data-URI limits
        (Apple Mail, iOS Mail, Yahoo, Outlook.com all support this;
        Gmail supports up to ~50KB inline).

    Below the icon sits a pure HTML wordmark, primary tagline, contact
    row, and a small disclaimer — everything on the same navy so the
    footer flows as one continuous piece of the email.
    """
    icon_html = (
        f'<img src="data:image/png;base64,{_BUTTERFLY_ICON_B64}" '
        f'alt="FriendPlace" width="83" height="83" '
        f'style="display:block;margin:0 auto;border:0;outline:none;background:{_INK_NAVY_DEEP};" />'
        if _BUTTERFLY_ICON_B64 else ""
    )
    return f"""\
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{_INK_NAVY_DEEP};">
  <tr>
    <td align="center" style="background:{_INK_NAVY_DEEP};padding:12px 12px 4px 12px;">
      {icon_html}
      <!-- Wordmark, sits directly under the butterfly icon -->
      <div style="font-size:26px;font-weight:900;letter-spacing:-0.5px;line-height:1;margin-top:14px;">
        <span style="color:#FFFFFF;">Friend</span><span style="color:{_INK_SKY};">Place</span>
      </div>
      <!-- Primary brand tagline -->
      <div style="color:#CBD5E1;font-size:14px;font-weight:600;margin-top:8px;">
        Because you belong too.
      </div>
      <!-- Divider -->
      <div style="height:1px;background:#1E3A6B;margin:22px auto;max-width:280px;"></div>
      <!-- Contact links -->
      <div style="color:#93C5FD;font-size:13px;line-height:22px;">
        <a href="mailto:hello@friendplace.com.au" style="color:#DBEAFE;text-decoration:none;">hello@friendplace.com.au</a>
        &nbsp;·&nbsp;
        <a href="https://www.friendplace.com.au" style="color:#DBEAFE;text-decoration:none;">www.friendplace.com.au</a>
      </div>
      <!-- Divider -->
      <div style="height:1px;background:#1E3A6B;margin:22px auto 14px;max-width:280px;"></div>
      <!-- Disclaimer -->
      <div style="color:#94A3B8;font-size:11px;line-height:16px;padding:0 12px 12px 12px;">
        You&rsquo;re receiving this email from FriendPlace because you have a FriendPlace account.
      </div>
    </td>
  </tr>
</table>
"""


def _branded_footer_text() -> str:
    """Plain-text counterpart to `_branded_footer_html`.

    Kept minimal — "Finding your people…" is used sparingly per brand
    guidance, so only the primary "Because you belong too." tagline
    appears here.
    """
    return (
        "\n\n"
        "— FriendPlace —\n"
        "Because you belong too.\n\n"
        "hello@friendplace.com.au  ·  www.friendplace.com.au\n\n"
        "You're receiving this email from FriendPlace because you have a "
        "FriendPlace account."
    )


def password_reset_template(*, first_name: str | None, code: str, ttl_minutes: int) -> tuple[str, str, str]:
    """Build the password-reset email content — full-bleed dark navy
    theme, one continuous canvas from top to bottom (no white body, no
    "picture dropped in").
    """
    name = (first_name or "there").strip()
    subject = "🦋 Reset your FriendPlace password"
    html = f"""\
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:{_INK_NAVY_DEEP};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#F1F5F9;">
    <!-- Outer navy canvas — no white anywhere. -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{_INK_NAVY_DEEP};padding:28px 12px;">
      <tr>
        <td align="center">
          <!-- Content column — 560px wide, almost full-bleed on mobile
               with just a little side padding on the outer canvas. -->
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;">
            <!-- Header: wordmark + subline. Blends into the body. -->
            <tr>
              <td align="center" style="padding:8px 22px 6px 22px;">
                <div style="font-size:24px;font-weight:900;letter-spacing:-0.4px;line-height:1;">
                  <span style="color:#FFFFFF;">Friend</span><span style="color:{_INK_SKY};">Place</span>
                </div>
                <div style="color:#93C5FD;font-size:12px;letter-spacing:2.4px;font-weight:700;margin-top:10px;">
                  RESET YOUR PASSWORD
                </div>
              </td>
            </tr>

            <!-- Greeting + body copy on the same navy — no card, no border. -->
            <tr>
              <td style="padding:24px 22px 6px 22px;">
                <div style="font-size:17px;line-height:26px;color:#E2E8F0;">
                  Hi {name},<br><br>
                  We received a request to reset your FriendPlace password.<br><br>
                  Use the secure code below to reset your password. For your security, this code will expire in <strong style="color:#FFFFFF;">{ttl_minutes} minutes</strong>.
                </div>
              </td>
            </tr>

            <!-- Reset code — bumped ~12% larger (font 40→46, letter-
                 spacing 12→14, padding 20/26 → 24/32) so it's even
                 easier to spot at a glance. Glowing teal on navy,
                 still reads as an inline highlight rather than a
                 separate card. -->
            <tr>
              <td align="center" style="padding:22px 22px 4px 22px;">
                <div style="font-size:46px;font-weight:900;letter-spacing:14px;color:#5EEAD4;padding:24px 32px;border-radius:18px;background:rgba(20,184,166,0.12);display:inline-block;border:1px solid rgba(94,234,212,0.35);">
                  {code}
                </div>
              </td>
            </tr>

            <!-- Safety note -->
            <tr>
              <td style="padding:24px 22px 4px 22px;">
                <div style="font-size:14px;line-height:22px;color:#94A3B8;">
                  If you didn&rsquo;t request a password reset, you can safely ignore this email. Your account will remain secure and no changes will be made.
                </div>
              </td>
            </tr>

            <!-- Community-close — "family" reads warmer than the
                 previous "community" wording. The "Finding your
                 people…" line is deliberately removed here so
                 "Because you belong too." (spoken elsewhere in the
                 brand voice) stays the primary tagline in body copy. -->
            <tr>
              <td style="padding:24px 22px 4px 22px;">
                <div style="font-size:15px;line-height:22px;color:#E2E8F0;">
                  Thank you for being part of the FriendPlace community.
                </div>
              </td>
            </tr>

            <!-- Spacer before the footer -->
            <tr><td style="height:20px;line-height:20px;">&nbsp;</td></tr>

            <!-- Branded footer — same navy, seamless -->
            <tr>
              <td style="padding:0 12px;">
                {_branded_footer_html()}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""
    text = (
        f"Hi {name},\n\n"
        f"We received a request to reset your FriendPlace password.\n\n"
        f"Use the secure code below to reset your password. For your security, "
        f"this code will expire in {ttl_minutes} minutes.\n\n"
        f"    {code}\n\n"
        f"If you didn't request a password reset, you can safely ignore this "
        f"email. Your account will remain secure and no changes will be made.\n\n"
        f"Thank you for being part of the FriendPlace community."
        f"{_branded_footer_text()}"
    )
    return subject, html, text



def support_acknowledgement_template(
    *,
    first_name: str | None,
    ticket_ref: str,
    category: str,
    subject_snippet: str,
) -> tuple[str, str, str]:
    """Build the branded "we received your message" email sent to the
    user who submitted a Contact Support or Report a Problem request.

    Uses the same full-bleed navy canvas as the password-reset email so
    the two feel like siblings. Includes:
      - a short human ticket ref (e.g. FP-13EF62) they can quote in
        follow-ups,
      - the category + one-line subject echo so they can visually
        confirm we received the right thing,
      - a soft nudge to the FAQ / George in case an answer is already
        available.

    Args:
        first_name:      recipient's first name, if we know it.
        ticket_ref:      display ID to quote (e.g. "FP-13EF62").
        category:        category the user picked (e.g. "Report a Problem").
        subject_snippet: user-supplied subject; will be truncated for
                         email safety.
    """
    from html import escape as _esc
    name = (first_name or "there").strip()
    snippet = (subject_snippet or "").strip()
    # Keep the echoed subject small — protects against runaway lines
    # in the email body while still being useful for reassurance.
    if len(snippet) > 120:
        snippet = snippet[:117] + "…"

    email_subject = "We’ve received your message 💜"
    safe_ref = _esc(ticket_ref)
    safe_category = _esc(category or "Support")
    safe_snippet = _esc(snippet) if snippet else ""

    # ── Variant copy so Report-a-Problem feels a touch more urgent
    # than a generic Contact-Support message. Also disambiguates the
    # subject line so mailbox providers (looking at you, Yahoo) don't
    # thread/collapse two acknowledgements sent within seconds of
    # each other. The ticket ref is appended for the same reason —
    # every acknowledgement now has a globally unique subject.
    _cat_lower = (category or "").lower()
    if "report" in _cat_lower or "bug" in _cat_lower or "technical" in _cat_lower:
        email_subject = f"We’ve received your report 💜  ·  {ticket_ref}"
        opening_line = (
            "Thanks for taking the time to report this to the FriendPlace "
            "Support Team."
        )
        promise_line = (
            "We&rsquo;ve logged your report and one of our team members will "
            "look into it and get back to you as soon as possible. We aim to "
            'respond within <strong style="color:#FFFFFF;">24 hours</strong> '
            "(often much sooner)."
        )
        promise_text = (
            "We've logged your report and one of our team members will look "
            "into it and get back to you as soon as possible. We aim to "
            "respond within 24 hours (often much sooner)."
        )
    else:
        email_subject = f"We’ve received your message 💜  ·  {ticket_ref}"
        opening_line = "Thanks for contacting the FriendPlace Support Team."
        promise_line = (
            "We&rsquo;ve received your message and one of our team members "
            "will get back to you as soon as possible. We aim to respond "
            'within <strong style="color:#FFFFFF;">24 hours</strong> '
            "(often much sooner)."
        )
        promise_text = (
            "We've received your message and one of our team members will "
            "get back to you as soon as possible. We aim to respond within "
            "24 hours (often much sooner)."
        )

    subject_echo_html = (
        f'<div style="color:#94A3B8;font-size:13px;line-height:20px;margin-top:6px;">'
        f'"{safe_snippet}"</div>'
        if safe_snippet else ""
    )

    html = f"""\
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:{_INK_NAVY_DEEP};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#F1F5F9;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{_INK_NAVY_DEEP};padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;">
            <!-- Header -->
            <tr>
              <td align="center" style="padding:8px 22px 6px 22px;">
                <div style="font-size:24px;font-weight:900;letter-spacing:-0.4px;line-height:1;">
                  <span style="color:#FFFFFF;">Friend</span><span style="color:{_INK_SKY};">Place</span>
                </div>
                <div style="color:#93C5FD;font-size:12px;letter-spacing:2.4px;font-weight:700;margin-top:10px;">
                  SUPPORT · MESSAGE RECEIVED
                </div>
              </td>
            </tr>

            <!-- Greeting -->
            <tr>
              <td style="padding:24px 22px 6px 22px;">
                <div style="font-size:17px;line-height:26px;color:#E2E8F0;">
                  Hi {_esc(name)},<br><br>
                  {opening_line}<br><br>
                  {promise_line}
                </div>
              </td>
            </tr>

            <!-- Ticket reference chip + subject echo -->
            <tr>
              <td align="center" style="padding:22px 22px 4px 22px;">
                <div style="display:inline-block;padding:14px 22px;border-radius:14px;background:rgba(20,184,166,0.12);border:1px solid rgba(94,234,212,0.35);">
                  <div style="color:#93C5FD;font-size:11px;letter-spacing:1.8px;font-weight:700;">YOUR SUPPORT TICKET</div>
                  <div style="color:#5EEAD4;font-size:26px;font-weight:900;letter-spacing:3px;line-height:1;margin-top:6px;">
                    {safe_ref}
                  </div>
                  <div style="color:#CBD5E1;font-size:12px;margin-top:8px;">
                    {safe_category}
                  </div>
                  {subject_echo_html}
                </div>
              </td>
            </tr>

            <!-- Meanwhile nudge -->
            <tr>
              <td style="padding:24px 22px 4px 22px;">
                <div style="font-size:14px;line-height:22px;color:#94A3B8;">
                  In the meantime, you might find an answer in our
                  <a href="https://www.friendplace.com.au/faq" style="color:#93C5FD;text-decoration:none;font-weight:600;">FAQs</a>,
                  or <strong style="color:#E2E8F0;">George</strong> may be able to help with general questions.
                </div>
              </td>
            </tr>

            <!-- Reply-to-add note -->
            <tr>
              <td style="padding:18px 22px 4px 22px;">
                <div style="font-size:14px;line-height:22px;color:#CBD5E1;padding:14px 16px;border-radius:12px;background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.25);">
                  If your issue is urgent or you have any extra information to add, simply reply to this email and it&rsquo;ll be added to your support ticket.
                </div>
              </td>
            </tr>

            <!-- Community close -->
            <tr>
              <td style="padding:24px 22px 4px 22px;">
                <div style="font-size:15px;line-height:22px;color:#E2E8F0;">
                  Thank you for being part of the FriendPlace community.<br><br>
                  💜 The FriendPlace Support Team
                </div>
              </td>
            </tr>

            <!-- Spacer before the footer -->
            <tr><td style="height:20px;line-height:20px;">&nbsp;</td></tr>

            <!-- Branded footer -->
            <tr>
              <td style="padding:0 12px;">
                {_branded_footer_html()}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""

    text = (
        f"Hi {name},\n\n"
        f"{opening_line}\n\n"
        f"{promise_text}\n\n"
        f"    Your support ticket: {ticket_ref}\n"
        f"    Category: {category}\n"
        + (f'    Subject: "{snippet}"\n' if snippet else "")
        + "\n"
        f"In the meantime, you might find an answer in our FAQs "
        f"(https://www.friendplace.com.au/faq), or George may be able to "
        f"help with general questions.\n\n"
        f"If your issue is urgent or you have any extra information to add, "
        f"simply reply to this email and it'll be added to your support "
        f"ticket.\n\n"
        f"Thank you for being part of the FriendPlace community.\n\n"
        f"💜 The FriendPlace Support Team"
        f"{_branded_footer_text()}"
    )
    return email_subject, html, text


def event_rsvp_confirmation_template(
    *,
    first_name: str | None,
    event_title: str,
    event_when_display: str,
    event_where_display: str,
    event_cost_display: str | None,
    event_url: str,
    manage_url: str,
    rsvp_status: str,          # "going" | "waitlist"
    guests_count: int,
    ticket_ref: str,           # short display id for the RSVP
) -> tuple[str, str, str]:
    """Confirmation email for a public RSVP.

    Two flavours based on `rsvp_status`:
      - "going":   "You're in! 🎉 ..." with green pill
      - "waitlist":"You're on the waitlist 💜 ..." with amber pill

    Args:
        event_when_display:  Pre-formatted string like
                             "Sun 30/07/2026, 10:00 am AEST".
        event_where_display: One-line human string like
                             "Merewether Beach · 1 Henderson Pde".
        manage_url:          Public URL where the user can view or
                             cancel their RSVP (magic-link token
                             embedded).
        ticket_ref:          Short human ref (e.g. "FP-EV-12AB") so
                             users can quote it if they contact us.
    """
    from html import escape as _esc
    name = (first_name or "there").strip()

    status_norm = (rsvp_status or "going").lower()
    if status_norm == "waitlist":
        email_subject = f"You’re on the waitlist for {event_title} 💜  ·  {ticket_ref}"
        chip_bg = "rgba(251, 191, 36, 0.15)"
        chip_border = "rgba(253, 224, 71, 0.45)"
        chip_color = "#FCD34D"
        chip_label = "YOU’RE ON THE WAITLIST"
        opening_html = (
            f"Hi {_esc(name)},<br><br>"
            "Thanks for your RSVP — this event is fully booked, so you&rsquo;re now on "
            "the <strong style=\"color:#FFFFFF;\">waitlist</strong>. If a spot opens up, "
            "we&rsquo;ll bump you across and email you straight away."
        )
        opening_text = (
            f"Hi {name},\n\n"
            "Thanks for your RSVP — this event is fully booked, so you're now on the "
            "waitlist. If a spot opens up, we'll bump you across and email you "
            "straight away."
        )
    else:
        email_subject = f"You’re in for {event_title} 🎉  ·  {ticket_ref}"
        chip_bg = "rgba(20, 184, 166, 0.12)"
        chip_border = "rgba(94, 234, 212, 0.35)"
        chip_color = "#5EEAD4"
        chip_label = "YOU’RE GOING"
        opening_html = (
            f"Hi {_esc(name)},<br><br>"
            "You&rsquo;re all set — we&rsquo;ve saved your spot. Can&rsquo;t wait to see you there!"
        )
        opening_text = (
            f"Hi {name},\n\n"
            "You're all set — we've saved your spot. Can't wait to see you there!"
        )

    guest_line_html = (
        f'<div style="color:#94A3B8;font-size:12px;margin-top:6px;">Plus {guests_count} '
        f'guest{"s" if guests_count != 1 else ""}</div>'
        if guests_count and guests_count > 0 else ""
    )

    ics_note_html = (
        "We&rsquo;ve attached an <strong style=\"color:#E2E8F0;\">.ics</strong> calendar "
        "invite so you can add it to Apple, Google or Outlook in one tap."
    )
    ics_note_text = (
        "We've attached an .ics calendar invite so you can add it to Apple, Google or "
        "Outlook in one tap."
    )

    html = f"""\
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:{_INK_NAVY_DEEP};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#F1F5F9;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{_INK_NAVY_DEEP};padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;">
            <!-- Header -->
            <tr>
              <td align="center" style="padding:8px 22px 6px 22px;">
                <div style="font-size:24px;font-weight:900;letter-spacing:-0.4px;line-height:1;">
                  <span style="color:#FFFFFF;">Friend</span><span style="color:{_INK_SKY};">Place</span>
                </div>
                <div style="color:#93C5FD;font-size:12px;letter-spacing:2.4px;font-weight:700;margin-top:10px;">
                  EVENTS · RSVP CONFIRMED
                </div>
              </td>
            </tr>

            <!-- Opening -->
            <tr>
              <td style="padding:24px 22px 6px 22px;">
                <div style="font-size:17px;line-height:26px;color:#E2E8F0;">
                  {opening_html}
                </div>
              </td>
            </tr>

            <!-- Status chip -->
            <tr>
              <td align="center" style="padding:22px 22px 4px 22px;">
                <div style="display:inline-block;padding:14px 22px;border-radius:14px;background:{chip_bg};border:1px solid {chip_border};">
                  <div style="color:#93C5FD;font-size:11px;letter-spacing:1.8px;font-weight:700;">{chip_label}</div>
                  <div style="color:{chip_color};font-size:20px;font-weight:900;letter-spacing:0.5px;line-height:1;margin-top:8px;">
                    {_esc(event_title)}
                  </div>
                  {guest_line_html}
                </div>
              </td>
            </tr>

            <!-- Details block -->
            <tr>
              <td style="padding:22px 22px 4px 22px;">
                <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(148,163,184,0.18);border-radius:14px;padding:16px 18px;font-size:14px;line-height:22px;color:#E2E8F0;">
                  <div style="color:#93C5FD;font-size:11px;letter-spacing:1.4px;font-weight:700;margin-bottom:8px;">WHEN</div>
                  <div>{_esc(event_when_display)}</div>
                  <div style="height:1px;background:rgba(148,163,184,0.2);margin:12px 0;"></div>
                  <div style="color:#93C5FD;font-size:11px;letter-spacing:1.4px;font-weight:700;margin-bottom:8px;">WHERE</div>
                  <div>{_esc(event_where_display)}</div>
                  {(
                    f'<div style="height:1px;background:rgba(148,163,184,0.2);margin:12px 0;"></div>'
                    f'<div style="color:#93C5FD;font-size:11px;letter-spacing:1.4px;font-weight:700;margin-bottom:8px;">COST</div>'
                    f'<div>{_esc(event_cost_display)}</div>'
                  ) if event_cost_display else ""}
                </div>
              </td>
            </tr>

            <!-- Buttons: event page + manage RSVP -->
            <tr>
              <td align="center" style="padding:20px 22px 4px 22px;">
                <a href="{_esc(event_url)}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#38BDF8;color:#0B1F45;font-weight:800;text-decoration:none;font-size:14px;margin:0 4px;">View event page</a>
                <a href="{_esc(manage_url)}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:rgba(255,255,255,0.06);color:#E2E8F0;font-weight:800;text-decoration:none;font-size:14px;border:1px solid rgba(148,163,184,0.35);margin:0 4px;">View / cancel RSVP</a>
              </td>
            </tr>

            <!-- ICS note -->
            <tr>
              <td style="padding:20px 22px 4px 22px;">
                <div style="font-size:14px;line-height:22px;color:#94A3B8;">
                  {ics_note_html}
                </div>
              </td>
            </tr>

            <!-- Ticket ref for their records -->
            <tr>
              <td style="padding:8px 22px 4px 22px;">
                <div style="font-size:12px;color:#64748B;">
                  Your booking reference: <strong style="color:#CBD5E1;letter-spacing:0.8px;">{_esc(ticket_ref)}</strong>
                </div>
              </td>
            </tr>

            <!-- Sign-off -->
            <tr>
              <td style="padding:24px 22px 4px 22px;">
                <div style="font-size:15px;line-height:22px;color:#E2E8F0;">
                  See you there.<br><br>
                  💜 The FriendPlace Events Team
                </div>
              </td>
            </tr>

            <!-- Spacer -->
            <tr><td style="height:20px;line-height:20px;">&nbsp;</td></tr>

            <!-- Branded footer -->
            <tr>
              <td style="padding:0 12px;">
                {_branded_footer_html()}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""

    text = (
        f"{opening_text}\n\n"
        f"    Event:     {event_title}\n"
        f"    When:      {event_when_display}\n"
        f"    Where:     {event_where_display}\n"
        + (f"    Cost:      {event_cost_display}\n" if event_cost_display else "")
        + (f"    Guests:    +{guests_count}\n" if guests_count and guests_count > 0 else "")
        + f"    Reference: {ticket_ref}\n\n"
        f"View the event page: {event_url}\n"
        f"View / cancel your RSVP: {manage_url}\n\n"
        f"{ics_note_text}\n\n"
        f"See you there.\n\n"
        f"💜 The FriendPlace Events Team"
        f"{_branded_footer_text()}"
    )
    return email_subject, html, text


def event_cancelled_template(
    *,
    first_name: str | None,
    event_title: str,
    event_when_display: str,
    reason: str | None,
    ticket_ref: str,
) -> tuple[str, str, str]:
    """Email sent to everyone with an active RSVP when the admin
    cancels an event. Kept intentionally plain and apologetic —
    this is bad news, not a marketing moment.

    Args:
        reason: Optional human explanation from the admin. Rendered
                verbatim (after escaping) so the tone stays theirs.
    """
    from html import escape as _esc
    name = (first_name or "there").strip()
    email_subject = f"Update: {event_title} has been cancelled  ·  {ticket_ref}"

    reason_html = (
        f'<div style="background:rgba(255,255,255,0.05);border-left:3px solid #94A3B8;'
        f'padding:12px 16px;color:#CBD5E1;font-size:14px;line-height:22px;margin-top:12px;'
        f'border-radius:6px;">{_esc(reason)}</div>'
        if (reason or "").strip() else ""
    )
    reason_text = (
        f"\n\nMessage from the organiser:\n  {reason.strip()}\n" if (reason or "").strip() else ""
    )

    html = f"""\
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:{_INK_NAVY_DEEP};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#F1F5F9;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{_INK_NAVY_DEEP};padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;">
            <tr>
              <td align="center" style="padding:8px 22px 6px 22px;">
                <div style="font-size:24px;font-weight:900;letter-spacing:-0.4px;line-height:1;">
                  <span style="color:#FFFFFF;">Friend</span><span style="color:{_INK_SKY};">Place</span>
                </div>
                <div style="color:#FCA5A5;font-size:12px;letter-spacing:2.4px;font-weight:700;margin-top:10px;">
                  EVENT CANCELLED
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:24px 22px 6px 22px;">
                <div style="font-size:17px;line-height:26px;color:#E2E8F0;">
                  Hi {_esc(name)},<br><br>
                  Sorry to be the bearer of not-great news — <strong style="color:#FFFFFF;">{_esc(event_title)}</strong> ({_esc(event_when_display)}) has been <strong style="color:#FFFFFF;">cancelled</strong>.<br><br>
                  Your RSVP has been released and your spot is no longer being held. Your calendar should update automatically if you accepted our invite.
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:0 22px 4px 22px;">
                {reason_html}
              </td>
            </tr>

            <tr>
              <td style="padding:20px 22px 4px 22px;">
                <div style="font-size:14px;line-height:22px;color:#94A3B8;">
                  Keep an eye on our
                  <a href="https://www.friendplace.com.au/events" style="color:#93C5FD;text-decoration:none;font-weight:600;">events page</a>
                  — there&rsquo;s always another one being planned.
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:8px 22px 4px 22px;">
                <div style="font-size:12px;color:#64748B;">
                  Reference: <strong style="color:#CBD5E1;letter-spacing:0.8px;">{_esc(ticket_ref)}</strong>
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:24px 22px 4px 22px;">
                <div style="font-size:15px;line-height:22px;color:#E2E8F0;">
                  Thank you for understanding.<br><br>
                  💜 The FriendPlace Events Team
                </div>
              </td>
            </tr>

            <tr><td style="height:20px;line-height:20px;">&nbsp;</td></tr>
            <tr>
              <td style="padding:0 12px;">
                {_branded_footer_html()}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""

    text = (
        f"Hi {name},\n\n"
        f"Sorry to be the bearer of not-great news — {event_title} ({event_when_display}) "
        f"has been cancelled.\n\n"
        f"Your RSVP has been released and your spot is no longer being held. Your "
        f"calendar should update automatically if you accepted our invite."
        f"{reason_text}\n\n"
        f"Keep an eye on our events page — there's always another one being planned.\n"
        f"    https://www.friendplace.com.au/events\n\n"
        f"Reference: {ticket_ref}\n\n"
        f"Thank you for understanding.\n\n"
        f"💜 The FriendPlace Events Team"
        f"{_branded_footer_text()}"
    )
    return email_subject, html, text


def business_welcome_template(
    *,
    first_name: str | None,
    business_name: str,
    trial_limit: int,
    trial_days: int,
    requested_plan: str | None,
) -> tuple[str, str, str]:
    """Auto-reply sent when a business self-registers via the mobile
    "Host a new event" flow. Warm, concise, and sets expectations:

      - Free trial locked in (N listings, N days)
      - We'll be in touch about pricing before it ends
      - Reply-to points at support@ so their reply becomes a ticket
    """
    from html import escape as _esc
    name = (first_name or "there").strip()
    safe_biz = _esc(business_name or "your organisation")
    email_subject = f"Welcome to FriendPlace, {safe_biz} 💜"

    plan_label = {
        "weekly": "Weekly plan (2 listings / week)",
        "monthly": "Monthly plan (5 listings / month)",
        "trial": "Free 1-month trial",
    }.get((requested_plan or "trial").lower(), "Free 1-month trial")

    html = f"""\
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:{_INK_NAVY_DEEP};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#F1F5F9;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{_INK_NAVY_DEEP};padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;">
            <tr>
              <td align="center" style="padding:8px 22px 6px 22px;">
                <div style="font-size:24px;font-weight:900;letter-spacing:-0.4px;line-height:1;">
                  <span style="color:#FFFFFF;">Friend</span><span style="color:{_INK_SKY};">Place</span>
                </div>
                <div style="color:#93C5FD;font-size:12px;letter-spacing:2.4px;font-weight:700;margin-top:10px;">
                  ORGANISATIONS · WELCOME
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:24px 22px 6px 22px;">
                <div style="font-size:17px;line-height:26px;color:#E2E8F0;">
                  Hi {_esc(name)},<br><br>
                  Thanks for registering <strong style="color:#FFFFFF;">{safe_biz}</strong> on FriendPlace. We&rsquo;re delighted to have you as part of the community.
                </div>
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:22px 22px 4px 22px;">
                <div style="display:inline-block;padding:14px 22px;border-radius:14px;background:rgba(20,184,166,0.12);border:1px solid rgba(94,234,212,0.35);">
                  <div style="color:#93C5FD;font-size:11px;letter-spacing:1.8px;font-weight:700;">YOUR TRIAL IS ACTIVE</div>
                  <div style="color:#5EEAD4;font-size:22px;font-weight:900;line-height:1;margin-top:8px;">
                    {trial_limit} listings · {trial_days} days
                  </div>
                  <div style="color:#CBD5E1;font-size:12px;margin-top:6px;">
                    Requested: {_esc(plan_label)}
                  </div>
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:24px 22px 4px 22px;">
                <div style="font-size:15px;line-height:24px;color:#E2E8F0;">
                  Post your events straight from the mobile app — they&rsquo;ll appear in the community feed with your organisation shown as the host.
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:18px 22px 4px 22px;">
                <div style="font-size:14px;line-height:22px;color:#CBD5E1;padding:14px 16px;border-radius:12px;background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.25);">
                  We&rsquo;re finalising our organisation plans and will email you the pricing before your trial ends, so there are no surprises.
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:24px 22px 4px 22px;">
                <div style="font-size:15px;line-height:22px;color:#E2E8F0;">
                  If you have any questions in the meantime, just reply to this email — it&rsquo;ll come straight through to us.<br><br>
                  💜 The FriendPlace Team
                </div>
              </td>
            </tr>

            <tr><td style="height:20px;line-height:20px;">&nbsp;</td></tr>
            <tr><td style="padding:0 12px;">{_branded_footer_html()}</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""

    text = (
        f"Hi {name},\n\n"
        f"Thanks for registering {business_name} on FriendPlace. We're delighted to have you as part of the community.\n\n"
        f"    Your trial is active: {trial_limit} listings · {trial_days} days\n"
        f"    Requested: {plan_label}\n\n"
        f"Post your events straight from the mobile app — they'll appear in the community feed with your organisation shown as the host.\n\n"
        f"We're finalising our organisation plans and will email you the pricing before your trial ends, so there are no surprises.\n\n"
        f"If you have any questions in the meantime, just reply to this email — it'll come straight through to us.\n\n"
        f"💜 The FriendPlace Team"
        f"{_branded_footer_text()}"
    )
    return email_subject, html, text

