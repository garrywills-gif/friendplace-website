"""Iteration 38 — Founding Member opt-in flow.

Validates that:
  - New signups are NO LONGER auto-promoted to Founders.
  - POST /api/founders/claim (Bearer auth) promotes the current user.
  - The claim is idempotent: 2nd attempt → 409.
  - Demo accounts are rejected → 400.
  - GET /api/founders/status counter increments after a claim.
  - GET /api/founders wall data includes the newly claimed founder.
  - After claim, user is a member of the Founders Lounge group and is
    seated at the Founders Lounge coffee table.
"""
import os
import uuid
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://friendplace-v1.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def mongo():
    return MongoClient(MONGO_URL)[DB_NAME]


# -------- helpers --------

def _signup(api, suffix: str):
    payload = {
        "username": f"TEST_iter38_{suffix}",
        "password": "Test1234!",
        "email": f"test_iter38_{suffix}@example.com",
        "first_name": "Iter38",
    }
    r = api.post(f"{BASE_URL}/api/auth/signup", json=payload)
    assert r.status_code == 200, f"signup failed: {r.status_code} {r.text}"
    return r.json()


def _cleanup_user(mongo, uid: str):
    mongo.users.delete_one({"id": uid})
    mongo.notifications.delete_many({"user_id": uid})
    mongo.groups.update_many({}, {"$pull": {"members": uid}})
    mongo.tables.update_many({}, {"$pull": {"seated": uid}})


# -------- 1. Signup no longer auto-assigns founder --------

class TestSignupNoAutoFounder:
    def test_signup_returns_non_founder_user(self, api, mongo):
        suffix = uuid.uuid4().hex[:8]
        data = _signup(api, suffix)
        user = data["user"]
        token = data["access_token"]
        try:
            assert user.get("is_founder") in (False, None), f"new signup should NOT be founder: {user}"
            assert user.get("founder_number") in (None, 0), f"founder_number must not be set: {user}"
            assert "Founding Member" not in (user.get("badges") or [])

            # /auth/me confirms persisted state
            r = api.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {token}"})
            assert r.status_code == 200
            me = r.json()
            assert me.get("is_founder") in (False, None)
            assert me.get("founder_number") in (None, 0)
        finally:
            _cleanup_user(mongo, user["id"])


# -------- 2. POST /founders/claim happy path + idempotency + lounge wiring --------

class TestFounderClaim:
    def test_claim_promotes_and_is_idempotent(self, api, mongo):
        suffix = uuid.uuid4().hex[:8]
        data = _signup(api, suffix)
        user = data["user"]
        token = data["access_token"]
        uid = user["id"]
        try:
            # Snapshot status BEFORE claim
            r = api.get(f"{BASE_URL}/api/founders/status")
            assert r.status_code == 200
            taken_before = r.json()["taken"]

            # Claim
            headers = {"Authorization": f"Bearer {token}"}
            r = api.post(f"{BASE_URL}/api/founders/claim", headers=headers)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body.get("ok") is True
            assert isinstance(body.get("founder_number"), int) and body["founder_number"] >= 1
            promoted = body["user"]
            assert promoted.get("is_founder") is True
            assert "Founding Member" in (promoted.get("badges") or [])
            assert promoted.get("founder_number") == body["founder_number"]

            # /auth/me confirms persistence
            r = api.get(f"{BASE_URL}/api/auth/me", headers=headers)
            assert r.status_code == 200
            me = r.json()
            assert me.get("is_founder") is True
            assert me.get("founder_number") == body["founder_number"]

            # Status counter incremented by 1
            r = api.get(f"{BASE_URL}/api/founders/status")
            assert r.status_code == 200
            taken_after = r.json()["taken"]
            assert taken_after == taken_before + 1, f"expected +1, got {taken_before}→{taken_after}"

            # Founders Wall list includes the new founder
            r = api.get(f"{BASE_URL}/api/founders")
            assert r.status_code == 200
            wall = r.json()
            ids = [it.get("id") for it in wall.get("items", [])]
            assert uid in ids, f"new founder missing from wall: {ids}"

            # Founders Lounge group: user is a member; group is in user's groups
            fl = mongo.groups.find_one({"name": "Founders Lounge"}, {"_id": 0, "id": 1, "members": 1})
            assert fl is not None, "Founders Lounge group missing"
            assert uid in (fl.get("members") or []), "user not added to Founders Lounge group"

            # GET /api/groups (list) includes the user in Founders Lounge members.
            # NOTE: there's no single-group GET endpoint (GET /api/groups/{id})
            # exposed; the review request mentioned that URL but the API
            # only ships /api/groups (list). Verified via the list response.
            r = api.get(f"{BASE_URL}/api/groups")
            assert r.status_code == 200
            groups = r.json()
            g = next((x for x in groups if x.get("id") == fl["id"]), None)
            assert g is not None, "Founders Lounge missing from /api/groups list"
            assert uid in (g.get("members") or []), f"/api/groups missing user in FL members: {g.get('members')}"

            # User's groups list includes Founders Lounge id
            u_doc = mongo.users.find_one({"id": uid}, {"_id": 0, "groups": 1})
            assert fl["id"] in (u_doc.get("groups") or []), "Founders Lounge not in user.groups"

            # Founders Lounge coffee table: user is seated
            ft = mongo.tables.find_one({"name": "Founders Lounge", "founder_only": True}, {"_id": 0, "id": 1, "seated": 1})
            assert ft is not None, "Founders Lounge coffee table missing"
            assert uid in (ft.get("seated") or []), "user not seated at Founders Lounge table"

            # Second claim → 409
            r = api.post(f"{BASE_URL}/api/founders/claim", headers=headers)
            assert r.status_code == 409, f"expected 409 on 2nd claim, got {r.status_code}: {r.text}"
        finally:
            _cleanup_user(mongo, uid)


# -------- 3. Demo accounts can't claim --------

class TestDemoCannotClaim:
    def test_demo_login_then_claim_400(self, api):
        r = api.post(f"{BASE_URL}/api/auth/demo-login", json={"username": "frankie"})
        assert r.status_code == 200, r.text
        body = r.json()
        token = body["access_token"]
        is_founder_before = body["user"].get("is_founder")

        r = api.post(
            f"{BASE_URL}/api/founders/claim",
            headers={"Authorization": f"Bearer {token}"},
        )
        # Demo accounts → 400 (the endpoint short-circuits before the
        # already-a-founder check). If frankie somehow has is_founder=True
        # from prior testing, the API would return 409 — acceptable too
        # but the contract is 400 for demos.
        if is_founder_before:
            assert r.status_code in (400, 409), r.text
        else:
            assert r.status_code == 400, f"demo claim should 400, got {r.status_code}: {r.text}"


# -------- 4. /founders/status shape --------

class TestFoundersStatusShape:
    def test_status_returns_expected_keys(self, api):
        r = api.get(f"{BASE_URL}/api/founders/status")
        assert r.status_code == 200
        body = r.json()
        for k in ("cap", "taken", "remaining", "open"):
            assert k in body, f"missing key {k}: {body}"
        assert isinstance(body["cap"], int)
        assert isinstance(body["taken"], int)
        assert isinstance(body["remaining"], int)
        assert isinstance(body["open"], bool)
        assert body["remaining"] == max(0, body["cap"] - body["taken"])
        assert body["open"] == (body["taken"] < body["cap"])


# -------- 5. Unauthenticated /founders/claim → 401/403 --------

class TestClaimRequiresAuth:
    def test_no_token_rejected(self, api):
        r = api.post(f"{BASE_URL}/api/founders/claim")
        assert r.status_code in (401, 403), f"expected auth error, got {r.status_code}: {r.text}"
