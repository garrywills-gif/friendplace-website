"""iter164aq — Shared CTA button system + Facebook footer link.

Two related email improvements:

1. Facebook link in every shared branded footer (marketing shell,
   transactional letter footer, branded footer) — clickable in HTML and
   present as a URL in the plain-text version.

2. A single reusable CTA capability (email_service.resolve_cta +
   CTA_PRESETS + _letter_button_html) wired into the marketing render
   pipeline so enquiry replies, outreach and individual sends can all
   attach an optional teal button with a plain-text URL fallback,
   without hardcoding CTA HTML per template.

CTA choices (the contract George's Mission Control UI sends):
    none | visit | register | get_app | custom
Presets:
    visit    -> Visit FriendPlace      https://friendplace.com.au
    register -> Register your interest  https://www.friendplace.com.au/register-interest
    get_app  -> Get the app             https://friendplace.com.au/#download
    custom   -> caller-supplied cta_label + cta_url

Payload fields accepted by /api/cms/marketing/preview and
/api/cms/marketing/send: cta_choice, cta_label, cta_url (all optional).
"""

from __future__ import annotations

import pytest

from email_service import (
    resolve_cta,
    CTA_PRESETS,
    FACEBOOK_URL,
    _letter_footer_html,
    _letter_footer_text,
    _branded_footer_html,
    _branded_footer_text,
)
from services.marketing.templates import TemplateContext, render_template

FB_ID = "61593250883842"
BUTTON_MARKER = "padding:14px 34px"   # the teal pill button signature


# ---------------------------------------------------------------------------
# 1. resolve_cta contract.
# ---------------------------------------------------------------------------

def test_resolve_cta_contract():
    assert resolve_cta("none") is None
    assert resolve_cta("no_button") is None
    assert resolve_cta("") is None
    assert resolve_cta("visit") == ("Visit FriendPlace", "https://friendplace.com.au")
    assert resolve_cta("register") == ("Register your interest",
                                        "https://www.friendplace.com.au/register-interest")
    assert resolve_cta("get_app") == ("Get the app", "https://friendplace.com.au/#download")
    # Custom needs BOTH label and url.
    assert resolve_cta("custom", "Book", "https://x.com") == ("Book", "https://x.com")
    assert resolve_cta("custom", "Book", "") is None
    assert resolve_cta("custom", "", "https://x.com") is None
    # Back-compat: no choice but explicit pair (how campaigns already send).
    assert resolve_cta(None, "Lbl", "https://u.com") == ("Lbl", "https://u.com")
    assert resolve_cta() is None
    # Presets dict has exactly the three named presets.
    assert set(CTA_PRESETS) == {"visit", "register", "get_app"}


# ---------------------------------------------------------------------------
# 2. Enquiry reply — no CTA renders no button but keeps the body + footer.
# ---------------------------------------------------------------------------

def test_enquiry_reply_no_cta():
    r = render_template("enquiry_reply", TemplateContext(
        recipient_name="Jane",
        body_text="Thanks for reaching out. Here is my personal reply.",
        cta_choice="none",
    ))
    assert BUTTON_MARKER not in r.html, "no-CTA must not render a button"
    assert "Here is my personal reply." in r.html
    # Facebook footer still present.
    assert FB_ID in r.html and FB_ID in r.text


# ---------------------------------------------------------------------------
# 3. Enquiry reply — each preset renders button (html) + url (text).
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("choice,label,url", [
    ("visit",    "Visit FriendPlace",      "https://friendplace.com.au"),
    ("register", "Register your interest", "https://www.friendplace.com.au/register-interest"),
    ("get_app",  "Get the app",            "https://friendplace.com.au/#download"),
])
def test_enquiry_reply_presets(choice, label, url):
    r = render_template("enquiry_reply", TemplateContext(
        recipient_name="Jane", body_text="Hello!", cta_choice=choice,
    ))
    assert BUTTON_MARKER in r.html
    assert label in r.html and url in r.html
    assert f"{label}: {url}" in r.text, "plain-text URL fallback missing"


# ---------------------------------------------------------------------------
# 4. Enquiry reply — custom CTA.
# ---------------------------------------------------------------------------

def test_enquiry_reply_custom_cta():
    r = render_template("enquiry_reply", TemplateContext(
        recipient_name="Jane", body_text="Hi",
        cta_choice="custom", cta_label="Book a chat", cta_url="https://cal.example/fp",
    ))
    assert BUTTON_MARKER in r.html
    assert "Book a chat" in r.html and "https://cal.example/fp" in r.html
    assert "Book a chat: https://cal.example/fp" in r.text


# ---------------------------------------------------------------------------
# 5. Same shared capability works on outreach + intro templates.
# ---------------------------------------------------------------------------

def test_outreach_template_supports_cta():
    r = render_template("retirement_village_outreach", TemplateContext(
        recipient_type="organisation", organisation_name="Hillside Village",
        cta_choice="visit",
    ))
    assert BUTTON_MARKER in r.html
    assert "Visit FriendPlace" in r.html
    assert "Visit FriendPlace: https://friendplace.com.au" in r.text
    assert FB_ID in r.html   # facebook footer on outreach too


# ---------------------------------------------------------------------------
# 6. Facebook link present in ALL shared footers (html clickable + text url).
# ---------------------------------------------------------------------------

def test_facebook_in_all_footers():
    assert FACEBOOK_URL == "https://www.facebook.com/profile.php?id=61593250883842"
    for html in (_letter_footer_html(), _branded_footer_html()):
        assert FACEBOOK_URL in html, "Facebook href missing from a footer"
        assert 'href="' + FACEBOOK_URL in html, "Facebook link not clickable"
    for text in (_letter_footer_text(), _branded_footer_text()):
        assert FACEBOOK_URL in text, "Facebook URL missing from a plain-text footer"


# ---------------------------------------------------------------------------
# 7. Marketing shell (enquiry) footer carries the Facebook link too.
# ---------------------------------------------------------------------------

def test_marketing_shell_footer_facebook():
    r = render_template("enquiry_reply", TemplateContext(
        recipient_name="Jane", body_text="Hi",
    ))
    assert 'href="' + FACEBOOK_URL in r.html
    assert FACEBOOK_URL in r.text
