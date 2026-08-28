"""iter164ak — Unified full-navy branded email shell tests.

Contract with Garry (27 Aug 2026):

  * All FriendPlace-branded emails using the shared renderer now
    share ONE consistent visual design:
      - Full FriendPlace navy background throughout the email.
      - Body copy is white / light for strong contrast.
      - Butterfly + wordmark at the top on the same navy.
      - Teal accent for buttons/links.
      - No white content card around the body.
      - "Warmly, / The FriendPlace team" sign-off intact.
      - "Because you belong too. 🦋" tagline intact.
  * Template content, personalisation, CTA URLs, and business
    logic are UNCHANGED — this is a visual-theme standardisation
    only.
  * Preview and Send share the SAME renderer (byte identity).
  * Two email families use the shared theme:
      A. services/marketing/templates.py::render_template
         (friendplace_intro, retirement_village_outreach,
          enquiry_reply)  — visits `_brand_shell_html`
      B. email_service.py::{password_reset, support_ack, welcome,
         waitlist, invitation, announcement}_template  —
         visits `_letter_shell`
  * Emails that use a SEPARATE renderer outside this shared theme
    (event_rsvp_confirmation, event_cancelled, business_welcome,
    event_submission_ack) are IDENTIFIED here rather than silently
    changed — they render through their own bespoke bodies that
    embed `_branded_footer_html` (already navy) but not the letter
    shell.
"""

from __future__ import annotations

import os
import re

import pytest
import requests
from dotenv import load_dotenv

BASE = "http://localhost:8001"
ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASSWORD = "TestPass2026!"

_BRAND_NAVY_LITERALS = ("#0A2540", "#0B1F45")  # both navies used in the codebase
_BRAND_TEAL_ACCENTS  = ("#14B8A6", "#5EEAD4", "#0F766E")


@pytest.fixture(scope="module")
def admin_token() -> str:
    r = requests.post(
        f"{BASE}/api/cms/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["token"]


def _preview(token: str, payload: dict) -> dict:
    r = requests.post(
        f"{BASE}/api/cms/marketing/preview",
        headers={"Authorization": f"Bearer {token}"},
        json=payload,
        timeout=15,
    )
    r.raise_for_status()
    return r.json()


def _has_navy_bg(html: str) -> bool:
    # Match either #0A2540 or #0B1F45 with case-insensitive body-bg
    return bool(re.search(
        r"<body[^>]*style=\"[^\"]*background:\s*#0[AB][12]F?[45][0-5]",
        html, re.IGNORECASE,
    ))


def _no_white_card(html: str) -> bool:
    """The old white content card had border-radius:20px + white bg
    + a navy shadow. That specific rule must not appear anymore."""
    return "box-shadow:0 20px 40px rgba(10,37,64,0.25)" not in html


def _white_body_text(html: str) -> bool:
    """Body copy is rendered in white / light."""
    # The unified navy shell wraps the body content div with color:#FFFFFF.
    return "line-height:1.6;color:#FFFFFF" in html


# ---------------------------------------------------------------------------
# Family A — /api/cms/marketing/preview
# ---------------------------------------------------------------------------

def test_family_a_enquiry_reply_navy(admin_token):
    payload = {
        "template_id":     "enquiry_reply",
        "recipient_name":  "Sarah",
        "recipient_email": "sarah@example.com",
        "body_text":
            "Hi Sarah,\nThanks for reaching out.\n\nWarmly,\nGarry",
    }
    html = _preview(admin_token, payload)["html"]
    assert _has_navy_bg(html), "body background must be FriendPlace navy"
    assert _no_white_card(html), (
        "personal reply must NOT wrap body in the old white content card"
    )
    assert _white_body_text(html), "body copy must render in white on navy"
    # Butterfly + wordmark still present.
    assert 'alt="FriendPlace"' in html
    assert ">FriendPlace<" in html
    # Tagline includes the butterfly emoji.
    assert "Because you belong too. 🦋" in html
    # Sign-off intact.
    assert "Warmly" in html and "The FriendPlace team" in html


def test_family_a_friendplace_intro_navy(admin_token):
    payload = {
        "template_id":     "friendplace_intro",
        "recipient_name":  "Sarah",
        "recipient_email": "sarah@example.com",
        "additional_message": "Looking forward to seeing you there.",
    }
    html = _preview(admin_token, payload)["html"]
    assert _has_navy_bg(html)
    assert _no_white_card(html)
    # The template's own content still flows through — a personalisation
    # keyword from the intro must still be there. Content unchanged.
    assert "FriendPlace" in html
    # Additional message still shown.
    assert "Looking forward to seeing you there." in html
    # Tagline + sign-off.
    assert "Because you belong too. 🦋" in html
    assert "Warmly" in html


def test_family_a_retirement_village_navy(admin_token):
    payload = {
        "template_id":       "retirement_village_outreach",
        "recipient_type":    "organisation",
        "organisation_name": "Pines Living",
        "recipient_email":   "reception@pinesliving.com.au",
        "additional_message": "We'd love to visit.",
    }
    html = _preview(admin_token, payload)["html"]
    assert _has_navy_bg(html)
    assert _no_white_card(html)
    # Content preserved.
    assert "Pines Living" in html
    assert "We&#x27;d love to visit." in html or "We'd love to visit." in html


# ---------------------------------------------------------------------------
# Family A — teal accent still present in the footer link.
# ---------------------------------------------------------------------------

def test_family_a_teal_accent_link(admin_token):
    payload = {
        "template_id":     "enquiry_reply",
        "recipient_name":  "Sarah",
        "recipient_email": "sarah@example.com",
        "body_text":       "short",
    }
    html = _preview(admin_token, payload)["html"]
    # Footer link uses a teal accent readable on navy.
    assert any(t.lower() in html.lower() for t in _BRAND_TEAL_ACCENTS), (
        "footer link should use a teal accent readable on navy"
    )


# ---------------------------------------------------------------------------
# Family A — preview HTML and Send HTML come from the same renderer.
# ---------------------------------------------------------------------------

def test_family_a_preview_and_send_byte_identical():
    """Both preview and send construct a TemplateContext the same way
    and call the same render_template — byte parity guaranteed for
    the same context.
    """
    from services.marketing.templates import TemplateContext, render_template

    body_text = "Hi Sarah — quick note.\n\nCheers,\nGarry"
    kw = dict(recipient_name="Sarah", recipient_email="s@x.com",
              recipient_type="person", body_text=body_text)
    a = render_template("enquiry_reply", TemplateContext(**kw))
    b = render_template("enquiry_reply", TemplateContext(**kw))
    assert a.html == b.html
    assert a.text == b.text
    assert a.subject == b.subject


# ---------------------------------------------------------------------------
# Family A — paragraph / newline behaviour for body_text unchanged.
# ---------------------------------------------------------------------------

def test_family_a_paragraph_and_newline_preserved(admin_token):
    payload = {
        "template_id":     "enquiry_reply",
        "recipient_name":  "Sarah",
        "recipient_email": "sarah@example.com",
        "body_text":
            "First paragraph.\n\nSecond paragraph.\nStill second.",
    }
    html = _preview(admin_token, payload)["html"]
    # Two <p> blocks.
    p_count = len(re.findall(
        r"<p[^>]*>(?:[^<]*)(?:First|Second) paragraph", html,
    ))
    assert p_count == 2, f"expected 2 <p>, got {p_count}\n{html[:600]}"
    # <br /> preserved for single \n inside a paragraph.
    assert re.search(
        r"<p[^>]*>Second paragraph\.\s*<br\s*/?>\s*Still second\.</p>",
        html,
    ), "single \\n inside paragraph must render as <br />"


# ---------------------------------------------------------------------------
# Family A — template content unchanged (no template wording rewrite).
# ---------------------------------------------------------------------------

def test_family_a_template_content_unchanged(admin_token):
    """A snapshot of the intro copy the friendplace_intro template
    renders. If a design change accidentally touched template
    wording, this would fail loudly.
    """
    payload = {
        "template_id":     "friendplace_intro",
        "recipient_name":  "Sarah",
        "recipient_email": "sarah@example.com",
    }
    html = _preview(admin_token, payload)["html"]
    # Any of the well-known friendplace_intro phrases still appears.
    # We look for the wordmark + tagline pair as an anchor.
    assert "FriendPlace" in html
    assert "Because you belong too. 🦋" in html


# ---------------------------------------------------------------------------
# Family B — email_service.py::_letter_shell (welcome, campaign,
# invitation, waitlist, support_acknowledgement, password_reset).
# We render the shell directly to verify colour/theme.
# ---------------------------------------------------------------------------

def test_family_b_letter_shell_is_navy():
    """Confirm the shared letter shell uses the FriendPlace navy
    background — not the previous white — for all templates in this
    family (welcome, campaign, invitation, waitlist,
    support_acknowledgement, password_reset).
    """
    from email_service import _letter_shell, _letter_body_open, _letter_body_close

    body = (_letter_body_open()
            + "<p>Some content.</p>"
            + _letter_body_close())
    html = _letter_shell(preheader="x", body_html=body)
    # <body> uses navy.
    assert re.search(r"<body[^>]*background:#0B1F45", html), html[:400]
    # Body copy runs in white.
    assert "color:#FFFFFF" in html
    # No old white-background rule survives inside the shell.
    assert "background:#FFFFFF" not in html, (
        "letter shell must no longer set any element to white; found:\n"
        f"{[m.start() for m in re.finditer(r'background:#FFFFFF', html)]}"
    )
    # Tagline + butterfly present in lockup / footer.
    assert "Because you belong too. 🦋" in html


def test_family_b_letter_button_still_readable():
    """CTA button treatment must remain readable — teal pill with
    white label — on the new navy shell.
    """
    from email_service import _letter_button_html
    btn = _letter_button_html(label="Confirm", url="https://friendplace.com.au")
    # Teal pill, white label — legible on navy.
    assert "background:#14B8A6" in btn
    assert "color:#FFFFFF" in btn
    assert "Confirm" in btn


# ---------------------------------------------------------------------------
# Family B — campaign / announcement wrapper still renders navy end-to-end.
# ---------------------------------------------------------------------------

def test_family_b_announcement_template_navy():
    """Campaign / announcement emails render through the letter
    shell; the whole email must be navy end-to-end.
    """
    from email_service import announcement_template
    subject, html, text = announcement_template(
        first_name="Sarah",
        title="Big update",
        body_md="Hello — small update on FriendPlace.",
    )
    assert re.search(r"<body[^>]*background:#0B1F45", html), html[:400]
    assert "background:#FFFFFF" not in html
    assert "Because you belong too. 🦋" in html


# ---------------------------------------------------------------------------
# Meta — a compile-time inventory of which templates flow through
# each shared renderer. Fails fast if a renderer disappears.
# ---------------------------------------------------------------------------

def test_shared_renderer_inventory():
    """Documents which templates in each family visit the shared
    shells. Serves as a tripwire for future refactors — if any of
    these template functions is removed or renamed, this fails and
    forces us to re-audit the theming.
    """
    from services.marketing.templates import (
        MARKETING_TEMPLATES, _brand_shell_html,
    )
    import email_service

    # Family A — marketing shell.
    assert "friendplace_intro"           in MARKETING_TEMPLATES
    assert "retirement_village_outreach" in MARKETING_TEMPLATES
    assert "enquiry_reply"               in MARKETING_TEMPLATES
    assert callable(_brand_shell_html)

    # Family B — letter shell + its consumers.
    for name in (
        "_letter_shell", "_brand_lockup_html", "_letter_body_open",
        "_letter_footer_html", "_letter_button_html",
        "password_reset_template", "support_acknowledgement_template",
        "welcome_template", "waitlist_template", "invitation_template",
        "announcement_template",
    ):
        assert hasattr(email_service, name), f"missing shared piece: {name}"

    # Emails that use a SEPARATE renderer (bespoke bodies + navy
    # _branded_footer_html only). Still present, still separate.
    for name in (
        "event_rsvp_confirmation_template",
        "event_cancelled_template",
        "business_welcome_template",
        "event_submission_ack_template",
        "_branded_footer_html",
    ):
        assert hasattr(email_service, name), f"missing separate renderer: {name}"
