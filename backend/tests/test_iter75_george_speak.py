"""Iteration 75 — George TTS `/speak` endpoint and Mission Control mobile entry.

Focus: verify the C1 Voice Phase 2 fix — the Pydantic `GeorgeSpeakIn`
model was moved to module level so FastAPI resolves it as a body model
(previously nested inside `build_router()` and 422'd every call).
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "https://friendplace-v1.preview.emergentagent.com").rstrip("/")

MEMBER_EMAIL = "member@friendplace.com.au"
MEMBER_PASSWORD = "TestPass2026!"


@pytest.fixture(scope="module")
def member_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": MEMBER_EMAIL, "password": MEMBER_PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    return data["access_token"]


@pytest.fixture(scope="module")
def auth_headers(member_token):
    return {"Authorization": f"Bearer {member_token}"}


class TestGeorgeSpeak:
    """POST /api/mcgs/george/speak — TTS endpoint."""

    def test_speak_default_voice(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/speak",
            json={"text": "Hello Alex, welcome to FriendPlace."},
            headers=auth_headers,
            timeout=60,
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text[:300]}"
        assert r.headers.get("content-type", "").startswith("audio/mpeg")
        assert len(r.content) > 1000, "MP3 payload should be non-trivially large"

    def test_speak_voice_george(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/speak",
            json={"text": "Testing George persona.", "voice": "george"},
            headers=auth_headers,
            timeout=60,
        )
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        assert r.headers.get("content-type", "").startswith("audio/mpeg")
        assert len(r.content) > 1000

    def test_speak_voice_georgia(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/speak",
            json={"text": "Testing Georgia persona.", "voice": "georgia"},
            headers=auth_headers,
            timeout=60,
        )
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        assert r.headers.get("content-type", "").startswith("audio/mpeg")
        assert len(r.content) > 1000

    def test_speak_empty_text_returns_422(self, auth_headers):
        # Pydantic min_length=1 fires a 422 (validation error), not 400.
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/speak",
            json={"text": ""},
            headers=auth_headers,
            timeout=30,
        )
        assert r.status_code in (400, 422), f"Expected 400/422, got {r.status_code}"

    def test_speak_missing_body_returns_422_body_level(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/speak",
            headers=auth_headers,
            timeout=30,
        )
        assert r.status_code == 422
        detail = r.json().get("detail", [])
        # Regression: pre-fix, loc was ['query','body']. After fix, loc must
        # be a body-level error (e.g. ['body'] or ['body','text']).
        if isinstance(detail, list) and detail:
            locs = [tuple(item.get("loc", [])) for item in detail]
            for loc in locs:
                assert loc and loc[0] == "body", (
                    f"Expected body-level error loc, got {loc}. "
                    f"This indicates the query.body bug has regressed."
                )

    def test_speak_unauthorised_401(self):
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/speak",
            json={"text": "hi"},
            timeout=30,
        )
        assert r.status_code == 401


class TestGeorgeTranscribeRegression:
    """Import graph should still work — transcribe endpoint remains reachable."""

    def test_transcribe_requires_auth(self):
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/transcribe",
            timeout=30,
        )
        assert r.status_code == 401

    def test_transcribe_empty_multipart_400(self, auth_headers):
        # No file uploaded -> FastAPI returns 422 (missing file part).
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/transcribe",
            headers=auth_headers,
            timeout=30,
        )
        assert r.status_code in (400, 422)
