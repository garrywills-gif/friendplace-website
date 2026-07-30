"""Iteration 122 — surface_context wiring end-to-end for George chat.

Covers the three backend scenarios called out by Garry:

1. `POST /api/george/chat` accepts a `surface_context` payload (200, SSE `done`).
2. When surface_context includes member name + specific counts + a recent action,
   George's streamed reply names the member, cites at least one specific count,
   and references the recent-action reason — WITHOUT asking "which member?".
3. Backward compatibility: identical POST with no `surface_context` still returns
   a valid SSE stream (does not 400).
"""
from __future__ import annotations

import json
import os
import re

import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "http://localhost:8001").rstrip("/")
ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASSWORD = "TestPass2026!"

MARGARET_SURFACE = {
    "surface": "member_profile",
    "member": {
        "id": "test-member-margaret",
        "display_name": "Margaret Smith",
        "email": "margaret.smith@example.com",
        "username": "margaret",
        "status": "restricted",
    },
    "counts": {
        "reports_open": 2,
        "reports_total": 4,
        "warnings": 3,
        "suspensions": 1,
        "bans": 0,
        "notes": 5,
        "actions_total": 9,
        "last_action": "suspend",
        "last_action_at": "2026-01-10T09:00:00Z",
    },
    "recent_actions": [
        {
            "action": "suspend",
            "at": "2026-01-10T09:00:00Z",
            "by": "Garry",
            "duration_hours": 24,
            "reason": "inappropriate language in a Coffee Lounge post",
        },
        {
            "action": "warn",
            "at": "2026-01-05T15:00:00Z",
            "by": "Garry",
            "reason": "off-topic in Coffee Lounge",
        },
    ],
    "recent_reports": [
        {"id": "r-101", "status": "open", "reason": "rude comment", "at": "2026-01-11T12:00:00Z", "urgent": False},
    ],
}


# ---- fixtures ---------------------------------------------------------------

@pytest.fixture(scope="module")
def admin_token() -> str:
    r = requests.post(
        f"{BASE_URL}/api/cms/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:300]}"
    body = r.json()
    tok = body.get("token") or body.get("access_token")
    assert tok, f"no token in login body: {body}"
    return tok


def _post_chat_stream(token: str, payload: dict, timeout: int = 90) -> dict:
    """POST /api/george/chat and drain the SSE stream. Returns a dict:
        {"raw": full_text, "events": [(event, data), ...], "reply": joined_delta_text}
    """
    r = requests.post(
        f"{BASE_URL}/api/george/chat",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
        json=payload,
        stream=True,
        timeout=timeout,
    )
    assert r.status_code == 200, f"chat POST failed: {r.status_code} {r.text[:400]}"

    events: list[tuple[str, str]] = []
    deltas: list[str] = []
    buf_event = "message"
    buf_data: list[str] = []
    saw_done = False
    for raw in r.iter_lines(decode_unicode=True):
        if raw is None:
            continue
        if raw == "":
            # dispatch
            if buf_data:
                data = "\n".join(buf_data)
                events.append((buf_event, data))
                if buf_event == "delta":
                    try:
                        deltas.append(json.loads(data).get("text") or "")
                    except Exception:
                        pass
                if buf_event == "done":
                    saw_done = True
            buf_event = "message"
            buf_data = []
            if saw_done:
                break
            continue
        if raw.startswith("event: "):
            buf_event = raw[len("event: "):].strip()
        elif raw.startswith("data: "):
            buf_data.append(raw[len("data: "):])
        elif raw.startswith(":"):
            continue
    return {"events": events, "reply": "".join(deltas)}


# ---- Test 1: endpoint accepts surface_context ------------------------------

def test_endpoint_accepts_surface_context(admin_token):
    """Baseline: request with surface_context returns a valid SSE stream ending in `done`."""
    result = _post_chat_stream(
        admin_token,
        {"message": "Say hello briefly.", "surface_context": MARGARET_SURFACE},
    )
    kinds = [k for k, _ in result["events"]]
    assert "session" in kinds, f"missing session event: {kinds}"
    assert "done" in kinds, f"missing done event: {kinds}"
    assert result["reply"].strip(), "empty reply text"


# ---- Test 2: George uses the context ---------------------------------------

_NEGATIVE_PHRASES = [
    r"which member",
    r"who (is|are) (this|you) (about|referring)",
    r"could you tell me which",
    r"can you tell me which member",
    r"which user are you",
    r"who are you asking about",
    r"which one are you",
]


def test_george_uses_surface_context(admin_token):
    """George should name Margaret, cite a specific count, and reference the recent-action reason,
    without asking which member is meant."""
    result = _post_chat_stream(
        admin_token,
        {
            "message": "Summarise this member's moderation history in plain words.",
            "surface_context": MARGARET_SURFACE,
        },
    )
    reply = result["reply"].strip()
    assert reply, "empty reply"
    reply_l = reply.lower()

    # 1. Does NOT ask "which member?"
    for pat in _NEGATIVE_PHRASES:
        assert not re.search(pat, reply_l), (
            f"George asked a clarifying identity question ({pat!r}) even though "
            f"surface_context named Margaret Smith. Reply was:\n{reply}"
        )

    # 2. Names the member — accept "Margaret" or "Margaret Smith" or "@margaret".
    assert re.search(r"\bmargaret\b", reply_l), (
        f"reply does not mention Margaret by name.\nReply:\n{reply}"
    )

    # 3. Cites at least ONE specific number / duration from the counts.
    #    Accept any of: 3 warnings, 1 suspension, 2 open reports, 5 notes, 9 actions,
    #    24 hour(s) / 24-hour suspension.
    specific_hits = [
        r"\b3\b[^\n]{0,20}warn",
        r"\b1\b[^\n]{0,20}suspen",
        r"one[- ]?time[^\n]{0,10}suspen",
        r"\b2\b[^\n]{0,20}(open |unresolved )?report",
        r"\b5\b[^\n]{0,20}note",
        r"\b9\b[^\n]{0,20}action",
        r"24[- ]?hour",
        r"twenty[- ]?four[- ]?hour",
    ]
    assert any(re.search(pat, reply_l) for pat in specific_hits), (
        f"reply does not cite any specific count / duration from surface_context.\nReply:\n{reply}"
    )

    # 4. References the specific reason from recent_actions.
    reason_hits = [
        r"inappropriate language",
        r"coffee lounge",
    ]
    assert any(re.search(pat, reply_l) for pat in reason_hits), (
        f"reply does not reference the recent-action reason.\nReply:\n{reply}"
    )


# ---- Test 3: backward compat (no surface_context) --------------------------

def test_endpoint_backward_compat_no_surface_context(admin_token):
    """Same POST without surface_context still yields a valid stream (no 400)."""
    result = _post_chat_stream(
        admin_token,
        {"message": "Say hello briefly."},
    )
    kinds = [k for k, _ in result["events"]]
    assert "session" in kinds, f"missing session event: {kinds}"
    assert "done" in kinds, f"missing done event: {kinds}"
    # We don't assert content — George may reasonably ask "which member?" when
    # there is no surface. Just that the endpoint returns and completes.
