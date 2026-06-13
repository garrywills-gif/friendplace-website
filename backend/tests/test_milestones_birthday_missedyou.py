"""
Backend regression tests for the new community wave:

  1) GET /api/milestones/{user_id}  — shape + idempotent just_unlocked
  2) POST /api/users/{uid}/birthday-visibility — on/off + 400 invalid
  3) POST /api/birthday/wishes/send — happy path + 403 (off / blocked) + 400 (no bday)
  4) POST /api/jobs/missed-you-check — idempotent same-day
  5) Regression: /admin/policy, /admin/repeat-offenders, /community/today,
                 /games/spot/daily, /games/sudoku/daily, demo logins

This test directly resets Frank's milestones_celebrated and birthday_visibility
via Mongo so the run is idempotent; nothing else on canonical demos is mutated.
Disposable test users are created with TEST_milebday_<run-id>_ prefix and
deleted in module teardown.
"""

import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient


BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL") or "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

RUN_ID = uuid.uuid4().hex[:8]
USER_PREFIX = f"TEST_milebday_{RUN_ID}_"

# ---------- Fixtures ----------

@pytest.fixture(scope="module")
def mongo():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def demo_ids(api):
    """Resolve canonical demo user ids via /auth/demo-login (read-only)."""
    ids = {}
    for u in ("frankie", "maggie", "joycey"):
        r = api.post(f"{BASE_URL}/api/auth/demo-login", json={"username": u}, timeout=15)
        assert r.status_code == 200, f"demo-login {u} failed: {r.status_code} {r.text}"
        ids[u] = r.json()["user"]["id"]
    return ids


@pytest.fixture(scope="module", autouse=True)
def cleanup_state(mongo, demo_ids):
    """
    Pre-test:
      - Frank's milestones_celebrated → cleared (so just_unlocked is meaningful)
      - Frank's birthday_visibility   → 'on'
      - missed_you_last_sent          → cleared on all TEST_ users (created later)
    Post-test:
      - Delete TEST_milebday_* users + their notifications + flutters
      - Restore Frank's milestones_celebrated (re-evaluate against current state
        is harmless; we still leave celebrated array empty so subsequent runs
        start clean — this matches the playbook's "clear celebrated" guidance.)
    """
    # Snapshot a couple of things we will mutate so we can revert if needed
    frank_snap = mongo.users.find_one(
        {"id": demo_ids["frankie"]},
        {"_id": 0, "milestones_celebrated": 1, "birthday_visibility": 1, "blocked": 1},
    ) or {}
    mongo.users.update_one(
        {"id": demo_ids["frankie"]},
        {"$set": {"milestones_celebrated": [], "birthday_visibility": "on"},
         "$unset": {"missed_you_last_sent": ""}},
    )
    yield
    # Restore Frank's birthday_visibility to whatever it was (default 'on')
    mongo.users.update_one(
        {"id": demo_ids["frankie"]},
        {"$set": {"birthday_visibility": frank_snap.get("birthday_visibility") or "on"}},
    )
    # Clear disposable users + their artefacts
    test_users = list(mongo.users.find({"username": {"$regex": f"^{USER_PREFIX}"}}, {"_id": 0, "id": 1}))
    test_ids = [u["id"] for u in test_users]
    if test_ids:
        mongo.users.delete_many({"id": {"$in": test_ids}})
        mongo.notifications.delete_many({"user_id": {"$in": test_ids}})
        mongo.flutters.delete_many({"$or": [{"from_id": {"$in": test_ids}}, {"to_id": {"$in": test_ids}}]})
    # Clean up the flutters/notifications Frank's wish-send tests produced (best-effort)
    mongo.flutters.delete_many({"from_id": demo_ids["maggie"], "to_id": demo_ids["frankie"],
                                "message": {"$regex": "Happy Birthday"}})


# ---------- Helpers ----------

def _make_test_user(mongo, *, username_suffix: str, last_seen_days_ago=None,
                    birthday=None, friends=None, blocked=None) -> str:
    """Insert a disposable user directly (signup path isn't needed and avoids
    side-effects like welcome notifications)."""
    uid = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    doc = {
        "id": uid,
        "username": f"{USER_PREFIX}{username_suffix}",
        "first_name": "Tester",
        "avatar": "🧪",
        "points": 0,
        "badges": [],
        "friends": friends or [],
        "blocked": blocked or [],
        "is_demo": False,
        "banned": False,
        "created_at": now.isoformat(),
        "last_seen_at": (now - timedelta(days=last_seen_days_ago)).isoformat()
        if last_seen_days_ago is not None else now.isoformat(),
    }
    if birthday is not None:
        doc["birthday"] = birthday
    mongo.users.insert_one(doc)
    return uid


# ============================================================
# 1) MILESTONES
# ============================================================

class TestMilestones:
    def test_milestones_shape_and_just_unlocked(self, api, demo_ids, mongo):
        r = api.get(f"{BASE_URL}/api/milestones/{demo_ids['frankie']}", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()

        # Top-level keys
        for k in ("user_id", "stats", "earned", "upcoming", "just_unlocked"):
            assert k in body, f"missing key {k}"

        # Earned items shape
        assert isinstance(body["earned"], list) and len(body["earned"]) > 0
        item = body["earned"][0]
        for k in ("key", "group", "label", "emoji", "message", "threshold", "current", "progress", "earned"):
            assert k in item, f"missing item key {k} in earned item"
        assert item["earned"] is True
        assert isinstance(item["progress"], (int, float))
        assert 0.0 <= item["progress"] <= 1.0

        # Upcoming items shape
        assert isinstance(body["upcoming"], list)
        if body["upcoming"]:
            u = body["upcoming"][0]
            assert u["earned"] is False
            assert u["current"] < u["threshold"]

        # Frankie qualifies for at least: new_member, first_friend, first_game, points_100
        earned_keys = {m["key"] for m in body["earned"]}
        required = {"new_member", "first_friend", "first_game", "points_100"}
        missing = required - earned_keys
        assert not missing, f"Frankie missing required earned milestones: {missing}. Earned: {earned_keys}"

        # 5 groups represented across earned+upcoming
        all_groups = {m["group"] for m in body["earned"] + body["upcoming"]}
        for g in ("Welcome", "Activity", "Points", "Anniversary", "Spirit"):
            assert g in all_groups, f"missing group {g} (got {all_groups})"

        # just_unlocked should contain the newly celebrated items (we cleared
        # celebrated in fixture, so first call must surface them).
        assert len(body["just_unlocked"]) > 0, "First call should produce just_unlocked"
        ju_keys = {m["key"] for m in body["just_unlocked"]}
        assert required.issubset(ju_keys), f"just_unlocked missing required: {required - ju_keys}"

        # Mongo persisted celebrated
        u = mongo.users.find_one({"id": demo_ids["frankie"]}, {"_id": 0, "milestones_celebrated": 1})
        assert set(u["milestones_celebrated"]) >= required

        # Notification was created per just_unlocked
        notes = list(mongo.notifications.find(
            {"user_id": demo_ids["frankie"], "type": "milestone"}, {"_id": 0, "payload": 1}
        ))
        note_keys = {n.get("payload", {}).get("milestone_key") for n in notes}
        assert required.issubset(note_keys), f"Notification missing for keys: {required - note_keys}"

    def test_milestones_idempotent_second_call(self, api, demo_ids):
        # Depends on previous test having celebrated everything Frank earned.
        r = api.get(f"{BASE_URL}/api/milestones/{demo_ids['frankie']}", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["just_unlocked"] == [], (
            f"Second call must return empty just_unlocked, got: "
            f"{[m['key'] for m in body['just_unlocked']]}"
        )
        # earned still populated
        assert len(body["earned"]) > 0

    def test_milestones_404_unknown_user(self, api):
        r = api.get(f"{BASE_URL}/api/milestones/does-not-exist", timeout=10)
        assert r.status_code == 404


# ============================================================
# 2) BIRTHDAY VISIBILITY
# ============================================================

class TestBirthdayVisibility:
    def test_set_visibility_off_hides_from_community_today(self, api, demo_ids, mongo):
        # Before — Frank should be visible (06-13 birthday)
        r = api.get(f"{BASE_URL}/api/community/today", timeout=15)
        assert r.status_code == 200
        ids_before = {b["id"] for b in r.json().get("birthdays", [])}
        assert demo_ids["frankie"] in ids_before, (
            f"Frank should be in /community/today birthdays before setting off: {ids_before}"
        )

        # Turn off
        r = api.post(
            f"{BASE_URL}/api/users/{demo_ids['frankie']}/birthday-visibility",
            json={"visibility": "off"}, timeout=10,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("visibility") == "off"
        u = mongo.users.find_one({"id": demo_ids["frankie"]}, {"_id": 0, "birthday_visibility": 1})
        assert u["birthday_visibility"] == "off"

        # After — Frank gone
        r = api.get(f"{BASE_URL}/api/community/today", timeout=15)
        ids_after = {b["id"] for b in r.json().get("birthdays", [])}
        assert demo_ids["frankie"] not in ids_after, (
            f"Frank should be hidden from /community/today after visibility=off: {ids_after}"
        )

    def test_set_visibility_on_restores(self, api, demo_ids):
        r = api.post(
            f"{BASE_URL}/api/users/{demo_ids['frankie']}/birthday-visibility",
            json={"visibility": "on"}, timeout=10,
        )
        assert r.status_code == 200
        r = api.get(f"{BASE_URL}/api/community/today", timeout=15)
        ids_after = {b["id"] for b in r.json().get("birthdays", [])}
        assert demo_ids["frankie"] in ids_after, "Frank should reappear after visibility=on"

    def test_invalid_visibility_returns_400(self, api, demo_ids):
        r = api.post(
            f"{BASE_URL}/api/users/{demo_ids['frankie']}/birthday-visibility",
            json={"visibility": "maybe"}, timeout=10,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text}"


# ============================================================
# 3) BIRTHDAY WISHES
# ============================================================

class TestBirthdayWishes:
    def test_friend_sends_wish_happy_path(self, api, demo_ids, mongo):
        # Ensure visibility on
        api.post(
            f"{BASE_URL}/api/users/{demo_ids['frankie']}/birthday-visibility",
            json={"visibility": "on"}, timeout=10,
        )

        # Snapshot maggie's points
        m_before = mongo.users.find_one({"id": demo_ids["maggie"]}, {"_id": 0, "points": 1})
        pts_before = int(m_before.get("points") or 0)

        r = api.post(
            f"{BASE_URL}/api/birthday/wishes/send",
            json={"from_id": demo_ids["maggie"], "to_id": demo_ids["frankie"],
                  "message": "🎂 Many happy returns, Frank!"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        flutter_id = body.get("flutter_id")
        assert flutter_id

        # Flutter doc exists
        f = mongo.flutters.find_one({"id": flutter_id}, {"_id": 0})
        assert f is not None
        assert f["from_id"] == demo_ids["maggie"]
        assert f["to_id"] == demo_ids["frankie"]
        assert "Happy" in f["message"] or "happy" in f["message"]

        # Notification exists with type=birthday_wish
        n = mongo.notifications.find_one(
            {"user_id": demo_ids["frankie"], "type": "birthday_wish",
             "payload.flutter_id": flutter_id}, {"_id": 0},
        )
        assert n is not None, "birthday_wish notification missing"

        # Maggie awarded +3 points
        m_after = mongo.users.find_one({"id": demo_ids["maggie"]}, {"_id": 0, "points": 1})
        pts_after = int(m_after.get("points") or 0)
        assert pts_after == pts_before + 3, (
            f"Expected maggie points {pts_before}+3, got {pts_after}"
        )

        # Restore maggie's points to keep canonical demo data clean
        mongo.users.update_one({"id": demo_ids["maggie"]}, {"$set": {"points": pts_before}})

    def test_wish_to_visibility_off_returns_403(self, api, demo_ids):
        api.post(
            f"{BASE_URL}/api/users/{demo_ids['frankie']}/birthday-visibility",
            json={"visibility": "off"}, timeout=10,
        )
        try:
            r = api.post(
                f"{BASE_URL}/api/birthday/wishes/send",
                json={"from_id": demo_ids["maggie"], "to_id": demo_ids["frankie"]},
                timeout=10,
            )
            assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"
        finally:
            api.post(
                f"{BASE_URL}/api/users/{demo_ids['frankie']}/birthday-visibility",
                json={"visibility": "on"}, timeout=10,
            )

    def test_wish_to_blocking_user_returns_403(self, mongo, api, demo_ids):
        # Create disposable recipient who blocks maggie
        recipient_id = _make_test_user(
            mongo, username_suffix="blocker",
            birthday="1960-06-13", blocked=[demo_ids["maggie"]],
        )
        try:
            r = api.post(
                f"{BASE_URL}/api/birthday/wishes/send",
                json={"from_id": demo_ids["maggie"], "to_id": recipient_id},
                timeout=10,
            )
            assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"
        finally:
            mongo.users.delete_one({"id": recipient_id})

    def test_wish_to_user_with_no_birthday_returns_400(self, mongo, api, demo_ids):
        recipient_id = _make_test_user(
            mongo, username_suffix="nobday", birthday=None,
        )
        try:
            r = api.post(
                f"{BASE_URL}/api/birthday/wishes/send",
                json={"from_id": demo_ids["maggie"], "to_id": recipient_id},
                timeout=10,
            )
            assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text}"
        finally:
            mongo.users.delete_one({"id": recipient_id})


# ============================================================
# 4) MISSED YOU
# ============================================================

class TestMissedYou:
    def test_missed_you_idempotent_same_day(self, mongo, api):
        # Insert 3 dormant test users (last_seen_at well past cutoff)
        ids = []
        for i in range(3):
            uid = _make_test_user(mongo, username_suffix=f"dorm_{i}", last_seen_days_ago=60)
            ids.append(uid)

        try:
            # First call should notify all 3
            r1 = api.post(f"{BASE_URL}/api/jobs/missed-you-check?days_idle=30", timeout=20)
            assert r1.status_code == 200, r1.text
            b1 = r1.json()
            assert b1.get("ok") is True
            assert b1.get("notified", 0) >= 3, (
                f"Expected ≥3 notified (our 3 dormant TEST_ users), got {b1}"
            )

            # Notifications written with kind 'missed_you' for each user
            for uid in ids:
                n = mongo.notifications.find_one(
                    {"user_id": uid, "type": "missed_you"}, {"_id": 0, "body": 1, "title": 1}
                )
                assert n is not None, f"missed_you notification missing for {uid}"
                # Gentle, non-shaming language
                gentle = (n.get("title", "") + " " + n.get("body", "")).lower()
                assert any(w in gentle for w in ("miss", "love", "see", "friend")), (
                    f"Notification doesn't read gentle enough: {n}"
                )

            # Second call same day → must be idempotent
            r2 = api.post(f"{BASE_URL}/api/jobs/missed-you-check?days_idle=30", timeout=20)
            assert r2.status_code == 200, r2.text
            b2 = r2.json()
            # Our TEST users should no longer be in candidates list; count
            # could be 0 or include non-TEST dormants the seed has, but the
            # 3 we just notified should NOT be notified again.
            still_marked = mongo.users.count_documents(
                {"id": {"$in": ids}, "missed_you_last_sent": {"$exists": True}}
            )
            assert still_marked == 3, "missed_you_last_sent should be set for all 3"

            # Count NEW notifications for our 3 users after second call →
            # should still be exactly 1 each
            for uid in ids:
                count = mongo.notifications.count_documents(
                    {"user_id": uid, "type": "missed_you"}
                )
                assert count == 1, (
                    f"Idempotency broken: user {uid} has {count} missed_you notifications"
                )
        finally:
            mongo.users.delete_many({"id": {"$in": ids}})
            mongo.notifications.delete_many({"user_id": {"$in": ids}})


# ============================================================
# 5) REGRESSIONS
# ============================================================

class TestRegressions:
    def test_admin_policy(self, api):
        r = api.get(f"{BASE_URL}/api/admin/policy", timeout=10)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("flag_threshold", "restrict_threshold", "window_days", "auto_ban"):
            assert k in d, f"policy missing {k}"

    def test_admin_repeat_offenders_requires_admin(self, api):
        # Without admin id, expect 403
        r = api.get(f"{BASE_URL}/api/admin/repeat-offenders", timeout=10)
        assert r.status_code in (401, 403, 422), f"expected protected, got {r.status_code}"

    def test_community_today(self, api):
        r = api.get(f"{BASE_URL}/api/community/today", timeout=15)
        assert r.status_code == 200
        d = r.json()
        for k in ("date", "birthdays", "new_members", "anniversaries", "milestones"):
            assert k in d

    def test_games_spot_daily(self, api):
        r = api.get(f"{BASE_URL}/api/games/spot/daily", timeout=15)
        assert r.status_code == 200
        assert "date" in r.json() or "puzzle" in r.json() or "image" in r.json()

    def test_games_sudoku_daily(self, api):
        r = api.get(f"{BASE_URL}/api/games/sudoku/daily", timeout=15)
        assert r.status_code == 200

    def test_demo_logins(self, api):
        for u in ("frankie", "maggie", "joycey"):
            r = api.post(f"{BASE_URL}/api/auth/demo-login", json={"username": u}, timeout=10)
            assert r.status_code == 200, f"{u} demo-login: {r.status_code} {r.text}"
            assert "access_token" in r.json()
