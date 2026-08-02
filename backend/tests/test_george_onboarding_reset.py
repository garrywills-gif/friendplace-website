"""Backend tests for George onboarding 'Clear chat' reset endpoint.

Verifies POST /api/mcgs/george/onboarding/session/{session_id}/reset:
  - Happy path: cancels old session, spins up a fresh one starting with
    George's opening greeting and empty known.
  - Old session is marked status=cancelled + cancel_reason=cleared_by_member.
  - users.george_profile is preserved (unchanged) across the reset.
  - 403 when a different actor tries to reset someone else's session.
  - 404 when session_id doesn't exist.
"""
from __future__ import annotations

import os
import time
import uuid

import pytest
import pymongo
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

MEMBER_USERNAME = "member_first"
MEMBER_PASSWORD = "TestPass2026!"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


@pytest.fixture(scope="module")
def db():
    client = pymongo.MongoClient(MONGO_URL)
    return client[DB_NAME]


@pytest.fixture(scope="module")
def member_auth():
    """Log in as member_first and return {token, user_id}."""
    r = requests.post(
        f"{API}/auth/login",
        json={"username": MEMBER_USERNAME, "password": MEMBER_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    body = r.json()
    return {"token": body["access_token"], "user_id": body["user"]["id"]}


@pytest.fixture(scope="module")
def demo_frankie():
    """A demo account we can use as a distinct actor for the 403 test."""
    r = requests.post(f"{API}/auth/demo-login", json={"username": "frankie"}, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    return {"token": body["access_token"], "user_id": body["user"]["id"]}


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


class TestOnboardingReset:
    """POST /mcgs/george/onboarding/session/{session_id}/reset"""

    def test_reset_happy_path_preserves_profile(self, member_auth, db):
        # --- SEED: place a well-known george_profile on the user so we
        # can prove reset does NOT touch it.
        sentinel_profile = {
            "preferred_name": {"value": "TEST_Alex_Sentinel", "source": "stated"},
            "area": {"value": "TEST_SentinelBurb", "source": "stated"},
        }
        db.users.update_one(
            {"id": member_auth["user_id"]},
            {"$set": {"george_profile": sentinel_profile, "profile_complete": False}},
        )
        before_user = db.users.find_one({"id": member_auth["user_id"]}, {"_id": 0, "george_profile": 1})
        assert before_user["george_profile"] == sentinel_profile

        # --- START a fresh onboarding conversation.
        r = requests.post(f"{API}/mcgs/george/onboarding/start", headers=_headers(member_auth["token"]), timeout=30)
        assert r.status_code == 200, f"start failed: {r.status_code} {r.text}"
        session1 = r.json()
        assert session1.get("session_id"), session1
        assert session1.get("status") in ("in_progress", "drafted"), session1
        turns1 = session1.get("turns") or []
        assert len(turns1) >= 1
        opening_greeting = turns1[0].get("content") or ""
        assert opening_greeting.strip(), "opening greeting should not be empty"
        # Confirm George is speaking first.
        assert turns1[0].get("role") == "george"

        # --- Send 1 user turn to grow the transcript.
        r = requests.post(
            f"{API}/mcgs/george/onboarding/session/{session1['session_id']}/turn",
            headers=_headers(member_auth["token"]),
            json={"text": "You can call me Alex, thanks."},
            timeout=45,
        )
        assert r.status_code == 200, f"turn failed: {r.status_code} {r.text}"
        after_turn = r.json()
        assert len(after_turn.get("turns") or []) >= 3, after_turn.get("turns")

        # --- RESET the conversation.
        r = requests.post(
            f"{API}/mcgs/george/onboarding/session/{session1['session_id']}/reset",
            headers=_headers(member_auth["token"]),
            timeout=45,
        )
        assert r.status_code == 200, f"reset failed: {r.status_code} {r.text}"
        session2 = r.json()

        # New session_id, distinct from the original.
        assert session2.get("session_id"), session2
        assert session2["session_id"] != session1["session_id"], "reset must return a NEW session_id"

        # Fresh state: known empty, status in_progress, turns start with George.
        assert session2.get("known") in ({}, None) or session2["known"] == {}
        assert session2.get("status") == "in_progress", session2
        new_turns = session2.get("turns") or []
        assert len(new_turns) == 1, f"expected exactly one opening greeting, got {new_turns}"
        assert new_turns[0].get("role") == "george"
        assert (new_turns[0].get("content") or "").strip(), "greeting text present"
        # skipped should be reset too
        assert session2.get("skipped") in ([], None) or session2["skipped"] == []

        # --- Old session must be marked cancelled with reason=cleared_by_member.
        old_doc = db.george_onboarding_conversations.find_one(
            {"session_id": session1["session_id"]}
        )
        assert old_doc is not None, "old session doc should still exist"
        assert old_doc.get("status") == "cancelled", old_doc.get("status")
        assert old_doc.get("cancel_reason") == "cleared_by_member", old_doc.get("cancel_reason")

        # --- CRITICAL: user's george_profile must be untouched.
        after_user = db.users.find_one({"id": member_auth["user_id"]}, {"_id": 0, "george_profile": 1})
        assert after_user["george_profile"] == sentinel_profile, (
            f"george_profile was modified by reset! before={sentinel_profile} after={after_user.get('george_profile')}"
        )

    def test_reset_404_when_session_missing(self, member_auth):
        bogus = f"nope-{uuid.uuid4().hex}"
        r = requests.post(
            f"{API}/mcgs/george/onboarding/session/{bogus}/reset",
            headers=_headers(member_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 404, f"expected 404, got {r.status_code} {r.text}"

    def test_reset_403_when_not_owner(self, member_auth, demo_frankie):
        # member_first starts a session; frankie tries to reset it.
        r = requests.post(
            f"{API}/mcgs/george/onboarding/start",
            headers=_headers(member_auth["token"]),
            timeout=30,
        )
        assert r.status_code == 200, r.text
        session = r.json()
        sid = session["session_id"]

        r2 = requests.post(
            f"{API}/mcgs/george/onboarding/session/{sid}/reset",
            headers=_headers(demo_frankie["token"]),
            timeout=15,
        )
        assert r2.status_code == 403, f"expected 403 for cross-actor, got {r2.status_code} {r2.text}"
