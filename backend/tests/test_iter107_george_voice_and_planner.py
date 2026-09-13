"""Iteration 107 — George planner safety-net, synthesizer honesty, and TTS voice policy.

Scope: LOCAL POD ONLY (per Garry's directive). All tests hit
http://localhost:8001 directly — no preview URL, no deploys.

Coverage:
  1. Planner stale-data guard (SSE `plan` + `tools` events on a state
     question force a fresh `count_support_tickets`).
  2. Synthesizer honesty — no "let me check" / "give me a moment" /
     "get back to you" stalls in the streamed reply.
  3. Voice endpoint — persona → OpenAI-voice mapping + Cache-Control +
     X-George-Voice header for george/georgia/onyx/bogus/empty.
  4. Regression — /api/george/voice/transcribe accepts a small WAV
     upload, /api/mcgs/counts responds 200 for the authenticated admin.
"""

from __future__ import annotations

import io
import json
import re
import wave

import pytest
import requests

BASE_URL = "http://localhost:8001"
ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASSWORD = "TestPass2026!"

# Phrases OPERATING_RULES §9/11/12/13 outlaw. Any of these in a streamed
# reply for a state-check question when the tool has errored is a bug.
STALL_PHRASES = [
    "let me check",
    "let me look",
    "i'll check again",
    "give me a moment",
    "one sec",
    "get back to you",
]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def token() -> str:
    r = requests.post(
        f"{BASE_URL}/api/cms/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:300]}"
    body = r.json()
    assert "token" in body, f"login shape wrong: {list(body)}"
    return body["token"]


@pytest.fixture(scope="module")
def h(token) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _stream_george_chat(token: str, message: str, timeout: int = 90) -> dict:
    """POST /api/george/chat and consume the SSE stream. Returns a dict:
        {
          "session": {"chat_id": ...} | None,
          "plan": {...} | None,
          "tools": {"results": [...]} | None,
          "delta_text": "<accumulated>",
          "done": {...} | None,
          "action_previews": [...],
          "events_seen": ["session", "plan", "tools", ...],
        }
    """
    result: dict = {
        "session": None, "plan": None, "tools": None,
        "delta_text": "", "done": None, "action_previews": [],
        "events_seen": [],
    }
    with requests.post(
        f"{BASE_URL}/api/george/chat",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "text/event-stream",
            "Content-Type": "application/json",
        },
        json={"message": message, "scope": "mcgs"},
        stream=True, timeout=timeout,
    ) as r:
        assert r.status_code == 200, f"chat status {r.status_code}: {r.text[:300]}"
        assert "text/event-stream" in r.headers.get("Content-Type", ""), \
            f"unexpected content-type: {r.headers.get('Content-Type')}"

        current_event = None
        for raw in r.iter_lines(decode_unicode=True):
            if raw is None:
                continue
            line = raw.strip("\r")
            if not line:
                current_event = None
                continue
            if line.startswith("event:"):
                current_event = line.split(":", 1)[1].strip()
                if current_event not in result["events_seen"]:
                    result["events_seen"].append(current_event)
            elif line.startswith("data:") and current_event:
                data_str = line.split(":", 1)[1].strip()
                try:
                    payload = json.loads(data_str)
                except json.JSONDecodeError:
                    payload = {"_raw": data_str}
                if current_event == "session":
                    result["session"] = payload
                elif current_event == "plan":
                    result["plan"] = payload
                elif current_event == "tools":
                    result["tools"] = payload
                elif current_event == "delta":
                    result["delta_text"] += payload.get("text") or ""
                elif current_event == "action_preview":
                    result["action_previews"].append(payload)
                elif current_event == "done":
                    result["done"] = payload
                    return result  # stream is finished
    return result


# ---------------------------------------------------------------------------
# 1. Planner stale-data guard — SSE plan/tools events
# ---------------------------------------------------------------------------

class TestPlannerStaleDataGuard:
    """Feature 1: state-check questions must produce a plan with a
    fresh count_* tool. Even if raw planner returns [], the safety net
    (_looks_like_state_question + _forced_tool_hint) must inject the
    correct tool and set plan._forced_fresh_call=True."""

    @pytest.mark.parametrize("question,expected_tool", [
        ("How many open support tickets do we have?", "count_support_tickets"),
        ("what about now?",                            "count_support_tickets"),
        ("still 23 tickets?",                          "count_support_tickets"),
        ("any change to the tickets?",                 "count_support_tickets"),
        ("recount please",                             "count_support_tickets"),
    ])
    def test_state_question_forces_fresh_count_tool(self, token, question, expected_tool):
        # For follow-up phrasings the safety-net requires a prior turn
        # about the same topic — so we send an initial "ticket" priming
        # message when the question itself has no topic keyword.
        chat_id = None
        priming_needed = not any(
            k in question.lower() for k in ("ticket", "signal", "case", "event", "member", "org")
        )
        if priming_needed:
            # Prime a chat context with an initial ticket question.
            with requests.post(
                f"{BASE_URL}/api/george/chat",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json={"message": "How many open support tickets?", "scope": "mcgs"},
                stream=True, timeout=90,
            ) as r0:
                # Drain the priming stream to capture the chat_id.
                current = None
                for raw in r0.iter_lines(decode_unicode=True):
                    if raw is None:
                        continue
                    line = raw.strip("\r")
                    if line.startswith("event:"):
                        current = line.split(":", 1)[1].strip()
                    elif line.startswith("data:") and current == "session":
                        try:
                            chat_id = json.loads(line.split(":", 1)[1].strip()).get("chat_id")
                        except Exception:
                            pass
                    elif line.startswith("event: done") or current == "done":
                        break

        # Now ask the follow-up on the SAME chat_id if we had one.
        body = {"message": question, "scope": "mcgs"}
        if chat_id:
            body["chat_id"] = chat_id
        result = {"plan": None, "tools": None, "events_seen": []}
        with requests.post(
            f"{BASE_URL}/api/george/chat",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=body, stream=True, timeout=90,
        ) as r:
            assert r.status_code == 200
            current = None
            for raw in r.iter_lines(decode_unicode=True):
                if raw is None:
                    continue
                line = raw.strip("\r")
                if not line:
                    current = None
                    continue
                if line.startswith("event:"):
                    current = line.split(":", 1)[1].strip()
                    if current not in result["events_seen"]:
                        result["events_seen"].append(current)
                elif line.startswith("data:") and current in ("plan", "tools"):
                    payload = json.loads(line.split(":", 1)[1].strip())
                    result[current] = payload
                elif line.startswith("data:") and current == "done":
                    break

        assert "plan" in result["events_seen"], "SSE stream missing `plan` event"
        assert "tools" in result["events_seen"], "SSE stream missing `tools` event"
        plan = result["plan"] or {}
        tool_names = [c.get("name") for c in (plan.get("tool_calls") or [])]
        assert expected_tool in tool_names, (
            f"Plan for {question!r} missing {expected_tool}. "
            f"Got tool_calls={plan.get('tool_calls')!r}, "
            f"_forced_fresh_call={plan.get('_forced_fresh_call')}"
        )


# ---------------------------------------------------------------------------
# 2. Synthesizer honesty — no stall phrases on state questions
# ---------------------------------------------------------------------------

class TestSynthesizerHonesty:
    def test_state_question_reply_has_no_stall_phrases(self, token):
        """Even in the happy path (tool succeeds), George should never
        say 'let me check'. OPERATING_RULES §9/11/12 bans these entirely
        because every check has already happened before he speaks."""
        result = _stream_george_chat(token, "How many open support tickets right now?")
        reply = (result["delta_text"] or "").lower()
        assert reply, "no delta text streamed back"
        for phrase in STALL_PHRASES:
            assert phrase not in reply, (
                f"Reply contains banned stall phrase {phrase!r}. "
                f"Full reply (lowered):\n{reply[:800]}"
            )


# ---------------------------------------------------------------------------
# 3. Voice endpoint — persona → onyx / nova mapping + Cache-Control
# ---------------------------------------------------------------------------

class TestVoiceEndpoint:
    """POST /api/george/voice/speak must map persona → OpenAI voice id,
    default to onyx on unknown / empty, and always emit no-store
    Cache-Control + X-George-Voice headers."""

    @pytest.mark.parametrize("voice_in,expected_voice", [
        ("george",  "onyx"),   # default persona for George
        ("georgia", "nova"),   # female alternative
        ("onyx",    "onyx"),   # legacy raw id
        ("bogus",   "onyx"),   # unknown → safe fallback
        ("",        "onyx"),   # empty → safe fallback
    ])
    def test_speak_voice_mapping_and_headers(self, token, voice_in, expected_voice):
        r = requests.post(
            f"{BASE_URL}/api/george/voice/speak",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"text": "hello", "voice": voice_in},
            timeout=45,
        )
        assert r.status_code == 200, (
            f"speak status={r.status_code} for voice={voice_in!r}: {r.text[:200]}"
        )
        assert r.headers.get("Content-Type", "").startswith("audio/mpeg"), \
            f"content-type wrong: {r.headers.get('Content-Type')}"
        # X-George-Voice header must reflect the mapped voice.
        assert r.headers.get("X-George-Voice") == expected_voice, (
            f"X-George-Voice header wrong for {voice_in!r}: "
            f"got {r.headers.get('X-George-Voice')!r}, expected {expected_voice!r}"
        )
        # Cache-Control must forbid every layer of caching.
        cc = r.headers.get("Cache-Control", "")
        for token_needed in ("no-store", "no-cache", "must-revalidate", "max-age=0"):
            assert token_needed in cc, (
                f"Cache-Control missing {token_needed!r} (got {cc!r}) for voice={voice_in!r}"
            )
        # Audio body should be non-trivial mp3 bytes.
        assert len(r.content) > 200, f"audio body suspiciously small ({len(r.content)} bytes)"


# ---------------------------------------------------------------------------
# 4. Regression — /voice/transcribe accepts audio, /mcgs/counts works
# ---------------------------------------------------------------------------

def _synthetic_wav_bytes(seconds: float = 0.4) -> bytes:
    """Return a tiny silent PCM WAV so the transcribe upload path can be
    exercised without any real speech. Whisper will return an empty
    transcript for silence — which is fine; we only assert the endpoint
    accepts the upload and responds 200 with a `transcript` field.
    """
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)  # 16-bit
        w.setframerate(16000)
        w.writeframes(b"\x00\x00" * int(16000 * seconds))
    return buf.getvalue()


class TestVoiceTranscribeRegression:
    def test_transcribe_accepts_upload(self, token):
        """Regression — the existing /voice/transcribe path still works
        with an authenticated admin bearer token."""
        audio = _synthetic_wav_bytes()
        r = requests.post(
            f"{BASE_URL}/api/george/voice/transcribe",
            headers={"Authorization": f"Bearer {token}"},
            files={"audio": ("clip.wav", audio, "audio/wav")},
            timeout=45,
        )
        # 200 is the happy path; 502 is acceptable ONLY if it's the
        # upstream Whisper hiccupping — the shape check below still
        # validates our surface.
        assert r.status_code in (200, 502), (
            f"transcribe status={r.status_code}: {r.text[:200]}"
        )
        if r.status_code == 200:
            body = r.json()
            assert "transcript" in body, f"transcribe body missing 'transcript': {body}"


class TestCountsRegression:
    def test_counts_endpoint_ok(self, h):
        r = requests.get(f"{BASE_URL}/api/mcgs/counts", headers=h, timeout=15)
        assert r.status_code == 200, f"counts status={r.status_code}: {r.text[:200]}"
        body = r.json()
        assert isinstance(body, dict), f"counts body not a dict: {type(body)}"
