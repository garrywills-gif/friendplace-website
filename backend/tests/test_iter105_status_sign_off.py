"""
Iter 105 — Presence & Status sign-off endpoint (bug fix: admin still showing
🟢 online after logout, Garry 25 Jun 2026).

Covers:
  • POST /api/status/sign-off requires auth (401 unauthed).
  • After sign-off, db.member_status doc has last_seen_at back-dated ~10 min,
    manual_status=null, in_cafe_table_id=null.
  • /api/status/for-users returns 'offline' for the signed-off user.
  • Sign-off is idempotent (two calls in a row → same offline state).
  • Heartbeat re-activates the user (non-regression).
  • Manual status is cleared by sign-off (non-regression assertion).
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://iphone-retest-batch.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


# ─── Fixtures ────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def db():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


def _demo_login(username: str) -> dict:
    r = requests.post(f"{API}/auth/demo-login", json={"username": username}, timeout=15)
    assert r.status_code == 200, f"demo-login {username} failed: {r.status_code} {r.text}"
    j = r.json()
    assert "access_token" in j and "user" in j
    return j


@pytest.fixture(scope="module")
def maggie():
    return _demo_login("maggie")


@pytest.fixture(scope="module")
def alex_bearer():
    # Alex is a standard authenticated member used for observer calls.
    r = requests.post(
        f"{API}/auth/login",
        json={"username": "member@friendplace.com.au", "password": "TestPass2026!"},
        timeout=15,
    )
    if r.status_code != 200:
        pytest.skip(f"Alex login not available: {r.status_code} {r.text[:120]}")
    return r.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ─── Tests ───────────────────────────────────────────────────────────

class TestSignOffAuth:
    """POST /status/sign-off must reject unauthenticated calls."""

    def test_unauthed_returns_401(self):
        r = requests.post(f"{API}/status/sign-off", timeout=10)
        assert r.status_code == 401, f"expected 401, got {r.status_code} {r.text[:200]}"


class TestSignOffMutatesDb:
    """After sign-off the member_status doc is offline (past the 5-min threshold)."""

    def test_heartbeat_then_signoff_backdates_last_seen(self, maggie, db):
        token = maggie["access_token"]
        uid = maggie["user"]["id"]

        # 1) Warm the presence doc with a heartbeat so last_seen_at is fresh.
        hb = requests.post(f"{API}/status/heartbeat", headers=_auth(token), timeout=10)
        assert hb.status_code == 200

        # 2) Set a manual status so we can assert sign-off clears it.
        ms = requests.patch(
            f"{API}/status/me",
            headers=_auth(token),
            json={"manual_status": "happy"},
            timeout=10,
        )
        assert ms.status_code == 200
        assert ms.json().get("manual") == "happy"

        # 3) Sign off.
        so = requests.post(f"{API}/status/sign-off", headers=_auth(token), timeout=10)
        assert so.status_code == 200
        assert so.json() == {"ok": True}

        # 4) Direct-DB assertions.
        doc = db.member_status.find_one({"user_id": uid})
        assert doc is not None, "member_status doc missing after sign-off"
        assert doc.get("manual_status") is None
        assert doc.get("manual_status_set_at") is None
        assert doc.get("manual_status_expires_at") is None
        assert doc.get("in_cafe_table_id") is None

        # last_seen_at must be back-dated at least the offline threshold (5 min).
        last_seen = doc.get("last_seen_at")
        assert last_seen is not None
        if last_seen.tzinfo is None:
            last_seen = last_seen.replace(tzinfo=timezone.utc)
        age_sec = (datetime.now(timezone.utc) - last_seen).total_seconds()
        # Spec: back-dated ~10 min (600 s). Allow some slack for clock drift.
        assert age_sec >= 300, f"last_seen_at only {age_sec:.0f}s old — sign-off did not back-date past 5 min"
        assert age_sec >= 550, f"last_seen_at back-date only {age_sec:.0f}s — expected ~600s (10 min)"


class TestForUsersReturnsOffline:
    """Observers polling /status/for-users must see 'offline' for signed-off users."""

    def test_for_users_offline_after_signoff(self, maggie, alex_bearer):
        uid = maggie["user"]["id"]
        r = requests.get(
            f"{API}/status/for-users",
            headers=_auth(alex_bearer),
            params={"ids": uid},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        statuses = r.json().get("statuses", {})
        assert statuses.get(uid) == "offline", f"expected offline, got {statuses!r}"


class TestSignOffIdempotent:
    """Calling sign-off twice must not crash and must leave the record offline."""

    def test_double_signoff_still_offline(self, maggie, alex_bearer, db):
        token = maggie["access_token"]
        uid = maggie["user"]["id"]

        r1 = requests.post(f"{API}/status/sign-off", headers=_auth(token), timeout=10)
        r2 = requests.post(f"{API}/status/sign-off", headers=_auth(token), timeout=10)
        assert r1.status_code == 200 and r2.status_code == 200

        doc = db.member_status.find_one({"user_id": uid})
        assert doc is not None
        assert doc.get("manual_status") is None
        last_seen = doc.get("last_seen_at")
        if last_seen and last_seen.tzinfo is None:
            last_seen = last_seen.replace(tzinfo=timezone.utc)
        age_sec = (datetime.now(timezone.utc) - last_seen).total_seconds()
        assert age_sec >= 300

        # Observer POV.
        r = requests.get(
            f"{API}/status/for-users",
            headers=_auth(alex_bearer),
            params={"ids": uid},
            timeout=10,
        )
        assert r.json()["statuses"].get(uid) == "offline"


class TestHeartbeatRecovers:
    """Non-regression: after sign-off, a heartbeat flips the user back to 'online'."""

    def test_heartbeat_after_signoff_flips_online(self, maggie, alex_bearer):
        token = maggie["access_token"]
        uid = maggie["user"]["id"]

        # Ensure signed off first.
        requests.post(f"{API}/status/sign-off", headers=_auth(token), timeout=10)

        # Fresh heartbeat.
        hb = requests.post(f"{API}/status/heartbeat", headers=_auth(token), timeout=10)
        assert hb.status_code == 200

        r = requests.get(
            f"{API}/status/for-users",
            headers=_auth(alex_bearer),
            params={"ids": uid},
            timeout=10,
        )
        assert r.status_code == 200
        statuses = r.json().get("statuses", {})
        assert statuses.get(uid) == "online", f"expected online after heartbeat, got {statuses!r}"


class TestManualStatusPreSignOffCleared:
    """Non-regression: manual='happy' → sign-off → observer sees offline; manual cleared."""

    def test_manual_status_cleared_on_signoff(self, maggie, alex_bearer, db):
        token = maggie["access_token"]
        uid = maggie["user"]["id"]

        # Warm & set manual=happy.
        requests.post(f"{API}/status/heartbeat", headers=_auth(token), timeout=10)
        r = requests.patch(
            f"{API}/status/me",
            headers=_auth(token),
            json={"manual_status": "happy"},
            timeout=10,
        )
        assert r.status_code == 200 and r.json().get("manual") == "happy"

        # Observer should see 'happy' (or at least not offline) before sign-off.
        obs_pre = requests.get(
            f"{API}/status/for-users",
            headers=_auth(alex_bearer),
            params={"ids": uid},
            timeout=10,
        ).json()["statuses"].get(uid)
        assert obs_pre in ("happy", "looking", "busy", "online"), f"pre-signoff observer got {obs_pre!r}"

        # Sign off.
        so = requests.post(f"{API}/status/sign-off", headers=_auth(token), timeout=10)
        assert so.status_code == 200

        # Observer should now see offline.
        obs_post = requests.get(
            f"{API}/status/for-users",
            headers=_auth(alex_bearer),
            params={"ids": uid},
            timeout=10,
        ).json()["statuses"].get(uid)
        assert obs_post == "offline", f"post-signoff observer got {obs_post!r}"

        # DB confirms manual cleared.
        doc = db.member_status.find_one({"user_id": uid})
        assert doc.get("manual_status") is None
