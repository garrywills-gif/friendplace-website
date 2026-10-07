"""iter251 — George/Georgia fast canned first-opener (TestFlight feedback, Neo Feb 2026).

Verifies that `POST /api/mcgs/george/onboarding/start` no longer blocks on a
Claude Sonnet 4.5 round-trip for the FIRST turn. Covers:
  - fresh George session returns <1s with canned opener
  - fresh Georgia session returns <1s with Georgia-worded opener (not George)
  - opener is persisted (GET session returns same first turn)
  - resume after finish-later reuses the SAME session + stays <1s
  - reset ("Clear chat") cancels & creates a fresh session with canned opener
  - subsequent turns still invoke the LLM (take longer, produce acknowledgement)
"""

import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")

# Opener text indicators we assert against (COMPOSER_SYSTEM rule #1).
NAMELESS_SNIPPETS = (
    "lovely to meet you",
    "what would you like me to call you",
    "let's start with something easy",
)
NAMED_SNIPPETS = ("lovely to meet you,",)


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _signup(api: requests.Session, first_name: str = "Tester"):
    """Create a brand-new TEST_* member and return (token, user_id, first_name)."""
    uname = f"TEST_fastopener_{uuid.uuid4().hex[:10]}"
    payload = {
        "username": uname,
        "password": "TestPass2026!",
        "email": f"{uname}@example.com",
        "first_name": first_name,
    }
    r = api.post(f"{BASE_URL}/api/auth/signup", json=payload, timeout=15)
    assert r.status_code == 200, f"signup failed: {r.status_code} {r.text}"
    data = r.json()
    return data["access_token"], data["user"]["id"], first_name


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------------------------------------------------------------------------
# 1) FRESH George — canned opener returns in <1s
# ---------------------------------------------------------------------------
class TestFreshGeorgeOpener:
    def test_fresh_george_opener_fast_and_shaped(self, api):
        tok, uid, fname = _signup(api, first_name="Casey")
        t0 = time.perf_counter()
        r = api.post(
            f"{BASE_URL}/api/mcgs/george/onboarding/start",
            headers=_auth(tok),
            json={"persona": "george"},
            timeout=10,
        )
        elapsed = time.perf_counter() - t0
        assert r.status_code == 200, r.text
        session = r.json()
        # Fast path: must be well under 3s wall-clock (we aim <1s server-side,
        # but allow headroom for public ingress + TLS + cold path).
        assert elapsed < 3.0, f"Fresh George start took {elapsed:.2f}s (>3s)"

        turns = session.get("turns") or []
        assert len(turns) == 1, f"Expected exactly 1 opening turn, got {len(turns)}"
        first = turns[0]
        assert first.get("role") == "george"
        msg = (first.get("content") or "").lower()
        # Should greet by name OR ask for one, per COMPOSER_SYSTEM rule #1.
        assert "casey" in msg or "what would you like me to call you" in msg, (
            f"Opener missing name/ask: {first.get('content')!r}"
        )
        # Must introduce as George (we signed up with persona=george).
        assert "george" in msg and "georgia" not in msg, (
            f"Fresh George opener wrong identity: {first.get('content')!r}"
        )
        # Shape fields
        assert session.get("status") == "in_progress"
        assert session.get("persona") == "george"
        assert session.get("session_id")


# ---------------------------------------------------------------------------
# 2) FRESH Georgia — canned Georgia-worded opener, still <1s
# ---------------------------------------------------------------------------
class TestFreshGeorgiaOpener:
    def test_fresh_georgia_opener_fast_and_identity(self, api):
        tok, uid, fname = _signup(api, first_name="Jamie")
        t0 = time.perf_counter()
        r = api.post(
            f"{BASE_URL}/api/mcgs/george/onboarding/start",
            headers=_auth(tok),
            json={"persona": "georgia"},
            timeout=10,
        )
        elapsed = time.perf_counter() - t0
        assert r.status_code == 200, r.text
        assert elapsed < 3.0, f"Fresh Georgia took {elapsed:.2f}s"
        session = r.json()
        assert session.get("persona") == "georgia"
        turns = session.get("turns") or []
        assert len(turns) == 1
        msg = (turns[0].get("content") or "").lower()
        # Georgia identity — NOT George.
        assert "georgia" in msg, f"Georgia opener missing identity: {turns[0]['content']!r}"
        assert "i'm george" not in msg, (
            f"Georgia opener wrongly says 'I'm George': {turns[0]['content']!r}"
        )


# ---------------------------------------------------------------------------
# 3) Persistence — opener is written to Mongo (GET returns same content)
# ---------------------------------------------------------------------------
class TestOpenerPersisted:
    def test_opener_persisted_in_mongo(self, api):
        tok, uid, _ = _signup(api, first_name="Robin")
        r = api.post(
            f"{BASE_URL}/api/mcgs/george/onboarding/start",
            headers=_auth(tok),
            json={"persona": "george"},
            timeout=10,
        )
        assert r.status_code == 200
        session = r.json()
        sid = session["session_id"]
        original = session["turns"][0]["content"]

        g = api.get(
            f"{BASE_URL}/api/mcgs/george/onboarding/session/{sid}",
            headers=_auth(tok),
            timeout=10,
        )
        assert g.status_code == 200
        got = g.json()
        assert got["turns"][0]["content"] == original, "Opener not persisted verbatim"
        assert got["session_id"] == sid


# ---------------------------------------------------------------------------
# 4) Resume after "Finish later" — same session, no new LLM call, still <1s
# ---------------------------------------------------------------------------
class TestResumeAfterFinishLater:
    def test_finish_later_then_resume_reuses_session(self, api):
        tok, uid, _ = _signup(api, first_name="Morgan")
        # Start session
        r1 = api.post(
            f"{BASE_URL}/api/mcgs/george/onboarding/start",
            headers=_auth(tok),
            json={"persona": "george"},
            timeout=10,
        )
        assert r1.status_code == 200
        sid1 = r1.json()["session_id"]
        original_opener = r1.json()["turns"][0]["content"]

        # Finish-later
        fl = api.post(
            f"{BASE_URL}/api/mcgs/george/onboarding/session/{sid1}/finish-later",
            headers=_auth(tok),
            timeout=10,
        )
        assert fl.status_code == 200, fl.text

        # Resume (same /start endpoint) — must be fast & return SAME session
        t0 = time.perf_counter()
        r2 = api.post(
            f"{BASE_URL}/api/mcgs/george/onboarding/start",
            headers=_auth(tok),
            json={"persona": "george"},
            timeout=10,
        )
        elapsed = time.perf_counter() - t0
        assert r2.status_code == 200
        assert elapsed < 3.0, f"Resume took {elapsed:.2f}s (>3s)"
        s2 = r2.json()
        assert s2["session_id"] == sid1, "Resume should reuse the same session_id"
        # Opener text unchanged — no new LLM call.
        assert s2["turns"][0]["content"] == original_opener


# ---------------------------------------------------------------------------
# 5) Reset ("Clear chat") — fresh session with canned opener in <1s
# ---------------------------------------------------------------------------
class TestResetClearChat:
    def test_reset_creates_fresh_session_fast(self, api):
        tok, uid, _ = _signup(api, first_name="Taylor")
        r1 = api.post(
            f"{BASE_URL}/api/mcgs/george/onboarding/start",
            headers=_auth(tok),
            json={"persona": "george"},
            timeout=10,
        )
        sid1 = r1.json()["session_id"]
        assert r1.status_code == 200

        t0 = time.perf_counter()
        rr = api.post(
            f"{BASE_URL}/api/mcgs/george/onboarding/session/{sid1}/reset",
            headers=_auth(tok),
            timeout=10,
        )
        elapsed = time.perf_counter() - t0
        assert rr.status_code == 200, rr.text
        assert elapsed < 3.0, f"Reset took {elapsed:.2f}s (>3s)"
        fresh = rr.json()
        assert fresh["session_id"] != sid1, "Reset must return a new session_id"
        assert len(fresh.get("turns") or []) == 1
        msg = fresh["turns"][0]["content"].lower()
        assert any(s in msg for s in NAMELESS_SNIPPETS), (
            f"Reset opener doesn't match canned shape: {fresh['turns'][0]['content']!r}"
        )


# ---------------------------------------------------------------------------
# 6) Subsequent turn — LLM still invoked, produces sensible acknowledgement
# ---------------------------------------------------------------------------
class TestSecondTurnStillUsesLLM:
    def test_second_turn_goes_through_llm(self, api):
        tok, uid, _ = _signup(api, first_name="Sam")
        r = api.post(
            f"{BASE_URL}/api/mcgs/george/onboarding/start",
            headers=_auth(tok),
            json={"persona": "george"},
            timeout=10,
        )
        assert r.status_code == 200
        sid = r.json()["session_id"]
        # Call me Alex — second turn, should go through LLM
        t0 = time.perf_counter()
        tr = api.post(
            f"{BASE_URL}/api/mcgs/george/onboarding/session/{sid}/turn",
            headers=_auth(tok),
            json={"text": "Call me Alex"},
            timeout=90,  # LLM may take 10-30s
        )
        elapsed = time.perf_counter() - t0
        assert tr.status_code == 200, tr.text
        updated = tr.json()
        turns = updated.get("turns") or []
        # 1 opener + 1 user + 1 george reply = at least 3
        assert len(turns) >= 3, f"Expected ≥3 turns, got {len(turns)}"
        last = turns[-1]
        assert last.get("role") == "george"
        msg = (last.get("content") or "").lower()
        # Must acknowledge the name "Alex" somehow (either echo it or ask-confirm);
        # at minimum the reply should NOT be the canned opener.
        assert "what would you like me to call you" not in msg, (
            "Second turn echoed the canned opener — LLM path broken"
        )
        print(f"[info] second-turn LLM call took {elapsed:.2f}s; reply: {last['content'][:120]}")
