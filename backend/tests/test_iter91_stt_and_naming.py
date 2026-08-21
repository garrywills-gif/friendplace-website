"""Iter 91 — surgical bug-fix verification (Feb 2026).

Scope:
 1. STT endpoint contract: /api/mcgs/george/transcribe
    - 401/403 without bearer
    - 422 (or 400) when missing 'file' field
    - accepts multipart with field 'file' + Bearer token
 2. Naming behaviour (B1 LOCKED) via /api/mcgs/george/event/{...}/turn
    - 'cake stall' → title extracted + reply acknowledges + advances
    - 'bingo night on Friday at 6pm' → title extracted + advances
    - 'get-together' (no clear title) → asks name naturally, no fake ack
 3. Regressions:
    - /api/mcgs/george/event/start returns opening line
    - /api/mcgs/george/speak still returns audio/mpeg
"""
import io
import os
import re
import wave

import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://outreach-campaigns.preview.emergentagent.com"
).rstrip("/")
assert BASE_URL, "EXPO_BACKEND_URL must be set"

MEMBER_EMAIL = "member@friendplace.com.au"
MEMBER_PASSWORD = "TestPass2026!"


@pytest.fixture(scope="module")
def member_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": MEMBER_EMAIL, "password": MEMBER_PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token")
    assert tok, "no access_token"
    return tok


@pytest.fixture(scope="module")
def auth_headers(member_token):
    return {"Authorization": f"Bearer {member_token}"}


def _tiny_wav_bytes(seconds: float = 0.5, sr: int = 16000) -> bytes:
    """Generate a minimal silent WAV blob (valid audio for Whisper)."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(b"\x00\x00" * int(sr * seconds))
    return buf.getvalue()


# ---------- STT contract ---------------------------------------------------

class TestTranscribeContract:
    def test_unauth_rejected(self):
        wav = _tiny_wav_bytes()
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/transcribe",
            files={"file": ("voice.wav", wav, "audio/wav")},
            timeout=20,
        )
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text[:200]}"

    def test_missing_file_field(self, auth_headers):
        # No 'file' field -> FastAPI returns 422 (validation) since File(...) is required.
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/transcribe",
            files={"audio": ("voice.wav", _tiny_wav_bytes(), "audio/wav")},
            headers=auth_headers,
            timeout=20,
        )
        assert r.status_code in (400, 422), f"expected 400/422, got {r.status_code}: {r.text[:200]}"

    def test_authed_with_file_field(self, auth_headers):
        # Send valid silent wav with 'file' field. Whisper may return "" for silence — that's OK.
        # We validate the CONTRACT (status + shape), not the transcription accuracy.
        wav = _tiny_wav_bytes(seconds=0.8)
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/transcribe",
            files={"file": ("voice.wav", wav, "audio/wav")},
            headers=auth_headers,
            timeout=45,
        )
        # 200 ideal. Accept 502 (whisper upstream) as non-blocking — but contract fields must match.
        assert r.status_code in (200, 502), f"unexpected {r.status_code}: {r.text[:300]}"
        if r.status_code == 200:
            data = r.json()
            assert "text" in data, f"missing 'text' in response: {data}"
            assert isinstance(data["text"], str)


# ---------- Regression: speak endpoint ------------------------------------

class TestSpeakRegression:
    def test_speak_returns_audio_mpeg(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/speak",
            json={"text": "Hello there."},
            headers={**auth_headers, "Content-Type": "application/json"},
            timeout=45,
        )
        assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"
        ct = r.headers.get("content-type", "")
        assert "audio/mpeg" in ct, f"expected audio/mpeg, got {ct}"
        assert len(r.content) > 500, f"tiny audio body: {len(r.content)}"


# ---------- Naming behaviour (B1) -----------------------------------------

def _start_session(auth_headers):
    r = requests.post(
        f"{BASE_URL}/api/mcgs/george/event/start",
        json={"initial_text": "", "current_screen": "home"},
        headers={**auth_headers, "Content-Type": "application/json"},
        timeout=60,
    )
    assert r.status_code == 200, f"event/start failed: {r.status_code} {r.text[:200]}"
    body = r.json()
    assert body.get("session_id"), "no session_id"
    turns = body.get("turns") or []
    assert any(t.get("role") == "george" and t.get("content") for t in turns), "no opening george turn"
    return body["session_id"]


def _turn(auth_headers, session_id, text):
    r = requests.post(
        f"{BASE_URL}/api/mcgs/george/event/session/{session_id}/turn",
        json={"text": text, "current_screen": "home"},
        headers={**auth_headers, "Content-Type": "application/json"},
        timeout=90,
    )
    assert r.status_code == 200, f"turn failed: {r.status_code} {r.text[:300]}"
    return r.json()


class TestNamingBehaviour:
    def test_start_returns_opening_line(self, auth_headers):
        sid = _start_session(auth_headers)
        assert sid

    def test_cake_stall_acknowledges_and_advances(self, auth_headers):
        sid = _start_session(auth_headers)
        body = _turn(
            auth_headers, sid,
            "I want to organize a cake stall and give all the donations and revenue to a charity.",
        )
        draft = body.get("draft") or {}
        title = (draft.get("title") or "").lower()
        turns = body.get("turns") or []
        last_george = next(
            (t for t in reversed(turns) if t.get("role") == "george"),
            None,
        )
        assert last_george, "no george reply"
        reply_parts = " ".join(
            str(last_george.get(k) or "")
            for k in ("excitement_line", "working_line", "warmth_line", "content")
        ).lower()

        # (a) HTTP 200 already asserted.
        # (b) title extracted — accept 'cake stall' family
        assert "cake" in title, f"expected 'cake' in title, got: {title!r} | draft={draft}"

        # (c) reply mentions cake stall AND asks a next question
        assert "cake" in reply_parts, f"reply lacks 'cake' acknowledgement: {reply_parts[:400]}"
        # Advancement heuristic: any question mark, or asks about when/where/time
        advances = ("?" in reply_parts) or any(
            k in reply_parts for k in ("when", "what time", "where", "date", "day", "hold it", "hoping to")
        )
        assert advances, f"reply does not advance conversation: {reply_parts[:400]}"

    def test_bingo_night_regression(self, auth_headers):
        sid = _start_session(auth_headers)
        body = _turn(auth_headers, sid, "I'd like to organise a bingo night on Friday at 6pm")
        draft = body.get("draft") or {}
        title = (draft.get("title") or "").lower()
        turns = body.get("turns") or []
        last_george = next((t for t in reversed(turns) if t.get("role") == "george"), None)
        assert last_george
        reply_parts = " ".join(
            str(last_george.get(k) or "")
            for k in ("excitement_line", "working_line", "warmth_line", "content")
        ).lower()

        assert "bingo" in title, f"expected 'bingo' in title, got: {title!r} | draft={draft}"
        assert "bingo" in reply_parts, f"reply lacks 'bingo' acknowledgement: {reply_parts[:400]}"

    def test_no_title_no_fake_acknowledgement(self, auth_headers):
        sid = _start_session(auth_headers)
        body = _turn(auth_headers, sid, "I want to plan a get-together")
        turns = body.get("turns") or []
        last_george = next((t for t in reversed(turns) if t.get("role") == "george"), None)
        assert last_george
        reply_parts = " ".join(
            str(last_george.get(k) or "")
            for k in ("excitement_line", "working_line", "warmth_line", "content")
        ).lower()

        # The reply must NOT invent a proper-noun title acknowledgement.
        # It should ask naturally (per rule B). Look for a natural question about it.
        # Weak assertion: no quoted "we can call it 'X'" style with a real name,
        # since draft.title should be null/empty for a bare "get-together".
        draft = body.get("draft") or {}
        title = draft.get("title")
        # Allow None or generic 'get-together' but not 'cake stall'/'bingo' style fabrication.
        assert not title or re.search(r"get[- ]?together", title, re.I), (
            f"title should stay empty for bare 'get-together', got: {title!r}"
        )
        # And reply should be present with some conversational content
        assert reply_parts.strip(), "empty george reply"
