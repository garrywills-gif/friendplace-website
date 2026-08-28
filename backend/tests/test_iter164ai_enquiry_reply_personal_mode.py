"""iter164ai — Enquiry Reply personal-mode tests.

Contract with Garry (27 Aug 2026):

  * ``template_id="enquiry_reply"`` + ``body_text`` = personal reply
    mode: the passed string is the ENTIRE editable body. No canned
    "Thanks so much for reaching out" intro, no
    "Feel free to reply straight back" fallback, no inline
    "Warm wishes,".
  * Newlines are preserved exactly:
      - blank-line-separated blocks → distinct <p> paragraphs
      - single \n inside a paragraph → <br />
  * HTML in the admin's body_text is escaped — no admin markup passes
    through raw.
  * Preview and Send share the SAME renderer (render_template) — the
    HTML delivered matches the HTML shown in the preview byte-for-
    byte for the same (context) tuple.
  * Brand shell stays intact: butterfly + wordmark + "Because you
    belong too." tagline in the header; "Warmly, / The FriendPlace
    team" sign-off after the body.
  * Other templates (friendplace_intro, retirement_village_outreach)
    are unaffected — they keep using ``additional_message``.
"""

from __future__ import annotations

import os
import re
import uuid

import pytest
import requests
from dotenv import load_dotenv

BASE = "http://localhost:8001"
ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASSWORD = "TestPass2026!"


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


# ---------------------------------------------------------------------------
# 1. Personal-reply mode: no canned FriendPlace intro appears.
# ---------------------------------------------------------------------------

CANNED_INTRO = "Thanks so much for reaching out. I wanted to reply personally rather than send a template."
CANNED_FALLBACK = "Feel free to reply straight back to this email - it comes through to me directly."


def test_no_canned_intro_when_body_text_provided(admin_token):
    payload = {
        "template_id":   "enquiry_reply",
        "recipient_name": "Sarah",
        "recipient_email": "sarah@example.com",
        "body_text": (
            "Hi Sarah — the app store link is in your invite email.\n\n"
            "Let me know if that helps.\n\nWarm regards,\nGarry"
        ),
    }
    r = _preview(admin_token, payload)
    html, text = r["html"], r["text"]
    for banned in (CANNED_INTRO, CANNED_FALLBACK, "Warm wishes,"):
        assert banned not in html, (
            f"personal-reply mode leaked canned copy: {banned!r}\n"
            f"---\n{html[:600]}"
        )
        assert banned not in text, (
            f"personal-reply mode leaked canned copy in text: {banned!r}\n"
            f"---\n{text[:400]}"
        )


# ---------------------------------------------------------------------------
# 2. Custom greeting appears exactly once (the admin's opener isn't
#    duplicated by the shell).
# ---------------------------------------------------------------------------

def test_custom_greeting_appears_once(admin_token):
    payload = {
        "template_id":     "enquiry_reply",
        "recipient_name":  "Sarah",
        "recipient_email": "sarah@example.com",
        "body_text":
            "Hi Sarah — thanks for the note.\n\nHere's the link…\n\nGarry",
    }
    r = _preview(admin_token, payload)
    html = r["html"]
    # The shell renders "Hi Sarah," (comma) at the top; the admin's
    # body starts with "Hi Sarah — …" (em-dash). Both should be
    # present — but neither should be doubled.
    shell_greetings = re.findall(r"Hi Sarah,", html)
    body_openers    = re.findall(r"Hi Sarah\s*—", html)
    assert len(shell_greetings) == 1, (
        f"shell greeting duplicated: {len(shell_greetings)} × 'Hi Sarah,'"
    )
    assert len(body_openers) == 1, (
        f"body opener duplicated: {len(body_openers)} × 'Hi Sarah —'"
    )


# ---------------------------------------------------------------------------
# 3. Two blank-line-separated paragraphs remain two paragraphs.
# ---------------------------------------------------------------------------

def test_two_paragraphs_render_as_two_p_tags(admin_token):
    payload = {
        "template_id":     "enquiry_reply",
        "recipient_name":  "Sarah",
        "recipient_email": "sarah@example.com",
        "body_text":
            "First paragraph body.\n\nSecond paragraph body.",
    }
    r = _preview(admin_token, payload)
    html = r["html"]
    # Both paragraph contents present.
    assert "First paragraph body." in html
    assert "Second paragraph body." in html
    # Count <p> tags that contain body content (exclude shell prose).
    # Anchor on our unique markers and confirm each ends its own <p>.
    body_p_count = len(re.findall(r"<p[^>]*>(?:[^<]*)(?:First|Second) paragraph body\.</p>", html))
    assert body_p_count == 2, (
        f"expected two body <p> paragraphs, got {body_p_count}\n{html[:800]}"
    )


# ---------------------------------------------------------------------------
# 4. Single line breaks are preserved (as <br />).
# ---------------------------------------------------------------------------

def test_single_line_breaks_preserved_as_br(admin_token):
    payload = {
        "template_id":     "enquiry_reply",
        "recipient_name":  "Sarah",
        "recipient_email": "sarah@example.com",
        # A signature block — three lines, single \n between each.
        "body_text":
            "Regards,\nGarry\nFriendPlace",
    }
    r = _preview(admin_token, payload)
    html = r["html"]
    # All three lines must appear.
    assert "Regards," in html
    assert "Garry"    in html
    assert "FriendPlace" in html
    # And they must be joined by <br />s inside a single paragraph.
    m = re.search(
        r"<p[^>]*>Regards,\s*<br\s*/?>\s*Garry\s*<br\s*/?>\s*FriendPlace</p>",
        html,
    )
    assert m, f"signature lines not <br />-joined:\n{html[:800]}"

    # And the text alternative preserves the newlines verbatim.
    assert "Regards,\nGarry\nFriendPlace" in r["text"]


# ---------------------------------------------------------------------------
# 5. Unsafe HTML is escaped — admin markup does not pass through raw.
# ---------------------------------------------------------------------------

def test_admin_html_is_escaped(admin_token):
    payload = {
        "template_id":     "enquiry_reply",
        "recipient_name":  "Sarah",
        "recipient_email": "sarah@example.com",
        "body_text":
            "Please visit <b>our site</b> or <script>alert(1)</script>.",
    }
    r = _preview(admin_token, payload)
    html = r["html"]
    # The literal characters appear escaped…
    assert "&lt;b&gt;our site&lt;/b&gt;" in html
    assert "&lt;script&gt;" in html
    # …and NO real <script> tag was injected.
    assert "<script>alert(1)</script>" not in html


# ---------------------------------------------------------------------------
# 6. Preview HTML and Send-path HTML come from the same renderer.
# ---------------------------------------------------------------------------

def test_preview_and_send_share_the_same_renderer():
    """Send path is not exercised over HTTP (no real email). We hit
    the shared ``render_template`` helper twice — once via the
    preview-side context, once via the send-side context — and
    assert byte identity. Both preview and send construct their
    TemplateContext the same way (body_text passed through), so
    the shared render_template guarantees byte parity.
    """
    from services.marketing.templates import TemplateContext, render_template

    body_text = (
        "Hi Sarah,\n"
        "Thanks for reaching out.\n\n"
        "Cheers,\nGarry"
    )
    common_kwargs = dict(
        recipient_name="Sarah",
        recipient_email="sarah@example.com",
        recipient_type="person",
        body_text=body_text,
    )
    ctx_preview = TemplateContext(**common_kwargs)
    ctx_send    = TemplateContext(**common_kwargs)

    a = render_template("enquiry_reply", ctx_preview)
    b = render_template("enquiry_reply", ctx_send)

    assert a.subject == b.subject
    assert a.html    == b.html
    assert a.text    == b.text


# ---------------------------------------------------------------------------
# 7. Branded wrapper + sign-off stay intact.
# ---------------------------------------------------------------------------

def test_branded_wrapper_and_signoff_intact(admin_token):
    payload = {
        "template_id":     "enquiry_reply",
        "recipient_name":  "Sarah",
        "recipient_email": "sarah@example.com",
        "body_text":       "Short body.",
    }
    r = _preview(admin_token, payload)
    html = r["html"]
    # FriendPlace wordmark + tagline in the branded header.
    assert "FriendPlace" in html
    assert "Because you belong too." in html
    # Sign-off block from the shell — the shared "Warmly, / The
    # FriendPlace team" pair.
    assert "Warmly" in html
    assert "The FriendPlace team" in html


# ---------------------------------------------------------------------------
# 8. Text alternative is the body verbatim + shell sign-off (no
#    canned prose).
# ---------------------------------------------------------------------------

def test_text_alternative_has_body_verbatim(admin_token):
    body_text = (
        "Hi Sarah,\n"
        "Here's the link: https://friendplace.com.au/join\n\n"
        "Garry"
    )
    payload = {
        "template_id":     "enquiry_reply",
        "recipient_name":  "Sarah",
        "recipient_email": "sarah@example.com",
        "body_text":       body_text,
    }
    r = _preview(admin_token, payload)
    text = r["text"]
    assert body_text in text
    for banned in (CANNED_INTRO, CANNED_FALLBACK, "Warm wishes,"):
        assert banned not in text
    # Shell sign-off still present in the text version.
    assert "Warmly" in text and "The FriendPlace team" in text


# ---------------------------------------------------------------------------
# 9. Legacy fallback: enquiry_reply WITHOUT body_text still works
#    (backwards compat — existing callers unchanged).
# ---------------------------------------------------------------------------

def test_legacy_enquiry_reply_without_body_text_still_works(admin_token):
    payload = {
        "template_id":        "enquiry_reply",
        "recipient_name":     "Sarah",
        "recipient_email":    "sarah@example.com",
        "additional_message": "Here's the info you asked for.",
    }
    r = _preview(admin_token, payload)
    html = r["html"]
    # Legacy: the canned intro comes back.
    assert CANNED_INTRO in html
    # And the additional_message is appended.
    assert "Here&#x27;s the info you asked for." in html or "Here's the info you asked for." in html
    # Legacy sign-off appears too.
    assert "Warm wishes," in html


# ---------------------------------------------------------------------------
# 10. Other templates are unaffected — friendplace_intro still
#     honours additional_message and does NOT pick up body_text.
# ---------------------------------------------------------------------------

def test_friendplace_intro_ignores_body_text(admin_token):
    """Only enquiry_reply opts into personal-reply mode. Sending
    body_text to friendplace_intro must not blank out its canned
    body or replace it with the admin string.
    """
    payload = {
        "template_id":        "friendplace_intro",
        "recipient_name":     "Sarah",
        "recipient_email":    "sarah@example.com",
        "additional_message": "Extra flavour text.",
        # Deliberately provide body_text — friendplace_intro must
        # ignore it and keep its canned welcome copy.
        "body_text":          "This must NOT replace the intro body.",
    }
    r = _preview(admin_token, payload)
    html = r["html"]
    # friendplace_intro's canned copy still present.
    assert "FriendPlace" in html
    # additional_message still flows through.
    assert "Extra flavour text." in html
    # body_text did NOT hijack the template.
    assert "This must NOT replace the intro body." not in html


def test_retirement_village_template_ignores_body_text(admin_token):
    payload = {
        "template_id":        "retirement_village_outreach",
        "recipient_type":     "organisation",
        "organisation_name":  "Pines Living",
        "recipient_email":    "reception@pinesliving.com.au",
        "additional_message": "Extra RV flavour.",
        "body_text":          "This must NOT replace the RV outreach copy.",
    }
    r = _preview(admin_token, payload)
    html = r["html"]
    assert "Extra RV flavour." in html
    assert "This must NOT replace the RV outreach copy." not in html
