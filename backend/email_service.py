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


def _config() -> tuple[Optional[str], str, str]:
    """Return (api_key, from_email, from_name) at call-time.

    Re-read from env on every call so operators can toggle values via
    supervisorctl without a full backend rebuild.
    """
    api_key = os.getenv("RESEND_API_KEY") or None
    from_email = (os.getenv("RESEND_FROM_EMAIL") or "onboarding@resend.dev").strip()
    from_name = (os.getenv("RESEND_FROM_NAME") or "FriendPlace").strip()
    return api_key, from_email, from_name


def is_configured() -> bool:
    """Return True iff an outbound email would actually be attempted."""
    api_key, _, _ = _config()
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
    api_key, from_email, from_name = _config()
    if not api_key or resend is None:
        logger.warning(
            "email.send skipped: RESEND_API_KEY not set (to=%s subject=%r)",
            _redact_email(to), subject,
        )
        return False

    from_field = f"{from_name} <{from_email}>" if from_name else from_email

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
        if reply_to:
            params["reply_to"] = reply_to
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

def password_reset_template(*, first_name: str | None, code: str, ttl_minutes: int) -> tuple[str, str, str]:
    """Build the password-reset email content."""
    name = (first_name or "there").strip()
    subject = f"Your FriendPlace reset code: {code}"
    # Simple, brand-lite HTML — inline styles only so it renders in every
    # major mail client without CSS filtering. Emoji butterflies match
    # the app's signature moment.
    html = f"""\
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#0F172A;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:16px;padding:32px 28px;border:1px solid #E2E8F0;">
            <tr>
              <td align="center" style="padding-bottom:8px;">
                <div style="font-size:36px;">🦋</div>
              </td>
            </tr>
            <tr>
              <td align="center" style="font-size:22px;font-weight:800;color:#0F172A;letter-spacing:0.2px;padding-bottom:10px;">
                FriendPlace
              </td>
            </tr>
            <tr>
              <td style="font-size:16px;line-height:24px;color:#334155;padding-top:8px;">
                Hi {name},<br><br>
                We received a request to reset your FriendPlace password. Use the code below to complete the reset — it expires in {ttl_minutes} minutes.
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:22px 0 6px 0;">
                <div style="font-size:34px;font-weight:900;letter-spacing:8px;color:#0F766E;padding:14px 18px;border-radius:12px;background:#F0FDFA;display:inline-block;">
                  {code}
                </div>
              </td>
            </tr>
            <tr>
              <td style="font-size:14px;line-height:22px;color:#64748B;padding-top:14px;">
                If you didn't request this, you can safely ignore this email — your password won't change.
              </td>
            </tr>
            <tr>
              <td style="font-size:12px;color:#94A3B8;padding-top:22px;border-top:1px solid #F1F5F9;margin-top:22px;">
                &nbsp;<br>
                Sent by FriendPlace · Please don't reply to this email.
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
        f"We received a request to reset your FriendPlace password.\n"
        f"Your reset code is: {code}\n"
        f"It expires in {ttl_minutes} minutes.\n\n"
        f"If you didn't request this, you can safely ignore this email — "
        f"your password won't change.\n\n"
        f"— FriendPlace"
    )
    return subject, html, text
