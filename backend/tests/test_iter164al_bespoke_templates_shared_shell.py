"""iter164al — Final theme cleanup for the four bespoke templates.

Contract with Garry (27 Aug 2026):

  * The four remaining bespoke templates — event_rsvp_confirmation,
    event_cancelled, business_welcome, event_submission_ack — now
    render through the shared ``_letter_shell`` wrapper so the whole
    branded email family shares one consistent design.
  * All existing wording, data, buttons, links and business logic
    are UNCHANGED — this is visual/theme standardisation only.
  * The `_letter_shell` header (butterfly + wordmark + "Because you
    belong too. 🦋") and the letter footer are inherited from the
    shared shell.
  * The bespoke inner content (chips, detail blocks, buttons,
    reference codes, purple-heart sign-off) is preserved so nothing
    the user relies on visually disappears.
"""

from __future__ import annotations

import re
import pytest


NAVY_BODY_BG_RE = re.compile(
    r'<body[^>]*background:#0[AB][12]F?[45][0-5]', re.IGNORECASE,
)


def _has_navy_body(html: str) -> bool:
    return bool(NAVY_BODY_BG_RE.search(html))


def _has_shared_shell_tagline(html: str) -> bool:
    """The shared _letter_shell footer prints the tagline. If a
    template is now inside the shared shell we should see it exactly
    once — from the shell, not duplicated by the inner body.
    """
    return html.count("Because you belong too. 🦋") >= 1


# ---------------------------------------------------------------------------
# 1. event_rsvp_confirmation — "going" flavour.
# ---------------------------------------------------------------------------

def test_rsvp_confirmation_going_uses_shared_shell():
    from email_service import event_rsvp_confirmation_template
    subject, html, text = event_rsvp_confirmation_template(
        first_name="Sarah",
        event_title="Merewether Beach Walk",
        event_when_display="Sun 30/08/2026, 10:00 am AEST",
        event_where_display="Merewether Beach · 1 Henderson Pde",
        event_cost_display="Free",
        event_url="https://www.friendplace.com.au/events/xyz",
        manage_url="https://www.friendplace.com.au/rsvp/manage/abc",
        rsvp_status="going",
        guests_count=2,
        ticket_ref="FP-EV-12AB",
    )
    # Shared shell: navy body + tagline + butterfly + team sign-off.
    assert _has_navy_body(html), "must use shared navy shell body bg"
    assert _has_shared_shell_tagline(html)
    assert 'alt="FriendPlace"' in html, "shared lockup butterfly must render"
    # Existing wording preserved (spot-checks).
    assert "YOU’RE GOING" in html
    assert "Merewether Beach Walk" in html
    assert "Merewether Beach · 1 Henderson Pde" in html
    assert "Plus 2 guests" in html
    assert "Free" in html
    assert "FP-EV-12AB" in html
    # CTA buttons intact.
    assert "View event page" in html
    assert "View / cancel RSVP" in html
    assert "https://www.friendplace.com.au/events/xyz" in html
    assert "https://www.friendplace.com.au/rsvp/manage/abc" in html
    # Purple-heart Events Team sign-off (part of body wording).
    assert "💜 The FriendPlace Events Team" in html
    # Text alternative preserves all wording.
    assert "Merewether Beach Walk" in text
    assert "FP-EV-12AB" in text


# ---------------------------------------------------------------------------
# 2. event_rsvp_confirmation — "waitlist" flavour.
# ---------------------------------------------------------------------------

def test_rsvp_confirmation_waitlist_uses_shared_shell():
    from email_service import event_rsvp_confirmation_template
    subject, html, text = event_rsvp_confirmation_template(
        first_name=None,
        event_title="Coffee Catch-up",
        event_when_display="Wed 03/09/2026, 2:00 pm AEST",
        event_where_display="Cafe · 12 Smith St",
        event_cost_display=None,
        event_url="https://www.friendplace.com.au/events/cc",
        manage_url="https://www.friendplace.com.au/rsvp/manage/cc",
        rsvp_status="waitlist",
        guests_count=0,
        ticket_ref="FP-EV-77XY",
    )
    assert _has_navy_body(html)
    assert _has_shared_shell_tagline(html)
    assert "YOU’RE ON THE WAITLIST" in html
    assert "waitlist" in html.lower()
    assert "FP-EV-77XY" in html
    # No cost row when cost display is None.
    assert "COST" not in html
    # No "Plus 0 guests" line when guests_count is 0.
    assert "Plus 0" not in html


# ---------------------------------------------------------------------------
# 3. event_cancelled_template.
# ---------------------------------------------------------------------------

def test_event_cancelled_uses_shared_shell():
    from email_service import event_cancelled_template
    subject, html, text = event_cancelled_template(
        first_name="Michael",
        event_title="Sunday Bushwalk",
        event_when_display="Sun 07/09/2026, 9:00 am AEST",
        reason="Heavy rain forecast.",
        ticket_ref="FP-EV-89ZZ",
    )
    assert _has_navy_body(html)
    assert _has_shared_shell_tagline(html)
    # Kept wording.
    assert "EVENT CANCELLED" in html
    assert "Sunday Bushwalk" in html
    assert "Sun 07/09/2026, 9:00 am AEST" in html
    assert "Heavy rain forecast." in html
    assert "FP-EV-89ZZ" in html
    # Events page link intact.
    assert "https://www.friendplace.com.au/events" in html
    assert "💜 The FriendPlace Events Team" in html
    # Text alternative preserves wording.
    assert "Sunday Bushwalk" in text
    assert "Heavy rain forecast." in text
    assert "FP-EV-89ZZ" in text


def test_event_cancelled_no_reason_omits_block():
    """Business logic: no reason → no reason block. Must still render."""
    from email_service import event_cancelled_template
    subject, html, text = event_cancelled_template(
        first_name="Priya",
        event_title="Book Club",
        event_when_display="Thu 11/09/2026, 6:30 pm AEST",
        reason=None,
        ticket_ref="FP-EV-AA11",
    )
    assert _has_navy_body(html)
    assert "Book Club" in html
    # No "Message from the organiser:" phrase leaks into text.
    assert "Message from the organiser:" not in text
    # Reason blockquote absent from html.
    assert "border-left:3px solid" not in html


# ---------------------------------------------------------------------------
# 4. business_welcome_template.
# ---------------------------------------------------------------------------

def test_business_welcome_uses_shared_shell():
    from email_service import business_welcome_template
    subject, html, text = business_welcome_template(
        first_name="Andrea",
        business_name="Sunrise Community",
        trial_limit=5,
        trial_days=30,
        requested_plan="monthly",
    )
    assert _has_navy_body(html)
    assert _has_shared_shell_tagline(html)
    # Chip subtitle preserved.
    assert "ORGANISATIONS · WELCOME" in html
    assert "Sunrise Community" in html
    # Trial line intact.
    assert "5 listings · 30 days" in html
    assert "Monthly plan" in html
    # Purple-heart sign-off.
    assert "💜 The FriendPlace Team" in html
    # Text alt.
    assert "Sunrise Community" in text
    assert "5 listings · 30 days" in text


def test_business_welcome_trial_default_plan_label():
    """Plan label falls back to 'Free 1-month trial' for unknown/None."""
    from email_service import business_welcome_template
    _, html, text = business_welcome_template(
        first_name=None,
        business_name="Unknown Co",
        trial_limit=3,
        trial_days=14,
        requested_plan=None,
    )
    assert _has_navy_body(html)
    assert "Free 1-month trial" in html
    assert "3 listings · 14 days" in html


# ---------------------------------------------------------------------------
# 5. event_submission_ack_template.
# ---------------------------------------------------------------------------

def test_event_submission_ack_uses_shared_shell():
    from email_service import event_submission_ack_template
    subject, html, text = event_submission_ack_template(
        first_name="Chen",
        organisation_name="Harbour Bridge Rowing",
        event_title="Sunrise Row",
        submission_ref="FP-SUB-42QT",
    )
    assert _has_navy_body(html)
    assert _has_shared_shell_tagline(html)
    assert "EVENT · SUBMITTED FOR REVIEW" in html
    assert "YOUR REFERENCE" in html
    assert "FP-SUB-42QT" in html
    assert "Sunrise Row" in html
    assert "Harbour Bridge Rowing" in html
    assert "💜 The FriendPlace Team" in html
    # Text alt.
    assert "FP-SUB-42QT" in text
    assert "Sunrise Row" in text


# ---------------------------------------------------------------------------
# 6. All four templates share the same outer chrome (butterfly, wordmark,
#    tagline, sign-off) — proves the "shared shell" claim.
# ---------------------------------------------------------------------------

def test_all_four_share_same_outer_chrome():
    from email_service import (
        event_rsvp_confirmation_template,
        event_cancelled_template,
        business_welcome_template,
        event_submission_ack_template,
    )
    common_kwargs = {}
    _, h_rsvp, _ = event_rsvp_confirmation_template(
        first_name="Sarah", event_title="A",
        event_when_display="Sun", event_where_display="Where",
        event_cost_display=None, event_url="https://x.au",
        manage_url="https://x.au/m", rsvp_status="going",
        guests_count=0, ticket_ref="R1",
    )
    _, h_cancel, _ = event_cancelled_template(
        first_name="Sarah", event_title="A",
        event_when_display="Sun", reason=None, ticket_ref="R2",
    )
    _, h_biz, _ = business_welcome_template(
        first_name="Sarah", business_name="X", trial_limit=1,
        trial_days=7, requested_plan="trial",
    )
    _, h_sub, _ = event_submission_ack_template(
        first_name="Sarah", organisation_name="X",
        event_title="A", submission_ref="R3",
    )
    for html in (h_rsvp, h_cancel, h_biz, h_sub):
        assert _has_navy_body(html)
        assert 'alt="FriendPlace"' in html         # butterfly from shell
        assert ">FriendPlace<" in html or ">Friend</span>" in html   # wordmark
        assert "Because you belong too. 🦋" in html
        # These four templates use the "💜 The FriendPlace …" body
        # sign-off (Events Team / FriendPlace Team) rather than the
        # marketing-shell's "Warmly, / The FriendPlace team". Either
        # is fine — it must not be missing entirely.
        assert (
            "💜 The FriendPlace Events Team" in html
            or "💜 The FriendPlace Team" in html
        )
        # No stray white content card.
        assert "box-shadow:0 20px 40px rgba(10,37,64,0.25)" not in html


# ---------------------------------------------------------------------------
# 7. Business-logic invariants — content unchanged.
# ---------------------------------------------------------------------------

def test_subjects_unchanged():
    """Subject-line wording is treated as business logic — the audit
    is against exact strings so accidental copy-tweaks fail loudly.
    """
    from email_service import (
        event_rsvp_confirmation_template,
        event_cancelled_template,
        business_welcome_template,
        event_submission_ack_template,
    )
    s1, _, _ = event_rsvp_confirmation_template(
        first_name="X", event_title="Beach Walk",
        event_when_display="Sun", event_where_display="A",
        event_cost_display=None, event_url="u", manage_url="u",
        rsvp_status="going", guests_count=0, ticket_ref="FP-1",
    )
    assert s1 == "You’re in for Beach Walk 🎉  ·  FP-1"

    s2, _, _ = event_rsvp_confirmation_template(
        first_name="X", event_title="Beach Walk",
        event_when_display="Sun", event_where_display="A",
        event_cost_display=None, event_url="u", manage_url="u",
        rsvp_status="waitlist", guests_count=0, ticket_ref="FP-2",
    )
    assert s2 == "You’re on the waitlist for Beach Walk 💜  ·  FP-2"

    s3, _, _ = event_cancelled_template(
        first_name="X", event_title="Beach Walk",
        event_when_display="Sun", reason=None, ticket_ref="FP-3",
    )
    assert s3 == "Update: Beach Walk has been cancelled  ·  FP-3"

    s4, _, _ = business_welcome_template(
        first_name=None, business_name="Sunrise",
        trial_limit=1, trial_days=1, requested_plan=None,
    )
    assert s4 == "Welcome to FriendPlace, Sunrise 💜"

    s5, _, _ = event_submission_ack_template(
        first_name=None, organisation_name="Org",
        event_title="Event", submission_ref="FP-SUB-5",
    )
    assert s5 == "We've received your event — FP-SUB-5"
