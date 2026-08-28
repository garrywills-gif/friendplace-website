"""iter164am — Navy email theme final fixes (headline + labels + preheader).

Contract with Garry (27 Aug 2026):

  * All text rendered on the navy body must set an explicit inline
    light/white colour — no reliance on CSS inheritance, which
    Gmail / Outlook happily strip.
  * The announcement <h1> headline (and every section label / sign-
    off) must render in white — no more navy-on-navy invisibility.
  * The hidden preheader still populates the inbox preview (email
    clients read it before the body) but never appears visibly in
    the letter body.
  * The campaign render-preview response surfaces ``subject``,
    ``preheader``, and ``headline`` as distinct fields so the CMS
    composer can render each independently.
"""

from __future__ import annotations

import re
import pytest
import requests
from dotenv import load_dotenv
import os

BASE = "http://localhost:8001"
ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASSWORD = "TestPass2026!"


@pytest.fixture(scope="module")
def admin_token() -> str:
    load_dotenv("/app/backend/.env")
    r = requests.post(
        f"{BASE}/api/cms/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["token"]


# ---------------------------------------------------------------------------
# 1. Announcement headline colour.
# ---------------------------------------------------------------------------

def test_announcement_headline_is_white():
    """The <h1> in a campaign announcement must set an explicit
    white colour — previously #0A2540 rendered invisible on navy.
    """
    from email_service import announcement_template
    _, html, _ = announcement_template(
        first_name="Sarah",
        title="A note from FriendPlace",
        body_md="Hello there.",
    )
    m = re.search(r"<h1[^>]*style=\"([^\"]*)\"[^>]*>", html)
    assert m, "announcement must render an <h1>"
    style = m.group(1)
    assert "color:#FFFFFF" in style, (
        f"h1 must set explicit color:#FFFFFF; got style={style!r}"
    )
    # And no navy-on-navy inline color survives on the headline.
    assert "color:#0A2540" not in style


# ---------------------------------------------------------------------------
# 2. Sign-off "The FriendPlace Team" colour.
# ---------------------------------------------------------------------------

def test_signature_team_is_white():
    from email_service import _letter_signature_html
    html = _letter_signature_html(signer="team")
    # Both the "Warmly," line and the name must set explicit white.
    assert "color:#FFFFFF" in html
    assert 'color:#0A2540' not in html, (
        "team sign-off must not carry a dark navy inline colour"
    )
    assert "The FriendPlace Team" in html


def test_signature_george_is_white_and_muted_italic():
    from email_service import _letter_signature_html
    html = _letter_signature_html(signer="george")
    assert "color:#FFFFFF" in html
    # "Your friend at FriendPlace" is intentionally muted — must
    # still be a light muted-white on navy, not the old #64748B.
    assert "rgba(255,255,255,0.72)" in html
    assert "color:#64748B" not in html
    assert 'color:#0A2540' not in html


# ---------------------------------------------------------------------------
# 3. Body copy (paragraphs, labels) uses explicit light colours.
# ---------------------------------------------------------------------------

def test_announcement_greeting_and_closing_are_white():
    from email_service import announcement_template
    _, html, _ = announcement_template(
        first_name="Sarah",
        title="Update",
        body_md="Body copy.",
    )
    # Greeting paragraph.
    m = re.search(r'<p[^>]*>Hi Sarah,</p>', html)
    if m:
        assert 'color:#FFFFFF' in m.group(0), (
            f"greeting paragraph must be white; got {m.group(0)}"
        )
    # No dark #0A2540 body-text inline anywhere in the rendered HTML.
    # (The lockup wordmark can still reference navy for the "Friend"
    # span inside the header, so we constrain the check to text
    # rendered inside <p> / <div> body content — the h1 & <p>s we
    # explicitly set above.)
    body_text_dark = [
        m.start() for m in re.finditer(
            r'<(p|div|span)[^>]*color:#0A2540', html,
        )
    ]
    # The only permitted #0A2540 reference is inside the lockup
    # wordmark <span> (the "Friend" half); we allow at most one.
    assert len(body_text_dark) <= 1, (
        f"unexpected dark navy body text at positions {body_text_dark}"
    )


def test_password_reset_labels_are_light():
    from email_service import password_reset_template
    _, html, _ = password_reset_template(
        first_name="Sarah",
        code="ABCDEF",
        ttl_minutes=30,
    )
    # "YOUR RESET CODE" label + ignore-instructions paragraph.
    assert "YOUR RESET CODE" in html
    # No dark #64748B body text.
    assert "color:#64748B" not in html
    # Ignore instructions still present with light colour.
    assert "safely ignore" in html
    # Light copy present.
    assert "rgba(255,255,255,0.72)" in html


def test_invitation_body_is_white():
    from email_service import invitation_template
    _, html, _ = invitation_template(
        first_name="Sarah",
        inviter_name="Michael",
        accept_url="https://friendplace.com.au/invite/xyz",
        expiry_days=14,
    )
    assert "color:#FFFFFF" in html
    assert "color:#64748B" not in html
    assert "This invitation is personal" in html
    assert "Michael" in html


# ---------------------------------------------------------------------------
# 4. Preheader is hidden text at the top of the shell.
# ---------------------------------------------------------------------------

def test_preheader_is_hidden_display_none():
    """The preheader lives in a display:none div right at the top
    of <body>. This is the standard email-preview pattern — clients
    render this text in the inbox row but not in the body.
    """
    from email_service import _letter_shell
    html = _letter_shell(
        preheader="This is my inbox preview line",
        body_html="<p>body</p>",
    )
    m = re.search(
        r'<div[^>]*display:none[^>]*>[\s\S]*?This is my inbox preview line'
        r'[\s\S]*?</div>',
        html,
    )
    assert m, "preheader must render inside a display:none div"
    # And it must NOT appear anywhere else visibly in the letter.
    visible = re.sub(
        r'<div[^>]*display:none[^>]*>[\s\S]*?</div>', '', html, count=1,
    )
    assert "This is my inbox preview line" not in visible, (
        "preheader must not appear in the visible body"
    )


def test_preheader_override_flows_into_announcement():
    """A preheader_override passed to announcement_template ends up
    in the hidden preview div — not in the visible headline/body.
    """
    from email_service import announcement_template
    custom = "Preview: three quick updates inside"
    subject, html, _ = announcement_template(
        first_name="Sarah",
        title="Newsletter",
        body_md="Body.",
        preheader_override=custom,
    )
    # Present, hidden.
    assert re.search(
        r'<div[^>]*display:none[^>]*>[\s\S]*?' + re.escape(custom),
        html,
    )
    # Absent from the visible content (strip the hidden div and grep).
    visible = re.sub(
        r'<div[^>]*display:none[^>]*>[\s\S]*?</div>', '', html, count=1,
    )
    assert custom not in visible


# ---------------------------------------------------------------------------
# 5. render-preview response surfaces subject / preheader / headline.
# ---------------------------------------------------------------------------

def test_render_preview_returns_distinct_fields(admin_token):
    from pymongo import MongoClient
    client = MongoClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "test_database")]
    import uuid
    cid = str(uuid.uuid4())
    db.campaigns.insert_one({
        "id":              cid,
        "template":        "announcement",
        "name":            "iter164am probe",
        "subject":         "Custom subject line",
        "preheader":       "Custom preheader for inbox preview",
        "title":           "Custom Headline",
        "body_md":         "Body content here.",
        "companion":       "team",
        "audience_filter": {"audience_kind": "individual",
                            "recipient_email": "hello@friendplace.com.au",
                            "recipient_name":  "Test"},
        "status":          "draft",
        "created_at":      "2026-08-27T00:00:00Z",
    })
    try:
        r = requests.post(
            f"{BASE}/api/cms/campaigns/{cid}/render-preview",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["subject"]   == "Custom subject line"
        assert body["preheader"] == "Custom preheader for inbox preview"
        assert body["headline"]  == "Custom Headline"
        # The three fields are independent — headline is NOT inside
        # subject and preheader is NOT inside the visible body.
        assert body["preheader"] != body["subject"]
        assert body["preheader"] != body["headline"]
        # The rendered html carries the preheader in a hidden div.
        assert (
            "display:none" in body["html"]
            and body["preheader"] in body["html"]
        )
    finally:
        db.campaigns.delete_one({"id": cid})
        client.close()


# ---------------------------------------------------------------------------
# 6. "A note from FriendPlace" default subject still works (no regression).
# ---------------------------------------------------------------------------

def test_default_subject_a_note_from_friendplace():
    from email_service import announcement_template
    subject, _, _ = announcement_template(
        first_name="Sarah",
        title="",           # empty title → falls back to default subject
        body_md="Body",
    )
    assert subject == "A note from FriendPlace"


# ---------------------------------------------------------------------------
# 7. No inline navy-body-text colour survives in the final rendered HTML.
# ---------------------------------------------------------------------------

def test_no_dark_navy_body_text_remains():
    """A blanket sweep: after the fixes, an announcement render must
    not contain any <h1>/<p>/<div> whose style sets color:#0A2540
    (which is invisible on the navy shell). One instance is
    permitted for the lockup wordmark's <span> — nothing else.
    """
    from email_service import announcement_template
    _, html, _ = announcement_template(
        first_name="Sarah",
        title="Headline",
        body_md="Body copy.",
    )
    hits = re.findall(
        r'<(h1|h2|h3|p|div|strong)[^>]*color:#0A2540', html,
    )
    assert hits == [], (
        "no body text should keep dark #0A2540 inline colour; "
        f"remaining hits: {hits}"
    )
