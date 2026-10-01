"""iter-realtime (Sep 2026) — DM delivery is presence-accurate.

Root cause fixed: DM push-suppression used a raw socket-count heuristic
(`len(dm_room) > 1`). When the SENDER held a stale/duplicate dm socket
(reconnect overlap) the count was > 1 even though the recipient had left
the thread — so the recipient's `notification` push was silently
suppressed. Symptom: "badge updates but no popup / message never appears
live until you navigate away and back".

The hub now binds every socket to its user and suppresses the push ONLY
for recipients actually present in the dm room (`users_in_room`).

Covers:
  * Recipient NOT in room, sender holds TWO dm sockets → push STILL fires
  * Recipient IN room → push suppressed (regression guard)
  * Recipient leaves the thread → the very next message pushes again
  * Consecutive messages each fan out a distinct dm_update (no collapse)
"""
from __future__ import annotations

import asyncio
import json
import uuid
from contextlib import asynccontextmanager

import pytest
import requests
import websockets
from websockets.exceptions import ConnectionClosed

HTTP_BASE = "http://localhost:8001"
WS_BASE = "ws://localhost:8001"


def _signup() -> dict:
    uname = f"rt_{uuid.uuid4().hex[:8]}"
    r = requests.post(
        f"{HTTP_BASE}/api/auth/signup",
        json={
            "username": uname,
            "password": "TestPass2026!",
            "email": f"{uname}@example.com",
            "first_name": "Realtime",
        },
        timeout=15,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    return {"id": d["user"]["id"], "token": d["access_token"], "username": uname}


@pytest.fixture(scope="module")
def user_a():
    return _signup()


@pytest.fixture(scope="module")
def user_b():
    return _signup()


@pytest.fixture(scope="module")
def conv(user_a, user_b):
    r = requests.post(
        f"{HTTP_BASE}/api/dm/start",
        json={"user_id": user_a["id"], "other_id": user_b["id"]},
        headers={"Authorization": f"Bearer {user_a['token']}"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


@asynccontextmanager
async def user_ws(user_id: str, token: str):
    url = f"{WS_BASE}/api/ws/user/{user_id}?token={token}"
    async with websockets.connect(url, open_timeout=10, close_timeout=5) as ws:
        first = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
        assert first.get("type") == "hello"
        yield ws


@asynccontextmanager
async def dm_ws(conv_id: str, user_id: str, token: str):
    url = f"{WS_BASE}/api/ws/dm/{conv_id}?user_id={user_id}&token={token}"
    async with websockets.connect(url, open_timeout=10, close_timeout=5) as ws:
        yield ws


async def _recv_until(ws, event_type: str, timeout: float = 6.0):
    deadline = asyncio.get_event_loop().time() + timeout
    while True:
        remaining = deadline - asyncio.get_event_loop().time()
        if remaining <= 0:
            raise asyncio.TimeoutError(f"never saw {event_type}")
        raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
        try:
            frame = json.loads(raw)
        except Exception:
            continue
        if frame.get("type") == event_type:
            return frame


async def _drain(ws, seconds: float = 1.2):
    frames = []
    end = asyncio.get_event_loop().time() + seconds
    while asyncio.get_event_loop().time() < end:
        try:
            raw = await asyncio.wait_for(
                ws.recv(), timeout=max(0.05, end - asyncio.get_event_loop().time())
            )
            frames.append(json.loads(raw))
        except (asyncio.TimeoutError, ConnectionClosed):
            break
    return frames


class TestStaleSenderSocket:
    @pytest.mark.asyncio
    async def test_push_fires_despite_sender_double_socket(self, user_a, user_b, conv):
        """B holds TWO dm sockets; A is NOT in the thread → A must still
        receive a `notification` push (the old socket-count heuristic
        would have suppressed it)."""
        async with user_ws(user_a["id"], user_a["token"]) as inbox_a:
            async with dm_ws(conv, user_b["id"], user_b["token"]) as b1, \
                    dm_ws(conv, user_b["id"], user_b["token"]) as b2:
                await asyncio.sleep(0.3)  # let both sockets register
                await b1.send(json.dumps({"text": "stale-socket path"}))
                # dm_update must arrive …
                upd = await _recv_until(inbox_a, "dm_update")
                assert upd["conv_id"] == conv
                # … AND the notification push must fire because A is absent.
                notif = await _recv_until(inbox_a, "notification")
                assert notif["notification"]["type"] in ("dm", "dm_request")
                assert (notif["notification"].get("payload") or {}).get("dm_id") == conv
                _ = b2  # second socket intentionally idle


class TestRecipientPresentSuppresses:
    @pytest.mark.asyncio
    async def test_no_push_when_recipient_in_room(self, user_a, user_b, conv):
        async with user_ws(user_a["id"], user_a["token"]) as inbox_a:
            async with dm_ws(conv, user_a["id"], user_a["token"]) as _a_in, \
                    dm_ws(conv, user_b["id"], user_b["token"]) as b:
                await asyncio.sleep(0.3)
                await b.send(json.dumps({"text": "both present"}))
                await _recv_until(inbox_a, "dm_update")
                frames = await _drain(inbox_a, 1.5)
                notifs = [f for f in frames if f.get("type") == "notification"]
                assert not notifs, f"push must be suppressed when A is present: {notifs}"


class TestLeaveReenablesPush:
    @pytest.mark.asyncio
    async def test_leaving_thread_reenables_push(self, user_a, user_b, conv):
        async with user_ws(user_a["id"], user_a["token"]) as inbox_a:
            # A joins the thread, then leaves (socket closes on ctx exit).
            async with dm_ws(conv, user_a["id"], user_a["token"]) as _a_in, \
                    dm_ws(conv, user_b["id"], user_b["token"]) as b:
                await asyncio.sleep(0.3)
                await b.send(json.dumps({"text": "while A present"}))
                await _recv_until(inbox_a, "dm_update")
                suppressed = await _drain(inbox_a, 1.2)
                assert not [f for f in suppressed if f.get("type") == "notification"]
            # A has now LEFT the thread. Next message MUST push.
            await asyncio.sleep(0.4)  # allow server disconnect to propagate
            async with dm_ws(conv, user_b["id"], user_b["token"]) as b2:
                await b2.send(json.dumps({"text": "after A left"}))
                notif = await _recv_until(inbox_a, "notification")
                assert notif["notification"]["type"] in ("dm", "dm_request")


class TestConsecutiveMessages:
    @pytest.mark.asyncio
    async def test_three_consecutive_each_fan_out(self, user_a, user_b, conv):
        async with user_ws(user_a["id"], user_a["token"]) as inbox_a:
            async with dm_ws(conv, user_b["id"], user_b["token"]) as b:
                for i in range(3):
                    await b.send(json.dumps({"text": f"rapid-{i}"}))
                    await asyncio.sleep(0.15)
                ids = set()
                for _ in range(3):
                    upd = await _recv_until(inbox_a, "dm_update")
                    ids.add((upd.get("last_message") or {}).get("id"))
                assert len(ids) == 3, f"each message needs a distinct dm_update: {ids}"
