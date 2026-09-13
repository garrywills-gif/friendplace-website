"""
Iter160 Batch B — Offline DM Home card RCA verification.

Reproduce the exact scenario the user hit on real iPhone:
 1. Demo-login maggie + frankie.
 2. POST /api/dm/start (frankie -> maggie).
 3. Open WS as FRANKIE ONLY (maggie has no WS connection = "offline").
 4. Send `{"text": "..."}` via WS.
 5. Close WS.
 6. As maggie: GET /api/dm/{maggie.id}/conversations?filter=active.
 7. Assert target conv appears in the response array.
 8. Assert unread_count > 0 on that row.
 9. Assert archived_for / hidden_for do NOT contain maggie.id.
10. Assert other.first_name == "Frank" (Home card row label).

Also prints the raw response body of the maggie-side conversations call so
the main agent can eyeball the exact payload the Home screen is filtering on.
"""
import json
import os
import time

import pytest
import requests
import websocket  # websocket-client

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")


def _demo_login(username: str) -> dict:
    r = requests.post(
        f"{BASE_URL}/api/auth/demo-login",
        json={"username": username},
        timeout=15,
    )
    assert r.status_code == 200, f"demo-login {username} failed: {r.status_code} {r.text[:300]}"
    return r.json()


def _auth(sess: dict) -> dict:
    return {"Authorization": f"Bearer {sess['access_token']}"}


@pytest.fixture(scope="module")
def maggie():
    return _demo_login("maggie")


@pytest.fixture(scope="module")
def frankie():
    return _demo_login("frankie")


class TestOfflineDmHomeCard:
    """End-to-end repro of the offline-arrival Home card bug."""

    def test_offline_dm_appears_in_maggie_active_conversations(self, maggie, frankie):
        maggie_id = maggie["user"]["id"]
        frankie_id = frankie["user"]["id"]

        # 1-2. Frankie starts a DM with Maggie.
        conv_id = None
        for path in ("/api/dm/start", "/api/dm/open"):
            r = requests.post(
                f"{BASE_URL}{path}",
                headers=_auth(frankie),
                json={"user_id": frankie_id, "other_id": maggie_id},
                timeout=15,
            )
            if r.status_code == 200:
                body = r.json()
                conv_id = body.get("id") or body.get("conv_id") or body.get("conversation_id")
                if conv_id:
                    print(f"[iter160] conv started via {path}: id={conv_id}")
                    break

        assert conv_id, "Could not obtain conversation id from /dm/start or /dm/open"

        # 3-5. Open WS as FRANKIE ONLY (maggie has NO WS = offline scenario),
        # send a text message, then close.
        ws_url = f"{WS_BASE}/api/ws/dm/{conv_id}?user_id={frankie_id}&token={frankie['access_token']}"
        payload_text = f"iter160 offline hi maggie {int(time.time())}"
        try:
            ws = websocket.create_connection(ws_url, timeout=10)
            ws.send(json.dumps({"text": payload_text}))
            time.sleep(1.0)
            ws.close()
            print(f"[iter160] frankie WS sent: {payload_text!r}")
        except Exception as e:
            pytest.skip(f"WS DM send failed (env may block WS): {e}")

        # Give the backend a beat to persist the message + increment unread.
        time.sleep(1.5)

        # 6. As maggie: fetch active conversations.
        r = requests.get(
            f"{BASE_URL}/api/dm/{maggie_id}/conversations?filter=active",
            headers=_auth(maggie),
            timeout=15,
        )
        assert r.status_code == 200, r.text[:400]
        rows = r.json()
        assert isinstance(rows, list), f"expected list, got {type(rows).__name__}"

        # Print raw payload for the main agent so they can see exactly what
        # Home is filtering on.
        target = next((row for row in rows if row.get("id") == conv_id), None)
        print("\n[iter160] RAW maggie /conversations?filter=active row for target conv:")
        print(json.dumps(target, indent=2, default=str))

        # 7. Assert target conv appears.
        assert target is not None, (
            f"Conv {conv_id} not in maggie's active conversations. "
            f"Rows returned: {len(rows)}"
        )

        # 8. Assert unread_count > 0.
        assert isinstance(target.get("unread_count"), int), (
            f"unread_count missing or not int on row: {target}"
        )
        assert target["unread_count"] > 0, (
            f"Expected unread_count > 0 (offline msg unread), got {target['unread_count']}"
        )

        # 9. Assert archived_for/hidden_for do NOT contain maggie.id (row would
        # be filtered out of "active" by home.tsx otherwise).
        archived_for = target.get("archived_for") or []
        hidden_for = target.get("hidden_for") or []
        assert maggie_id not in archived_for, f"maggie in archived_for: {archived_for}"
        assert maggie_id not in hidden_for, f"maggie in hidden_for: {hidden_for}"

        # 10. Assert other.first_name == "Frank" (so the Home card row has a
        # human-readable label).
        other = target.get("other") or {}
        assert other.get("first_name") == "Frank", (
            f"expected other.first_name == 'Frank', got {other!r}"
        )

        # Bonus: verify the last-message text made it through so the card
        # subtitle (`r.last.text`) will render.
        last = target.get("last") or {}
        assert last.get("text"), f"last.text missing/empty on row: {target}"

        print(
            f"[iter160] PASS — conv={conv_id} unread={target['unread_count']} "
            f"other.first_name={other.get('first_name')!r} last={last.get('text')!r}"
        )


# ── Preservation checks (must not regress) ─────────────────────────────
class TestPreservation:
    def test_friends_endpoint_still_returns_list(self, maggie):
        r = requests.get(
            f"{BASE_URL}/api/friends/{maggie['user']['id']}",
            headers=_auth(maggie),
            timeout=15,
        )
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert isinstance(body, dict) and "friends" in body
        assert isinstance(body["friends"], list)

    def test_conversations_shape_still_intact(self, maggie):
        r = requests.get(
            f"{BASE_URL}/api/dm/{maggie['user']['id']}/conversations?filter=active",
            headers=_auth(maggie),
            timeout=15,
        )
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        for row in rows[:5]:
            assert "id" in row
            assert "unread_count" in row
            assert isinstance(row["unread_count"], int)
            assert "other" in row  # may be None for self-DMs
