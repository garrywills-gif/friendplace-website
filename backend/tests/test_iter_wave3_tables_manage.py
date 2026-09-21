"""Wave 3 (FP Café tables) backend tests.

Covers:
- POST /api/tables with invite_ids -> only chosen friends get table_invite
- POST /api/tables without invite_ids -> all confirmed friends get notified
- PATCH /api/tables/{id} host-only edit, non-host 403, protected 403
- DELETE /api/tables/{id} host-only close, non-host 403, protected 403
"""

import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL required"
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _demo_login(api_client, username):
    r = api_client.post(f"{API}/auth/demo-login", json={"username": username})
    assert r.status_code == 200, f"demo-login {username}: {r.status_code} {r.text}"
    return r.json()["user"]


def _friend_ids(user_obj):
    return list(user_obj.get("friends") or [])


@pytest.fixture(scope="module")
def maggie(api_client):
    return _demo_login(api_client, "maggie")


@pytest.fixture(scope="module")
def frankie(api_client):
    return _demo_login(api_client, "frankie")


@pytest.fixture(scope="module")
def joycey(api_client):
    return _demo_login(api_client, "joycey")


@pytest.fixture(scope="module")
def billdo(api_client):
    return _demo_login(api_client, "billdo")


def _ensure_friends(api_client, a_user, b_user):
    """Ensure a & b are confirmed friends. Uses request+accept if needed."""
    a_id = a_user["id"]
    b_id = b_user["id"]
    if b_id in _friend_ids(a_user):
        return True
    # Try to send request (FriendRequest uses from_id/to_id)
    api_client.post(f"{API}/friends/request", json={"from_id": a_id, "to_id": b_id})
    inbox = api_client.get(f"{API}/friends/inbox/{b_id}")
    rid = None
    if inbox.status_code == 200:
        for item in (inbox.json() or {}).get("incoming", []):
            if item.get("from_id") == a_id and item.get("status") == "pending":
                rid = item.get("id")
                break
    if rid:
        api_client.post(f"{API}/friends/accept/{rid}")
    # Re-fetch a via demo-login (refresh friends array)
    r = api_client.post(f"{API}/auth/demo-login", json={"username": a_user.get("username")})
    if r.status_code == 200:
        return b_id in _friend_ids(r.json()["user"])
    return False


class TestTableManagement:
    def test_health(self, api_client):
        r = api_client.get(f"{API}/health")
        assert r.status_code in (200, 404)  # accept either

    def test_list_tables_has_fp_cafe(self, api_client):
        r = api_client.get(f"{API}/tables")
        assert r.status_code == 200
        docs = r.json()
        assert isinstance(docs, list)
        ids = [d.get("id") for d in docs]
        assert "fp-cafe-permanent" in ids, "FP Café permanent table missing from listing"
        fp = next(d for d in docs if d["id"] == "fp-cafe-permanent")
        assert fp.get("protected") is True
        assert fp.get("persistent") is True

    def test_create_public_table_and_edit_and_delete(self, api_client, maggie):
        # Create
        payload = {
            "name": "TEST_wave3_public",
            "emoji": "🧪",
            "description": "wave3 test table",
            "visibility": "public",
            "host_id": maggie["id"],
        }
        r = api_client.post(f"{API}/tables", json=payload)
        assert r.status_code == 200, r.text
        table = r.json()
        tid = table["id"]
        assert table["host_id"] == maggie["id"]

        # Non-host edit -> 403
        r_bad = api_client.patch(
            f"{API}/tables/{tid}",
            json={"host_id": "not-the-host", "name": "hacked"},
        )
        assert r_bad.status_code == 403

        # Host edit
        r_edit = api_client.patch(
            f"{API}/tables/{tid}",
            json={"host_id": maggie["id"], "name": "TEST_wave3_edited", "description": "updated"},
        )
        assert r_edit.status_code == 200, r_edit.text
        edited = r_edit.json()
        assert edited["name"] == "TEST_wave3_edited"
        assert edited["description"] == "updated"

        # GET verify persistence
        r_get = api_client.get(f"{API}/tables")
        assert r_get.status_code == 200
        found = next((d for d in r_get.json() if d["id"] == tid), None)
        assert found is not None
        assert found["name"] == "TEST_wave3_edited"

        # Non-host delete -> 403
        r_del_bad = api_client.delete(f"{API}/tables/{tid}?host_id=not-the-host")
        assert r_del_bad.status_code == 403

        # Host delete
        r_del = api_client.delete(f"{API}/tables/{tid}?host_id={maggie['id']}")
        assert r_del.status_code == 200

        # Verify gone
        r_get2 = api_client.get(f"{API}/tables")
        ids = [d["id"] for d in r_get2.json()]
        assert tid not in ids, "deleted table still listed"

    def test_protected_table_cannot_be_edited_or_deleted(self, api_client, maggie):
        tid = "fp-cafe-permanent"
        # Even the "host" (whoever it is) cannot mutate a protected table
        r_edit = api_client.patch(
            f"{API}/tables/{tid}",
            json={"host_id": maggie["id"], "name": "SHOULD_NOT_APPLY"},
        )
        assert r_edit.status_code == 403

        r_del = api_client.delete(f"{API}/tables/{tid}?host_id={maggie['id']}")
        assert r_del.status_code == 403

        # Still exists and unchanged
        r = api_client.get(f"{API}/tables")
        fp = next((d for d in r.json() if d["id"] == tid), None)
        assert fp is not None
        assert fp["name"] != "SHOULD_NOT_APPLY"

    def test_friends_only_invite_notifies_only_selected(
        self, api_client, maggie, frankie, joycey
    ):
        # Ensure friendships: maggie<->frankie, maggie<->joycey
        assert _ensure_friends(api_client, maggie, frankie), "maggie/frankie not friends"
        assert _ensure_friends(api_client, maggie, joycey), "maggie/joycey not friends"

        # Snapshot notifications before
        def _table_invite_ids(uid):
            r = api_client.get(f"{API}/notifications/{uid}")
            if r.status_code != 200:
                return set()
            out = set()
            for n in r.json() or []:
                data = n.get("payload") or n.get("data") or {}
                if n.get("type") == "table_invite" and data.get("table_id"):
                    out.add(data["table_id"])
            return out

        before_frank = _table_invite_ids(frankie["id"])
        before_joyce = _table_invite_ids(joycey["id"])

        # Create Friends-only table inviting ONLY frankie
        payload = {
            "name": "TEST_wave3_friends_only",
            "emoji": "🎯",
            "description": "invite frankie only",
            "visibility": "friends",
            "host_id": maggie["id"],
            "invite_ids": [frankie["id"]],
        }
        r = api_client.post(f"{API}/tables", json=payload)
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        time.sleep(1.0)

        after_frank = _table_invite_ids(frankie["id"])
        after_joyce = _table_invite_ids(joycey["id"])

        assert tid in after_frank, "frankie should have received table_invite"
        assert tid not in after_joyce, "joycey should NOT have received table_invite (not selected)"

        # Cleanup
        api_client.delete(f"{API}/tables/{tid}?host_id={maggie['id']}")

    def test_invite_ids_ignores_non_friends(self, api_client, maggie, billdo):
        # Snapshot billdo notifications
        r0 = api_client.get(f"{API}/notifications/{billdo['id']}")
        before = set()
        if r0.status_code == 200:
            before = {
                (n.get("payload") or n.get("data") or {}).get("table_id")
                for n in r0.json() or []
                if n.get("type") == "table_invite"
            }

        # If billdo happens to be a friend of maggie already, skip
        friend_ids = _friend_ids(maggie)
        if billdo["id"] in friend_ids:
            pytest.skip("billdo is already a friend of maggie in this env")

        payload = {
            "name": "TEST_wave3_stranger_invite",
            "emoji": "🚫",
            "description": "should not notify billdo",
            "visibility": "friends",
            "host_id": maggie["id"],
            "invite_ids": [billdo["id"]],  # not a friend
        }
        r = api_client.post(f"{API}/tables", json=payload)
        assert r.status_code == 200
        tid = r.json()["id"]
        time.sleep(1.0)

        r2 = api_client.get(f"{API}/notifications/{billdo['id']}")
        after = set()
        if r2.status_code == 200:
            after = {
                (n.get("payload") or n.get("data") or {}).get("table_id")
                for n in r2.json() or []
                if n.get("type") == "table_invite"
            }
        assert tid not in (after - before), "non-friend invite_id must be ignored"

        api_client.delete(f"{API}/tables/{tid}?host_id={maggie['id']}")

    def test_no_invite_ids_notifies_all_friends(
        self, api_client, maggie, frankie, joycey
    ):
        assert _ensure_friends(api_client, maggie, frankie)
        assert _ensure_friends(api_client, maggie, joycey)

        def _ids(uid):
            r = api_client.get(f"{API}/notifications/{uid}")
            if r.status_code != 200:
                return set()
            return {
                (n.get("payload") or n.get("data") or {}).get("table_id")
                for n in r.json() or []
                if n.get("type") == "table_invite"
            }

        before_f = _ids(frankie["id"])
        before_j = _ids(joycey["id"])

        payload = {
            "name": "TEST_wave3_all_friends",
            "emoji": "🌟",
            "description": "notify all friends",
            "visibility": "public",
            "host_id": maggie["id"],
            # No invite_ids
        }
        r = api_client.post(f"{API}/tables", json=payload)
        assert r.status_code == 200
        tid = r.json()["id"]
        time.sleep(1.0)

        after_f = _ids(frankie["id"])
        after_j = _ids(joycey["id"])
        assert tid in after_f, "frankie (friend) should be notified"
        assert tid in after_j, "joycey (friend) should be notified"

        api_client.delete(f"{API}/tables/{tid}?host_id={maggie['id']}")


class TestLoginRoutingWave4:
    """Wave 4: web smoke tests only. Apple native is NOT testable here."""

    def test_login_routes_reachable(self, api_client):
        r = api_client.get(BASE_URL + "/auth/login")
        # The Expo web preview returns 200 with HTML for the login route
        assert r.status_code in (200, 404)  # SPA may 404 at path; just no 5xx

    def test_google_endpoint_shape(self, api_client):
        # Should exist and reject empty payload with 4xx (not 5xx)
        r = api_client.post(f"{API}/auth/google", json={})
        assert 400 <= r.status_code < 500, f"unexpected {r.status_code}: {r.text}"
