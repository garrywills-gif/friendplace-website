"""
Tests for the "newest on top" sorting changes.

Covers:
- GET /api/users default ordering (newest first)
- GET /api/users?near_lat&near_lng&radius_km (still distance-sorted)
- GET /api/users?q=Bill (search-filtered, newest first)
- POST /api/users + GET /api/users -> new user at index 0
- GET /api/groups newest first
- POST /api/groups + GET /api/groups -> new group at index 0
- Regression: flutters, notices, dm conversations, notifications,
  recipes, tables, group posts still return newest-first.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s() -> requests.Session:
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


def _parse_iso(ts: Optional[str]) -> datetime:
    if not ts:
        return datetime.min
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except Exception:
        try:
            return datetime.fromisoformat(ts)
        except Exception:
            return datetime.min


def _is_desc(values: List[datetime]) -> bool:
    return all(values[i] >= values[i + 1] for i in range(len(values) - 1))


# ---------------- USERS ----------------

class TestUsersSorting:
    def test_users_default_newest_first(self, s: requests.Session):
        r = s.get(f"{API}/users")
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 2, "Need at least 2 users to test ordering"
        timestamps = [_parse_iso(u.get("created_at")) for u in data]
        # First user newer than (or equal to) last
        assert timestamps[0] >= timestamps[-1], (
            f"Expected newest first. first={data[0].get('created_at')} "
            f"last={data[-1].get('created_at')}"
        )
        # And the whole list should be monotonically descending
        assert _is_desc(timestamps), "List not in descending created_at order"

    def test_users_near_me_still_distance_sorted(self, s: requests.Session):
        params = {"near_lat": -33.86, "near_lng": 151.21, "radius_km": 50}
        r = s.get(f"{API}/users", params=params)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        if len(data) < 2:
            pytest.skip("Not enough nearby users to verify distance sort")
        # Every row has distance_km, and list is ascending by distance
        distances = [u.get("distance_km") for u in data]
        assert all(d is not None for d in distances), "distance_km missing on a row"
        assert distances[0] <= distances[-1]
        assert distances == sorted(distances), "Near Me results not distance-sorted ascending"
        # And coords must not leak
        for u in data:
            assert "suburb_lat" not in u
            assert "suburb_lng" not in u

    def test_users_search_q_bill_newest_first(self, s: requests.Session):
        r = s.get(f"{API}/users", params={"q": "Bill"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        if len(data) < 2:
            pytest.skip("Search for 'Bill' returned <2 rows; covered by broader q test below")
        timestamps = [_parse_iso(u.get("created_at")) for u in data]
        assert _is_desc(timestamps), "q=Bill results not newest-first"

    def test_users_search_q_broad_newest_first(self, s: requests.Session):
        # Broader query that should match multiple users so we still exercise
        # the q-filtered ordering even when 'Bill' returns only one row.
        for term in ("a", "e", "o"):
            r = s.get(f"{API}/users", params={"q": term})
            assert r.status_code == 200, r.text
            data = r.json()
            if len(data) >= 2:
                timestamps = [_parse_iso(u.get("created_at")) for u in data]
                assert _is_desc(timestamps), f"q={term!r} results not newest-first"
                return
        pytest.skip("Could not find any q term with >=2 matches")

    def test_create_user_lands_at_index_zero(self, s: requests.Session):
        # Sign up a brand-new user
        suffix = uuid.uuid4().hex[:8]
        username = f"TESTsortuser{suffix}"
        payload = {
            "username": username,
            "password": "secret123",
            "first_name": f"TEST_{suffix}",
            "email": f"{username}@example.com",
        }
        r = s.post(f"{API}/auth/signup", json=payload)
        assert r.status_code in (200, 201), f"signup failed: {r.status_code} {r.text}"
        user = r.json().get("user") or {}
        new_id = user.get("id")
        assert new_id, "signup did not return a user id"

        # Verify it shows up at index 0 in the default users list
        r2 = s.get(f"{API}/users")
        assert r2.status_code == 200
        lst = r2.json()
        assert lst, "users list empty after signup"
        assert lst[0].get("id") == new_id, (
            f"Newly signed-up user not at index 0. "
            f"index0={lst[0].get('username')} created_at={lst[0].get('created_at')} "
            f"new_user={username} created_at={user.get('created_at')}"
        )


# ---------------- GROUPS ----------------

class TestGroupsSorting:
    def test_groups_default_newest_first(self, s: requests.Session):
        r = s.get(f"{API}/groups")
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        if len(data) < 2:
            pytest.skip("Need at least 2 groups to verify ordering")
        timestamps = [_parse_iso(g.get("created_at")) for g in data]
        assert timestamps[0] >= timestamps[-1]
        assert _is_desc(timestamps), "Groups not newest-first"

    def test_create_group_lands_at_index_zero(self, s: requests.Session):
        suffix = uuid.uuid4().hex[:8]
        payload = {
            "name": f"TEST_sort_group_{suffix}",
            "category": "Test",
            "description": "Created by automated newest-on-top test",
        }
        r = s.post(f"{API}/groups", json=payload)
        assert r.status_code in (200, 201), f"create group failed: {r.status_code} {r.text}"
        new_group = r.json()
        new_id = new_group.get("id")
        assert new_id, "create group did not return an id"

        r2 = s.get(f"{API}/groups")
        assert r2.status_code == 200
        lst = r2.json()
        assert lst, "groups list empty after create"
        assert lst[0].get("id") == new_id, (
            f"New group not at index 0. index0={lst[0].get('name')} created_at={lst[0].get('created_at')} "
            f"new_group={payload['name']} created_at={new_group.get('created_at')}"
        )


# ---------------- REGRESSION: other lists ----------------

def _pick_user_id(s: requests.Session) -> str:
    r = s.get(f"{API}/users")
    r.raise_for_status()
    users = r.json()
    assert users, "no users to use as pivot"
    # prefer a demo account if available
    for u in users:
        if u.get("is_demo"):
            return u["id"]
    return users[0]["id"]


class TestRegressionSorts:
    def test_flutters_newest_first(self, s: requests.Session):
        # Find any user who has >=2 unread flutters to verify ordering.
        users = s.get(f"{API}/users").json()
        for u in users[:20]:
            r = s.get(f"{API}/flutters/{u['id']}")
            if r.status_code != 200:
                continue
            data = r.json()
            if isinstance(data, list) and len(data) >= 2:
                timestamps = [_parse_iso(d.get("created_at")) for d in data]
                assert _is_desc(timestamps), "Flutters not newest-first"
                return
        pytest.skip("No user with >=2 unread flutters")

    def test_notices_unsolved_then_newest(self, s: requests.Session):
        r = s.get(f"{API}/notices")
        assert r.status_code == 200, r.text
        data = r.json()
        if len(data) < 2:
            pytest.skip("Not enough notices to verify sort")
        # Unsolved first, then newest within each group
        solved_flags = [bool(n.get("solved")) for n in data]
        # group-by-group: false comes before true
        assert solved_flags == sorted(solved_flags), "Solved notices should sink below unsolved"
        # Within unsolved, newest first
        unsolved = [n for n in data if not n.get("solved")]
        if len(unsolved) >= 2:
            ts = [_parse_iso(n.get("created_at")) for n in unsolved]
            assert _is_desc(ts), "Unsolved notices not newest-first"
        # Within solved, newest first
        solved = [n for n in data if n.get("solved")]
        if len(solved) >= 2:
            ts2 = [_parse_iso(n.get("created_at")) for n in solved]
            assert _is_desc(ts2), "Solved notices not newest-first"

    def test_dm_conversations_updated_at_desc(self, s: requests.Session):
        users = s.get(f"{API}/users").json()
        for u in users[:20]:
            r = s.get(f"{API}/dm/{u['id']}/conversations")
            if r.status_code != 200:
                continue
            data = r.json()
            if isinstance(data, list) and len(data) >= 2:
                timestamps = [_parse_iso(c.get("updated_at")) for c in data]
                assert _is_desc(timestamps), "DM conversations not updated_at DESC"
                return
        pytest.skip("No user with >=2 conversations")

    def test_notifications_newest_first(self, s: requests.Session):
        uid = _pick_user_id(s)
        r = s.get(f"{API}/notifications/{uid}")
        assert r.status_code == 200, r.text
        data = r.json()
        if len(data) < 2:
            pytest.skip("Not enough notifications to verify sort")
        timestamps = [_parse_iso(n.get("created_at")) for n in data]
        assert _is_desc(timestamps), "Notifications not newest-first"

    def test_recipes_newest_first(self, s: requests.Session):
        r = s.get(f"{API}/recipes")
        assert r.status_code == 200, r.text
        payload = r.json()
        recipes = payload.get("recipes") if isinstance(payload, dict) else payload
        assert isinstance(recipes, list)
        if len(recipes) < 2:
            pytest.skip("Not enough recipes to verify sort")
        timestamps = [_parse_iso(r_.get("created_at")) for r_ in recipes]
        assert _is_desc(timestamps), "Recipes not newest-first"

    def test_tables_last_activity_desc(self, s: requests.Session):
        r = s.get(f"{API}/tables")
        assert r.status_code == 200, r.text
        data = r.json()
        if len(data) < 2:
            pytest.skip("Not enough tables to verify sort")
        timestamps = [_parse_iso(t.get("last_activity_at")) for t in data]
        assert _is_desc(timestamps), "Tables not last_activity_at DESC"

    def test_group_posts_newest_first(self, s: requests.Session):
        # Find a group that has >= 2 posts
        r = s.get(f"{API}/groups")
        r.raise_for_status()
        groups = r.json()
        if not groups:
            pytest.skip("No groups available")
        target_posts: List[Dict[str, Any]] = []
        for g in groups[:10]:
            gp = s.get(f"{API}/groups/{g['id']}/posts")
            if gp.status_code != 200:
                continue
            posts = gp.json()
            if isinstance(posts, list) and len(posts) >= 2:
                target_posts = posts
                break
        if not target_posts:
            pytest.skip("No group has >=2 posts to verify sort")
        timestamps = [_parse_iso(p.get("created_at")) for p in target_posts]
        assert _is_desc(timestamps), "Group posts not newest-first"
