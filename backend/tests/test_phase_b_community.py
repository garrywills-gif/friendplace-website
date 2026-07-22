"""Phase B Community Highlights + Birthday signup tests.

Covers:
- GET /api/community/today shape (birthdays / new_members / anniversaries / milestones)
- Filtering of test-like usernames (_[hex]+$, TEST_, Priv_, test_) from
  birthdays AND new_members
- Exclusion of banned, restricted, and is_demo users from new_members
- POST /api/auth/signup accepts an optional `birthday` field (YYYY-MM-DD or MM-DD)
  and stores it on the user
- Newly signed up user with MM-DD == today appears in /community/today birthdays
- Existing flows still work: demo-login frankie, /auth/me, /users/{id}
- Demo user `frankie` has 'Friendly Member' badge (not 'Friendly Butterfly')
"""
import os
import re
import uuid
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient
from dotenv import load_dotenv
from pathlib import Path

# Load backend .env for direct Mongo access (cleanup + seeding edge cases)
load_dotenv(Path("/app/backend/.env"))

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL", "https://friendplace-v1.preview.emergentagent.com"
).rstrip("/")

MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")

_mongo_client = MongoClient(MONGO_URL) if MONGO_URL else None
_db = _mongo_client[DB_NAME] if (_mongo_client and DB_NAME) else None

TODAY_MMDD = datetime.now(timezone.utc).strftime("%m-%d")


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def frankie_token(s):
    r = s.post(f"{BASE_URL}/api/auth/demo-login", json={"username": "frankie"})
    assert r.status_code == 200, r.text
    data = r.json()
    return data["access_token"], data["user"]


# Track created users for cleanup
_created_user_ids = []


def _signup(s, username, password="secret123", **extra):
    payload = {"username": username, "password": password}
    payload.update(extra)
    r = s.post(f"{BASE_URL}/api/auth/signup", json=payload)
    return r


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    # Remove every test user we created (by id) + any leftover by username pattern
    if _db is not None:
        if _created_user_ids:
            _db.users.delete_many({"id": {"$in": _created_user_ids}})
            _db.notifications.delete_many({"user_id": {"$in": _created_user_ids}})
            _db.notifications.delete_many({"ref_user_id": {"$in": _created_user_ids}})
        # Belt + braces: clean up anything matching test prefixes we used
        _db.users.delete_many({"username": {"$regex": "^(TEST_|Priv_|test_)"}})


# ---------------- community/today shape ----------------
class TestCommunityTodayShape:
    def test_endpoint_returns_expected_keys(self, s, frankie_token):
        _, user = frankie_token
        r = s.get(f"{BASE_URL}/api/community/today", params={"user_id": user["id"]})
        assert r.status_code == 200, r.text
        data = r.json()
        for key in ("date", "birthdays", "new_members", "anniversaries", "milestones"):
            assert key in data, f"missing key {key}"
        assert isinstance(data["birthdays"], list)
        assert isinstance(data["new_members"], list)
        assert isinstance(data["anniversaries"], list)
        assert isinstance(data["milestones"], dict)
        for mk in ("total_users", "last_reached", "next"):
            assert mk in data["milestones"]
        # date is today
        assert data["date"] == datetime.now(timezone.utc).date().isoformat()

    def test_self_excluded_from_birthdays_and_new_members(self, s, frankie_token):
        # frankie has birthday today (06-13). With user_id=frankie, he should be
        # filtered out of his own birthday list.
        _, user = frankie_token
        r = s.get(f"{BASE_URL}/api/community/today", params={"user_id": user["id"]})
        data = r.json()
        ids = {u["id"] for u in data["birthdays"]}
        assert user["id"] not in ids


# ---------------- username filter ----------------
class TestUsernameFilter:
    def test_hex_suffix_user_filtered_from_new_members(self, s):
        # Username with _<hex>{6,}$ suffix -- should be filtered out of new_members
        uname = f"smoke_{uuid.uuid4().hex[:8]}"  # e.g., smoke_a1b2c3d4
        r = _signup(s, uname, birthday=TODAY_MMDD, first_name="HexBday")
        assert r.status_code == 200, r.text
        uid = r.json()["user"]["id"]
        _created_user_ids.append(uid)

        resp = s.get(f"{BASE_URL}/api/community/today")
        assert resp.status_code == 200
        data = resp.json()
        new_ids = {u["id"] for u in data["new_members"]}
        bday_ids = {u["id"] for u in data["birthdays"]}
        assert uid not in new_ids, "hex-suffix username leaked into new_members"
        assert uid not in bday_ids, "hex-suffix username leaked into birthdays"

    def test_prefix_filters(self, s):
        # All three prefixes should be excluded from new_members + birthdays
        unames = [
            f"TEST_user{uuid.uuid4().hex[:4]}",
            f"Priv_user{uuid.uuid4().hex[:4]}",
            f"test_user{uuid.uuid4().hex[:4]}",
        ]
        ids = []
        for uname in unames:
            r = _signup(s, uname, birthday=TODAY_MMDD, first_name=uname)
            assert r.status_code == 200, f"{uname}: {r.text}"
            uid = r.json()["user"]["id"]
            ids.append(uid)
            _created_user_ids.append(uid)

        resp = s.get(f"{BASE_URL}/api/community/today")
        data = resp.json()
        new_ids = {u["id"] for u in data["new_members"]}
        bday_ids = {u["id"] for u in data["birthdays"]}
        for uid, uname in zip(ids, unames):
            assert uid not in new_ids, f"{uname} leaked into new_members"
            assert uid not in bday_ids, f"{uname} leaked into birthdays"


# ---------------- exclusions: banned / restricted / demo ----------------
class TestNewMembersExclusions:
    def test_demo_users_excluded_from_new_members(self, s):
        # All demo users are seeded -> should NOT be in new_members
        r = s.get(f"{BASE_URL}/api/community/today")
        data = r.json()
        for u in data["new_members"]:
            assert u.get("is_demo") is not True, f"demo user {u.get('username')} in new_members"

    def test_banned_and_restricted_excluded(self, s):
        # Create three normal users; flip flags directly in Mongo for two of them.
        if _db is None:
            pytest.skip("Mongo not reachable for direct flag toggling")
        normal_uname = f"normaltest{uuid.uuid4().hex[:6]}".replace("_", "")  # no underscore to avoid filter
        banned_uname = f"bandtest{uuid.uuid4().hex[:6]}".replace("_", "")
        rest_uname = f"resttest{uuid.uuid4().hex[:6]}".replace("_", "")

        ids = {}
        for uname in (normal_uname, banned_uname, rest_uname):
            r = _signup(s, uname)
            assert r.status_code == 200, r.text
            ids[uname] = r.json()["user"]["id"]
            _created_user_ids.append(ids[uname])

        _db.users.update_one({"id": ids[banned_uname]}, {"$set": {"banned": True}})
        _db.users.update_one({"id": ids[rest_uname]}, {"$set": {"restricted": True}})

        data = s.get(f"{BASE_URL}/api/community/today").json()
        new_ids = {u["id"] for u in data["new_members"]}
        assert ids[normal_uname] in new_ids, "normal new member missing from new_members"
        assert ids[banned_uname] not in new_ids, "banned user leaked into new_members"
        assert ids[rest_uname] not in new_ids, "restricted user leaked into new_members"


# ---------------- signup birthday field ----------------
class TestSignupBirthday:
    def test_signup_accepts_birthday_mmdd(self, s):
        uname = f"bday{uuid.uuid4().hex[:6]}"
        r = _signup(s, uname, birthday=TODAY_MMDD, first_name="BdayMMDD")
        assert r.status_code == 200, r.text
        user = r.json()["user"]
        _created_user_ids.append(user["id"])
        assert user.get("birthday") == TODAY_MMDD

        # Verify via /users/{id}
        got = s.get(f"{BASE_URL}/api/users/{user['id']}").json()
        assert got.get("birthday") == TODAY_MMDD

    def test_signup_accepts_birthday_yyyy_mm_dd(self, s):
        uname = f"byyy{uuid.uuid4().hex[:6]}"
        bday = f"1955-{TODAY_MMDD}"
        r = _signup(s, uname, birthday=bday, first_name="BdayYYYY")
        assert r.status_code == 200, r.text
        user = r.json()["user"]
        _created_user_ids.append(user["id"])
        assert user.get("birthday") == bday

    def test_signup_birthday_optional(self, s):
        uname = f"nob{uuid.uuid4().hex[:6]}"
        r = _signup(s, uname, first_name="NoBday")
        assert r.status_code == 200, r.text
        user = r.json()["user"]
        _created_user_ids.append(user["id"])
        # birthday defaults to empty string
        assert user.get("birthday", "") == ""

    def test_today_birthday_user_appears_in_community_today(self, s):
        uname = f"bdayhit{uuid.uuid4().hex[:6]}"
        r = _signup(s, uname, birthday=TODAY_MMDD, first_name="BdayHit")
        assert r.status_code == 200, r.text
        user = r.json()["user"]
        _created_user_ids.append(user["id"])

        data = s.get(f"{BASE_URL}/api/community/today").json()
        bday_ids = {u["id"] for u in data["birthdays"]}
        assert user["id"] in bday_ids, "new user with today's birthday missing from /community/today"

    def test_today_birthday_user_with_yyyy_mm_dd_appears(self, s):
        uname = f"bdayyyy{uuid.uuid4().hex[:6]}"
        bday = f"1950-{TODAY_MMDD}"
        r = _signup(s, uname, birthday=bday, first_name="BdayFullDate")
        assert r.status_code == 200, r.text
        user = r.json()["user"]
        _created_user_ids.append(user["id"])

        data = s.get(f"{BASE_URL}/api/community/today").json()
        bday_ids = {u["id"] for u in data["birthdays"]}
        assert user["id"] in bday_ids, "YYYY-MM-DD birthday match missing from /community/today"


# ---------------- existing flow regression ----------------
class TestExistingFlows:
    def test_demo_login_frankie(self, s, frankie_token):
        token, user = frankie_token
        assert user["username"].lower() == "frankie"
        assert user.get("is_demo") is True
        assert token

    def test_auth_me(self, s, frankie_token):
        token, user = frankie_token
        r = s.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200, r.text
        me = r.json()
        assert me["id"] == user["id"]
        assert me["username"].lower() == "frankie"

    def test_get_user_by_id(self, s, frankie_token):
        _, user = frankie_token
        r = s.get(f"{BASE_URL}/api/users/{user['id']}")
        assert r.status_code == 200
        got = r.json()
        assert got["id"] == user["id"]
        # _id should never leak
        assert "_id" not in got

    def test_frankie_has_friendly_member_badge(self, s, frankie_token):
        _, user = frankie_token
        r = s.get(f"{BASE_URL}/api/users/{user['id']}")
        badges = r.json().get("badges") or []
        assert "Friendly Member" in badges, f"expected 'Friendly Member' in {badges}"
        assert "Friendly Butterfly" not in badges, "old badge label 'Friendly Butterfly' should be gone"
