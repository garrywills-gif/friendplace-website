"""
Reconcile-1031-v2 backend tests.

Scope (per review request):
  1) /api/suburbs/meta verification route
  2) Radius filtering on Notices / Events / Groups
  3) /api/admin/founders/link auth gating + validation errors
  4) George/Georgia companion (get, turn, reset) for both personas
  + light regression that core list endpoints still respond.

Uses external EXPO_PUBLIC_BACKEND_URL exclusively.
"""

import os
import time
import uuid
import requests
import pytest

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"

MEMBER_EMAIL = "member@friendplace.com.au"
MEMBER_PASSWORD = "TestPass2026!"
MEMBER_USERNAME = "member_first"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def member_login(api):
    r = api.post(f"{BASE_URL}/api/auth/login",
                 json={"username": MEMBER_USERNAME, "password": MEMBER_PASSWORD})
    assert r.status_code == 200, f"member login failed: {r.status_code} {r.text}"
    data = r.json()
    return {"token": data["access_token"], "user": data["user"]}


@pytest.fixture(scope="module")
def admin_login(api):
    # maggie is an admin demo user — demo-login gives us a real JWT.
    r = api.post(f"{BASE_URL}/api/auth/demo-login", json={"username": "maggie"})
    assert r.status_code == 200, f"admin demo login failed: {r.status_code} {r.text}"
    data = r.json()
    return {"token": data["access_token"], "user": data["user"]}


# ---------------------------------------------------------------------------
# 1) /api/suburbs/meta
# ---------------------------------------------------------------------------
class TestSuburbsMeta:
    def test_meta_returns_expected_dataset(self, api):
        r = api.get(f"{BASE_URL}/api/suburbs/meta")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["dataset_version"] == "au-localities-1030"
        # Expected ~17921 localities.
        assert data["locality_count"] == 17921, f"locality_count={data['locality_count']}"
        assert "source" in data


# ---------------------------------------------------------------------------
# 2) Radius filtering — Notices / Events / Groups
# ---------------------------------------------------------------------------
class TestRadiusFiltering:
    """Uses the existing member account (Bondi -33.891, 151.269) which
    already has suburb_lat/lng stamped. Creates content and verifies
    radius filtering behaviour."""

    def _ensure_member_suburb(self, api, member_login):
        # Guarantee the member has a recognised suburb (Sydney/Bondi).
        uid = member_login["user"]["id"]
        r = api.post(f"{BASE_URL}/api/users/{uid}/location",
                     json={"suburb": "Bondi", "postcode": "2026", "state": "NSW"})
        assert r.status_code == 200, r.text

    def test_notice_locality_stamping_and_radius(self, api, member_login):
        self._ensure_member_suburb(api, member_login)
        uid = member_login["user"]["id"]
        title = f"TEST_notice_{uuid.uuid4().hex[:8]}"
        r = api.post(
            f"{BASE_URL}/api/notices",
            json={"title": title, "body": "TEST radius", "user_id": uid,
                  "user_name": "Alex"},
        )
        assert r.status_code in (200, 201), r.text
        notice = r.json()
        # Locality should be stamped from Bondi.
        assert notice.get("locality_lat") is not None, f"locality_lat missing: {notice}"
        assert notice.get("locality_lng") is not None

        # 25 km around Bondi should include our notice.
        r = api.get(f"{BASE_URL}/api/notices",
                    params={"user_id": uid, "radius_km": 25})
        assert r.status_code == 200
        rows = r.json()
        found = [n for n in rows if n.get("title") == title]
        assert found, "notice not found within 25km"
        assert "distance_km" in found[0]

        # 5 km around a far away center (Perth) should exclude it.
        r = api.get(f"{BASE_URL}/api/notices",
                    params={"user_id": uid, "radius_km": 5,
                            "near_lat": -31.9505, "near_lng": 115.8605})
        assert r.status_code == 200
        rows = r.json()
        assert not any(n.get("title") == title for n in rows)

        # Omitting radius_km (All) returns rows without error.
        r = api.get(f"{BASE_URL}/api/notices", params={"user_id": uid})
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)

    def test_event_locality_stamping_and_radius(self, api, member_login):
        self._ensure_member_suburb(api, member_login)
        uid = member_login["user"]["id"]
        title = f"TEST_event_{uuid.uuid4().hex[:8]}"
        r = api.post(
            f"{BASE_URL}/api/events",
            json={"title": title, "description": "TEST radius",
                  "date": "2026-12-31", "time": "18:00",
                  "location": "Bondi Pavilion", "host_id": uid},
        )
        assert r.status_code in (200, 201), r.text
        ev = r.json()
        # Locality stamped from Bondi.
        assert ev.get("locality_lat") is not None, f"event locality missing: {ev}"

        # 25 km should include.
        r = api.get(f"{BASE_URL}/api/events",
                    params={"user_id": uid, "radius_km": 25})
        assert r.status_code == 200
        rows = r.json()
        found = [e for e in rows if e.get("title") == title]
        assert found, "event not found within 25km"
        assert "distance_km" in found[0]

        # Far away small radius excludes.
        r = api.get(f"{BASE_URL}/api/events",
                    params={"user_id": uid, "radius_km": 5,
                            "near_lat": -31.9505, "near_lng": 115.8605})
        assert r.status_code == 200
        assert not any(e.get("title") == title for e in r.json())

        # All (no radius_km) returns without error.
        r = api.get(f"{BASE_URL}/api/events", params={"user_id": uid})
        assert r.status_code == 200

    def test_group_locality_stamping_and_radius(self, api, member_login, admin_login):
        self._ensure_member_suburb(api, member_login)
        uid = member_login["user"]["id"]
        name = f"TEST_group_{uuid.uuid4().hex[:8]}"
        # Members suggest groups (not direct POST /groups) — the review
        # request specifies "group suggested by member then approved".
        r = api.post(
            f"{BASE_URL}/api/groups/suggest",
            json={"name": name, "description": "TEST radius group",
                  "reason": "testing"},
            headers={"Authorization": f"Bearer {member_login['token']}"},
        )
        assert r.status_code in (200, 201), r.text
        # Look up the suggested group in Mongo-visible list (include_pending)
        r_list = api.get(f"{BASE_URL}/api/groups",
                         params={"include_pending": "true"})
        assert r_list.status_code == 200
        g = next((x for x in r_list.json() if x.get("name") == name), None)
        assert g is not None, "suggested group not present"
        assert g.get("locality_lat") is not None, f"group locality missing: {g}"
        gid = g["id"]

        # Approve as admin.
        r = api.post(f"{BASE_URL}/api/admin/groups/{gid}/approve",
                     headers={"Authorization": f"Bearer {admin_login['token']}"})
        assert r.status_code in (200, 201), f"approve failed: {r.status_code} {r.text}"

        # 25 km should include.
        r = api.get(f"{BASE_URL}/api/groups",
                    params={"user_id": uid, "radius_km": 25})
        assert r.status_code == 200
        rows = r.json()
        found = [x for x in rows if x.get("name") == name]
        assert found, f"approved group not found within 25km"
        assert "distance_km" in found[0]

        # Far-away small radius excludes.
        r = api.get(f"{BASE_URL}/api/groups",
                    params={"user_id": uid, "radius_km": 5,
                            "near_lat": -31.9505, "near_lng": 115.8605})
        assert r.status_code == 200
        assert not any(x.get("name") == name for x in r.json())

        # All (no radius) works.
        r = api.get(f"{BASE_URL}/api/groups", params={"user_id": uid})
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# 3) /api/admin/founders/link — auth gating + validation
# ---------------------------------------------------------------------------
class TestAdminFoundersLink:
    URL = f"{BASE_URL}/api/admin/founders/link"

    def test_route_mounted_not_404(self, api):
        r = api.post(self.URL, json={"user_id": "x", "interest_registration_id": "y"})
        # 401 (not authenticated) is fine — key point is NOT 404.
        assert r.status_code != 404, f"admin/founders/link 404 (not mounted): {r.text}"

    def test_unauthenticated_401(self, api):
        r = api.post(self.URL, json={"user_id": "x", "interest_registration_id": "y"})
        assert r.status_code == 401, f"expected 401, got {r.status_code} {r.text}"

    def test_non_admin_forbidden(self, api, member_login):
        r = api.post(self.URL,
                     json={"user_id": "x", "interest_registration_id": "y"},
                     headers={"Authorization": f"Bearer {member_login['token']}"})
        assert r.status_code == 403, f"expected 403 for non-admin, got {r.status_code} {r.text}"

    def test_admin_missing_user_404(self, api, admin_login):
        r = api.post(self.URL,
                     json={"user_id": "does-not-exist-" + uuid.uuid4().hex,
                           "interest_registration_id": "does-not-exist"},
                     headers={"Authorization": f"Bearer {admin_login['token']}"})
        assert r.status_code == 404, f"expected 404 (missing user), got {r.status_code} {r.text}"
        assert "not found" in r.text.lower()

    def test_admin_missing_registration_404(self, api, admin_login, member_login):
        # Real user, missing registration → 404.
        r = api.post(self.URL,
                     json={"user_id": member_login["user"]["id"],
                           "interest_registration_id": "does-not-exist-" + uuid.uuid4().hex},
                     headers={"Authorization": f"Bearer {admin_login['token']}"})
        assert r.status_code == 404, f"expected 404 (missing reg), got {r.status_code} {r.text}"


# ---------------------------------------------------------------------------
# 4) George/Georgia companion
# ---------------------------------------------------------------------------
class TestGeorgeCompanion:
    def _headers(self, token):
        return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    def test_companion_get_george(self, api, member_login):
        r = api.get(f"{BASE_URL}/api/mcgs/george/companion?persona=george",
                    headers=self._headers(member_login["token"]))
        assert r.status_code == 200, r.text
        data = r.json()
        # Should have a session and at least one opening turn.
        assert data, "empty response"
        # Look for common shapes: turns list or messages / opening
        keys = list(data.keys())
        assert any(k in keys for k in ("turns", "messages", "session", "session_id", "opening")), \
            f"unexpected companion shape: {keys}"

    def test_companion_turn_george(self, api, member_login):
        r = api.post(f"{BASE_URL}/api/mcgs/george/companion/turn",
                     headers=self._headers(member_login["token"]),
                     json={"text": "hi", "persona": "george"},
                     timeout=45)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        data = r.json()
        assert "message" in data, f"no message key: {data}"
        assert isinstance(data["message"], str) and data["message"].strip()

    def test_companion_reset_george(self, api, member_login):
        r = api.post(f"{BASE_URL}/api/mcgs/george/companion/reset",
                     headers=self._headers(member_login["token"]),
                     json={"persona": "george"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data, "empty reset response"

    def test_companion_georgia_persona(self, api, member_login):
        # GET
        r = api.get(f"{BASE_URL}/api/mcgs/george/companion?persona=georgia",
                    headers=self._headers(member_login["token"]))
        assert r.status_code == 200, r.text
        # TURN
        r = api.post(f"{BASE_URL}/api/mcgs/george/companion/turn",
                     headers=self._headers(member_login["token"]),
                     json={"text": "hello Georgia", "persona": "georgia"},
                     timeout=45)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        assert "message" in r.json()
        # RESET
        r = api.post(f"{BASE_URL}/api/mcgs/george/companion/reset",
                     headers=self._headers(member_login["token"]),
                     json={"persona": "georgia"})
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# 5) Light regression — core lists still respond
# ---------------------------------------------------------------------------
class TestCoreListRegression:
    def test_notices_list(self, api):
        r = api.get(f"{BASE_URL}/api/notices")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_events_list(self, api):
        r = api.get(f"{BASE_URL}/api/events")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_groups_list(self, api):
        r = api.get(f"{BASE_URL}/api/groups")
        assert r.status_code == 200
        assert isinstance(r.json(), list)
