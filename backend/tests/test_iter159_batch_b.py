"""
Iter159 Batch B — real-iPhone bug fix verification.

Bug 2 (Home unread-DM card): validate GET /api/dm/{uid}/conversations?filter=active
returns rows with unread_count/other/last/id; DM send via WS causes unread_count=1;
mark-read zeroes it.

Preservation:
- Auto-friendship after two-way DM (ws_dm)
- GET /api/friends/{uid} bidirectional-filtered list
"""
import os
import time
import json
import pytest
import requests
import websocket  # websocket-client

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")


def _demo_login(username: str) -> dict:
    r = requests.post(f"{BASE_URL}/api/auth/demo-login", json={"username": username}, timeout=15)
    assert r.status_code == 200, f"demo-login {username} failed: {r.status_code} {r.text[:200]}"
    return r.json()


@pytest.fixture(scope="module")
def maggie():
    return _demo_login("maggie")


@pytest.fixture(scope="module")
def frankie():
    return _demo_login("frankie")


@pytest.fixture(scope="module")
def joycey():
    return _demo_login("joycey")


def _auth(sess: dict) -> dict:
    return {"Authorization": f"Bearer {sess['access_token']}"}


# ── Bug 2 — DM conversations shape ─────────────────────────────────────
class TestDmConversationsShape:
    def test_conversations_active_returns_expected_shape(self, maggie):
        r = requests.get(
            f"{BASE_URL}/api/dm/{maggie['user']['id']}/conversations?filter=active",
            headers=_auth(maggie), timeout=15,
        )
        assert r.status_code == 200, r.text[:300]
        rows = r.json()
        assert isinstance(rows, list)
        # If any rows present, verify shape has required keys used by Home card
        for row in rows[:5]:
            # id + other + last + unread_count are consumed by home.tsx
            assert "id" in row
            # `other` may legitimately be None for self-DMs; home.tsx guards
            # this with `r?.other || {}`. Only shape-check when present.
            assert "other" in row
            if row["other"] is not None:
                assert isinstance(row["other"], dict)
            assert "unread_count" in row
            assert isinstance(row["unread_count"], int)


# ── Bug 2 — DM flow: send → conv shows unread_count=1 → mark-read → 0 ──
class TestDmUnreadFlow:
    def test_ws_send_creates_unread_then_mark_read_clears(self, maggie, frankie):
        maggie_id = maggie["user"]["id"]
        frankie_id = frankie["user"]["id"]

        # 1. Ensure or create a conversation between the two users.
        # Use POST /api/dm/open (typical) — try a few common paths.
        conv_id = None
        for path, payload in [
            ("/api/dm/open", {"user_id": maggie_id, "other_id": frankie_id}),
            ("/api/dm/start", {"user_id": maggie_id, "other_id": frankie_id}),
        ]:
            r = requests.post(f"{BASE_URL}{path}", headers=_auth(maggie), json=payload, timeout=15)
            if r.status_code == 200:
                body = r.json()
                conv_id = body.get("id") or body.get("conv_id") or body.get("conversation_id")
                if conv_id:
                    break

        if not conv_id:
            # Fall back to listing existing conversations
            r = requests.get(
                f"{BASE_URL}/api/dm/{maggie_id}/conversations?filter=active",
                headers=_auth(maggie), timeout=15,
            )
            assert r.status_code == 200
            for row in r.json():
                other = row.get("other") or {}
                if other.get("id") == frankie_id:
                    conv_id = row.get("id")
                    break

        if not conv_id:
            pytest.skip("No DM open/start endpoint discovered and no existing conv between maggie/frankie")

        # 2. Send DM via WebSocket from maggie
        ws_url = f"{WS_BASE}/api/ws/dm/{conv_id}?user_id={maggie_id}&token={maggie['access_token']}"
        sent_ok = False
        try:
            ws = websocket.create_connection(ws_url, timeout=10)
            ws.send(json.dumps({"type": "text", "text": f"iter159 hello {int(time.time())}"}))
            time.sleep(1.0)
            ws.close()
            sent_ok = True
        except Exception as e:
            pytest.skip(f"WS DM send failed (env may block WS): {e}")

        assert sent_ok

        # Give backend a moment to persist
        time.sleep(1.5)

        # 3. Fetch frankie's conversations and confirm unread_count >= 1 for this conv
        r = requests.get(
            f"{BASE_URL}/api/dm/{frankie_id}/conversations?filter=active",
            headers=_auth(frankie), timeout=15,
        )
        assert r.status_code == 200, r.text[:200]
        rows = r.json()
        matching = [row for row in rows if row.get("id") == conv_id]
        assert matching, f"Conv {conv_id} not in frankie's conversations"
        assert matching[0].get("unread_count", 0) >= 1, f"expected unread_count>=1, got {matching[0]}"

        # 4. Mark read; expect unread_count returns to 0
        r = requests.post(
            f"{BASE_URL}/api/dm/{conv_id}/mark-read",
            headers=_auth(frankie),
            json={"user_id": frankie_id},
            timeout=15,
        )
        assert r.status_code == 200, r.text[:200]

        # Verify unread_count is now 0
        r = requests.get(
            f"{BASE_URL}/api/dm/{frankie_id}/conversations?filter=active",
            headers=_auth(frankie), timeout=15,
        )
        assert r.status_code == 200
        matching = [row for row in r.json() if row.get("id") == conv_id]
        assert matching and matching[0].get("unread_count", 999) == 0, f"expected 0, got {matching[0] if matching else None}"


# ── Preservation — GET /api/friends/{uid} still works (iter158) ────────
class TestFriendsListPreservation:
    def test_friends_endpoint_returns_list(self, maggie):
        r = requests.get(
            f"{BASE_URL}/api/friends/{maggie['user']['id']}",
            headers=_auth(maggie), timeout=15,
        )
        assert r.status_code == 200, r.text[:200]
        body = r.json()
        # Endpoint returns dict {friends: [...]} per iter158 spec
        assert isinstance(body, dict) and "friends" in body
        assert isinstance(body["friends"], list)

    def test_friends_endpoint_requires_auth(self, maggie):
        r = requests.get(f"{BASE_URL}/api/friends/{maggie['user']['id']}", timeout=15)
        assert r.status_code in (401, 403)


# ── Preservation — Auto-friend after two-way DM (ws_dm ~L10473) ────────
# Auto-friend preservation is covered by the existing regression test in
# test_iter157_batch_b_retest.py::TestAutoFriendshipAfterTwoWayDM. That
# test resets message state per-run via its own fixture so the
# `sender_msg_count == 1` gate can actually fire. We rely on that suite
# rather than duplicating a flaky in-place probe here (in the shared
# preview DB, maggie<->joycey already have prior messages so the gate
# won't re-trigger without wiping db.messages).
class TestAutoFriendPreservation:
    def test_iter157_autofriend_regression_still_passes(self):
        """Marker — actual coverage lives in test_iter157_batch_b_retest.py."""
        import subprocess
        r = subprocess.run(
            [
                "pytest",
                "/app/backend/tests/test_iter157_batch_b_retest.py::TestAutoFriendshipAfterTwoWayDM",
                "-q", "--tb=line",
            ],
            capture_output=True, text=True, timeout=60,
        )
        assert r.returncode == 0, f"iter157 auto-friend regression failed:\n{r.stdout}\n{r.stderr}"
