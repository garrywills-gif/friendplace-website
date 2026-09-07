"""iter164be — outreach campaign email shell/footer/sign-off correctness.

Pure render assertions (no network). Confirms the campaign shell for an
organisation-outreach email:
  • renders **bold** markdown as HTML <strong>, not raw asterisks
  • closes with "The FriendPlace Team" + "Because you belong too." directly under it
  • uses the cold-outreach disclaimer, NOT the "you have a FriendPlace account" wording
  • carries exactly ONE recipient-facing disclaimer block (no duplicate)
  • keeps the unsubscribe as a clean <a> link (token only inside href)
and that a transactional/member email is UNCHANGED (keeps the account
disclaimer, gets no outreach footer).
"""

from __future__ import annotations

from email_service import announcement_template


def _outreach():
    return announcement_template(
        first_name="friend", title="Hello", body_md="This is **bold** text.",
        companion="team", cta_label="Visit FriendPlace",
        cta_url="https://www.friendplace.com.au/",
        outreach_unsubscribe_url="https://host/api/public/unsubscribe?token=ABC.DEF",
    )


def test_outreach_shell_bold_signoff_footer_and_link():
    _, html, text = _outreach()
    # bold -> HTML
    assert "<strong>bold</strong>" in html
    assert "**bold**" not in html
    # CTA button
    assert "background:#14B8A6" in html and "Visit FriendPlace" in html
    # sign-off + tagline directly underneath
    assert "The FriendPlace Team</span><br>" in html
    assert "Because you belong too. \U0001f98b</span>" in html
    assert "The FriendPlace Team\nBecause you belong too." in text
    # cold disclaimer present, account wording absent
    assert "publicly listed contact details" in html
    assert "you have a FriendPlace account" not in html
    assert "you have a FriendPlace account" not in text
    # exactly one recipient-facing disclaimer block
    assert html.count("receiving this email") == 1
    # clean unsubscribe link — token only inside href
    assert "unsubscribe here</a>" in html
    assert html.count("token=ABC.DEF") == 1


def test_transactional_shell_unchanged():
    _, html, text = announcement_template(
        first_name="Sam", title="Hi", body_md="Body", companion="george")
    assert "you have a FriendPlace account" in html
    assert "publicly listed contact details" not in html
    assert "unsubscribe here" not in html
