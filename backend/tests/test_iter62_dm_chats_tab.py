"""Iteration 62 — Backend tests for the new Chats tab DM endpoints.

Endpoints under test:
  - GET  /api/dm/{user_id}/conversations   (enhanced with unread_count + other.status)
  - GET  /api/dm/{user_id}/unread-total    (new)
  - POST /api/dm/{conv_id}/mark-read       (new)
  - Plus regression: /api/health, /api/auth/login, /api/auth/me

Notes:
  - There is no HTTP POST /api/messages endpoint (DM messages travel over
    WebSocket only in this codebase). To keep this suite WebSocket-free
    per the review request, we insert a Message document directly into
    MongoDB (same container, localhost:27017) to simulate "A sent B a
    message". This exercises exactly the same fields the WS handler
    writes (dm_id, user_id, text, created_at).
"""
import os
import sys
import time
import uuid
import datetime as _dt

import pytest
import requests
from pymongo import MongoClient

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://belong-together.preview.emergentagent.com"
).rstrip("/")

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


# ----------------------------------------------------------------------
# fixtures
# ----------------------------------------------------------------------
@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def mongo():
    return MongoClient(MONGO_URL)[DB_NAME]


def _rand_username(prefix: str) -> str:
    return f"TEST_{prefix}_{uuid.uuid4().hex[:8]}"


def _signup(api, username: str) -> dict:
    r = api.post(
        f"{BASE_URL}/api/auth/signup",
        json={
            "username": username,
            "password": "secret123",
            "email": f"{username}@example.com",
            "first_name": username[:15],
        },
        timeout=15,
    )
    assert r.status_code == 200, f"signup failed for {username}: {r.status_code} {r.text}"
    body = r.json()
    assert "access_token" in body and "user" in body
    return body  # {access_token, user}


@pytest.fixture(scope="module")
def user_a(api):
    return _signup(api, _rand_username("A"))


@pytest.fixture(scope="module")
def user_b(api):
    return _signup(api, _rand_username("B"))


@pytest.fixture(scope="module")
def user_c(api):
    """Third user used to prove the 403 branch of /unread-total."""
    return _signup(api, _rand_username("C"))


def _auth(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def dm_conv(api, user_a, user_b):
    """Start a DM between A and B, return the conversation doc."""
    r = api.post(
        f"{BASE_URL}/api/dm/start",
        json={"user_id": user_a["user"]["id"], "other_id": user_b["user"]["id"]},
        headers=_auth(user_a["access_token"]),
        timeout=10,
    )
    assert r.status_code == 200, f"dm/start failed: {r.status_code} {r.text}"
    conv = r.json()
    assert "id" in conv and "participants" in conv
    assert user_a["user"]["id"] in conv["participants"]
    assert user_b["user"]["id"] in conv["participants"]
    return conv


@pytest.fixture(scope="module")
def teardown_test_users(mongo, user_a, user_b, user_c, dm_conv):
    """Best-effort cleanup after the module runs so we don't leak TEST_*
    accounts and conversations into the shared dev database."""
    yield
    try:
        ids = [user_a["user"]["id"], user_b["user"]["id"], user_c["user"]["id"]]
        mongo.users.delete_many({"id": {"$in": ids}})
        mongo.dm_conversations.delete_many({"id": dm_conv["id"]})
        mongo.messages.delete_many({"dm_id": dm_conv["id"]})
    except Exception as e:
        print(f"cleanup warning: {e}")


# ----------------------------------------------------------------------
# Priority 3: baseline / regression (run first so failures halt suite cleanly)
# ----------------------------------------------------------------------
class TestBaseline:
    def test_13_health(self, api):
        r = api.get(f"{BASE_URL}/api/health", timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert body.get("status") == "ok"

    def test_14_login_realtest1(self, api):
        r = api.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": "realtest1", "password": "secret123"},
            timeout=15,
        )
        assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
        body = r.json()
        assert "access_token" in body and "user" in body

    def test_15_me_with_bearer(self, api):
        login = api.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": "realtest1", "password": "secret123"},
            timeout=15,
        )
        assert login.status_code == 200
        tok = login.json()["access_token"]
        r = api.get(f"{BASE_URL}/api/auth/me", headers=_auth(tok), timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert body.get("username") == "realtest1"


# ----------------------------------------------------------------------
# Priority 1: /api/dm/{user_id}/unread-total
# ----------------------------------------------------------------------
class TestUnreadTotal:
    def test_01_unread_total_owner_ok(self, api, user_a):
        r = api.get(
            f"{BASE_URL}/api/dm/{user_a['user']['id']}/unread-total",
            headers=_auth(user_a["access_token"]),
            timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "unread" in body
        assert isinstance(body["unread"], int)
        assert body["unread"] >= 0

    def test_02_unread_total_different_user_403(self, api, user_a, user_c):
        # user_c's token trying to read user_a's total → 403
        r = api.get(
            f"{BASE_URL}/api/dm/{user_a['user']['id']}/unread-total",
            headers=_auth(user_c["access_token"]),
            timeout=10,
        )
        assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"

    def test_03_unread_total_no_bearer_401(self, api, user_a):
        r = api.get(f"{BASE_URL}/api/dm/{user_a['user']['id']}/unread-total", timeout=10)
        # Auth failure is expected to be 401 (unauthenticated).
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}: {r.text}"


# ----------------------------------------------------------------------
# Priority 1: /api/dm/{conv_id}/mark-read
# ----------------------------------------------------------------------
class TestMarkRead:
    def test_04_mark_read_participant_ok(self, api, mongo, dm_conv, user_b):
        r = api.post(
            f"{BASE_URL}/api/dm/{dm_conv['id']}/mark-read",
            headers=_auth(user_b["access_token"]),
            timeout=10,
        )
        assert r.status_code == 200, r.text
        assert r.json() == {"ok": True}
        # Verify last_read_at.{uid} was actually set in Mongo
        conv = mongo.dm_conversations.find_one({"id": dm_conv["id"]}, {"_id": 0})
        assert conv is not None
        lra = conv.get("last_read_at") or {}
        assert user_b["user"]["id"] in lra
        # Should be an ISO-ish timestamp string
        assert isinstance(lra[user_b["user"]["id"]], str)

    def test_05_mark_read_non_participant_403(self, api, dm_conv, user_c):
        r = api.post(
            f"{BASE_URL}/api/dm/{dm_conv['id']}/mark-read",
            headers=_auth(user_c["access_token"]),
            timeout=10,
        )
        assert r.status_code == 403, r.text
        assert "participant" in (r.json().get("detail", "").lower())

    def test_06_mark_read_nonexistent_conv_404(self, api, user_a):
        r = api.post(
            f"{BASE_URL}/api/dm/does-not-exist-{uuid.uuid4().hex[:6]}/mark-read",
            headers=_auth(user_a["access_token"]),
            timeout=10,
        )
        assert r.status_code == 404, r.text

    def test_07_mark_read_no_bearer_401(self, api, dm_conv):
        r = api.post(f"{BASE_URL}/api/dm/{dm_conv['id']}/mark-read", timeout=10)
        assert r.status_code in (401, 403), r.text


# ----------------------------------------------------------------------
# Priority 2: enhanced /conversations endpoint + E2E flow
# ----------------------------------------------------------------------
class TestConversations:
    def test_08_conversations_has_unread_count(self, api, dm_conv, user_a):
        r = api.get(
            f"{BASE_URL}/api/dm/{user_a['user']['id']}/conversations",
            headers=_auth(user_a["access_token"]),
            timeout=10,
        )
        assert r.status_code == 200, r.text
        convs = r.json()
        assert isinstance(convs, list)
        assert len(convs) >= 1
        # Find our conv
        mine = next((c for c in convs if c.get("id") == dm_conv["id"]), None)
        assert mine is not None, f"conv not returned for user_a: {convs}"
        assert "unread_count" in mine, f"unread_count missing: {mine}"
        assert isinstance(mine["unread_count"], int)
        assert mine["unread_count"] >= 0

    def test_09_conversations_has_other_status(self, api, dm_conv, user_a):
        r = api.get(
            f"{BASE_URL}/api/dm/{user_a['user']['id']}/conversations",
            headers=_auth(user_a["access_token"]),
            timeout=10,
        )
        assert r.status_code == 200
        convs = r.json()
        mine = next((c for c in convs if c.get("id") == dm_conv["id"]), None)
        assert mine is not None
        other = mine.get("other")
        assert other is not None, "peer object missing"
        status = other.get("status")
        assert status is not None, f"other.status missing: {other}"
        # Shape: {code, emoji, label}
        for key in ("code", "emoji", "label"):
            assert key in status, f"status.{key} missing: {status}"

    def _insert_message(self, mongo, dm_id: str, sender_id: str, text: str) -> dict:
        """Simulate a WS message insert without opening a WebSocket."""
        now = _dt.datetime.now(_dt.timezone.utc).isoformat()
        doc = {
            "id": uuid.uuid4().hex,
            "table_id": None,
            "dm_id": dm_id,
            "user_id": sender_id,
            "user_name": "A",
            "avatar": "",
            "text": text,
            "image": "",
            "created_at": now,
        }
        mongo.messages.insert_one(doc)
        mongo.dm_conversations.update_one(
            {"id": dm_id}, {"$set": {"updated_at": now}}
        )
        return doc

    def test_10_e2e_unread_after_A_sends_to_B(self, api, mongo, dm_conv, user_a, user_b):
        # Ensure B has a baseline "clean" state by marking-read first
        api.post(
            f"{BASE_URL}/api/dm/{dm_conv['id']}/mark-read",
            headers=_auth(user_b["access_token"]),
            timeout=10,
        )
        time.sleep(0.5)  # ensure created_at > last_read_at
        # Now A sends 1 message
        self._insert_message(mongo, dm_conv["id"], user_a["user"]["id"], "hey B!")

        r = api.get(
            f"{BASE_URL}/api/dm/{user_b['user']['id']}/conversations",
            headers=_auth(user_b["access_token"]),
            timeout=10,
        )
        assert r.status_code == 200
        mine = next((c for c in r.json() if c.get("id") == dm_conv["id"]), None)
        assert mine is not None
        assert mine["unread_count"] == 1, f"expected 1 unread, got {mine['unread_count']}"

    def test_11_e2e_unread_zero_after_B_marks_read(self, api, dm_conv, user_b):
        # B marks-read
        r = api.post(
            f"{BASE_URL}/api/dm/{dm_conv['id']}/mark-read",
            headers=_auth(user_b["access_token"]),
            timeout=10,
        )
        assert r.status_code == 200

        r2 = api.get(
            f"{BASE_URL}/api/dm/{user_b['user']['id']}/conversations",
            headers=_auth(user_b["access_token"]),
            timeout=10,
        )
        assert r2.status_code == 200
        mine = next((c for c in r2.json() if c.get("id") == dm_conv["id"]), None)
        assert mine is not None
        assert mine["unread_count"] == 0, f"expected 0 after mark-read, got {mine['unread_count']}"

    def test_12_unread_total_matches_conversations_sum(self, api, mongo, dm_conv, user_a, user_b):
        # Reset B's state, then send 3 messages from A
        api.post(
            f"{BASE_URL}/api/dm/{dm_conv['id']}/mark-read",
            headers=_auth(user_b["access_token"]),
            timeout=10,
        )
        time.sleep(0.5)
        for i in range(3):
            TestConversations._insert_message(
                self, mongo, dm_conv["id"], user_a["user"]["id"], f"msg-{i}"
            )

        convs = api.get(
            f"{BASE_URL}/api/dm/{user_b['user']['id']}/conversations",
            headers=_auth(user_b["access_token"]),
            timeout=10,
        ).json()
        sum_unread = sum(int(c.get("unread_count", 0)) for c in convs)

        tot = api.get(
            f"{BASE_URL}/api/dm/{user_b['user']['id']}/unread-total",
            headers=_auth(user_b["access_token"]),
            timeout=10,
        )
        assert tot.status_code == 200
        assert tot.json()["unread"] == sum_unread, (
            f"unread-total {tot.json()['unread']} != conversations sum {sum_unread}"
        )
        assert tot.json()["unread"] >= 3
