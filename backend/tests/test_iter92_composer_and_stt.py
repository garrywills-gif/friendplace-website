"""Iter 92 — TestFlight round-7 (Feb 2026) surgical bug-fix backend regression.

Verifies the three backend contracts touched (or relied upon) by the three
approved frontend fixes:
  A. PATCH /api/users/{user_id}/preferences with {nearby_chat_alerts: true}
     — used by the newly-tappable Nearby Opt-In row on Profile.
  B. POST /api/community/chat-alert with audience='friends' when the sender
     has zero friends — returns {delivered_to: 0, message: '…'}. This is
     the fallback the "Find Friends" empty state in the alert modal relies
     on (the toast still fires on server/network errors).
  C. POST /api/mcgs/george/transcribe — STT contract used by the refactored
     VoiceInputButton composer:
        (a) 401/403 without Bearer token
        (b) 400/422 without 'file' field
        (c) 200 { text: string } with valid file + Bearer

Reuses the shared member@friendplace.com.au / TestPass2026! account.
"""
import io
import os
import wave

import pytest
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or "").rstrip("/")
assert BASE_URL, "EXPO_BACKEND_URL must be set"

MEMBER_EMAIL = "member@friendplace.com.au"
MEMBER_PASSWORD = "TestPass2026!"


# ─── Shared fixtures ────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def member_session():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": MEMBER_EMAIL, "password": MEMBER_PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    token = data["access_token"]
    user = data["user"]
    return {"token": token, "user_id": user["id"], "user": user}


def _tiny_wav_bytes(seconds: float = 1.0, freq: int = 440, rate: int = 16000) -> bytes:
    """Generate a small valid mono 16-bit PCM WAV. Passes size/format guards
    without needing a real recording."""
    import math
    import struct

    n = int(seconds * rate)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = bytearray()
        for i in range(n):
            v = int(32767 * 0.2 * math.sin(2 * math.pi * freq * (i / rate)))
            frames += struct.pack("<h", v)
        w.writeframes(bytes(frames))
    return buf.getvalue()


# ─── Fix A back-end contract: PATCH preferences.nearby_chat_alerts ─────────
class TestPreferencesPersistence:
    """Fix A — the newly-tappable row calls updatePreferences({nearby_chat_alerts})."""

    def test_patch_nearby_true_persists(self, member_session):
        uid = member_session["user_id"]
        r = requests.patch(
            f"{BASE_URL}/api/users/{uid}/preferences",
            json={"nearby_chat_alerts": True},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("preferences", {}).get("nearby_chat_alerts") is True

        # Verify via GET (data-assertion rule: read-after-write).
        g = requests.get(f"{BASE_URL}/api/users/{uid}/preferences", timeout=15)
        assert g.status_code == 200
        assert g.json().get("preferences", {}).get("nearby_chat_alerts") is True

    def test_patch_nearby_false_persists(self, member_session):
        uid = member_session["user_id"]
        r = requests.patch(
            f"{BASE_URL}/api/users/{uid}/preferences",
            json={"nearby_chat_alerts": False},
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json().get("preferences", {}).get("nearby_chat_alerts") is False

        g = requests.get(f"{BASE_URL}/api/users/{uid}/preferences", timeout=15)
        assert g.json().get("preferences", {}).get("nearby_chat_alerts") is False


# ─── Fix B back-end contract: chat-alert friends with 0 friends ────────────
class TestChatAlertFriendsFallback:
    """Fix B — when audience='friends' and member has 0 friends the endpoint
    must return {delivered_to: 0, message: '…'} so the frontend can render
    the 'Find Friends' empty state (no scary error toast)."""

    def test_zero_friends_returns_helpful_message(self, member_session):
        uid = member_session["user_id"]
        # Ensure the account under test has no friends for a clean run.
        # If the account already has friends, we skip rather than mutate
        # production state.
        me = requests.get(f"{BASE_URL}/api/users/{uid}", timeout=15)
        if me.status_code == 200:
            friends = (me.json() or {}).get("friends") or []
            if friends:
                pytest.skip(f"Account has {len(friends)} friends; can't test 0-friends path without mutation")

        r = requests.post(
            f"{BASE_URL}/api/community/chat-alert",
            json={"user_id": uid, "audience": "friends", "message": "TEST_alert"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("audience") == "friends"
        assert body.get("delivered_to") == 0
        assert isinstance(body.get("message"), str) and len(body["message"]) > 0


# ─── Fix C back-end contract: /api/mcgs/george/transcribe STT ──────────────
class TestSTTContract:
    """Fix C — the refactored VoiceInputButton POSTs to /api/mcgs/george/transcribe
    with field 'file' + Bearer <yb_token>. Contract must hold."""

    def test_transcribe_requires_bearer(self):
        # No Authorization header at all → must reject with 401/403.
        wav = _tiny_wav_bytes(1.0)
        files = {"file": ("voice.wav", wav, "audio/wav")}
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/transcribe",
            files=files,
            timeout=30,
        )
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text[:200]}"

    def test_transcribe_missing_file_field(self, member_session):
        headers = {"Authorization": f"Bearer {member_session['token']}"}
        # Wrong field name — endpoint expects 'file'.
        wav = _tiny_wav_bytes(1.0)
        files = {"wrong_field": ("voice.wav", wav, "audio/wav")}
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/transcribe",
            files=files,
            headers=headers,
            timeout=30,
        )
        assert r.status_code in (400, 422), f"expected 400/422 for missing 'file', got {r.status_code}: {r.text[:200]}"

    def test_transcribe_happy_path(self, member_session):
        headers = {"Authorization": f"Bearer {member_session['token']}"}
        wav = _tiny_wav_bytes(1.5)
        files = {"file": ("voice.wav", wav, "audio/wav")}
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/transcribe",
            files=files,
            headers=headers,
            timeout=60,
        )
        # A tiny synthetic sine tone may transcribe to empty string, but the
        # contract must be 200 with a `text` string field.
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:200]}"
        body = r.json()
        assert "text" in body, f"response missing 'text': {body}"
        assert isinstance(body["text"], str)
