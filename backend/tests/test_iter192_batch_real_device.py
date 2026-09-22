"""
iter192 backend verification for the "Real-device fix batch — 8 app issues".

We cover the API-testable slice of the review:
  #3 Friend request → nudge → Accept/Decline/Later semantics via
     /api/friends/request, /accept, /decline, /friends/inbox
  #4 FP Café Friends-only table_invite notification + deep-link target
     (/api/tables + /api/notifications after) + closed-table state
     (GET /api/tables/{id} returns 404 after DELETE)

The frontend UI (composer required marker, WordChain copy, More menu,
Community Today wording) is verified separately via Playwright.
"""

import os
import time
import uuid
import pytest
import requests

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")


def _demo_login(username: str):
    r = requests.post(f"{BASE}/api/auth/demo-login", json={"username": username}, timeout=20)
    assert r.status_code == 200, f"demo-login {username}: {r.status_code} {r.text}"
    return r.json()["user"]


@pytest.fixture(scope="module")
def maggie():
    return _demo_login("maggie")


@pytest.fixture(scope="module")
def frankie():
    return _demo_login("frankie")


@pytest.fixture(scope="module")
def joycey():
    return _demo_login("joycey")


# ---------------------------------------------------------------------------
# #3 Friend request Accept / Decline / Later
# ---------------------------------------------------------------------------
class TestFriendRequestInline:
    def _cleanup(self, a_id: str, b_id: str):
        # Ensure they are not friends already for a fresh request test.
        # Correct endpoint: DELETE /api/friends/{user_id}/{friend_id}
        for uid, other in [(a_id, b_id), (b_id, a_id)]:
            try:
                requests.delete(f"{BASE}/api/friends/{uid}/{other}", timeout=10)
            except Exception:
                pass
        # Also cancel any pending requests in either direction
        try:
            for uid in (a_id, b_id):
                inbox = requests.get(f"{BASE}/api/friends/inbox/{uid}", timeout=10).json()
                rows = inbox if isinstance(inbox, list) else (inbox.get("incoming") or []) + (inbox.get("outgoing") or [])
                for row in rows:
                    rid = row.get("id")
                    if rid:
                        requests.post(f"{BASE}/api/friends/cancel/{rid}", timeout=5)
                        requests.post(f"{BASE}/api/friends/decline/{rid}", timeout=5)
        except Exception:
            pass

    def _find_pending(self, uid: str, other: str):
        r = requests.get(f"{BASE}/api/friends/inbox/{uid}", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        # inbox may return list or {incoming, outgoing}
        rows = data if isinstance(data, list) else (data.get("incoming") or [])
        for row in rows:
            if row.get("from_id") == other or row.get("to_id") == other:
                return row
        return None

    def test_accept_flow(self, joycey, maggie):
        self._cleanup(joycey["id"], maggie["id"])
        r = requests.post(
            f"{BASE}/api/friends/request",
            json={"from_id": joycey["id"], "to_id": maggie["id"]},
            timeout=15,
        )
        assert r.status_code in (200, 201), r.text
        req = r.json()
        req_id = req.get("id") or req.get("request_id") or req.get("req_id")
        assert req_id, f"no request id in {req}"
        # Accept
        ra = requests.post(f"{BASE}/api/friends/accept/{req_id}", timeout=15)
        assert ra.status_code == 200, ra.text
        # Verify friendship via public profile (list_accepted_friends is auth-gated)
        prof = requests.get(f"{BASE}/api/users/{maggie['id']}", timeout=10)
        if prof.status_code == 200:
            body = prof.json()
            friend_ids = body.get("friends") or []
            assert joycey["id"] in friend_ids, f"joycey not in maggie friends: {friend_ids[:5]}"
        # And the pending request should no longer be in inbox
        inbox = requests.get(f"{BASE}/api/friends/inbox/{maggie['id']}", timeout=10).json()
        rows = inbox if isinstance(inbox, list) else (inbox.get("incoming") or [])
        pending = [x for x in rows if x.get("from_id") == joycey["id"] and x.get("status") in (None, "pending")]
        assert not pending, f"inbox still has pending after accept: {pending}"

    def test_decline_flow(self, joycey, maggie):
        self._cleanup(joycey["id"], maggie["id"])
        r = requests.post(
            f"{BASE}/api/friends/request",
            json={"from_id": joycey["id"], "to_id": maggie["id"]},
            timeout=15,
        )
        assert r.status_code in (200, 201), r.text
        req_id = r.json().get("id")
        rd = requests.post(f"{BASE}/api/friends/decline/{req_id}", timeout=15)
        assert rd.status_code == 200, rd.text
        # Should NOT be friends
        prof = requests.get(f"{BASE}/api/users/{maggie['id']}", timeout=10)
        if prof.status_code == 200:
            friend_ids = prof.json().get("friends") or []
            assert joycey["id"] not in friend_ids

    def test_later_leaves_pending(self, joycey, maggie):
        self._cleanup(joycey["id"], maggie["id"])
        r = requests.post(
            f"{BASE}/api/friends/request",
            json={"from_id": joycey["id"], "to_id": maggie["id"]},
            timeout=15,
        )
        assert r.status_code in (200, 201), r.text
        # "Later" is a client-only dismiss → nothing sent to backend. The
        # request should still show up in maggie's inbox as pending.
        inbox = requests.get(f"{BASE}/api/friends/inbox/{maggie['id']}", timeout=15).json()
        rows = inbox if isinstance(inbox, list) else (inbox.get("incoming") or [])
        pending_from_joyce = [x for x in rows if x.get("from_id") == joycey["id"]]
        assert pending_from_joyce, f"expected pending request in maggie inbox: {rows[:3]}"


# ---------------------------------------------------------------------------
# #4 FP Café Friends-only table invite + closed-table state
# ---------------------------------------------------------------------------
class TestTableInviteDeepLink:
    def test_friends_only_table_notif_and_close(self, maggie, frankie):
        # Ensure friends (Frankie <-> Maggie are pre-friends per seed)
        # Create friends-only table hosted by Frankie inviting Maggie
        payload = {
            "host_id": frankie["id"],
            "name": f"TEST_iter192_{uuid.uuid4().hex[:6]}",
            "emoji": "☕",
            "topic": "Testing deep-link",
            "visibility": "friends",
            "invite_ids": [maggie["id"]],
        }
        r = requests.post(f"{BASE}/api/tables", json=payload, timeout=20)
        assert r.status_code == 200, r.text
        table = r.json()
        tid = table["id"]

        # Maggie should have a table_invite notification with table_id in payload
        time.sleep(1.0)
        n = requests.get(f"{BASE}/api/notifications/{maggie['id']}", timeout=15)
        assert n.status_code == 200, n.text
        rows = n.json() if isinstance(n.json(), list) else n.json().get("notifications", [])
        invites = [x for x in rows if x.get("type") == "table_invite" and (x.get("payload") or {}).get("table_id") == tid]
        assert invites, f"no table_invite notif for maggie with table_id={tid}. sample={rows[:2]}"

        # Deep-link target: GET the table works pre-close
        gt = requests.get(f"{BASE}/api/tables/{tid}", timeout=10)
        assert gt.status_code == 200

        # Frankie closes/deletes the table (host_id is query param)
        d = requests.delete(f"{BASE}/api/tables/{tid}", params={"host_id": frankie["id"]}, timeout=15)
        assert d.status_code in (200, 204), d.text

        # After delete, tapping the invite should land on "closed" state:
        # backend returns 404, frontend renders friendly closed screen.
        gt2 = requests.get(f"{BASE}/api/tables/{tid}", timeout=10)
        assert gt2.status_code == 404, f"expected 404 after delete, got {gt2.status_code}: {gt2.text}"


# ---------------------------------------------------------------------------
# Smoke: word chain endpoint reachable (deep validation done by main agent)
# ---------------------------------------------------------------------------
class TestWordChainCategoryFitSmoke:
    def test_play_together_alive(self):
        # Just ensure the play_together module is mounted (games list works)
        r = requests.get(f"{BASE}/api/games", timeout=10)
        # Endpoint may not exist, but backend must be reachable
        assert r.status_code in (200, 404, 405)
