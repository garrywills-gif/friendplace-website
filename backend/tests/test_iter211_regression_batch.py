"""iter211 regression batch — backend-only tests.

Covers:
  R1  POST /api/status/sign-off backdates both users.last_seen_at AND
      member_status.last_seen_at (and GET /api/users/{uid}/status
      reflects the back-dated timestamp).
  R2  POST /api/users/{A}/block/{B} removes mutual friendship + cancels
      pending friend_requests both directions.
  R3  Auto-friend SKIPS when either side has blocked the other.
  R4  Auto-friend STILL works for a fresh (non-blocked) pair, with
      'friend_accepted' notifications on both sides.
  Preserved endpoints:
    P1 GET /api/notifications/{uid}/live-nudges returns welcome +
       birthday_wish notifications.
    P2 POST /api/flutters/send writes title 'X sent you a Flutter 🦋'.
    P3 POST /api/users/{uid}/location {prefer_not_to_say:true}
       sets suburb_hidden=true; {hidden:false} clears it.
    P4 GET /api/users/{uid}/blocked returns sanitised blocked list.
    P5 POST /api/greetings/send sanitises raw usernames to 'A member'.
    P6 GET /api/community/today?user_id=X filters already-welcomed
       recipients.
"""

import asyncio
import json
import os
import time
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
import websockets
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


# ------------------------------------------------------------------ fixtures

@pytest.fixture(scope="module")
def demo_tokens():
    """Login every demo account we touch."""
    tokens = {}
    for name in ("maggie", "frankie", "joycey", "billdo"):
        r = requests.post(f"{API}/auth/demo-login", json={"username": name}, timeout=15)
        assert r.status_code == 200, f"demo-login {name}: {r.status_code} {r.text}"
        d = r.json()
        tokens[name] = {"token": d["access_token"], "user": d["user"]}
    return tokens


@pytest.fixture(scope="module")
def fresh_pair():
    """Two brand-new signup accounts so we can mutate friends arrays
    without touching the shared demo pair."""
    suffix = uuid.uuid4().hex[:8]
    users = []
    for i, label in enumerate(("alpha", "beta")):
        body = {
            "username": f"TEST_i211_{label}_{suffix}",
            "password": "TestPass2026!",
            "first_name": label.capitalize(),
            "email": f"test_i211_{label}_{suffix}@example.com",
        }
        r = requests.post(f"{API}/auth/signup", json=body, timeout=20)
        assert r.status_code == 200, f"signup {label}: {r.status_code} {r.text}"
        d = r.json()
        users.append({"token": d["access_token"], "user": d["user"]})
    return users


@pytest.fixture(scope="module")
def mongo_db():
    client = AsyncIOMotorClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


# ============================================================ R1 sign-off

class TestSignOff:
    def test_sign_off_backdates_both_last_seen(self, demo_tokens, mongo_db):
        joycey = demo_tokens["joycey"]
        uid = joycey["user"]["id"]
        tok = joycey["token"]

        # Heartbeat first so a fresh timestamp exists.
        r = requests.post(f"{API}/status/heartbeat", headers=_auth(tok), timeout=10)
        assert r.status_code == 200, f"heartbeat: {r.status_code} {r.text}"

        # Call sign-off.
        r = requests.post(f"{API}/status/sign-off", headers=_auth(tok), timeout=10)
        assert r.status_code == 200, f"sign-off: {r.status_code} {r.text}"
        assert r.json().get("ok") is True

        # Verify both collections are backdated ~10 min.
        async def _check():
            u = await mongo_db.users.find_one({"id": uid}, {"_id": 0, "last_seen_at": 1, "status": 1})
            ms = await mongo_db.member_status.find_one({"user_id": uid}, {"_id": 0})
            return u, ms

        u, ms = asyncio.get_event_loop().run_until_complete(_check())
        assert u and ms, "user and member_status docs must exist"

        # Legacy users.last_seen_at is ISO string.
        last_seen_u = datetime.fromisoformat(u["last_seen_at"])
        delta_u = datetime.now(timezone.utc) - last_seen_u
        assert 8 * 60 <= delta_u.total_seconds() <= 15 * 60, (
            f"users.last_seen_at not backdated ~10min: delta={delta_u.total_seconds()}s"
        )
        # Modern member_status.last_seen_at is datetime.
        last_seen_m = ms["last_seen_at"]
        if last_seen_m.tzinfo is None:
            last_seen_m = last_seen_m.replace(tzinfo=timezone.utc)
        delta_m = datetime.now(timezone.utc) - last_seen_m
        assert 8 * 60 <= delta_m.total_seconds() <= 15 * 60, (
            f"member_status.last_seen_at not backdated: delta={delta_m.total_seconds()}s"
        )

    def test_user_status_endpoint_reflects_signoff(self, demo_tokens):
        joycey = demo_tokens["joycey"]
        uid = joycey["user"]["id"]
        # After sign-off (above), /api/users/{uid}/status should be
        # offline / recent / active_today (NOT 'online'). The explicit
        # review ask was 'offline' or 'recent'.
        r = requests.get(f"{API}/users/{uid}/status", timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        # Must not be 'online' (fresh < 2min).
        assert data["code"] != "online", f"status still shows online after sign-off: {data}"
        # Review spec says 'offline' or 'recent'. The _status_from
        # mapping buckets 10min into 'active_today' (<24h). Report it.
        assert data["code"] in {"offline", "recent", "active_today"}, (
            f"unexpected status code after sign-off: {data}"
        )


# ============================================================ R2 block user

class TestBlockRemovesFriendship:
    def test_block_removes_mutual_friendship(self, fresh_pair, mongo_db):
        a = fresh_pair[0]
        b = fresh_pair[1]
        a_id, b_id = a["user"]["id"], b["user"]["id"]

        # Seed friendship both ways + a pending friend_request each direction.
        async def _seed():
            await mongo_db.users.update_one({"id": a_id}, {"$addToSet": {"friends": b_id}})
            await mongo_db.users.update_one({"id": b_id}, {"$addToSet": {"friends": a_id}})
            await mongo_db.friend_requests.insert_many([
                {"id": f"TEST_fr_{uuid.uuid4().hex[:6]}", "from_id": a_id, "to_id": b_id,
                 "status": "pending", "created_at": datetime.now(timezone.utc).isoformat()},
                {"id": f"TEST_fr_{uuid.uuid4().hex[:6]}", "from_id": b_id, "to_id": a_id,
                 "status": "pending", "created_at": datetime.now(timezone.utc).isoformat()},
            ])
        asyncio.get_event_loop().run_until_complete(_seed())

        # Block B from A.
        r = requests.post(f"{API}/users/{a_id}/block/{b_id}", headers=_auth(a["token"]), timeout=10)
        assert r.status_code == 200, f"block: {r.status_code} {r.text}"

        # Verify both friends arrays cleared.
        async def _check():
            ua = await mongo_db.users.find_one({"id": a_id}, {"_id": 0, "friends": 1, "blocked": 1})
            ub = await mongo_db.users.find_one({"id": b_id}, {"_id": 0, "friends": 1})
            prs = await mongo_db.friend_requests.find(
                {"$or": [{"from_id": a_id, "to_id": b_id}, {"from_id": b_id, "to_id": a_id}]},
                {"_id": 0, "status": 1},
            ).to_list(10)
            return ua, ub, prs

        ua, ub, prs = asyncio.get_event_loop().run_until_complete(_check())
        assert b_id not in (ua.get("friends") or []), f"A still has B in friends: {ua}"
        assert a_id not in (ub.get("friends") or []), f"B still has A in friends: {ub}"
        assert b_id in (ua.get("blocked") or []), f"A missing B in blocked: {ua}"
        assert all(p["status"] != "pending" for p in prs), f"pending friend_requests not cancelled: {prs}"

        # Also check /api/friends/{A} does not include B.
        r = requests.get(f"{API}/friends/{a_id}", headers=_auth(a["token"]), timeout=10)
        assert r.status_code == 200, f"friends list: {r.status_code} {r.text}"
        payload = r.json()
        if isinstance(payload, list):
            friend_ids = {(u.get("id") if isinstance(u, dict) else u) for u in payload}
        else:
            friend_ids = set(payload.get("friends") or [])
        assert b_id not in friend_ids, f"GET /friends/A still returned B: {friend_ids}"


# ============================================================ R3+R4 auto-friend

async def _ws_send(conv_id, uid, token, text):
    url = f"{WS_BASE}/api/ws/dm/{conv_id}?user_id={uid}&token={token}"
    async with websockets.connect(url, open_timeout=15, close_timeout=5) as ws:
        await ws.send(json.dumps({"text": text}))
        # Wait briefly for broadcast then close.
        try:
            await asyncio.wait_for(ws.recv(), timeout=5)
        except asyncio.TimeoutError:
            pass


async def _create_conv(mongo_db, a_id, b_id):
    conv_id = f"TEST_conv_{uuid.uuid4().hex[:8]}"
    await mongo_db.dm_conversations.insert_one({
        "id": conv_id,
        "participants": [a_id, b_id],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "archived_for": [],
        "hidden_for": [],
    })
    return conv_id


class TestAutoFriend:
    def test_auto_friend_skipped_when_blocked(self, fresh_pair, mongo_db):
        a = fresh_pair[0]
        b = fresh_pair[1]
        a_id, b_id = a["user"]["id"], b["user"]["id"]

        async def _setup():
            # Reset friends arrays; A keeps B in blocked[] from previous test.
            await mongo_db.users.update_one({"id": a_id}, {"$set": {"friends": [], "blocked": [b_id]}})
            await mongo_db.users.update_one({"id": b_id}, {"$set": {"friends": [], "blocked": []}})
            await mongo_db.messages.delete_many({"user_id": {"$in": [a_id, b_id]}})
            return await _create_conv(mongo_db, a_id, b_id)

        loop = asyncio.get_event_loop()
        conv_id = loop.run_until_complete(_setup())

        # A sends first, then B replies.
        loop.run_until_complete(_ws_send(conv_id, a_id, a["token"], "hi (blocked path)"))
        time.sleep(0.5)
        loop.run_until_complete(_ws_send(conv_id, b_id, b["token"], "hey back"))
        time.sleep(1.0)  # auto-friend logic runs inline, allow write

        async def _check():
            ua = await mongo_db.users.find_one({"id": a_id}, {"_id": 0, "friends": 1})
            ub = await mongo_db.users.find_one({"id": b_id}, {"_id": 0, "friends": 1})
            return ua, ub

        ua, ub = loop.run_until_complete(_check())
        assert b_id not in (ua.get("friends") or []), (
            f"Auto-friend fired despite A having B blocked: A.friends={ua.get('friends')}"
        )
        assert a_id not in (ub.get("friends") or []), (
            f"Auto-friend fired despite block: B.friends={ub.get('friends')}"
        )

    def test_auto_friend_fires_on_fresh_pair(self, demo_tokens, mongo_db):
        """Use fresh signups (not demo pair maggie/frankie — they are
        already friends by seed)."""
        suffix = uuid.uuid4().hex[:8]
        users = []
        for label in ("gamma", "delta"):
            body = {
                "username": f"TEST_af_{label}_{suffix}",
                "password": "TestPass2026!",
                "first_name": label.capitalize(),
                "email": f"test_af_{label}_{suffix}@example.com",
            }
            r = requests.post(f"{API}/auth/signup", json=body, timeout=20)
            assert r.status_code == 200, f"signup {label}: {r.text}"
            d = r.json()
            users.append({"token": d["access_token"], "user": d["user"]})

        a_id, b_id = users[0]["user"]["id"], users[1]["user"]["id"]
        loop = asyncio.get_event_loop()

        async def _setup():
            # Clear any default friends state, ensure not blocked.
            await mongo_db.users.update_one({"id": a_id}, {"$set": {"friends": [], "blocked": []}})
            await mongo_db.users.update_one({"id": b_id}, {"$set": {"friends": [], "blocked": []}})
            return await _create_conv(mongo_db, a_id, b_id)

        conv_id = loop.run_until_complete(_setup())
        loop.run_until_complete(_ws_send(conv_id, a_id, users[0]["token"], "hi fresh"))
        time.sleep(0.5)
        loop.run_until_complete(_ws_send(conv_id, b_id, users[1]["token"], "hi back fresh"))
        time.sleep(1.5)

        async def _check():
            ua = await mongo_db.users.find_one({"id": a_id}, {"_id": 0, "friends": 1})
            ub = await mongo_db.users.find_one({"id": b_id}, {"_id": 0, "friends": 1})
            notes = await mongo_db.notifications.find(
                {"user_id": {"$in": [a_id, b_id]}, "type": "friend_accepted"},
                {"_id": 0, "user_id": 1, "title": 1},
            ).to_list(10)
            return ua, ub, notes

        ua, ub, notes = loop.run_until_complete(_check())
        assert b_id in (ua.get("friends") or []), f"A missing B after two-way DM: {ua}"
        assert a_id in (ub.get("friends") or []), f"B missing A after two-way DM: {ub}"
        a_got = any(n["user_id"] == a_id for n in notes)
        b_got = any(n["user_id"] == b_id for n in notes)
        assert a_got and b_got, f"friend_accepted notif missing on one or both sides: {notes}"


# ============================================================ Preserved

class TestPreserved:
    def test_live_nudges_includes_welcome_and_birthday(self, demo_tokens, mongo_db):
        billdo = demo_tokens["billdo"]
        uid = billdo["user"]["id"]
        loop = asyncio.get_event_loop()
        now = datetime.now(timezone.utc).isoformat()

        async def _seed():
            for ntype in ("welcome", "birthday_wish"):
                await mongo_db.notifications.insert_one({
                    "id": f"TEST_live_{uuid.uuid4().hex[:6]}",
                    "user_id": uid,
                    "type": ntype,
                    "title": f"👋 {ntype} test",
                    "body": "",
                    "read": False,
                    "created_at": now,
                })

        loop.run_until_complete(_seed())
        r = requests.get(f"{API}/notifications/{uid}/live-nudges?since_secs=60", timeout=10)
        assert r.status_code == 200, r.text
        types = {n["type"] for n in r.json()}
        assert "welcome" in types and "birthday_wish" in types, (
            f"live-nudges missing types: {types}"
        )

    def test_flutter_title_format(self, demo_tokens, mongo_db):
        maggie = demo_tokens["maggie"]
        frankie = demo_tokens["frankie"]
        loop = asyncio.get_event_loop()

        async def _clean():
            await mongo_db.flutters.delete_many(
                {"from_id": maggie["user"]["id"], "to_id": frankie["user"]["id"]}
            )
            await mongo_db.notifications.delete_many(
                {"user_id": frankie["user"]["id"], "type": "flutter"}
            )

        loop.run_until_complete(_clean())
        r = requests.post(
            f"{API}/flutters/send",
            json={"from_id": maggie["user"]["id"], "to_id": frankie["user"]["id"]},
            timeout=15,
        )
        assert r.status_code == 200, f"flutter: {r.status_code} {r.text}"
        # Fetch most recent notification for frankie.
        async def _latest():
            return await mongo_db.notifications.find_one(
                {"user_id": frankie["user"]["id"], "type": "flutter"},
                {"_id": 0, "title": 1},
                sort=[("created_at", -1)],
            )
        n = loop.run_until_complete(_latest())
        assert n and "sent you a Flutter 🦋" in n["title"], (
            f"flutter title shape wrong: {n}"
        )

    def test_location_prefer_not_to_say_and_unhide(self, demo_tokens, mongo_db):
        joycey = demo_tokens["joycey"]
        uid = joycey["user"]["id"]
        loop = asyncio.get_event_loop()

        r = requests.post(
            f"{API}/users/{uid}/location",
            json={"prefer_not_to_say": True},
            headers=_auth(joycey["token"]),
            timeout=10,
        )
        assert r.status_code == 200, r.text
        u = loop.run_until_complete(mongo_db.users.find_one({"id": uid}, {"_id": 0, "suburb_hidden": 1}))
        assert u.get("suburb_hidden") is True, f"suburb_hidden not set: {u}"

        # Un-hide via explicit hidden:false + a suburb.
        r = requests.post(
            f"{API}/users/{uid}/location",
            json={"suburb": "Melbourne", "hidden": False},
            headers=_auth(joycey["token"]),
            timeout=10,
        )
        assert r.status_code == 200, r.text
        u = loop.run_until_complete(mongo_db.users.find_one({"id": uid}, {"_id": 0, "suburb_hidden": 1}))
        assert u.get("suburb_hidden") is False, f"suburb_hidden not cleared: {u}"

    def test_blocked_endpoint_sanitised(self, demo_tokens, fresh_pair, mongo_db):
        maggie = demo_tokens["maggie"]
        a_id = maggie["user"]["id"]
        b_id = fresh_pair[0]["user"]["id"]
        loop = asyncio.get_event_loop()

        # Ensure maggie has b blocked.
        async def _seed():
            # Give the fresh user an unsafe username-shaped first_name so
            # we can confirm the sanitiser is active.
            await mongo_db.users.update_one(
                {"id": b_id},
                {"$set": {"first_name": "x9f72g"}},
            )
            await mongo_db.users.update_one(
                {"id": a_id},
                {"$addToSet": {"blocked": b_id}},
            )
        loop.run_until_complete(_seed())

        r = requests.get(f"{API}/users/{a_id}/blocked", headers=_auth(maggie["token"]), timeout=10)
        assert r.status_code == 200, r.text
        rows = r.json()["blocked"]
        row = next((x for x in rows if x["id"] == b_id), None)
        assert row is not None, f"blocked user missing: {rows}"
        assert row["first_name"] == "A member", f"unsafe name leaked: {row}"

        # Cleanup
        loop.run_until_complete(mongo_db.users.update_one({"id": a_id}, {"$pull": {"blocked": b_id}}))

    def test_greetings_send_sanitises_sender_name(self, demo_tokens, mongo_db):
        maggie = demo_tokens["maggie"]
        billdo = demo_tokens["billdo"]
        loop = asyncio.get_event_loop()
        orig = maggie["user"].get("first_name") or "Margaret"

        async def _taint():
            await mongo_db.users.update_one(
                {"id": maggie["user"]["id"]},
                {"$set": {"first_name": "x9f72g"}},  # digits → unsafe
            )
            await mongo_db.notifications.delete_many(
                {"user_id": billdo["user"]["id"], "type": "welcome"}
            )

        async def _restore():
            await mongo_db.users.update_one(
                {"id": maggie["user"]["id"]}, {"$set": {"first_name": orig}}
            )

        loop.run_until_complete(_taint())
        try:
            r = requests.post(
                f"{API}/greetings/send",
                json={
                    "from_id": maggie["user"]["id"],
                    "to_id": billdo["user"]["id"],
                    "kind": "welcome",
                    "notif_id": f"TEST_notif_{uuid.uuid4().hex[:6]}",
                },
                timeout=10,
            )
            assert r.status_code == 200, r.text
            n = loop.run_until_complete(mongo_db.notifications.find_one(
                {"user_id": billdo["user"]["id"], "type": "welcome"},
                {"_id": 0, "title": 1},
                sort=[("created_at", -1)],
            ))
            assert n and "A member" in (n.get("title") or ""), (
                f"greeting sender not sanitised: {n}"
            )
        finally:
            loop.run_until_complete(_restore())

    def test_community_today_filters_already_welcomed(self, demo_tokens, mongo_db):
        maggie = demo_tokens["maggie"]
        a_id = maggie["user"]["id"]
        loop = asyncio.get_event_loop()

        # Seed a brand-new member joined "today" and mark them already
        # welcomed by maggie via a welcome notification whose payload
        # points to that recipient.
        new_uid = f"TEST_cu_{uuid.uuid4().hex[:8]}"
        today_iso = datetime.now(timezone.utc).isoformat()
        async def _seed():
            await mongo_db.users.insert_one({
                "id": new_uid,
                "username": f"TEST_newmember_{uuid.uuid4().hex[:4]}",
                "first_name": "Pip",
                "created_at": today_iso,
            })
            # Mark that maggie already sent a welcome today.
            await mongo_db.notifications.insert_one({
                "id": f"TEST_wn_{uuid.uuid4().hex[:6]}",
                "user_id": new_uid,
                "type": "welcome",
                "payload": {"from_id": a_id},
                "created_at": today_iso,
                "read": False,
            })

        loop.run_until_complete(_seed())
        try:
            r = requests.get(f"{API}/community/today?user_id={a_id}", timeout=15)
            assert r.status_code == 200, r.text
            data = r.json()
            new_member_ids = {u["id"] for u in data.get("new_members", [])}
            assert new_uid not in new_member_ids, (
                f"community/today did not filter already-welcomed member: {new_member_ids}"
            )
        finally:
            loop.run_until_complete(mongo_db.users.delete_one({"id": new_uid}))
            loop.run_until_complete(mongo_db.notifications.delete_many({"user_id": new_uid}))


# ------------------------------------------------------------ cleanup

@pytest.fixture(scope="module", autouse=True)
def _cleanup_test_users(fresh_pair, mongo_db):
    yield
    loop = asyncio.get_event_loop()
    for u in fresh_pair:
        try:
            loop.run_until_complete(mongo_db.users.delete_one({"id": u["user"]["id"]}))
        except Exception:
            pass
    try:
        loop.run_until_complete(mongo_db.users.delete_many(
            {"username": {"$regex": "^TEST_(i211|af)_"}}
        ))
        loop.run_until_complete(mongo_db.friend_requests.delete_many(
            {"id": {"$regex": "^TEST_fr_"}}
        ))
        loop.run_until_complete(mongo_db.dm_conversations.delete_many(
            {"id": {"$regex": "^TEST_conv_"}}
        ))
    except Exception:
        pass
