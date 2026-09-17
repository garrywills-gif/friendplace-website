"""Hotfix for MCGS campaign email rendering.

Loaded from services.__init__ at backend startup.  We patch only the shared
email_service callables that cms_module imports lazily at campaign send time.
This keeps the fix isolated from transactional emails (password reset, RSVP,
etc.) while making outreach campaigns match the polished MCGS preview.
"""
from __future__ import annotations

import asyncio
import os
import re
from html import escape

import email_service as _es

_ORIGINAL_SEND = _es.send_email_detailed
_NAVY = "#0A2540"
_TEAL = "#14B8A6"
_TEXT = "#F8FAFC"
_MUTED = "#CBD5E1"


def _inline_md(text: str) -> str:
    """Small, safe subset used by the campaign composer."""
    s = escape(text or "")
    # links first so later emphasis handling cannot corrupt hrefs
    s = re.sub(r"\[([^\]]+)\]\((https?://[^\s)]+)\)",
               r'<a href="\2" style="color:#5EEAD4;text-decoration:underline;">\1</a>', s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", s)
    return s


def _body_html(body_md: str) -> str:
    blocks = [b.strip() for b in (body_md or "").split("\n\n") if b.strip()]
    out: list[str] = []
    for block in blocks:
        lines = block.splitlines()
        if lines and all(line.lstrip().startswith(("- ", "* ")) for line in lines):
            items = "".join(
                f'<li style="margin:0 0 8px 0;">{_inline_md(line.lstrip()[2:])}</li>'
                for line in lines
            )
            out.append(f'<ul style="margin:0 0 20px 22px;padding:0;">{items}</ul>')
        else:
            out.append(
                '<p style="margin:0 0 20px 0;">'
                + _inline_md(block).replace("\n", "<br>")
                + "</p>"
            )
    return "".join(out)


def _plain_md(text: str) -> str:
    s = text or ""
    s = re.sub(r"\[([^\]]+)\]\((https?://[^\s)]+)\)", r"\1: \2", s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"\1", s)
    s = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"\1", s)
    return s


def announcement_template(
    *, first_name: str | None, title: str, body_md: str,
    founder_number: int | None = None, cta_label: str | None = None,
    cta_url: str | None = None, greeting: str | None = None,
    show_founder_badge: bool | None = None, companion: str = "george",
    subject_override: str | None = None, preheader_override: str | None = None,
) -> tuple[str, str, str]:
    raw_name = (first_name or "").strip()
    heading = (title or "").strip() or "A note from FriendPlace"
    outreach = companion == "team" or show_founder_badge is False

    if greeting == "":
        rendered_greeting = ""
    elif greeting is None:
        rendered_greeting = f"Dear {raw_name or 'friend'},"
    elif "[Contact name]" in greeting:
        rendered_greeting = greeting.replace("[Contact name]", raw_name) if raw_name else "Hello friend,"
    else:
        rendered_greeting = greeting

    greeting_html = (
        f'<p style="margin:0 0 22px 0;font-size:20px;font-weight:700;">{escape(rendered_greeting)}</p>'
        if rendered_greeting else ""
    )
    founder_html = ""
    founder_text = ""
    if not outreach and show_founder_badge is not False and founder_number:
        fno = f"#{int(founder_number):04d}"
        founder_html = (
            f'<div style="display:inline-block;margin:0 0 20px 0;padding:5px 12px;border-radius:999px;'
            f'background:#E6FFFB;color:#0F766E;font-size:12px;font-weight:800;">Founding Member {fno}</div>'
        )
        founder_text = f"Founding Member {fno}\n\n"

    cta_html = ""
    if cta_label and cta_url:
        cta_html = (
            '<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:30px auto 26px auto;">'
            '<tr><td align="center" style="border-radius:12px;background:#14B8A6;">'
            f'<a href="{escape(cta_url)}" style="display:inline-block;padding:14px 24px;color:#FFFFFF;'
            'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;font-weight:800;'
            f'text-decoration:none;border-radius:12px;">{escape(cta_label)}</a></td></tr></table>'
        )

    if outreach:
        signature_html = (
            '<div style="margin-top:30px;padding-top:18px;border-top:1px solid rgba(255,255,255,.18);">'
            '<div style="color:#CBD5E1;">Warmly,</div>'
            '<div style="margin-top:4px;font-weight:800;color:#FFFFFF;">The FriendPlace Team</div>'
            '<div style="margin-top:5px;color:#5EEAD4;font-style:italic;">Because you belong too.</div>'
            '</div>'
        )
        signature_text = "Warmly,\nThe FriendPlace Team\nBecause you belong too."
        compliance_html = (
            '<div style="margin-top:28px;padding-top:18px;border-top:1px solid rgba(255,255,255,.13);'
            'font-size:11px;line-height:17px;color:#94A3B8;">'
            "You’re receiving this email because your organisation’s publicly listed contact details indicated "
            "FriendPlace may be relevant to your community."
            '</div>'
        )
        # The campaign delivery layer may append the recipient-specific unsubscribe link.
        compliance_text = (
            "\n\nYou're receiving this email because your organisation's publicly listed contact details "
            "indicated FriendPlace may be relevant to your community."
        )
    else:
        who = "Georgia" if companion == "georgia" else "George"
        signature_html = (
            '<div style="margin-top:30px;padding-top:18px;border-top:1px solid rgba(255,255,255,.18);">'
            '<div style="color:#CBD5E1;">Warmly,</div>'
            f'<div style="margin-top:4px;font-weight:800;color:#FFFFFF;">{who}</div>'
            '<div style="margin-top:5px;color:#CBD5E1;font-style:italic;">Your friend at FriendPlace</div></div>'
        )
        signature_text = f"Warmly,\n{who}\nYour friend at FriendPlace"
        compliance_html = ""
        compliance_text = ""

    butterfly = getattr(_es, "_BRAND_BUTTERFLY_B64", "")
    logo = (
        f'<img src="data:image/png;base64,{butterfly}" width="72" alt="FriendPlace" '
        'style="display:block;margin:0 auto 14px auto;border:0;">'
        if butterfly else ""
    )
    preheader = preheader_override or "FriendPlace — Because you belong too."
    html = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><title>FriendPlace</title></head>
<body style="margin:0;padding:0;background:{_NAVY};">
<!-- FP_OUTREACH_EMAIL -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{escape(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{_NAVY};">
<tr><td align="center" style="padding:34px 16px;">
<table role="presentation" width="620" cellpadding="0" cellspacing="0" style="width:100%;max-width:620px;">
<tr><td align="center" style="padding:0 0 24px 0;">{logo}
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:28px;font-weight:900;color:#FFFFFF;">FriendPlace</div>
<div style="margin-top:7px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;letter-spacing:3px;color:#CBD5E1;">BECAUSE YOU BELONG TOO.</div></td></tr>
<tr><td style="padding:34px 38px;border:1px solid rgba(255,255,255,.14);border-radius:20px;background:#0D2D4D;box-shadow:0 16px 44px rgba(0,0,0,.18);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:17px;line-height:1.65;color:{_TEXT};">
<h1 style="margin:0 0 24px 0;color:#FFFFFF;font-size:27px;line-height:1.25;">{escape(heading)}</h1>
{greeting_html}{founder_html}{_body_html(body_md)}{signature_html}{cta_html}{compliance_html}
</td></tr>
<tr><td align="center" style="padding:20px 10px 0;color:#94A3B8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;line-height:19px;">
<a href="https://www.friendplace.com.au" style="color:#5EEAD4;text-decoration:none;font-weight:700;">friendplace.com.au</a>
&nbsp; · &nbsp;
<a href="https://www.facebook.com/profile.php?id=61593250883842" style="color:#5EEAD4;text-decoration:none;">Facebook</a>
</td></tr></table></td></tr></table></body></html>'''

    clean_body = _plain_md(body_md).strip()
    cta_text = f"\n\n{cta_label}: {cta_url}" if cta_label and cta_url else ""
    text = (
        f"{heading}\n\n"
        + (rendered_greeting + "\n\n" if rendered_greeting else "")
        + founder_text
        + clean_body
        + "\n\n"
        + signature_text
        + cta_text
        + compliance_text
    )
    return subject_override or heading, html, text


async def _campaign_aware_send(*, to: str, subject: str, html: str, text=None,
                               reply_to=None, attachments=None):
    """Use community@ only for the MCGS outreach campaign HTML we generate above."""
    if "<!-- FP_OUTREACH_EMAIL -->" not in (html or ""):
        return await _ORIGINAL_SEND(
            to=to, subject=subject, html=html, text=text,
            reply_to=reply_to, attachments=attachments,
        )

    api_key = os.getenv("RESEND_API_KEY") or None
    resend = getattr(_es, "resend", None)
    if not api_key or resend is None:
        return await _ORIGINAL_SEND(
            to=to, subject=subject, html=html, text=text,
            reply_to=reply_to, attachments=attachments,
        )

    def _send_sync():
        resend.api_key = api_key
        params = {
            "from": "FriendPlace Community Team <community@friendplace.com.au>",
            "to": [to],
            "subject": subject,
            "html": html,
            "reply_to": reply_to or "community@friendplace.com.au",
        }
        if text:
            params["text"] = text
        if attachments:
            params["attachments"] = attachments
        return resend.Emails.send(params)

    try:
        raw = await asyncio.to_thread(_send_sync)
        mid = raw.get("id") if isinstance(raw, dict) else getattr(raw, "id", None)
        if not mid:
            try:
                mid = raw["id"]
            except Exception:
                mid = None
        if not mid:
            return _es.SendResult(ok=False, error="Resend returned no message id", error_code="no_message_id")
        return _es.SendResult(ok=True, message_id=mid, http_status=200)
    except Exception as exc:
        code = getattr(exc, "code", None)
        try:
            http_status = int(code) if code is not None else None
        except Exception:
            http_status = None
        return _es.SendResult(
            ok=False,
            error=getattr(exc, "message", None) or str(exc),
            error_code=getattr(exc, "error_type", None) or exc.__class__.__name__,
            http_status=http_status,
        )


# cms_module imports these lazily, so patching the module object is sufficient.
_es.announcement_template = announcement_template
_es.send_email_detailed = _campaign_aware_send
