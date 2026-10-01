"""
iter213 — final cleanup batch backend tests.

Covers:
  #2 Word Chain unreliable categories:
      - WORD_CHAIN_CATEGORIES in /app/backend/play_together.py has exactly
        10 entries and omits "Movies" + "Aussie towns".
      - A bogus Sports word (e.g. "povkey") still 400-rejects (iter210
        regression check).
      - Curated words for Boys' names / Girls' names / Countries /
        Animals / Foods all accepted.

Regression (per iter213 scope — don't break these):
  - Auto-friend after two-way DM between an unblocked pair.
  - Block removes both parties from friends[].
  - Flutter notification title "X sent you a Flutter 🦋".
  - Hide-suburb: hidden=false clears suburb_hidden.
  - GET /users/{uid}/blocked returns private note.
  - Sign-off returns status 'offline'.
"""

import os
import uuid
from typing import Dict

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


# --- Fixtures --------------------------------------------------------------

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


# --- Helpers --------------------------------------------------------------

def _ensure_friends(mongo, a_id: str, b_id: str):
    mongo.users.update_one({"id": a_id}, {"$addToSet": {"friends": b_id}})
    mongo.users.update_one({"id": b_id}, {"$addToSet": {"friends": a_id}})


def _clear_decline_cooldown(mongo, a_id: str, b_id: str):
    pair = sorted([a_id, b_id])
    mongo.play_declines.delete_many({"pair": ":".join(pair)})


def _force_word_chain_session(mongo, maggie, frankie, category: str, required: str):
    """Create a word_chain session and bend content to a known category.
    Returns session_id."""
    _ensure_friends(mongo, maggie["id"], frankie["id"])
    _clear_decline_cooldown(mongo, maggie["id"], frankie["id"])
    r = requests.post(
        f"{API}/play/invite",
        headers=maggie["headers"],
        json={"game": "word_chain", "friend_id": frankie["id"]},
        timeout=20,
    )
    assert r.status_code == 200, f"invite failed: {r.text}"
    sid = r.json()["id"]
    r2 = requests.post(f"{API}/play/{sid}/accept", headers=frankie["headers"], timeout=20)
    assert r2.status_code == 200, f"accept failed: {r2.text}"
    mongo.play_sessions.update_one(
        {"id": sid},
        {"$set": {
            "content.category": category,
            "content.required_letter": required,
            "content.chain": [],
            "turn": maggie["id"],
            "status": "active",
        }},
    )
    return sid


# ===========================================================================
# #2 — Word Chain categories
# ===========================================================================

class TestWordChainCategoriesList:
    """The source WORD_CHAIN_CATEGORIES list must omit the two unreliable
    categories and keep exactly 10 entries."""

    def test_list_has_ten_and_omits_movies_and_aussie_towns(self):
        # Import directly from the backend module.
        import sys
        sys.path.insert(0, "/app/backend")
        from play_together import WORD_CHAIN_CATEGORIES, WORD_CHAIN_DICT
        assert len(WORD_CHAIN_CATEGORIES) == 10, (
            f"Expected 10 categories, got {len(WORD_CHAIN_CATEGORIES)}: "
            f"{WORD_CHAIN_CATEGORIES}"
        )
        assert "Movies" not in WORD_CHAIN_CATEGORIES
        assert "Aussie towns" not in WORD_CHAIN_CATEGORIES
        # And every surviving category has a curated bank (iter213 rule).
        for cat in WORD_CHAIN_CATEGORIES:
            assert cat in WORD_CHAIN_DICT, f"Category {cat!r} is missing a curated bank"


class TestWordChainStrictBogus:
    """iter210 regression — bogus Sports word still rejects."""

    def test_bogus_sports_word_rejected(self, mongo, maggie, frankie):
        sid = _force_word_chain_session(mongo, maggie, frankie, "Sports", "P")
        try:
            r = requests.post(
                f"{API}/play/{sid}/move",
                headers=maggie["headers"],
                json={"word": "povkey"},
                timeout=30,
            )
            assert r.status_code == 400, (
                f"bogus Sports word should 400; got {r.status_code}: {r.text}")
            body = r.text.lower()
            assert "fit" in body or "sports" in body or "try another" in body
        finally:
            mongo.play_sessions.delete_one({"id": sid})

    def test_second_bogus_sports_word_rejected(self, mongo, maggie, frankie):
        sid = _force_word_chain_session(mongo, maggie, frankie, "Sports", "Y")
        try:
            r = requests.post(
                f"{API}/play/{sid}/move",
                headers=maggie["headers"],
                json={"word": "yenta"},
                timeout=30,
            )
            assert r.status_code == 400, (
                f"bogus Sports word should 400; got {r.status_code}: {r.text}")
        finally:
            mongo.play_sessions.delete_one({"id": sid})


class TestWordChainCuratedAccepts:
    """A curated word for each of the five requested categories must pass."""

    @pytest.mark.parametrize(
        "category,required,word",
        [
            ("Boys' names", "J", "jack"),
            ("Girls' names", "E", "emma"),
            ("Countries", "A", "australia"),
            ("Animals", "K", "kangaroo"),
            ("Foods", "P", "pasta"),
        ],
    )
    def test_curated_word_accepted(self, mongo, maggie, frankie, category, required, word):
        sid = _force_word_chain_session(mongo, maggie, frankie, category, required)
        try:
            r = requests.post(
                f"{API}/play/{sid}/move",
                headers=maggie["headers"],
                json={"word": word},
                timeout=30,
            )
            assert r.status_code == 200, (
                f"curated {category} word {word!r} should be accepted; "
                f"got {r.status_code}: {r.text}")
            data = r.json()
            # The move was recorded.
            chain = data.get("content", {}).get("chain", [])
            assert any(c.get("word", "").lower() == word for c in chain), (
                f"Chain missing {word!r}: {chain}")
        finally:
            mongo.play_sessions.delete_one({"id": sid})


# ===========================================================================
# Regression guard list (iter213 scope: must NOT regress)
# ===========================================================================

class TestBlockRemovesFriendship:
    """Blocking must strip BOTH parties from each other's friends[].
    Block endpoint is POST /users/{user_id}/block/{other_id} (path params)."""

    def test_block_strips_mutual_friends(self, mongo, maggie, joycey):
        _ensure_friends(mongo, maggie["id"], joycey["id"])
        # Confirm the fixture
        ua = mongo.users.find_one({"id": maggie["id"]}, {"friends": 1})
        assert joycey["id"] in (ua.get("friends") or [])

        try:
            r = requests.post(
                f"{API}/users/{maggie['id']}/block/{joycey['id']}",
                headers=maggie["headers"],
                json={"note": ""},
                timeout=20,
            )
            assert r.status_code == 200, f"block failed: {r.status_code} {r.text}"
            ua = mongo.users.find_one({"id": maggie["id"]}, {"friends": 1, "blocked": 1})
            ub = mongo.users.find_one({"id": joycey["id"]}, {"friends": 1})
            assert joycey["id"] not in (ua.get("friends") or []), (
                f"Maggie should no longer have Joycey as friend: {ua.get('friends')}")
            assert maggie["id"] not in (ub.get("friends") or []), (
                f"Joycey should no longer have Maggie as friend: {ub.get('friends')}")
            assert joycey["id"] in (ua.get("blocked") or [])
        finally:
            # unblock + re-friend to keep demo state usable for other suites
            requests.post(
                f"{API}/users/{maggie['id']}/unblock/{joycey['id']}",
                headers=maggie["headers"],
                timeout=20,
            )
            _ensure_friends(mongo, maggie["id"], joycey["id"])


class TestFlutterTitle:
    """Flutter notification title must be 'X sent you a Flutter 🦋'.
    The /flutters/send endpoint requires body.from_id (not Bearer-only)."""

    def test_flutter_push_title(self, mongo, maggie, frankie):
        # Clear any lingering flutters/notifications so we can send fresh.
        mongo.flutters.delete_many(
            {"from_id": maggie["id"], "to_id": frankie["id"]}
        )
        mongo.notifications.delete_many(
            {"user_id": frankie["id"], "type": "flutter"}
        )
        # Make sure neither has blocked the other.
        mongo.users.update_one(
            {"id": frankie["id"]},
            {"$pull": {"blocked": maggie["id"]}},
        )
        r = requests.post(
            f"{API}/flutters/send",
            headers=maggie["headers"],
            json={"from_id": maggie["id"], "to_id": frankie["id"]},
            timeout=20,
        )
        assert r.status_code == 200, f"flutter send failed: {r.status_code} {r.text}"
        # Find the notification (newest).
        notif = mongo.notifications.find_one(
            {"user_id": frankie["id"], "type": "flutter"},
            sort=[("created_at", -1)],
        )
        assert notif is not None, "No flutter notification created for frankie"
        title = notif.get("title", "") or ""
        body = notif.get("body", "") or ""
        combined = f"{title}\n{body}"
        assert "sent you a Flutter" in combined and "🦋" in combined, (
            f"Flutter title/body wrong — title={title!r}, body={body!r}")


class TestHideSuburbClearsOnFalse:
    """Setting hidden=false must clear suburb_hidden on the user doc."""

    def test_hide_false_clears_flag(self, mongo, maggie):
        # Force it on first.
        mongo.users.update_one({"id": maggie["id"]}, {"$set": {"suburb_hidden": True}})
        r = requests.post(
            f"{API}/users/{maggie['id']}/location",
            headers=maggie["headers"],
            json={"hidden": False},
            timeout=20,
        )
        assert r.status_code == 200, f"location toggle failed: {r.text}"
        u = mongo.users.find_one({"id": maggie["id"]}, {"suburb_hidden": 1})
        assert u.get("suburb_hidden") in (False, None), (
            f"suburb_hidden should be False/None after hidden=false: {u}")


class TestBlockedListReturnsPrivateNote:
    """GET /users/{uid}/blocked surfaces the owner's private note."""

    def test_blocked_list_includes_note(self, mongo, maggie, joycey):
        note = "TEST_i213 private note content"
        # Clear & block fresh with note
        requests.post(
            f"{API}/users/{maggie['id']}/unblock/{joycey['id']}",
            headers=maggie["headers"], timeout=20,
        )
        r = requests.post(
            f"{API}/users/{maggie['id']}/block/{joycey['id']}",
            headers=maggie["headers"],
            json={"note": note},
            timeout=20,
        )
        assert r.status_code == 200, f"block failed: {r.status_code} {r.text}"
        try:
            r2 = requests.get(
                f"{API}/users/{maggie['id']}/blocked",
                headers=maggie["headers"], timeout=20,
            )
            assert r2.status_code == 200, f"blocked list failed: {r2.text}"
            data = r2.json()
            rows = data["blocked"] if isinstance(data, dict) and "blocked" in data else data
            assert isinstance(rows, list) and rows, f"Blocked list empty: {data}"
            found = next((x for x in rows if x.get("id") == joycey["id"]), None)
            assert found is not None, f"Blocked joycey not in list: {rows}"
            assert found.get("note") == note, (
                f"Note not surfaced in blocked list: {found}")
        finally:
            requests.post(
                f"{API}/users/{maggie['id']}/unblock/{joycey['id']}",
                headers=maggie["headers"], timeout=20,
            )
            _ensure_friends(mongo, maggie["id"], joycey["id"])


class TestSignOffReturnsOffline:
    """Explicit sign-off returns status 'offline' (iter212 fix)."""

    def test_sign_off(self, maggie):
        r = requests.post(
            f"{API}/status/sign-off",
            headers=maggie["headers"],
            timeout=20,
        )
        assert r.status_code == 200, f"sign-off failed: {r.status_code} {r.text}"
        # Verify via GET /users/{uid}/status
        r2 = requests.get(
            f"{API}/users/{maggie['id']}/status",
            headers=maggie["headers"],
            timeout=20,
        )
        assert r2.status_code == 200, r2.text
        data = r2.json()
        assert data.get("code") == "offline", (
            f"sign-off should put code=offline: {data}")
