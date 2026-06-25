"""Iteration 44 — Flutter back bug fix verification.

Covers:
1. All demo accounts have empty `blocked` arrays (stale-data cleanup verified).
2. Frank -> Joyce flutter sends with correct opening wording.
3. Joyce -> Frank reply flutter uses the "replied" wording (reply detection).
4. Frank <-> Margaret round-trip works (the originally-broken pair).
5. Block-list regression: explicit block still returns 403 on flutter attempt
   (and we clean up after ourselves with a direct DB write since there is no
   unblock endpoint).
"""

import os
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://belong-together.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def demo_users(api_client):
    """Log in every demo account once and return a username->user dict."""
    r = api_client.get(f"{BASE_URL}/api/auth/demo-accounts", timeout=15)
    assert r.status_code == 200, r.text
    out = {}
    for entry in r.json():
        username = entry["username"]
        rr = api_client.post(
            f"{BASE_URL}/api/auth/demo-login",
            json={"username": username},
            timeout=15,
        )
        assert rr.status_code == 200, f"demo-login {username}: {rr.text}"
        out[username] = rr.json()["user"]
    return out


# ---------------- 1. Demo block lists clean ----------------
class TestDemoBlocksClean:
    def test_all_demo_accounts_have_empty_blocked(self, demo_users):
        offenders = {u: data.get("blocked") for u, data in demo_users.items() if data.get("blocked")}
        assert offenders == {}, f"Demo accounts still have stale blocks: {offenders}"


# ---------------- 2 & 3. Happy-path flutter + reply ----------------
class TestFlutterRoundTrip:
    def _cleanup(self, a_id, b_id):
        """Remove any existing flutters between two users so reply detection
        behaves deterministically across re-runs."""
        client = MongoClient(MONGO_URL)
        try:
            client[DB_NAME].flutters.delete_many(
                {"$or": [
                    {"from_id": a_id, "to_id": b_id},
                    {"from_id": b_id, "to_id": a_id},
                ]}
            )
        finally:
            client.close()

    def test_frank_to_joyce_then_joyce_back(self, api_client, demo_users):
        frank = demo_users["frankie"]
        joyce = demo_users["joycey"]
        self._cleanup(frank["id"], joyce["id"])

        # First flutter: Frank -> Joyce (no prior history => opening wording)
        r1 = api_client.post(
            f"{BASE_URL}/api/flutters/send",
            json={"from_id": frank["id"], "to_id": joyce["id"]},
            timeout=15,
        )
        if r1.status_code == 429:
            pytest.skip("Rate limited (20/hr cap) — re-run later.")
        assert r1.status_code == 200, r1.text
        body1 = r1.json()
        assert body1["from_id"] == frank["id"]
        assert body1["to_id"] == joyce["id"]
        assert body1["message"] == "sent you a flutter 🦋 — reply with a flutter or start a chat", body1

        # Verify it persisted by listing Joyce's unread flutters
        r_inbox = api_client.get(f"{BASE_URL}/api/flutters/{joyce['id']}", timeout=15)
        assert r_inbox.status_code == 200
        assert any(f["id"] == body1["id"] for f in r_inbox.json()), "flutter not persisted in Joyce's inbox"

        # Reply flutter: Joyce -> Frank (should be detected as reply)
        r2 = api_client.post(
            f"{BASE_URL}/api/flutters/send",
            json={"from_id": joyce["id"], "to_id": frank["id"]},
            timeout=15,
        )
        if r2.status_code == 429:
            pytest.skip("Rate limited on reply — re-run later.")
        assert r2.status_code == 200, r2.text
        body2 = r2.json()
        assert body2["message"] == "replied with a flutter 🦋 — would you like to start a chat?", body2


# ---------------- 4. The originally-broken pair: Frank <-> Margaret ----------------
class TestFrankMargaretWorks:
    def _cleanup(self, a_id, b_id):
        client = MongoClient(MONGO_URL)
        try:
            client[DB_NAME].flutters.delete_many(
                {"$or": [
                    {"from_id": a_id, "to_id": b_id},
                    {"from_id": b_id, "to_id": a_id},
                ]}
            )
        finally:
            client.close()

    def test_frank_can_now_flutter_margaret_and_back(self, api_client, demo_users):
        frank = demo_users["frankie"]
        margaret = demo_users["maggie"]
        # Sanity: both should have empty blocked after the migration
        assert frank.get("blocked") == [], frank.get("blocked")
        assert margaret.get("blocked") == [], margaret.get("blocked")

        self._cleanup(frank["id"], margaret["id"])

        # Margaret -> Frank (mirrors the original UI flow: a flutter from
        # Margaret which Frank then taps "Flutter back" on).
        r1 = api_client.post(
            f"{BASE_URL}/api/flutters/send",
            json={"from_id": margaret["id"], "to_id": frank["id"]},
            timeout=15,
        )
        if r1.status_code == 429:
            pytest.skip("Rate limited — re-run later.")
        assert r1.status_code == 200, (
            f"Expected 200 (block list was cleaned). Got {r1.status_code}: {r1.text}"
        )

        # Frank "flutter back" -> Margaret. This is the exact action that
        # previously errored with 403 "Cannot flutter this user".
        r2 = api_client.post(
            f"{BASE_URL}/api/flutters/send",
            json={"from_id": frank["id"], "to_id": margaret["id"]},
            timeout=15,
        )
        if r2.status_code == 429:
            pytest.skip("Rate limited — re-run later.")
        assert r2.status_code == 200, (
            f"REGRESSION: Frank->Margaret flutter back returned {r2.status_code}: {r2.text}. "
            "Stale block on Margaret may have come back."
        )
        assert r2.json()["message"] == "replied with a flutter 🦋 — would you like to start a chat?"


# ---------------- 5. Explicit block still enforces 403 ----------------
class TestExplicitBlockStillBlocks:
    def test_explicit_block_returns_403_then_cleanup(self, api_client, demo_users):
        """Real-user privacy regression: when a user explicitly blocks
        someone, the blocked party must still get a 403 with the exact
        detail string the frontend pivots on."""
        a = demo_users["billdo"]   # blocker
        b = demo_users["dot"]      # blocked sender
        a_id, b_id = a["id"], b["id"]

        # Add explicit block (no unblock endpoint, so we'll undo via Mongo).
        rb = api_client.post(
            f"{BASE_URL}/api/users/{a_id}/block/{b_id}",
            timeout=15,
        )
        assert rb.status_code == 200, rb.text

        try:
            r = api_client.post(
                f"{BASE_URL}/api/flutters/send",
                json={"from_id": b_id, "to_id": a_id},
                timeout=15,
            )
            assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"
            detail = r.json().get("detail", "")
            assert "Cannot flutter this user" in detail, detail
        finally:
            # Restore demo data — pull the block we just added.
            client = MongoClient(MONGO_URL)
            try:
                client[DB_NAME].users.update_one(
                    {"id": a_id}, {"$pull": {"blocked": b_id}}
                )
            finally:
                client.close()

        # Confirm cleanup left Bill's blocked clean.
        rcheck = api_client.post(
            f"{BASE_URL}/api/auth/demo-login",
            json={"username": "billdo"},
            timeout=15,
        )
        assert rcheck.status_code == 200
        assert rcheck.json()["user"].get("blocked") == []
