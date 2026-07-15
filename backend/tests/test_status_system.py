"""FriendPlace — User-selectable status system regression suite.

Covers:
- GET /api/status-options returns the 5 status options (label/code/emoji)
- POST /api/users/{uid}/status with valid status persists; GET returns label/code/emoji
- POST /api/users/{uid}/status with invalid status returns 400
- POST /api/users/{uid}/status with status=null clears the chosen status
- GET /users/{uid}/status falls back to auto label from last_seen_at when no chosen
- Chosen 'looking_to_chat' but stale last_seen (>30 min ago) → falls back to auto
- Chosen 'offline' → always returns Offline (regardless of recency)
- privacy='invisible' → GET status always Offline (overrides chosen)
- Flutter notification body contains 'is looking to chat' (not 'looking for company')
- Default flutter message is 'would like to chat 🦋' (not 'wants to chat 🦋')
- Regression: /community/today, /games/wordsearch/daily, demo-login frankie, /games/wordsearch/catalog
"""
import os
import time
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient
from dotenv import dotenv_values

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"

# Direct Mongo access (for setting last_seen_at to a stale value & cleanup)
_env = dotenv_values("/app/backend/.env")
MONGO_URL = _env.get("MONGO_URL", "mongodb://localhost:27017").strip('"')
DB_NAME = _env.get("DB_NAME", "test_database").strip('"')
_mongo = MongoClient(MONGO_URL)
_db = _mongo[DB_NAME]


EXPECTED_CODES = [
    "looking_to_chat",
    "in_coffee_lounge",
    "happy_to_connect",
    "busy",
    "offline",
]


# ---------------- fixtures ----------------
@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers["Content-Type"] = "application/json"
    return sess


@pytest.fixture(scope="module")
def frankie(s):
    r = s.post(f"{API}/auth/demo-login", json={"username": "frankie"})
    assert r.status_code == 200, r.text
    return r.json()["user"]


@pytest.fixture(scope="module")
def maggie(s):
    r = s.post(f"{API}/auth/demo-login", json={"username": "maggie"})
    assert r.status_code == 200, r.text
    return r.json()["user"]


@pytest.fixture(autouse=True)
def _reset_frankie_status(frankie):
    """Reset frankie's status & privacy to a clean baseline before AND after each test."""
    def _reset():
        _db.users.update_one(
            {"id": frankie["id"]},
            {
                "$set": {
                    "status": None,
                    "status_updated_at": None,
                    "last_seen_at": datetime.now(timezone.utc).isoformat(),
                    "privacy": "everyone",
                },
                "$unset": {"status_prior": ""},
            },
        )
    _reset()
    yield
    _reset()


# ---------------- /status-options ----------------
class TestStatusOptions:
    def test_status_options_returns_five_with_label_code_emoji(self, s):
        r = s.get(f"{API}/status-options")
        assert r.status_code == 200, r.text
        body = r.json()
        assert "options" in body
        options = body["options"]
        assert isinstance(options, list)
        assert len(options) == 5, f"Expected 5 status options, got {len(options)}: {options}"

        codes = [o["code"] for o in options]
        assert codes == EXPECTED_CODES, f"Order/codes mismatch: {codes}"

        for o in options:
            assert set(o.keys()) >= {"label", "code", "emoji"}, f"Missing keys in {o}"
            assert isinstance(o["label"], str) and o["label"]
            assert isinstance(o["emoji"], str) and o["emoji"]

        # Spot-check labels for the dating-style sweep
        by_code = {o["code"]: o for o in options}
        assert by_code["looking_to_chat"]["label"] == "Looking to chat"
        assert by_code["in_coffee_lounge"]["label"] == "In the Coffee Lounge"
        assert by_code["happy_to_connect"]["label"] == "Happy to connect"
        assert by_code["busy"]["label"] == "Busy right now"
        assert by_code["offline"]["label"] == "Offline"


# ---------------- POST/GET /users/{uid}/status ----------------
class TestSetGetStatus:
    @pytest.mark.parametrize("code,expected_label,expected_emoji", [
        ("looking_to_chat",  "Looking to chat",      "🟢"),
        ("happy_to_connect", "Happy to connect",     "😊"),
        ("busy",             "Busy right now",       "🟡"),
        ("in_coffee_lounge", "In the Coffee Lounge", "☕"),
    ])
    def test_set_valid_status_persists(self, s, frankie, code, expected_label, expected_emoji):
        # Set
        r = s.post(f"{API}/users/{frankie['id']}/status", json={"status": code})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("status") == code

        # Verify GET returns the chosen status (last_seen_at was just refreshed → within 30min)
        g = s.get(f"{API}/users/{frankie['id']}/status")
        assert g.status_code == 200, g.text
        gb = g.json()
        assert gb["code"] == code
        assert gb["label"] == expected_label
        assert gb["emoji"] == expected_emoji

        # Verify persisted in DB
        u = _db.users.find_one({"id": frankie["id"]}, {"_id": 0, "status": 1})
        assert u["status"] == code

    def test_set_invalid_status_returns_400(self, s, frankie):
        r = s.post(f"{API}/users/{frankie['id']}/status", json={"status": "married_with_kids"})
        assert r.status_code == 400, r.text
        assert "Invalid status" in r.text or "invalid" in r.text.lower()

        # And DB must NOT have been mutated to that bogus value
        u = _db.users.find_one({"id": frankie["id"]}, {"_id": 0, "status": 1})
        assert u.get("status") != "married_with_kids"

    def test_set_status_null_clears(self, s, frankie):
        # First set a real status
        r = s.post(f"{API}/users/{frankie['id']}/status", json={"status": "busy"})
        assert r.status_code == 200
        u = _db.users.find_one({"id": frankie["id"]}, {"_id": 0, "status": 1})
        assert u["status"] == "busy"

        # Now clear
        r2 = s.post(f"{API}/users/{frankie['id']}/status", json={"status": None})
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert body.get("ok") is True
        assert body.get("status") is None
        assert body.get("status_label") is None

        u2 = _db.users.find_one({"id": frankie["id"]}, {"_id": 0, "status": 1})
        assert u2.get("status") is None


# ---------------- Auto-fallback behaviour ----------------
class TestStatusFallback:
    def test_no_chosen_status_falls_back_to_auto_online(self, s, frankie):
        # frankie has just been "heartbeated" by the autouse fixture; no chosen status.
        g = s.get(f"{API}/users/{frankie['id']}/status")
        assert g.status_code == 200, g.text
        body = g.json()
        # No chosen → auto-fallback. last_seen just set → expect Online now (<120s).
        assert body["code"] in ("online", "active_today"), f"Unexpected auto code: {body}"
        assert body["label"] in ("Online now", "Active today")

    def test_stale_looking_to_chat_falls_back_to_auto(self, s, frankie):
        # Choose 'looking_to_chat' via API (this also refreshes last_seen_at)
        r = s.post(f"{API}/users/{frankie['id']}/status", json={"status": "looking_to_chat"})
        assert r.status_code == 200

        # Now back-date last_seen_at to 45 minutes ago (> 30 min staleness window)
        stale = (datetime.now(timezone.utc) - timedelta(minutes=45)).isoformat()
        _db.users.update_one({"id": frankie["id"]}, {"$set": {"last_seen_at": stale}})

        g = s.get(f"{API}/users/{frankie['id']}/status")
        assert g.status_code == 200, g.text
        body = g.json()
        # Chosen status should NOT be honoured because it's stale.
        assert body["code"] != "looking_to_chat", f"Stale chosen status was honoured: {body}"
        # 45 min ago → still within 24h → auto = 'active_today'
        assert body["code"] == "active_today", f"Expected active_today fallback, got {body}"
        assert body["label"] == "Active today"

    def test_chosen_offline_honoured_even_when_recent(self, s, frankie):
        # Set offline (last_seen_at refreshes to now)
        r = s.post(f"{API}/users/{frankie['id']}/status", json={"status": "offline"})
        assert r.status_code == 200

        g = s.get(f"{API}/users/{frankie['id']}/status")
        assert g.status_code == 200, g.text
        body = g.json()
        assert body["code"] == "offline"
        assert body["label"] == "Offline"
        assert body["emoji"] == "⚫"

    def test_chosen_offline_honoured_even_when_stale(self, s, frankie):
        # Pick offline, then make last_seen ancient
        s.post(f"{API}/users/{frankie['id']}/status", json={"status": "offline"})
        stale = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
        _db.users.update_one({"id": frankie["id"]}, {"$set": {"last_seen_at": stale}})

        g = s.get(f"{API}/users/{frankie['id']}/status")
        assert g.status_code == 200, g.text
        body = g.json()
        assert body["code"] == "offline"


# ---------------- Privacy=invisible overrides ----------------
class TestInvisibleOverride:
    def test_invisible_privacy_always_offline_even_with_chosen_status(self, s, frankie):
        # Pick a chosen status
        s.post(f"{API}/users/{frankie['id']}/status", json={"status": "looking_to_chat"})

        # Flip privacy to invisible
        r = s.patch(f"{API}/users/{frankie['id']}/privacy", json={"privacy": "invisible"})
        assert r.status_code == 200, r.text

        try:
            g = s.get(f"{API}/users/{frankie['id']}/status")
            assert g.status_code == 200, g.text
            body = g.json()
            assert body["code"] == "offline"
            assert body["label"] == "Offline"
        finally:
            # Restore privacy so other tests aren't polluted
            s.patch(f"{API}/users/{frankie['id']}/privacy", json={"privacy": "everyone"})


# ---------------- Flutter notification copy sweep ----------------
class TestFlutterCopy:
    def test_flutter_notification_says_is_looking_to_chat(self, s, frankie, maggie):
        # Send flutter frankie → maggie (no custom message → default applies)
        # Note: actual route is POST /api/flutters/send (the review prompt mentioned
        # /api/users/{uid}/flutter but the implementation lives under /flutters/send).
        r = s.post(
            f"{API}/flutters/send",
            json={"from_id": frankie["id"], "to_id": maggie["id"]},
        )
        assert r.status_code == 200, r.text
        f = r.json()

        # Default flutter message check
        assert f.get("message") == "would like to chat 🦋", f"Default flutter message wrong: {f.get('message')}"
        assert "wants to chat" not in (f.get("message") or "")

        # Allow a moment for the push_notification to land in Mongo
        time.sleep(0.4)

        notif = _db.notifications.find_one(
            {"user_id": maggie["id"], "type": "flutter", "payload.flutter_id": f["id"]},
            {"_id": 0},
            sort=[("created_at", -1)],
        )
        assert notif is not None, "Flutter notification not persisted for maggie"
        title = notif.get("title", "")
        assert "is looking to chat" in title, f"Notification title wrong copy: {title!r}"
        assert "looking for company" not in title, f"Old dating-style copy still present: {title!r}"

        # Cleanup: remove this flutter + notification so we don't pollute maggie's inbox
        _db.flutters.delete_one({"id": f["id"]})
        _db.notifications.delete_one({"user_id": maggie["id"], "payload.flutter_id": f["id"]})


# ---------------- Regression: untouched endpoints ----------------
class TestRegression:
    def test_demo_login_frankie(self, s):
        r = s.post(f"{API}/auth/demo-login", json={"username": "frankie"})
        assert r.status_code == 200, r.text
        assert r.json()["user"]["username"] == "frankie"

    def test_community_today(self, s):
        r = s.get(f"{API}/community/today")
        assert r.status_code == 200, r.text
        body = r.json()
        # Just make sure shape is sane — Phase B suite covers the deeper content.
        assert isinstance(body, dict)

    def test_wordsearch_catalog(self, s):
        r = s.get(f"{API}/games/wordsearch/catalog")
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body, (list, dict))

    def test_wordsearch_daily(self, s):
        r = s.get(f"{API}/games/wordsearch/daily")
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body, dict)
