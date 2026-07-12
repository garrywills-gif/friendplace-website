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
    """The shared "FriendPlace" branded footer used at the bottom of every
    outgoing email. Renders as a self-contained dark navy panel — no
    external images so it works on every client (Gmail, Outlook, Apple
    Mail, Yahoo) even with images blocked.

    Structure mirrors the attached brand banner:
      - Two-tone FriendPlace wordmark (white "Friend" + sky-blue "Place")
      - "Because you belong too. 🦋"
      - Contact row: 📧 hello@friendplace.com.au  ·  🌐 www.friendplace.com.au
      - Cursive-italic tagline: "Finding your people, one friendship at a time. 🦋"
      - Small disclaimer line explaining why the user received the email
    """
    return f"""\
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;">
  <tr>
    <td align="center" style="background:{_INK_NAVY_DEEP};border-radius:16px;padding:28px 22px;">
      <!-- Wordmark -->
      <div style="font-size:28px;font-weight:900;letter-spacing:-0.5px;line-height:1;">
        <span style="color:#FFFFFF;">Friend</span><span style="color:{_INK_SKY};">Place</span>
      </div>
      <!-- Tagline under the wordmark -->
      <div style="color:#CBD5E1;font-size:14px;font-weight:600;margin-top:6px;">
        Because you belong too. 🦋
      </div>
      <!-- Divider -->
      <div style="height:1px;background:#1E3A6B;margin:20px 0;"></div>
      <!-- Contact row -->
      <div style="color:#CBD5E1;font-size:13px;line-height:22px;">
        📧 <a href="mailto:hello@friendplace.com.au" style="color:#93C5FD;text-decoration:none;">hello@friendplace.com.au</a>
        &nbsp;&middot;&nbsp;
        🌐 <a href="https://www.friendplace.com.au" style="color:#93C5FD;text-decoration:none;">www.friendplace.com.au</a>
      </div>
      <!-- Signature line -->
      <div style="color:#93C5FD;font-style:italic;font-size:13px;margin-top:14px;">
        Finding your people, one friendship at a time. 🦋
      </div>
      <!-- Divider -->
      <div style="height:1px;background:#1E3A6B;margin:20px 0 12px;"></div>
      <!-- Disclaimer -->
      <div style="color:#94A3B8;font-size:11px;line-height:16px;">
        You&rsquo;re receiving this email from FriendPlace because you have a FriendPlace account.
      </div>
    </td>
  </tr>
</table>
"""


def _branded_footer_text() -> str:
    """Plain-text counterpart to `_branded_footer_html`."""
    return (
        "\n\n"
        "— FriendPlace —\n"
        "Because you belong too. 🦋\n\n"
        "hello@friendplace.com.au  ·  www.friendplace.com.au\n\n"
        "Finding your people, one friendship at a time. 🦋\n\n"
        "You're receiving this email from FriendPlace because you have a "
        "FriendPlace account."
    )


def password_reset_template(*, first_name: str | None, code: str, ttl_minutes: int) -> tuple[str, str, str]:
    """Build the password-reset email content.

    Copy is deliberately warm and personal — matches the "Because you
    belong too" voice rather than the clinical tone of typical system
    emails. Includes:
      - Butterfly emoji subject line
      - Named greeting
      - Prominent, easy-to-copy code (large teal chip)
      - Explicit 15-minute expiry callout
      - Reassuring "safe to ignore" line for users who didn't request it
      - Community-thank-you closer
      - Shared branded footer
    """
    name = (first_name or "there").strip()
    subject = "🦋 Reset your FriendPlace password"
    html = f"""\
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:{_BG_SOFT};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:{_INK_NAVY};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:28px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:100%;max-width:520px;">
            <!-- Body card -->
            <tr>
              <td style="background:#FFFFFF;border-radius:16px;padding:36px 28px;border:1px solid #E2E8F0;">
                <!-- Wordmark header -->
                <div style="text-align:center;font-size:22px;font-weight:900;letter-spacing:-0.4px;line-height:1;margin-bottom:6px;">
                  <span style="color:{_INK_NAVY};">Friend</span><span style="color:{_INK_TEAL};">Place</span>
                  <span style="font-size:20px;">🦋</span>
                </div>
                <div style="text-align:center;color:{_INK_MUTED};font-size:12px;letter-spacing:2px;font-weight:700;margin-bottom:22px;">
                  RESET YOUR PASSWORD
                </div>

                <!-- Greeting + body -->
                <div style="font-size:16px;line-height:24px;color:{_INK_BODY};">
                  Hi {name},<br><br>
                  We received a request to reset your FriendPlace password.<br><br>
                  Use the secure code below to reset your password. For your security, this code will expire in <strong>{ttl_minutes} minutes</strong>.
                </div>

                <!-- Reset code chip -->
                <div style="text-align:center;margin:26px 0 6px 0;">
                  <div style="font-size:36px;font-weight:900;letter-spacing:10px;color:{_INK_TEAL};padding:16px 22px;border-radius:14px;background:#F0FDFA;display:inline-block;border:1px solid #99F6E4;">
                    {code}
                  </div>
                </div>

                <!-- Safety note -->
                <div style="font-size:14px;line-height:22px;color:{_INK_MUTED};margin-top:22px;">
                  If you didn&rsquo;t request a password reset, you can safely ignore this email. Your account will remain secure and no changes will be made.
                </div>

                <!-- Community close -->
                <div style="font-size:15px;line-height:22px;color:{_INK_BODY};margin-top:22px;">
                  Thank you for being part of the FriendPlace community.
                </div>
                <div style="font-size:14px;font-style:italic;color:{_INK_TEAL};margin-top:6px;">
                  Finding your people, one friendship at a time. 🦋
                </div>
              </td>
            </tr>
            <!-- Branded footer -->
            <tr>
              <td>
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
        f"Thank you for being part of the FriendPlace community.\n"
        f"Finding your people, one friendship at a time. 🦋"
        f"{_branded_footer_text()}"
    )
    return subject, html, text
