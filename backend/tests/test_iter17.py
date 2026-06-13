"""
Iteration 17 — targeted re-test of iteration_16 fixes + Admin Events panel.

Covers:
  1. Repeat-offender orphan filtering — every user_id returned by
     /api/admin/repeat-offenders must resolve to a working
     /api/admin/users/{id}/moderation (no 404s).
  2. Admin Events full lifecycle:
     create -> appears in active -> edit -> cancel (with reason) ->
     appears in cancelled -> archive -> appears in archived ->
     unarchive -> back in cancelled -> hard delete -> gone everywhere.
  3. Public /events list MUST NOT include archived events.
"""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def admin():
    r = requests.post(f"{API}/auth/demo-login", json={"username": "maggie"}, timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    user = data["user"]
    assert user.get("is_admin"), "maggie must be admin"
    return user


@pytest.fixture(scope="module")
def other_user():
    # frankie used as RSVP target
    r = requests.post(f"{API}/auth/demo-login", json={"username": "frankie"}, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()["user"]


# -----------------------------------------------------------------------------
# 1. Repeat-offender orphan filtering
# -----------------------------------------------------------------------------
class TestRepeatOffenders:
    def test_repeat_offenders_returns_only_resolvable_users(self, admin):
        r = requests.get(
            f"{API}/admin/repeat-offenders",
            params={"admin_id": admin["id"], "min_reporters": 2, "days": 30},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        users = body.get("users", [])
        # Every user in the list must have a username (no orphans)
        for u in users:
            assert u.get("user_id"), f"missing user_id: {u}"
            assert u.get("username"), f"orphan slipped through: {u}"

        # Each user_id should resolve to /moderation (no 404s)
        for u in users:
            mr = requests.get(
                f"{API}/admin/users/{u['user_id']}/moderation",
                params={"admin_id": admin["id"]},
                timeout=10,
            )
            assert mr.status_code == 200, (
                f"orphan user_id {u['user_id']} (@{u.get('username')}) "
                f"returned {mr.status_code}: {mr.text[:200]}"
            )
            data = mr.json()
            assert data.get("user", {}).get("id") == u["user_id"]
            assert "counts" in data
            assert "reports" in data
            assert "moderation_log" in data


# -----------------------------------------------------------------------------
# 2. Admin Events full lifecycle
# -----------------------------------------------------------------------------
class TestAdminEventsLifecycle:
    @pytest.fixture(scope="class")
    def created_event(self, admin):
        body = {
            "title": f"TEST_QA Event {uuid.uuid4().hex[:6]}",
            "emoji": "🧪",
            "description": "Pytest iter17 lifecycle test",
            "location": "Test Hall",
            "date": "2030-12-31",
            "time": "10:00",
            "capacity": 5,
            "host_id": admin["id"],
        }
        r = requests.post(f"{API}/events", json=body, timeout=10)
        assert r.status_code == 200, r.text
        ev = r.json()
        assert ev.get("id")
        yield ev
        # cleanup if test left it behind
        requests.delete(
            f"{API}/admin/events/{ev['id']}",
            params={"admin_id": admin["id"], "reason": "TEST_cleanup"},
            timeout=10,
        )

    def test_01_appears_in_active_list(self, admin, created_event):
        r = requests.get(
            f"{API}/admin/events",
            params={"admin_id": admin["id"], "status": "active"},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        ids = [e["id"] for e in body["events"]]
        assert created_event["id"] in ids
        # counts shape
        assert "counts" in body
        for key in ("active", "cancelled", "archived", "total"):
            assert key in body["counts"]

    def test_02_edit_via_patch(self, admin, created_event):
        new_title = created_event["title"] + " v2"
        r = requests.patch(
            f"{API}/events/{created_event['id']}",
            json={"actor_id": admin["id"], "title": new_title},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        # Verify persisted
        lr = requests.get(
            f"{API}/admin/events",
            params={"admin_id": admin["id"], "status": "active"},
            timeout=10,
        )
        ev = next((e for e in lr.json()["events"] if e["id"] == created_event["id"]), None)
        assert ev is not None
        assert ev["title"] == new_title

    def test_03_cancel_with_reason(self, admin, created_event):
        r = requests.post(
            f"{API}/events/{created_event['id']}/cancel",
            json={"actor_id": admin["id"], "reason": "TEST_QA test cancellation"},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        # Verify shows in cancelled tab
        lr = requests.get(
            f"{API}/admin/events",
            params={"admin_id": admin["id"], "status": "cancelled"},
            timeout=10,
        )
        ev = next((e for e in lr.json()["events"] if e["id"] == created_event["id"]), None)
        assert ev is not None
        assert ev.get("cancelled") is True

    def test_04_archive(self, admin, created_event):
        r = requests.post(
            f"{API}/admin/events/{created_event['id']}/archive",
            json={"admin_id": admin["id"], "reason": "TEST_QA archival"},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        # Verify in archived tab
        lr = requests.get(
            f"{API}/admin/events",
            params={"admin_id": admin["id"], "status": "archived"},
            timeout=10,
        )
        ev = next((e for e in lr.json()["events"] if e["id"] == created_event["id"]), None)
        assert ev is not None
        assert ev.get("archived") is True

    def test_05_public_events_hides_archived(self, created_event):
        r = requests.get(f"{API}/events", timeout=10)
        assert r.status_code == 200
        events = r.json().get("events", r.json()) if isinstance(r.json(), dict) else r.json()
        ids = [e["id"] for e in events] if isinstance(events, list) else []
        assert created_event["id"] not in ids, (
            "archived event still visible on public /events list"
        )

    def test_06_unarchive(self, admin, created_event):
        r = requests.post(
            f"{API}/admin/events/{created_event['id']}/unarchive",
            json={"admin_id": admin["id"]},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        # back in cancelled tab
        lr = requests.get(
            f"{API}/admin/events",
            params={"admin_id": admin["id"], "status": "cancelled"},
            timeout=10,
        )
        ev = next((e for e in lr.json()["events"] if e["id"] == created_event["id"]), None)
        assert ev is not None
        assert ev.get("archived") is not True

    def test_07_hard_delete(self, admin, created_event):
        r = requests.delete(
            f"{API}/admin/events/{created_event['id']}",
            params={"admin_id": admin["id"], "reason": "TEST_QA hard delete"},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        # Should be gone from ALL tabs
        for status in ("active", "cancelled", "archived", "all"):
            lr = requests.get(
                f"{API}/admin/events",
                params={"admin_id": admin["id"], "status": status},
                timeout=10,
            )
            ids = [e["id"] for e in lr.json()["events"]]
            assert created_event["id"] not in ids, f"still present in {status}"


# -----------------------------------------------------------------------------
# 3. Restore endpoint sanity
# -----------------------------------------------------------------------------
class TestAdminRestore:
    def test_restore_endpoint_exists(self, admin):
        # POST against admin themselves with no restrictions — should succeed (no-op) or return ok
        r = requests.post(
            f"{API}/admin/users/restore",
            json={"admin_id": admin["id"], "user_id": admin["id"]},
            timeout=10,
        )
        # Either 200 (no-op) or 400 (not restricted) — we just want it not 404
        assert r.status_code in (200, 400, 409), r.text
