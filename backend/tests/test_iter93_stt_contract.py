"""
iter93 — quick regression that the George STT endpoint contract is unchanged.
POST /api/mcgs/george/transcribe must still:
  - 401/403 without Bearer
  - 422 (or 400) without `file` field with a valid Bearer
  - 200 {text: string} with valid file + Bearer
"""
import io
import os
import struct
import wave

import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL") or os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL", "https://outreach-campaigns.preview.emergentagent.com"
)
BASE_URL = BASE_URL.rstrip("/")

MEMBER_EMAIL = "member@friendplace.com.au"
MEMBER_PW = "TestPass2026!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"username": MEMBER_EMAIL, "password": MEMBER_PW},
                      timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _one_second_wav_bytes() -> bytes:
    """Generate a valid 1-second silent WAV so multipart parsing succeeds."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x00\x00" * 16000)
    return buf.getvalue()


def test_transcribe_requires_bearer():
    r = requests.post(f"{BASE_URL}/api/mcgs/george/transcribe",
                      files={"file": ("x.wav", b"\x00" * 1024, "audio/wav")},
                      timeout=15)
    assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code} {r.text}"


def test_transcribe_missing_file_field(token):
    r = requests.post(f"{BASE_URL}/api/mcgs/george/transcribe",
                      headers={"Authorization": f"Bearer {token}"},
                      data={"nothing": "here"},
                      timeout=15)
    assert r.status_code in (400, 422), f"expected 400/422, got {r.status_code} {r.text}"


def test_transcribe_happy_path_contract(token):
    """We don't care what the transcript says — just that the endpoint
    accepts the multipart upload and returns {text: <string>}."""
    r = requests.post(f"{BASE_URL}/api/mcgs/george/transcribe",
                      headers={"Authorization": f"Bearer {token}"},
                      files={"file": ("voice.wav", _one_second_wav_bytes(), "audio/wav")},
                      timeout=45)
    # Whisper may return "" for silence, or a short transcript.
    assert r.status_code == 200, f"got {r.status_code} {r.text}"
    body = r.json()
    assert "text" in body
    assert isinstance(body["text"], str)
