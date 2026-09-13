"""
iter161 — Auto-friendship regression fix verification.

Background:
  iter157 introduced auto-friendship on two-way DM reply. iter161 fixes a
  regression where the sender-only `already_friends` check caused the whole
  auto-friend block to short-circuit when a stale one-way link existed
  (A had B in friends but B never had A, or vice-versa). When B replied,
  the code read ONLY B's friends, saw A there, and skipped adding A to B
  (and, critically, adding B to A). Result: one-way link stayed forever.

  iter161 reads BOTH sides, always `$addToSet` bidirectionally when not
  fully mutual, marks pending requests accepted, and only fires the
  friend_accepted notification when the pair was truly fresh (silent
  repair for one-way states).

Scenarios covered (all four required by review):
  1. Clean pair                — expect both linked, 1 new notification each.
  2. A had B, B did not have A — expect both linked, 0 new notifications.
  3. B had A, A did not have B — expect both linked, 0 new notifications.
  4. Both already fully friends — expect both linked, 0 new notifications,
     no crash. (Idempotent short-circuit.)

Preservation checks (must not regress):
  * iter158 GET /api/friends/{uid} still returns bidirectional-filtered list.
  * iter159/160 dm/conversations shape.
  * friend_requests pending rows are `accepted` after fresh flow.

Uses demo-login for `frankie` + `dot`.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from typing import List, Tuple

import pymongo
import pytest
import requests
import websockets

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"

WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


# ─────────────────────────────────────────────────────── helpers ──
def _demo_login(username: str) -> dict:
    r = requests.post(
        f"{BASE_URL}/api/auth/demo-login",
        json={"username": username},
        timeout=15,
    )
    assert r.status_code == 200, f"demo-login {username} failed: {r.status_code} {r.text[:300]}"
    body = r.json()
    assert "access_token" in body and "user" in body
    return body


def _auth(sess: dict) -> dict:
    return {"Authorization": f"Bearer {sess['access_token']}", "Content-Type": "application/json"}


def _mongo():
    return pymongo.MongoClient(MONGO_URL)[DB_NAME]


def _ws_url(conv_id: str, uid: str, token: str) -> str:
    return f"{WS_BASE}/api/ws/dm/{conv_id}?user_id={uid}&token={token}"


async def _ws_send_and_close(conv_id: str, uid: str, token: str, text: str) -> None:
    """Open WS, send one message, wait for backend to process, close."""
    ws = await websockets.connect(_ws_url(conv_id, uid, token))
    try:
        await ws.send(json.dumps({"text": text}))
        # Give the server time to process persist + auto-friend + broadcast
        await asyncio.sleep(1.5)
    finally:
        try:
            await ws.close()
        except Exception:
            pass


def _get_friends_direct(mdb, uid: str) -> List[str]:
    """Read friends list straight from Mongo — bypasses any API projection."""
    doc = mdb.users.find_one({"id": uid}, {"_id": 0, "friends": 1}) or {}
    return list(doc.get("friends") or [])


def _reset_pair(mdb, a_id: str, b_id: str, conv_id: str | None,
                a_has_b: bool, b_has_a: bool) -> None:
    """Bring the DB into a known state for this scenario:
      - Set A's friends list to include/exclude B per `a_has_b`.
      - Set B's friends list to include/exclude A per `b_has_a`.
      - Delete all messages / notifications / friend_requests for the pair.
      - Delete the dm_conversation so /dm/start creates a fresh one.
    """
    # Friends
    if a_has_b:
        mdb.users.update_one({"id": a_id}, {"$addToSet": {"friends": b_id}})
    else:
        mdb.users.update_one({"id": a_id}, {"$pull": {"friends": b_id}})
    if b_has_a:
        mdb.users.update_one({"id": b_id}, {"$addToSet": {"friends": a_id}})
    else:
        mdb.users.update_one({"id": b_id}, {"$pull": {"friends": a_id}})

    # Messages
    if conv_id:
        mdb.messages.delete_many({"dm_id": conv_id})
        mdb.dm_conversations.delete_many({"id": conv_id})

    # Notifications for the pair — only friend_accepted-type entries linking
    # them, so we don't destroy unrelated notifications.
    mdb.notifications.delete_many({
        "type": "friend_accepted",
        "$or": [
            {"user_id": a_id, "payload.friend_id": b_id},
            {"user_id": b_id, "payload.friend_id": a_id},
        ],
    })

    # Friend requests between the pair
    mdb.friend_requests.delete_many({
        "$or": [
            {"from_id": a_id, "to_id": b_id},
            {"from_id": b_id, "to_id": a_id},
        ],
    })


def _count_friend_accepted(mdb, uid: str, other_id: str) -> int:
    return mdb.notifications.count_documents({
        "user_id": uid,
        "type": "friend_accepted",
        "payload.friend_id": other_id,
    })


def _dm_start(sess: dict, self_id: str, other_id: str) -> str:
    r = requests.post(
        f"{BASE_URL}/api/dm/start",
        json={"user_id": self_id, "other_id": other_id},
        headers=_auth(sess),
        timeout=15,
    )
    assert r.status_code == 200, f"/api/dm/start failed: {r.status_code} {r.text[:300]}"
    return r.json()["id"]


# ─────────────────────────────────────────────────────── fixtures ──
@pytest.fixture(scope="module")
def sessions():
    frankie = _demo_login("frankie")
    dot = _demo_login("dot")
    return {
        "a": frankie,       # A = frankie (opens)
        "b": dot,           # B = dot (replies)
        "a_id": frankie["user"]["id"],
        "b_id": dot["user"]["id"],
    }


@pytest.fixture(scope="module")
def mdb():
    return _mongo()


# ──────────────────────────────────────────────── flow helper ──
async def _run_scenario(sessions, mdb, a_has_b: bool, b_has_a: bool,
                        label: str) -> Tuple[List[str], List[str], int, int]:
    """Execute one full scenario and return
    (a_friends_after, b_friends_after, new_notifs_for_a, new_notifs_for_b)
    """
    a_id, b_id = sessions["a_id"], sessions["b_id"]
    a_sess, b_sess = sessions["a"], sessions["b"]

    # 1. Precondition — first with no conv_id (we need to delete conv too, but
    #    it doesn't exist yet; nothing to clear).
    _reset_pair(mdb, a_id, b_id, conv_id=None, a_has_b=a_has_b, b_has_a=b_has_a)

    # 2. Insert a pending friend_request from A -> B (preservation check
    #    that iter157 semantics are retained for fresh pairs where a
    #    pending request existed).
    if not (a_has_b and b_has_a):
        mdb.friend_requests.insert_one({
            "id": f"fr_test_{a_id}_{b_id}_{int(time.time()*1000)}",
            "from_id": a_id,
            "to_id": b_id,
            "status": "pending",
            "created_at": time.time(),
        })

    # 3. Start the DM
    conv_id = _dm_start(a_sess, a_id, b_id)

    # 4. Purge messages on the fresh conv (in case /dm/start resurrected an
    #    existing conv with lingering history).
    mdb.messages.delete_many({"dm_id": conv_id})

    # Snapshot notification counters BEFORE the flow.
    notifs_a_before = _count_friend_accepted(mdb, a_id, b_id)
    notifs_b_before = _count_friend_accepted(mdb, b_id, a_id)

    # 5. A sends first message
    await _ws_send_and_close(
        conv_id, a_id, a_sess["access_token"],
        f"[{label}] hi from A {int(time.time())}",
    )

    # 6. B replies — this is the trigger
    await _ws_send_and_close(
        conv_id, b_id, b_sess["access_token"],
        f"[{label}] hi back from B {int(time.time())}",
    )

    # 7. Give the backend a small window to finish any residual async work.
    await asyncio.sleep(0.8)

    # 8. Read final state from Mongo (source of truth).
    a_friends_after = _get_friends_direct(mdb, a_id)
    b_friends_after = _get_friends_direct(mdb, b_id)
    notifs_a_after = _count_friend_accepted(mdb, a_id, b_id)
    notifs_b_after = _count_friend_accepted(mdb, b_id, a_id)

    delta_a = notifs_a_after - notifs_a_before
    delta_b = notifs_b_after - notifs_b_before
    return a_friends_after, b_friends_after, delta_a, delta_b


# ──────────────────────────────────────────────────── tests ──
class TestIter161AutoFriendRegression:

    @pytest.mark.asyncio
    async def test_scenario1_clean_pair_both_linked_and_notified(self, sessions, mdb):
        """Scenario 1 — Neither side had the other. Expect: both linked, 1
        new friend_accepted notification for each side, pending FR accepted."""
        a_id, b_id = sessions["a_id"], sessions["b_id"]

        a_friends, b_friends, delta_a, delta_b = await _run_scenario(
            sessions, mdb, a_has_b=False, b_has_a=False, label="clean",
        )

        assert b_id in a_friends, f"[clean] A.friends missing B: {a_friends}"
        assert a_id in b_friends, f"[clean] B.friends missing A: {b_friends}"
        assert delta_a == 1, f"[clean] expected +1 friend_accepted for A, got {delta_a}"
        assert delta_b == 1, f"[clean] expected +1 friend_accepted for B, got {delta_b}"

        # Pending FR must now be `accepted`
        fr = list(mdb.friend_requests.find({
            "$or": [
                {"from_id": a_id, "to_id": b_id},
                {"from_id": b_id, "to_id": a_id},
            ],
        }))
        assert fr, "[clean] pending friend_request row disappeared"
        for row in fr:
            assert row.get("status") == "accepted", (
                f"[clean] friend_request not marked accepted: {row}"
            )

    @pytest.mark.asyncio
    async def test_scenario2_A_had_B_but_not_B_had_A_silent_repair(self, sessions, mdb):
        """Scenario 2 — Stale one-way: A already had B, but B did not have A.
        Expect: both linked (B now has A), 0 NEW notifications (silent repair)."""
        a_id, b_id = sessions["a_id"], sessions["b_id"]

        a_friends, b_friends, delta_a, delta_b = await _run_scenario(
            sessions, mdb, a_has_b=True, b_has_a=False, label="stale_A_only",
        )

        assert b_id in a_friends, f"[stale_A_only] A.friends missing B: {a_friends}"
        assert a_id in b_friends, (
            f"[stale_A_only] B.friends STILL missing A — regression not fixed. "
            f"friends={b_friends}"
        )
        assert delta_a == 0, f"[stale_A_only] expected 0 new notifs for A, got {delta_a}"
        assert delta_b == 0, f"[stale_A_only] expected 0 new notifs for B, got {delta_b}"

    @pytest.mark.asyncio
    async def test_scenario3_B_had_A_but_not_A_had_B_actual_user_bug(self, sessions, mdb):
        """Scenario 3 — THE actual user bug. B already had A, but A did not
        have B. Prior code short-circuited because it read only the sender's
        (B's) friends when B replied. Expect: A now has B, silent repair."""
        a_id, b_id = sessions["a_id"], sessions["b_id"]

        a_friends, b_friends, delta_a, delta_b = await _run_scenario(
            sessions, mdb, a_has_b=False, b_has_a=True, label="stale_B_only",
        )

        assert b_id in a_friends, (
            f"[stale_B_only] A.friends STILL missing B — regression not fixed. "
            f"friends={a_friends}"
        )
        assert a_id in b_friends, f"[stale_B_only] B.friends missing A: {b_friends}"
        assert delta_a == 0, f"[stale_B_only] expected 0 new notifs for A, got {delta_a}"
        assert delta_b == 0, f"[stale_B_only] expected 0 new notifs for B, got {delta_b}"

    @pytest.mark.asyncio
    async def test_scenario4_already_fully_friends_idempotent(self, sessions, mdb):
        """Scenario 4 — Both sides already had each other. Expect: still
        linked (no crash), no new notifications, no duplicate friends entry."""
        a_id, b_id = sessions["a_id"], sessions["b_id"]

        a_friends, b_friends, delta_a, delta_b = await _run_scenario(
            sessions, mdb, a_has_b=True, b_has_a=True, label="fully",
        )

        assert b_id in a_friends
        assert a_id in b_friends
        # No duplicates (Mongo $addToSet guarantees this, but assert anyway)
        assert a_friends.count(b_id) == 1, f"duplicate B in A.friends: {a_friends}"
        assert b_friends.count(a_id) == 1, f"duplicate A in B.friends: {b_friends}"
        assert delta_a == 0
        assert delta_b == 0


# ──────────────────────────────────────────── preservation checks ──
class TestPreservation:
    """Ensure iter158-160 endpoints did not regress."""

    def test_iter158_friends_endpoint_bidirectional(self, sessions, mdb):
        """iter158: /api/friends/{uid} returns only bidirectional friends."""
        a_id, b_id = sessions["a_id"], sessions["b_id"]

        # Make one-way state (A has B, B does not have A) → endpoint should
        # NOT include B for A (bidirectional filter).
        _reset_pair(mdb, a_id, b_id, conv_id=None, a_has_b=True, b_has_a=False)

        r = requests.get(f"{BASE_URL}/api/friends/{a_id}",
                         headers=_auth(sessions["a"]), timeout=15)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert isinstance(body, dict) and "friends" in body, f"unexpected shape: {body}"
        ids = [f.get("id") if isinstance(f, dict) else f for f in body["friends"]]
        assert b_id not in ids, (
            f"iter158 REGRESSED — one-way friend leaked into /api/friends/{{a}}. "
            f"friends ids={ids}"
        )

        # Now make it fully mutual → endpoint SHOULD include B.
        _reset_pair(mdb, a_id, b_id, conv_id=None, a_has_b=True, b_has_a=True)
        r = requests.get(f"{BASE_URL}/api/friends/{a_id}",
                         headers=_auth(sessions["a"]), timeout=15)
        assert r.status_code == 200
        body = r.json()
        ids = [f.get("id") if isinstance(f, dict) else f for f in body["friends"]]
        assert b_id in ids, (
            f"iter158 REGRESSED — mutual friend missing from /api/friends/{{a}}. "
            f"friends ids={ids}"
        )

    def test_iter159_conversations_shape(self, sessions):
        """iter159/160: /api/dm/{uid}/conversations?filter=active still returns
        a list with the expected keys (id, unread_count:int, other, last)."""
        a_id = sessions["a_id"]
        r = requests.get(
            f"{BASE_URL}/api/dm/{a_id}/conversations?filter=active",
            headers=_auth(sessions["a"]),
            timeout=15,
        )
        assert r.status_code == 200, r.text[:300]
        rows = r.json()
        assert isinstance(rows, list), f"expected list, got {type(rows).__name__}"
        for row in rows[:5]:
            assert "id" in row
            assert "unread_count" in row and isinstance(row["unread_count"], int)
            assert "other" in row  # may be None for self-DMs


# ──────────────────────────────────────────── cleanup ──
def teardown_module(module):
    """Best-effort cleanup: leave the pair NOT friends so re-runs start clean."""
    try:
        m = _mongo()
        frankie = m.users.find_one({"username": "frankie"}, {"_id": 0, "id": 1})
        dot = m.users.find_one({"username": "dot"}, {"_id": 0, "id": 1})
        if frankie and dot:
            a_id, b_id = frankie["id"], dot["id"]
            m.users.update_one({"id": a_id}, {"$pull": {"friends": b_id}})
            m.users.update_one({"id": b_id}, {"$pull": {"friends": a_id}})
            m.friend_requests.delete_many({"$or": [
                {"from_id": a_id, "to_id": b_id},
                {"from_id": b_id, "to_id": a_id},
            ]})
            m.notifications.delete_many({
                "type": "friend_accepted",
                "$or": [
                    {"user_id": a_id, "payload.friend_id": b_id},
                    {"user_id": b_id, "payload.friend_id": a_id},
                ],
            })
    except Exception as e:
        print(f"[teardown_module] cleanup skipped: {e}")
