"""Tests for the new post-signup Onboarding Wizard endpoints.

Covers:
- GET  /api/onboarding/suggested-groups
- POST /api/onboarding/complete
- Backward compatibility: POST /api/users/{uid}/onboarding-complete
- Touched-file regression smoke (auth/admin/groups)
"""

import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://friendplace-v1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

STARTER_NAMES = {
    "Sydney Locals",
    "New Friends",
    "Pet Lovers",
    "Classic Cars",
    "Gardening",
    "Walking & Trails",
    "Coffee Lounge Crew",
}


# -------------------- Fixtures --------------------

@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="session")
def frankie(s):
    r = s.post(f"{API}/auth/demo-login", json={"username": "frankie"}, timeout=15)
    assert r.status_code == 200, f"demo-login frankie failed: {r.status_code} {r.text}"
    data = r.json()
    user = data["user"]
    assert user["username"] == "frankie"
    return {"id": user["id"], "user": user, "token": data["access_token"]}


@pytest.fixture
def fresh_user(s):
    """Create a brand new real user via signup."""
    suffix = uuid.uuid4().hex[:8]
    payload = {
        "username": f"TEST_onb_{suffix}",
        "password": "secret123",
        "email": f"TEST_onb_{suffix}@example.com",
        "first_name": "Onby",
        "interests": ["Pets", "Gardening"],
    }
    r = s.post(f"{API}/auth/signup", json=payload, timeout=15)
    assert r.status_code == 200, f"signup failed: {r.status_code} {r.text}"
    data = r.json()
    return {"id": data["user"]["id"], "user": data["user"], "token": data["access_token"], "username": payload["username"]}


# -------------------- /onboarding/suggested-groups --------------------

class TestSuggestedGroups:
    def test_starter_groups_present_and_shape(self, s, frankie):
        r = s.get(f"{API}/onboarding/suggested-groups", params={"user_id": frankie["id"]}, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "groups" in data and isinstance(data["groups"], list)
        groups = data["groups"]
        assert len(groups) >= 7, f"expected >=7 groups, got {len(groups)}"

        # Required keys in each item
        required = {"id", "name", "emoji", "description", "member_count", "is_starter", "match"}
        for g in groups:
            assert required.issubset(set(g.keys())), f"missing keys in: {g}"

        # All 7 starter names present
        names = {g["name"] for g in groups}
        missing = STARTER_NAMES - names
        assert not missing, f"missing starter groups: {missing}"

        # Starter groups should report is_starter=True
        for g in groups:
            if g["name"] in STARTER_NAMES:
                assert g["is_starter"] is True, f"{g['name']} should be is_starter"

    def test_interest_match_ranks_pet_lovers_high_for_frankie(self, s, frankie):
        """Frankie's interests include 'Pets' -> Pet Lovers (tag 'pets') should rank high."""
        r = s.get(f"{API}/onboarding/suggested-groups", params={"user_id": frankie["id"]}, timeout=15)
        assert r.status_code == 200
        groups = r.json()["groups"]
        # Find positions
        pos = {g["name"]: idx for idx, g in enumerate(groups)}
        assert "Pet Lovers" in pos, "Pet Lovers missing from suggestions"
        pet_lovers = next(g for g in groups if g["name"] == "Pet Lovers")
        assert pet_lovers["match"] >= 1, f"Pet Lovers should match Frankie's 'Pets' interest, got match={pet_lovers['match']}"

        # Pet Lovers must rank above at least one non-matching starter (e.g., Classic Cars)
        if "Classic Cars" in pos:
            assert pos["Pet Lovers"] < pos["Classic Cars"], "Pet Lovers (match) should rank above Classic Cars (no match)"

        # Top item must have match >= match of any later non-matching one
        assert groups[0]["match"] >= pet_lovers["match"] - 0  # sanity

    def test_idempotency_no_dup_starter_groups(self, s, frankie):
        # Hit twice
        r1 = s.get(f"{API}/onboarding/suggested-groups", params={"user_id": frankie["id"]}, timeout=15)
        r2 = s.get(f"{API}/onboarding/suggested-groups", params={"user_id": frankie["id"]}, timeout=15)
        assert r1.status_code == 200 and r2.status_code == 200

        # Count occurrences of each starter name in second response
        from collections import Counter
        counts = Counter(g["name"] for g in r2.json()["groups"])
        for n in STARTER_NAMES:
            assert counts[n] == 1, f"starter group {n} duplicated: count={counts[n]}"

        # Both responses should report the same number of starter ids
        s1_ids = {g["id"] for g in r1.json()["groups"] if g["name"] in STARTER_NAMES}
        s2_ids = {g["id"] for g in r2.json()["groups"] if g["name"] in STARTER_NAMES}
        assert s1_ids == s2_ids, "starter group ids changed between calls (not idempotent)"

    def test_invalid_user_id_returns_404(self, s):
        r = s.get(f"{API}/onboarding/suggested-groups", params={"user_id": "does-not-exist-zzz"}, timeout=15)
        assert r.status_code == 404, f"expected 404, got {r.status_code}: {r.text}"


# -------------------- /onboarding/complete --------------------

class TestOnboardingComplete:
    def test_complete_basic_awards_welcome_aboard_and_10_points(self, s, fresh_user):
        # Pick a couple of starter groups
        sg = s.get(f"{API}/onboarding/suggested-groups", params={"user_id": fresh_user["id"]}, timeout=15).json()["groups"]
        starter_ids = [g["id"] for g in sg if g["is_starter"]][:2]

        body = {
            "user_id": fresh_user["id"],
            "interests": ["Pets", "Gardening"],
            "suburb": "Manly",
            "suburb_postcode": "2095",
            "suburb_state": "NSW",
            "location_visibility": "suburb",
            "group_ids": starter_ids,
            "joined_all": False,
        }
        r = s.post(f"{API}/onboarding/complete", json=body, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert set(data["joined_group_ids"]) == set(starter_ids)
        u = data["user"]
        assert u["onboarding_completed"] is True
        assert "Welcome Aboard" in (u.get("badges") or [])
        assert "Community Joiner" not in (u.get("badges") or [])  # joined_all=False
        # Points start at default (depends on signup default). Just assert points >= 10
        assert int(u.get("points") or 0) >= 10

        # Verify via /auth/me
        me = s.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {fresh_user['token']}"}, timeout=15)
        assert me.status_code == 200
        me_user = me.json()["user"] if "user" in me.json() else me.json()
        assert me_user.get("onboarding_completed") is True

        # Verify group memberships via /api/groups
        groups_all = s.get(f"{API}/groups", timeout=15).json()
        glist = groups_all if isinstance(groups_all, list) else groups_all.get("groups", [])
        for gid in starter_ids:
            g = next((x for x in glist if x.get("id") == gid), None)
            assert g is not None, f"group {gid} not found in /api/groups"
            assert fresh_user["id"] in (g.get("members") or []), f"user not in members of {gid}"

        # Verify notification of type 'onboarding_done' exists
        n = s.get(f"{API}/notifications/{fresh_user['id']}", timeout=15)
        assert n.status_code == 200, n.text
        notifs = n.json() if isinstance(n.json(), list) else n.json().get("notifications", [])
        assert any(x.get("type") == "onboarding_done" for x in notifs), "onboarding_done notification missing"

    def test_joined_all_awards_community_joiner_and_15_points(self, s, fresh_user):
        # Snapshot points before
        before_pts = int(fresh_user["user"].get("points") or 0)

        body = {
            "user_id": fresh_user["id"],
            "interests": [],
            "group_ids": [],
            "joined_all": True,
        }
        r = s.post(f"{API}/onboarding/complete", json=body, timeout=15)
        assert r.status_code == 200, r.text
        u = r.json()["user"]
        badges = u.get("badges") or []
        assert "Welcome Aboard" in badges
        assert "Community Joiner" in badges
        assert int(u.get("points") or 0) >= before_pts + 15

    def test_idempotent_no_dup_membership_or_badge(self, s, fresh_user):
        sg = s.get(f"{API}/onboarding/suggested-groups", params={"user_id": fresh_user["id"]}, timeout=15).json()["groups"]
        starter_ids = [g["id"] for g in sg if g["is_starter"]][:2]
        body = {"user_id": fresh_user["id"], "interests": ["Pets"], "group_ids": starter_ids, "joined_all": False}
        r1 = s.post(f"{API}/onboarding/complete", json=body, timeout=15)
        r2 = s.post(f"{API}/onboarding/complete", json=body, timeout=15)
        assert r1.status_code == 200 and r2.status_code == 200, (r1.text, r2.text)
        u = r2.json()["user"]
        badges = u.get("badges") or []
        # Welcome Aboard appears exactly once
        assert badges.count("Welcome Aboard") == 1, f"Welcome Aboard duplicated: {badges}"

        # Group membership should be deduped ($addToSet) — verify via /groups
        groups_all = s.get(f"{API}/groups", timeout=15).json()
        glist = groups_all if isinstance(groups_all, list) else groups_all.get("groups", [])
        for gid in starter_ids:
            g = next((x for x in glist if x.get("id") == gid), None)
            assert g is not None
            members = g.get("members") or []
            assert members.count(fresh_user["id"]) == 1, f"user duplicated in {gid}: {members}"

    def test_empty_payload_still_marks_complete(self, s, fresh_user):
        body = {"user_id": fresh_user["id"], "interests": [], "group_ids": []}
        r = s.post(f"{API}/onboarding/complete", json=body, timeout=15)
        assert r.status_code == 200, r.text
        u = r.json()["user"]
        assert u["onboarding_completed"] is True
        assert "Welcome Aboard" in (u.get("badges") or [])
        assert r.json()["joined_group_ids"] == []

    def test_location_visibility_private_wipes_suburb(self, s, fresh_user):
        body = {
            "user_id": fresh_user["id"],
            "interests": [],
            "suburb": "Manly",
            "suburb_postcode": "2095",
            "suburb_state": "NSW",
            "location_visibility": "private",
            "group_ids": [],
        }
        r = s.post(f"{API}/onboarding/complete", json=body, timeout=15)
        assert r.status_code == 200, r.text
        u = r.json()["user"]
        assert u.get("location_visibility") == "private"
        assert u.get("suburb", "") == "", f"suburb should be wiped, got {u.get('suburb')!r}"

    def test_complete_invalid_user_returns_404(self, s):
        r = s.post(f"{API}/onboarding/complete", json={"user_id": "no-such-user-zzz", "interests": [], "group_ids": []}, timeout=15)
        assert r.status_code == 404, f"expected 404, got {r.status_code}: {r.text}"


# -------------------- Backward-compat & regression smoke --------------------

class TestRegressionSmoke:
    def test_legacy_onboarding_complete_still_works(self, s, fresh_user):
        r = s.post(f"{API}/users/{fresh_user['id']}/onboarding-complete", timeout=15)
        assert r.status_code == 200
        assert r.json().get("ok") is True

    def test_demo_login(self, s):
        r = s.post(f"{API}/auth/demo-login", json={"username": "maggie"}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "access_token" in d and "user" in d

    def test_login_real_account(self, s):
        # Try the seeded real account, if absent skip (signed up first by tests historically)
        r = s.post(f"{API}/auth/login", json={"username": "realtest1", "password": "secret123"}, timeout=15)
        if r.status_code != 200:
            pytest.skip(f"realtest1 not available: {r.status_code}")
        assert "access_token" in r.json()

    def test_auth_me_with_token(self, s, frankie):
        r = s.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {frankie['token']}"}, timeout=15)
        assert r.status_code == 200

    def test_google_auth_endpoint_reachable(self, s):
        # Sending an invalid session_id should produce a 4xx (not 5xx). The endpoint
        # exists and validates session via Emergent.
        r = s.post(f"{API}/auth/google", json={"session_id": "TEST_invalid_session"}, timeout=15)
        assert r.status_code < 500, f"/auth/google 5xx with invalid session: {r.status_code} {r.text}"

    def test_signup_unique_username_validation(self, s, fresh_user):
        r = s.post(f"{API}/auth/signup", json={
            "username": fresh_user["username"], "password": "secret123",
            "email": "dup@example.com",
        }, timeout=15)
        assert r.status_code in (400, 409), f"expected 4xx for duplicate username, got {r.status_code}"

    def test_admin_summary(self, s):
        # maggie is admin
        m = s.post(f"{API}/auth/demo-login", json={"username": "maggie"}, timeout=15).json()
        admin_id = m["user"]["id"]
        r = s.get(f"{API}/admin/summary", params={"admin_id": admin_id}, timeout=15)
        assert r.status_code == 200, r.text

    def test_groups_listing(self, s):
        r = s.get(f"{API}/groups", timeout=15)
        assert r.status_code == 200
        data = r.json()
        glist = data if isinstance(data, list) else data.get("groups", [])
        assert len(glist) >= 7  # at least the starters

    def test_legacy_group_join(self, s, fresh_user):
        glist = s.get(f"{API}/groups", timeout=15).json()
        glist = glist if isinstance(glist, list) else glist.get("groups", [])
        # Pick any non-starter or starter group
        gid = glist[0]["id"]
        r = s.post(f"{API}/groups/{gid}/join/{fresh_user['id']}", timeout=15)
        assert r.status_code == 200
