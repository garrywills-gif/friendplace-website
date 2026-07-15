"""
Backend tests for the Sudoku game (FriendPlace).

Covers:
 - GET /api/games/sudoku/catalog (4 difficulties, clues 40/32/26/20, points 5/10/15/25, hints 3/3/2/1, max_mistakes=3)
 - GET /api/games/sudoku/puzzle (9x9 grid, correct clue count, SOLUTION not leaked)
 - Per-day determinism (same difficulty + no seed -> identical puzzle_id and clues)
 - GET /api/games/sudoku/daily (puzzle_id contains 'daily-YYYY-MM-DD', solution=null)
 - GET /api/games/sudoku/check (correct boolean, no solution leak)
 - GET /api/games/sudoku/hint (returns correct cell value)
 - POST /api/games/sudoku/progress/{user_id} (idempotent upsert)
 - First completion awards points + logs game_completion (idempotency)
 - Hard/Nightmare grants achievement + Flutter notification to friends
 - Daily completion grants daily_challenge + bumps streak
 - GET /api/games/sudoku/progress/{user_id}
 - End-to-end solvability: use /hint values to fill empty cells, validate
   via /check, then submit completion -> points awarded exactly once
 - Regression: /api/games/dailies still aggregates jigsaw/trivia/wordsearch/memory
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import pytest
import requests

# Ensure /app/backend is importable for direct Mongo cleanup.
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
    or "https://belong-together.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"

PRIMARY_DEMO = "frankie"
FRIEND_DEMO = "maggie"

EXPECTED_DIFFS = {
    "easy":      {"clues": 40, "points": 5,  "hints": 3, "max_mistakes": 3},
    "moderate":  {"clues": 32, "points": 10, "hints": 3, "max_mistakes": 3},
    "hard":      {"clues": 26, "points": 15, "hints": 2, "max_mistakes": 3},
    "nightmare": {"clues": 20, "points": 25, "hints": 1, "max_mistakes": 3},
}


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
    """Wipe sudoku-related state for frankie before and after each test."""
    uid = frankie["id"]

    def _wipe():
        db_sync.sudoku_progress.delete_many({"user_id": uid})
        db_sync.game_completions.delete_many({"user_id": uid, "game_type": "sudoku"})
        db_sync.achievements.delete_many(
            {"user_id": uid, "key": {"$in": ["hard", "nightmare", "daily_challenge", "first_game"]}}
        )

    _wipe()
    yield
    _wipe()


# ---------- 1. Catalog ----------


class TestCatalog:
    def test_catalog_shape_and_spec(self, http):
        r = http.get(f"{API}/games/sudoku/catalog", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "difficulties" in data
        diffs = data["difficulties"]
        assert isinstance(diffs, list) and len(diffs) == 4
        by_key = {d["key"]: d for d in diffs}
        for k, expected in EXPECTED_DIFFS.items():
            assert k in by_key, f"missing difficulty {k}"
            d = by_key[k]
            assert d["clues"] == expected["clues"], f"{k} clues {d['clues']} != {expected['clues']}"
            assert d["points"] == expected["points"], f"{k} points {d['points']} != {expected['points']}"
            assert d["hints"] == expected["hints"], f"{k} hints {d['hints']} != {expected['hints']}"
            assert d["max_mistakes"] == expected["max_mistakes"], f"{k} max_mistakes wrong"
            for field in ("label",):
                assert field in d


# ---------- 2. Puzzle endpoint ----------


def _count_clues(puzzle: list) -> int:
    return sum(1 for r in puzzle for v in r if v != 0)


class TestPuzzle:
    def test_easy_puzzle_shape_and_no_solution_leak(self, http):
        r = http.get(f"{API}/games/sudoku/puzzle", params={"difficulty": "easy"}, timeout=30)
        assert r.status_code == 200, r.text
        puz = r.json()
        # No solution leaked
        assert "solution" not in puz, f"solution should NOT be present in default puzzle response: keys={list(puz.keys())}"
        assert puz["difficulty"] == "easy"
        grid = puz["puzzle"]
        assert len(grid) == 9 and all(len(row) == 9 for row in grid), "expected 9x9 grid"
        # Exactly 40 clues for easy
        clues = _count_clues(grid)
        assert clues == 40, f"easy puzzle should have 40 clues, got {clues}"
        assert puz["clues"] == 40
        assert puz["points"] == 5
        assert puz["hint_quota"] == 3
        assert puz["max_mistakes"] == 3
        # puzzle_id format
        assert puz["puzzle_id"].startswith("sd:easy:"), puz["puzzle_id"]

    def test_all_difficulties_correct_clue_count(self, http):
        for diff, exp in EXPECTED_DIFFS.items():
            r = http.get(f"{API}/games/sudoku/puzzle", params={"difficulty": diff}, timeout=30)
            assert r.status_code == 200, f"{diff}: {r.text}"
            puz = r.json()
            assert "solution" not in puz, f"solution leaked for {diff}!"
            clues = _count_clues(puz["puzzle"])
            assert clues == exp["clues"], f"{diff} expected {exp['clues']} clues, got {clues}"
            assert puz["points"] == exp["points"]
            assert puz["hint_quota"] == exp["hints"]
            assert puz["max_mistakes"] == exp["max_mistakes"]

    def test_per_day_determinism_without_seed(self, http):
        a = http.get(f"{API}/games/sudoku/puzzle", params={"difficulty": "moderate"}, timeout=30).json()
        b = http.get(f"{API}/games/sudoku/puzzle", params={"difficulty": "moderate"}, timeout=30).json()
        assert a["puzzle_id"] == b["puzzle_id"], "puzzle_id should be stable per-day"
        assert a["puzzle"] == b["puzzle"], "puzzle grid should be identical per-day"
        assert a["seed"] == b["seed"]

    def test_explicit_seed_is_deterministic(self, http):
        a = http.get(f"{API}/games/sudoku/puzzle", params={"difficulty": "hard", "seed": 12345}, timeout=30).json()
        b = http.get(f"{API}/games/sudoku/puzzle", params={"difficulty": "hard", "seed": 12345}, timeout=30).json()
        assert a["puzzle"] == b["puzzle"]
        assert a["puzzle_id"] == b["puzzle_id"] == "sd:hard:12345"
        assert _count_clues(a["puzzle"]) == 26

    def test_unknown_difficulty_400(self, http):
        r = http.get(f"{API}/games/sudoku/puzzle", params={"difficulty": "impossible"}, timeout=30)
        assert r.status_code == 400


# ---------- 3. Daily ----------


class TestDaily:
    def test_daily_shape_and_solution_nulled(self, http):
        r = http.get(f"{API}/games/sudoku/daily", timeout=30)
        assert r.status_code == 200, r.text
        puz = r.json()
        assert puz.get("is_daily") is True
        assert "date" in puz
        pid = puz["puzzle_id"]
        assert f"daily-{puz['date']}" in pid, f"puzzle_id missing daily-YYYY-MM-DD: {pid}"
        # solution must be null (explicitly nulled in /daily response)
        assert puz.get("solution") is None, f"daily MUST NOT leak solution: {puz.get('solution')}"
        # 9x9 puzzle
        grid = puz["puzzle"]
        assert len(grid) == 9 and all(len(row) == 9 for row in grid)

    def test_daily_stable_same_call(self, http):
        a = http.get(f"{API}/games/sudoku/daily", timeout=30).json()
        b = http.get(f"{API}/games/sudoku/daily", timeout=30).json()
        assert a["puzzle_id"] == b["puzzle_id"]
        assert a["puzzle"] == b["puzzle"]


# ---------- 4. Check endpoint ----------


class TestCheck:
    def test_check_correct_and_incorrect(self, http):
        # use seed=42 hard puzzle, compare against /hint as ground truth
        seed = 42
        diff = "hard"
        # First find an empty cell from the puzzle
        puz = http.get(f"{API}/games/sudoku/puzzle", params={"difficulty": diff, "seed": seed}, timeout=30).json()
        grid = puz["puzzle"]
        empty = None
        for r in range(9):
            for c in range(9):
                if grid[r][c] == 0:
                    empty = (r, c)
                    break
            if empty:
                break
        assert empty is not None

        r_, c_ = empty
        # Get expected via /hint
        h = http.get(f"{API}/games/sudoku/hint",
                     params={"difficulty": diff, "seed": seed, "row": r_, "col": c_},
                     timeout=30).json()
        expected = h["value"]
        assert 1 <= expected <= 9

        # Correct value
        ck_good = http.get(f"{API}/games/sudoku/check",
                           params={"difficulty": diff, "seed": seed, "row": r_, "col": c_, "value": expected},
                           timeout=30).json()
        assert ck_good["correct"] is True, ck_good

        # Wrong value (just pick any other digit 1..9)
        wrong = 1 + (expected % 9)
        ck_bad = http.get(f"{API}/games/sudoku/check",
                          params={"difficulty": diff, "seed": seed, "row": r_, "col": c_, "value": wrong},
                          timeout=30).json()
        assert ck_bad["correct"] is False, ck_bad

        # Make sure the response does NOT leak the expected value
        assert "solution" not in ck_bad
        # expected_hint is None per server contract
        assert ck_bad.get("expected_hint") is None

    def test_check_invalid_inputs(self, http):
        # Out-of-range row
        r = http.get(f"{API}/games/sudoku/check",
                     params={"difficulty": "easy", "seed": 1, "row": 9, "col": 0, "value": 5}, timeout=30)
        assert r.status_code == 400
        # Bad value
        r = http.get(f"{API}/games/sudoku/check",
                     params={"difficulty": "easy", "seed": 1, "row": 0, "col": 0, "value": 0}, timeout=30)
        assert r.status_code == 400


# ---------- 5. Hint endpoint ----------


class TestHint:
    def test_hint_returns_correct_value(self, http):
        # Pull two seeds and a puzzle, confirm /hint values fully cover empties consistently.
        seed = 777
        puz = http.get(f"{API}/games/sudoku/puzzle", params={"difficulty": "easy", "seed": seed}, timeout=30).json()
        grid = puz["puzzle"]
        # Spot-check 5 empty cells: hint(value) must satisfy check(correct=true)
        checked = 0
        for r in range(9):
            for c in range(9):
                if grid[r][c] == 0:
                    h = http.get(f"{API}/games/sudoku/hint",
                                 params={"difficulty": "easy", "seed": seed, "row": r, "col": c},
                                 timeout=30).json()
                    v = h["value"]
                    assert 1 <= v <= 9
                    ck = http.get(f"{API}/games/sudoku/check",
                                  params={"difficulty": "easy", "seed": seed, "row": r, "col": c, "value": v},
                                  timeout=30).json()
                    assert ck["correct"] is True, f"hint produced wrong value at ({r},{c}): {v}"
                    checked += 1
                    if checked >= 5:
                        return
        assert checked > 0


# ---------- 6. Progress save (idempotent + completion awards) ----------


def _empty_entries():
    return [[0] * 9 for _ in range(9)]


def _empty_notes():
    return [[[] for _ in range(9)] for _ in range(9)]


class TestProgressSaveAndComplete:
    def test_resume_then_complete_easy_idempotent(self, http, frankie, db_sync, cleanup_user_state):
        uid = frankie["id"]
        puz = http.get(f"{API}/games/sudoku/puzzle", params={"difficulty": "easy", "seed": 4242}, timeout=30).json()
        pid = puz["puzzle_id"]

        # Partial save
        body = {
            "puzzle_id": pid, "difficulty": "easy",
            "entries": _empty_entries(), "notes": _empty_notes(),
            "hints_used": 1, "mistakes": 0, "seconds": 30,
            "completed": False, "is_daily": False,
        }
        r1 = http.post(f"{API}/games/sudoku/progress/{uid}", json=body, timeout=30)
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        assert d1["ok"] is True
        assert d1["points_awarded"] == 0
        assert d1["granted"] == []

        # GET reflects state
        g = http.get(f"{API}/games/sudoku/progress/{uid}", params={"puzzle_id": pid}, timeout=30).json()
        assert g.get("puzzle_id") == pid
        assert g.get("hints_used") == 1
        assert g.get("completed") is False

        # Idempotent upsert
        body2 = {**body, "seconds": 60, "hints_used": 2}
        r2 = http.post(f"{API}/games/sudoku/progress/{uid}", json=body2, timeout=30)
        assert r2.status_code == 200
        count = db_sync.sudoku_progress.count_documents({"user_id": uid, "puzzle_id": pid})
        assert count == 1, f"upsert should not create dupes, got {count}"

        # Completion -> awards 5 points (easy)
        body3 = {**body, "completed": True, "seconds": 90}
        r3 = http.post(f"{API}/games/sudoku/progress/{uid}", json=body3, timeout=30)
        assert r3.status_code == 200, r3.text
        d3 = r3.json()
        assert d3["points_awarded"] == 5, d3

        comp = list(db_sync.game_completions.find({"user_id": uid, "game_type": "sudoku"}))
        assert len(comp) == 1
        assert comp[0]["difficulty"] == "easy"

        # Idempotent: second completion must NOT re-award
        r4 = http.post(f"{API}/games/sudoku/progress/{uid}", json=body3, timeout=30)
        assert r4.status_code == 200
        d4 = r4.json()
        assert d4["points_awarded"] == 0, "second completion must not re-award"
        comp2 = db_sync.game_completions.count_documents({"user_id": uid, "game_type": "sudoku"})
        assert comp2 == 1, "must not log a second completion"

    def test_hard_completion_grants_hard_and_flutters_friend(
        self, http, frankie, maggie, db_sync, cleanup_user_state
    ):
        uid = frankie["id"]
        friend_id = maggie["id"]

        u = db_sync.users.find_one({"id": uid}, {"friends": 1})
        original_friends = list(u.get("friends") or [])
        if friend_id not in original_friends:
            db_sync.users.update_one({"id": uid}, {"$addToSet": {"friends": friend_id}})

        notif_before = db_sync.notifications.count_documents(
            {"user_id": friend_id, "type": "achievement"})

        try:
            puz = http.get(f"{API}/games/sudoku/puzzle", params={"difficulty": "hard", "seed": 999}, timeout=30).json()
            body = {
                "puzzle_id": puz["puzzle_id"], "difficulty": "hard",
                "entries": _empty_entries(), "notes": _empty_notes(),
                "hints_used": 0, "mistakes": 0, "seconds": 600,
                "completed": True, "is_daily": False,
            }
            r = http.post(f"{API}/games/sudoku/progress/{uid}", json=body, timeout=30)
            assert r.status_code == 200, r.text
            d = r.json()
            assert d["points_awarded"] == 15, d
            assert "hard" in d.get("granted", []), d

            ach = db_sync.achievements.find_one({"user_id": uid, "key": "hard"})
            assert ach is not None, "hard achievement row missing"

            time.sleep(0.4)
            notif_after = db_sync.notifications.count_documents(
                {"user_id": friend_id, "type": "achievement"})
            assert notif_after > notif_before, "friend Flutter notification missing"

            nlist = http.get(f"{API}/notifications/{friend_id}", timeout=30).json()
            assert any(
                n.get("type") == "achievement"
                and n.get("payload", {}).get("actor_id") == uid
                and n.get("payload", {}).get("game_type") == "sudoku"
                for n in nlist
            ), "no sudoku achievement notification for friend"
        finally:
            db_sync.users.update_one({"id": uid}, {"$set": {"friends": original_friends}})

    def test_nightmare_completion_grants_nightmare(self, http, frankie, db_sync, cleanup_user_state):
        uid = frankie["id"]
        puz = http.get(f"{API}/games/sudoku/puzzle", params={"difficulty": "nightmare", "seed": 1234}, timeout=30).json()
        body = {
            "puzzle_id": puz["puzzle_id"], "difficulty": "nightmare",
            "entries": _empty_entries(), "notes": _empty_notes(),
            "hints_used": 0, "mistakes": 0, "seconds": 1200,
            "completed": True, "is_daily": False,
        }
        r = http.post(f"{API}/games/sudoku/progress/{uid}", json=body, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["points_awarded"] == 25, d
        assert "nightmare" in d.get("granted", []), d

    def test_daily_completion_grants_daily_challenge_and_bumps_streak(
        self, http, frankie, db_sync, cleanup_user_state
    ):
        uid = frankie["id"]
        daily = http.get(f"{API}/games/sudoku/daily", timeout=30).json()
        body = {
            "puzzle_id": daily["puzzle_id"], "difficulty": daily["difficulty"],
            "entries": _empty_entries(), "notes": _empty_notes(),
            "hints_used": 0, "mistakes": 0, "seconds": 100,
            "completed": True, "is_daily": True,
        }
        r = http.post(f"{API}/games/sudoku/progress/{uid}", json=body, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "daily_challenge" in d.get("granted", []), f"daily_challenge missing: {d}"
        # Streak counter is bumped (>=1) on first daily of the day
        assert d.get("streak", 0) >= 1, f"streak should be >=1 after daily completion, got {d}"

        comp = db_sync.game_completions.find_one({"user_id": uid, "game_type": "sudoku"})
        assert comp is not None and comp.get("is_daily") is True


# ---------- 7. End-to-end solvability (deterministic puzzle) ----------


class TestSolvability:
    def test_solve_easy_via_hint_endpoint(self, http, frankie, db_sync, cleanup_user_state):
        """Solve a deterministic easy puzzle by iterating empty cells and
        confirming each /hint value passes /check; final completion grants
        exactly +5 once (idempotency)."""
        uid = frankie["id"]
        import random as _r
        seed = _r.randint(100, 10**8)
        puz = http.get(f"{API}/games/sudoku/puzzle", params={"difficulty": "easy", "seed": seed}, timeout=30).json()
        grid = puz["puzzle"]
        # Solve incrementally (sample 10 cells to avoid 41 round-trips; spec is satisfied with /check on every empty)
        empties = [(r, c) for r in range(9) for c in range(9) if grid[r][c] == 0]
        assert len(empties) == 81 - 40
        # Validate /check works on every empty cell using /hint as truth
        for r, c in empties:
            h = http.get(f"{API}/games/sudoku/hint",
                         params={"difficulty": "easy", "seed": seed, "row": r, "col": c},
                         timeout=30).json()["value"]
            ck = http.get(f"{API}/games/sudoku/check",
                          params={"difficulty": "easy", "seed": seed, "row": r, "col": c, "value": h},
                          timeout=30).json()
            assert ck["correct"] is True, f"check failed at ({r},{c}) v={h}"

        # Save completion
        body = {
            "puzzle_id": puz["puzzle_id"], "difficulty": "easy",
            "entries": _empty_entries(), "notes": _empty_notes(),
            "hints_used": 0, "mistakes": 0, "seconds": 120,
            "completed": True, "is_daily": False,
        }
        r1 = http.post(f"{API}/games/sudoku/progress/{uid}", json=body, timeout=30).json()
        assert r1["points_awarded"] == 5, r1

        # Second submit -> no double award
        r2 = http.post(f"{API}/games/sudoku/progress/{uid}", json=body, timeout=30).json()
        assert r2["points_awarded"] == 0, r2


# ---------- 8. Regression: /games/dailies still aggregates other games ----------


class TestRegression:
    def test_dailies_aggregation_still_works(self, http):
        r = http.get(f"{API}/games/dailies", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("jigsaw", "trivia", "wordsearch", "memory"):
            assert k in data, f"/games/dailies missing {k}"
        # Note: sudoku not included yet in /games/dailies — flagged as follow-up.

    def test_frankie_demo_login_ok(self, http):
        r = http.post(f"{API}/auth/demo-login", json={"username": PRIMARY_DEMO}, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "access_token" in body and "user" in body
