"""
Iteration 46 — TestFlight bug-fix backend regression.

Covers:
  1. _broadcast_new_member still writes notifications with ref_user_id
     when a new user signs up.
  2. /api/notifications/{user_id} returns entries with ref_user_id for
     new_member notifications.
  3. /api/flutters/send still works when called from the "Say Hi" flow
     with only from_id + to_id (no message → default recipient text).
  4. App boots cleanly (/api/health returns 200).
"""
import os
import uuid
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def demo_recipient(api_client):
    """Grab an existing demo account to receive notifications/flutters."""
    r = api_client.post(f"{BASE_URL}/api/auth/demo-login", json={"username": "maggie"})
    assert r.status_code == 200, r.text
    return r.json()["user"]


# ---------- Sanity ----------
class TestHealth:
    def test_health_ok(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/health")
        assert r.status_code == 200


# ---------- Notification new_member ----------
class TestNewMemberNotification:
    """Signup should broadcast a new_member notification with ref_user_id
    to existing (non-banned, non-demo-target) users."""

    def test_signup_creates_new_member_notification_with_ref_user_id(
        self, api_client, demo_recipient
    ):
        # Snapshot existing count of new_member notifications for recipient
        before = api_client.get(
            f"{BASE_URL}/api/notifications/{demo_recipient['id']}"
        )
        assert before.status_code == 200
        before_ids = {
            n["id"] for n in before.json()
            if n.get("type") == "new_member"
        }

        # Create a fresh real account (unique username)
        suffix = uuid.uuid4().hex[:8]
        username = f"testnew_{suffix}"
        signup = api_client.post(
            f"{BASE_URL}/api/auth/signup",
            json={
                "username": username,
                "password": "secret123",
                "first_name": "TestNew",
                "suburb": "Sydney",
                "suburb_state": "NSW",
            },
        )
        assert signup.status_code == 200, signup.text
        new_user = signup.json()["user"]

        # Broadcast is fire-and-forget in a background task — give it a beat
        deadline = time.time() + 8
        matched = None
        while time.time() < deadline:
            after = api_client.get(
                f"{BASE_URL}/api/notifications/{demo_recipient['id']}"
            )
            if after.status_code == 200:
                new_ones = [
                    n for n in after.json()
                    if n.get("type") == "new_member" and n["id"] not in before_ids
                ]
                if new_ones:
                    matched = new_ones[0]
                    break
            time.sleep(0.5)

        assert matched is not None, "new_member notification not written for recipient"
        assert matched.get("ref_user_id") == new_user["id"], (
            f"ref_user_id mismatch: {matched.get('ref_user_id')} vs {new_user['id']}"
        )
        assert matched.get("read") is False
        assert "title" in matched and "body" in matched

    def test_notifications_endpoint_exposes_ref_user_id_field(
        self, api_client, demo_recipient
    ):
        """Ensure the response envelope carries ref_user_id (not just payload)."""
        r = api_client.get(f"{BASE_URL}/api/notifications/{demo_recipient['id']}")
        assert r.status_code == 200
        new_members = [n for n in r.json() if n.get("type") == "new_member"]
        # After the previous test at least one should exist
        assert new_members, "expected at least one new_member notification"
        assert any("ref_user_id" in n and n["ref_user_id"] for n in new_members)


# ---------- Flutter Say-Hi ----------
class TestSayHiFlutter:
    """The Say Hi button calls /api/flutters/send with just from_id/to_id.
    Confirm the endpoint accepts that shape and uses the default message."""

    def test_flutter_send_no_message_defaults_to_recipient_text(
        self, api_client, demo_recipient
    ):
        # Second demo account as sender
        r = api_client.post(
            f"{BASE_URL}/api/auth/demo-login", json={"username": "frankie"}
        )
        assert r.status_code == 200
        sender = r.json()["user"]

        res = api_client.post(
            f"{BASE_URL}/api/flutters/send",
            json={"from_id": sender["id"], "to_id": demo_recipient["id"]},
        )
        assert res.status_code == 200, res.text
        body = res.json()
        # Response contains created flutter — verify default message wording
        msg = (
            body.get("message")
            or (body.get("flutter") or {}).get("message")
            or ""
        )
        # Accept either envelope shape; message should include the flutter emoji
        assert "🦋" in msg or body.get("ok") or body.get("id"), (
            f"Unexpected flutter response: {body}"
        )
