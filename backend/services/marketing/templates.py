"""Marketing email templates (iter159).

A ``MarketingTemplate`` is a small dataclass — id, name, description,
allowed audiences, and the HTML/text/subject builders. Templates
receive a ``TemplateContext`` (recipient name/email + free-form
extras like `additional_message`, `organisation_name`) so callers
can vary the personalisation without any per-caller template
proliferation.

The rendering pipeline is:

  render_template(template_id, ctx)  → RenderedEmail(subject, html, text)

Callers (SendEmail screen, campaign runner, George preview) all use
this single function so the personalisation, greeting, sign-off and
brand shell stay consistent.

Brand rules baked in here:
  • Blue outer background (#0A2540 – deep FriendPlace navy)
  • White content card, 16px radius, generous padding
  • Butterfly + wordmark lockup at top
  • Personalised greeting ("Hi Jane," / "Hello Hillside Retirement
    Village,") — never a generic "Hi there"
  • Sign-off: "Because you belong too."
  • Mobile-responsive at 480px break
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional

from email_service import (
    _load_brand_butterfly_b64,  # reuse the same base64 mark used by transactional emails
)


# ---------------------------------------------------------------------------
# Context passed to every template builder.
# ---------------------------------------------------------------------------

@dataclass
class TemplateContext:
    """Everything a marketing template can personalise on."""

    # Recipient identity
    recipient_name: str = ""            # first name preferred; used in greeting
    recipient_email: str = ""
    recipient_type: str = "person"      # "person" | "organisation"
    organisation_name: str = ""         # populated for organisation sends

    # Ad-hoc body content the sender may add via the Send Email form.
    additional_message: str = ""

    # Optional supplementary metadata
    suburb: str = ""
    subject_override: Optional[str] = None

    # If a flyer is attached, the sender may want to reference it
    # inline in the copy (used by outreach template).
    flyer_name: Optional[str] = None

    def greeting_name(self) -> str:
        """The bit that goes after 'Hi'/'Hello'."""
        if self.recipient_type == "organisation":
            name = self.organisation_name or self.recipient_name
        else:
            name = self.recipient_name
        name = (name or "").strip()
        if not name:
            # Never emit "Hi ," — fall back to a warm-but-anonymous
            # opener so we don't ship a broken personalisation slot.
            return "friend"
        # Person-name greetings use the first token only ("Jane
        # Smith" → "Jane"). Organisation greetings keep the full
        # name.
        if self.recipient_type == "organisation":
            return name
        return name.split()[0]


@dataclass
class RenderedEmail:
    subject: str
    html: str
    text: str


# ---------------------------------------------------------------------------
# Brand shell — the blue outer + white card wrapper every template shares.
# ---------------------------------------------------------------------------

_BRAND_NAVY = "#0A2540"
_BRAND_TEAL = "#0D9488"
_TEXT_DARK = "#0F172A"
_TEXT_MUTED = "#475569"


def _brand_shell_html(*, preheader: str, greeting: str, body_html: str) -> str:
    """Wrap a template's body in the shared FriendPlace shell.

    ``body_html`` is the middle content only — the shell adds the
    lockup, the "Hi X," greeting, the sign-off, and the footer.
    """
    try:
        mark_b64 = _load_brand_butterfly_b64()
    except Exception:
        mark_b64 = ""

    mark_img = (
        f'<img src="data:image/png;base64,{mark_b64}" alt="FriendPlace" '
        f'width="52" height="52" style="display:block;border:0;outline:none;text-decoration:none;" />'
        if mark_b64 else ""
    )

    # NOTE: table-based layout for max email-client compatibility
    # (Gmail iOS mangles flexbox). Inline styles everywhere — some
    # clients strip <style> blocks. Kept intentionally small.
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light only" />
  <title>FriendPlace</title>
</head>
<body style="margin:0;padding:0;background:{_BRAND_NAVY};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <span style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">{_html_escape(preheader)}</span>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:{_BRAND_NAVY};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;">
          <tr>
            <td align="center" style="padding-bottom:20px;">
              {mark_img}
              <div style="margin-top:10px;color:#FFFFFF;font-weight:800;font-size:20px;letter-spacing:0.02em;">FriendPlace</div>
              <div style="margin-top:2px;color:rgba(255,255,255,0.75);font-size:12px;letter-spacing:0.14em;text-transform:uppercase;">Because you belong too.</div>
            </td>
          </tr>
          <tr>
            <td style="background:#FFFFFF;border-radius:20px;padding:28px 28px 24px;box-shadow:0 20px 40px rgba(10,37,64,0.25);">
              <div style="font-size:18px;font-weight:700;color:{_TEXT_DARK};margin-bottom:16px;">
                {_html_escape(greeting)}
              </div>
              <div style="font-size:15px;line-height:1.6;color:{_TEXT_DARK};">
                {body_html}
              </div>
              <div style="margin-top:24px;padding-top:16px;border-top:1px solid #E2E8F0;font-size:14px;color:{_TEXT_MUTED};line-height:1.55;">
                Warmly,<br />
                <strong style="color:{_TEXT_DARK};">The FriendPlace team</strong>
              </div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:20px 8px 12px;color:rgba(255,255,255,0.75);font-size:12px;line-height:1.55;">
              FriendPlace is a friendship platform for older Australians.<br />
              <a href="https://friendplace.com.au" style="color:#8ED0F0;text-decoration:none;">friendplace.com.au</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def _brand_shell_text(*, greeting: str, body_text: str) -> str:
    return (
        f"{greeting}\n\n"
        f"{body_text.strip()}\n\n"
        f"Warmly,\n"
        f"The FriendPlace team\n\n"
        f"— Because you belong too.\n"
        f"https://friendplace.com.au\n"
    )


def _html_escape(s: str) -> str:
    return (
        s.replace("&", "&amp;")
         .replace("<", "&lt;")
         .replace(">", "&gt;")
         .replace('"', "&quot;")
    )


def _paragraph_html(text: str) -> str:
    """Turn plain-text paragraphs into HTML — escape, then wrap each
    non-empty run of lines in a <p> block. Blank lines separate
    paragraphs."""
    if not text:
        return ""
    escaped = _html_escape(text.strip())
    # Preserve intentional single line-breaks within a paragraph.
    parts = [p.strip() for p in escaped.split("\n\n") if p.strip()]
    return "".join(f'<p style="margin:0 0 12px;">{p.replace(chr(10), "<br />")}</p>' for p in parts)


# ---------------------------------------------------------------------------
# Template registry
# ---------------------------------------------------------------------------

@dataclass
class MarketingTemplate:
    id: str
    name: str
    description: str
    audience: str          # "person" | "organisation" | "any"
    build_subject: Callable[[TemplateContext], str]
    build_body_html: Callable[[TemplateContext], str]
    build_body_text: Callable[[TemplateContext], str]
    default_greeting_prefix: str = "Hi"       # "Hi" for persons, "Hello" often for organisations
    supports_flyer: bool = True


def _greeting(ctx: TemplateContext, prefix: str) -> str:
    return f"{prefix} {ctx.greeting_name()},"


# ------- Template: friendplace_intro ---------------------------------------

def _intro_subject(ctx: TemplateContext) -> str:
    return ctx.subject_override or "Hello from FriendPlace"


def _intro_body_html(ctx: TemplateContext) -> str:
    lead_html = (
        '<p style="margin:0 0 12px;">Thanks for being part of the FriendPlace story. '
        "We're building a friendly place for older Australians to meet, "
        "catch up and belong \u2014 online and in person.</p>"
    )
    flyer_note = ""
    if ctx.flyer_name:
        flyer_note = (
            f'<p style="margin:0 0 12px;">I\'ve attached '
            f'<strong>{_html_escape(ctx.flyer_name)}</strong> '
            "to this email so you can share it with anyone who might enjoy it.</p>"
        )
    extra = _paragraph_html(ctx.additional_message)
    cta = (
        '<p style="margin:16px 0 0;">'
        '<a href="https://friendplace.com.au" '
        f'style="display:inline-block;background:{_BRAND_TEAL};color:#FFFFFF;text-decoration:none;'
        'font-weight:700;font-size:15px;padding:12px 20px;border-radius:10px;">'
        'Visit FriendPlace</a>'
        '</p>'
    )
    return lead_html + flyer_note + extra + cta


def _intro_body_text(ctx: TemplateContext) -> str:
    lines = [
        "Thanks for being part of the FriendPlace story.",
        "We're building a friendly place for older Australians to meet,",
        "catch up and belong — online and in person.",
    ]
    if ctx.flyer_name:
        lines += ["", f"I've attached {ctx.flyer_name} to this email so you can share it."]
    if ctx.additional_message:
        lines += ["", ctx.additional_message.strip()]
    lines += ["", "Visit FriendPlace: https://friendplace.com.au"]
    return "\n".join(lines)


# ------- Template: retirement_village_outreach (P1 template shipped in P0)

def _rv_subject(ctx: TemplateContext) -> str:
    if ctx.subject_override:
        return ctx.subject_override
    if ctx.organisation_name:
        return f"A quick note for {ctx.organisation_name} residents"
    return "A quick note for your residents"


def _rv_body_html(ctx: TemplateContext) -> str:
    who = _html_escape(ctx.organisation_name or "your community")
    intro = (
        f'<p style="margin:0 0 12px;">I hope this note finds you well. I lead a small team building '
        '<strong>FriendPlace</strong> \u2014 a friendship platform for older '
        'Australians. It helps neighbours find each other, meet up for coffee, '
        'and stay socially connected.</p>'
    )
    why = (
        f'<p style="margin:0 0 12px;">We think it might be genuinely useful for residents of '
        f'<strong>{who}</strong>. Loneliness is real; a warm and simple app has been '
        "welcomed everywhere we've shown it.</p>"
    )
    flyer_ask = ""
    if ctx.flyer_name:
        flyer_ask = (
            f'<p style="margin:0 0 12px;">I\'ve attached a one-page flyer '
            f'(<strong>{_html_escape(ctx.flyer_name)}</strong>) with the basics. '
            "If you feel it's a fit, we'd be so grateful if you could put it up on "
            "the community noticeboard, share it in a newsletter, or pass it along to "
            "any residents you think might enjoy it. No pressure whatsoever \u2014 "
            "we know your residents' inboxes and noticeboards are precious.</p>"
        )
    else:
        flyer_ask = (
            '<p style="margin:0 0 12px;">If you\'d like a printable flyer we can send you '
            "one that fits an A4 noticeboard \u2014 just reply and we'll pop it over.</p>"
        )
    extra = _paragraph_html(ctx.additional_message)
    close = (
        '<p style="margin:16px 0 0;">Happy to answer any questions, or to visit in person if '
        "that's easier. Thank you for what you do for your residents \u2014 "
        "we'd love to be a small part of it.</p>"
    )
    return intro + why + flyer_ask + extra + close


def _rv_body_text(ctx: TemplateContext) -> str:
    who = ctx.organisation_name or "your community"
    lines = [
        "I hope this note finds you well. I lead a small team building FriendPlace",
        "— a friendship platform for older Australians. It helps neighbours find",
        "each other, meet up for coffee, and stay socially connected.",
        "",
        f"We think it might be genuinely useful for residents of {who}.",
        "Loneliness is real; a warm and simple app has been welcomed everywhere",
        "we've shown it.",
        "",
    ]
    if ctx.flyer_name:
        lines += [
            f"I've attached a one-page flyer ({ctx.flyer_name}) with the basics.",
            "If you feel it's a fit, we'd be so grateful if you could put it up on",
            "the community noticeboard, share it in a newsletter, or pass it along to",
            "any residents you think might enjoy it. No pressure whatsoever —",
            "we know your residents' inboxes and noticeboards are precious.",
        ]
    else:
        lines += [
            "If you'd like a printable flyer we can send you one that fits an A4",
            "noticeboard — just reply and we'll pop it over.",
        ]
    if ctx.additional_message:
        lines += ["", ctx.additional_message.strip()]
    lines += [
        "",
        "Happy to answer any questions, or to visit in person if that's easier.",
        "Thank you for what you do for your residents — we'd love to be a small",
        "part of it.",
    ]
    return "\n".join(lines)


# ------- Registry ---------------------------------------------------------

# ---- Template: enquiry_reply (iter160a) -----------------------------------
# One-off personal reply to somebody who contacted us via the website
# enquiry forms. Deliberately plain and warm - NO Founding Member
# number/badge, NO founding-member-specific copy - because this template
# is used for members of the public who may or may not be founders.

def _reply_subject(ctx: TemplateContext) -> str:
    if ctx.subject_override:
        return ctx.subject_override
    return "Thanks for getting in touch"


def _reply_body_html(ctx: TemplateContext) -> str:
    intro = (
        '<p style="margin:0 0 12px;">Thanks so much for reaching out. '
        'I wanted to reply personally rather than send a template.</p>'
    )
    extra = _paragraph_html(ctx.additional_message)
    if not extra:
        extra = ('<p style="margin:0 0 12px;">'
                 "Feel free to reply straight back to this email - it comes through to me directly."
                 '</p>')
    close = (
        '<p style="margin:12px 0 0;">Warm wishes,</p>'
    )
    return intro + extra + close


def _reply_body_text(ctx: TemplateContext) -> str:
    lines = ["Thanks so much for reaching out. I wanted to reply personally rather than send a template.", ""]
    if ctx.additional_message:
        lines += [ctx.additional_message.strip(), ""]
    else:
        lines += ["Feel free to reply straight back to this email - it comes through to me directly.", ""]
    lines += ["Warm wishes,"]
    return "\n".join(lines)


MARKETING_TEMPLATES: Dict[str, MarketingTemplate] = {
    "friendplace_intro": MarketingTemplate(
        id="friendplace_intro",
        name="FriendPlace \u2014 Blue Branded",
        description="The default FriendPlace-branded email. Personalised greeting, "
                    "friendly intro, optional flyer attachment, teal CTA button.",
        audience="any",
        build_subject=_intro_subject,
        build_body_html=_intro_body_html,
        build_body_text=_intro_body_text,
        default_greeting_prefix="Hi",
    ),
    "retirement_village_outreach": MarketingTemplate(
        id="retirement_village_outreach",
        name="Retirement Village Outreach",
        description="For emailing retirement villages, community centres, libraries and "
                    "similar organisations. Explains FriendPlace, asks if they'll share "
                    "the attached flyer with residents \u2014 no pressure wording.",
        audience="organisation",
        build_subject=_rv_subject,
        build_body_html=_rv_body_html,
        build_body_text=_rv_body_text,
        default_greeting_prefix="Hello",
    ),
    "enquiry_reply": MarketingTemplate(
        id="enquiry_reply",
        name="Enquiry Reply (personal)",
        description="A warm personal reply to somebody who contacted us via the website. "
                    "No Founding Member number/badge - suitable for the general public. "
                    "Attach a flyer only if it fits their question.",
        audience="any",
        build_subject=_reply_subject,
        build_body_html=_reply_body_html,
        build_body_text=_reply_body_text,
        default_greeting_prefix="Hi",
        supports_flyer=True,
    ),
}


def list_templates(audience: Optional[str] = None) -> List[Dict]:
    """Return template metadata for the picker UI."""
    out: List[Dict] = []
    for t in MARKETING_TEMPLATES.values():
        if audience and t.audience not in (audience, "any"):
            continue
        out.append({
            "id":                       t.id,
            "name":                     t.name,
            "description":              t.description,
            "audience":                 t.audience,
            "supports_flyer":           t.supports_flyer,
            "default_greeting_prefix":  t.default_greeting_prefix,
        })
    return out


def render_template(template_id: str, ctx: TemplateContext) -> RenderedEmail:
    """Render a template with the given context.

    Raises ValueError if template_id is unknown.
    """
    tpl = MARKETING_TEMPLATES.get(template_id)
    if not tpl:
        raise ValueError(f"Unknown marketing template: {template_id}")

    subject = tpl.build_subject(ctx)
    greeting = _greeting(ctx, tpl.default_greeting_prefix)
    body_html = tpl.build_body_html(ctx)
    body_text = tpl.build_body_text(ctx)

    shell_html = _brand_shell_html(
        preheader=subject,
        greeting=greeting,
        body_html=body_html,
    )
    shell_text = _brand_shell_text(
        greeting=greeting,
        body_text=body_text,
    )
    return RenderedEmail(subject=subject, html=shell_html, text=shell_text)


__all__ = [
    "TemplateContext",
    "RenderedEmail",
    "MarketingTemplate",
    "MARKETING_TEMPLATES",
    "list_templates",
    "render_template",
]
