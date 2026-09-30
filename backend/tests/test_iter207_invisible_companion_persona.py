"""iter207 backend tests — invisible presence, discovery, matchmaking,
friends list, companion navigation, and persona-aware onboarding.

Endpoints under test (all under /api):
- GET  /status/for-users?ids=... (invisible mask)
- GET  /users                    (Find Friends exclusion)
- POST /play/find-match          (invisible skipped)
- GET  /friends/{user_id}        (My Friends still lists invisible)
- POST /mcgs/george/companion/turn (nav intent)
- POST /mcgs/george/onboarding/start (persona=georgia|george)

Note: The privacy endpoint is exposed as PATCH /users/{id}/privacy in
server.py (not POST as the spec says). We test PATCH which is what
production accepts.
"""

import os
import time
import uuid
import pytest
import requests

def _load_base_url():
    # Read the live preview URL from frontend/.env first, since
    # conftest.py stamps a stale default onto EXPO_PUBLIC_BACKEND_URL.
    try:
        with open("/app/frontend/.env", "r") as f:
            for line in f:
                if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    except Exception:
        pass
    v = os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    if v:
        return v.rstrip("/")
    raise RuntimeError("EXPO_PUBLIC_BACKEND_URL not set")


BASE_URL = _load_base_url()
API = f"{BASE_URL}/api"


def _rand_user():
    tag = uuid.uuid4().hex[:8]
    return {
        "username": f"TEST_inv_{tag}",
        "password": "TestPass2026!",
        "first_name": f"Testy{tag[:4]}",
    }


@pytest.fixture(scope="module")
def sess():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def alice(sess):
    body = _rand_user()
    r = sess.post(f"{API}/auth/signup", json=body, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    return {"token": data["access_token"], "user": data["user"], "body": body}


@pytest.fixture(scope="module")
def bob(sess):
    body = _rand_user()
    r = sess.post(f"{API}/auth/signup", json=body, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    return {"token": data["access_token"], "user": data["user"], "body": body}


def _auth(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _set_privacy(sess, user, value):
    r = sess.patch(
        f"{API}/users/{user['user']['id']}/privacy",
        json={"privacy": value},
        headers=_auth(user["token"]),
        timeout=15,
    )
    assert r.status_code == 200, f"privacy set failed: {r.status_code} {r.text}"
    assert r.json().get("privacy") == value


def _heartbeat(sess, user):
    r = sess.post(f"{API}/status/heartbeat", headers=_auth(user["token"]), timeout=15)
    assert r.status_code == 200, r.text


# ─────────────────────────────────────────────────────────────
# 1) Invisible presence — GET /status/for-users
# ─────────────────────────────────────────────────────────────

class TestInvisiblePresenceForUsers:
    def test_visible_online_then_invisible_offline_then_visible_online(self, sess, alice, bob):
        # both fresh heartbeats
        _heartbeat(sess, alice)
        _heartbeat(sess, bob)

        ids = f"{alice['user']['id']},{bob['user']['id']}"
        r = sess.get(
            f"{API}/status/for-users?ids={ids}", headers=_auth(alice["token"]), timeout=15
        )
        assert r.status_code == 200, r.text
        statuses = r.json().get("statuses", {})
        # visible → not offline (should be online / happy / etc, but not "offline")
        assert statuses.get(bob["user"]["id"]) != "offline", statuses

        # flip bob invisible
        _set_privacy(sess, bob, "invisible")
        _heartbeat(sess, bob)  # keep last_seen fresh
        r = sess.get(
            f"{API}/status/for-users?ids={ids}", headers=_auth(alice["token"]), timeout=15
        )
        assert r.status_code == 200
        statuses = r.json().get("statuses", {})
        assert statuses.get(bob["user"]["id"]) == "offline", (
            f"invisible bob should be offline, got {statuses}"
        )
        # alice (the caller) is visible and just heartbeated → not offline
        assert statuses.get(alice["user"]["id"]) != "offline", statuses

        # flip back to everyone
        _set_privacy(sess, bob, "everyone")
        _heartbeat(sess, bob)
        r = sess.get(
            f"{API}/status/for-users?ids={ids}", headers=_auth(alice["token"]), timeout=15
        )
        statuses = r.json().get("statuses", {})
        assert statuses.get(bob["user"]["id"]) != "offline", statuses


# ─────────────────────────────────────────────────────────────
# 2) Invisible discovery — GET /users (Find Friends)
# ─────────────────────────────────────────────────────────────

class TestInvisibleFindFriendsExclusion:
    def test_invisible_excluded_then_reincluded(self, sess, alice, bob):
        # Ensure bob visible first
        _set_privacy(sess, bob, "everyone")
        r = sess.get(f"{API}/users", headers=_auth(alice["token"]), timeout=20)
        assert r.status_code == 200, r.text
        users = r.json() if isinstance(r.json(), list) else r.json().get("users") or []
        ids = {u.get("id") for u in users}
        assert bob["user"]["id"] in ids, "visible bob should appear in Find Friends"

        # Now invisible
        _set_privacy(sess, bob, "invisible")
        r = sess.get(f"{API}/users", headers=_auth(alice["token"]), timeout=20)
        users = r.json() if isinstance(r.json(), list) else r.json().get("users") or []
        ids = {u.get("id") for u in users}
        assert bob["user"]["id"] not in ids, (
            "invisible bob must NOT appear in Find Friends"
        )

        # Back to everyone → reappears
        _set_privacy(sess, bob, "everyone")
        r = sess.get(f"{API}/users", headers=_auth(alice["token"]), timeout=20)
        users = r.json() if isinstance(r.json(), list) else r.json().get("users") or []
        ids = {u.get("id") for u in users}
        assert bob["user"]["id"] in ids, "bob back to everyone should reappear"


# ─────────────────────────────────────────────────────────────
# 3) Invisible matchmaking — POST /play/find-match
# ─────────────────────────────────────────────────────────────

class TestInvisibleMatchmaking:
    def test_invisible_never_matched(self, sess, alice, bob):
        _set_privacy(sess, bob, "invisible")
        _heartbeat(sess, bob)
        _heartbeat(sess, alice)
        r = sess.post(
            f"{API}/play/find-match",
            json={"game": "quick_trivia"},
            headers=_auth(alice["token"]),
            timeout=20,
        )
        # 404 is acceptable when no other eligible online member exists.
        # If 200, the chosen guest must NOT be bob (he's invisible).
        assert r.status_code in (200, 404), r.text
        if r.status_code == 200:
            data = r.json()
            guest_id = None
            for k in ("guest_id", "peer_id", "other_id", "matched_user_id"):
                if data.get(k):
                    guest_id = data[k]
                    break
            # if we can't parse, at least ensure bob isn't clearly present
            if guest_id:
                assert guest_id != bob["user"]["id"], (
                    f"invisible bob was matched: {data}"
                )
            else:
                assert bob["user"]["id"] not in repr(data), (
                    f"invisible bob referenced in response: {data}"
                )


# ─────────────────────────────────────────────────────────────
# 4) Invisible does NOT remove friends — GET /friends/{user_id}
# ─────────────────────────────────────────────────────────────

class TestInvisibleFriendStaysWithOfflineStatus:
    def test_friend_still_listed_offline(self, sess, alice, bob):
        # Make friends (send + accept)
        _set_privacy(sess, bob, "everyone")
        r = sess.post(
            f"{API}/friends/request",
            json={"from_id": alice["user"]["id"], "to_id": bob["user"]["id"]},
            headers=_auth(alice["token"]),
            timeout=15,
        )
        # tolerate already-friends etc.
        assert r.status_code in (200, 201, 400, 409), r.text

        # find the pending request id
        inbox = sess.get(
            f"{API}/friends/inbox/{bob['user']['id']}", headers=_auth(bob["token"]), timeout=15
        )
        if inbox.status_code == 200:
            payload = inbox.json()
            incoming = payload.get("incoming") or payload.get("requests") or []
            req = next(
                (x for x in incoming if x.get("from_id") == alice["user"]["id"]), None
            )
            if req and req.get("id"):
                acc = sess.post(
                    f"{API}/friends/accept/{req['id']}",
                    headers=_auth(bob["token"]),
                    timeout=15,
                )
                assert acc.status_code in (200, 201, 400), acc.text

        # Flip bob to invisible
        _set_privacy(sess, bob, "invisible")
        _heartbeat(sess, bob)

        # Alice reads My Friends
        r = sess.get(
            f"{API}/friends/{alice['user']['id']}", headers=_auth(alice["token"]), timeout=15
        )
        assert r.status_code == 200, r.text
        friends = r.json().get("friends") or []
        bob_row = next((f for f in friends if f.get("id") == bob["user"]["id"]), None)
        assert bob_row is not None, (
            f"invisible bob must still appear in alice's My Friends: {friends}"
        )
        status = bob_row.get("status") or {}
        assert status.get("code") == "offline", (
            f"expected offline status code, got {status}"
        )


# ─────────────────────────────────────────────────────────────
# 5) Companion navigation intent — POST /mcgs/george/companion/turn
# ─────────────────────────────────────────────────────────────

NAV_CASES_YES = [
    ("Can you take me to Find Friends?", "friends"),
    ("I want to find friends.", "friends"),
    ("take me to the FP cafe", "lounge"),
    ("open my chats", "chats"),
    ("games", "games"),
]

NAV_CASES_EXPLAIN = [
    "Can you show me where Find Friends is?",
    "how do I get to settings",
]


class TestCompanionNavigation:
    @pytest.fixture(scope="class", autouse=True)
    def _reset(self, sess, alice):
        # reset session so we're not carrying state
        sess.post(
            f"{API}/mcgs/george/companion/reset",
            json={"persona": "george"},
            headers=_auth(alice["token"]),
            timeout=15,
        )
        yield

    @pytest.mark.parametrize("text,key", NAV_CASES_YES)
    def test_navigate_intents(self, sess, alice, text, key):
        r = sess.post(
            f"{API}/mcgs/george/companion/turn",
            json={"text": text, "persona": "george"},
            headers=_auth(alice["token"]),
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        nav = data.get("navigate_to")
        assert nav and nav.get("key") == key, (
            f"expected navigate_to.key={key!r} for {text!r}, got {data}"
        )

    @pytest.mark.parametrize("text", NAV_CASES_EXPLAIN)
    def test_explain_intents(self, sess, alice, text):
        r = sess.post(
            f"{API}/mcgs/george/companion/turn",
            json={"text": text, "persona": "george"},
            headers=_auth(alice["token"]),
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert not data.get("navigate_to"), (
            f"explain phrasing must NOT navigate, got {data}"
        )
        msg = (data.get("message") or "").lower()
        # explanation should mention tab/tap/screen/where etc.
        assert any(
            w in msg for w in ("tab", "tap", "screen", "profile", "bottom", "top")
        ), f"explanation message weak: {msg}"

    def test_non_navigation_message(self, sess, alice):
        r = sess.post(
            f"{API}/mcgs/george/companion/turn",
            json={"text": "I feel lonely today", "persona": "george"},
            headers=_auth(alice["token"]),
            timeout=45,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert not data.get("navigate_to"), (
            f"lonely message must not trigger navigation: {data}"
        )
        assert (data.get("message") or "").strip(), "empty companion reply"


# ─────────────────────────────────────────────────────────────
# 6) Onboarding persona — POST /mcgs/george/onboarding/start
# ─────────────────────────────────────────────────────────────

class TestOnboardingPersona:
    def _fresh_user(self, sess):
        body = _rand_user()
        r = sess.post(f"{API}/auth/signup", json=body, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        return {"token": d["access_token"], "user": d["user"]}

    def test_persona_georgia_start_and_turn(self, sess):
        u = self._fresh_user(sess)
        r = sess.post(
            f"{API}/mcgs/george/onboarding/start",
            json={"persona": "georgia"},
            headers=_auth(u["token"]),
            timeout=45,
        )
        assert r.status_code == 200, r.text
        s = r.json()
        # session persona should be georgia
        persona = (
            s.get("persona")
            or (s.get("session") or {}).get("persona")
            or (s.get("data") or {}).get("persona")
        )
        assert persona == "georgia", f"expected persona=georgia in session: {s}"

    def test_persona_george_start(self, sess):
        u = self._fresh_user(sess)
        r = sess.post(
            f"{API}/mcgs/george/onboarding/start",
            json={"persona": "george"},
            headers=_auth(u["token"]),
            timeout=45,
        )
        assert r.status_code == 200, r.text
        s = r.json()
        persona = (
            s.get("persona")
            or (s.get("session") or {}).get("persona")
            or (s.get("data") or {}).get("persona")
        )
        assert persona == "george", f"expected persona=george in session: {s}"
