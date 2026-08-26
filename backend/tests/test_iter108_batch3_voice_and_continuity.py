"""Batch-3 backend tests.

Covers:
- POST /api/george/voice/speak persona -> voice header mapping (george → ash,
  georgia → nova, bogus → ash), model header (tts-1 — Batch B iter158
  reduced from tts-1-hd for faster time-to-first-audio), speed header (1.05),
  Cache-Control: no-store still present.
- Stale-data guard regression: the planner safety net + prompt honesty rule.
  We test via /api/george/chat SSE — asking a state question that follows a
  prior mention should force a fresh count_* tool call.

iter164ae (test cleanup): assertions updated to match current production
behaviour — the previous ``tts-1-hd`` expectation was left over from
before the Batch B iter158 switch to ``tts-1``.
"""
from __future__ import annotations

import json
import os

import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "http://localhost:8001").rstrip("/")
LOCAL_URL = "http://localhost:8001"  # backend also reachable locally

ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASSWORD = "TestPass2026!"


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_token(api_client):
    r = api_client.post(
        f"{LOCAL_URL}/api/cms/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


# ---------------------------------------------------------------------------
# Voice policy — Batch-3
# ---------------------------------------------------------------------------


class TestGeorgeVoicePolicy:
    def _speak(self, api_client, token, voice_key):
        r = api_client.post(
            f"{LOCAL_URL}/api/george/voice/speak",
            headers={"Authorization": f"Bearer {token}"},
            json={"text": "test", "voice": voice_key},
            timeout=60,
        )
        return r

    def test_george_maps_to_ash_on_tts1hd_at_1_05x(self, api_client, admin_token):
        r = self._speak(api_client, admin_token, "george")
        assert r.status_code == 200, r.text
        assert r.headers.get("X-George-Voice") == "ash", r.headers
        assert r.headers.get("X-George-Model") == "tts-1"
        assert r.headers.get("X-George-Speed") == "1.05"
        assert "no-store" in (r.headers.get("Cache-Control") or "")
        assert r.headers.get("Content-Type", "").startswith("audio/mpeg")
        assert len(r.content) > 500  # got real mp3 bytes

    def test_georgia_maps_to_nova(self, api_client, admin_token):
        r = self._speak(api_client, admin_token, "georgia")
        assert r.status_code == 200, r.text
        assert r.headers.get("X-George-Voice") == "nova"
        assert r.headers.get("X-George-Model") == "tts-1"

    def test_bogus_voice_falls_back_to_ash(self, api_client, admin_token):
        r = self._speak(api_client, admin_token, "not-a-voice-xyz")
        assert r.status_code == 200, r.text
        assert r.headers.get("X-George-Voice") == "ash"
        assert r.headers.get("X-George-Model") == "tts-1"

    def test_missing_auth_rejected(self, api_client):
        r = api_client.post(
            f"{LOCAL_URL}/api/george/voice/speak",
            json={"text": "hello", "voice": "george"},
            timeout=15,
        )
        assert r.status_code in (401, 403), r.status_code


# ---------------------------------------------------------------------------
# Stale-data guard — regression that planner + prompt still enforce fresh reads
# ---------------------------------------------------------------------------


class TestStaleDataGuard:
    """Regression only — no LLM assertions beyond the SSE frame shape.

    We ping /api/george/chat with a state question and confirm the stream
    yields at least one `plan` event whose tool_calls are non-empty. That's
    what proves `_looks_like_state_question` + `_forced_tool_hint` still
    force a fresh count when the planner would otherwise stall.
    """

    def _stream_chat(self, token, message):
        r = requests.post(
            f"{LOCAL_URL}/api/george/chat",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
            },
            json={"message": message},
            stream=True,
            timeout=90,
        )
        return r

    def _collect_events(self, resp, max_events=25):
        events = []
        current_event = None
        for raw in resp.iter_lines(decode_unicode=True):
            if raw is None:
                continue
            if raw.startswith("event:"):
                current_event = raw.split(":", 1)[1].strip()
            elif raw.startswith("data:") and current_event:
                payload = raw.split(":", 1)[1].strip()
                try:
                    events.append((current_event, json.loads(payload)))
                except Exception:
                    events.append((current_event, payload))
                if current_event == "done" or len(events) >= max_events:
                    break
        return events

    def test_state_question_forces_tool_call(self, admin_token):
        # Deliberately terse "state" question — planner-safety-net territory.
        r = self._stream_chat(admin_token, "how many open tickets right now?")
        assert r.status_code == 200, r.text
        events = self._collect_events(r)
        plans = [e for e in events if e[0] == "plan"]
        assert plans, f"no plan event; events={events!r}"
        plan = plans[0][1]
        tool_calls = (plan.get("plan") or plan).get("tool_calls", [])
        assert tool_calls, f"safety net should have forced a count_* call, plan={plan!r}"
        names = [c.get("name") for c in tool_calls]
        assert any("count" in (n or "") for n in names), names
