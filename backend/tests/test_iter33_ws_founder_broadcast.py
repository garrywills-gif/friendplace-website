"""Iteration 33 — Verify WebSocket broadcast frames carry founder flags
when the sender is a founder.

Covers:
  - /api/ws/table/{table_id} → outgoing {type:"message", message:{...}}
    must contain user_is_founder + user_founder_number for a founder sender.
  - /api/ws/dm/{conv_id} → same.
"""
import os
import json
import uuid
import asyncio
import pytest
import requests
import websockets
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://outreach-campaigns.preview.emergentagent.com").rstrip("/")
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def mongo():
    return MongoClient(MONGO_URL)[DB_NAME]


@pytest.fixture(scope="module")
def founder_user(api, mongo):
    """Fresh founder signup — auto-promoted to founder #N (within 500 cap)."""
    suffix = uuid.uuid4().hex[:8]
    r = api.post(
        f"{BASE_URL}/api/auth/signup",
        json={
            "username": f"TEST_iter33_{suffix}",
            "password": "Test1234!",
            "email": f"test_iter33_{suffix}@example.com",
            "first_name": "WSFounder",
        },
    )
    assert r.status_code == 200, r.text
    user = r.json()["user"]
    assert user.get("is_founder") is True
    assert isinstance(user.get("founder_number"), int)
    yield user
    uid = user["id"]
    mongo.users.delete_one({"id": uid})
    mongo.notifications.delete_many({"user_id": uid})
    mongo.messages.delete_many({"user_id": uid})
    mongo.tables.update_many({}, {"$pull": {"seated": uid}})
    mongo.dm_conversations.delete_many({"user_ids": uid})


@pytest.fixture(scope="module")
def demo_user(api):
    r = api.post(f"{BASE_URL}/api/auth/demo-login", json={"username": "maggie"})
    assert r.status_code == 200, r.text
    return r.json()["user"]


async def _consume_until_message(ws, timeout=5.0):
    """Skip presence/heartbeat frames; return first `message` frame."""
    end = asyncio.get_event_loop().time() + timeout
    while True:
        remaining = end - asyncio.get_event_loop().time()
        if remaining <= 0:
            raise asyncio.TimeoutError("no message frame received")
        raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
        frame = json.loads(raw)
        if frame.get("type") == "message":
            return frame


class TestTableWSFounderBroadcast:
    def test_table_ws_broadcast_carries_founder_flags(self, founder_user, mongo):
        """A founder posts a table message — outgoing WS frame must include
        user_is_founder=true and user_founder_number=<N>."""
        # Use a fresh dummy table_id so we don't trip founder_only guards.
        table_id = f"TEST_iter33_tbl_{uuid.uuid4().hex[:8]}"
        # Seed the table so the WS handler doesn't bail on a missing doc.
        mongo.tables.insert_one({
            "id": table_id,
            "name": "TEST_iter33 table",
            "emoji": "☕",
            "host_id": founder_user["id"],
            "seated": [],
            "persistent": False,
            "founder_only": False,
        })
        try:
            asyncio.get_event_loop().run_until_complete(self._run(table_id, founder_user))
        finally:
            mongo.tables.delete_one({"id": table_id})
            mongo.messages.delete_many({"table_id": table_id})

    async def _run(self, table_id, founder_user):
        url = f"{WS_BASE}/api/ws/table/{table_id}?user_id={founder_user['id']}"
        async with websockets.connect(url, open_timeout=10) as ws:
            # Send one text message.
            await ws.send(json.dumps({"text": "hello from founder"}))
            frame = await _consume_until_message(ws, timeout=8.0)
            msg = frame.get("message") or {}
            assert msg.get("text") == "hello from founder", f"unexpected text: {msg}"
            assert msg.get("user_is_founder") is True, f"WS frame missing user_is_founder: {msg}"
            assert msg.get("user_founder_number") == founder_user["founder_number"], (
                f"WS frame founder_number mismatch: got {msg.get('user_founder_number')} "
                f"expected {founder_user['founder_number']}"
            )


class TestDMWSFounderBroadcast:
    def test_dm_ws_broadcast_carries_founder_flags(self, api, founder_user, demo_user, mongo):
        """Open a DM conversation founder↔maggie, send a message over the WS
        as the founder, assert the broadcast frame has the founder flags."""
        r = api.post(
            f"{BASE_URL}/api/dm/start",
            json={"user_id": founder_user["id"], "other_id": demo_user["id"]},
        )
        assert r.status_code == 200, r.text
        conv_id = r.json()["id"]
        try:
            asyncio.get_event_loop().run_until_complete(self._run(conv_id, founder_user))
        finally:
            mongo.messages.delete_many({"dm_id": conv_id})

    async def _run(self, conv_id, founder_user):
        url = f"{WS_BASE}/api/ws/dm/{conv_id}?user_id={founder_user['id']}"
        async with websockets.connect(url, open_timeout=10) as ws:
            await ws.send(json.dumps({"text": "dm from founder"}))
            frame = await _consume_until_message(ws, timeout=8.0)
            msg = frame.get("message") or {}
            assert msg.get("text") == "dm from founder", f"unexpected text: {msg}"
            assert msg.get("user_is_founder") is True, f"DM WS frame missing user_is_founder: {msg}"
            assert msg.get("user_founder_number") == founder_user["founder_number"]
