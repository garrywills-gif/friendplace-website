"""iter154 — Per-user inbox WebSocket + push_notification fan-out.

Covers:
  * `/api/ws/user/{user_id}` handshake (auth pass/fail, hello frame)
  * Keep-alive ping/pong + unknown-frame tolerance
  * `push_notification()` broadcasting `notification` frames
  * `ws_dm` broadcasting `dm_update` frames to the recipient's user socket
  * In-conversation push suppression (both sides inside dm room)
  * `POST /api/dm/{conv_id}/mark-read` echoes `dm_read`
  * `notification.payload.dm_id` (used for push deep-link)
  * Auth-expiry close 4401
  * No replay on reconnect
  * Multi-device broadcast (same user, 3 sockets)
  * `notification` frame is JSON-serialisable (no ObjectId)
"""
from __future__ import annotations

import asyncio
import json
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import jwt
import pytest
import requests
import websockets
import websockets.exceptions  # explicit — lazy import surface in websockets 16.x
from websockets.exceptions import ConnectionClosed

# ---------------------------------------------------------------------------
# Config — use the internal host for both HTTP and WebSocket so we stay clear
# of ingress WS proxies. Everything the router exposes is available at :8001.
# ---------------------------------------------------------------------------
HTTP_BASE = "http://localhost:8001"
WS_BASE = "ws://localhost:8001"

# JWT_SECRET must match backend/.env so we can craft an expired token.
JWT_SECRET = os.environ.get("JWT_SECRET") or (
    "6dlbOZf8fcKiZsCCjixsM641Zrvnb_8Vz8BcOmgBcInPs7-8dw6wz0M2thS1u8mNMO5fRiKtmZPEGhqmETqc4g"
)
JWT_ALG = "HS256"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _rand(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def _signup() -> dict:
    """Create a fresh user and return {id, token, username}."""
    uname = _rand("i154")
    payload = {
        "username": uname,
        "password": "TestPass2026!",
        "email": f"{uname}@example.com",
        "first_name": "Iter154",
    }
    r = requests.post(f"{HTTP_BASE}/api/auth/signup", json=payload, timeout=15)
    assert r.status_code == 200, f"signup failed: {r.status_code} {r.text}"
    data = r.json()
    return {
        "id": data["user"]["id"],
        "token": data["access_token"],
        "username": uname,
    }


@pytest.fixture(scope="module")
def user_a():
    return _signup()


@pytest.fixture(scope="module")
def user_b():
    return _signup()


@pytest.fixture(scope="module")
def dm_conv(user_a, user_b):
    """Start (or fetch) the DM conversation between A and B."""
    r = requests.post(
        f"{HTTP_BASE}/api/dm/start",
        json={"user_id": user_a["id"], "other_id": user_b["id"]},
        headers={"Authorization": f"Bearer {user_a['token']}"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()


@asynccontextmanager
async def user_ws(user_id: str, token: str, *, expect_hello: bool = True):
    """Open a `/api/ws/user/{user_id}` socket and (optionally) drain the hello."""
    url = f"{WS_BASE}/api/ws/user/{user_id}?token={token}"
    async with websockets.connect(url, open_timeout=10, close_timeout=5) as ws:
        if expect_hello:
            first = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
            assert first.get("type") == "hello", f"expected hello, got {first}"
            assert "server_time" in first
        yield ws


async def _recv_until(ws, event_type: str, timeout: float = 5.0):
    """Drain frames until we see one matching event_type. Returns the frame."""
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


async def _drain(ws, seconds: float = 0.5):
    """Read everything currently on the socket (best effort)."""
    frames = []
    end = asyncio.get_event_loop().time() + seconds
    while asyncio.get_event_loop().time() < end:
        try:
            raw = await asyncio.wait_for(
                ws.recv(),
                timeout=max(0.05, end - asyncio.get_event_loop().time()),
            )
            frames.append(json.loads(raw))
        except (asyncio.TimeoutError, ConnectionClosed):
            break
    return frames


# ---------------------------------------------------------------------------
# 1) Handshake auth
# ---------------------------------------------------------------------------
class TestHandshake:
    @pytest.mark.asyncio
    async def test_reject_no_token(self, user_a):
        url = f"{WS_BASE}/api/ws/user/{user_a['id']}"
        with pytest.raises(ConnectionClosed) as exc:
            async with websockets.connect(url, open_timeout=5) as ws:
                # server accepts, sends error, closes 4401
                await asyncio.wait_for(ws.recv(), timeout=5)  # error frame
                await asyncio.wait_for(ws.recv(), timeout=5)  # closes here
        assert exc.value.code == 4401

    @pytest.mark.asyncio
    async def test_reject_wrong_subject(self, user_a, user_b):
        # Token of B, but URL claims A.
        url = f"{WS_BASE}/api/ws/user/{user_a['id']}?token={user_b['token']}"
        with pytest.raises(ConnectionClosed) as exc:
            async with websockets.connect(url, open_timeout=5) as ws:
                await asyncio.wait_for(ws.recv(), timeout=5)
                await asyncio.wait_for(ws.recv(), timeout=5)
        assert exc.value.code == 4401

    @pytest.mark.asyncio
    async def test_accept_and_hello(self, user_a):
        async with user_ws(user_a["id"], user_a["token"]) as ws:
            # Hello was consumed inside user_ws — nothing to assert here beyond
            # a successful open.
            assert ws.state == websockets.protocol.State.OPEN

    @pytest.mark.asyncio
    async def test_expired_token_closes_4401(self, user_a):
        expired = jwt.encode(
            {
                "sub": user_a["id"],
                "exp": datetime.now(timezone.utc) - timedelta(minutes=1),
            },
            JWT_SECRET,
            algorithm=JWT_ALG,
        )
        url = f"{WS_BASE}/api/ws/user/{user_a['id']}?token={expired}"
        got_hello = False
        with pytest.raises(ConnectionClosed) as exc:
            async with websockets.connect(url, open_timeout=5) as ws:
                while True:
                    raw = await asyncio.wait_for(ws.recv(), timeout=5)
                    frame = json.loads(raw)
                    if frame.get("type") == "hello":
                        got_hello = True
                        break
        assert not got_hello, "expired token must NOT receive hello"
        assert exc.value.code == 4401


# ---------------------------------------------------------------------------
# 2) Keep-alive + unknown-frame tolerance
# ---------------------------------------------------------------------------
class TestKeepAlive:
    @pytest.mark.asyncio
    async def test_ping_pong(self, user_a):
        async with user_ws(user_a["id"], user_a["token"]) as ws:
            await ws.send(json.dumps({"type": "ping"}))
            pong = await _recv_until(ws, "pong", timeout=5)
            assert "server_time" in pong

    @pytest.mark.asyncio
    async def test_unknown_frame_ignored(self, user_a):
        async with user_ws(user_a["id"], user_a["token"]) as ws:
            # Garbage + unknown type — must NOT crash the socket.
            await ws.send("not-json-at-all")
            await ws.send(json.dumps({"type": "no_such_thing", "x": 1}))
            # A follow-up ping should still get a pong.
            await ws.send(json.dumps({"type": "ping"}))
            pong = await _recv_until(ws, "pong", timeout=5)
            assert pong["type"] == "pong"


# ---------------------------------------------------------------------------
# 3) push_notification fan-out via friend-request flow
# ---------------------------------------------------------------------------
class TestNotificationFanout:
    @pytest.mark.asyncio
    async def test_friend_request_pushes_notification(self, user_a, user_b):
        async with user_ws(user_b["id"], user_b["token"]) as ws:
            # A sends B a friend request → push_notification(B, ...)
            r = requests.post(
                f"{HTTP_BASE}/api/friends/request",
                json={"from_id": user_a["id"], "to_id": user_b["id"]},
                timeout=15,
            )
            assert r.status_code == 200, r.text

            frame = await _recv_until(ws, "notification", timeout=5)
            notif = frame.get("notification") or {}
            assert notif.get("type") == "friend_request"
            assert notif.get("user_id") == user_b["id"]
            assert "id" in notif
            # No Mongo _id in the wire payload.
            assert "_id" not in notif, f"raw _id leaked: {notif}"
            # Must be pure-JSON serialisable (no ObjectId / datetime shenanigans).
            json.dumps(frame)


# ---------------------------------------------------------------------------
# 4) DM fan-out — recipient NOT inside the DM room
# ---------------------------------------------------------------------------
class TestDmFanoutNormal:
    @pytest.mark.asyncio
    async def test_dm_update_and_notification(self, user_a, user_b, dm_conv):
        conv_id = dm_conv["id"]
        # Baseline notifications count for A (recipient).
        before = requests.get(
            f"{HTTP_BASE}/api/notifications/{user_a['id']}", timeout=15
        ).json()
        before_count = len(before)

        async with user_ws(user_a["id"], user_a["token"]) as inbox_a:
            # B opens the DM socket and sends a message; A is NOT in the dm room.
            sender_url = (
                f"{WS_BASE}/api/ws/dm/{conv_id}"
                f"?user_id={user_b['id']}&token={user_b['token']}"
            )
            async with websockets.connect(sender_url, open_timeout=10) as ws_b:
                await ws_b.send(json.dumps({"text": "hello from B, normal path"}))

                dm_update = await _recv_until(inbox_a, "dm_update", timeout=6)
                assert dm_update["conv_id"] == conv_id
                assert dm_update["from_id"] == user_b["id"]
                assert dm_update.get("unread_delta") == 1
                lm = dm_update.get("last_message") or {}
                assert lm.get("user_id") == user_b["id"]
                assert lm.get("id")
                assert lm.get("text") == "hello from B, normal path"
                assert "is_chat_request" in dm_update

                notif = await _recv_until(inbox_a, "notification", timeout=6)
                n = notif["notification"]
                assert n["user_id"] == user_a["id"]
                assert n["type"] in ("dm", "dm_request")
                # Payload MUST include dm_id + from_id (drives push deep-link).
                assert (n.get("payload") or {}).get("dm_id") == conv_id
                assert (n.get("payload") or {}).get("from_id") == user_b["id"]
                assert "_id" not in n

        # Confirm a notifications row was actually created for A.
        after = requests.get(
            f"{HTTP_BASE}/api/notifications/{user_a['id']}", timeout=15
        ).json()
        assert len(after) == before_count + 1


# ---------------------------------------------------------------------------
# 5) In-conversation suppression — BOTH sides inside the DM room
# ---------------------------------------------------------------------------
class TestInConvSuppression:
    @pytest.mark.asyncio
    async def test_no_notification_when_recipient_in_room(
        self, user_a, user_b, dm_conv
    ):
        conv_id = dm_conv["id"]
        before = requests.get(
            f"{HTTP_BASE}/api/notifications/{user_a['id']}", timeout=15
        ).json()
        before_count = len(before)

        async with user_ws(user_a["id"], user_a["token"]) as inbox_a:
            # Both A and B join the dm room.
            a_url = (
                f"{WS_BASE}/api/ws/dm/{conv_id}"
                f"?user_id={user_a['id']}&token={user_a['token']}"
            )
            b_url = (
                f"{WS_BASE}/api/ws/dm/{conv_id}"
                f"?user_id={user_b['id']}&token={user_b['token']}"
            )
            async with websockets.connect(a_url, open_timeout=10) as ws_a, \
                    websockets.connect(b_url, open_timeout=10) as ws_b:
                # Give the server a beat to add both sockets to the room.
                await asyncio.sleep(0.3)
                await ws_b.send(json.dumps({"text": "hello (both in room)"}))

                # dm_update MUST still arrive on the user socket.
                dm_update = await _recv_until(inbox_a, "dm_update", timeout=6)
                assert dm_update["conv_id"] == conv_id

                # Give push_notification time to fire IF it were going to.
                frames = await _drain(inbox_a, seconds=1.5)
                notification_frames = [
                    f for f in frames if f.get("type") == "notification"
                ]
                assert not notification_frames, (
                    "no `notification` frame expected when recipient is in room, "
                    f"got: {notification_frames}"
                )

        # And no notifications document was created for A.
        after = requests.get(
            f"{HTTP_BASE}/api/notifications/{user_a['id']}", timeout=15
        ).json()
        assert len(after) == before_count, (
            f"in-room DM must not create notification row "
            f"(before={before_count}, after={len(after)})"
        )


# ---------------------------------------------------------------------------
# 6) dm_read echo
# ---------------------------------------------------------------------------
class TestDmReadEcho:
    @pytest.mark.asyncio
    async def test_mark_read_echoes(self, user_a, user_b, dm_conv):
        conv_id = dm_conv["id"]
        # Ensure there IS at least one unread message from B for A.
        sender_url = (
            f"{WS_BASE}/api/ws/dm/{conv_id}"
            f"?user_id={user_b['id']}&token={user_b['token']}"
        )
        async with websockets.connect(sender_url, open_timeout=10) as ws_b:
            await ws_b.send(json.dumps({"text": "unread bump 1"}))
            await ws_b.send(json.dumps({"text": "unread bump 2"}))
            await asyncio.sleep(0.3)

        async with user_ws(user_a["id"], user_a["token"]) as inbox_a:
            r = requests.post(
                f"{HTTP_BASE}/api/dm/{conv_id}/mark-read",
                headers={"Authorization": f"Bearer {user_a['token']}"},
                timeout=15,
            )
            assert r.status_code == 200
            cleared_first = r.json().get("cleared", 0)
            assert cleared_first >= 1

            dm_read = await _recv_until(inbox_a, "dm_read", timeout=5)
            assert dm_read["conv_id"] == conv_id
            assert dm_read["unread_delta"] == -cleared_first

            # Second call — idempotent, no negative overshoot.
            r2 = requests.post(
                f"{HTTP_BASE}/api/dm/{conv_id}/mark-read",
                headers={"Authorization": f"Bearer {user_a['token']}"},
                timeout=15,
            )
            assert r2.status_code == 200
            assert r2.json().get("cleared", 0) == 0
            # Either no dm_read event OR one with delta 0 — never a negative echo.
            frames = await _drain(inbox_a, seconds=1.0)
            for f in frames:
                if f.get("type") == "dm_read":
                    assert f.get("unread_delta", 0) >= 0


# ---------------------------------------------------------------------------
# 7) No replay on reconnect + multi-device fan-out
# ---------------------------------------------------------------------------
class TestReconnectAndMultiDevice:
    @pytest.mark.asyncio
    async def test_no_replay_on_reconnect(self, user_a, user_b, dm_conv):
        conv_id = dm_conv["id"]

        # First: A opens, receives 3 dm_updates.
        async with user_ws(user_a["id"], user_a["token"]) as inbox_a:
            sender_url = (
                f"{WS_BASE}/api/ws/dm/{conv_id}"
                f"?user_id={user_b['id']}&token={user_b['token']}"
            )
            async with websockets.connect(sender_url, open_timeout=10) as ws_b:
                for i in range(3):
                    await ws_b.send(json.dumps({"text": f"replay-msg-{i}"}))

                seen = 0
                for _ in range(6):
                    try:
                        frame = await _recv_until(inbox_a, "dm_update", timeout=5)
                        if frame.get("conv_id") == conv_id:
                            seen += 1
                            if seen == 3:
                                break
                    except asyncio.TimeoutError:
                        break
                assert seen == 3, f"expected 3 dm_updates, got {seen}"

        # A's socket is now closed. Reconnect — expect NO replay.
        async with user_ws(user_a["id"], user_a["token"]) as inbox_a2:
            frames = await _drain(inbox_a2, seconds=1.0)
            replays = [f for f in frames if f.get("type") == "dm_update"]
            assert not replays, f"expected no replay, got {replays}"

            # New message → exactly one dm_update.
            sender_url = (
                f"{WS_BASE}/api/ws/dm/{conv_id}"
                f"?user_id={user_b['id']}&token={user_b['token']}"
            )
            async with websockets.connect(sender_url, open_timeout=10) as ws_b:
                await ws_b.send(json.dumps({"text": "post-reconnect"}))
                fresh = await _recv_until(inbox_a2, "dm_update", timeout=5)
                assert fresh["conv_id"] == conv_id
                # Confirm no duplicate follow-up dm_update.
                extra = await _drain(inbox_a2, seconds=1.0)
                extra_updates = [f for f in extra if f.get("type") == "dm_update"]
                assert not extra_updates, f"unexpected extra dm_updates: {extra_updates}"

    @pytest.mark.asyncio
    async def test_three_concurrent_sockets_all_receive(
        self, user_a, user_b, dm_conv
    ):
        conv_id = dm_conv["id"]
        # Open 3 user sockets for A concurrently.
        async with user_ws(user_a["id"], user_a["token"]) as s1, \
                user_ws(user_a["id"], user_a["token"]) as s2, \
                user_ws(user_a["id"], user_a["token"]) as s3:
            sender_url = (
                f"{WS_BASE}/api/ws/dm/{conv_id}"
                f"?user_id={user_b['id']}&token={user_b['token']}"
            )
            async with websockets.connect(sender_url, open_timeout=10) as ws_b:
                await ws_b.send(json.dumps({"text": "multi-device"}))

                results = await asyncio.gather(
                    _recv_until(s1, "dm_update", timeout=5),
                    _recv_until(s2, "dm_update", timeout=5),
                    _recv_until(s3, "dm_update", timeout=5),
                )
                for r in results:
                    assert r["conv_id"] == conv_id


# ---------------------------------------------------------------------------
# 8) Health / route-registration sanity
# ---------------------------------------------------------------------------
class TestServerStillHealthy:
    def test_health_ok(self):
        r = requests.get(f"{HTTP_BASE}/api/health", timeout=5)
        assert r.status_code == 200
        assert r.json().get("status") == "ok"
