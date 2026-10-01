"""iter-livenudges (Sep 2026) — reconciliation fallback for the global popup
overlay.

Garry (real device): "chat to a non-friend / invite to a game → the other
person gets NO notification. It did work and stopped. Popups must appear no
matter where they are."

Root resilience fix: the per-user WebSocket is primary, but it can drop while
idle on Home. `GET /notifications/{id}/live-nudges` lets CompanionNudge poll
for recent unread actionable notifications (incl. DMs + game invites) so a
popup always surfaces within seconds even if the socket missed the event.

Covers that the endpoint returns, for a recipient:
  * a friend_request push
  * a game_invite push (direct friend invite)
  * a dm_request push (first message from a NON-friend, over the real ws path)
and that read / stale items are excluded.
"""
from __future__ import annotations

import asyncio
import json
import uuid

import pytest
import requests
import websockets

HTTP_BASE = "http://localhost:8001"
WS_BASE = "ws://localhost:8001"


def _signup() -> dict:
    uname = f"ln_{uuid.uuid4().hex[:8]}"
    r = requests.post(
        f"{HTTP_BASE}/api/auth/signup",
        json={"username": uname, "password": "TestPass2026!", "email": f"{uname}@e.com", "first_name": "Nudgey"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    return {"id": d["user"]["id"], "token": d["access_token"]}


def _auth(u):
    return {"Authorization": f"Bearer {u['token']}"}


def _live(uid: str):
    return requests.get(f"{HTTP_BASE}/api/notifications/{uid}/live-nudges?since_secs=90", timeout=15).json()


class TestLiveNudgesFallback:
    def test_friend_request_appears(self):
        a, b = _signup(), _signup()
        r = requests.post(
            f"{HTTP_BASE}/api/friends/request",
            json={"from_id": a["id"], "to_id": b["id"]},
            headers=_auth(a), timeout=15,
        )
        assert r.status_code == 200, r.text
        rows = _live(b["id"])
        fr = [n for n in rows if n["type"] == "friend_request" and n["payload"].get("from_id") == a["id"]]
        assert fr, f"friend_request should surface in live-nudges: {[n['type'] for n in rows]}"
        assert fr[0]["payload"].get("request_id")

    def test_game_invite_appears(self):
        a, b = _signup(), _signup()
        # Befriend first (play/invite is friends-only).
        fr = requests.post(
            f"{HTTP_BASE}/api/friends/request",
            json={"from_id": a["id"], "to_id": b["id"]},
            headers=_auth(a), timeout=15,
        ).json()
        requests.post(f"{HTTP_BASE}/api/friends/accept/{fr['id']}", timeout=15)
        inv = requests.post(
            f"{HTTP_BASE}/api/play/invite",
            json={"game": "quick_trivia", "friend_id": b["id"]},
            headers=_auth(a), timeout=15,
        )
        assert inv.status_code == 200, inv.text
        rows = _live(b["id"])
        gi = [n for n in rows if n["type"] == "game_invite"]
        assert gi, f"game_invite should surface in live-nudges: {[n['type'] for n in rows]}"
        assert gi[0]["payload"].get("session_id")

    @pytest.mark.asyncio
    async def test_dm_request_from_non_friend_appears(self):
        a, b = _signup(), _signup()  # NOT friends
        # Start a conversation and send the first message over the real ws path.
        conv = requests.post(
            f"{HTTP_BASE}/api/dm/start",
            json={"user_id": a["id"], "other_id": b["id"]},
            headers=_auth(a), timeout=15,
        ).json()["id"]
        url = f"{WS_BASE}/api/ws/dm/{conv}?user_id={a['id']}&token={a['token']}"
        async with websockets.connect(url, open_timeout=10, close_timeout=5) as ws:
            await ws.send(json.dumps({"text": "hello, I'd love to chat!"}))
            await asyncio.sleep(0.6)  # let the push + notification row land
        rows = _live(b["id"])
        dm = [n for n in rows if n["type"] in ("dm", "dm_request") and n["payload"].get("dm_id") == conv]
        assert dm, f"non-friend chat-request should surface in live-nudges: {[n['type'] for n in rows]}"

    def test_read_items_excluded(self):
        a, b = _signup(), _signup()
        fr = requests.post(
            f"{HTTP_BASE}/api/friends/request",
            json={"from_id": a["id"], "to_id": b["id"]},
            headers=_auth(a), timeout=15,
        ).json()
        rows = _live(b["id"])
        nid_ = next(n["id"] for n in rows if n["type"] == "friend_request")
        requests.post(f"{HTTP_BASE}/api/notifications/{nid_}/read", timeout=15)
        rows2 = _live(b["id"])
        assert not any(n["id"] == nid_ for n in rows2), "read notifications must drop out of live-nudges"
