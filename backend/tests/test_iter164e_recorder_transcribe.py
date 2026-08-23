"""iter164e verification — Safari-safe voice pipeline & transcribe endpoint.

Covers:
  - A3: /api/george/voice/transcribe accepts clip.m4a (Safari path)
  - A4: /api/george/voice/transcribe accepts clip.webm (regression Chrome/FF)
  - A5: iter164c silence guards still fire (empty, sub-2KB)
"""

import os
import io
import requests
import pytest

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "http://localhost:8001").rstrip("/")

ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASS = "TestPass2026!"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{BASE_URL}/api/cms/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    tok = r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def tts_mp3_bytes(admin_token):
    """Get real audio bytes via /api/george/voice/speak so the STT
    endpoint has something intelligible to transcribe."""
    r = requests.post(
        f"{BASE_URL}/api/george/voice/speak",
        headers={
            "Authorization": f"Bearer {admin_token}",
            "Content-Type": "application/json",
        },
        json={"text": "Hello George, this is a test.", "voice": "george", "speed": 0.95},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    assert len(r.content) > 2048, f"TTS payload too small: {len(r.content)}"
    return r.content


class TestTranscribeExtensionAcceptance:
    """A3 + A4: backend accepts m4a AND webm filename extensions."""

    def test_a3_m4a_extension_accepted(self, admin_token, tts_mp3_bytes):
        # Post the MP3 bytes with .m4a filename — Whisper's SDK figures
        # out the actual container, we only need the endpoint to NOT 502
        # on the extension itself.
        files = {"audio": ("clip.m4a", io.BytesIO(tts_mp3_bytes), "audio/mp4")}
        r = requests.post(
            f"{BASE_URL}/api/george/voice/transcribe",
            headers={"Authorization": f"Bearer {admin_token}"},
            files=files,
            timeout=60,
        )
        assert r.status_code == 200, f"m4a upload failed: {r.status_code} {r.text}"
        j = r.json()
        assert "transcript" in j
        # Real speech present → non-empty transcript
        assert isinstance(j["transcript"], str)
        assert len(j["transcript"].strip()) > 0, f"empty transcript for m4a: {j}"

    def test_a4_webm_extension_accepted(self, admin_token, tts_mp3_bytes):
        files = {"audio": ("clip.webm", io.BytesIO(tts_mp3_bytes), "audio/webm")}
        r = requests.post(
            f"{BASE_URL}/api/george/voice/transcribe",
            headers={"Authorization": f"Bearer {admin_token}"},
            files=files,
            timeout=60,
        )
        assert r.status_code == 200, f"webm upload failed: {r.status_code} {r.text}"
        j = r.json()
        assert "transcript" in j
        assert isinstance(j["transcript"], str)
        assert len(j["transcript"].strip()) > 0, f"empty transcript for webm: {j}"


class TestSilenceGuardsStillFire:
    """A5: iter164c silence guards must still return empty transcript."""

    def test_empty_payload_returns_empty(self, admin_token):
        files = {"audio": ("clip.webm", io.BytesIO(b""), "audio/webm")}
        r = requests.post(
            f"{BASE_URL}/api/george/voice/transcribe",
            headers={"Authorization": f"Bearer {admin_token}"},
            files=files,
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json() == {"transcript": ""}

    def test_sub_2kb_payload_rejected(self, admin_token):
        # 1KB of noise-like bytes — under the 2 KB threshold
        files = {"audio": ("clip.webm", io.BytesIO(b"\x00" * 1024), "audio/webm")}
        r = requests.post(
            f"{BASE_URL}/api/george/voice/transcribe",
            headers={"Authorization": f"Bearer {admin_token}"},
            files=files,
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json() == {"transcript": ""}
