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

logger = logging.getLogger("youbelong.email")


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


def _branded_footer_html() -> str:
    """The shared "FriendPlace" branded footer used at the bottom of
    every outgoing email.

    Now that the email body is all-navy, the horizontal FriendPlace
    banner (butterfly + wordmark + tagline + contact info, already on
    dark navy) blends seamlessly with the surrounding canvas — no more
    "dark email with a picture dropped in". This keeps the butterfly
    logo present as the brand icon (per Garry's Nov note) without
    forcing HTML to reinvent the artwork.

    Below the banner sits only a small disclaimer line so the footer
    stays uncluttered — the wordier "Finding your people, one
    friendship at a time." brand line lives inside the banner artwork
    itself, keeping "Because you belong too." as the primary spoken
    brand promise in the email body copy.
    """
    banner_url = "https://customer-assets.emergentagent.com/job_belong-together/artifacts/8fw8lp5v_image.png"
    return f"""\
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td align="center" style="padding:8px 0 4px 0;">
      <a href="https://www.friendplace.com.au" style="text-decoration:none;display:block;">
        <img
          src="{banner_url}"
          alt="FriendPlace — Because you belong too. hello@friendplace.com.au · www.friendplace.com.au"
          width="560"
          style="width:100%;max-width:560px;height:auto;display:block;border:0;outline:none;text-decoration:none;"
        />
      </a>
      <!-- Just enough disclaimer to explain the email. Small, muted,
           single-line so it never competes with the banner artwork. -->
      <div style="color:#94A3B8;font-size:11px;line-height:16px;margin-top:14px;padding:0 12px;">
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
        "Because you belong too. 🦋\n\n"
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
                  <span style="font-size:22px;">🦋</span>
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
                  Thank you for being part of the FriendPlace family. 🦋
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
        f"Thank you for being part of the FriendPlace family. 🦋"
        f"{_branded_footer_text()}"
    )
    return subject, html, text
