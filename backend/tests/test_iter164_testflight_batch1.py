"""TestFlight Fix Batch 1 (Iteration 164) — backend regression tests.

Covers the two backend-observable fixes from Garry's TestFlight batch:

  P0 #2  Notice Board `POST /api/notices` still accepts posts WITH and
         WITHOUT the optional `image` field, and the response is a clean
         JSON envelope suitable for the composer's post-success flow.

  P1 #7  George's onboarding memory retention across logout/login. A
         fresh member whose signup wizard set `users.onboarding_completed`
         should be able to start an onboarding session, tell George
         "please call me testie", and on a subsequent `POST
         /mcgs/george/onboarding/start` receive the SAME `session_id`
         (i.e. resume, not a fresh session) with `known.preferred_name.value`
         still equal to "testie". Previously the over-aggressive
         `active_onboarding_session()` check treated onboarding_completed
         as invalidating the George session, silently wiping the
         member's remembered name.

  (Optional) Suburb no-matches endpoint sanity — the frontend
  "no matches" card only appears when `api.suburbsSearch("Zzz…")` returns
  an empty `results` array; this test just confirms that shape.
"""
from __future__ import annotations

import os
import uuid

import pytest
import pymongo
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def db():
    client = pymongo.MongoClient(MONGO_URL)
    return client[DB_NAME]


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def fresh_member(db, api_client):
    """Create a brand-new signup for the George onboarding memory test.

    We flip `onboarding_completed=True` afterwards (mimicking the signup
    wizard finishing) and leave `profile_complete=False` (George has
    NOT approved a profile yet). This is the exact scenario iter164's
    P1 #7 fix targets.
    """
    suffix = uuid.uuid4().hex[:8]
    username = f"TEST_iter164_{suffix}"
    payload = {
        "username": username,
        "password": "TestPass2026!",
        "email": f"TEST_iter164_{suffix}@example.com",
        "first_name": "TestieBatch1",
    }
    r = api_client.post(f"{API}/auth/signup", json=payload, timeout=20)
    assert r.status_code == 200, f"signup failed: {r.status_code} {r.text}"
    body = r.json()
    token = body["access_token"]
    user_id = body["user"]["id"]

    # Simulate the signup wizard completing.
    db.users.update_one(
        {"id": user_id},
        {"$set": {"onboarding_completed": True, "profile_complete": False}},
    )
    yield {"user_id": user_id, "token": token, "username": username}

    # Cleanup — best effort.
    try:
        db.users.delete_one({"id": user_id})
        db.george_onboarding_conversations.delete_many({"actor_id": user_id})
    except Exception:
        pass


@pytest.fixture(scope="module")
def member_first_auth(api_client):
    """Existing seeded member (Alex) for the notices smoke test."""
    r = api_client.post(
        f"{API}/auth/login",
        json={"username": "member_first", "password": "TestPass2026!"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    return {"token": body["access_token"], "user_id": body["user"]["id"], "user": body["user"]}


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------------------------------------------------------------------------
# P0 #2 — Notice Board with & without image
# ---------------------------------------------------------------------------

class TestNoticesImageAcceptance:
    def test_post_notice_without_image(self, api_client, member_first_auth, db):
        payload = {
            "user_id": member_first_auth["user_id"],
            "user_name": "TEST_iter164",
            "avatar": "🧪",
            "title": "TEST_iter164 no photo",
            "body": "Batch 1 verification post — no photo attached.",
            "category": "Announcement",
        }
        r = api_client.post(f"{API}/notices", json=payload, timeout=20)
        assert r.status_code == 200, f"POST /notices no-image failed: {r.status_code} {r.text}"
        body = r.json()
        assert "id" in body, body
        assert body.get("title") == payload["title"], body
        assert body.get("image", "") == "", f"image should default to empty string, got {body.get('image')!r}"
        assert "_id" not in body, "MongoDB _id must not leak in response"
        # Cleanup
        db.notices.delete_one({"id": body["id"]})

    def test_post_notice_with_gallery_image(self, api_client, member_first_auth, db):
        payload = {
            "user_id": member_first_auth["user_id"],
            "user_name": "TEST_iter164",
            "avatar": "🧪",
            "title": "TEST_iter164 with photo",
            "body": "Batch 1 verification post — with a gallery photo.",
            "category": "Community",
            "image": "gallery:coffee-catchups/01",
        }
        r = api_client.post(f"{API}/notices", json=payload, timeout=20)
        assert r.status_code == 200, f"POST /notices with-image failed: {r.status_code} {r.text}"
        body = r.json()
        assert body.get("image") == "gallery:coffee-catchups/01", body
        assert "_id" not in body
        # GET verification — the created notice should be persisted.
        r2 = api_client.get(
            f"{API}/notices",
            params={"user_id": member_first_auth["user_id"], "q": "TEST_iter164 with photo"},
            timeout=20,
        )
        assert r2.status_code == 200, r2.text
        found = [n for n in r2.json() if n.get("id") == body["id"]]
        assert found, "notice with image not found in list"
        assert found[0].get("image") == "gallery:coffee-catchups/01"
        # Cleanup
        db.notices.delete_one({"id": body["id"]})


# ---------------------------------------------------------------------------
# P1 #7 — George onboarding memory retention across logout/login
# ---------------------------------------------------------------------------

class TestGeorgeOnboardingMemoryRetention:
    """Simulates the exact iPad flow Garry reported:
       fresh member → signup wizard sets onboarding_completed → George
       start → "please call me testie" → later start → same session
       returned with `preferred_name.value == "testie"`.
    """

    def test_start_then_turn_then_start_returns_same_session_with_name(
        self, api_client, fresh_member, db,
    ):
        headers = _auth(fresh_member["token"])

        # 1. First start — creates a new session.
        r = api_client.post(f"{API}/mcgs/george/onboarding/start", headers=headers, timeout=45)
        assert r.status_code == 200, f"start 1 failed: {r.status_code} {r.text}"
        session1 = r.json()
        assert session1.get("session_id"), session1
        sid1 = session1["session_id"]
        assert session1.get("status") in ("in_progress", "drafted"), session1

        # 2. Send a turn saying "please call me testie"
        r = api_client.post(
            f"{API}/mcgs/george/onboarding/session/{sid1}/turn",
            headers=headers,
            json={"text": "please call me testie"},
            timeout=60,
        )
        assert r.status_code == 200, f"turn failed: {r.status_code} {r.text}"
        after_turn = r.json()
        known_after = (after_turn.get("known") or {})
        preferred_after = (known_after.get("preferred_name") or {}) if isinstance(known_after.get("preferred_name"), dict) else {}
        preferred_val = str(preferred_after.get("value") or "").strip().lower()
        assert "testie" in preferred_val, (
            "expected preferred_name.value to capture 'testie' after the turn — "
            f"got known={known_after!r}"
        )

        # 3. Belt-and-braces — assert onboarding_completed is still True on
        # the user (i.e. this really is the scenario the bug covers).
        u = db.users.find_one({"id": fresh_member["user_id"]}, {"_id": 0, "onboarding_completed": 1, "profile_complete": 1})
        assert u and u.get("onboarding_completed") is True
        assert u.get("profile_complete") is not True, (
            "profile_complete must remain False for this test to be meaningful; "
            "only /george/onboarding/session/{id}/approve should flip it."
        )

        # 4. Second start — MUST resume, not spin up a new session.
        r = api_client.post(f"{API}/mcgs/george/onboarding/start", headers=headers, timeout=45)
        assert r.status_code == 200, f"start 2 failed: {r.status_code} {r.text}"
        session2 = r.json()
        sid2 = session2.get("session_id")
        assert sid2, session2

        # ── The critical assertion for P1 #7 ─────────────────────────
        assert sid2 == sid1, (
            "Regression: onboarding session was RE-CREATED across a fresh "
            "start call even though profile_complete=False. The iter164 fix "
            "in services/george/onboarding/service.py::active_onboarding_session "
            "must ignore onboarding_completed and only honour profile_complete.\n"
            f"  first  session_id: {sid1}\n  second session_id: {sid2}"
        )

        known_final = session2.get("known") or {}
        pn = known_final.get("preferred_name") or {}
        assert isinstance(pn, dict), f"preferred_name should be an object, got: {pn!r}"
        val = str(pn.get("value") or "").strip().lower()
        assert "testie" in val, (
            "Regression: preferred_name was lost on resume. Expected 'testie', "
            f"got {pn!r}. Full known={known_final!r}"
        )

    def test_profile_complete_true_still_invalidates(self, api_client, db):
        """Belt-and-braces: profile_complete=True MUST still invalidate a
        stale in_progress session. If it doesn't, an approved member could
        get bounced back into onboarding — the exact iter142 regression."""
        # Fresh sacrificial user.
        suffix = uuid.uuid4().hex[:8]
        username = f"TEST_iter164_pc_{suffix}"
        payload = {
            "username": username,
            "password": "TestPass2026!",
            "email": f"TEST_iter164_pc_{suffix}@example.com",
            "first_name": "TestPC",
        }
        r = api_client.post(f"{API}/auth/signup", json=payload, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        token = body["access_token"]
        user_id = body["user"]["id"]

        try:
            # Kick off a session.
            r = api_client.post(f"{API}/mcgs/george/onboarding/start", headers=_auth(token), timeout=45)
            assert r.status_code == 200, r.text
            sid = r.json()["session_id"]

            # Simulate approve_onboarding flipping profile_complete=True.
            db.users.update_one({"id": user_id}, {"$set": {"profile_complete": True}})

            # Next start should return a BRAND NEW session (or at least
            # not the stale one). We assert the returned session_id
            # differs from `sid`.
            r = api_client.post(f"{API}/mcgs/george/onboarding/start", headers=_auth(token), timeout=45)
            assert r.status_code == 200, r.text
            sid2 = r.json()["session_id"]
            assert sid2 != sid, (
                "profile_complete=True must invalidate stale sessions — got same id back."
            )

            # Stale session should have been cancelled.
            stale = db.george_onboarding_conversations.find_one({"session_id": sid}, {"_id": 0, "status": 1, "cancel_reason": 1})
            assert stale is not None
            assert stale.get("status") == "cancelled", stale
            assert stale.get("cancel_reason") == "stale_after_profile_complete", stale
        finally:
            db.users.delete_one({"id": user_id})
            db.george_onboarding_conversations.delete_many({"actor_id": user_id})


# ---------------------------------------------------------------------------
# P1 #6 — Suburb search returns empty results for gibberish, unlocking the
# SuburbField "We don't have that suburb yet" UI state.
# ---------------------------------------------------------------------------

class TestSuburbNoMatches:
    def test_gibberish_returns_empty_results(self, api_client):
        r = api_client.get(f"{API}/suburbs/search", params={"q": "Zzznotarealsuburb"}, timeout=15)
        # Endpoint should exist and return a dict with a `results` array.
        assert r.status_code == 200, f"suburbs search failed: {r.status_code} {r.text}"
        body = r.json()
        assert "results" in body, f"expected 'results' key, got: {body!r}"
        assert body["results"] == [], f"expected empty results for gibberish, got: {body['results']!r}"
