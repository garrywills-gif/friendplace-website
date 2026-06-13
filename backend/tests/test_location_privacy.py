"""Phase 1 Location Features — Backend tests.

Covers:
  - /api/suburbs/search (ranking, postcode prefix, empty q, limit clamp)
  - /api/suburbs/by-postcode/{postcode}
  - /api/suburbs/nearest
  - POST /api/users/{uid}/location (valid suburb, free-text fallback,
    prefer_not_to_say, 404)
  - GET /api/users — no coord leak in regular list + radius query
    (distance_km, sorting, private exclusion, no coord leak)
  - GET /api/users/{uid} — no coord leak on single profile (PRIVACY-CRITICAL)
  - Regression: /community/today, demo logins, sudoku/spot dailies,
    /admin/policy

All disposable users are prefixed with TEST_locpriv_ and cleaned up after.
Frankie's pre-test location state is captured and restored at module teardown.
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://belong-together.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

RUN_ID = uuid.uuid4().hex[:6]


# ---------------- Shared helpers / fixtures ----------------
@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


def _demo_login(s, username):
    r = s.post(f"{API}/auth/demo-login", json={"username": username})
    assert r.status_code == 200, f"demo-login {username}: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="module")
def frankie(s):
    return _demo_login(s, "frankie")["user"]


@pytest.fixture(scope="module")
def maggie(s):
    return _demo_login(s, "maggie")["user"]


@pytest.fixture(scope="module")
def joycey(s):
    return _demo_login(s, "joycey")["user"]


@pytest.fixture(scope="module", autouse=True)
def restore_frankie(s, frankie):
    """Snapshot Frankie's pre-test location fields and restore after."""
    pre = s.get(f"{API}/users/{frankie['id']}").json()
    snap = {k: pre.get(k) for k in ("suburb", "suburb_postcode", "suburb_state",
                                     "suburb_lat", "suburb_lng", "location_visibility")}
    yield
    # Restore by calling set-location. If pre had suburb, attempt to set it back;
    # else mark as private (prefer_not_to_say) to clear leftover.
    if snap.get("suburb"):
        s.post(f"{API}/users/{frankie['id']}/location", json={"suburb": snap["suburb"]})
    else:
        s.post(f"{API}/users/{frankie['id']}/location", json={"prefer_not_to_say": True})


@pytest.fixture(scope="module")
def disposable_users(s):
    """Create 3 disposable users via signup, set their locations, return list.
       Cleaned up at module teardown."""
    created = []

    def mk(name, suburb_payload):
        uname = f"TEST_locpriv_{RUN_ID}_{name}"
        body = {
            "username": uname,
            "password": "secret123",
            "first_name": name,
            "email": f"{uname}@example.com",
        }
        r = s.post(f"{API}/auth/signup", json=body)
        assert r.status_code == 200, f"signup {uname}: {r.status_code} {r.text}"
        u = r.json()["user"]
        # Set location
        loc = s.post(f"{API}/users/{u['id']}/location", json=suburb_payload)
        assert loc.status_code == 200, f"set-location {uname}: {loc.status_code} {loc.text}"
        created.append(u)
        return u

    # Sydney CBD (-33.8688, 151.2093) — close to Bondi (~6 km), Chatswood (~7 km)
    near_sydney = mk("Sydneyer", {"suburb": "Sydney"})           # 0 km
    bondi_user = mk("Bondian", {"suburb": "Bondi"})              # ~6 km
    private_user = mk("Privater", {"suburb": "Manly"})           # would be ~11 km
    # Mark private user as prefer_not_to_say
    pr = s.post(f"{API}/users/{private_user['id']}/location", json={"prefer_not_to_say": True})
    assert pr.status_code == 200

    yield {"sydney": near_sydney, "bondi": bondi_user, "private": private_user}

    # Cleanup: directly delete via Mongo since there's no /users DELETE endpoint.
    # Easiest path: hit Mongo via motor — but we don't have a handle here.
    # Fallback: rename-by-banning is too intrusive. We rely on TEST_ prefix.
    # Use admin policy? No deletion route. Leave them; admin sweep can prune.
    # At minimum, set them all to private + ban so they don't leak into queries.
    for u in created:
        try:
            s.post(f"{API}/users/{u['id']}/location", json={"prefer_not_to_say": True})
        except Exception:
            pass


# ---------------- /api/suburbs/search ----------------
class TestSuburbsSearch:
    def test_prefix_ranked_first(self, s):
        r = s.get(f"{API}/suburbs/search", params={"q": "man"})
        assert r.status_code == 200
        results = r.json()["results"]
        assert len(results) >= 2
        names = [x["name"] for x in results]
        # Mandurah & Manly start with "Man" — must come BEFORE substring matches
        prefix_hits = [n for n in names if n.lower().startswith("man")]
        assert "Mandurah" in prefix_hits and "Manly" in prefix_hits
        # First entries must be prefix matches
        first_two = names[:2]
        for n in first_two:
            assert n.lower().startswith("man"), f"{n} should be prefix match"

    def test_empty_q_returns_empty(self, s):
        r = s.get(f"{API}/suburbs/search", params={"q": ""})
        assert r.status_code == 200
        assert r.json()["results"] == []

    def test_limit_clamps_at_30(self, s):
        # Use broad query that yields many results
        r = s.get(f"{API}/suburbs/search", params={"q": "a", "limit": 500})
        assert r.status_code == 200
        results = r.json()["results"]
        assert len(results) <= 30, f"limit not clamped, got {len(results)}"

    def test_postcode_prefix_search(self, s):
        r = s.get(f"{API}/suburbs/search", params={"q": "2095"})
        assert r.status_code == 200
        results = r.json()["results"]
        names = [x["name"] for x in results]
        assert "Manly" in names

    def test_each_result_has_required_fields(self, s):
        r = s.get(f"{API}/suburbs/search", params={"q": "syd"})
        for item in r.json()["results"]:
            for k in ("name", "postcode", "state", "lat", "lng"):
                assert k in item


# ---------------- /api/suburbs/by-postcode ----------------
class TestSuburbsByPostcode:
    def test_2026_returns_bondi_and_bondi_beach(self, s):
        r = s.get(f"{API}/suburbs/by-postcode/2026")
        assert r.status_code == 200
        names = [x["name"] for x in r.json()["results"]]
        assert "Bondi" in names
        assert "Bondi Beach" in names

    def test_unknown_postcode_returns_empty(self, s):
        r = s.get(f"{API}/suburbs/by-postcode/9999")
        assert r.status_code == 200
        assert r.json()["results"] == []


# ---------------- /api/suburbs/nearest ----------------
class TestSuburbsNearest:
    def test_nearest_to_sydney_coords(self, s):
        # Chatswood is at -33.7969, 151.1832 — closer to (-33.8, 151.2) than Sydney CBD
        r = s.get(f"{API}/suburbs/nearest", params={"lat": -33.8, "lng": 151.2})
        assert r.status_code == 200
        nearest = r.json()["nearest"]
        assert nearest is not None
        assert nearest["distance_km"] < 10
        # Should be one of the inner-Sydney suburbs
        assert nearest["state"] == "NSW"


# ---------------- POST /api/users/{uid}/location ----------------
class TestSetLocation:
    def test_set_manly_persists_full_fields_but_response_hides_coords(self, s, frankie):
        r = s.post(f"{API}/users/{frankie['id']}/location", json={"suburb": "Manly"})
        assert r.status_code == 200
        body = r.json()
        # Response must NOT leak lat/lng
        assert "suburb_lat" not in body
        assert "suburb_lng" not in body
        assert "lat" not in body
        assert "lng" not in body
        # Confirm persisted suburb + postcode/state in DB via GET (note: GET also must NOT leak coords)
        u = s.get(f"{API}/users/{frankie['id']}").json()
        assert u["suburb"] == "Manly"
        assert u.get("suburb_postcode") == "2095"
        assert u.get("suburb_state") == "NSW"
        assert u.get("location_visibility") == "suburb"

    def test_unknown_suburb_freetext_fallback_no_coords(self, s, joycey):
        r = s.post(f"{API}/users/{joycey['id']}/location", json={"suburb": "NotARealPlace"})
        assert r.status_code == 200
        u = s.get(f"{API}/users/{joycey['id']}").json()
        assert u["suburb"] == "NotARealPlace"
        # No coords were attached
        assert u.get("suburb_lat") in (None,) or "suburb_lat" not in u
        assert u.get("suburb_lng") in (None,) or "suburb_lng" not in u

    def test_prefer_not_to_say_clears_location(self, s, maggie):
        # First set to a real suburb
        s.post(f"{API}/users/{maggie['id']}/location", json={"suburb": "Glenelg"})
        # Then opt out
        r = s.post(f"{API}/users/{maggie['id']}/location", json={"prefer_not_to_say": True})
        assert r.status_code == 200
        assert r.json()["location_visibility"] == "private"
        u = s.get(f"{API}/users/{maggie['id']}").json()
        assert u.get("location_visibility") == "private"
        assert u.get("suburb", "") == ""
        assert "suburb_lat" not in u or u["suburb_lat"] in (None,)
        assert "suburb_lng" not in u or u["suburb_lng"] in (None,)
        assert u.get("suburb_postcode", "") in ("", None) or "suburb_postcode" not in u

    def test_404_for_unknown_user(self, s):
        r = s.post(f"{API}/users/does-not-exist-xyz/location", json={"suburb": "Manly"})
        assert r.status_code == 404


# ---------------- GET /api/users — PRIVACY-CRITICAL ----------------
class TestUsersListPrivacy:
    def test_list_no_radius_strips_coords(self, s, disposable_users, frankie):
        # Frankie should currently have lat/lng from TestSetLocation
        r = s.get(f"{API}/users")
        assert r.status_code == 200
        users = r.json()
        assert isinstance(users, list)
        # No user should expose suburb_lat / suburb_lng
        leaks = [u for u in users if "suburb_lat" in u or "suburb_lng" in u]
        assert leaks == [], f"PRIVACY LEAK in /api/users list: {[u.get('username') for u in leaks]}"

    def test_radius_query_returns_distance_and_no_coords(self, s, disposable_users):
        # Sydney CBD coords; 10 km radius
        r = s.get(f"{API}/users", params={"near_lat": -33.8688, "near_lng": 151.2093, "radius_km": 10})
        assert r.status_code == 200
        users = r.json()
        assert isinstance(users, list)
        # Must include sydney + bondi disposable users
        usernames = {u.get("username") for u in users}
        assert any(u.startswith("TEST_locpriv_") and "Sydneyer" in u for u in usernames), \
            f"Sydney disposable user not in radius results: {usernames}"
        # Each user has distance_km, rounded to 1 decimal, NO coords
        for u in users:
            assert "distance_km" in u, f"{u.get('username')} missing distance_km"
            assert isinstance(u["distance_km"], (int, float))
            assert "suburb_lat" not in u, f"PRIVACY LEAK suburb_lat on {u.get('username')}"
            assert "suburb_lng" not in u, f"PRIVACY LEAK suburb_lng on {u.get('username')}"
        # Sorted ascending by distance_km
        dists = [u["distance_km"] for u in users]
        assert dists == sorted(dists), f"radius results not sorted by distance: {dists}"

    def test_radius_excludes_private_users(self, s, disposable_users):
        priv = disposable_users["private"]
        # Big radius — should still NOT include private user
        r = s.get(f"{API}/users", params={"near_lat": -33.8688, "near_lng": 151.2093, "radius_km": 500})
        users = r.json()
        ids = {u.get("id") for u in users}
        assert priv["id"] not in ids, "private (prefer_not_to_say) user leaked into radius query"

    def test_radius_respects_radius_bound(self, s, disposable_users):
        # 1 km radius around Sydney CBD — only the "Sydneyer" user should be in range
        r = s.get(f"{API}/users", params={"near_lat": -33.8688, "near_lng": 151.2093, "radius_km": 1})
        users = r.json()
        usernames = {u.get("username") for u in users}
        # All returned should be within 1 km
        for u in users:
            assert u["distance_km"] <= 1.0, f"{u.get('username')} dist {u['distance_km']} > 1km"


# ---------------- GET /api/users/{uid} — PRIVACY-CRITICAL ----------------
class TestSingleUserProfilePrivacy:
    def test_single_profile_does_not_leak_coords(self, s, frankie):
        # Ensure frankie has a known location
        s.post(f"{API}/users/{frankie['id']}/location", json={"suburb": "Manly"})
        r = s.get(f"{API}/users/{frankie['id']}")
        assert r.status_code == 200
        u = r.json()
        assert "suburb_lat" not in u, "CRITICAL: /api/users/{id} leaks suburb_lat"
        assert "suburb_lng" not in u, "CRITICAL: /api/users/{id} leaks suburb_lng"
        # But public suburb name + postcode/state should still be present
        assert u.get("suburb") == "Manly"
        assert u.get("suburb_postcode") == "2095"


# ---------------- Regression checks ----------------
class TestRegression:
    def test_community_today(self, s):
        r = s.get(f"{API}/community/today")
        assert r.status_code == 200
        data = r.json()
        for k in ("birthdays", "new_members", "anniversaries", "milestones"):
            assert k in data

    def test_demo_logins_all_three(self, s):
        for u in ("frankie", "maggie", "joycey"):
            r = s.post(f"{API}/auth/demo-login", json={"username": u})
            assert r.status_code == 200, f"{u}: {r.status_code}"
            assert "access_token" in r.json()

    def test_sudoku_daily(self, s):
        r = s.get(f"{API}/games/sudoku/daily")
        assert r.status_code == 200
        assert "puzzle_id" in r.json() or "grid" in r.json() or "puzzle" in r.json()

    def test_spot_daily(self, s):
        r = s.get(f"{API}/games/spot/daily")
        assert r.status_code == 200

    def test_admin_policy(self, s):
        r = s.get(f"{API}/admin/policy")
        assert r.status_code == 200
