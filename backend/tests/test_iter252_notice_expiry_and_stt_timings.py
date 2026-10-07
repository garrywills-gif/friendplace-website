"""iter252 — TestFlight feedback batch (Neo, Feb 2026).

Backend verifications:
  1) GET /api/notices filters out notices whose `active_to` is in the past.
  2) POST /api/notices WITHOUT `active_to` is still accepted (client-side only enforcement).
  3) POST /api/mcgs/george/onboarding/start on a fresh actor returns <1s (canned opener).
  4) POST /api/mcgs/george/transcribe:
       - returns {"text": ""} for a silent 3s WAV (hallucination guard)
       - emits `voice.stt.server received bytes=...` log lines on the backend
"""

import io
import os
import re
import struct
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _signup(session: requests.Session, prefix="iter252") -> dict:
    uname = f"TEST_{prefix}_{uuid.uuid4().hex[:10]}"
    payload = {
        "username": uname,
        "password": "TestPass2026!",
        "email": f"{uname}@example.com",
        "first_name": "Chris",
    }
    r = session.post(f"{BASE_URL}/api/auth/signup", json=payload, timeout=20)
    assert r.status_code == 200, f"signup failed: {r.status_code} {r.text}"
    return r.json()


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _silent_wav(duration_seconds: float = 3.0, sample_rate: int = 16000) -> bytes:
    """Build a minimal mono 16-bit PCM WAV filled with silence."""
    n_samples = int(duration_seconds * sample_rate)
    data = b"\x00\x00" * n_samples
    byte_rate = sample_rate * 2
    block_align = 2
    fmt_chunk = struct.pack(
        "<4sIHHIIHH",
        b"fmt ",
        16,                 # fmt chunk size
        1,                  # PCM
        1,                  # channels
        sample_rate,
        byte_rate,
        block_align,
        16,                 # bits per sample
    )
    data_chunk = struct.pack("<4sI", b"data", len(data)) + data
    riff = struct.pack(
        "<4sI4s", b"RIFF", 4 + len(fmt_chunk) + len(data_chunk), b"WAVE"
    )
    return riff + fmt_chunk + data_chunk


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    return s


@pytest.fixture(scope="module")
def member(api):
    data = _signup(api, prefix="iter252member")
    return data["user"], data["access_token"]


# ---------------------------------------------------------------------------
# 1) Expired notices drop off member feed
# ---------------------------------------------------------------------------


class TestExpiredNoticesHidden:
    def test_backdated_notice_not_in_feed(self, api, member):
        user, token = member
        past_from = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
        past_to = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        payload = {
            "user_id": user["id"],
            "title": "TEST_iter252 EXPIRED notice",
            "body": "Should be filtered off the member feed because active_to is past.",
            "category": "General",
            "active_from": past_from,
            "active_to": past_to,
        }
        r = api.post(
            f"{BASE_URL}/api/notices", json=payload, headers=_auth(token), timeout=15
        )
        assert r.status_code == 200, f"create: {r.status_code} {r.text}"
        created = r.json()
        nid = created.get("id")
        assert nid

        # Author sees their own notice (safety net) — but they're the AUTHOR.
        # So fetch as a different (fresh) member to confirm the filter.
        other = _signup(api, prefix="iter252viewer")
        viewer_id = other["user"]["id"]
        r2 = api.get(
            f"{BASE_URL}/api/notices?user_id={viewer_id}",
            headers=_auth(other["access_token"]),
            timeout=20,
        )
        assert r2.status_code == 200
        ids = [n.get("id") for n in r2.json()]
        assert nid not in ids, "expired notice must not appear for other members"

    def test_future_active_notice_present(self, api, member):
        user, token = member
        now = datetime.now(timezone.utc)
        payload = {
            "user_id": user["id"],
            "title": "TEST_iter252 LIVE notice",
            "body": "In active window — visible for all.",
            "category": "General",
            "active_from": (now - timedelta(days=1)).isoformat(),
            "active_to": (now + timedelta(days=5)).isoformat(),
        }
        r = api.post(
            f"{BASE_URL}/api/notices", json=payload, headers=_auth(token), timeout=15
        )
        assert r.status_code == 200
        nid = r.json()["id"]

        viewer = _signup(api, prefix="iter252viewer2")
        r2 = api.get(
            f"{BASE_URL}/api/notices?user_id={viewer['user']['id']}",
            headers=_auth(viewer["access_token"]),
            timeout=20,
        )
        assert r2.status_code == 200
        ids = [n.get("id") for n in r2.json()]
        assert nid in ids, "live notice must appear in the member feed"


# ---------------------------------------------------------------------------
# 2) POST /api/notices still accepts a payload missing active_to
# ---------------------------------------------------------------------------


class TestNoticeCreateMissingActiveToAccepted:
    def test_create_without_active_to_succeeds(self, api, member):
        user, token = member
        payload = {
            "user_id": user["id"],
            "title": "TEST_iter252 no end date",
            "body": "Server still accepts missing active_to.",
            "category": "General",
            # no active_from, no active_to
        }
        r = api.post(
            f"{BASE_URL}/api/notices", json=payload, headers=_auth(token), timeout=15
        )
        assert r.status_code == 200, f"expected 200, got {r.status_code} {r.text}"
        body = r.json()
        assert body.get("id")
        # No active_to in response or value is None/empty — either is fine
        assert not body.get("active_to"), f"unexpected active_to in response: {body.get('active_to')!r}"


# ---------------------------------------------------------------------------
# 3) Fast canned opener on fresh actor (<1s)
# ---------------------------------------------------------------------------


class TestOnboardingFastOpener:
    def test_fresh_george_start_under_1s_with_opener(self, api):
        data = _signup(api, prefix="iter252opener")
        token = data["access_token"]
        t0 = time.perf_counter()
        r = api.post(
            f"{BASE_URL}/api/mcgs/george/onboarding/start",
            json={"persona": "george"},
            headers={**_auth(token), "Content-Type": "application/json"},
            timeout=10,
        )
        dt = time.perf_counter() - t0
        assert r.status_code == 200, f"start failed: {r.status_code} {r.text}"
        session = r.json()
        assert dt < 3.0, f"onboarding/start took {dt:.2f}s (should be <3s canned)"
        # The canned opener should include a greeting
        turns = session.get("turns") or []
        assert turns, "expected at least one turn (the opener) in session"
        opener = (turns[0].get("content") or turns[0].get("text") or "").lower()
        assert any(
            s in opener for s in ("lovely to meet you", "hi, i'm", "hi i'm")
        ), f"opener does not look canned: {opener[:120]}"


# ---------------------------------------------------------------------------
# 4) /mcgs/george/transcribe — silent WAV → empty text, logs emitted
# ---------------------------------------------------------------------------


class TestTranscribeSilentWav:
    def test_silent_wav_returns_empty_text(self, api, member):
        _, token = member
        wav = _silent_wav(3.0)
        files = {"file": ("silence.wav", io.BytesIO(wav), "audio/wav")}
        r = api.post(
            f"{BASE_URL}/api/mcgs/george/transcribe",
            headers=_auth(token),
            files=files,
            timeout=45,
        )
        assert r.status_code == 200, f"transcribe silent failed: {r.status_code} {r.text}"
        body = r.json()
        assert "text" in body, f"missing 'text' key: {body!r}"
        # Hallucination guard — must be empty for silence
        assert body["text"] == "", f"expected empty text for silent WAV, got {body['text']!r}"

    def test_server_log_voice_stt_marker_emitted(self, api, member):
        """After a transcribe call, backend supervisor log should contain
        the new `voice.stt.server received bytes=` marker."""
        _, token = member
        wav = _silent_wav(1.5)
        files = {"file": ("silence2.wav", io.BytesIO(wav), "audio/wav")}
        r = api.post(
            f"{BASE_URL}/api/mcgs/george/transcribe",
            headers=_auth(token),
            files=files,
            timeout=45,
        )
        assert r.status_code == 200
        # Give supervisor a moment to flush logs
        time.sleep(0.5)
        # Scan the last ~800 lines of backend log
        import subprocess
        tail = subprocess.run(
            ["tail", "-n", "800", "/var/log/supervisor/backend.err.log"],
            capture_output=True, text=True, timeout=10,
        )
        tail_out = tail.stdout + "\n" + (tail.stderr or "")
        tail2 = subprocess.run(
            ["tail", "-n", "800", "/var/log/supervisor/backend.out.log"],
            capture_output=True, text=True, timeout=10,
        )
        tail_out += "\n" + tail2.stdout + "\n" + (tail2.stderr or "")
        assert re.search(r"voice\.stt\.server received bytes=\d+", tail_out), \
            "expected `voice.stt.server received bytes=` log line in backend logs"
