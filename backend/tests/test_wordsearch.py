"""
Backend tests for the Word Search game (FriendPlace).

Covers:
 - GET /api/games/wordsearch/catalog (20 themes + 4 difficulties)
 - GET /api/games/wordsearch/puzzle (validity + per-day determinism)
 - Difficulty -> grid size mapping (8/10/12/14)
 - GET /api/games/wordsearch/daily (puzzle_id, is_daily)
 - Placement integrity (cells spell the word)
 - POST /api/games/wordsearch/progress/{user_id} (idempotent upsert,
   first-completion awards, hard/nightmare + daily achievements)
 - GET /api/games/wordsearch/progress/{user_id}
 - Friend Flutter broadcast for Hard/Nightmare completion (via /api/notifications)
 - Regressions: /api/games/dailies still includes jigsaw/trivia/wordsearch,
   /api/community/today still works, /api/auth/demo-login still works.
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import pytest
import requests

# Make /app/backend importable so we can hit Mongo for cleanup.
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL")
            or os.environ.get("EXPO_BACKEND_URL")
            or "https://iphone-retest-batch.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

# Demo accounts used for context tests (no password — /auth/demo-login).
PRIMARY_DEMO = "frankie"
FRIEND_DEMO = "maggie"

# ---------- Fixtures ----------


@pytest.fixture(scope="session")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def frankie(http) -> dict:
    r = http.post(f"{API}/auth/demo-login", json={"username": PRIMARY_DEMO}, timeout=30)
    assert r.status_code == 200, f"frankie demo-login failed: {r.status_code} {r.text}"
    return r.json()["user"]


@pytest.fixture(scope="session")
def maggie(http) -> dict:
    r = http.post(f"{API}/auth/demo-login", json={"username": FRIEND_DEMO}, timeout=30)
    assert r.status_code == 200, f"maggie demo-login failed: {r.status_code} {r.text}"
    return r.json()["user"]


@pytest.fixture(scope="session")
def db_sync():
    """Synchronous Mongo client for fast cleanup (avoids async event loop)."""
    from pymongo import MongoClient
    from dotenv import load_dotenv
    load_dotenv(BACKEND_DIR / ".env")
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]
    client = MongoClient(mongo_url)
    yield client[db_name]
    client.close()


@pytest.fixture
def cleanup_user_state(db_sync, frankie):
    """
    Clean up ALL wordsearch-related state for frankie before AND after each
    test class that needs to award points / grant achievements.
    Keeps DB tidy and prevents prior runs from masking 'first completion' logic.
    """
    uid = frankie["id"]

    def _wipe():
        db_sync.wordsearch_progress.delete_many({"user_id": uid})
        db_sync.game_completions.delete_many({"user_id": uid, "game_type": "wordsearch"})
        db_sync.achievements.delete_many(
            {"user_id": uid, "key": {"$in": ["hard", "nightmare", "daily_challenge"]}}
        )

    _wipe()
    yield
    _wipe()


# ---------- 1. Catalog ----------


# /api/games/wordsearch/catalog
class TestCatalog:
    def test_catalog_shape(self, http):
        r = http.get(f"{API}/games/wordsearch/catalog", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "themes" in data and "difficulties" in data

        themes = data["themes"]
        assert isinstance(themes, list)
        assert len(themes) == 20, f"expected 20 themes, got {len(themes)}"
        for t in themes:
            for k in ("key", "label", "emoji", "word_count"):
                assert k in t, f"theme missing field {k}: {t}"
            assert t["word_count"] >= 12

        diffs = data["difficulties"]
        assert isinstance(diffs, list)
        assert len(diffs) == 4
        by_key = {d["key"]: d for d in diffs}
        for k in ("easy", "moderate", "hard", "nightmare"):
            assert k in by_key, f"missing difficulty {k}"
            d = by_key[k]
            for field in ("label", "size", "num_words", "points", "hints", "directions"):
                assert field in d, f"difficulty {k} missing {field}"
        # Spec assertions per request
        assert by_key["easy"]["size"] == 8 and by_key["easy"]["num_words"] == 6
        assert by_key["moderate"]["size"] == 10 and by_key["moderate"]["num_words"] == 8
        assert by_key["hard"]["size"] == 12 and by_key["hard"]["num_words"] == 10
        assert by_key["nightmare"]["size"] == 14 and by_key["nightmare"]["num_words"] == 12


# ---------- 2. Puzzle endpoint + determinism ----------


# /api/games/wordsearch/puzzle
class TestPuzzle:
    def _verify_placements(self, puz: dict) -> None:
        grid = puz["grid"]
        size = puz["size"]
        assert len(grid) == size and all(len(row) == size for row in grid)
        assert isinstance(puz["words"], list) and len(puz["words"]) > 0
        for w in puz["words"]:
            cells = puz["placements"].get(w)
            assert cells, f"missing placement for {w}"
            assert len(cells) == len(w), f"len mismatch for {w}"
            spelled = "".join(grid[r][c] for r, c in cells)
            assert spelled == w, f"placement does not spell {w} (got {spelled})"
            for r, c in cells:
                assert 0 <= r < size and 0 <= c < size

    def test_easy_puzzle_valid(self, http):
        r = http.get(f"{API}/games/wordsearch/puzzle",
                     params={"theme": "aussie_birds", "difficulty": "easy"}, timeout=30)
        assert r.status_code == 200, r.text
        puz = r.json()
        assert puz["theme"] == "aussie_birds"
        assert puz["difficulty"] == "easy"
        assert puz["size"] == 8
        assert "puzzle_id" in puz and puz["puzzle_id"].startswith("aussie_birds:easy:")
        self._verify_placements(puz)

    def test_difficulty_sizes(self, http):
        sizes = {"easy": 8, "moderate": 10, "hard": 12, "nightmare": 14}
        for diff, expected in sizes.items():
            r = http.get(f"{API}/games/wordsearch/puzzle",
                         params={"theme": "garden", "difficulty": diff}, timeout=30)
            assert r.status_code == 200, f"{diff}: {r.text}"
            puz = r.json()
            assert puz["size"] == expected, f"{diff} grid size != {expected}"
            assert len(puz["grid"]) == expected
            self._verify_placements(puz)

    def test_per_day_determinism_without_seed(self, http):
        """Two no-seed calls in the SAME day MUST be identical."""
        a = http.get(f"{API}/games/wordsearch/puzzle",
                     params={"theme": "tea_biscuits", "difficulty": "moderate"}, timeout=30).json()
        b = http.get(f"{API}/games/wordsearch/puzzle",
                     params={"theme": "tea_biscuits", "difficulty": "moderate"}, timeout=30).json()
        assert a["puzzle_id"] == b["puzzle_id"], "puzzle_id should be stable per-day"
        assert a["grid"] == b["grid"], "grid should be identical per-day"
        assert a["words"] == b["words"]
        assert a["placements"] == b["placements"]

    def test_unknown_theme_404(self, http):
        r = http.get(f"{API}/games/wordsearch/puzzle",
                     params={"theme": "nope_nope", "difficulty": "easy"}, timeout=30)
        assert r.status_code == 404

    def test_unknown_difficulty_400(self, http):
        r = http.get(f"{API}/games/wordsearch/puzzle",
                     params={"theme": "garden", "difficulty": "impossible"}, timeout=30)
        assert r.status_code == 400


# ---------- 3. Daily ----------


# /api/games/wordsearch/daily
class TestDaily:
    def test_daily_shape_and_id(self, http):
        r = http.get(f"{API}/games/wordsearch/daily", timeout=30)
        assert r.status_code == 200, r.text
        puz = r.json()
        assert puz.get("is_daily") is True
        assert "date" in puz
        pid = puz["puzzle_id"]
        assert f"daily-{puz['date']}" in pid, f"puzzle_id missing daily-YYYY-MM-DD: {pid}"
        # Validate placements
        for w in puz["words"]:
            cells = puz["placements"][w]
            assert "".join(puz["grid"][r][c] for r, c in cells) == w

    def test_daily_stable_same_call(self, http):
        a = http.get(f"{API}/games/wordsearch/daily", timeout=30).json()
        b = http.get(f"{API}/games/wordsearch/daily", timeout=30).json()
        assert a["puzzle_id"] == b["puzzle_id"]
        assert a["grid"] == b["grid"]


# ---------- 4. Progress save (idempotent + completion awards) ----------


# /api/games/wordsearch/progress/{user_id}
class TestProgressSaveAndComplete:
    def test_resume_then_complete_easy(self, http, frankie, db_sync, cleanup_user_state):
        uid = frankie["id"]
        # Fetch a real puzzle
        puz = http.get(f"{API}/games/wordsearch/puzzle",
                       params={"theme": "aussie_birds", "difficulty": "easy"},
                       timeout=30).json()
        pid = puz["puzzle_id"]

        # Partial save (resume support)
        body = {
            "puzzle_id": pid, "theme": "aussie_birds", "difficulty": "easy",
            "found_words": puz["words"][:2], "hints_used": 1,
            "seconds": 30, "completed": False, "is_daily": False,
        }
        r1 = http.post(f"{API}/games/wordsearch/progress/{uid}", json=body, timeout=30)
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        assert d1["ok"] is True and d1["points_awarded"] == 0 and d1["granted"] == []

        # Verify GET reflects progress
        g = http.get(f"{API}/games/wordsearch/progress/{uid}",
                     params={"puzzle_id": pid}, timeout=30).json()
        assert g.get("puzzle_id") == pid
        assert g.get("found_words") == puz["words"][:2]
        assert g.get("hints_used") == 1
        assert g.get("completed") is False

        # Idempotent upsert: second partial save with new state
        body2 = {**body, "found_words": puz["words"][:3], "seconds": 60}
        r2 = http.post(f"{API}/games/wordsearch/progress/{uid}", json=body2, timeout=30)
        assert r2.status_code == 200
        # only one row in mongo
        count = db_sync.wordsearch_progress.count_documents({"user_id": uid, "puzzle_id": pid})
        assert count == 1, f"upsert should not create dupes, got {count}"

        # Completion -> awards points + logs game_completion
        body3 = {**body, "found_words": puz["words"], "completed": True, "seconds": 90}
        r3 = http.post(f"{API}/games/wordsearch/progress/{uid}", json=body3, timeout=30)
        assert r3.status_code == 200, r3.text
        d3 = r3.json()
        assert d3["points_awarded"] == 5, f"easy = 5 pts, got {d3['points_awarded']}"

        # game_completion logged
        comp = list(db_sync.game_completions.find(
            {"user_id": uid, "game_type": "wordsearch"}))
        assert len(comp) == 1, f"exactly one completion logged, got {len(comp)}"
        assert comp[0]["difficulty"] == "easy"

        # Idempotent: completing again must NOT double-award.
        r4 = http.post(f"{API}/games/wordsearch/progress/{uid}", json=body3, timeout=30)
        assert r4.status_code == 200
        d4 = r4.json()
        assert d4["points_awarded"] == 0, "second completion must not re-award points"
        comp2 = db_sync.game_completions.count_documents(
            {"user_id": uid, "game_type": "wordsearch"})
        assert comp2 == 1, "must not log a second completion"

    def test_hard_completion_grants_hard_achievement_and_notifies_friend(
        self, http, frankie, maggie, db_sync, cleanup_user_state
    ):
        uid = frankie["id"]
        friend_id = maggie["id"]

        # Ensure maggie is a friend of frankie. Add if not already.
        u = db_sync.users.find_one({"id": uid}, {"friends": 1})
        original_friends = list(u.get("friends") or [])
        if friend_id not in original_friends:
            db_sync.users.update_one({"id": uid}, {"$addToSet": {"friends": friend_id}})

        # Snapshot existing achievement notifications for maggie so we only
        # measure the NEW one created by this test.
        notif_before = db_sync.notifications.count_documents(
            {"user_id": friend_id, "type": "achievement"})

        try:
            puz = http.get(f"{API}/games/wordsearch/puzzle",
                           params={"theme": "garden", "difficulty": "hard"},
                           timeout=30).json()
            body = {
                "puzzle_id": puz["puzzle_id"], "theme": "garden", "difficulty": "hard",
                "found_words": puz["words"], "hints_used": 0,
                "seconds": 120, "completed": True, "is_daily": False,
            }
            r = http.post(f"{API}/games/wordsearch/progress/{uid}", json=body, timeout=30)
            assert r.status_code == 200, r.text
            d = r.json()
            assert d["points_awarded"] == 15, "hard = 15 pts"
            assert "hard" in d.get("granted", []), f"hard achievement should be granted, got {d}"

            # Achievement persisted
            ach = db_sync.achievements.find_one({"user_id": uid, "key": "hard"})
            assert ach is not None, "hard achievement row missing in DB"

            # Friend notification was pushed (allow a moment for in-process write).
            time.sleep(0.3)
            notif_after = db_sync.notifications.count_documents(
                {"user_id": friend_id, "type": "achievement"})
            assert notif_after > notif_before, "friend should receive achievement notification"

            # Also assert it's reachable via the public API.
            nlist = http.get(f"{API}/notifications/{friend_id}", timeout=30).json()
            assert any(n.get("type") == "achievement" and
                       n.get("payload", {}).get("actor_id") == uid and
                       n.get("payload", {}).get("game_type") == "wordsearch"
                       for n in nlist), "no matching achievement notification for friend"
        finally:
            # Restore friends list
            db_sync.users.update_one({"id": uid}, {"$set": {"friends": original_friends}})

    def test_nightmare_completion_grants_nightmare(self, http, frankie, db_sync, cleanup_user_state):
        uid = frankie["id"]
        puz = http.get(f"{API}/games/wordsearch/puzzle",
                       params={"theme": "music", "difficulty": "nightmare"},
                       timeout=30).json()
        body = {
            "puzzle_id": puz["puzzle_id"], "theme": "music", "difficulty": "nightmare",
            "found_words": puz["words"], "hints_used": 0,
            "seconds": 300, "completed": True, "is_daily": False,
        }
        r = http.post(f"{API}/games/wordsearch/progress/{uid}", json=body, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["points_awarded"] == 25
        assert "nightmare" in d.get("granted", []), d

    def test_daily_completion_sets_is_daily_and_grants_daily_challenge(
        self, http, frankie, db_sync, cleanup_user_state
    ):
        uid = frankie["id"]
        # Use a daily puzzle to get the canonical daily puzzle_id
        daily = http.get(f"{API}/games/wordsearch/daily", timeout=30).json()
        body = {
            "puzzle_id": daily["puzzle_id"],
            "theme": daily["theme"], "difficulty": daily["difficulty"],
            "found_words": daily["words"], "hints_used": 0,
            "seconds": 60, "completed": True, "is_daily": True,
        }
        r = http.post(f"{API}/games/wordsearch/progress/{uid}", json=body, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "daily_challenge" in d.get("granted", []), f"daily_challenge should be granted, got {d}"

        # game_completion has is_daily=True
        comp = db_sync.game_completions.find_one(
            {"user_id": uid, "game_type": "wordsearch"})
        assert comp is not None
        assert comp.get("is_daily") is True

        ach = db_sync.achievements.find_one({"user_id": uid, "key": "daily_challenge"})
        assert ach is not None


# ---------- 5. Regression: /games/dailies + community/today + demo-login ----------


# Existing endpoints shouldn't regress
class TestRegression:
    def test_dailies_includes_all_three(self, http):
        r = http.get(f"{API}/games/dailies", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("jigsaw", "trivia", "wordsearch"):
            assert k in data, f"/games/dailies missing {k}"
        ws = data["wordsearch"]
        assert ws.get("available") is True
        assert "theme" in ws and "difficulty" in ws and "title" in ws

    def test_community_today_ok(self, http):
        r = http.get(f"{API}/community/today", timeout=30)
        assert r.status_code == 200, r.text
        # response shape: dict (don't deeply assert here, just smoke)
        assert isinstance(r.json(), dict)

    def test_frankie_demo_login_ok(self, http):
        r = http.post(f"{API}/auth/demo-login", json={"username": PRIMARY_DEMO}, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "access_token" in body and "user" in body
        assert body["user"]["username"].lower() == PRIMARY_DEMO
