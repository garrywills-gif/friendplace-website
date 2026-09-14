"""
Iter 175 backend regression tests

BUG1 — onboarding memory: resume in-progress get-to-know-you session
       after 'Finish later' (staleness must key on profile_complete only,
       NOT on onboarding_completed).
BUG2 — /api/mcgs/george/speak honours persona:
       voice='george' -> onyx, voice='georgia' -> nova; both return
       valid MP3 and audio bytes differ for the same input text.
"""
from __future__ import annotations

import hashlib
import os
import time

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ["EXPO_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
API = f"{BASE_URL}/api"

USERNAME = "member_first"
EMAIL = "member@friendplace.com.au"
PASSWORD = "TestPass2026!"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def db():
    client = MongoClient(MONGO_URL)
    return client[DB_NAME]


@pytest.fixture(scope="module")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(http) -> str:
    r = http.post(f"{API}/auth/login", json={"username": USERNAME, "password": PASSWORD}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    token = r.json().get("access_token")
    assert token
    return token


@pytest.fixture(scope="module")
def token(http):
    return _login(http)


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def user_id(db):
    u = db.users.find_one({"username": USERNAME}, {"_id": 0, "id": 1})
    assert u and u.get("id"), "member_first user not found"
    return u["id"]


# ---------------------------------------------------------------------------
# BUG1 — resume after finish-later
# ---------------------------------------------------------------------------

class TestBug1OnboardingResume:
    """Member with profile_complete=False, onboarding_completed=True must
    RESUME the same session on reopen (same session_id + turns + known)."""

    def test_setup_member_state(self, db, user_id):
        # Force profile_complete=false; onboarding_completed=true (signup flag)
        db.users.update_one(
            {"id": user_id},
            {"$set": {"profile_complete": False, "onboarding_completed": True}},
        )
        # Cancel any lingering in-progress/drafted onboarding sessions to
        # ensure we start clean for this test.
        db.george_onboarding_conversations.update_many(
            {"actor_id": user_id, "status": {"$in": ["in_progress", "drafted"]}},
            {"$set": {"status": "cancelled", "cancel_reason": "test_reset_iter175"}},
        )
        u = db.users.find_one({"id": user_id}, {"_id": 0, "profile_complete": 1, "onboarding_completed": 1})
        assert u["profile_complete"] is False
        assert u["onboarding_completed"] is True

    def test_start_onboarding_and_take_two_turns(self, http, auth_headers):
        r = http.post(f"{API}/mcgs/george/onboarding/start", headers=auth_headers, timeout=60)
        assert r.status_code == 200, r.text[:300]
        s = r.json()
        session_id = s["session_id"]
        assert session_id
        # After start, there should be at least 1 george turn (opening)
        assert isinstance(s.get("turns"), list) and len(s["turns"]) >= 1
        pytest.session_id = session_id

        # Turn 1
        r1 = http.post(
            f"{API}/mcgs/george/onboarding/session/{session_id}/turn",
            headers=auth_headers,
            json={"text": "Call me Alex, I live in Rouse Hill NSW"},
            timeout=90,
        )
        assert r1.status_code == 200, r1.text[:300]
        s1 = r1.json()
        assert len(s1.get("turns") or []) >= 3  # opening + user + george

        # Turn 2
        r2 = http.post(
            f"{API}/mcgs/george/onboarding/session/{session_id}/turn",
            headers=auth_headers,
            json={"text": "I love bushwalking and my dog Bella"},
            timeout=90,
        )
        assert r2.status_code == 200, r2.text[:300]
        s2 = r2.json()
        pytest.turns_before = len(s2.get("turns") or [])
        assert pytest.turns_before >= 5

        known = s2.get("known") or {}
        # Extractor may name fields slightly differently; at minimum we
        # expect at least one field to have been captured.
        assert len(known) >= 1, f"expected >=1 known field, got {known}"
        pytest.known_before = known

    def test_known_contains_expected_fields(self):
        """Soft assertion — LLM-based extraction; at least one of the
        canonical fields must be present."""
        known = pytest.known_before
        got_name = "preferred_name" in known
        got_area = "area" in known
        got_interests = "interests" in known
        assert got_name or got_area or got_interests, (
            f"none of preferred_name/area/interests captured: {known}"
        )

    def test_finish_later(self, http, auth_headers):
        sid = pytest.session_id
        r = http.post(
            f"{API}/mcgs/george/onboarding/session/{sid}/finish-later",
            headers=auth_headers,
            timeout=20,
        )
        assert r.status_code == 200, r.text[:300]
        assert r.json().get("ok") is True

    def test_presence_shows_active_onboarding(self, http, auth_headers):
        r = http.get(f"{API}/mcgs/george/presence", headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text[:300]
        p = r.json()
        assert p.get("has_active_onboarding") is True, f"presence: {p}"
        assert p.get("onboarding_complete") is False, f"presence: {p}"

    def test_start_again_resumes_same_session(self, http, auth_headers):
        r = http.post(f"{API}/mcgs/george/onboarding/start", headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text[:300]
        s = r.json()
        assert s.get("session_id") == pytest.session_id, (
            f"expected resume, got new session {s.get('session_id')} vs {pytest.session_id}"
        )
        turns_now = len(s.get("turns") or [])
        assert turns_now == pytest.turns_before, (
            f"turns changed on resume: {turns_now} vs {pytest.turns_before}"
        )
        known_now = s.get("known") or {}
        assert known_now == pytest.known_before, (
            f"known changed on resume: {known_now} vs {pytest.known_before}"
        )


# ---------------------------------------------------------------------------
# BUG1 regression — profile_complete=True must NOT resume
# ---------------------------------------------------------------------------

class TestBug1RegressionProfileComplete:
    def test_profile_complete_true_hides_active_onboarding(self, db, user_id, http, auth_headers):
        db.users.update_one({"id": user_id}, {"$set": {"profile_complete": True}})
        r = http.get(f"{API}/mcgs/george/presence", headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text[:300]
        p = r.json()
        assert p.get("has_active_onboarding") is False, f"presence: {p}"
        assert p.get("onboarding_complete") is True, f"presence: {p}"

    def test_cleanup_restore_flags(self, db, user_id):
        # Leave user in profile_complete=True per test_credentials.md default;
        # cancel any lingering conversation set to in_progress so the account
        # is safe for next tester.
        db.george_onboarding_conversations.update_many(
            {"actor_id": user_id, "status": {"$in": ["in_progress", "drafted"]}},
            {"$set": {"status": "cancelled", "cancel_reason": "test_cleanup_iter175"}},
        )


# ---------------------------------------------------------------------------
# BUG2 — /speak persona → different OpenAI voices → different audio bytes
# ---------------------------------------------------------------------------

class TestBug2SpeakPersona:
    TEXT = "Hello there, lovely to see you today."

    def _speak(self, http, auth_headers, voice: str) -> bytes:
        # /speak returns audio/mpeg; do NOT ask requests to json-decode.
        headers = {**auth_headers}
        r = http.post(
            f"{API}/mcgs/george/speak",
            headers=headers,
            json={"text": self.TEXT, "voice": voice},
            timeout=60,
        )
        assert r.status_code == 200, f"speak {voice} failed: {r.status_code} {r.text[:300]}"
        ct = r.headers.get("content-type", "")
        assert "audio/mpeg" in ct or "audio/mp3" in ct, f"unexpected content-type {ct}"
        assert len(r.content) > 500, f"suspiciously small audio: {len(r.content)} bytes"
        # MP3 header: ID3 tag or MPEG frame sync (0xFF 0xFB / 0xFF 0xF3 / 0xFF 0xF2)
        head = r.content[:3]
        assert head[:3] == b"ID3" or (head[0] == 0xFF and (head[1] & 0xE0) == 0xE0), (
            f"not a valid MP3 header: {head!r}"
        )
        return r.content

    def test_speak_george(self, http, auth_headers):
        pytest.audio_george = self._speak(http, auth_headers, "george")

    def test_speak_georgia(self, http, auth_headers):
        pytest.audio_georgia = self._speak(http, auth_headers, "georgia")

    def test_audio_differs_per_persona(self):
        a = pytest.audio_george
        b = pytest.audio_georgia
        assert len(a) != len(b) or hashlib.sha256(a).hexdigest() != hashlib.sha256(b).hexdigest(), (
            "george and georgia audio bytes are IDENTICAL — persona not honoured"
        )
