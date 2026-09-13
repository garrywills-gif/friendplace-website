"""Iteration 41 — Community Groups overhaul (suggest / pending / approve / reject)
and the new system-hide filter on GET /api/groups.

Covers:
  • GET /api/groups hides is_system + pending_approval by default
  • ?include_system=true brings system groups back (Founders + Coffee Lounge Crew)
  • POST /api/groups/suggest (auth, validation, duplicate, success)
  • GET /api/admin/groups/pending (admin only)
  • POST /api/admin/groups/{id}/approve (admin only, side effects)
  • POST /api/admin/groups/{id}/reject (admin only, deletes + notifies)
  • Startup backfill stamps is_system on Founders Lounge + Coffee Lounge Crew
"""
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "https://iphone-retest-batch.preview.emergentagent.com").rstrip("/")


def _demo_login(username: str) -> dict:
    r = requests.post(f"{BASE_URL}/api/auth/demo-login", json={"username": username}, timeout=15)
    assert r.status_code == 200, f"demo-login {username} failed: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="module")
def admin_session():
    data = _demo_login("maggie")
    assert data["user"].get("is_admin"), "maggie must be admin for this suite"
    return data


@pytest.fixture(scope="module")
def member_session():
    return _demo_login("frankie")


@pytest.fixture(scope="module")
def admin_headers(admin_session):
    return {"Authorization": f"Bearer {admin_session['access_token']}"}


@pytest.fixture(scope="module")
def member_headers(member_session):
    return {"Authorization": f"Bearer {member_session['access_token']}"}


# ---------- GET /api/groups filtering ----------
class TestGroupListFiltering:
    def test_default_hides_system_groups(self):
        r = requests.get(f"{BASE_URL}/api/groups", timeout=15)
        assert r.status_code == 200
        names = {g["name"] for g in r.json()}
        assert "Founders Lounge" not in names, "Founders Lounge must be hidden by default"
        assert "Coffee Lounge Crew" not in names, "Coffee Lounge Crew must be hidden by default"

    def test_default_hides_pending_groups(self, member_headers):
        # Create a pending suggestion, then verify default list omits it.
        name = f"TEST_HiddenPending_{uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{BASE_URL}/api/groups/suggest",
            json={"name": name, "emoji": "🤖", "description": "hidden check"},
            headers=member_headers,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        gid = r.json()["id"]
        try:
            r2 = requests.get(f"{BASE_URL}/api/groups", timeout=15)
            assert r2.status_code == 200
            names = {g["name"] for g in r2.json()}
            assert name not in names, "pending suggestion must NOT appear in default group list"
        finally:
            # cleanup via reject endpoint (admin token used at module-level test below)
            admin = _demo_login("maggie")
            requests.post(
                f"{BASE_URL}/api/admin/groups/{gid}/reject",
                headers={"Authorization": f"Bearer {admin['access_token']}"},
                json={"reason": "cleanup"},
                timeout=15,
            )

    def test_include_system_returns_system_groups(self):
        r = requests.get(f"{BASE_URL}/api/groups", params={"include_system": "true"}, timeout=15)
        assert r.status_code == 200
        names = {g["name"] for g in r.json()}
        # Backfill should have stamped them; both should appear with include_system=true
        assert "Founders Lounge" in names, "Founders Lounge missing with include_system=true"
        assert "Coffee Lounge Crew" in names, "Coffee Lounge Crew missing with include_system=true"

    def test_is_system_flag_backfilled(self):
        """Backfill must stamp is_system=True on the two seeded system groups."""
        r = requests.get(f"{BASE_URL}/api/groups", params={"include_system": "true"}, timeout=15)
        assert r.status_code == 200
        by_name = {g["name"]: g for g in r.json()}
        for n in ("Founders Lounge", "Coffee Lounge Crew"):
            if n in by_name:  # Coffee Lounge Crew is seeded only on fresh DBs
                assert by_name[n].get("is_system") is True, f"{n} should have is_system=True after backfill"


# ---------- POST /api/groups/suggest ----------
class TestSuggestGroup:
    def test_requires_auth(self):
        r = requests.post(
            f"{BASE_URL}/api/groups/suggest",
            json={"name": "TEST_NoAuth_xyz12345"},
            timeout=15,
        )
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_rejects_short_name(self, member_headers):
        r = requests.post(
            f"{BASE_URL}/api/groups/suggest",
            json={"name": "ab"},
            headers=member_headers,
            timeout=15,
        )
        assert r.status_code == 400

    def test_rejects_long_name(self, member_headers):
        r = requests.post(
            f"{BASE_URL}/api/groups/suggest",
            json={"name": "x" * 61},
            headers=member_headers,
            timeout=15,
        )
        assert r.status_code == 400

    def test_conflict_on_duplicate_name(self, member_headers):
        name = f"TEST_Dup_{uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{BASE_URL}/api/groups/suggest",
            json={"name": name, "description": "first"},
            headers=member_headers,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        gid = r.json()["id"]
        try:
            r2 = requests.post(
                f"{BASE_URL}/api/groups/suggest",
                json={"name": name.lower(), "description": "second"},
                headers=member_headers,
                timeout=15,
            )
            assert r2.status_code == 409
        finally:
            admin = _demo_login("maggie")
            requests.post(
                f"{BASE_URL}/api/admin/groups/{gid}/reject",
                headers={"Authorization": f"Bearer {admin['access_token']}"},
                json={"reason": "cleanup"},
                timeout=15,
            )

    def test_success_returns_pending_flag(self, member_headers, admin_headers):
        name = f"TEST_Suggest_{uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{BASE_URL}/api/groups/suggest",
            json={"name": name, "emoji": "🌟", "description": "test desc", "reason": "test reason"},
            headers=member_headers,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("pending") is True
        gid = body.get("id")
        assert gid

        # Verify it shows in admin pending queue with correct fields
        pend = requests.get(f"{BASE_URL}/api/admin/groups/pending", headers=admin_headers, timeout=15)
        assert pend.status_code == 200
        match = [g for g in pend.json() if g["id"] == gid]
        assert match, "newly suggested group should appear in admin pending list"
        m = match[0]
        assert m.get("pending_approval") is True
        assert m.get("suggested_by")
        assert m.get("suggested_reason") == "test reason"

        # Verify NOT in public list
        pub = requests.get(f"{BASE_URL}/api/groups", timeout=15)
        assert pub.status_code == 200
        assert gid not in {g["id"] for g in pub.json()}

        # cleanup via reject
        requests.post(
            f"{BASE_URL}/api/admin/groups/{gid}/reject",
            headers=admin_headers,
            json={"reason": "cleanup"},
            timeout=15,
        )


# ---------- Admin gate ----------
class TestAdminGate:
    def test_pending_requires_admin(self, member_headers):
        r = requests.get(f"{BASE_URL}/api/admin/groups/pending", headers=member_headers, timeout=15)
        assert r.status_code == 403

    def test_pending_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/admin/groups/pending", timeout=15)
        assert r.status_code in (401, 403)

    def test_approve_requires_admin(self, member_headers):
        r = requests.post(
            f"{BASE_URL}/api/admin/groups/some-fake-id/approve",
            headers=member_headers,
            timeout=15,
        )
        assert r.status_code == 403

    def test_reject_requires_admin(self, member_headers):
        r = requests.post(
            f"{BASE_URL}/api/admin/groups/some-fake-id/reject",
            headers=member_headers,
            json={"reason": "nope"},
            timeout=15,
        )
        assert r.status_code == 403


# ---------- Approve & Reject lifecycle ----------
class TestApproveRejectFlow:
    def test_approve_makes_group_visible_and_notifies(self, member_headers, member_session, admin_headers):
        name = f"TEST_Approve_{uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{BASE_URL}/api/groups/suggest",
            json={"name": name, "emoji": "🌟", "description": "approve me"},
            headers=member_headers,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        gid = r.json()["id"]

        ar = requests.post(
            f"{BASE_URL}/api/admin/groups/{gid}/approve",
            headers=admin_headers,
            timeout=15,
        )
        assert ar.status_code == 200, ar.text

        # Now appears in default public list
        pub = requests.get(f"{BASE_URL}/api/groups", timeout=15)
        assert pub.status_code == 200
        ids = {g["id"]: g for g in pub.json()}
        assert gid in ids, "approved group should appear in default group list"
        assert ids[gid].get("pending_approval") in (False, None)

        # Verify group_approved notification fired to requester
        time.sleep(0.5)
        uid = member_session["user"]["id"]
        nr = requests.get(f"{BASE_URL}/api/notifications", params={"user_id": uid}, timeout=15)
        # /notifications uses GET with user_id; tolerate either schema
        if nr.status_code == 200:
            data = nr.json() if isinstance(nr.json(), list) else nr.json().get("items", [])
            types = [n.get("type") for n in data]
            assert "group_approved" in types, f"requester missing group_approved notification (types={types[:8]})"

    def test_reject_deletes_and_notifies(self, member_headers, member_session, admin_headers):
        name = f"TEST_Reject_{uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{BASE_URL}/api/groups/suggest",
            json={"name": name, "description": "reject me"},
            headers=member_headers,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        gid = r.json()["id"]

        rj = requests.post(
            f"{BASE_URL}/api/admin/groups/{gid}/reject",
            headers=admin_headers,
            json={"reason": "Duplicate of another group"},
            timeout=15,
        )
        assert rj.status_code == 200, rj.text

        # Should be gone from pending queue
        pend = requests.get(f"{BASE_URL}/api/admin/groups/pending", headers=admin_headers, timeout=15)
        assert pend.status_code == 200
        assert gid not in {g["id"] for g in pend.json()}

        # Should be 404 / absent from system+pending
        pub_all = requests.get(
            f"{BASE_URL}/api/groups",
            params={"include_system": "true"},
            timeout=15,
        )
        assert gid not in {g["id"] for g in pub_all.json()}

        # Verify group_rejected notification fired
        time.sleep(0.5)
        uid = member_session["user"]["id"]
        nr = requests.get(f"{BASE_URL}/api/notifications", params={"user_id": uid}, timeout=15)
        if nr.status_code == 200:
            data = nr.json() if isinstance(nr.json(), list) else nr.json().get("items", [])
            types = [n.get("type") for n in data]
            assert "group_rejected" in types, f"requester missing group_rejected notification (types={types[:8]})"

    def test_approve_nonexistent_returns_404(self, admin_headers):
        r = requests.post(
            f"{BASE_URL}/api/admin/groups/does-not-exist-xyz/approve",
            headers=admin_headers,
            timeout=15,
        )
        assert r.status_code == 404
