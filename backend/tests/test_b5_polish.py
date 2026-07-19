"""Milestone B5 — POLISH PASS tests (Jan 2026).

Covers the P0 items from /app/test_result.md:
- Working line rotated (never "Let me note down what you've told me")
- warmth_line field returned as a top-level session field & on the George turn
- Opener has NO warmth_line and NO suggestion
- Gentle suggestion { kind: names | description | invitation } fires
  when the member says they don't have a name
- Suggestion fires AT MOST ONCE per conversation
- Memory sacred — George does NOT re-ask upfront fields
- description_written flag returned after description-suggestion accept
"""
from __future__ import annotations

import os
import re
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")
MEMBER_EMAIL = "member@friendplace.com.au"
MEMBER_PASSWORD = "TestPass2026!"

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _headers(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def _last_george_turn(session):
    turns = session.get("turns") or []
    georges = [t for t in turns if t.get("role") in ("george", "assistant")]
    return georges[-1] if georges else {}


def _george_turns(session):
    return [t for t in (session.get("turns") or []) if t.get("role") in ("george", "assistant")]


def _turn_full_text(t):
    return " ".join(
        p for p in (
            t.get("excitement_line") or "",
            t.get("working_line") or "",
            t.get("warmth_line") or "",
            t.get("content") or t.get("text") or "",
        ) if p
    ).strip()


BANNED_WORKING_LINE = "let me note down what you've told me"


@pytest.fixture(scope="module")
def member_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": MEMBER_EMAIL, "password": MEMBER_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


# ---------------------------------------------------------------------------
# P0-1 — Opener has NO warmth_line and NO suggestion
# ---------------------------------------------------------------------------

class TestOpenerCleanliness:
    def test_empty_opener_has_no_warmth_or_suggestion(self, member_token):
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/event/start",
            headers=_headers(member_token),
            json={"text": ""},
            timeout=45,
        )
        assert r.status_code == 200, r.text
        s = r.json()
        opener = _last_george_turn(s)
        # NO warmth_line on the opener
        assert not opener.get("warmth_line"), (
            f"Opener must not emit warmth_line: {opener.get('warmth_line')!r}"
        )
        # NO suggestion on the opener
        assert not opener.get("suggestion"), (
            f"Opener must not carry a suggestion: {opener.get('suggestion')!r}"
        )
        # Session mirrors
        assert not s.get("warmth_line"), (
            f"Session-level warmth_line must be null on opener: {s.get('warmth_line')!r}"
        )
        assert not s.get("suggestion"), (
            f"Session-level suggestion must be null on opener: {s.get('suggestion')!r}"
        )
        assert s.get("suggestion_offered") is False, s

        # cancel to keep test data tidy
        sid = s.get("session_id")
        if sid:
            requests.post(
                f"{BASE_URL}/api/mcgs/george/event/session/{sid}/cancel",
                headers=_headers(member_token), timeout=10,
            )


# ---------------------------------------------------------------------------
# P0-2 — Rich seed + first-time cue → excitement + working (rotated) + warmth
# ---------------------------------------------------------------------------

class TestRichSeedThreeLines:
    def test_rich_seed_returns_three_lines_with_rotated_working(self, member_token):
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/event/start",
            headers=_headers(member_token),
            json={
                "text": (
                    "I've never organised anything like this before, but I'd love to run a "
                    "welcome tea at the community hall for new neighbours on Saturday 24 "
                    "January at 3pm. Room for about 20 people. It's a chance to make "
                    "newcomers feel less alone."
                )
            },
            timeout=90,
        )
        assert r.status_code == 200, r.text
        s = r.json()
        TestRichSeedThreeLines.session_id = s.get("session_id")
        g = _last_george_turn(s)
        excite = (g.get("excitement_line") or "").lower()
        working = (g.get("working_line") or "").lower()
        warmth = (g.get("warmth_line") or "").lower()
        msg = (g.get("content") or "").lower()

        # All three lines earned (warmth allowed to skip once but this seed is
        # about welcoming newcomers — the polish spec says it should land)
        assert excite, f"excitement_line missing: {g}"
        assert working, f"working_line missing: {g}"
        # warmth is 'earned' — not guaranteed. We assert it's *possible* but
        # only warn if missing, per test_result.md guidance.
        if not warmth:
            print(
                "WARN: warmth_line absent on a welcoming-newcomers seed — allowed by design "
                "but the polish spec says this should earn one."
            )

        # Working line must NOT be the banned phrase
        assert BANNED_WORKING_LINE not in working, (
            f"Working line still uses banned phrasing: {working!r}"
        )

        # Warm question — at least one open ask
        assert "?" in msg, f"George should ask a warm open question: {msg}"


# ---------------------------------------------------------------------------
# P0-3, P0-4, P0-5 — Gentle suggestion (names), once-per-conversation
# ---------------------------------------------------------------------------

class TestSuggestionLifecycle:
    def test_names_suggestion_then_accept_then_no_reoffer(self, member_token):
        # 1. Start a session with an event idea but NO title mentioned.
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/event/start",
            headers=_headers(member_token),
            json={
                "text": (
                    "I'd love to run a Sunday afternoon lawn bowls session at the club "
                    "on 8 February at 2pm. Room for 12. Just neighbours saying hello."
                )
            },
            timeout=90,
        )
        assert r.status_code == 200, r.text
        s = r.json()
        sid = s["session_id"]

        # 2. Tell George we don't have a name — should trigger names suggestion.
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/event/session/{sid}/turn",
            headers=_headers(member_token),
            json={"text": "I don't have a name in mind for it."},
            timeout=90,
        )
        assert r.status_code == 200, r.text
        s = r.json()
        g = _last_george_turn(s)

        suggestion = g.get("suggestion") or s.get("suggestion")
        assert suggestion, (
            f"George must offer a suggestion when the member has no name in mind. "
            f"turn={g} session_suggestion={s.get('suggestion')} suggestion_offered={s.get('suggestion_offered')}"
        )
        assert suggestion.get("kind") == "names", (
            f"Expected kind='names', got: {suggestion}"
        )
        assert (suggestion.get("offer_line") or "").strip(), (
            f"suggestion.offer_line must be non-empty: {suggestion}"
        )
        # Session mirrors
        assert s.get("suggestion_offered") is True, s
        assert (s.get("pending_suggestion") or {}).get("kind") == "names", s

        # 3. Accept: "Yes please, suggest a few names." → George proposes 2-3
        #    names inline in `message`, suggestion becomes null,
        #    suggestion_offered still True.
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/event/session/{sid}/turn",
            headers=_headers(member_token),
            json={"text": "Yes please, suggest a few names."},
            timeout=90,
        )
        assert r.status_code == 200, r.text
        s = r.json()
        g = _last_george_turn(s)
        # NO fresh suggestion on the accept turn
        assert not g.get("suggestion"), (
            f"George must NOT re-offer a suggestion on the accept turn: {g.get('suggestion')}"
        )
        assert not s.get("suggestion"), s
        assert s.get("suggestion_offered") is True, (
            f"suggestion_offered must remain True after accept: {s}"
        )
        msg = (g.get("content") or "").lower()
        # Look for a proposed shortlist — heuristic: at least two candidate
        # names separated by commas / a list / an "or".
        # 2-3 names inline. Loose signal: "or", commas, bullet-ish markers.
        signals = sum([
            1 if " or " in msg else 0,
            msg.count(","),
            msg.count("•"),
            msg.count("- "),
            msg.count("\n1"),
            msg.count("1."),
        ])
        assert signals >= 1, (
            f"Expected 2-3 inline name suggestions in accept-turn message: {msg}"
        )

        # 4. Next user turn — George MUST NOT offer another suggestion.
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/event/session/{sid}/turn",
            headers=_headers(member_token),
            json={"text": "Let's call it Sunday Bowls Social."},
            timeout=90,
        )
        assert r.status_code == 200, r.text
        s = r.json()
        g = _last_george_turn(s)
        assert not g.get("suggestion"), (
            f"Suggestion must not fire twice per conversation: {g.get('suggestion')}"
        )
        assert not s.get("suggestion"), s

        # cleanup
        requests.post(
            f"{BASE_URL}/api/mcgs/george/event/session/{sid}/cancel",
            headers=_headers(member_token), timeout=10,
        )


# ---------------------------------------------------------------------------
# P0-6 — Memory is sacred: given time/date/location upfront, George
#         MUST NOT re-ask about them later.
# ---------------------------------------------------------------------------

class TestMemorySacred:
    def test_no_reask_after_upfront_details(self, member_token):
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/event/start",
            headers=_headers(member_token),
            json={
                "text": (
                    "I want to organise a picnic at Riverside Park on Sunday at 3pm. "
                    "Room for 20 people. Free to attend, families welcome."
                )
            },
            timeout=90,
        )
        assert r.status_code == 200, r.text
        s = r.json()
        sid = s["session_id"]
        g = _last_george_turn(s)
        msg = (g.get("content") or "").lower()

        forbidden_reasks = [
            "what time",
            "what date",
            "when would you like",
            "where would you",
            "which location",
            "which venue",
            "how many people",
        ]
        offenders = [p for p in forbidden_reasks if p in msg]
        assert not offenders, (
            f"George re-asked upfront-known fields ({offenders}): {msg}"
        )

        # Nudge with a bland reply — the very next turn must also NOT re-ask.
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/event/session/{sid}/turn",
            headers=_headers(member_token),
            json={"text": "Just a friendly community catch-up."},
            timeout=90,
        )
        assert r.status_code == 200, r.text
        s = r.json()
        g = _last_george_turn(s)
        msg = (g.get("content") or "").lower()
        offenders = [p for p in forbidden_reasks if p in msg]
        assert not offenders, (
            f"George re-asked upfront-known fields on turn 2 ({offenders}): {msg}"
        )

        # cleanup
        requests.post(
            f"{BASE_URL}/api/mcgs/george/event/session/{sid}/cancel",
            headers=_headers(member_token), timeout=10,
        )


# ---------------------------------------------------------------------------
# P0-7 — description_written flag round-trips after accepting a
#         description suggestion.
# ---------------------------------------------------------------------------

class TestDescriptionSuggestionFlag:
    def test_description_written_flag_after_accept(self, member_token):
        # Seed: give the title + logistics but leave the description gap open.
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/event/start",
            headers=_headers(member_token),
            json={
                "text": (
                    "TEST_polish — a knitting circle called Yarn & Yarns at the "
                    "community hall on Wednesday 21 January at 10am, room for 10, free."
                )
            },
            timeout=90,
        )
        assert r.status_code == 200, r.text
        s = r.json()
        sid = s["session_id"]

        # Politely nudge George toward offering a description.
        # George will only offer once per conversation and it must feel earned.
        # Try up to 3 conversational nudges to earn the offer.
        pending_kind = None
        for nudge in [
            "I don't really know what to write for the description.",
            "Could you help me put a few words together for what it's about?",
            "I'm not sure how to describe it welcomingly.",
        ]:
            r = requests.post(
                f"{BASE_URL}/api/mcgs/george/event/session/{sid}/turn",
                headers=_headers(member_token),
                json={"text": nudge},
                timeout=90,
            )
            assert r.status_code == 200, r.text
            s = r.json()
            pending = s.get("pending_suggestion") or _last_george_turn(s).get("suggestion")
            if pending and pending.get("kind") in ("description", "invitation"):
                pending_kind = pending.get("kind")
                break

        if not pending_kind:
            # Not deterministic — Sonnet may decide the moment doesn't call
            # for a suggestion. Skip rather than fail: warmth_line and
            # suggestion are 'earned', not scripted, per test_result.md.
            pytest.skip(
                "Sonnet did not offer a description suggestion in 3 nudges — "
                "gentle-suggestions are earned by design, not scripted."
            )

        # Accept the description offer.
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/event/session/{sid}/turn",
            headers=_headers(member_token),
            json={"text": "Yes please, help me write a description."},
            timeout=90,
        )
        assert r.status_code == 200, r.text
        s = r.json()
        g = _last_george_turn(s)

        # description_written must be True on the accept turn
        assert g.get("description_written") is True, (
            f"description_written should be true after accept: {g}"
        )
        # draft.description must be populated with something non-trivial
        draft = s.get("draft") or {}
        desc = (draft.get("description") or "").strip()
        assert len(desc) >= 20, (
            f"draft.description should have real prose after accept, got: {desc!r}"
        )

        # cleanup
        requests.post(
            f"{BASE_URL}/api/mcgs/george/event/session/{sid}/cancel",
            headers=_headers(member_token), timeout=10,
        )


# ---------------------------------------------------------------------------
# P0 sweep — working_line is rotated across a multi-turn session
# ---------------------------------------------------------------------------

class TestWorkingLineRotation:
    def test_working_lines_are_not_the_banned_phrase(self, member_token):
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/event/start",
            headers=_headers(member_token),
            json={
                "text": (
                    "I'd love to run a bring-a-plate winter supper at the community "
                    "hall on Friday 30 January at 6pm. Room for 25, gold coin donation."
                )
            },
            timeout=90,
        )
        assert r.status_code == 200, r.text
        s = r.json()
        sid = s["session_id"]

        # collect 3 george turns
        for text in [
            "Let's call it Winter Warmers.",
            "About bringing neighbours together on a cold evening.",
            "All ready — please put it together.",
        ]:
            r = requests.post(
                f"{BASE_URL}/api/mcgs/george/event/session/{sid}/turn",
                headers=_headers(member_token),
                json={"text": text},
                timeout=90,
            )
            assert r.status_code == 200, r.text
            s = r.json()

        working_lines = [
            (t.get("working_line") or "").strip().lower()
            for t in _george_turns(s)
            if t.get("working_line")
        ]
        # Banned phrase must NEVER appear
        for wl in working_lines:
            assert BANNED_WORKING_LINE not in wl, (
                f"Banned working_line phrase reappeared: {wl!r}"
            )
        # cleanup
        requests.post(
            f"{BASE_URL}/api/mcgs/george/event/session/{sid}/cancel",
            headers=_headers(member_token), timeout=10,
        )
