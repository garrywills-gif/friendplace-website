"""Iteration 63 — Backend tests for the Chats archive & soft-delete endpoints.

Endpoints under test (all under /api):
  - GET  /dm/{user_id}/conversations?filter=active|archived|all  (new filter + is_archived)
  - GET  /dm/{user_id}/archived-count
  - POST /dm/{conv_id}/archive
  - POST /dm/{conv_id}/unarchive
  - POST /dm/{conv_id}/hide
  - POST /dm/{conv_id}/unhide
  - Regression: /api/health, /dm/{uid}/conversations (default filter),
                /dm/{conv_id}/mark-read, /dm/{uid}/unread-total

Per review request, WebSocket messages are simulated by direct Mongo writes
(mirrors the WS handler that resets archived_for and hidden_for on new msg).
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
    or "https://friendplace-v1.preview.emergentagent.com"
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
    return f"TEST_i63_{prefix}_{uuid.uuid4().hex[:8]}"


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
    return body


def _auth(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def user_a(api):
    return _signup(api, _rand_username("A"))


@pytest.fixture(scope="module")
def user_b(api):
    return _signup(api, _rand_username("B"))


@pytest.fixture(scope="module")
def user_c(api):
    """Third user (not a participant) to prove 403 branches."""
    return _signup(api, _rand_username("C"))


@pytest.fixture(scope="module")
def dm_conv(api, user_a, user_b):
    r = api.post(
        f"{BASE_URL}/api/dm/start",
        json={"user_id": user_a["user"]["id"], "other_id": user_b["user"]["id"]},
        headers=_auth(user_a["access_token"]),
        timeout=10,
    )
    assert r.status_code == 200, f"dm/start failed: {r.status_code} {r.text}"
    conv = r.json()
    assert "id" in conv and "participants" in conv
    return conv


@pytest.fixture(scope="module", autouse=True)
def _cleanup(mongo, request):
    """Best-effort teardown after the module runs."""
    yield
    try:
        # user fixtures may not have been created if collection failed; guard
        users_to_delete = []
        for name in ("user_a", "user_b", "user_c"):
            if name in request.node.session._fixturemanager._arg2fixturedefs:
                pass
        # simpler: just delete any TEST_i63_ prefixed users
        mongo.users.delete_many({"username": {"$regex": "^TEST_i63_"}})
        # And any dm_conversations whose participants are all gone will be
        # orphaned; leave them (id is uuid) — not critical.
    except Exception as e:
        print(f"cleanup warning: {e}")


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------
def _get_convs(api, tok: str, uid: str, filt: str | None = None):
    url = f"{BASE_URL}/api/dm/{uid}/conversations"
    if filt:
        url += f"?filter={filt}"
    r = api.get(url, headers=_auth(tok), timeout=10)
    assert r.status_code == 200, f"conversations {filt}: {r.status_code} {r.text}"
    return r.json()


def _archived_count(api, tok: str, uid: str) -> int:
    r = api.get(
        f"{BASE_URL}/api/dm/{uid}/archived-count",
        headers=_auth(tok),
        timeout=10,
    )
    assert r.status_code == 200, r.text
    return r.json()["count"]


def _simulate_ws_message(mongo, dm_id: str, sender_id: str, text: str = "hi"):
    """Simulate what the WS message handler does:
    - insert a message doc
    - update conv updated_at, RESET archived_for AND hidden_for to []
    """
    now = _dt.datetime.now(_dt.timezone.utc).isoformat()
    doc = {
        "id": uuid.uuid4().hex,
        "table_id": None,
        "dm_id": dm_id,
        "user_id": sender_id,
        "user_name": "sender",
        "avatar": "",
        "text": text,
        "image": "",
        "created_at": now,
    }
    mongo.messages.insert_one(doc)
    mongo.dm_conversations.update_one(
        {"id": dm_id},
        {"$set": {"updated_at": now, "archived_for": [], "hidden_for": []}},
    )
    return doc


# ======================================================================
# Priority 5: Regression (run first so failures halt early)
# ======================================================================
class TestRegression:
    def test_17_health(self, api):
        r = api.get(f"{BASE_URL}/api/health", timeout=10)
        assert r.status_code == 200
        assert r.json().get("status") == "ok"

    def test_18_conversations_default_schema(self, api, dm_conv, user_a):
        convs = _get_convs(api, user_a["access_token"], user_a["user"]["id"])
        mine = next((c for c in convs if c.get("id") == dm_conv["id"]), None)
        assert mine is not None, "conv not returned by default (active) filter"
        # previously verified fields
        assert "unread_count" in mine and isinstance(mine["unread_count"], int)
        other = mine.get("other")
        assert other is not None
        status = other.get("status")
        assert status and all(k in status for k in ("code", "emoji", "label"))
        # NEW: is_archived must be present on every conv (default False)
        assert "is_archived" in mine
        assert isinstance(mine["is_archived"], bool)
        assert mine["is_archived"] is False

    def test_19_mark_read_still_works(self, api, dm_conv, user_b):
        r = api.post(
            f"{BASE_URL}/api/dm/{dm_conv['id']}/mark-read",
            headers=_auth(user_b["access_token"]),
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json() == {"ok": True}


# ======================================================================
# Priority 1: Auth & guards
# ======================================================================
class TestGuards:
    def test_01_archive_no_bearer_401(self, api, dm_conv):
        r = api.post(f"{BASE_URL}/api/dm/{dm_conv['id']}/archive", timeout=10)
        assert r.status_code in (401, 403), r.text  # FastAPI HTTPBearer -> 403 by default; either is fine as "unauthenticated"

    def test_02_archive_non_participant_403(self, api, dm_conv, user_c):
        r = api.post(
            f"{BASE_URL}/api/dm/{dm_conv['id']}/archive",
            headers=_auth(user_c["access_token"]),
            timeout=10,
        )
        assert r.status_code == 403, r.text
        assert "participant" in r.json().get("detail", "").lower()

    def test_03_archive_invalid_conv_404(self, api, user_a):
        r = api.post(
            f"{BASE_URL}/api/dm/does-not-exist-{uuid.uuid4().hex[:6]}/archive",
            headers=_auth(user_a["access_token"]),
            timeout=10,
        )
        assert r.status_code == 404, r.text

    @pytest.mark.parametrize("action", ["unarchive", "hide", "unhide"])
    def test_04_unarchive_hide_unhide_401(self, api, dm_conv, action):
        r = api.post(f"{BASE_URL}/api/dm/{dm_conv['id']}/{action}", timeout=10)
        assert r.status_code in (401, 403), f"{action}: {r.status_code} {r.text}"

    @pytest.mark.parametrize("action", ["unarchive", "hide", "unhide"])
    def test_04_unarchive_hide_unhide_403(self, api, dm_conv, user_c, action):
        r = api.post(
            f"{BASE_URL}/api/dm/{dm_conv['id']}/{action}",
            headers=_auth(user_c["access_token"]),
            timeout=10,
        )
        assert r.status_code == 403, f"{action}: {r.status_code} {r.text}"

    @pytest.mark.parametrize("action", ["unarchive", "hide", "unhide"])
    def test_04_unarchive_hide_unhide_404(self, api, user_a, action):
        r = api.post(
            f"{BASE_URL}/api/dm/does-not-exist-{uuid.uuid4().hex[:6]}/{action}",
            headers=_auth(user_a["access_token"]),
            timeout=10,
        )
        assert r.status_code == 404, f"{action}: {r.status_code} {r.text}"

    def test_05_archived_count_other_user_403(self, api, user_a, user_c):
        r = api.get(
            f"{BASE_URL}/api/dm/{user_a['user']['id']}/archived-count",
            headers=_auth(user_c["access_token"]),
            timeout=10,
        )
        assert r.status_code == 403, r.text
        assert "authorised" in r.json().get("detail", "").lower() or "authorized" in r.json().get("detail", "").lower()


# ======================================================================
# Priority 2: Archive lifecycle
# ======================================================================
class TestArchiveLifecycle:
    def test_06_initial_state(self, api, mongo, dm_conv, user_a):
        # Reset the conv to a clean state (in case another test polluted)
        mongo.dm_conversations.update_one(
            {"id": dm_conv["id"]},
            {"$set": {"archived_for": [], "hidden_for": []}},
        )
        active = _get_convs(api, user_a["access_token"], user_a["user"]["id"], "active")
        archived = _get_convs(api, user_a["access_token"], user_a["user"]["id"], "archived")
        assert any(c.get("id") == dm_conv["id"] for c in active), "conv missing from active"
        assert not any(c.get("id") == dm_conv["id"] for c in archived), "conv should not be in archived"
        assert _archived_count(api, user_a["access_token"], user_a["user"]["id"]) == 0

    def test_07_archive_moves_to_archived(self, api, dm_conv, user_a):
        r = api.post(
            f"{BASE_URL}/api/dm/{dm_conv['id']}/archive",
            headers=_auth(user_a["access_token"]),
            timeout=10,
        )
        assert r.status_code == 200, r.text
        assert r.json() == {"ok": True}

        uid_a = user_a["user"]["id"]
        tok_a = user_a["access_token"]

        active = _get_convs(api, tok_a, uid_a, "active")
        archived = _get_convs(api, tok_a, uid_a, "archived")
        assert not any(c.get("id") == dm_conv["id"] for c in active), "should be removed from active after archive"
        mine_arch = next((c for c in archived if c.get("id") == dm_conv["id"]), None)
        assert mine_arch is not None, "should appear in archived"
        assert mine_arch.get("is_archived") is True, f"is_archived should be True; got {mine_arch.get('is_archived')}"
        assert _archived_count(api, tok_a, uid_a) == 1

    def test_08_peer_view_unaffected(self, api, dm_conv, user_b):
        """B's view must be untouched by A's archive."""
        uid_b = user_b["user"]["id"]
        tok_b = user_b["access_token"]
        active_b = _get_convs(api, tok_b, uid_b, "active")
        mine_b = next((c for c in active_b if c.get("id") == dm_conv["id"]), None)
        assert mine_b is not None, "B's active view should still show the conv"
        assert mine_b.get("is_archived") is False, "B's is_archived should be False (per-user flag)"
        assert _archived_count(api, tok_b, uid_b) == 0

    def test_09_unarchive_restores(self, api, dm_conv, user_a):
        r = api.post(
            f"{BASE_URL}/api/dm/{dm_conv['id']}/unarchive",
            headers=_auth(user_a["access_token"]),
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json() == {"ok": True}

        uid_a = user_a["user"]["id"]
        tok_a = user_a["access_token"]
        active = _get_convs(api, tok_a, uid_a, "active")
        archived = _get_convs(api, tok_a, uid_a, "archived")
        assert any(c.get("id") == dm_conv["id"] for c in active), "should be back in active"
        assert not any(c.get("id") == dm_conv["id"] for c in archived)
        assert _archived_count(api, tok_a, uid_a) == 0

    def test_10_new_message_auto_unarchives(self, api, mongo, dm_conv, user_a, user_b):
        # A archives again
        r = api.post(
            f"{BASE_URL}/api/dm/{dm_conv['id']}/archive",
            headers=_auth(user_a["access_token"]),
            timeout=10,
        )
        assert r.status_code == 200
        # A marks-read first so we get a clean unread_count baseline
        api.post(
            f"{BASE_URL}/api/dm/{dm_conv['id']}/mark-read",
            headers=_auth(user_a["access_token"]),
            timeout=10,
        )
        time.sleep(0.5)
        # B "sends" a message → WS handler resets archived_for/hidden_for
        _simulate_ws_message(mongo, dm_conv["id"], user_b["user"]["id"], "yo A!")

        uid_a = user_a["user"]["id"]
        tok_a = user_a["access_token"]
        active = _get_convs(api, tok_a, uid_a, "active")
        mine = next((c for c in active if c.get("id") == dm_conv["id"]), None)
        assert mine is not None, "conv should have resurfaced in active after peer message"
        assert mine.get("is_archived") is False
        assert mine["unread_count"] >= 1, f"expected unread>=1, got {mine['unread_count']}"


# ======================================================================
# Priority 3: Soft-delete lifecycle
# ======================================================================
class TestHideLifecycle:
    def test_11_hide_removes_from_all_filters(self, api, mongo, dm_conv, user_a):
        # Clean baseline
        mongo.dm_conversations.update_one(
            {"id": dm_conv["id"]},
            {"$set": {"archived_for": [], "hidden_for": []}},
        )
        # A hides
        r = api.post(
            f"{BASE_URL}/api/dm/{dm_conv['id']}/hide",
            headers=_auth(user_a["access_token"]),
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json() == {"ok": True}

        uid_a = user_a["user"]["id"]
        tok_a = user_a["access_token"]
        for filt in ("active", "archived", "all"):
            convs = _get_convs(api, tok_a, uid_a, filt)
            assert not any(c.get("id") == dm_conv["id"] for c in convs), (
                f"hidden conv leaked into filter={filt}: {[c.get('id') for c in convs]}"
            )
        # archived-count must also exclude hidden
        assert _archived_count(api, tok_a, uid_a) == 0

    def test_12_hide_peer_unaffected(self, api, dm_conv, user_b):
        uid_b = user_b["user"]["id"]
        tok_b = user_b["access_token"]
        active_b = _get_convs(api, tok_b, uid_b, "active")
        assert any(c.get("id") == dm_conv["id"] for c in active_b), "B's active view must still show the conv"

    def test_13_unhide_restores(self, api, dm_conv, user_a):
        r = api.post(
            f"{BASE_URL}/api/dm/{dm_conv['id']}/unhide",
            headers=_auth(user_a["access_token"]),
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json() == {"ok": True}
        uid_a = user_a["user"]["id"]
        tok_a = user_a["access_token"]
        active = _get_convs(api, tok_a, uid_a, "active")
        assert any(c.get("id") == dm_conv["id"] for c in active), "conv should be back in active after unhide"

    def test_14_new_message_auto_unhides(self, api, mongo, dm_conv, user_a, user_b):
        # A hides again
        r = api.post(
            f"{BASE_URL}/api/dm/{dm_conv['id']}/hide",
            headers=_auth(user_a["access_token"]),
            timeout=10,
        )
        assert r.status_code == 200

        # Mark-read for A so unread starts at 0
        api.post(
            f"{BASE_URL}/api/dm/{dm_conv['id']}/mark-read",
            headers=_auth(user_a["access_token"]),
            timeout=10,
        )
        time.sleep(0.5)
        # B sends → WS handler wipes hidden_for
        _simulate_ws_message(mongo, dm_conv["id"], user_b["user"]["id"], "back again")

        uid_a = user_a["user"]["id"]
        tok_a = user_a["access_token"]
        active = _get_convs(api, tok_a, uid_a, "active")
        mine = next((c for c in active if c.get("id") == dm_conv["id"]), None)
        assert mine is not None, "conv should auto-resurrect after peer message"
        assert mine["unread_count"] >= 1


# ======================================================================
# Priority 4: Unread badge accuracy
# ======================================================================
class TestUnreadBadgeAccuracy:
    def test_15_unread_total_excludes_hidden(self, api, mongo, dm_conv, user_a, user_b):
        # Reset — B sends an unread msg — A hides — total must be 0
        mongo.dm_conversations.update_one(
            {"id": dm_conv["id"]},
            {"$set": {"archived_for": [], "hidden_for": [], "last_read_at": {}}},
        )
        # A marks-read first
        api.post(
            f"{BASE_URL}/api/dm/{dm_conv['id']}/mark-read",
            headers=_auth(user_a["access_token"]),
            timeout=10,
        )
        time.sleep(0.5)
        # Insert an unread message from B (without resetting archived/hidden;
        # we're simulating the RAW insert case where A has NOT yet hidden)
        now = _dt.datetime.now(_dt.timezone.utc).isoformat()
        mongo.messages.insert_one({
            "id": uuid.uuid4().hex,
            "dm_id": dm_conv["id"],
            "user_id": user_b["user"]["id"],
            "text": "unread-15",
            "created_at": now,
        })
        mongo.dm_conversations.update_one({"id": dm_conv["id"]}, {"$set": {"updated_at": now}})

        # Sanity: total > 0
        pre = api.get(
            f"{BASE_URL}/api/dm/{user_a['user']['id']}/unread-total",
            headers=_auth(user_a["access_token"]),
            timeout=10,
        )
        assert pre.status_code == 200
        pre_val = pre.json()["unread"]
        assert pre_val >= 1, f"expected unread>=1 before hide, got {pre_val}"

        # A hides
        r = api.post(
            f"{BASE_URL}/api/dm/{dm_conv['id']}/hide",
            headers=_auth(user_a["access_token"]),
            timeout=10,
        )
        assert r.status_code == 200

        # unread-total for A now should exclude this conv
        post = api.get(
            f"{BASE_URL}/api/dm/{user_a['user']['id']}/unread-total",
            headers=_auth(user_a["access_token"]),
            timeout=10,
        )
        assert post.status_code == 200
        # It should be pre_val - (messages that were unread in the hidden conv)
        # Simplest assertion: strictly less than pre_val (dropped a hidden conv)
        assert post.json()["unread"] < pre_val, (
            f"unread-total should drop after hide (pre={pre_val}, post={post.json()['unread']})"
        )

    def test_16_unread_total_includes_archived(self, api, mongo, dm_conv, user_a, user_b):
        # Reset — un-hide, un-archive, mark-read, then archive + send unread
        mongo.dm_conversations.update_one(
            {"id": dm_conv["id"]},
            {"$set": {"archived_for": [], "hidden_for": [], "last_read_at": {}}},
        )
        # A marks-read
        api.post(
            f"{BASE_URL}/api/dm/{dm_conv['id']}/mark-read",
            headers=_auth(user_a["access_token"]),
            timeout=10,
        )
        time.sleep(0.3)
        # Baseline: 0 unread
        baseline = api.get(
            f"{BASE_URL}/api/dm/{user_a['user']['id']}/unread-total",
            headers=_auth(user_a["access_token"]),
            timeout=10,
        ).json()["unread"]

        # A archives (NOT hides)
        r = api.post(
            f"{BASE_URL}/api/dm/{dm_conv['id']}/archive",
            headers=_auth(user_a["access_token"]),
            timeout=10,
        )
        assert r.status_code == 200

        # Manually insert an unread msg from B WITHOUT clearing archived_for
        # (this tests: archived is still counted; auto-clear only happens on real WS path)
        now = _dt.datetime.now(_dt.timezone.utc).isoformat()
        mongo.messages.insert_one({
            "id": uuid.uuid4().hex,
            "dm_id": dm_conv["id"],
            "user_id": user_b["user"]["id"],
            "text": "unread-16",
            "created_at": now,
        })
        mongo.dm_conversations.update_one({"id": dm_conv["id"]}, {"$set": {"updated_at": now}})

        post = api.get(
            f"{BASE_URL}/api/dm/{user_a['user']['id']}/unread-total",
            headers=_auth(user_a["access_token"]),
            timeout=10,
        )
        assert post.status_code == 200
        assert post.json()["unread"] >= baseline + 1, (
            f"archived unread should count (baseline={baseline}, post={post.json()['unread']})"
        )
