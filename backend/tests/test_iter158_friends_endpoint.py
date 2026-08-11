"""
Batch B iter158 — Fix #1 backend integration tests

Tests the new `GET /api/friends/{user_id}` single-source-of-truth endpoint
(implemented in server.py: `list_accepted_friends`). Validates:
- Bidirectional-only counting (one-way stale entries excluded)
- banned/blocked/hidden filters
- Auth: owner or admin only (403 otherwise)
"""

import os
import asyncio
import uuid
import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://iphone-retest-batch.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


# ── helpers ────────────────────────────────────────────────────────
def demo_login(username: str) -> dict:
    r = requests.post(f"{API}/auth/demo-login", json={"username": username}, timeout=30)
    assert r.status_code == 200, f"demo-login {username} -> {r.status_code} {r.text}"
    return r.json()


def h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


async def _mongo():
    return AsyncIOMotorClient(MONGO_URL)[DB_NAME]


async def _cleanup_state(maggie_id: str, frankie_id: str, joycey_id: str):
    """Reset relevant state before each test scenario."""
    db = await _mongo()
    # unfriend + unblock across the trio, clear any pending FRs
    await db.users.update_one({"id": maggie_id}, {"$set": {"friends": [], "blocked": [], "banned": False, "profile_hidden": False}})
    await db.users.update_one({"id": frankie_id}, {"$set": {"friends": [], "blocked": [], "banned": False, "profile_hidden": False}})
    await db.users.update_one({"id": joycey_id}, {"$set": {"friends": [], "blocked": [], "banned": False, "profile_hidden": False}})
    await db.friend_requests.delete_many({
        "$or": [
            {"from_id": {"$in": [maggie_id, frankie_id, joycey_id]}},
            {"to_id": {"$in": [maggie_id, frankie_id, joycey_id]}},
        ]
    })


# ── fixtures ───────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def trio():
    maggie = demo_login("maggie")
    frankie = demo_login("frankie")
    joycey = demo_login("joycey")
    return {
        "maggie": {"id": maggie["user"]["id"], "token": maggie["access_token"], "user": maggie["user"]},
        "frankie": {"id": frankie["user"]["id"], "token": frankie["access_token"], "user": frankie["user"]},
        "joycey": {"id": joycey["user"]["id"], "token": joycey["access_token"], "user": joycey["user"]},
    }


@pytest.fixture(autouse=True)
def _reset(trio):
    asyncio.get_event_loop().run_until_complete(
        _cleanup_state(trio["maggie"]["id"], trio["frankie"]["id"], trio["joycey"]["id"])
    )
    yield
    asyncio.get_event_loop().run_until_complete(
        _cleanup_state(trio["maggie"]["id"], trio["frankie"]["id"], trio["joycey"]["id"])
    )


# ── shared helpers ─────────────────────────────────────────────────
def _make_friends(a_token: str, a_id: str, b_id: str):
    """Send req from a→b then accept."""
    r = requests.post(f"{API}/friends/request", json={"from_id": a_id, "to_id": b_id}, headers=h(a_token), timeout=15)
    assert r.status_code == 200, f"friend/request -> {r.status_code} {r.text}"
    rid = r.json()["id"]
    r = requests.post(f"{API}/friends/accept/{rid}", headers=h(a_token), timeout=15)
    assert r.status_code == 200, f"friend/accept -> {r.status_code} {r.text}"


def _get_friends(target_uid: str, viewer_token: str):
    return requests.get(f"{API}/friends/{target_uid}", headers=h(viewer_token), timeout=15)


# ── tests ──────────────────────────────────────────────────────────
class TestFriendsEndpoint:
    """GET /api/friends/{user_id} — Fix #1 (Batch B iter158)"""

    def test_a_endpoint_reachable_empty(self, trio):
        r = _get_friends(trio["maggie"]["id"], trio["maggie"]["token"])
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["user_id"] == trio["maggie"]["id"]
        assert data["count"] == 0
        assert data["friends"] == []

    def test_b_two_way_friendship_counts(self, trio):
        # maggie→frankie friend request, accept
        _make_friends(trio["maggie"]["token"], trio["maggie"]["id"], trio["frankie"]["id"])
        r = _get_friends(trio["maggie"]["id"], trio["maggie"]["token"])
        assert r.status_code == 200
        data = r.json()
        assert data["count"] == 1, data
        assert len(data["friends"]) == 1
        assert data["friends"][0]["id"] == trio["frankie"]["id"]
        # slim shape
        for k in ("id", "first_name", "username", "avatar", "suburb"):
            assert k in data["friends"][0]

    def test_c_stale_one_way_uuid_excluded(self, trio):
        _make_friends(trio["maggie"]["token"], trio["maggie"]["id"], trio["frankie"]["id"])
        # inject a phantom uuid that has no user doc
        phantom = str(uuid.uuid4())

        async def _inject():
            db = await _mongo()
            await db.users.update_one({"id": trio["maggie"]["id"]}, {"$addToSet": {"friends": phantom}})
        asyncio.get_event_loop().run_until_complete(_inject())

        r = _get_friends(trio["maggie"]["id"], trio["maggie"]["token"])
        assert r.status_code == 200
        data = r.json()
        assert data["count"] == 1, f"phantom uuid inflated count: {data}"
        assert phantom not in [f["id"] for f in data["friends"]]

    def test_d_one_way_to_real_user_excluded(self, trio):
        _make_friends(trio["maggie"]["token"], trio["maggie"]["id"], trio["frankie"]["id"])

        # add joycey to maggie.friends but NOT the reverse
        async def _one_way():
            db = await _mongo()
            await db.users.update_one({"id": trio["maggie"]["id"]}, {"$addToSet": {"friends": trio["joycey"]["id"]}})
        asyncio.get_event_loop().run_until_complete(_one_way())

        r = _get_friends(trio["maggie"]["id"], trio["maggie"]["token"])
        assert r.status_code == 200
        data = r.json()
        assert data["count"] == 1, f"one-way to real user inflated count: {data}"
        assert trio["joycey"]["id"] not in [f["id"] for f in data["friends"]]

    def test_e_banned_friend_excluded(self, trio):
        _make_friends(trio["maggie"]["token"], trio["maggie"]["id"], trio["frankie"]["id"])

        async def _ban():
            db = await _mongo()
            await db.users.update_one({"id": trio["frankie"]["id"]}, {"$set": {"banned": True}})
        asyncio.get_event_loop().run_until_complete(_ban())

        r = _get_friends(trio["maggie"]["id"], trio["maggie"]["token"])
        assert r.status_code == 200
        data = r.json()
        assert data["count"] == 0, f"banned friend leaked: {data}"

    def test_f_profile_hidden_excluded(self, trio):
        _make_friends(trio["maggie"]["token"], trio["maggie"]["id"], trio["frankie"]["id"])

        async def _hide():
            db = await _mongo()
            await db.users.update_one({"id": trio["frankie"]["id"]}, {"$set": {"profile_hidden": True}})
        asyncio.get_event_loop().run_until_complete(_hide())

        r = _get_friends(trio["maggie"]["id"], trio["maggie"]["token"])
        assert r.status_code == 200
        data = r.json()
        assert data["count"] == 0, f"hidden friend leaked: {data}"

    def test_g_blocked_by_me_excluded(self, trio):
        _make_friends(trio["maggie"]["token"], trio["maggie"]["id"], trio["frankie"]["id"])

        async def _block():
            db = await _mongo()
            await db.users.update_one({"id": trio["maggie"]["id"]}, {"$addToSet": {"blocked": trio["frankie"]["id"]}})
        asyncio.get_event_loop().run_until_complete(_block())

        r = _get_friends(trio["maggie"]["id"], trio["maggie"]["token"])
        assert r.status_code == 200
        data = r.json()
        assert data["count"] == 0, f"blocked friend leaked: {data}"

    def test_h_blocked_by_them_excluded(self, trio):
        _make_friends(trio["maggie"]["token"], trio["maggie"]["id"], trio["frankie"]["id"])

        async def _block():
            db = await _mongo()
            await db.users.update_one({"id": trio["frankie"]["id"]}, {"$addToSet": {"blocked": trio["maggie"]["id"]}})
        asyncio.get_event_loop().run_until_complete(_block())

        r = _get_friends(trio["maggie"]["id"], trio["maggie"]["token"])
        assert r.status_code == 200
        data = r.json()
        assert data["count"] == 0, f"reverse-blocked friend leaked: {data}"

    def test_i_auth_403_when_other_user(self, trio):
        # joycey trying to read maggie's list should be 403
        r = _get_friends(trio["maggie"]["id"], trio["joycey"]["token"])
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"

    def test_j_auth_401_without_token(self, trio):
        r = requests.get(f"{API}/friends/{trio['maggie']['id']}", timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403 without token, got {r.status_code}"

    def test_k_ordering_matches_friends_array(self, trio):
        # friend both frankie and joycey to maggie; verify order preserved.
        _make_friends(trio["maggie"]["token"], trio["maggie"]["id"], trio["frankie"]["id"])
        _make_friends(trio["maggie"]["token"], trio["maggie"]["id"], trio["joycey"]["id"])

        async def _read_order():
            db = await _mongo()
            doc = await db.users.find_one({"id": trio["maggie"]["id"]}, {"friends": 1, "_id": 0})
            return doc.get("friends", [])
        order = asyncio.get_event_loop().run_until_complete(_read_order())

        r = _get_friends(trio["maggie"]["id"], trio["maggie"]["token"])
        assert r.status_code == 200
        data = r.json()
        assert data["count"] == 2
        got = [f["id"] for f in data["friends"]]
        # got should equal order filtered to just resolvable ids (both here)
        expected = [i for i in order if i in {trio["frankie"]["id"], trio["joycey"]["id"]}]
        assert got == expected, f"ordering mismatch got={got} expected={expected}"
