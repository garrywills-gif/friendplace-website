"""
iter250 — TestFlight feedback (Neo, Feb 2026):
1) Backend: GET /api/community/today milestones.total_users uses the
   same real-member filter as new_members (excludes is_demo/banned/
   restricted and TEST_/test_/Priv_/_<6+hex> username patterns).
2) Given current preview DB state, total_users should be 56, last_reached
   should be "We are 50 strong!" (users=50), and next should be
   {users:100, label:"100 members — hooray!"}.
3) The returned shape must contain the fields the Home milestone row
   consumes: milestones.total_users (int), milestones.last_reached and
   milestones.next.
"""

import os
import re
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://friendplace-stable.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def today_payload():
    r = requests.get(f"{BASE_URL}/api/community/today", timeout=20)
    assert r.status_code == 200, f"community/today returned {r.status_code}: {r.text[:200]}"
    return r.json()


class TestCommunityTodayMilestones:
    """Milestone fields on /api/community/today."""

    def test_milestones_shape(self, today_payload):
        m = today_payload.get("milestones")
        assert isinstance(m, dict), "milestones must be a dict"
        assert "total_users" in m
        assert "last_reached" in m
        assert "next" in m
        assert isinstance(m["total_users"], int)

    def test_total_users_is_filtered(self, today_payload):
        # Preview DB currently has 56 real members after filtering.
        total = today_payload["milestones"]["total_users"]
        # Not 248 (unfiltered raw count), and strictly below 100.
        assert total < 100, f"total_users should reflect filtered real members, got {total}"
        assert total == 56, f"Expected 56 real members per acceptance; got {total}"

    def test_last_reached_is_50(self, today_payload):
        lr = today_payload["milestones"]["last_reached"]
        assert lr is not None, "last_reached should be the 50-member milestone"
        assert lr.get("users") == 50
        assert "50" in (lr.get("label") or "")

    def test_next_milestone_is_100(self, today_payload):
        nx = today_payload["milestones"]["next"]
        assert nx is not None, "next milestone should be 100"
        assert nx.get("users") == 100

    def test_total_matches_new_members_filter(self, today_payload):
        """Any new_members returned must satisfy the same filter the total uses:
        no is_demo, no TEST_/test_/Priv_/_<6+hex> handles. (banned/restricted
        aren't exposed in the payload so we rely on the known filter in server.)"""
        pat = re.compile(r"_[a-f0-9]{6,}$|^(TEST_|Priv_|test_)")
        for m in today_payload.get("new_members", []):
            # username is intentionally emptied for client (iter210), so just
            # make sure first_name is set to a human-readable fallback.
            assert isinstance(m.get("first_name"), str) and m["first_name"], m
            # username field, if present, must be empty per iter210.
            assert not m.get("username"), f"username must be sanitised in community cards: {m}"
            # No raw auth-style handles should sneak in via first_name either.
            assert not pat.search(m["first_name"] or ""), m


class TestCommunityTodayPerUser:
    """Verify endpoint also works with a user_id (demo maggie)."""

    @pytest.fixture(scope="class")
    def maggie_id(self):
        r = requests.post(f"{BASE_URL}/api/auth/demo-login", json={"username": "maggie"}, timeout=20)
        if r.status_code != 200:
            pytest.skip(f"demo-login unavailable: {r.status_code}")
        return r.json()["user"]["id"]

    def test_community_today_per_user(self, maggie_id):
        r = requests.get(f"{BASE_URL}/api/community/today", params={"user_id": maggie_id}, timeout=20)
        assert r.status_code == 200
        data = r.json()
        # Same milestone invariants hold regardless of viewer.
        assert data["milestones"]["total_users"] == 56
        assert data["milestones"]["next"]["users"] == 100
        assert data["milestones"]["last_reached"]["users"] == 50
