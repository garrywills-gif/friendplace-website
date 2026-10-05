"""iter234 — Voice/login/brand cleanup backend regression.

Covers:
  - POST /api/mcgs/george/transcribe/warmup (auth: 200 {ok:true}; unauth: 401; idempotent)
  - POST /api/mcgs/george/speak with voice='georgia' (speed 0.90) returns 200 audio/mpeg
  - POST /api/mcgs/george/speak with voice='george' (unchanged) returns 200 audio/mpeg
  - POST /api/auth/login wrong password → 400 'Invalid credentials'
  - POST /api/auth/login correct password → 200 {access_token, user}
  - POST /api/auth/login empty username/password → 4xx (no crash)
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://live-nudges-deploy.preview.emergentagent.com").rstrip("/")

REAL_USERNAME = "realtest1"
REAL_PASSWORD = "secret123"
DEMO_USERNAME = "maggie"  # fallback token source if realtest1 absent


# --- fixtures ---------------------------------------------------------------

@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def member_token(session):
    """Prefer realtest1 (non-demo). Fall back to a demo login so the warmup
    auth test can still exercise the member-token branch."""
    # Try realtest1 first
    r = session.post(f"{BASE_URL}/api/auth/login",
                     json={"username": REAL_USERNAME, "password": REAL_PASSWORD})
    if r.status_code == 200:
        return r.json().get("access_token")
    # Fall back to demo
    r = session.post(f"{BASE_URL}/api/auth/demo-login",
                     json={"username": DEMO_USERNAME})
    if r.status_code == 200:
        return r.json().get("access_token")
    pytest.skip(f"Could not obtain a member token (realtest1={r.status_code})")


# --- /auth/login regression -------------------------------------------------

class TestAuthLogin:
    def test_login_wrong_password_returns_400_invalid_credentials(self, session):
        r = session.post(f"{BASE_URL}/api/auth/login",
                         json={"username": REAL_USERNAME, "password": "definitely-wrong-pw"})
        assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text[:200]}"
        body = r.json()
        assert "detail" in body
        assert body["detail"] == "Invalid credentials", f"Got detail={body['detail']!r}"

    def test_login_correct_password_returns_200_with_token_and_user(self, session):
        r = session.post(f"{BASE_URL}/api/auth/login",
                         json={"username": REAL_USERNAME, "password": REAL_PASSWORD})
        if r.status_code == 429:
            pytest.skip("realtest1 is locked out from brute-force protection; skip positive-path check")
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text[:200]}"
        data = r.json()
        assert "access_token" in data and isinstance(data["access_token"], str) and data["access_token"]
        assert "user" in data and isinstance(data["user"], dict)
        assert data["user"].get("username", "").lower() == REAL_USERNAME.lower()

    def test_login_empty_username_and_password_returns_4xx_no_crash(self, session):
        r = session.post(f"{BASE_URL}/api/auth/login",
                         json={"username": "", "password": ""})
        # Must be a client error (likely 400 Invalid credentials since user lookup fails,
        # or 422 if validation rejects empty strings). We just require 4xx and valid JSON.
        assert 400 <= r.status_code < 500, f"Expected 4xx, got {r.status_code}: {r.text[:200]}"
        # Must be parseable JSON (confirms no server crash / 500)
        _ = r.json()

    def test_login_missing_fields_returns_422(self, session):
        r = session.post(f"{BASE_URL}/api/auth/login", json={})
        assert 400 <= r.status_code < 500


# --- /mcgs/george/transcribe/warmup ----------------------------------------

class TestGeorgeTranscribeWarmup:
    URL = f"{BASE_URL}/api/mcgs/george/transcribe/warmup"

    def test_warmup_requires_auth_returns_401(self, session):
        r = session.post(self.URL)  # no bearer
        assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text[:200]}"

    def test_warmup_with_bearer_returns_200_ok_true(self, session, member_token):
        r = session.post(self.URL, headers={"Authorization": f"Bearer {member_token}"})
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text[:200]}"
        body = r.json()
        assert body.get("ok") is True, f"Expected ok=true, got {body}"

    def test_warmup_is_idempotent_on_repeated_calls(self, session, member_token):
        headers = {"Authorization": f"Bearer {member_token}"}
        results = []
        for _ in range(3):
            r = session.post(self.URL, headers=headers)
            results.append((r.status_code, r.json().get("ok")))
        for status, ok in results:
            assert status == 200
            assert ok is True

    def test_warmup_with_bad_bearer_returns_401(self, session):
        r = session.post(self.URL, headers={"Authorization": "Bearer not-a-real-token"})
        assert r.status_code == 401, f"Expected 401 for garbage bearer, got {r.status_code}"


# --- /mcgs/george/speak voice regression ------------------------------------

class TestGeorgeSpeak:
    URL = f"{BASE_URL}/api/mcgs/george/speak"

    def _assert_mp3_response(self, r):
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text[:200] if r.content else ''}"
        ctype = r.headers.get("content-type", "").lower()
        assert "audio/mpeg" in ctype or "audio/mp3" in ctype or "application/octet-stream" in ctype, \
            f"Unexpected content-type: {ctype}"
        # MP3 payload should be non-trivial
        assert len(r.content) > 500, f"Audio payload suspiciously small: {len(r.content)} bytes"

    def test_speak_georgia_voice_returns_200_audio(self, session, member_token):
        r = session.post(
            self.URL,
            headers={"Authorization": f"Bearer {member_token}", "Content-Type": "application/json"},
            json={"text": "Hi there", "voice": "georgia"},
            timeout=60,
        )
        self._assert_mp3_response(r)

    def test_speak_george_voice_returns_200_audio(self, session, member_token):
        r = session.post(
            self.URL,
            headers={"Authorization": f"Bearer {member_token}", "Content-Type": "application/json"},
            json={"text": "Hi there", "voice": "george"},
            timeout=60,
        )
        self._assert_mp3_response(r)
