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
from dataclasses import dataclass, asdict
from typing import Optional

try:
    import resend  # type: ignore[import-untyped]
except ImportError:  # pragma: no cover — resend is in requirements.txt
    resend = None  # type: ignore[assignment]

logger = logging.getLogger("friendplace.email")


@dataclass
class SendResult:
    """Rich outcome of a single Resend send attempt.

    The old boolean return type answered "did we not crash?" — which
    is *not* the same as "Resend actually accepted the message." This
    result distinguishes:

      • `ok`           — Resend accepted the payload AND returned a
                         message ID. Anything else is a fail.
      • `message_id`   — Resend's UUID for the accepted message. This
                         is what an operator quotes when checking the
                         Resend dashboard for delivery status.
      • `http_status`  — HTTP status Resend returned. `None` when the
                         SDK swallowed it; we infer it from
                         `ResendError.code` where possible.
      • `error`        — Human-readable error text on failure.
      • `error_code`   — Machine-readable code from Resend (e.g.
                         `validation_error`, `invalid_api_key`).
      • `provider`     — Always `resend` for now.

    Note on delivery semantics: even a successful send only means
    Resend *accepted* the message. Delivery status (Sent → Queued →
    Delivered → Bounced → Rejected) lives in the Resend dashboard.
    Our current backend API key is send-only so we cannot poll
    delivery events. Operators should quote `message_id` in the
    Resend dashboard to confirm final state.
    """
    ok: bool
    message_id: Optional[str] = None
    http_status: Optional[int] = None
    error: Optional[str] = None
    error_code: Optional[str] = None
    provider: str = "resend"

    def to_dict(self) -> dict:
        return asdict(self)


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


async def send_email_detailed(
    *,
    to: str,
    subject: str,
    html: str,
    text: Optional[str] = None,
    reply_to: Optional[str] = None,
    attachments: Optional[list] = None,
) -> SendResult:
    """Send a transactional email via Resend and return a rich result.

    Returns a `SendResult` describing exactly what happened:
      • On success  → ok=True, message_id set, http_status=200.
      • On rejection or SDK failure → ok=False, error + error_code set,
        http_status inferred where possible.

    This is the primary implementation. `send_email()` remains for
    callers that only want a boolean.
    """
    api_key, from_email, from_name, env_reply_to = _config()

    if resend is None:
        return SendResult(
            ok=False,
            error="Resend SDK not installed on backend",
            error_code="sdk_missing",
        )
    if not api_key:
        logger.warning(
            "email.send skipped: RESEND_API_KEY not set (to=%s subject=%r)",
            _redact_email(to), subject,
        )
        return SendResult(
            ok=False,
            error="RESEND_API_KEY not configured on backend",
            error_code="api_key_missing",
        )

    from_field = f"{from_name} <{from_email}>" if from_name else from_email
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
        raw = await asyncio.to_thread(_send_sync)
    except Exception as e:
        # Resend SDK raises `resend.exceptions.ResendError` subclasses
        # for API-side failures (invalid key, unverified sender,
        # validation, rate limit). They expose `.code` (HTTP status)
        # and `.message` (human-readable text). We surface both so
        # the CMS panel can show the operator the real reason.
        code = getattr(e, "code", None)
        message = getattr(e, "message", None) or str(e)
        error_code = getattr(e, "error_type", None) or e.__class__.__name__
        try:
            http_status = int(code) if code is not None else None
        except (TypeError, ValueError):
            http_status = None
        logger.warning(
            "email.send failed: to=%s subject=%r err=%s http=%s code=%s",
            _redact_email(to), subject, message, http_status, error_code,
        )
        return SendResult(
            ok=False,
            error=message,
            error_code=error_code,
            http_status=http_status,
        )

    # Resend returns a dict-like `SendResponse` with an `id` field on
    # success. Anything without an id is a fail even if the SDK
    # didn't raise (defensive — has happened historically when the
    # SDK swallowed error payloads).
    message_id = None
    if isinstance(raw, dict):
        message_id = raw.get("id")
    else:
        # SendResponse behaves like a dict but isn't one
        try:
            message_id = raw["id"]  # type: ignore[index]
        except Exception:
            try:
                message_id = getattr(raw, "id", None)
            except Exception:
                message_id = None

    if not message_id:
        logger.warning(
            "email.send returned no message id: to=%s subject=%r raw=%r",
            _redact_email(to), subject, raw,
        )
        return SendResult(
            ok=False,
            error="Resend accepted the request but returned no message id",
            error_code="no_message_id",
            http_status=None,
        )

    logger.info(
        "email.send ok: to=%s subject=%r id=%s",
        _redact_email(to), subject, message_id,
    )
    return SendResult(
        ok=True,
        message_id=message_id,
        http_status=200,
    )


# ---------------------------------------------------------------------------
# Read-side helpers  ·  live delivery status + verified-domain health
# ---------------------------------------------------------------------------
# These wrap Resend's GET endpoints so the CMS "Email templates" panel can
# show live status (Accepted → Queued → Sent → Delivered / Bounced /
# Rejected) and an overall "Sending health" indicator. They use plain
# `requests` rather than the SDK because the SDK's read surface is
# thinner than the REST API and skips over some diagnostic fields.
#
# All functions gracefully degrade: if the API key can't read (i.e. it's
# a send-only key) we return a shape that the UI can render as
# "unavailable" rather than crashing. That way an operator whose key
# was downgraded still sees the send status; only the polling reads go
# dark, with a clear message about why.


async def _resend_get(path: str) -> tuple[int, dict]:
    """Perform a GET against Resend's REST API and return (status, body).

    Uses `requests` in a worker thread so it doesn't block the event
    loop. Never raises — returns a well-formed error body on failure.
    """
    import json as _json
    api_key, _from_email, _from_name, _reply_to = _config()
    if not api_key:
        return (0, {"error": "RESEND_API_KEY not set"})

    def _do() -> tuple[int, dict]:
        try:
            import requests  # local import — SDK-agnostic path
            r = requests.get(
                f"https://api.resend.com{path}",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=15,
            )
            try:
                body = r.json()
            except Exception:
                body = {"raw": r.text[:500]}
            return (r.status_code, body)
        except Exception as e:
            return (0, {"error": str(e)})

    return await asyncio.to_thread(_do)


async def fetch_message_status(message_id: str) -> dict:
    """Return live delivery status for one Resend message.

    Response shape (stable across states):
        {
          "ok": bool,
          "message_id": str,
          "last_event": "sent"|"queued"|"delivered"|"bounced"|"rejected"|"complained"|"opened"|"clicked"|None,
          "status_label": str,          # "Delivered", "Bounced", ...
          "status_tone": "success"|"pending"|"error"|"unknown",
          "created_at": str|None,
          "to": [str],
          "from": str|None,
          "subject": str|None,
          "ses_message_id": str|None,
          "http_status": int,
          "error": str|None,            # only when unreachable
          "dashboard_url": str          # deep link into Resend dashboard
        }
    """
    dashboard_url = f"https://resend.com/emails/{message_id}"
    status, body = await _resend_get(f"/emails/{message_id}")
    if status != 200:
        return {
            "ok": False,
            "message_id": message_id,
            "last_event": None,
            "status_label": "Unavailable",
            "status_tone": "unknown",
            "http_status": status,
            "error": (body or {}).get("message") or (body or {}).get("error") or "Resend rejected the lookup.",
            "dashboard_url": dashboard_url,
        }
    last_event = (body.get("last_event") or "").lower() or None
    label_map = {
        "sent":              ("Sent",              "pending"),
        "queued":            ("Queued",            "pending"),
        "delivery_delayed":  ("Delivery delayed",  "pending"),
        "delivered":         ("Delivered",         "success"),
        "opened":            ("Delivered · opened","success"),
        "clicked":           ("Delivered · clicked","success"),
        "bounced":           ("Bounced",           "error"),
        "rejected":          ("Rejected",          "error"),
        "complained":        ("Complained (spam)", "error"),
    }
    label, tone = label_map.get(last_event or "", ("Accepted", "pending"))
    return {
        "ok": True,
        "message_id": message_id,
        "last_event": last_event,
        "status_label": label,
        "status_tone": tone,
        "created_at": body.get("created_at"),
        "to": body.get("to"),
        "from": body.get("from"),
        "subject": body.get("subject"),
        "ses_message_id": body.get("message_id"),
        "http_status": 200,
        "error": None,
        "dashboard_url": dashboard_url,
    }


async def fetch_domains_health() -> dict:
    """Return the sending-domain health picture Resend gives us.

    Response shape:
        {
          "ok": bool,
          "domains": [
            {
              "id":     str,
              "name":   str,
              "status": str,     # "verified" | "pending" | "failed"
              "region": str,
              "sending_enabled":  bool,
              "records":          [ … per-record DKIM/SPF/DMARC state … ],
              "dkim":  "verified"|"missing"|"pending"|"failed",
              "spf":   "verified"|"missing"|"pending"|"failed",
              "dmarc": "verified"|"missing"|"pending"|"failed",
              "dashboard_url": str,
            }, …
          ],
          "http_status": int,
          "error": str|None,
        }
    """
    status, body = await _resend_get("/domains")
    if status != 200:
        return {
            "ok": False,
            "domains": [],
            "http_status": status,
            "error": (body or {}).get("message") or (body or {}).get("error") or "Couldn't read Resend domains.",
        }
    rows = (body.get("data") or []) if isinstance(body, dict) else []
    domains_out: list[dict] = []
    for d in rows:
        domain_id = d.get("id")
        # Resend `GET /domains/{id}` returns per-record verification detail.
        record_status, record_body = await _resend_get(f"/domains/{domain_id}") if domain_id else (0, {})
        records = record_body.get("records") if isinstance(record_body, dict) else None
        # Reduce records to a per-mechanism verdict. Resend uses `type` in
        # {"MX","TXT","CNAME"} + `name` prefixes to distinguish DKIM
        # (`resend._domainkey` / `..._domainkey`), SPF (`v=spf1`), DMARC
        # (`_dmarc`). Any record with status != 'verified' → the mechanism
        # is not yet green.
        def _mech_status(records_list, mechanism: str) -> str:
            if not isinstance(records_list, list):
                return "unknown"
            related = []
            for r in records_list:
                name = (r.get("name") or "").lower()
                value = (r.get("value") or "").lower()
                if mechanism == "dkim" and "_domainkey" in name:
                    related.append(r)
                elif mechanism == "spf" and ("v=spf1" in value or (r.get("type") == "TXT" and "spf" in name)):
                    related.append(r)
                elif mechanism == "dmarc" and ("_dmarc" in name or "v=dmarc" in value):
                    related.append(r)
            if not related:
                return "missing"
            statuses = {(r.get("status") or "").lower() for r in related}
            if statuses == {"verified"} or statuses == {"success"}:
                return "verified"
            if "failed" in statuses or "not_started" in statuses:
                return "failed"
            if "pending" in statuses:
                return "pending"
            return "unknown"

        domains_out.append({
            "id":              domain_id,
            "name":            d.get("name"),
            "status":          d.get("status"),
            "region":          d.get("region"),
            "sending_enabled": (d.get("capabilities") or {}).get("sending") == "enabled",
            "records":         records,
            "dkim":            _mech_status(records, "dkim"),
            "spf":             _mech_status(records, "spf"),
            "dmarc":           _mech_status(records, "dmarc"),
            "dashboard_url":   f"https://resend.com/domains/{domain_id}" if domain_id else None,
        })
    return {
        "ok": True,
        "domains": domains_out,
        "http_status": 200,
        "error": None,
    }



async def send_email(
    *,
    to: str,
    subject: str,
    html: str,
    text: Optional[str] = None,
    reply_to: Optional[str] = None,
    attachments: Optional[list] = None,
) -> bool:
    """Thin bool wrapper around `send_email_detailed` for legacy callers.

    Returns True iff Resend accepted the message AND returned a
    message ID. Prefer `send_email_detailed` when you need to
    surface the message ID or error to a UI (e.g. the CMS panel).
    """
    result = await send_email_detailed(
        to=to,
        subject=subject,
        html=html,
        text=text,
        reply_to=reply_to,
        attachments=attachments,
    )
    return result.ok


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


def _load_brand_butterfly_b64() -> str:
    """Load the pre-computed base64 brand butterfly for letter emails.

    This is the *full-colour, transparent-background* butterfly at
    ~200×196 (~52 KB base64) — the master brand mark shared with the
    website header. Rendered at 96px in email so it looks crisp on
    both retina and standard displays without ballooning message size.
    """
    import os
    path = os.path.join(os.path.dirname(__file__), "_brand_butterfly_b64.txt")
    try:
        with open(path, "r") as fh:
            return fh.read().strip()
    except Exception:
        return ""


_BRAND_BUTTERFLY_B64 = _load_brand_butterfly_b64()


# ---------------------------------------------------------------------------
# LETTER-STYLE EMAIL SYSTEM  (v2 — clean white, personal letter aesthetic)
# ---------------------------------------------------------------------------
# Everything below is the unified template used by welcome, waitlist,
# support, invitation and password-reset emails. Design goals per the
# brand brief:
#   • Clean white background — no dark cards, no coloured borders.
#   • Full logo (butterfly + wordmark) centred at the top.
#   • Generous whitespace on every side; feels like a personal letter,
#     not a marketing email.
#   • Consistent typography (Georgia serif for body, sans-serif for the
#     wordmark + buttons) so every email is unmistakably FriendPlace.
#   • Mobile-friendly by using `<table>` layout with max-width 600 px
#     and side padding that shrinks proportionally on narrow screens.
#
# All five current templates share this shell so the layout, spacing
# and brand feel are identical — only the content changes.


def _brand_lockup_html() -> str:
    """Full-logo lockup (butterfly + FriendPlace wordmark), centred.

    iter164ak — unified full-navy design. The butterfly is embedded as
    a data-URI PNG so no third-party CDN is involved. Wordmark below
    it is HTML text so it stays crisp at any size. Both sit on the
    same FriendPlace navy as the surrounding shell — no light band
    around the logo.
    """
    img_src = (
        f"data:image/png;base64,{_BRAND_BUTTERFLY_B64}"
        if _BRAND_BUTTERFLY_B64 else ""
    )
    img_tag = (
        f'<img src="{img_src}" alt="FriendPlace" width="96" height="94" '
        f'style="display:block;margin:0 auto;border:0;outline:none;background:{_INK_NAVY_DEEP};" />'
        if img_src else ""
    )
    return f"""\
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{_INK_NAVY_DEEP};">
  <tr>
    <td align="center" style="background:{_INK_NAVY_DEEP};padding:56px 24px 8px 24px;">
      {img_tag}
      <div style="margin-top:18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:26px;font-weight:900;letter-spacing:-0.5px;line-height:1;">
        <span style="color:#FFFFFF;">Friend</span><span style="color:#14B8A6;">Place</span>
      </div>
      <div style="margin-top:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.78);">
        Because you belong too. 🦋
      </div>
    </td>
  </tr>
</table>
"""


def _letter_footer_html() -> str:
    """Minimal, quiet footer for letter-style emails on navy.

    iter164ak — unified navy design: keeps the quiet feel but flips
    the contrast so it stays legible on the navy shell background.
    Hairline uses a translucent white so it doesn't compete with
    body copy for attention.
    """
    return """\
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B1F45;">
  <tr>
    <td align="center" style="background:#0B1F45;padding:8px 24px 48px 24px;">
      <div style="height:1px;background:rgba(255,255,255,0.18);max-width:120px;margin:0 auto 24px auto;line-height:1px;font-size:1px;">&nbsp;</div>
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:13px;color:rgba(255,255,255,0.78);line-height:20px;">
        <a href="mailto:hello@friendplace.com.au" style="color:#5EEAD4;text-decoration:none;font-weight:600;">hello@friendplace.com.au</a>
        &nbsp;&middot;&nbsp;
        <a href="https://www.friendplace.com.au" style="color:#5EEAD4;text-decoration:none;font-weight:600;">friendplace.com.au</a>
      </div>
      <div style="font-family:Georgia,'Iowan Old Style','Palatino Linotype',Palatino,'Times New Roman',serif;font-size:13px;color:rgba(255,255,255,0.72);font-style:italic;line-height:20px;margin-top:14px;">
        Because you belong too. 🦋
      </div>
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:11px;color:rgba(255,255,255,0.55);line-height:16px;margin-top:22px;max-width:420px;">
        You&rsquo;re receiving this email because you have a FriendPlace account or expressed interest in joining our community.
      </div>
    </td>
  </tr>
</table>
"""


def _letter_body_open() -> str:
    """Open the letter-body table (serif body copy on navy).

    iter164ak — unified navy shell: switches body copy from
    dark-navy-on-white to white-on-navy so all branded emails read
    consistently across the family.
    """
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="background:#0B1F45;">'
        '<tr><td style="background:#0B1F45;padding:24px 48px 8px 48px;'
        'font-family:Georgia,\'Iowan Old Style\',\'Palatino Linotype\','
        '\'Book Antiqua\',Palatino,\'Times New Roman\',serif;'
        'font-size:17px;line-height:28px;color:#FFFFFF;">'
    )


def _letter_body_close() -> str:
    return '</td></tr></table>'


def _letter_button_html(*, label: str, url: str) -> str:
    """Primary CTA button — teal pill, white text, sans-serif for legibility."""
    from html import escape as _esc
    return f"""\
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:32px auto 8px auto;">
  <tr>
    <td align="center" style="border-radius:999px;background:#14B8A6;">
      <a href="{_esc(url)}" style="display:inline-block;padding:14px 34px;color:#FFFFFF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-weight:700;font-size:15px;text-decoration:none;letter-spacing:0.2px;border-radius:999px;">
        {_esc(label)}
      </a>
    </td>
  </tr>
</table>
"""


# iter164o duplicate-signoff guarantee. Compiled once, module-level, so
# it isn't rebuilt on every render call. The pattern is deliberately
# conservative: it only strips a closing that appears at the END of the
# body, on its own line, with a signature line (or two) after it. That
# way an in-body phrase like "we send our warm regards to everyone"
# is untouched but a proper closing like:
#     Warm regards,
#     The FriendPlace Team
# is removed so the renderer's own signer block is the one and only
# closing on the sent email.
import re as _re

_TRAILING_SIGNOFF_RE = _re.compile(
    # 1) One or two blank-line paragraph break OR just a newline before
    #    the closing (people sometimes put the closing on the very next
    #    line without a blank line above it).
    r"(?:\n\s*\n|\n)"
    # 2) The closing word / phrase, on its own visual line. Accept a
    #    trailing punctuation mark (usually comma) and optional trailing
    #    whitespace.
    r"[ \t]*"
    r"(?:"
        r"warmly|warm\s+regards|"
        r"best\s+regards|kind\s+regards|"
        r"sincerely|regards|cheers|"
        r"yours\s+truly|yours\s+sincerely|"
        r"best,?|kindly,?|"
        # covers e.g. "Thanks," used as a closing at the tail
        r"thanks|thank\s+you"
    r")"
    r"[ \t]*[,.]?[ \t]*\n"
    # 3) Signer line — up to ~80 chars, must contain SOMETHING visible.
    r"[ \t]*\S[^\n]{0,79}"
    # 4) Optional second signer/title line (e.g. "Your friend at
    #    FriendPlace"). Also up to ~80 chars.
    r"(?:\n[ \t]*\S[^\n]{0,79})?"
    # 5) Trailing whitespace / blank lines up to end of body.
    r"\s*$",
    _re.IGNORECASE,
)


def _strip_trailing_signoff(body_md: str) -> str:
    """Remove a recognisable trailing sign-off block from an authored
    body, so the renderer's own signer block can be appended without
    producing a duplicate closing.

    Only strips when a closing sits at the tail of the body — an
    in-body phrase like "regards" is left alone.

    Idempotent — applying twice is the same as once.
    """
    if not body_md:
        return body_md
    stripped = _TRAILING_SIGNOFF_RE.sub("", body_md).rstrip()
    return stripped


# ─── iter164ab: campaign body_md → safe markdown-lite renderer ──────
#
# Motivation:
#   The Campaign Composer needed to move beyond plain paragraphs so
#   Founding Member updates can use light emphasis (bold/italic),
#   inline links, and bullet lists without hand-writing HTML in the
#   composer. Every byte of user input still gets HTML-escaped BEFORE
#   any markdown transforms are applied — the transforms then act on
#   the escaped output and only re-emit HTML for the recognised
#   markdown syntax. That's the safe order: escape first, mark up
#   second, so no raw HTML from the composer can leak through.
#
# Supported subset (intentionally small):
#   • **bold**              → <strong>
#   • *italic* / _italic_   → <em>
#   • [text](url)           → <a href=url>text</a>  (http/https/mailto only)
#   • Lines beginning with  → <ul><li>…</li></ul>
#     "- " or "* "
#   • Blank line            → paragraph break
#
# Everything else prints as literal escaped text. No headings, no
# code blocks, no images, no HTML pass-through.
import re as _md_re

_MD_LINK_RE = _md_re.compile(
    r"\[([^\]\n]+?)\]\((https?://[^\s)]+|mailto:[^\s)]+)\)",
)
_MD_BOLD_RE = _md_re.compile(r"\*\*(.+?)\*\*", _md_re.DOTALL)
# Single-star italic: must NOT be preceded/followed by another star
# (otherwise we'd eat the innards of a bold token that already ran).
_MD_ITALIC_STAR_RE = _md_re.compile(r"(?<!\*)\*(?!\*)([^*\n]+?)(?<!\*)\*(?!\*)")
# Underscore italic: only when flanked by whitespace/punctuation, so
# `foo_bar_baz` variable-style tokens aren't butchered.
_MD_ITALIC_UNDER_RE = _md_re.compile(
    r"(?<![A-Za-z0-9_])_([^_\n]+?)_(?![A-Za-z0-9_])"
)
_MD_BULLET_LINE_RE = _md_re.compile(r"^[\-\*]\s+(.+)$")


def _md_inline(escaped_text: str) -> str:
    """Apply inline markdown to already-HTML-escaped text.

    Order matters: **bold** must run before *italic* so the outer
    stars don't get eaten as italic delimiters. Links run last on
    the transformed string so their inner label can carry bold or
    italic if needed.
    """
    out = _MD_BOLD_RE.sub(r"<strong>\1</strong>", escaped_text)
    out = _MD_ITALIC_STAR_RE.sub(r"<em>\1</em>", out)
    out = _MD_ITALIC_UNDER_RE.sub(r"<em>\1</em>", out)

    def _link_sub(m: "_md_re.Match[str]") -> str:
        label = m.group(1)
        href = m.group(2)
        # href is already HTML-escaped (escape ran BEFORE markdown), and
        # we restricted the scheme to http/https/mailto via the regex,
        # so this is safe to embed as an attribute value.
        return (
            f'<a href="{href}" '
            f'style="color:#0F766E;text-decoration:underline;">{label}</a>'
        )
    out = _MD_LINK_RE.sub(_link_sub, out)
    return out


def _render_campaign_body_md_to_html(body_md: str) -> str:
    """Convert a campaign body from safe markdown-lite to HTML.

    Returns the joined HTML for every paragraph/list in the input
    (no wrapping container — the letter shell already provides one).
    Returns an empty string for empty input so callers can render an
    "(No body content yet.)" placeholder.
    """
    from html import escape as _esc
    if not body_md or not body_md.strip():
        return ""
    blocks = [b.strip("\n") for b in body_md.split("\n\n") if b.strip()]
    html_parts: list[str] = []
    for block in blocks:
        lines = block.split("\n")
        bullets = [_MD_BULLET_LINE_RE.match(ln.strip()) for ln in lines]
        if lines and all(b is not None for b in bullets):
            items = "".join(
                f"<li style=\"margin:0 0 6px 0;\">"
                f"{_md_inline(_esc(b.group(1).strip()))}</li>"
                for b in bullets  # type: ignore[union-attr]
            )
            html_parts.append(
                f"<ul style=\"margin:0 0 20px 20px;padding:0 0 0 4px;\">"
                f"{items}</ul>"
            )
            continue
        escaped = _esc(block).replace("\n", "<br>")
        html_parts.append(
            f"<p style=\"margin:0 0 20px 0;\">{_md_inline(escaped)}</p>"
        )
    return "".join(html_parts)


def _render_campaign_body_md_to_text(body_md: str) -> str:
    """Plain-text form for the text/plain part of the email.

    We leave markdown markers legible (``**bold**``, ``*italic*``,
    ``- item``) and expand links to ``label (url)``. This gives text
    clients (and screen readers) an unambiguous, faithful rendering
    that mirrors what the recipient sees in the HTML part.
    """
    if not body_md or not body_md.strip():
        return ""
    def _link_text(m: "_md_re.Match[str]") -> str:
        return f"{m.group(1)} ({m.group(2)})"
    blocks = [b.strip("\n") for b in body_md.split("\n\n") if b.strip()]
    out_blocks: list[str] = []
    for block in blocks:
        # Expand links inline; leave bold/italic markers as-is so a
        # plain-text reader still sees the emphasis.
        expanded = _MD_LINK_RE.sub(_link_text, block)
        out_blocks.append(expanded)
    return "\n\n".join(out_blocks)






def _letter_signature_html(*, signer: str = "george") -> str:
    """Signature block. Warm sign-off for personal/community emails,
    a plain team signature for operational/security emails.

    `signer` values:
      • "george"  — personal emails signed by George.
      • "georgia" — personal emails signed by Georgia (same voice,
                    different companion — the visitor's original pick
                    on the marketing page).
      • "team"    — operational (support, password reset). Also the
                    default for Community / Outreach campaigns.
      • "none"    — iter164o: append no closing at all. Used when the
                    body already contains its own sign-off, so we don't
                    render a duplicate.

    iter164am — all sign-off text uses white (#FFFFFF) or a light
    muted white (rgba(255,255,255,0.72)) so it stays readable on the
    unified navy shell. Explicit inline colours only — no CSS
    inheritance, which Gmail / Outlook happily strip.
    """
    if signer == "none":
        return ""
    if signer == "team":
        return """\
<p style="margin:36px 0 0 0;color:#FFFFFF;">
  <span style="color:#FFFFFF;">Warmly,</span><br>
  <span style="font-weight:700;color:#FFFFFF;">The FriendPlace Team</span>
</p>
"""
    # Personal signer — proper case for the display name ("Georgia"/"George").
    display = signer.capitalize() if signer else "George"
    return f"""\
<p style="margin:36px 0 0 0;color:#FFFFFF;">
  <span style="color:#FFFFFF;">Warmly,</span><br>
  <span style="font-weight:700;color:#FFFFFF;">{display}</span><br>
  <span style="font-family:Georgia,'Iowan Old Style','Palatino Linotype',Palatino,'Times New Roman',serif;font-size:14px;color:rgba(255,255,255,0.72);font-style:italic;">Your friend at FriendPlace</span>
</p>
"""


def _letter_shell(*, preheader: str, body_html: str) -> str:
    """Wrap letter content in the master email template.

    iter164ak — unified full-navy design. The entire shell — outer
    body, lockup, letter body, footer — sits on the FriendPlace navy
    background so every branded email in this family reads the same
    way. Templates keep their own content and CTA buttons; only the
    surrounding chrome is standardised here.

    Args:
        preheader: The tiny line that appears in the inbox preview next
                   to the subject. Never visible in the body. Keep it
                   under about 100 characters — some clients truncate
                   at 90.
        body_html: Pre-rendered letter content (already table-wrapped
                   with `_letter_body_open()` / `_letter_body_close()`
                   or manually formed).
    """
    from html import escape as _esc
    safe_pre = _esc(preheader or "")
    return f"""\
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark only">
  <meta name="supported-color-schemes" content="dark">
  <title>FriendPlace</title>
</head>
<body style="margin:0;padding:0;background:{_INK_NAVY_DEEP};">
  <!-- Preheader: hidden visually, shown in inbox preview after subject -->
  <div style="display:none;font-size:1px;color:{_INK_NAVY_DEEP};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">
    {safe_pre}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{_INK_NAVY_DEEP};">
    <tr>
      <td align="center" style="background:{_INK_NAVY_DEEP};">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:{_INK_NAVY_DEEP};">
          <tr><td style="background:{_INK_NAVY_DEEP};">{_brand_lockup_html()}</td></tr>
          <tr><td style="background:{_INK_NAVY_DEEP};">{body_html}</td></tr>
          <tr><td style="background:{_INK_NAVY_DEEP};">{_letter_footer_html()}</td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
"""


def _letter_footer_text() -> str:
    """Plain-text counterpart to `_letter_footer_html`."""
    return (
        "\n\n"
        "— — —\n\n"
        "hello@friendplace.com.au  ·  friendplace.com.au\n"
        "Because you belong too.\n\n"
        "You're receiving this email because you have a FriendPlace "
        "account or expressed interest in joining our community."
    )


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


def password_reset_template(
    *,
    first_name: str | None,
    code: str,
    ttl_minutes: int,
    subject_override: str | None = None,
    preheader_override: str | None = None,
) -> tuple[str, str, str]:
    """Password-reset email — clean white letter design.

    Operational/security email, signed by "The FriendPlace Team".
    The reset code sits in a soft teal chip that's still legible on
    white without shouting. Body copy is warm but appropriately calm
    for a security context.

    `subject_override` / `preheader_override` — provided by the CMS
    email-preview panel when an admin has edited these fields before
    sending a test. Both are optional; sensible defaults are used
    when omitted.
    """
    from html import escape as _esc
    name = (first_name or "there").strip()
    subject = subject_override or "Reset your FriendPlace password"
    preheader = (
        preheader_override
        or f"Your secure reset code, valid for {ttl_minutes} minutes."
    )

    body = (
        _letter_body_open()
        + f"<p style=\"margin:0 0 20px 0;\">Hi {_esc(name)},</p>"
        + "<p style=\"margin:0 0 20px 0;\">We received a request to reset the password on your FriendPlace account. If that was you, use the secure code below to finish resetting it.</p>"
        + f"<p style=\"margin:0 0 12px 0;color:rgba(255,255,255,0.72);font-size:14px;letter-spacing:1.4px;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;font-weight:600;text-align:center;\">YOUR RESET CODE</p>"
        + f'<div style="text-align:center;margin:0 0 24px 0;">'
        + f'  <div style="display:inline-block;padding:20px 32px;border-radius:14px;background:#F0FDFA;border:1px solid #99F6E4;font-family:-apple-system,\'SF Mono\',Menlo,Consolas,monospace;font-size:40px;font-weight:800;letter-spacing:12px;color:#0F766E;">{_esc(code)}</div>'
        + f'</div>'
        + f"<p style=\"margin:0 0 20px 0;\">For your security, this code will expire in <strong>{ttl_minutes} minutes</strong>.</p>"
        + "<p style=\"margin:0 0 20px 0;color:rgba(255,255,255,0.72);font-size:15px;\">If you didn&rsquo;t request a password reset, you can safely ignore this email. Your account will remain secure and no changes will be made.</p>"
        + _letter_signature_html(signer="team")
        + _letter_body_close()
    )
    html = _letter_shell(preheader=preheader, body_html=body)

    text = (
        f"Hi {name},\n\n"
        f"We received a request to reset the password on your FriendPlace "
        f"account. If that was you, use the secure code below to finish "
        f"resetting it.\n\n"
        f"    YOUR RESET CODE\n\n"
        f"    {code}\n\n"
        f"For your security, this code will expire in {ttl_minutes} minutes.\n\n"
        f"If you didn't request a password reset, you can safely ignore this "
        f"email. Your account will remain secure and no changes will be made.\n\n"
        f"Warmly,\n"
        f"The FriendPlace Team"
        + _letter_footer_text()
    )
    return subject, html, text



def support_acknowledgement_template(
    *,
    first_name: str | None,
    ticket_ref: str,
    category: str,
    subject_snippet: str,
    subject_override: str | None = None,
    preheader_override: str | None = None,
) -> tuple[str, str, str]:
    """Support "we've received your message" acknowledgement.

    Operational email signed by "The FriendPlace Team". Warm, calm, and
    reassuring — echoes the user's subject line back so they visually
    confirm we received the right thing, and displays their ticket
    reference in a soft teal chip for easy quoting later.

    `subject_override` / `preheader_override` — CMS preview panel
    passes these when an admin has edited them before sending a test.
    """
    from html import escape as _esc
    name = (first_name or "there").strip()
    snippet = (subject_snippet or "").strip()
    if len(snippet) > 120:
        snippet = snippet[:117] + "…"

    _cat_lower = (category or "").lower()
    is_report = ("report" in _cat_lower or "bug" in _cat_lower or "technical" in _cat_lower)

    if is_report:
        default_subject = f"We've received your report — {ticket_ref}"
        default_preheader = "Thanks for taking the time to report this. We're on it."
        opening = (
            "Thanks for taking the time to report this. We&rsquo;ve logged it "
            "and one of our team will look into it and get back to you as soon "
            "as we can &mdash; usually within <strong>24 hours</strong>, often "
            "much sooner."
        )
        opening_text = (
            "Thanks for taking the time to report this. We've logged it and "
            "one of our team will look into it and get back to you as soon "
            "as we can — usually within 24 hours, often much sooner."
        )
    else:
        default_subject = f"We've received your message — {ticket_ref}"
        default_preheader = "Thanks for reaching out. We'll get back to you soon."
        opening = (
            "Thanks for reaching out to FriendPlace. We&rsquo;ve received your "
            "message and one of our team will get back to you as soon as we "
            "can &mdash; usually within <strong>24 hours</strong>, often much "
            "sooner."
        )
        opening_text = (
            "Thanks for reaching out to FriendPlace. We've received your "
            "message and one of our team will get back to you as soon as we "
            "can — usually within 24 hours, often much sooner."
        )

    email_subject = subject_override or default_subject
    preheader = preheader_override or default_preheader

    safe_ref = _esc(ticket_ref)
    safe_category = _esc(category or "Support")
    safe_snippet = _esc(snippet) if snippet else ""

    snippet_html = (
        f'<p style="margin:8px 0 0 0;color:rgba(255,255,255,0.72);font-size:14px;font-style:italic;">&ldquo;{safe_snippet}&rdquo;</p>'
        if safe_snippet else ""
    )

    body = (
        _letter_body_open()
        + f"<p style=\"margin:0 0 20px 0;\">Hi {_esc(name)},</p>"
        + f"<p style=\"margin:0 0 20px 0;\">{opening}</p>"
        # Ticket reference chip — quiet teal on white
        + '<div style="text-align:center;margin:28px 0 12px 0;">'
        + '  <div style="display:inline-block;padding:18px 26px;border-radius:14px;background:#F0FDFA;border:1px solid #99F6E4;text-align:left;min-width:220px;">'
        + '    <div style="font-family:-apple-system,\'Segoe UI\',Roboto,sans-serif;font-size:11px;letter-spacing:1.6px;font-weight:700;color:#0F766E;">YOUR SUPPORT TICKET</div>'
        + f'    <div style="font-family:-apple-system,\'SF Mono\',Menlo,Consolas,monospace;font-size:22px;font-weight:800;letter-spacing:2px;color:#FFFFFF;margin-top:6px;">{safe_ref}</div>'
        + f'    <div style="font-family:-apple-system,\'Segoe UI\',Roboto,sans-serif;font-size:13px;color:rgba(255,255,255,0.72);margin-top:8px;">{safe_category}</div>'
        + f'    {snippet_html}'
        + '  </div>'
        + '</div>'
        + "<p style=\"margin:20px 0 0 0;color:#475569;font-size:15px;\">In the meantime, you might find an answer in our <a href=\"https://www.friendplace.com.au/faqs\" style=\"color:#0F766E;text-decoration:none;font-weight:600;\">FAQs</a> — and if your question is urgent or you have anything to add, simply reply to this email and it&rsquo;ll be added straight to your ticket.</p>"
        + _letter_signature_html(signer="team")
        + _letter_body_close()
    )
    html = _letter_shell(preheader=preheader, body_html=body)

    text = (
        f"Hi {name},\n\n"
        f"{opening_text}\n\n"
        f"    Your support ticket: {ticket_ref}\n"
        f"    Category: {category}\n"
        + (f'    Subject: "{snippet}"\n' if snippet else "")
        + "\n"
        f"In the meantime, you might find an answer in our FAQs "
        f"(https://www.friendplace.com.au/faqs) — and if your question is "
        f"urgent or you have anything to add, simply reply to this email "
        f"and it'll be added straight to your ticket.\n\n"
        f"Warmly,\n"
        f"The FriendPlace Team"
        + _letter_footer_text()
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

    html = _letter_shell(
        preheader=email_subject,
        body_html=f"""\
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{_INK_NAVY_DEEP};">
  <tr><td align="center" style="padding:0 22px 6px 22px;">
    <div style="color:#93C5FD;font-size:12px;letter-spacing:2.4px;font-weight:700;">
      EVENTS · RSVP CONFIRMED
    </div>
  </td></tr>

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

  <!-- Ticket ref -->
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
</table>
""",
    )

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
        f"{_letter_footer_text()}"
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

    html = _letter_shell(
        preheader=email_subject,
        body_html=f"""\
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{_INK_NAVY_DEEP};">
  <tr>
    <td align="center" style="padding:0 22px 6px 22px;">
      <div style="color:#FCA5A5;font-size:12px;letter-spacing:2.4px;font-weight:700;">
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
        <a href="https://www.friendplace.com.au/events" style="color:#5EEAD4;text-decoration:none;font-weight:600;">events page</a>
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
</table>
""",
    )

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
        f"{_letter_footer_text()}"
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

    html = _letter_shell(
        preheader=email_subject,
        body_html=f"""\
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{_INK_NAVY_DEEP};">
  <tr>
    <td align="center" style="padding:0 22px 6px 22px;">
      <div style="color:#93C5FD;font-size:12px;letter-spacing:2.4px;font-weight:700;">
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
</table>
""",
    )

    text = (
        f"Hi {name},\n\n"
        f"Thanks for registering {business_name} on FriendPlace. We're delighted to have you as part of the community.\n\n"
        f"    Your trial is active: {trial_limit} listings · {trial_days} days\n"
        f"    Requested: {plan_label}\n\n"
        f"Post your events straight from the mobile app — they'll appear in the community feed with your organisation shown as the host.\n\n"
        f"We're finalising our organisation plans and will email you the pricing before your trial ends, so there are no surprises.\n\n"
        f"If you have any questions in the meantime, just reply to this email — it'll come straight through to us.\n\n"
        f"💜 The FriendPlace Team"
        f"{_letter_footer_text()}"
    )
    return email_subject, html, text



def event_submission_ack_template(
    *,
    first_name: str | None,
    organisation_name: str,
    event_title: str,
    submission_ref: str,
) -> tuple[str, str, str]:
    """Confirmation email sent to the person who fills in the "List your
    event" form on the marketing website. Warm, sets clear expectations
    (draft-first review), and quotes the submission reference the
    admin will see in Mission Control."""
    from html import escape as _esc
    name = (first_name or "there").strip()
    safe_org = _esc(organisation_name)
    safe_title = _esc(event_title)
    safe_ref = _esc(submission_ref)

    email_subject = f"We've received your event — {submission_ref}"

    html = _letter_shell(
        preheader=email_subject,
        body_html=f"""\
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{_INK_NAVY_DEEP};">
  <tr>
    <td align="center" style="padding:0 22px 6px 22px;">
      <div style="color:#93C5FD;font-size:12px;letter-spacing:2.4px;font-weight:700;">
        EVENT · SUBMITTED FOR REVIEW
      </div>
    </td>
  </tr>
  <tr>
    <td style="padding:24px 22px 6px 22px;">
      <div style="font-size:17px;line-height:26px;color:#E2E8F0;">
        Hi {_esc(name)},<br><br>
        Thanks — your event has been submitted for review.<br><br>
        The FriendPlace team will check the details and contact you if anything further is needed. We&rsquo;ll let you know once it has been approved and published.
      </div>
    </td>
  </tr>
  <tr>
    <td align="center" style="padding:22px 22px 4px 22px;">
      <div style="display:inline-block;padding:14px 22px;border-radius:14px;background:rgba(20,184,166,0.12);border:1px solid rgba(94,234,212,0.35);">
        <div style="color:#93C5FD;font-size:11px;letter-spacing:1.8px;font-weight:700;">YOUR REFERENCE</div>
        <div style="color:#5EEAD4;font-size:24px;font-weight:900;letter-spacing:2px;line-height:1;margin-top:6px;">{safe_ref}</div>
        <div style="color:#CBD5E1;font-size:13px;margin-top:10px;">{safe_title}</div>
        <div style="color:#94A3B8;font-size:12px;margin-top:2px;">Submitted by {safe_org}</div>
      </div>
    </td>
  </tr>
  <tr>
    <td style="padding:18px 22px 4px 22px;">
      <div style="font-size:14px;line-height:22px;color:#CBD5E1;padding:14px 16px;border-radius:12px;background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.25);">
        Reviews usually take under a day. If you spotted a typo or need to update anything, just reply to this email and we&rsquo;ll update it for you.
      </div>
    </td>
  </tr>
  <tr>
    <td style="padding:22px 22px 4px 22px;">
      <div style="font-size:15px;line-height:22px;color:#E2E8F0;">
        Thanks for helping to build FriendPlace.<br><br>
        💜 The FriendPlace Team
      </div>
    </td>
  </tr>
</table>
""",
    )

    text = (
        f"Hi {name},\n\n"
        f"Thanks — your event has been submitted for review.\n\n"
        f"The FriendPlace team will check the details and contact you if anything further is needed. "
        f"We'll let you know once it has been approved and published.\n\n"
        f"    Reference: {submission_ref}\n"
        f"    Event:     {event_title}\n"
        f"    Submitted by: {organisation_name}\n\n"
        f"Reviews usually take under a day. If you spotted a typo or need to update anything, "
        f"just reply to this email and we'll update it for you.\n\n"
        f"Thanks for helping to build FriendPlace.\n\n"
        f"💜 The FriendPlace Team"
        f"{_letter_footer_text()}"
    )
    return email_subject, html, text



# ---------------------------------------------------------------------------
# LETTER-STYLE TEMPLATES  (Welcome · Waitlist · Invitation)
# ---------------------------------------------------------------------------
# Personal, community-focused emails signed by George. These three share
# the exact same shell, spacing and typography as the password-reset
# and support-acknowledgement emails above — so every touchpoint feels
# like the same family of letters.


def welcome_template(
    *,
    first_name: str | None,
    action_url: str | None = None,
    companion: str = "george",
    subject_override: str | None = None,
    preheader_override: str | None = None,
) -> tuple[str, str, str]:
    """Sent the first time an account is created and confirmed.

    Personal letter from the visitor's chosen companion (George by
    default; Georgia if they picked her on the marketing page). Warm,
    welcoming, gently pointing at the next thing to explore.

    Args:
        first_name:  Recipient's first name (falls back to "there").
        action_url:  Optional CTA target (usually the app home / their
                     new profile). If omitted, no button is rendered
                     and the letter simply closes on the signature.
        companion:   Who is writing this letter — "george" or "georgia".
                     Threads through the intro line and signature so
                     the whole letter feels consistent.
        subject_override / preheader_override:
                     CMS preview panel passes these when an admin has
                     edited the subject or preheader before sending.
                     Both fall back to the on-brand defaults.
    """
    from html import escape as _esc
    name = (first_name or "there").strip()
    display = "Georgia" if str(companion).lower() == "georgia" else "George"
    subject = subject_override or "Welcome to FriendPlace"
    preheader = (
        preheader_override
        or f"A little note from {display} — glad you found us."
    )

    cta_html = (
        _letter_button_html(label="Step inside FriendPlace", url=action_url)
        if action_url else ""
    )
    cta_text = f"\n    {action_url}\n" if action_url else ""

    body = (
        _letter_body_open()
        + f"<p style=\"margin:0 0 20px 0;\">Dear {_esc(name)},</p>"
        + "<p style=\"margin:0 0 20px 0;\">Welcome to FriendPlace &mdash; and thank you for finding us.</p>"
        + f"<p style=\"margin:0 0 20px 0;\">I&rsquo;m {display}. My job here is to help you feel at home from the very first moment. Whether you&rsquo;re looking for someone to share a walk with, an event to go to on a quiet weekend, or simply a place where a warm hello isn&rsquo;t rare &mdash; you&rsquo;re in the right place.</p>"
        + "<p style=\"margin:0 0 20px 0;\">Take your time. Have a wander. There&rsquo;s no rush, no pressure, and no obligation to be anything other than yourself.</p>"
        + "<p style=\"margin:0 0 20px 0;\">If you get stuck, or just fancy a chat, I&rsquo;m never far away. Reply to this email or find me inside the app &mdash; I read every message.</p>"
        + cta_html
        + "<p style=\"margin:24px 0 0 0;\">It&rsquo;s lovely to have you with us.</p>"
        + _letter_signature_html(signer=companion)
        + _letter_body_close()
    )
    html = _letter_shell(preheader=preheader, body_html=body)

    text = (
        f"Dear {name},\n\n"
        "Welcome to FriendPlace — and thank you for finding us.\n\n"
        f"I'm {display}. My job here is to help you feel at home from "
        "the very first moment. Whether you're looking for someone to "
        "share a walk with, an event to go to on a quiet weekend, or "
        "simply a place where a warm hello isn't rare — you're in the "
        "right place.\n\n"
        "Take your time. Have a wander. There's no rush, no pressure, "
        "and no obligation to be anything other than yourself.\n\n"
        "If you get stuck, or just fancy a chat, I'm never far away. "
        "Reply to this email or find me inside the app — I read every "
        "message."
        + cta_text
        + "\nIt's lovely to have you with us.\n\n"
        "Warmly,\n"
        f"{display}\n"
        "Your friend at FriendPlace"
        + _letter_footer_text()
    )
    return subject, html, text


def waitlist_template(
    *,
    first_name: str | None,
    position: int | None = None,
    founder_number: int | None = None,
    companion: str = "george",
    subject_override: str | None = None,
    preheader_override: str | None = None,
) -> tuple[str, str, str]:
    """Sent when someone joins the pre-launch waitlist.

    Signed by the visitor's chosen companion. A personal thank-you,
    not a marketing "you're in!" email. When a `founder_number` is
    provided (every real registration gets one), it's rendered as
    the celebratory hero of the letter — because permanent
    recognition beats a queue position every time.
    """
    from html import escape as _esc
    name = (first_name or "there").strip()
    display = "Georgia" if str(companion).lower() == "georgia" else "George"
    subject = subject_override or "Welcome, Founding Member"
    preheader = (
        preheader_override
        or f"Your permanent Founding Member Number is inside — from {display}."
    )

    # Founding Member Number hero card — treated as a proud milestone.
    # Wrapped in a table so it holds up in the Outlook/Windows email
    # renderers that ignore modern flex/border-radius on divs.
    founder_hero_html = ""
    founder_hero_text = ""
    if founder_number and founder_number > 0:
        fno = f"#{int(founder_number):04d}"
        founder_hero_html = (
            "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" "
            "style=\"margin:24px 0 28px 0;border-collapse:separate;\">"
            "  <tr><td align=\"center\" style=\""
            "padding:22px 20px;"
            "background:linear-gradient(135deg,#0F766E 0%,#14B8A6 100%);"
            "border-radius:18px;"
            "color:#FFFFFF;"
            "font-family:'Georgia','Times New Roman',serif;"
            "box-shadow:0 8px 24px rgba(20,184,166,0.24);"
            "\">"
            "    <div style=\"font-size:11px;letter-spacing:0.16em;text-transform:uppercase;font-weight:800;opacity:0.9;\">Founding Member Number</div>"
            f"    <div style=\"font-size:44px;font-weight:900;line-height:1;margin-top:6px;letter-spacing:-0.01em;\">{fno}</div>"
            "    <div style=\"font-size:13px;margin-top:8px;opacity:0.92;\">Permanent · Yours forever · Never reassigned</div>"
            "  </td></tr>"
            "</table>"
        )
        founder_hero_text = (
            f"\n══════════════════════════════════════\n"
            f"    FOUNDING MEMBER NUMBER  {fno}\n"
            f"    Permanent · Yours forever · Never reassigned\n"
            f"══════════════════════════════════════\n\n"
        )

    # If founder_number is set we lead with that; the older queue
    # `position` remains supported for backwards compatibility but
    # deliberately never appears alongside the founder number
    # (they'd fight for the same "you're this-number" spotlight).
    position_html = (
        f"<p style=\"margin:0 0 20px 0;color:rgba(255,255,255,0.72);font-size:15px;font-style:italic;\">You&rsquo;re currently number <strong style=\"color:#FFFFFF;font-style:normal;\">{int(position)}</strong> on our list &mdash; thank you for the trust.</p>"
        if position and position > 0 and not founder_number else ""
    )
    position_text = (
        f"\nYou're currently number {int(position)} on our list — thank you "
        f"for the trust.\n"
        if position and position > 0 and not founder_number else ""
    )

    body = (
        _letter_body_open()
        + f"<p style=\"margin:0 0 20px 0;\">Dear {_esc(name)},</p>"
        + "<p style=\"margin:0 0 20px 0;\">Thank you for finding us &mdash; and for saying &ldquo;yes, I&rsquo;d like to be part of this.&rdquo;</p>"
        + founder_hero_html
        + (
            "<p style=\"margin:0 0 20px 0;\">That number is yours forever. When FriendPlace opens its doors and grows into the community we&rsquo;re building, your Founding Member Number goes with you &mdash; on your profile, on your badge inside the app, and quietly, as our thank-you for being here first.</p>"
            if founder_number else ""
        )
        + "<p style=\"margin:0 0 20px 0;\">FriendPlace is being built quietly and carefully, because places where people belong don&rsquo;t happen by accident. We&rsquo;re inviting friends in a small group at a time so that every new arrival is met with warmth, not silence.</p>"
        + position_html
        + "<p style=\"margin:0 0 20px 0;\">You&rsquo;ll hear from me the moment your invitation is ready. In the meantime, if you know someone who might feel at home here, forward this email their way. Belonging tends to grow best when someone opens the door.</p>"
        + "<p style=\"margin:24px 0 0 0;\">Thank you, again, for being here from the start.</p>"
        + _letter_signature_html(signer=companion)
        + _letter_body_close()
    )
    html = _letter_shell(preheader=preheader, body_html=body)

    text = (
        f"Dear {name},\n\n"
        "Thank you for finding us — and for saying \"yes, I'd like to be "
        "part of this.\"\n\n"
        + founder_hero_text
        + (
            "That number is yours forever. When FriendPlace opens its "
            "doors and grows into the community we're building, your "
            "Founding Member Number goes with you — on your profile, on "
            "your badge inside the app, and quietly, as our thank-you "
            "for being here first.\n\n"
            if founder_number else ""
        )
        + "FriendPlace is being built quietly and carefully, because places "
        "where people belong don't happen by accident. We're inviting "
        "friends in a small group at a time so that every new arrival is "
        "met with warmth, not silence.\n"
        + position_text
        + "\nYou'll hear from me the moment your invitation is ready. In "
        "the meantime, if you know someone who might feel at home here, "
        "forward this email their way. Belonging tends to grow best when "
        "someone opens the door.\n\n"
        "Thank you, again, for being here from the start.\n\n"
        "Warmly,\n"
        f"{display}\n"
        "Your friend at FriendPlace"
        + _letter_footer_text()
    )
    return subject, html, text


def invitation_template(
    *,
    first_name: str | None,
    inviter_name: str | None,
    accept_url: str,
    expiry_days: int = 14,
    companion: str = "george",
    subject_override: str | None = None,
    preheader_override: str | None = None,
) -> tuple[str, str, str]:
    """Sent when someone is personally invited to join FriendPlace.

    Signed by the visitor's chosen companion. The tone is a personal
    introduction, not a marketing recruitment. Names the person who
    invited them (if known) so the invitee sees a familiar name before
    they see a brand.
    """
    from html import escape as _esc
    name = (first_name or "there").strip()
    inviter = (inviter_name or "").strip()
    display = "Georgia" if str(companion).lower() == "georgia" else "George"
    subject = subject_override or "An invitation to FriendPlace"
    default_preheader = (
        f"{inviter} would like you to join them at FriendPlace."
        if inviter else
        "Someone would like you to join them at FriendPlace."
    )
    preheader = preheader_override or default_preheader

    inviter_line = (
        f"<p style=\"margin:0 0 20px 0;color:#FFFFFF;\"><strong style=\"color:#FFFFFF;\">{_esc(inviter)}</strong> thought you&rsquo;d feel at home here &mdash; and asked me to send you a personal invitation to join us at FriendPlace.</p>"
        if inviter else
        "<p style=\"margin:0 0 20px 0;\">A member of FriendPlace thought you&rsquo;d feel at home here, and asked me to send you a personal invitation to join us.</p>"
    )
    inviter_line_text = (
        f"{inviter} thought you'd feel at home here — and asked me to "
        f"send you a personal invitation to join us at FriendPlace."
        if inviter else
        "A member of FriendPlace thought you'd feel at home here, and "
        "asked me to send you a personal invitation to join us."
    )

    body = (
        _letter_body_open()
        + f"<p style=\"margin:0 0 20px 0;\">Dear {_esc(name)},</p>"
        + inviter_line
        + "<p style=\"margin:0 0 20px 0;\">FriendPlace is a quiet, kind space for finding people to share the small and lovely bits of life with &mdash; a coffee, a walk, an event that would be nicer with someone next to you. There&rsquo;s no algorithm chasing your attention, no pressure to perform. Just people, being neighbourly.</p>"
        + "<p style=\"margin:0 0 8px 0;\">Whenever you&rsquo;re ready, your invitation is waiting:</p>"
        + _letter_button_html(label="Accept your invitation", url=accept_url)
        + f"<p style=\"margin:20px 0 20px 0;color:rgba(255,255,255,0.72);font-size:14px;\">This invitation is personal to you and stays open for <strong style=\"color:#FFFFFF;\">{int(expiry_days)} days</strong>. If it expires, simply reply to this email and I&rsquo;ll send you a fresh one.</p>"
        + "<p style=\"margin:24px 0 0 0;\">I hope to see you inside.</p>"
        + _letter_signature_html(signer=companion)
        + _letter_body_close()
    )
    html = _letter_shell(preheader=preheader, body_html=body)

    text = (
        f"Dear {name},\n\n"
        f"{inviter_line_text}\n\n"
        "FriendPlace is a quiet, kind space for finding people to share "
        "the small and lovely bits of life with — a coffee, a walk, an "
        "event that would be nicer with someone next to you. There's no "
        "algorithm chasing your attention, no pressure to perform. Just "
        "people, being neighbourly.\n\n"
        "Whenever you're ready, your invitation is waiting:\n"
        f"    {accept_url}\n\n"
        f"This invitation is personal to you and stays open for "
        f"{int(expiry_days)} days. If it expires, simply reply to this "
        "email and I'll send you a fresh one.\n\n"
        "I hope to see you inside.\n\n"
        "Warmly,\n"
        f"{display}\n"
        "Your friend at FriendPlace"
        + _letter_footer_text()
    )
    return subject, html, text


def announcement_template(
    *,
    first_name: str | None,
    title: str,
    body_md: str,
    founder_number: int | None = None,
    cta_label: str | None = None,
    cta_url: str | None = None,
    companion: str = "george",
    subject_override: str | None = None,
    preheader_override: str | None = None,
    greeting: str | None = None,
    show_founder_badge: bool | None = None,
) -> tuple[str, str, str]:
    """The Founding Member Update template — used by campaigns.

    A general-purpose letter-style template for keeping Founding
    Members in the loop as FriendPlace comes together. Follows the
    same letter shell as `waitlist_template` (subhead, greeting,
    body paragraphs, optional CTA, companion signature) so all
    campaign emails feel like part of the same family.

    Args:
        first_name:  Recipient's name for the greeting.
        title:       The update's headline (rendered as a serif h1
                     inside the letter, above the body).
        body_md:     The letter body. Blank lines split paragraphs.
                     Very light markdown-ish handling: nothing fancy,
                     just paragraph breaks and HTML-escape.
        founder_number: If provided, rendered as a small pill under
                        the greeting so recipients remember their
                        permanent number every time we write.
        cta_label / cta_url:
                     Optional call-to-action button — omit both for
                     an update that closes on the signature.
        companion:   Which companion is writing.
    """
    from html import escape as _esc
    name = (first_name or "there").strip()
    # iter164o: signer resolution.
    # `companion` on this endpoint accepts:
    #   • "george" / "georgia" — personal companion signature
    #   • "team"               — The FriendPlace Team closing
    #   • "none"               — no closing appended (body owns it)
    signer_norm = str(companion or "george").lower().strip()
    if signer_norm not in {"george", "georgia", "team", "none"}:
        signer_norm = "george"
    is_personal = signer_norm in {"george", "georgia"}
    display = "Georgia" if signer_norm == "georgia" else "George"
    # iter164o: honour explicitly-empty title. Blank means "no headline",
    # not "silently restore the default". Preview and worker both pass
    # title through raw now.
    raw_title = (title or "").strip()
    has_heading = bool(raw_title)
    heading = raw_title  # empty allowed — used only when has_heading
    subject = subject_override or heading or "A note from FriendPlace"
    if preheader_override:
        preheader = preheader_override
    elif is_personal:
        preheader = f"An update from {display} at FriendPlace."
    else:
        preheader = "An update from FriendPlace."

    # iter164p greeting resolution.
    # `greeting` accepts:
    #   • None (unset, back-compat) -> "Dear <first_name>,"
    #   • ""   (explicitly blank)   -> render no greeting line
    #   • any string with the literal token "[Contact name]" ->
    #     substituted per-recipient at render time (bulk preview keeps
    #     the placeholder unchanged because `first_name` is set to
    #     "[Contact name]" by the composer's bulk preview path)
    #   • any other string          -> rendered verbatim (e.g. "Hi there,")
    CONTACT_TOKEN = "[Contact name]"
    if greeting is None:
        greeting_rendered = f"Dear {name},"
    elif greeting == "":
        greeting_rendered = ""
    else:
        greeting_rendered = greeting.replace(CONTACT_TOKEN, name)

    # iter164p Founder-badge toggle. Back-compat semantics:
    #   • None  (unset)  -> render iff founder_number is a positive int
    #                       (previous behaviour)
    #   • True           -> render iff founder_number is a positive int
    #   • False          -> suppress even when founder_number is present
    show_pill = (
        (show_founder_badge is not False)
        and bool(founder_number)
        and int(founder_number) > 0
    )

    # Founder number pill — smaller than the waitlist hero, just a
    # gentle reminder of their permanent identity.
    founder_pill_html = ""
    founder_pill_text = ""
    if show_pill:
        fno = f"#{int(founder_number):04d}"
        founder_pill_html = (
            f"<p style=\"margin:0 0 20px 0;\">"
            f"<span style=\"display:inline-block;padding:2px 10px;"
            f"border-radius:6px;background:#F0FDFA;color:#0F766E;"
            f"border:1px solid #99F6E4;font-size:12px;font-weight:800;"
            f"font-variant-numeric:tabular-nums;letter-spacing:0.02em;\">"
            f"Founding Member {fno}</span></p>"
        )
        founder_pill_text = f"[Founding Member {fno}]\n\n"

    # iter164o duplicate-signoff guarantee:
    # If the composer body ends with its own closing (e.g. "Warm regards,
    # The FriendPlace Team"), we must NOT append a second closing. The
    # renderer strips a recognisable trailing sign-off block whenever the
    # selected signer will render one — so the pipeline produces exactly
    # one closing regardless of what the author typed.
    #   signer='team'    -> strip trailing signoff, then append Team block
    #   signer='george'  -> strip trailing signoff, then append George block
    #   signer='georgia' -> strip trailing signoff, then append Georgia block
    #   signer='none'    -> KEEP whatever closing the body owns; append nothing
    body_md_effective = body_md or ""
    if signer_norm != "none":
        body_md_effective = _strip_trailing_signoff(body_md_effective)

    # iter164ab: minimal, safe markdown-lite renderer for campaign
    # bodies. Supports **bold**, *italic* / _italic_, [text](url) for
    # http(s)/mailto URLs, `-`/`*` bullet lists, and blank-line
    # paragraph breaks. Everything is HTML-escaped BEFORE markdown
    # transforms run so no raw HTML from the composer can leak into
    # the letter. Old callers (single-line paragraphs, no markdown)
    # render byte-identically to the pre-iter164ab shell.
    body_html_joined = _render_campaign_body_md_to_html(body_md_effective)
    if not body_html_joined:
        body_html_joined = (
            "<p style=\"margin:0 0 20px 0;color:rgba(255,255,255,0.72);font-style:italic;\">"
            "(No body content yet.)</p>"
        )
    # Plain-text form used by the text/plain part of the email. We
    # keep markdown markers legible for text-only readers (bold →
    # **bold**, italic → *italic*, links → text (url), bullets stay
    # as `- item` per RFC 5147 conventions) — no double-escape.
    text_body_joined = _render_campaign_body_md_to_text(body_md_effective)

    cta_html = (
        _letter_button_html(label=cta_label, url=cta_url)
        if cta_label and cta_url else ""
    )
    cta_text = (
        f"\n{cta_label}: {cta_url}\n" if cta_label and cta_url else ""
    )

    body = (
        _letter_body_open()
        + (
            # iter164am — headline must be readable on navy. Was
            # color:#0A2540 (navy on navy → invisible); now explicit
            # white with a subtle light-teal accent underline via
            # border-bottom to keep the "letter headline" feel.
            f"<h1 style=\"margin:0 0 20px 0;font-family:'Georgia','Times New Roman',serif;color:#FFFFFF;font-size:26px;line-height:1.3;font-weight:700;\">{_esc(heading)}</h1>"
            if has_heading else ""
        )
        + (
            # iter164am — greeting paragraph inherits body colour but
            # some clients drop parent styles; set explicit white.
            f"<p style=\"margin:0 0 20px 0;color:#FFFFFF;\">{_esc(greeting_rendered)}</p>"
            if greeting_rendered else ""
        )
        + founder_pill_html
        + body_html_joined
        + cta_html
        + (
            # iter164am — closing paragraph gets explicit white too.
            "<p style=\"margin:24px 0 0 0;color:#FFFFFF;\">Thank you, as always, for being here from the start.</p>"
            if is_personal else ""
        )
        + _letter_signature_html(signer=signer_norm)
        + _letter_body_close()
    )
    html = _letter_shell(preheader=preheader, body_html=body)

    text_paragraphs = text_body_joined or "(No body content yet.)"
    # iter164o: conditional heading + signer-aware plain-text closing.
    heading_text = (
        f"{heading}\n{'=' * min(len(heading), 60)}\n\n"
        if has_heading else ""
    )
    closing_intro = (
        "\nThank you, as always, for being here from the start.\n\n"
        if is_personal else "\n"
    )
    if signer_norm == "none":
        closing_signoff = ""
    elif signer_norm == "team":
        closing_signoff = "Warmly,\nThe FriendPlace Team"
    else:
        closing_signoff = f"Warmly,\n{display}\nYour friend at FriendPlace"
    text = (
        heading_text
        + (f"{greeting_rendered}\n\n" if greeting_rendered else "")
        + founder_pill_text
        + text_paragraphs + "\n"
        + cta_text
        + closing_intro
        + closing_signoff
        + _letter_footer_text()
    )
    return subject, html, text
