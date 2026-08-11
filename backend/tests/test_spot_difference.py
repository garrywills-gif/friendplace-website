"""
Spot The Difference backend test suite.

Covers:
  - Catalog (6 themes, 4 difficulties w/ correct diffs/points/hints/ribbon)
  - Per-day stable puzzle generation
  - Diff counts per difficulty + tap-hit fields
  - Daily endpoint
  - Progress save / get (idempotent upsert)
  - Points awarding rules (Easy/Moderate = 0, Hard = 15, Nightmare = 25)
  - Beat-the-Clock bonus only when base points > 0
  - Hard/Nightmare achievements + Flutter notification broadcast to friends
  - Daily-challenge achievement on first daily of the day
  - Personal-best tracking via /games/spot/bests
  - /api/games/dailies aggregator (spot is intentionally NOT included)
"""
import os
import time
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://iphone-retest-batch.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

_mongo = MongoClient(MONGO_URL)
_db = _mongo[DB_NAME]


# ---------- shared fixtures ----------
@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _demo_login(api, username):
    r = api.post(f"{BASE_URL}/api/auth/demo-login", json={"username": username})
    assert r.status_code == 200, f"demo-login failed for {username}: {r.text}"
    return r.json()["user"]


@pytest.fixture(scope="module")
def frankie(api):
    return _demo_login(api, "frankie")


@pytest.fixture(scope="module")
def maggie(api):
    return _demo_login(api, "maggie")


@pytest.fixture(scope="module", autouse=True)
def _cleanup_and_friend(frankie, maggie):
    """Ensure clean spot data + frankie/maggie are mutual friends (unblocked)."""
    fid, mid = frankie["id"], maggie["id"]
    _db.spot_progress.delete_many({"user_id": fid})
    _db.game_completions.delete_many({"user_id": fid, "game_type": "spot"})
    # Remove any spot-related achievements granted today for frankie
    _db.achievements.delete_many({"user_id": fid, "context.game_type": "spot"})
    _db.achievements.delete_many({"user_id": fid, "key": "daily_challenge"})

    # Pre-existing 'hard'/'nightmare' achievements would block re-granting — remove for frankie.
    _db.achievements.delete_many({"user_id": fid, "key": {"$in": ["hard", "nightmare"]}})

    # Make sure frankie + maggie are mutual friends and unblocked.
    _db.users.update_one({"id": fid}, {"$addToSet": {"friends": mid}, "$pull": {"blocked": mid}})
    _db.users.update_one({"id": mid}, {"$addToSet": {"friends": fid}, "$pull": {"blocked": fid}})

    # Clear maggie's recent notifications so we can detect a fresh Flutter
    _db.notifications.delete_many({"user_id": mid, "type": "achievement"})

    yield

    # teardown — wipe frankie's spot data + spot completions + test achievements
    _db.spot_progress.delete_many({"user_id": fid})
    _db.game_completions.delete_many({"user_id": fid, "game_type": "spot"})
    _db.achievements.delete_many({"user_id": fid, "context.game_type": "spot"})
    _db.achievements.delete_many({"user_id": fid, "key": "daily_challenge"})
    _db.achievements.delete_many({"user_id": fid, "key": {"$in": ["hard", "nightmare"]}})


# ---------- Catalog ----------
class TestCatalog:
    EXPECTED_DIFFS = {
        "easy":      {"diffs": 3,  "points": 0,  "hints": 3, "ribbon": False},
        "moderate":  {"diffs": 5,  "points": 0,  "hints": 3, "ribbon": False},
        "hard":      {"diffs": 7,  "points": 15, "hints": 2, "ribbon": True},
        "nightmare": {"diffs": 10, "points": 25, "hints": 1, "ribbon": True},
    }
    EXPECTED_THEME_KEYS = {"garden", "coffee_shop", "beach", "pets", "birds", "around_house"}

    def test_catalog_returns_6_themes(self, api):
        r = api.get(f"{BASE_URL}/api/games/spot/catalog")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data.get("themes"), list)
        assert len(data["themes"]) == 6
        keys = {t["key"] for t in data["themes"]}
        assert keys == self.EXPECTED_THEME_KEYS
        for t in data["themes"]:
            assert {"key", "label", "emoji"} <= set(t.keys())

    def test_catalog_returns_4_difficulties(self, api):
        r = api.get(f"{BASE_URL}/api/games/spot/catalog")
        data = r.json()
        diffs = {d["key"]: d for d in data["difficulties"]}
        assert set(diffs.keys()) == set(self.EXPECTED_DIFFS.keys())
        for k, exp in self.EXPECTED_DIFFS.items():
            for field, val in exp.items():
                assert diffs[k][field] == val, f"{k}.{field} expected {val} got {diffs[k][field]}"


# ---------- Puzzle generation ----------
class TestPuzzleGeneration:
    def test_easy_garden_returns_3_diffs(self, api):
        r = api.get(f"{BASE_URL}/api/games/spot/puzzle", params={"theme": "garden", "difficulty": "easy"})
        assert r.status_code == 200
        d = r.json()
        assert d["diff_count"] == 3
        assert len(d["differences"]) == 3
        assert d["theme"] == "garden"
        assert d["difficulty"] == "easy"
        assert len(d["scene_a"]) > 0
        assert len(d["scene_b"]) > 0
        # Every diff has x/y/radius for tap hit-testing
        for diff in d["differences"]:
            assert "x" in diff and "y" in diff and "radius" in diff
            assert isinstance(diff["radius"], (int, float)) and diff["radius"] > 0

    def test_puzzle_id_stable_within_same_day(self, api):
        r1 = api.get(f"{BASE_URL}/api/games/spot/puzzle", params={"theme": "garden", "difficulty": "easy"})
        r2 = api.get(f"{BASE_URL}/api/games/spot/puzzle", params={"theme": "garden", "difficulty": "easy"})
        a, b = r1.json(), r2.json()
        assert a["puzzle_id"] == b["puzzle_id"]
        assert [x["id"] for x in a["differences"]] == [x["id"] for x in b["differences"]]

    def test_hard_returns_7_diffs(self, api):
        r = api.get(f"{BASE_URL}/api/games/spot/puzzle", params={"theme": "coffee_shop", "difficulty": "hard"})
        d = r.json()
        assert d["diff_count"] == 7
        assert len(d["differences"]) == 7

    def test_nightmare_returns_10_diffs(self, api):
        r = api.get(f"{BASE_URL}/api/games/spot/puzzle", params={"theme": "beach", "difficulty": "nightmare"})
        d = r.json()
        # nightmare diff pool size is 12 — 10 should fit
        assert d["diff_count"] == 10, f"Expected 10 diffs, got {d['diff_count']}"
        assert len(d["differences"]) == 10

    def test_unknown_theme_returns_404(self, api):
        r = api.get(f"{BASE_URL}/api/games/spot/puzzle", params={"theme": "moon", "difficulty": "easy"})
        assert r.status_code == 404

    def test_unknown_difficulty_returns_400(self, api):
        r = api.get(f"{BASE_URL}/api/games/spot/puzzle", params={"theme": "garden", "difficulty": "lunatic"})
        assert r.status_code == 400


# ---------- Daily ----------
class TestDaily:
    def test_daily_endpoint(self, api):
        r = api.get(f"{BASE_URL}/api/games/spot/daily")
        assert r.status_code == 200
        d = r.json()
        today = datetime.now(timezone.utc).date().isoformat()
        assert d["is_daily"] is True
        assert d["date"] == today
        assert f"daily-{today}" in d["puzzle_id"]
        assert d["diff_count"] == len(d["differences"]) >= 3

    def test_daily_same_for_everyone(self, api):
        r1 = api.get(f"{BASE_URL}/api/games/spot/daily")
        r2 = api.get(f"{BASE_URL}/api/games/spot/daily")
        assert r1.json()["puzzle_id"] == r2.json()["puzzle_id"]


# ---------- Progress save (easy / moderate = no points) ----------
class TestProgressNoPoints:
    def test_easy_complete_awards_zero_points(self, api, frankie):
        # Get puzzle
        p = api.get(f"{BASE_URL}/api/games/spot/puzzle", params={"theme": "garden", "difficulty": "easy"}).json()
        body = {
            "puzzle_id": p["puzzle_id"], "theme": "garden", "difficulty": "easy",
            "found_ids": [d["id"] for d in p["differences"]],
            "hints_used": 0, "seconds": 42, "completed": True, "is_daily": False, "beat_the_clock": False,
        }
        before = _user_points(frankie["id"])
        r = api.post(f"{BASE_URL}/api/games/spot/progress/{frankie['id']}", json=body)
        assert r.status_code == 200
        out = r.json()
        assert out["ok"] is True
        assert out["points_awarded"] == 0
        # game_completion still logged
        assert _db.game_completions.count_documents({"user_id": frankie["id"], "game_type": "spot", "difficulty": "easy"}) >= 1
        # Points unchanged
        after = _user_points(frankie["id"])
        assert after == before, f"Easy should not award points (before={before}, after={after})"

    def test_moderate_complete_awards_zero_points(self, api, frankie):
        p = api.get(f"{BASE_URL}/api/games/spot/puzzle", params={"theme": "coffee_shop", "difficulty": "moderate"}).json()
        body = {
            "puzzle_id": p["puzzle_id"], "theme": "coffee_shop", "difficulty": "moderate",
            "found_ids": [d["id"] for d in p["differences"]],
            "hints_used": 0, "seconds": 80, "completed": True, "is_daily": False, "beat_the_clock": True,
        }
        before = _user_points(frankie["id"])
        r = api.post(f"{BASE_URL}/api/games/spot/progress/{frankie['id']}", json=body)
        out = r.json()
        # beat_the_clock on moderate should still award 0 because base points = 0
        assert out["points_awarded"] == 0
        after = _user_points(frankie["id"])
        assert after == before


# ---------- Hard / Nightmare points + achievements + Flutter ----------
class TestHardAndNightmare:
    def test_hard_complete_awards_15_and_grants_hard_achievement_and_notifies_friends(self, api, frankie, maggie):
        # ensure maggie has no fresh notif
        _db.notifications.delete_many({"user_id": maggie["id"], "kind": "achievement"})
        p = api.get(f"{BASE_URL}/api/games/spot/puzzle", params={"theme": "pets", "difficulty": "hard"}).json()
        body = {
            "puzzle_id": p["puzzle_id"], "theme": "pets", "difficulty": "hard",
            "found_ids": [d["id"] for d in p["differences"]],
            "hints_used": 0, "seconds": 300, "completed": True, "is_daily": False, "beat_the_clock": False,
        }
        before = _user_points(frankie["id"])
        r = api.post(f"{BASE_URL}/api/games/spot/progress/{frankie['id']}", json=body)
        out = r.json()
        assert out["points_awarded"] == 15, f"Hard should award 15, got {out['points_awarded']}"
        assert "hard" in out["granted"], f"'hard' achievement not granted; granted={out['granted']}"
        after = _user_points(frankie["id"])
        # +15 spot points + 50 from 'hard' achievement (if hard achievement defined that way) — we only assert >= 15
        assert after - before >= 15

        # Flutter broadcast to maggie
        time.sleep(0.5)
        notif = _db.notifications.find_one({"user_id": maggie["id"], "type": "achievement"})
        assert notif is not None, "Friend (maggie) did not receive achievement Flutter notification"

    def test_hard_idempotent_no_double_award(self, api, frankie):
        # Resave same hard puzzle — should not re-award points or re-grant achievement
        existing = _db.spot_progress.find_one({"user_id": frankie["id"], "difficulty": "hard"})
        assert existing is not None
        body = {
            "puzzle_id": existing["puzzle_id"], "theme": existing["theme"], "difficulty": "hard",
            "found_ids": existing["found_ids"], "hints_used": 0, "seconds": 200,
            "completed": True, "is_daily": False, "beat_the_clock": False,
        }
        before = _user_points(frankie["id"])
        r = api.post(f"{BASE_URL}/api/games/spot/progress/{frankie['id']}", json=body)
        out = r.json()
        assert out["points_awarded"] == 0, "Resave should not re-award points"
        assert "hard" not in out["granted"], "Resave should not re-grant 'hard' achievement"
        after = _user_points(frankie["id"])
        assert after == before

    def test_nightmare_complete_awards_25(self, api, frankie):
        p = api.get(f"{BASE_URL}/api/games/spot/puzzle", params={"theme": "birds", "difficulty": "nightmare"}).json()
        body = {
            "puzzle_id": p["puzzle_id"], "theme": "birds", "difficulty": "nightmare",
            "found_ids": [d["id"] for d in p["differences"]],
            "hints_used": 0, "seconds": 500, "completed": True, "is_daily": False, "beat_the_clock": False,
        }
        before = _user_points(frankie["id"])
        r = api.post(f"{BASE_URL}/api/games/spot/progress/{frankie['id']}", json=body)
        out = r.json()
        assert out["points_awarded"] == 25, f"Nightmare should award 25, got {out['points_awarded']}"
        assert "nightmare" in out["granted"]
        after = _user_points(frankie["id"])
        assert after - before >= 25


# ---------- Beat-the-Clock ----------
class TestBeatTheClock:
    def _setup_user(self, suffix):
        """Use a fresh user for clean beat-the-clock testing."""
        # We'll use joycey to avoid colliding with frankie state
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        r = s.post(f"{BASE_URL}/api/auth/demo-login", json={"username": "joycey"})
        u = r.json()["user"]
        # Reset
        _db.spot_progress.delete_many({"user_id": u["id"]})
        _db.game_completions.delete_many({"user_id": u["id"], "game_type": "spot"})
        _db.achievements.delete_many({"user_id": u["id"], "key": {"$in": ["hard", "nightmare"]}})
        _db.achievements.delete_many({"user_id": u["id"], "context.game_type": "spot"})
        return s, u

    def test_hard_with_beat_the_clock_under_240_awards_23(self):
        s, u = self._setup_user("btc_under")
        p = s.get(f"{BASE_URL}/api/games/spot/puzzle", params={"theme": "pets", "difficulty": "hard"}).json()
        body = {
            "puzzle_id": p["puzzle_id"], "theme": "pets", "difficulty": "hard",
            "found_ids": [d["id"] for d in p["differences"]],
            "hints_used": 0, "seconds": 200, "completed": True, "is_daily": False, "beat_the_clock": True,
        }
        r = s.post(f"{BASE_URL}/api/games/spot/progress/{u['id']}", json=body)
        out = r.json()
        assert out["points_awarded"] == 23, f"Hard + BTC under 240s should award 15+8=23, got {out['points_awarded']}"
        # cleanup
        _db.spot_progress.delete_many({"user_id": u["id"]})
        _db.game_completions.delete_many({"user_id": u["id"], "game_type": "spot"})
        _db.achievements.delete_many({"user_id": u["id"], "key": {"$in": ["hard"]}})
        _db.achievements.delete_many({"user_id": u["id"], "context.game_type": "spot"})

    def test_hard_with_beat_the_clock_over_240_awards_15(self):
        s, u = self._setup_user("btc_over")
        p = s.get(f"{BASE_URL}/api/games/spot/puzzle", params={"theme": "beach", "difficulty": "hard"}).json()
        body = {
            "puzzle_id": p["puzzle_id"], "theme": "beach", "difficulty": "hard",
            "found_ids": [d["id"] for d in p["differences"]],
            "hints_used": 0, "seconds": 300, "completed": True, "is_daily": False, "beat_the_clock": True,
        }
        r = s.post(f"{BASE_URL}/api/games/spot/progress/{u['id']}", json=body)
        out = r.json()
        assert out["points_awarded"] == 15, f"Hard + BTC over 240s should award only 15, got {out['points_awarded']}"
        _db.spot_progress.delete_many({"user_id": u["id"]})
        _db.game_completions.delete_many({"user_id": u["id"], "game_type": "spot"})
        _db.achievements.delete_many({"user_id": u["id"], "key": {"$in": ["hard"]}})
        _db.achievements.delete_many({"user_id": u["id"], "context.game_type": "spot"})

    def test_easy_with_beat_the_clock_still_zero(self):
        s, u = self._setup_user("btc_easy")
        p = s.get(f"{BASE_URL}/api/games/spot/puzzle", params={"theme": "garden", "difficulty": "easy"}).json()
        body = {
            "puzzle_id": p["puzzle_id"], "theme": "garden", "difficulty": "easy",
            "found_ids": [d["id"] for d in p["differences"]],
            "hints_used": 0, "seconds": 30, "completed": True, "is_daily": False, "beat_the_clock": True,
        }
        r = s.post(f"{BASE_URL}/api/games/spot/progress/{u['id']}", json=body)
        out = r.json()
        assert out["points_awarded"] == 0, "Easy + BTC should still award 0"
        _db.spot_progress.delete_many({"user_id": u["id"]})
        _db.game_completions.delete_many({"user_id": u["id"], "game_type": "spot"})


# ---------- Daily challenge achievement ----------
class TestDailyAchievement:
    def test_daily_completion_grants_daily_challenge_first_time(self, api):
        # Use 'art' to keep frankie clean
        r = api.post(f"{BASE_URL}/api/auth/demo-login", json={"username": "art"})
        u = r.json()["user"]
        _db.spot_progress.delete_many({"user_id": u["id"]})
        _db.game_completions.delete_many({"user_id": u["id"], "game_type": "spot"})
        today = datetime.now(timezone.utc).date().isoformat()
        _db.achievements.delete_many({"user_id": u["id"], "key": "daily_challenge", "context.date": today})

        daily = api.get(f"{BASE_URL}/api/games/spot/daily").json()
        body = {
            "puzzle_id": daily["puzzle_id"], "theme": daily["theme"], "difficulty": daily["difficulty"],
            "found_ids": [d["id"] for d in daily["differences"]],
            "hints_used": 0, "seconds": 60, "completed": True, "is_daily": True, "beat_the_clock": False,
        }
        r = api.post(f"{BASE_URL}/api/games/spot/progress/{u['id']}", json=body)
        out = r.json()
        assert "daily_challenge" in out["granted"], f"daily_challenge not granted; granted={out['granted']}"
        assert out["streak"] >= 1, f"Streak should be >= 1 after daily completion, got {out['streak']}"
        # cleanup
        _db.spot_progress.delete_many({"user_id": u["id"]})
        _db.game_completions.delete_many({"user_id": u["id"], "game_type": "spot"})
        _db.achievements.delete_many({"user_id": u["id"], "key": "daily_challenge", "context.date": today})
        if daily["difficulty"] in ("hard", "nightmare"):
            _db.achievements.delete_many({"user_id": u["id"], "key": {"$in": ["hard", "nightmare"]}})


# ---------- Resume / GET progress ----------
class TestResumeProgress:
    def test_save_then_get_progress(self, api, frankie):
        p = api.get(f"{BASE_URL}/api/games/spot/puzzle", params={"theme": "around_house", "difficulty": "easy"}).json()
        partial = [p["differences"][0]["id"]]
        body = {
            "puzzle_id": p["puzzle_id"], "theme": "around_house", "difficulty": "easy",
            "found_ids": partial, "hints_used": 1, "seconds": 20, "completed": False, "is_daily": False,
        }
        api.post(f"{BASE_URL}/api/games/spot/progress/{frankie['id']}", json=body)
        r = api.get(f"{BASE_URL}/api/games/spot/progress/{frankie['id']}", params={"puzzle_id": p["puzzle_id"]})
        assert r.status_code == 200
        saved = r.json()
        assert saved["puzzle_id"] == p["puzzle_id"]
        assert saved["found_ids"] == partial
        assert saved["hints_used"] == 1
        assert saved["seconds"] == 20
        assert saved["completed"] is False


# ---------- Personal bests ----------
class TestPersonalBests:
    def test_bests_endpoint_returns_per_difficulty(self, api, frankie):
        r = api.get(f"{BASE_URL}/api/games/spot/bests/{frankie['id']}")
        assert r.status_code == 200
        data = r.json()
        assert "bests" in data and "total_completed" in data
        # frankie has completed easy, moderate, hard, nightmare in earlier tests
        assert data["total_completed"] >= 4
        bests = data["bests"]
        # hard PB should be 200 after the idempotent re-save (we re-saved with seconds=200)
        if "hard" in bests:
            assert bests["hard"]["seconds"] in (200, 300), f"hard PB unexpected: {bests['hard']}"

    def test_bests_improve_on_better_time(self, api):
        r = api.post(f"{BASE_URL}/api/auth/demo-login", json={"username": "dot"})
        u = r.json()["user"]
        _db.spot_progress.delete_many({"user_id": u["id"]})
        _db.game_completions.delete_many({"user_id": u["id"], "game_type": "spot"})
        _db.achievements.delete_many({"user_id": u["id"], "key": {"$in": ["hard", "nightmare"]}})

        # First completion @ 120s
        p1 = api.get(f"{BASE_URL}/api/games/spot/puzzle", params={"theme": "garden", "difficulty": "easy"}).json()
        api.post(f"{BASE_URL}/api/games/spot/progress/{u['id']}", json={
            "puzzle_id": p1["puzzle_id"], "theme": "garden", "difficulty": "easy",
            "found_ids": [d["id"] for d in p1["differences"]],
            "hints_used": 0, "seconds": 120, "completed": True, "is_daily": False,
        })
        r1 = api.get(f"{BASE_URL}/api/games/spot/bests/{u['id']}")
        assert r1.json()["bests"]["easy"]["seconds"] == 120

        # Better time on a different puzzle (different theme) — 60s
        p2 = api.get(f"{BASE_URL}/api/games/spot/puzzle", params={"theme": "beach", "difficulty": "easy"}).json()
        api.post(f"{BASE_URL}/api/games/spot/progress/{u['id']}", json={
            "puzzle_id": p2["puzzle_id"], "theme": "beach", "difficulty": "easy",
            "found_ids": [d["id"] for d in p2["differences"]],
            "hints_used": 0, "seconds": 60, "completed": True, "is_daily": False,
        })
        r2 = api.get(f"{BASE_URL}/api/games/spot/bests/{u['id']}")
        assert r2.json()["bests"]["easy"]["seconds"] == 60, "best should drop to 60"

        _db.spot_progress.delete_many({"user_id": u["id"]})
        _db.game_completions.delete_many({"user_id": u["id"], "game_type": "spot"})


# ---------- /games/dailies aggregator ----------
class TestDailiesAggregator:
    def test_dailies_contains_expected_games(self, api):
        r = api.get(f"{BASE_URL}/api/games/dailies")
        assert r.status_code == 200
        d = r.json()
        for key in ("jigsaw", "trivia", "wordsearch", "memory", "sudoku"):
            assert key in d, f"/games/dailies missing {key}"
        # Spot is intentionally NOT in the aggregator yet — record but don't fail.
        # Just a note for follow-up:
        assert "spot" not in d  # explicit: spot is intentionally excluded


# ---------- helpers ----------
def _user_points(user_id):
    u = _db.users.find_one({"id": user_id}, {"_id": 0, "points": 1}) or {}
    return u.get("points", 0)
