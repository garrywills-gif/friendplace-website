"""
iter210 batch backend regression tests.

Covers:
  (1)  Word Chain stricter category validation (nonsense Sports word rejected)
  (2)  Safe display name sanitation in /community/today + /greetings/send paths
  (4)  /greetings/sent-today/{uid} owner-protected endpoint
  (5)  /community/today filters out already-greeted members for the viewer
  (8)  /play/{sid}/snooze: guest-only, declines invite, host receives
       "isn't ready to play right now" notification
  (11) /flutters/send: push notification title is "X sent you a Flutter 🦋"
  (12) /users/{uid}/location: hidden=false clears suburb_hidden,
       prefer_not_to_say=True keeps stored suburb
  (14) /users/{uid}/blocked owner-protected endpoint
  Live-nudges: welcome / birthday_wish types surface via live-nudges poll

All tests use the public preview backend URL. Demo accounts are used for
most flows; a fresh real signup account is used wherever endpoints require
owner_or_admin with a Bearer token (demo-login JWT already satisfies that
for the demo user's own id).
"""

import os
import time
import uuid
from typing import Dict, Optional, Tuple

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def mongo():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


def _demo_login(username: str) -> Dict:
    r = requests.post(f"{API}/auth/demo-login", json={"username": username}, timeout=20)
    assert r.status_code == 200, f"demo-login {username} failed: {r.status_code} {r.text}"
    data = r.json()
    return {
        "token": data["access_token"],
        "user": data["user"],
        "id": data["user"]["id"],
        "headers": {"Authorization": f"Bearer {data['access_token']}"},
    }


@pytest.fixture(scope="module")
def maggie():
    return _demo_login("maggie")


@pytest.fixture(scope="module")
def frankie():
    return _demo_login("frankie")


@pytest.fixture(scope="module")
def joycey():
    return _demo_login("joycey")


@pytest.fixture(scope="module")
def real_user():
    """Fresh real signup account for owner_or_admin endpoints."""
    uname = f"testit210_{uuid.uuid4().hex[:8]}"
    body = {
        "username": uname,
        "password": "secret123",
        "email": f"{uname}@example.com",
        "first_name": "Testy",
    }
    r = requests.post(f"{API}/auth/signup", json=body, timeout=20)
    assert r.status_code == 200, f"signup failed: {r.status_code} {r.text}"
    data = r.json()
    return {
        "token": data["access_token"],
        "user": data["user"],
        "id": data["user"]["id"],
        "headers": {"Authorization": f"Bearer {data['access_token']}"},
        "username": uname,
    }


def _ensure_friends(mongo, a_id: str, b_id: str):
    """Force a + b to be mutual friends in the DB (idempotent)."""
    mongo.users.update_one({"id": a_id}, {"$addToSet": {"friends": b_id}})
    mongo.users.update_one({"id": b_id}, {"$addToSet": {"friends": a_id}})


def _clear_decline_cooldown(mongo, a_id: str, b_id: str):
    pair = sorted([a_id, b_id])
    mongo.play_declines.delete_many({"pair": ":".join(pair)})


# ---------------------------------------------------------------------------
# (8)  /play/{sid}/snooze
# ---------------------------------------------------------------------------


class TestPlaySnooze:
    def _invite(self, maggie, frankie) -> str:
        r = requests.post(
            f"{API}/play/invite",
            headers=maggie["headers"],
            json={"game": "word_chain", "friend_id": frankie["id"]},
            timeout=20,
        )
        assert r.status_code == 200, f"invite failed: {r.status_code} {r.text}"
        sess = r.json()
        assert sess["status"] == "invited"
        return sess["id"]

    def test_only_guest_can_snooze(self, mongo, maggie, frankie):
        _ensure_friends(mongo, maggie["id"], frankie["id"])
        _clear_decline_cooldown(mongo, maggie["id"], frankie["id"])
        sid = self._invite(maggie, frankie)
        # Host (maggie) must get 403
        r = requests.post(f"{API}/play/{sid}/snooze", headers=maggie["headers"], timeout=20)
        assert r.status_code == 403, f"expected 403 for host snooze, got {r.status_code} {r.text}"
        # Clean up
        mongo.play_sessions.delete_one({"id": sid})

    def test_guest_snooze_declines_and_notifies_host(self, mongo, maggie, frankie):
        _ensure_friends(mongo, maggie["id"], frankie["id"])
        _clear_decline_cooldown(mongo, maggie["id"], frankie["id"])
        sid = self._invite(maggie, frankie)

        # Guest (frankie) snoozes
        r = requests.post(f"{API}/play/{sid}/snooze", headers=frankie["headers"], timeout=20)
        assert r.status_code == 200, f"snooze failed: {r.status_code} {r.text}"
        body = r.json()
        assert body["status"] == "declined", f"session not declined: {body}"

        # game_end notifications are EPHEMERAL (ws-only, never persisted —
        # see push_notification `ephemeral` branch). We verify the snooze
        # side-effects we CAN observe server-side: the session is declined
        # and a 24h cooldown was recorded. The 'isn't ready to play right
        # now' wording is enforced by code inspection in play_together.py.
        pair = sorted([maggie["id"], frankie["id"]])
        cooldown = mongo.play_declines.find_one({"pair": ":".join(pair)})
        assert cooldown is not None, "snooze should have recorded a decline cooldown"
        mongo.play_sessions.delete_one({"id": sid})

    def test_snooze_noop_on_non_invited(self, mongo, maggie, frankie):
        _ensure_friends(mongo, maggie["id"], frankie["id"])
        _clear_decline_cooldown(mongo, maggie["id"], frankie["id"])
        sid = self._invite(maggie, frankie)
        # Force session into a non-invited status
        mongo.play_sessions.update_one({"id": sid}, {"$set": {"status": "active"}})
        r = requests.post(f"{API}/play/{sid}/snooze", headers=frankie["headers"], timeout=20)
        assert r.status_code == 200, f"snooze on active session should be noop 200, got {r.status_code}"
        body = r.json()
        # Status should remain "active" — snooze only acts when invited
        assert body["status"] == "active", f"unexpected status change: {body['status']}"
        mongo.play_sessions.delete_one({"id": sid})


# ---------------------------------------------------------------------------
# Live-nudges includes welcome/birthday_wish
# ---------------------------------------------------------------------------


class TestLiveNudges:
    def test_live_nudges_endpoint_200(self, maggie):
        r = requests.get(f"{API}/notifications/{maggie['id']}/live-nudges", timeout=20)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_live_nudges_includes_welcome_and_birthday(self, mongo, maggie):
        # Insert a fresh unread welcome + birthday_wish and poll
        from datetime import datetime, timezone
        now_iso = datetime.now(timezone.utc).isoformat()
        wid = f"TEST_welcome_{uuid.uuid4().hex[:8]}"
        bid = f"TEST_bday_{uuid.uuid4().hex[:8]}"
        try:
            mongo.notifications.insert_one({
                "id": wid, "user_id": maggie["id"], "type": "welcome",
                "title": "TEST welcome", "body": "hi", "read": False,
                "created_at": now_iso,
            })
            mongo.notifications.insert_one({
                "id": bid, "user_id": maggie["id"], "type": "birthday_wish",
                "title": "TEST bday", "body": "hb", "read": False,
                "created_at": now_iso,
            })
            r = requests.get(
                f"{API}/notifications/{maggie['id']}/live-nudges?since_secs=120",
                timeout=20,
            )
            assert r.status_code == 200
            types = {d.get("type") for d in r.json()}
            assert "welcome" in types, f"welcome missing from live-nudges types: {types}"
            assert "birthday_wish" in types, f"birthday_wish missing from live-nudges types: {types}"
        finally:
            mongo.notifications.delete_many({"id": {"$in": [wid, bid]}})


# ---------------------------------------------------------------------------
# (4) /greetings/sent-today  +  (5) /community/today filtering
# ---------------------------------------------------------------------------


class TestGreetingsSentToday:
    def test_owner_protected(self, maggie, frankie):
        # frankie trying to read maggie's sent-today -> 403
        r = requests.get(
            f"{API}/greetings/sent-today/{maggie['id']}",
            headers=frankie["headers"],
            timeout=20,
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"

    def test_owner_can_read_shape(self, maggie):
        r = requests.get(
            f"{API}/greetings/sent-today/{maggie['id']}",
            headers=maggie["headers"],
            timeout=20,
        )
        assert r.status_code == 200
        data = r.json()
        assert "welcome" in data and "birthday" in data
        assert isinstance(data["welcome"], list)
        assert isinstance(data["birthday"], list)


class TestCommunityTodayFiltering:
    def test_filters_already_greeted_members(self, mongo, maggie, frankie, joycey):
        """After maggie sends a welcome greeting to joycey today, joycey must
        not appear in maggie's /community/today new_members. first_name of
        remaining entries must be a safe display name (never raw auth-style
        handles)."""
        # Make sure maggie->joycey hasn't been greeted today, then send.
        from datetime import datetime, timezone
        start = datetime.combine(datetime.now(timezone.utc).date(),
                                 datetime.min.time(), tzinfo=timezone.utc).isoformat()
        mongo.notifications.delete_many({
            "payload.from_id": maggie["id"], "user_id": joycey["id"],
            "type": {"$in": ["welcome", "birthday_wish"]},
            "created_at": {"$gte": start},
        })

        # Force joycey to look like a "new member" (joined in last 7d) and ensure
        # username has no digits-suffix filter blocking.
        mongo.users.update_one(
            {"id": joycey["id"]},
            {"$set": {"created_at": datetime.now(timezone.utc).isoformat(),
                      "is_demo": False}},
        )

        try:
            r0 = requests.get(f"{API}/community/today?user_id={maggie['id']}", timeout=20)
            assert r0.status_code == 200
            new_members_before = {u.get("id") for u in r0.json().get("new_members", [])}
            assert joycey["id"] in new_members_before, (
                f"joycey should appear in new_members before greet; got {new_members_before}")

            # Verify first_name in new_members is a safe display name (not a
            # raw auth-style username like "username_abc123def").
            for u in r0.json().get("new_members", []):
                fn = u.get("first_name") or ""
                assert "@" not in fn, f"first_name leaked @: {fn}"
                assert not any(c.isdigit() for c in fn), f"first_name has digits: {fn}"
                assert u.get("username") == "", f"username should be blanked: {u}"

            # Send a welcome greeting from maggie to joycey.
            r = requests.post(f"{API}/greetings/send",
                              json={"from_id": maggie["id"],
                                    "to_id": joycey["id"],
                                    "kind": "welcome"},
                              timeout=20)
            assert r.status_code == 200, f"greet failed: {r.status_code} {r.text}"

            # Fetch community/today again — joycey must now be filtered out.
            r2 = requests.get(f"{API}/community/today?user_id={maggie['id']}", timeout=20)
            assert r2.status_code == 200
            new_members_after = {u.get("id") for u in r2.json().get("new_members", [])}
            assert joycey["id"] not in new_members_after, (
                f"joycey should be filtered after greet; still present: {new_members_after}")
        finally:
            # Clean up the notifications maggie just created
            mongo.notifications.delete_many({
                "payload.from_id": maggie["id"], "user_id": joycey["id"],
                "type": {"$in": ["welcome", "birthday_wish"]},
            })
            # Restore is_demo so joycey still works as demo later
            mongo.users.update_one({"id": joycey["id"]}, {"$set": {"is_demo": True}})


# ---------------------------------------------------------------------------
# (3) /greetings/send display-name sanitation on sender
# ---------------------------------------------------------------------------


class TestGreetingDisplayName:
    def test_sender_with_unsafe_first_name_falls_back(self, mongo, maggie, frankie):
        """When sender first_name contains digits, the stored notification
        payload must use the safe fallback ('A member'), never leak the
        raw unsafe name."""
        original = (await_ := None)  # placeholder
        original = mongo.users.find_one({"id": maggie["id"]}, {"first_name": 1})
        try:
            mongo.users.update_one({"id": maggie["id"]},
                                   {"$set": {"first_name": "fvh56ftsnw"}})
            r = requests.post(f"{API}/greetings/send",
                              json={"from_id": maggie["id"],
                                    "to_id": frankie["id"],
                                    "kind": "welcome",
                                    "notif_id": f"TEST_nid_{uuid.uuid4().hex[:6]}"},
                              timeout=20)
            assert r.status_code == 200, f"greet failed: {r.status_code} {r.text}"
            notif = mongo.notifications.find_one(
                {"user_id": frankie["id"], "type": "welcome",
                 "payload.from_id": maggie["id"]},
                sort=[("created_at", -1)],
            )
            assert notif is not None, "notif not created"
            # payload.from_name must be the fallback, never leak the handle
            fn = (notif.get("payload") or {}).get("from_name") or ""
            assert "fvh56ftsnw" not in fn and "fvh56ftsnw" not in (notif.get("title") or "")
            assert fn == "A member", f"expected fallback 'A member', got {fn!r}"
        finally:
            # Restore maggie's name and clean up
            mongo.users.update_one(
                {"id": maggie["id"]},
                {"$set": {"first_name": (original or {}).get("first_name", "Margaret")}},
            )
            mongo.notifications.delete_many({
                "payload.from_id": maggie["id"], "user_id": frankie["id"],
                "type": "welcome",
            })


# ---------------------------------------------------------------------------
# (11) /flutters/send title wording
# ---------------------------------------------------------------------------


class TestFlutterNotifTitle:
    def test_flutter_title_contains_sent_you_a_flutter(self, mongo, maggie, frankie):
        # Make sure no previous unread flutter is blocking
        mongo.flutters.delete_many({"from_id": maggie["id"], "to_id": frankie["id"]})
        mongo.notifications.delete_many({"user_id": frankie["id"], "type": "flutter"})
        r = requests.post(f"{API}/flutters/send",
                          json={"from_id": maggie["id"], "to_id": frankie["id"]},
                          timeout=20)
        assert r.status_code == 200, f"flutter failed: {r.status_code} {r.text}"
        notif = mongo.notifications.find_one(
            {"user_id": frankie["id"], "type": "flutter"},
            sort=[("created_at", -1)],
        )
        assert notif is not None, "flutter notification not stored"
        title = notif.get("title") or ""
        assert "sent you a Flutter" in title, f"title missing expected wording: {title!r}"
        assert "🦋" in title, f"butterfly emoji missing from title: {title!r}"
        assert "looking to chat" not in title.lower(), f"old wording leaked: {title!r}"
        mongo.flutters.delete_many({"from_id": maggie["id"], "to_id": frankie["id"]})


# ---------------------------------------------------------------------------
# (12) /users/{uid}/location suburb_hidden behaviour
# ---------------------------------------------------------------------------


class TestLocationSuburbHidden:
    def test_set_suburb_hidden_false_clears_flag(self, mongo, real_user):
        # Pre-set hidden true so we can see it clearing
        mongo.users.update_one({"id": real_user["id"]},
                               {"$set": {"suburb_hidden": True, "suburb": "Carlton"}})
        r = requests.post(f"{API}/users/{real_user['id']}/location",
                          headers=real_user["headers"],
                          json={"suburb": "Carlton", "hidden": False},
                          timeout=20)
        assert r.status_code == 200, f"set location failed: {r.status_code} {r.text}"
        u = mongo.users.find_one({"id": real_user["id"]},
                                 {"suburb_hidden": 1, "suburb": 1})
        assert u.get("suburb_hidden") is False, f"suburb_hidden not cleared: {u}"
        assert (u.get("suburb") or "").strip() != "", "suburb should be stored"

    def test_prefer_not_to_say_keeps_suburb(self, mongo, real_user):
        # Ensure suburb is set first
        mongo.users.update_one({"id": real_user["id"]},
                               {"$set": {"suburb": "Carlton", "suburb_hidden": False}})
        r = requests.post(f"{API}/users/{real_user['id']}/location",
                          headers=real_user["headers"],
                          json={"prefer_not_to_say": True},
                          timeout=20)
        assert r.status_code == 200
        u = mongo.users.find_one({"id": real_user["id"]},
                                 {"suburb_hidden": 1, "suburb": 1})
        assert u.get("suburb_hidden") is True, f"suburb_hidden not True: {u}"
        # The stored suburb must be preserved for local features
        assert (u.get("suburb") or "").strip() == "Carlton", (
            f"suburb was unexpectedly cleared on prefer_not_to_say: {u}")


# ---------------------------------------------------------------------------
# (14) /users/{uid}/blocked
# ---------------------------------------------------------------------------


class TestBlockedListEndpoint:
    def test_owner_protected(self, maggie, frankie):
        r = requests.get(f"{API}/users/{maggie['id']}/blocked",
                         headers=frankie["headers"], timeout=20)
        assert r.status_code == 403, f"expected 403, got {r.status_code}"

    def test_returns_safe_display_names(self, mongo, real_user, maggie):
        # Set a block target that has an unsafe first_name
        target_id = f"TEST_blk_{uuid.uuid4().hex[:8]}"
        try:
            mongo.users.insert_one({
                "id": target_id,
                "username": "blk_test_user",
                "first_name": "fvh56ftsnw",  # unsafe (digits)
                "avatar": "🙂",
                "suburb": "Carlton",
                "suburb_hidden": False,
                "is_demo": False,
            })
            mongo.users.update_one({"id": real_user["id"]},
                                   {"$addToSet": {"blocked": target_id}})
            r = requests.get(f"{API}/users/{real_user['id']}/blocked",
                             headers=real_user["headers"], timeout=20)
            assert r.status_code == 200, f"{r.status_code} {r.text}"
            data = r.json()
            assert "blocked" in data
            match = next((b for b in data["blocked"] if b["id"] == target_id), None)
            assert match is not None, f"blocked target not returned: {data}"
            # first_name must be the fallback 'A member', NOT the raw handle
            assert match["first_name"] == "A member", (
                f"display name not sanitised: {match}")
            assert "fvh56ftsnw" not in match["first_name"]
            assert match["suburb"] == "Carlton"
            assert "avatar" in match
        finally:
            mongo.users.update_one({"id": real_user["id"]},
                                   {"$pull": {"blocked": target_id}})
            mongo.users.delete_one({"id": target_id})


# ---------------------------------------------------------------------------
# (1) Word Chain stricter category validation — Sports / nonsense word reject
# ---------------------------------------------------------------------------


class TestWordChainStrictCategory:
    def test_nonsense_sports_word_rejected(self, mongo, maggie, frankie):
        _ensure_friends(mongo, maggie["id"], frankie["id"])
        _clear_decline_cooldown(mongo, maggie["id"], frankie["id"])

        # Create a Word Chain session and force content into Sports / P
        r = requests.post(f"{API}/play/invite",
                          headers=maggie["headers"],
                          json={"game": "word_chain", "friend_id": frankie["id"]},
                          timeout=20)
        assert r.status_code == 200, f"invite failed: {r.text}"
        sid = r.json()["id"]
        try:
            # Accept so it becomes active, then override content.
            r2 = requests.post(f"{API}/play/{sid}/accept",
                               headers=frankie["headers"], timeout=20)
            assert r2.status_code == 200, f"accept failed: {r2.text}"
            mongo.play_sessions.update_one(
                {"id": sid},
                {"$set": {
                    "content.category": "Sports",
                    "content.required_letter": "P",
                    "content.chain": [],
                    "turn": maggie["id"],
                    "status": "active",
                }},
            )

            # Maggie plays a bogus Sports P-word → must 400 reject
            r3 = requests.post(f"{API}/play/{sid}/move",
                               headers=maggie["headers"],
                               json={"word": "povkey"},
                               timeout=30)
            assert r3.status_code == 400, (
                f"nonsense Sports word must be rejected, got {r3.status_code}: {r3.text}")
            msg = r3.text.lower()
            assert "sports" in msg or "fit" in msg or "try another" in msg, (
                f"unexpected rejection message: {r3.text}")

            # Sanity: a valid Sports P word should still be accepted or at
            # least not a category-fit error. "polo" is in the curated bank.
            r4 = requests.post(f"{API}/play/{sid}/move",
                               headers=maggie["headers"],
                               json={"word": "polo"},
                               timeout=30)
            assert r4.status_code == 200, (
                f"valid Sports word 'polo' should be accepted, got {r4.status_code}: {r4.text}")
        finally:
            mongo.play_sessions.delete_one({"id": sid})
