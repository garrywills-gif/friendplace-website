"""Iter31 — Founders Benefits feature tests.

Covers:
- GET /api/founders (Founders Wall listing, sorted by founder_number)
- GET /api/founders/status (taken/cap/remaining/open)
- Founders Lounge GROUP exists with is_founder_only + all founder members
- Founders Lounge TABLE exists with founder_only + persistent + seated + host_id
- Founder-only join guards (table + group) for non-founder vs founder
- Auto-enrolment at signup: new founder gets badge, is added to group + table,
  and receives Welcome + Founder notifications.
"""

import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://outreach-campaigns.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def state(api):
    """Shared state for chained assertions."""
    return {}


# ---------------------------- 1. Founders Wall ---------------------------- #
class TestFoundersWall:
    def test_founders_wall_shape_and_sort(self, api, state):
        r = api.get(f"{BASE_URL}/api/founders")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "total" in data and "items" in data
        items = data["items"]
        assert isinstance(items, list)
        state["initial_total"] = data["total"]
        state["initial_items"] = items
        # Sorted ascending by founder_number
        nums = [i.get("founder_number") for i in items]
        assert nums == sorted(nums), f"founders not sorted asc: {nums}"
        # Required fields & no demo / no _id leak
        for it in items:
            for key in ("id", "first_name", "username", "avatar", "founder_number", "suburb", "created_at"):
                assert key in it, f"missing {key} in {it}"
            assert "_id" not in it
            assert "password_hash" not in it

    def test_founders_status(self, api, state):
        r = api.get(f"{BASE_URL}/api/founders/status")
        assert r.status_code == 200, r.text
        data = r.json()
        for key in ("taken", "cap", "remaining", "open"):
            assert key in data, f"missing {key}"
        assert data["cap"] == 250
        assert data["remaining"] == data["cap"] - data["taken"]
        assert data["open"] is (data["taken"] < data["cap"])
        state["pre_taken"] = data["taken"]


# -------------------- 2. Founders Lounge GROUP + TABLE -------------------- #
class TestFoundersLoungeArtifacts:
    def test_founders_group_exists(self, api, state):
        # iter164ae: Founders Lounge is now flagged is_system=True and
        # therefore excluded from the default /api/groups list. Pass
        # include_system=true to keep this test aligned with the
        # production listing behaviour.
        r = api.get(f"{BASE_URL}/api/groups", params={"include_system": "true"})
        assert r.status_code == 200
        groups = r.json()
        fl = [g for g in groups if g.get("name") == "Founders Lounge"]
        assert len(fl) == 1, "expected exactly one Founders Lounge group"
        g = fl[0]
        assert g.get("is_founder_only") is True
        members = g.get("members") or []
        # Every existing founder id must be a member
        founder_ids = [i["id"] for i in state.get("initial_items", [])]
        for fid in founder_ids:
            assert fid in members, f"founder {fid} not in Founders Lounge group members"
        state["fl_group_id"] = g["id"]

    def test_founders_table_exists(self, api, state):
        r = api.get(f"{BASE_URL}/api/tables")
        assert r.status_code == 200
        tables = r.json()
        fl = [t for t in tables if t.get("name") == "Founders Lounge"]
        assert len(fl) >= 1, "expected a Founders Lounge table"
        t = fl[0]
        assert t.get("founder_only") is True
        assert t.get("persistent") is True
        assert isinstance(t.get("host_id"), str) and t["host_id"], "host_id must be non-empty"
        seated = t.get("seated") or []
        founder_ids = [i["id"] for i in state.get("initial_items", [])]
        for fid in founder_ids:
            assert fid in seated, f"founder {fid} not seated at Founders Lounge table"
        # host_id should be a real founder (the first one by sort order)
        if founder_ids:
            assert t["host_id"] in founder_ids
        state["fl_table_id"] = t["id"]


# ---------------------- 3. Founder-only join guards ---------------------- #
class TestFounderOnlyJoinGuards:
    @pytest.fixture(scope="class")
    def non_founder(self, api):
        # demo accounts are non-founders by definition
        r = api.post(f"{BASE_URL}/api/auth/demo-login", json={"username": "maggie"})
        assert r.status_code == 200, r.text
        u = r.json()["user"]
        assert u.get("is_founder") is not True
        return u

    @pytest.fixture(scope="class")
    def founder(self, api, state):
        items = state.get("initial_items") or []
        if not items:
            pytest.skip("no existing founders in DB to test founder-allowed path")
        # We just need the id; auth not required for join endpoints
        return items[0]

    def test_table_join_blocks_non_founder(self, api, state, non_founder):
        tid = state["fl_table_id"]
        r = api.post(f"{BASE_URL}/api/tables/{tid}/join/{non_founder['id']}")
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
        body = r.json()
        detail = body.get("detail")
        # detail may be either a dict or a string carrying the code
        if isinstance(detail, dict):
            assert detail.get("code") == "founder_only"
        else:
            assert "founder_only" in str(detail)

    def test_table_join_allows_founder(self, api, state, founder):
        tid = state["fl_table_id"]
        r = api.post(f"{BASE_URL}/api/tables/{tid}/join/{founder['id']}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True

    def test_group_join_blocks_non_founder(self, api, state, non_founder):
        gid = state["fl_group_id"]
        r = api.post(f"{BASE_URL}/api/groups/{gid}/join/{non_founder['id']}")
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
        body = r.json()
        detail = body.get("detail")
        if isinstance(detail, dict):
            assert detail.get("code") == "founder_only"
        else:
            assert "founder_only" in str(detail)

    def test_group_join_allows_founder(self, api, state, founder):
        gid = state["fl_group_id"]
        r = api.post(f"{BASE_URL}/api/groups/{gid}/join/{founder['id']}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True


# ---------------------- 4. Auto-enrolment at signup ---------------------- #
class TestFounderAutoEnrolmentAtSignup:
    """iter164ae (test cleanup): founder enrolment became opt-in at
    iter38 (``POST /api/founders/claim``). This class was written
    against the old auto-enrolment behaviour; the equivalent flow
    is now exercised end-to-end in
    ``tests/test_iter38_founder_optin.py`` — which covers signup +
    claim + Founders Lounge membership + auto-seating + welcome
    notification.

    We claim explicitly inside the fixture below so the downstream
    Founders-Lounge assertions still hold under the new opt-in flow.
    """

    @pytest.fixture(scope="class")
    def new_founder(self, api, state):
        suffix = uuid.uuid4().hex[:8]
        body = {
            "username": f"TEST_iter31_{suffix}",
            "password": "secret123",
            "email": f"test_iter31_{suffix}@example.com",
            "first_name": "Iter31",
        }
        r = api.post(f"{BASE_URL}/api/auth/signup", json=body)
        assert r.status_code == 200, r.text
        data = r.json()
        token = data["access_token"]
        auth_headers = {"Authorization": f"Bearer {token}"}

        # iter164ae: explicit founder claim (was implicit at signup).
        claim = api.post(
            f"{BASE_URL}/api/founders/claim", headers=auth_headers, json={},
        )
        if claim.status_code == 400:
            pytest.skip(f"founder cap reached; cannot claim: {claim.text}")
        assert claim.status_code == 200, (
            f"founder claim failed: {claim.status_code} {claim.text}"
        )
        # Refresh user snapshot with founder fields.
        r2 = api.get(
            f"{BASE_URL}/api/users/{data['user']['id']}",
            headers=auth_headers,
        )
        u = r2.json() if r2.status_code == 200 else data["user"]
        u["_auth_headers"] = auth_headers
        state["new_user_id"] = u["id"]
        return u

    def test_signup_response_is_founder(self, new_founder, state):
        u = new_founder
        assert u.get("is_founder") is True
        assert isinstance(u.get("founder_number"), int) and u["founder_number"] >= 1
        badges = u.get("badges") or []
        assert "Founding Member" in badges, f"badges missing 'Founding Member': {badges}"
        # iter164ae: relaxed from exact +1 — other founders may claim
        # concurrently, so any monotonically-increasing number above
        # the fixture's snapshot is acceptable.
        assert u["founder_number"] >= state.get("pre_taken", 0) + 1

    def test_user_persists_with_founder_fields(self, api, new_founder):
        r = api.get(
            f"{BASE_URL}/api/users/{new_founder['id']}",
            headers=new_founder["_auth_headers"],
        )
        assert r.status_code == 200
        u = r.json()
        assert u.get("is_founder") is True
        assert u.get("founder_number") == new_founder["founder_number"]
        assert "Founding Member" in (u.get("badges") or [])

    def test_added_to_founders_group(self, api, state, new_founder):
        # iter164ae: include_system=true so the system-flagged
        # Founders Lounge group is visible.
        r = api.get(f"{BASE_URL}/api/groups", params={"include_system": "true"})
        assert r.status_code == 200
        fl = [g for g in r.json() if g.get("id") == state["fl_group_id"]][0]
        assert new_founder["id"] in (fl.get("members") or []), \
            "new founder not added to Founders Lounge group"

    def test_added_to_founders_table(self, api, state, new_founder):
        r = api.get(f"{BASE_URL}/api/tables")
        assert r.status_code == 200
        fl = [t for t in r.json() if t.get("id") == state["fl_table_id"]][0]
        assert new_founder["id"] in (fl.get("seated") or []), \
            "new founder not seated at Founders Lounge table"

    def test_notifications_welcome_and_founder(self, api, new_founder):
        # small delay to let async writes settle
        time.sleep(0.3)
        r = api.get(f"{BASE_URL}/api/notifications/{new_founder['id']}")
        assert r.status_code == 200, r.text
        notifs = r.json()
        titles = [n.get("title", "") for n in notifs]
        assert any("Welcome to FriendPlace" in t for t in titles), f"welcome missing: {titles}"
        assert any("Founding Member" in t for t in titles), f"founder notif missing: {titles}"

    def test_founders_status_incremented(self, api, state, new_founder):
        r = api.get(f"{BASE_URL}/api/founders/status")
        assert r.status_code == 200
        assert r.json()["taken"] >= state.get("pre_taken", 0) + 1
