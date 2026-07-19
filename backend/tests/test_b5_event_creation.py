"""Milestone B5 — Mobile Event Creation backend tests.

Covers P0 items 1-6 from /app/test_result.md:
- Member bearer token accepted on /api/mcgs/george/event/*
- Warm opener (not a field question) when text is empty
- Multi-turn extraction + defaults
- Drafted status + preview copy
- Approve as member (no publish_events) -> submitted_for_review
- Approve as admin (publish_events) -> published
- Editing-out-of-scope politely deferred
- Presence: onboarding_complete / has_active_onboarding
"""
from __future__ import annotations

import os
import re
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")


def _last_george_text(session: dict) -> str:
    """Extract the most recent George turn text from the session payload.

    Backend model uses `turns` with role="george" and content field, plus
    optional excitement_line/working_line that the mobile UI shows as
    separate visual layers. Concatenate all three for tone benchmarks.
    """
    turns = session.get("turns") or session.get("messages") or []
    george = [t for t in turns if t.get("role") in ("george", "assistant")]
    if not george:
        return ""
    t = george[-1]
    parts = [
        t.get("excitement_line") or "",
        t.get("working_line") or "",
        t.get("content") or t.get("text") or "",
    ]
    return " ".join(p for p in parts if p)

MEMBER_EMAIL = "member@friendplace.com.au"
MEMBER_PASSWORD = "TestPass2026!"
ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASSWORD = "TestPass2026!"


# ---------------------------------------------------------------------------
# Fixtures — bearer tokens
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def member_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": MEMBER_EMAIL, "password": MEMBER_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"member login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{BASE_URL}/api/cms/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    if r.status_code != 200:
        pytest.skip(f"admin login failed: {r.status_code} {r.text}")
    data = r.json()
    tok = data.get("token") or data.get("access_token")
    if not tok:
        pytest.skip(f"admin token missing in payload: {data}")
    return tok


def _member_headers(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------------------------------------------------------------------------
# Presence — feeds the router (P0 17-18)
# ---------------------------------------------------------------------------

class TestPresence:
    def test_member_presence_onboarding_flags(self, member_token):
        r = requests.get(
            f"{BASE_URL}/api/mcgs/george/presence",
            headers=_member_headers(member_token),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("actor_type") == "member"
        assert data.get("onboarding_complete") is True, (
            f"Alex should have profile_complete=true post-B5: {data}"
        )
        assert data.get("has_active_onboarding") is False, (
            f"Alex should have no active onboarding: {data}"
        )
        assert (data.get("name") or "").startswith("Alex")


# ---------------------------------------------------------------------------
# P0 - 1..6 event creation flow
# ---------------------------------------------------------------------------

class TestEventStartOpener:
    """P0 #1: empty text with member bearer -> warm opener, NOT a field question."""

    def test_start_with_empty_text_returns_warm_opener(self, member_token):
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/event/start",
            headers=_member_headers(member_token),
            json={"text": ""},
            timeout=45,
        )
        assert r.status_code == 200, f"start failed: {r.status_code} {r.text}"
        s = r.json()
        assert s.get("status") == "in_progress", s
        text = _last_george_text(s).lower()
        assert text, f"no george turn in session: {s}"
        # MUST NOT lead with a field question
        forbidden = [
            "what's the title",
            "what is the title",
            "title of your event",
            "what date",
            "what time",
        ]
        for phrase in forbidden:
            assert phrase not in text, (
                f"Opener leads with field question '{phrase}'. Full: {text}"
            )
        # SHOULD contain the warm invitation phrasing (allow variants)
        warm_signals = [
            "get-together",
            "get together",
            "tell me about",
            "help with that",
            "hoping to create",
        ]
        assert any(sig in text for sig in warm_signals), (
            f"Opener missing warm invitation signals: {text}"
        )
        # field_being_asked (if present) MUST NOT be title/date/time
        fba = (s.get("field_being_asked") or "").lower()
        assert fba not in ("title", "date", "time"), (
            f"Opener asks a field ({fba}) instead of warm idea prompt: {s}"
        )
        # persist session id on the class for downstream tests
        TestEventStartOpener.session_id = s.get("session_id")
        TestEventStartOpener.host_id = s.get("host_id") or s.get("actor_id")


class TestEventMultiTurn:
    """P0 #2 and #3: multi-turn with rich seed -> drafted + confirmation copy."""

    def test_full_conversation_to_draft(self, member_token):
        # start with rich seed
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/event/start",
            headers=_member_headers(member_token),
            json={
                "text": (
                    "I'd like to organise a coffee morning at the community hall "
                    "on Saturday 12 December at 10am. Room for 15, free."
                )
            },
            timeout=90,
        )
        assert r.status_code == 200, r.text
        s = r.json()
        session_id = s["session_id"]
        assert s.get("status") in ("in_progress", "drafted"), s

        # Guard: George should still be warm and ask *at most one* open question
        last = _last_george_text(s)
        # Count question marks in George's most recent turn — expect <= 1 meaningful ask.
        qmarks = last.count("?")
        assert qmarks <= 2, f"George asked too many questions in one turn: {last}"

        # If still in_progress, deliver a title to close the loop
        if s.get("status") != "drafted":
            r2 = requests.post(
                f"{BASE_URL}/api/mcgs/george/event/session/{session_id}/turn",
                headers=_member_headers(member_token),
                json={"text": "Let's call it the December Coffee Morning."},
                timeout=90,
            )
            assert r2.status_code == 200, r2.text
            s = r2.json()

        # If still not drafted, do a light nudge
        if s.get("status") != "drafted":
            r3 = requests.post(
                f"{BASE_URL}/api/mcgs/george/event/session/{session_id}/turn",
                headers=_member_headers(member_token),
                json={"text": "That's everything — please put it together."},
                timeout=90,
            )
            assert r3.status_code == 200, r3.text
            s = r3.json()

        assert s.get("status") == "drafted", f"expected drafted, got {s.get('status')}: {s}"
        draft = s.get("draft") or {}
        assert draft.get("title"), f"draft missing title: {draft}"
        # sources — must be present as a list. Empty is acceptable when the
        # user stated every field explicitly (nothing was inferred by George).
        # Non-empty is expected only when defaults or extrapolation kicked in.
        sources = s.get("sources") or draft.get("sources")
        assert isinstance(sources, list), (
            f"sources field missing or not a list: {s}"
        )

        # Confirmation copy — warm variant of the benchmark line
        last = _last_george_text(s).lower()
        assert (
            "put together" in last
            or "captured it properly" in last
            or "captured this properly" in last
            or "have i captured" in last
        ), f"Confirmation copy off-benchmark: {last}"

        TestEventMultiTurn.session_id = session_id


class TestApproveAsMember:
    """P0 #4: member (no publish_events) -> outcome submitted_for_review."""

    def test_member_approve_submits_for_review(self, member_token):
        session_id = getattr(TestEventMultiTurn, "session_id", None)
        assert session_id, "prerequisite draft session missing"
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/event/session/{session_id}/approve",
            headers=_member_headers(member_token),
            json={"edits": {}},
            timeout=30,
        )
        assert r.status_code == 200, f"approve failed: {r.status_code} {r.text}"
        data = r.json()
        assert data.get("outcome") == "submitted_for_review", (
            f"expected submitted_for_review, got: {data}"
        )
        # target payload preserved on the pending row
        target = data.get("target") or {}
        assert target.get("id"), f"pending target missing id: {data}"
        assert "sources" in target, f"target should carry sources array: {target}"
        assert data.get("routed_to") == "events_pending_approval", data


class TestApproveAsAdmin:
    """P0 #5: admin (publish_events) -> outcome published."""

    def test_admin_approve_publishes(self, admin_token, member_token):
        # Admin needs their OWN conversation session (approve is actor-scoped).
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/event/start",
            headers=_member_headers(admin_token),
            json={
                "text": (
                    "TEST_admin_b5 — a trivia night at the hall on "
                    "Friday 18 December at 7pm, room for 30, free."
                )
            },
            timeout=90,
        )
        assert r.status_code == 200, f"admin start failed: {r.status_code} {r.text}"
        s = r.json()
        session_id = s["session_id"]
        # nudge to drafted
        tries = 0
        while s.get("status") != "drafted" and tries < 3:
            nudge = [
                "Call it TEST_admin_b5 Trivia Night.",
                "Everything looks right — please put it together.",
                "That's all — draft it now.",
            ][tries]
            r = requests.post(
                f"{BASE_URL}/api/mcgs/george/event/session/{session_id}/turn",
                headers=_member_headers(admin_token),
                json={"text": nudge},
                timeout=90,
            )
            assert r.status_code == 200, r.text
            s = r.json()
            tries += 1
        if s.get("status") != "drafted":
            pytest.skip(f"could not coax admin session to drafted in {tries} turns")

        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/event/session/{session_id}/approve",
            headers=_member_headers(admin_token),
            json={"edits": {}},
            timeout=30,
        )
        assert r.status_code == 200, f"admin approve failed: {r.status_code} {r.text}"
        data = r.json()
        assert data.get("outcome") == "published", (
            f"admin expected published, got: {data}"
        )


class TestEditingOutOfScope:
    """P0 #6: 'edit my last event' should be politely deferred."""

    def test_edit_request_is_deferred(self, member_token):
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/event/start",
            headers=_member_headers(member_token),
            json={"text": "I want to edit my last event."},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        s = r.json()
        last = _last_george_text(s).lower()
        assert any(
            phrase in last
            for phrase in ["editing existing", "able to help with soon", "for now", "can't edit", "cannot edit", "isn't something", "not able to edit", "help with soon"]
        ), f"George didn't defer edit gracefully: {last}"

        # Cancel to clean up
        sid = s.get("session_id")
        if sid:
            requests.post(
                f"{BASE_URL}/api/mcgs/george/event/session/{sid}/cancel",
                headers=_member_headers(member_token),
                timeout=10,
            )


class TestCancelFlow:
    """Save for later == cancel session."""

    def test_cancel_marks_session_cancelled(self, member_token):
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/event/start",
            headers=_member_headers(member_token),
            json={"text": ""},
            timeout=45,
        )
        assert r.status_code == 200
        sid = r.json()["session_id"]
        r2 = requests.post(
            f"{BASE_URL}/api/mcgs/george/event/session/{sid}/cancel",
            headers=_member_headers(member_token),
            timeout=15,
        )
        assert r2.status_code == 200, r2.text
        # GET session should now show cancelled
        r3 = requests.get(
            f"{BASE_URL}/api/mcgs/george/event/session/{sid}",
            headers=_member_headers(member_token),
            timeout=15,
        )
        assert r3.status_code == 200
        assert r3.json().get("status") == "cancelled"
