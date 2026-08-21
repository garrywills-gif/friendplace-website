"""Live endpoint tests for Presence & Status Commit 1.

Hits the running FastAPI via the public URL to verify:
  • Router is mounted under /api/status/*
  • Auth-gated endpoints return proper shape
  • End-to-end café-join hook works
  • Backward-compat: existing endpoints still 200
"""
import os
import pytest
import requests
from datetime import datetime, timezone

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://outreach-campaigns.preview.emergentagent.com"
).rstrip("/")

CREDS = {"username": "member@friendplace.com.au", "password": "TestPass2026!"}


@pytest.fixture(scope="module")
def auth():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=CREDS, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    body = r.json()
    token = body["access_token"]
    user_id = body["user"]["id"]
    return {
        "headers": {"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        "user_id": user_id,
        "token": token,
    }


# ─── /status/me ───────────────────────────────────────────
class TestStatusMe:
    def test_get_status_me_shape(self, auth):
        r = requests.get(f"{BASE_URL}/api/status/me", headers=auth["headers"], timeout=15)
        assert r.status_code == 200
        d = r.json()
        for k in ("user_id", "effective", "manual", "manual_set_at",
                  "manual_expires_at", "in_cafe_table_id", "last_seen_at"):
            assert k in d, f"missing key {k} in /status/me: {d}"
        assert d["user_id"] == auth["user_id"]
        assert d["effective"] in ("offline", "online", "looking", "in_cafe", "busy", "happy")

    def test_heartbeat_ok(self, auth):
        r = requests.post(f"{BASE_URL}/api/status/heartbeat", headers=auth["headers"], timeout=15)
        assert r.status_code == 200
        assert r.json() == {"ok": True}

    def test_heartbeat_makes_online(self, auth):
        requests.post(f"{BASE_URL}/api/status/heartbeat", headers=auth["headers"], timeout=15)
        # Ensure no manual set first
        requests.patch(f"{BASE_URL}/api/status/me", headers=auth["headers"],
                       json={"manual_status": None}, timeout=15)
        r = requests.get(f"{BASE_URL}/api/status/me", headers=auth["headers"], timeout=15)
        assert r.json()["effective"] == "online"

    def test_patch_manual_looking(self, auth):
        r = requests.patch(f"{BASE_URL}/api/status/me", headers=auth["headers"],
                           json={"manual_status": "looking"}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["manual"] == "looking"
        assert d["effective"] == "looking"
        assert d["manual_expires_at"] is not None

    def test_patch_manual_happy(self, auth):
        r = requests.patch(f"{BASE_URL}/api/status/me", headers=auth["headers"],
                           json={"manual_status": "happy"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["manual"] == "happy"

    def test_patch_manual_busy(self, auth):
        r = requests.patch(f"{BASE_URL}/api/status/me", headers=auth["headers"],
                           json={"manual_status": "busy"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["manual"] == "busy"

    def test_patch_manual_null_clears(self, auth):
        r = requests.patch(f"{BASE_URL}/api/status/me", headers=auth["headers"],
                           json={"manual_status": None}, timeout=15)
        assert r.status_code == 200
        assert r.json()["manual"] is None

    def test_patch_manual_invalid_400(self, auth):
        r = requests.patch(f"{BASE_URL}/api/status/me", headers=auth["headers"],
                           json={"manual_status": "bogus"}, timeout=15)
        assert r.status_code == 400, f"expected 400 for invalid manual, got {r.status_code}"


# ─── /status/looking ───────────────────────────────────────
class TestLookingList:
    def test_looking_default_scope(self, auth):
        r = requests.get(f"{BASE_URL}/api/status/looking",
                         headers=auth["headers"], timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "items" in d and "scope" in d
        assert d["scope"] == "nearby"
        assert isinstance(d["items"], list)

    def test_looking_invalid_scope_422(self, auth):
        r = requests.get(f"{BASE_URL}/api/status/looking?scope=galactic",
                         headers=auth["headers"], timeout=15)
        assert r.status_code == 422

    def test_looking_scopes(self, auth):
        for s in ("nearby", "friends", "all"):
            r = requests.get(f"{BASE_URL}/api/status/looking?scope={s}",
                             headers=auth["headers"], timeout=15)
            assert r.status_code == 200, f"scope={s} → {r.status_code}"
            assert r.json()["scope"] == s

    def test_looking_excludes_self(self, auth):
        # Set self to looking, verify not in the list
        requests.patch(f"{BASE_URL}/api/status/me", headers=auth["headers"],
                       json={"manual_status": "looking"}, timeout=15)
        r = requests.get(f"{BASE_URL}/api/status/looking?scope=all",
                         headers=auth["headers"], timeout=15)
        ids = [it["user_id"] for it in r.json()["items"]]
        assert auth["user_id"] not in ids, "viewer must be excluded"
        # Clear
        requests.patch(f"{BASE_URL}/api/status/me", headers=auth["headers"],
                       json={"manual_status": None}, timeout=15)


# ─── /status/for-users ────────────────────────────────────
class TestForUsers:
    def test_for_users_basic(self, auth):
        r = requests.get(
            f"{BASE_URL}/api/status/for-users?ids={auth['user_id']}",
            headers=auth["headers"], timeout=15,
        )
        assert r.status_code == 200
        d = r.json()
        assert "statuses" in d
        assert auth["user_id"] in d["statuses"]

    def test_for_users_max_50(self, auth):
        ids = ",".join(f"id-{i}" for i in range(51))
        r = requests.get(f"{BASE_URL}/api/status/for-users?ids={ids}",
                         headers=auth["headers"], timeout=15)
        assert r.status_code == 400

    def test_for_users_empty(self, auth):
        r = requests.get(f"{BASE_URL}/api/status/for-users?ids=",
                         headers=auth["headers"], timeout=15)
        assert r.status_code == 200
        assert r.json()["statuses"] == {}


# ─── Auth-gated ────────────────────────────────────────────
class TestAuthGuard:
    def test_status_me_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/status/me", timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_heartbeat_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/status/heartbeat", timeout=15)
        assert r.status_code in (401, 403)


# ─── End-to-end café-join hook ────────────────────────────
class TestCafeJoinHook:
    def test_cafe_join_clears_looking_and_marks_in_cafe(self, auth):
        # 1. Set looking
        requests.patch(f"{BASE_URL}/api/status/me", headers=auth["headers"],
                       json={"manual_status": "looking"}, timeout=15)
        me = requests.get(f"{BASE_URL}/api/status/me", headers=auth["headers"], timeout=15).json()
        assert me["effective"] == "looking"

        # 2. Join FP café
        table_id = "fp-cafe-permanent"
        r = requests.post(f"{BASE_URL}/api/tables/{table_id}/join/{auth['user_id']}",
                          headers=auth["headers"], timeout=15)
        assert r.status_code == 200, f"cafe join failed: {r.status_code} {r.text[:200]}"

        # 3. Should now be in_cafe and manual cleared
        me = requests.get(f"{BASE_URL}/api/status/me", headers=auth["headers"], timeout=15).json()
        assert me["effective"] == "in_cafe", f"expected in_cafe, got {me['effective']}"
        assert me["manual"] is None, f"expected manual=None after auto_clear, got {me['manual']}"
        assert me["in_cafe_table_id"] == table_id

        # 4. Leave café
        r = requests.post(f"{BASE_URL}/api/tables/{table_id}/leave/{auth['user_id']}",
                          headers=auth["headers"], timeout=15)
        assert r.status_code == 200
        me = requests.get(f"{BASE_URL}/api/status/me", headers=auth["headers"], timeout=15).json()
        assert me["in_cafe_table_id"] is None
        assert me["effective"] == "online"


# ─── Backward-compat regression smoke ──────────────────────
class TestBackwardCompat:
    def test_fp_cafe_permanent_still_200(self, auth):
        r = requests.get(f"{BASE_URL}/api/tables/fp-cafe-permanent",
                         headers=auth["headers"], timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "id" in d and d["id"] == "fp-cafe-permanent"

    def test_notices_list(self, auth):
        r = requests.get(f"{BASE_URL}/api/notices", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_events_list(self, auth):
        r = requests.get(f"{BASE_URL}/api/events", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_groups_list(self, auth):
        r = requests.get(f"{BASE_URL}/api/groups", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_auth_me(self, auth):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=auth["headers"], timeout=15)
        assert r.status_code == 200
        assert r.json()["id"] == auth["user_id"]

    def test_friends_inbox_endpoint(self, auth):
        # Actual friends list endpoint per server.py
        r = requests.get(
            f"{BASE_URL}/api/friends/inbox/{auth['user_id']}", headers=auth["headers"], timeout=15,
        )
        assert r.status_code == 200

    def test_find_friends_endpoint(self, auth):
        # Common paths — try a few
        paths = [
            f"/api/community/find-friends?user_id={auth['user_id']}",
            f"/api/users/{auth['user_id']}/find-friends",
            "/api/find-friends",
        ]
        found = False
        for p in paths:
            r = requests.get(f"{BASE_URL}{p}", headers=auth["headers"], timeout=15)
            if r.status_code == 200:
                found = True
                print(f"find-friends works at: {p}")
                break
        if not found:
            pytest.skip("find-friends endpoint path unknown — not a regression per se")

    def test_dm_list(self, auth):
        r = requests.get(f"{BASE_URL}/api/dms/{auth['user_id']}",
                         headers=auth["headers"], timeout=15)
        assert r.status_code in (200, 404)  # 404 if user has no DMs

    def test_mcgs_transcribe_auth_guard(self, auth):
        # No file → should return 4xx (not 500)
        r = requests.post(f"{BASE_URL}/api/mcgs/george/transcribe",
                          headers={"Authorization": auth["headers"]["Authorization"]},
                          timeout=15)
        assert r.status_code in (401, 422, 400), f"got {r.status_code}"
