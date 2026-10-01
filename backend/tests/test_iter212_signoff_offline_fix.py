"""iter212 — follow-up to iter211.

Verifies the targeted fix for the previously-flagged product-level issue:
`/api/status/sign-off` now ALSO writes `users.status='offline'` so the
legacy `_status_from` short-circuits to Offline (⚫) immediately — the
read-side bucketing (10 min < 24h → 'active_today') no longer leaks a
🟢 dot to the green-dot readers (My Chats / My Friends / Find Friends /
Café / Games).

Scenarios:
  T1  POST /api/status/sign-off → GET /api/users/{uid}/status returns
      code='offline', label='Offline'.
  T2  users.status is literally 'offline' in Mongo (via the service.sign_off
      side-effect).
  T3  After sign-off, connecting WebSocket /api/ws/user/{uid} clears
      users.status (unsets the 'offline' sentinel) — simulated relogin.
  T4  WS reconnect preserves a NON-'offline' chosen status (e.g.
      'looking_to_chat'): only the 'offline' sentinel is auto-cleared.
"""

import asyncio
import json
import os
import uuid
from datetime import datetime, timezone

import pytest
import requests
import websockets
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


# ---------------------------------------------------------------- fixtures

@pytest.fixture(scope="module")
def demo_tokens():
    tokens = {}
    for name in ("maggie", "frankie", "joycey", "billdo"):
        r = requests.post(f"{API}/auth/demo-login", json={"username": name}, timeout=15)
        assert r.status_code == 200, f"demo-login {name}: {r.status_code} {r.text}"
        d = r.json()
        tokens[name] = {"token": d["access_token"], "user": d["user"]}
    return tokens


@pytest.fixture(scope="module")
def mongo_db():
    client = AsyncIOMotorClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ============================================ T1 + T2: sign-off → offline

class TestSignOffReturnsOffline:
    def test_signoff_marks_status_offline_in_mongo(self, demo_tokens, mongo_db):
        joycey = demo_tokens["joycey"]
        uid = joycey["user"]["id"]
        tok = joycey["token"]

        # Fresh heartbeat first so we start from a known 'online' state.
        r = requests.post(f"{API}/status/heartbeat", headers=_auth(tok), timeout=10)
        assert r.status_code == 200

        # Call sign-off.
        r = requests.post(f"{API}/status/sign-off", headers=_auth(tok), timeout=10)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        # Verify users.status is 'offline' in Mongo (iter212 fix).
        u = _run(mongo_db.users.find_one(
            {"id": uid}, {"_id": 0, "status": 1, "last_seen_at": 1, "status_updated_at": 1}
        ))
        assert u is not None, "user doc missing"
        assert u.get("status") == "offline", (
            f"iter212 fix MISSING: users.status should be 'offline' after sign-off, got {u.get('status')!r}"
        )
        assert u.get("status_updated_at"), "status_updated_at not set alongside status"

    def test_user_status_endpoint_returns_offline(self, demo_tokens):
        """THE core assertion for iter212: GET /api/users/{uid}/status
        must return code='offline' + label='Offline' (⚫) — NOT
        'active_today' (🟢)."""
        joycey = demo_tokens["joycey"]
        uid = joycey["user"]["id"]
        r = requests.get(f"{API}/users/{uid}/status", timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["code"] == "offline", (
            f"iter212 REGRESSION: expected code='offline', got {data}"
        )
        assert data["label"] == "Offline", (
            f"iter212 REGRESSION: expected label='Offline', got {data}"
        )
        # Emoji sanity.
        assert data["emoji"] == "⚫", f"unexpected emoji after signoff: {data}"


# =============================================== T3: relogin via WS clears

class TestReloginClearsOffline:
    def test_ws_user_connect_unsets_offline_status(self, demo_tokens, mongo_db):
        """After sign_off set status='offline', a reconnect on the inbox
        socket (/api/ws/user/{uid}) should $unset the 'offline' sentinel
        so the member isn't stuck on ⚫."""
        joycey = demo_tokens["joycey"]
        uid = joycey["user"]["id"]
        tok = joycey["token"]

        # Pre-condition: force 'offline' state (sign-off).
        r = requests.post(f"{API}/status/sign-off", headers=_auth(tok), timeout=10)
        assert r.status_code == 200
        u_before = _run(mongo_db.users.find_one({"id": uid}, {"_id": 0, "status": 1}))
        assert u_before.get("status") == "offline", f"preseed failed: {u_before}"

        # Open the inbox socket — this is what the mobile app does when
        # the user re-authenticates and lands on home.
        async def _connect_once():
            url = f"{WS_BASE}/api/ws/user/{uid}?token={tok}"
            async with websockets.connect(url, open_timeout=15, close_timeout=5) as ws:
                try:
                    # Receive the hello frame so we know _touch_presence ran.
                    await asyncio.wait_for(ws.recv(), timeout=5)
                except asyncio.TimeoutError:
                    pass

        _run(_connect_once())
        # Give the server a tick for the $unset to flush.
        import time as _t
        _t.sleep(0.5)

        u_after = _run(mongo_db.users.find_one(
            {"id": uid}, {"_id": 0, "status": 1, "last_seen_at": 1}
        ))
        assert u_after.get("status") != "offline", (
            f"users.status still 'offline' after WS /ws/user reconnect: {u_after}"
        )
        # last_seen_at should have been bumped fresh (not 10-min stale).
        try:
            ts = datetime.fromisoformat(u_after["last_seen_at"])
            delta = (datetime.now(timezone.utc) - ts).total_seconds()
            assert delta < 60, f"last_seen_at not bumped on WS connect: delta={delta}s"
        except Exception as e:
            pytest.fail(f"last_seen_at malformed: {u_after.get('last_seen_at')!r}: {e}")

        # GET /api/users/{uid}/status should now be a live code (not offline).
        r = requests.get(f"{API}/users/{uid}/status", timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert data["code"] != "offline", (
            f"public status still offline after WS reconnect: {data}"
        )


# ========================= T4: manual non-offline status preserved on WS

class TestManualStatusPreserved:
    def test_ws_connect_preserves_looking_to_chat(self, demo_tokens, mongo_db):
        """A member whose chosen status is 'looking_to_chat' should NOT
        have that cleared on a WS /ws/user reconnect — only the
        'offline' sentinel is auto-cleared by iter211's conditional
        $unset."""
        billdo = demo_tokens["billdo"]
        uid = billdo["user"]["id"]
        tok = billdo["token"]

        # Set a manual non-offline status directly through the public API.
        r = requests.post(
            f"{API}/users/{uid}/status",
            json={"status": "looking_to_chat"},
            headers=_auth(tok),
            timeout=10,
        )
        assert r.status_code == 200, r.text
        u_before = _run(mongo_db.users.find_one({"id": uid}, {"_id": 0, "status": 1}))
        assert u_before.get("status") == "looking_to_chat", f"preseed failed: {u_before}"

        async def _connect_once():
            url = f"{WS_BASE}/api/ws/user/{uid}?token={tok}"
            async with websockets.connect(url, open_timeout=15, close_timeout=5) as ws:
                try:
                    await asyncio.wait_for(ws.recv(), timeout=5)
                except asyncio.TimeoutError:
                    pass

        _run(_connect_once())
        import time as _t
        _t.sleep(0.5)

        u_after = _run(mongo_db.users.find_one({"id": uid}, {"_id": 0, "status": 1}))
        assert u_after.get("status") == "looking_to_chat", (
            f"manual 'looking_to_chat' was wiped by WS reconnect: {u_after}"
        )

        # Cleanup — clear chosen status so other tests don't inherit it.
        requests.post(
            f"{API}/users/{uid}/status",
            json={"status": None},
            headers=_auth(tok),
            timeout=10,
        )

    def test_ws_connect_preserves_busy(self, demo_tokens, mongo_db):
        """Same as above but for 'busy' — ensures the filter is on the
        value 'offline' specifically, not on 'any chosen status'."""
        maggie = demo_tokens["maggie"]
        uid = maggie["user"]["id"]
        tok = maggie["token"]

        r = requests.post(
            f"{API}/users/{uid}/status",
            json={"status": "busy"},
            headers=_auth(tok),
            timeout=10,
        )
        assert r.status_code == 200, r.text

        async def _connect_once():
            url = f"{WS_BASE}/api/ws/user/{uid}?token={tok}"
            async with websockets.connect(url, open_timeout=15, close_timeout=5) as ws:
                try:
                    await asyncio.wait_for(ws.recv(), timeout=5)
                except asyncio.TimeoutError:
                    pass

        _run(_connect_once())
        import time as _t
        _t.sleep(0.5)

        u = _run(mongo_db.users.find_one({"id": uid}, {"_id": 0, "status": 1}))
        assert u.get("status") == "busy", f"'busy' wiped by WS reconnect: {u}"

        requests.post(
            f"{API}/users/{uid}/status",
            json={"status": None},
            headers=_auth(tok),
            timeout=10,
        )

    def test_heartbeat_endpoint_does_not_clear_offline(self, demo_tokens, mongo_db):
        """Document that the standalone POST /api/users/{uid}/heartbeat
        endpoint does NOT clear the 'offline' sentinel on its own —
        only the WS /ws/user path does. If this ever changes, update
        the review-request wording. (This is informational — the
        review spec says 'WS OR /heartbeat'; today it's WS only.)"""
        joycey = demo_tokens["joycey"]
        uid = joycey["user"]["id"]
        tok = joycey["token"]

        # Force offline sentinel again.
        r = requests.post(f"{API}/status/sign-off", headers=_auth(tok), timeout=10)
        assert r.status_code == 200

        # Hit the LEGACY heartbeat endpoint (not /status/heartbeat).
        r = requests.post(
            f"{API}/users/{uid}/heartbeat", headers=_auth(tok), timeout=10
        )
        assert r.status_code == 200, r.text

        u = _run(mongo_db.users.find_one({"id": uid}, {"_id": 0, "status": 1}))
        # Document whether the sentinel got cleared.
        # Current implementation: /users/{uid}/heartbeat only bumps
        # last_seen_at and leaves status=='offline' intact.
        # This test records that behavior; the WS test above is the
        # one that proves the fix works end-to-end.
        assert u.get("status") == "offline", (
            "If this starts failing, the heartbeat endpoint now also "
            "clears the offline sentinel — update the review wording."
        )

        # Reset for clean state.
        async def _reset():
            await mongo_db.users.update_one(
                {"id": uid}, {"$unset": {"status": "", "status_updated_at": ""}}
            )
        _run(_reset())


# ---------------------------------------------------------------- cleanup

@pytest.fixture(scope="module", autouse=True)
def _cleanup(mongo_db):
    yield
    async def _tidy():
        # Clear any 'offline' sentinel left on the demo users touched here.
        for name in ("joycey", "billdo", "maggie"):
            u = await mongo_db.users.find_one({"username": name}, {"_id": 0, "id": 1})
            if u:
                await mongo_db.users.update_one(
                    {"id": u["id"]},
                    {"$unset": {"status": "", "status_updated_at": ""}},
                )
    try:
        _run(_tidy())
    except Exception:
        pass
