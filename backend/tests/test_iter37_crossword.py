"""Iter37 — Crossword feature (hub + daily + interactive play) backend tests.

Covers:
  - GET /api/games/crossword/levels (4 levels, points, library/active counts)
  - GET /api/games/crossword/daily (date, sanitised puzzle, table id, points)
  - GET /api/games/crossword/active/{level} (3 active per level)
  - GET /api/games/crossword/{puzzle_id} (answers stripped)
  - POST /api/games/crossword/{puzzle_id}/check (correct → points one-off; wrong)
  - GET /api/games/crossword/{puzzle_id}/reveal/{r}/{c}
  - POST + GET /api/games/crossword/progress/{user_id}
  - GET /api/tables surfaces the persistent "Today's Crossword" Coffee Lounge table
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"

API = f"{BASE_URL}/api"


# ── Fixtures ──────────────────────────────────────────────────────────
@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def maggie_id(session):
    r = session.post(f"{API}/auth/demo-login", json={"username": "maggie"})
    assert r.status_code == 200, r.text
    return r.json()["user"]["id"]


# Wipe any prior xword completion + progress markers for maggie so tests are
# deterministic when run repeatedly (point award is once-per-user-per-puzzle).
@pytest.fixture(scope="session", autouse=True)
def _reset_maggie_xword(maggie_id):
    try:
        from motor.motor_asyncio import AsyncIOMotorClient
        import asyncio
        mongo_url = os.environ.get("MONGO_URL")
        db_name = os.environ.get("DB_NAME")
        if not mongo_url or not db_name:
            # Try reading backend/.env directly
            from pathlib import Path
            env = Path(__file__).resolve().parent.parent / ".env"
            for ln in env.read_text().splitlines():
                if ln.startswith("MONGO_URL="):
                    mongo_url = ln.split("=", 1)[1].strip().strip('"').strip("'")
                elif ln.startswith("DB_NAME="):
                    db_name = ln.split("=", 1)[1].strip().strip('"').strip("'")
        if mongo_url and db_name:
            async def _wipe():
                cli = AsyncIOMotorClient(mongo_url)
                db = cli[db_name]
                await db.game_completions.delete_many(
                    {"key": {"$regex": f"^xword:{maggie_id}:"}}
                )
                await db.crossword_progress.delete_many({"user_id": maggie_id})
                cli.close()
            asyncio.get_event_loop().run_until_complete(_wipe()) if False else asyncio.run(_wipe())
    except Exception as e:
        print(f"(non-fatal) reset failed: {e}")
    yield


# ── Levels ─────────────────────────────────────────────────────────────
class TestLevels:
    def test_returns_four_levels(self, session):
        r = session.get(f"{API}/games/crossword/levels")
        assert r.status_code == 200, r.text
        data = r.json()
        levels = data["levels"]
        assert len(levels) == 4
        by_lvl = {l["level"]: l for l in levels}
        # Points
        assert by_lvl["easy"]["points"] == 5
        assert by_lvl["medium"]["points"] == 10
        assert by_lvl["hard"]["points"] == 15
        assert by_lvl["expert"]["points"] == 25
        # Library 8 each, active 3 each
        for lvl in ("easy", "medium", "hard", "expert"):
            assert by_lvl[lvl]["library_total"] == 8, lvl
            assert by_lvl[lvl]["active_count"] == 3, lvl
        # Iter38 polish — 4 levels × 8 puzzles = 32 total
        total_library = sum(l["library_total"] for l in levels)
        assert total_library == 32, total_library
        assert data["rotation_days"] == 14


# ── Daily ─────────────────────────────────────────────────────────────
class TestDaily:
    def test_daily_puzzle_envelope(self, session):
        r = session.get(f"{API}/games/crossword/daily")
        assert r.status_code == 200, r.text
        d = r.json()
        # date
        from datetime import datetime, timezone
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        assert d["date"] == today
        # puzzle is medium and has no `answer` leaks
        p = d["puzzle"]
        assert p["level"] == "medium"
        for direction in ("across", "down"):
            for cl in p["clues"].get(direction, []):
                assert "answer" not in cl, f"answer leaked in clue {cl}"
        # discussion table id is a string (uuid)
        assert isinstance(d["discussion_table_id"], str)
        assert len(d["discussion_table_id"]) >= 10
        # points = 10 (medium) + 5 (daily bonus) = 15
        assert d["points"] == 15


# ── Active list ───────────────────────────────────────────────────────
class TestActive:
    def test_medium_active_has_three(self, session):
        r = session.get(f"{API}/games/crossword/active/medium")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["level"] == "medium"
        assert len(d["puzzles"]) == 3
        # Answers stripped
        for p in d["puzzles"]:
            for cl in p["clues"].get("across", []):
                assert "answer" not in cl


# ── Single puzzle ─────────────────────────────────────────────────────
class TestSinglePuzzle:
    def test_easy_001_garden(self, session):
        r = session.get(f"{API}/games/crossword/easy-001")
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["id"] == "easy-001"
        assert p["level"] == "easy"
        assert p["theme"] == "Garden"
        # Iter38 polish — easy-001 grid is at least 9 wide (was 5)
        assert p["size"] >= 9, p["size"]
        # Answers stripped from clues
        for direction in ("across", "down"):
            for cl in p["clues"].get(direction, []):
                assert "answer" not in cl, cl
        # Should have several across + down clues now
        assert len(p["clues"]["across"]) >= 2
        assert len(p["clues"]["down"]) >= 1

    # Iter38 polish — Expert puzzles expanded to dense 14×14+ grids with ≥10 clues
    def test_expert_001_is_dense(self, session):
        r = session.get(f"{API}/games/crossword/expert-001")
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["id"] == "expert-001"
        assert p["level"] == "expert"
        # Grid is at least 14×14
        assert p["size"] >= 14, p["size"]
        assert len(p["grid"]) >= 14
        assert len(p["grid"][0]) >= 14
        # ≥10 clues total (much denser than before)
        total_clues = (
            len(p["clues"].get("across", []))
            + len(p["clues"].get("down", []))
        )
        assert total_clues >= 10, total_clues
        # Answers still stripped
        for direction in ("across", "down"):
            for cl in p["clues"].get(direction, []):
                assert "answer" not in cl, cl


# ── Check (correct + idempotent points) ───────────────────────────────
class TestCheckCorrect:
    @staticmethod
    def _correct_grid_from_api(session):
        """Fetch easy-001 from the API and convert the served grid (with
        letters + nulls for blocks) into a guesses array (letters + '')."""
        r = session.get(f"{API}/games/crossword/easy-001")
        assert r.status_code == 200, r.text
        p = r.json()
        size = p["size"]
        grid_in = p["grid"]
        g = [["" for _ in range(size)] for _ in range(size)]
        for row in range(size):
            for col in range(size):
                cell = grid_in[row][col]
                if cell:
                    g[row][col] = cell
        return g

    def test_correct_awards_points_once(self, session, maggie_id):
        guesses = self._correct_grid_from_api(session)
        r1 = session.post(
            f"{API}/games/crossword/easy-001/check",
            json={"guesses": guesses, "user_id": maggie_id},
        )
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        assert d1["solved"] is True, d1
        assert d1["points_awarded"] is True, d1
        assert d1["points"] == 5

        # Second time — solved still true, but no re-award
        r2 = session.post(
            f"{API}/games/crossword/easy-001/check",
            json={"guesses": guesses, "user_id": maggie_id},
        )
        assert r2.status_code == 200, r2.text
        d2 = r2.json()
        assert d2["solved"] is True
        assert d2["points_awarded"] is False
        assert d2["points"] == 0


# ── Check (wrong letters) ─────────────────────────────────────────────
class TestCheckWrong:
    def test_wrong_letters_marked(self, session):
        # Build correct grid from API then corrupt one letter cell.
        r = session.get(f"{API}/games/crossword/easy-001")
        assert r.status_code == 200, r.text
        p = r.json()
        size = p["size"]
        grid_in = p["grid"]
        g = [["" for _ in range(size)] for _ in range(size)]
        first_letter_cell = None
        blocked_cell = None
        for row in range(size):
            for col in range(size):
                cell = grid_in[row][col]
                if cell:
                    g[row][col] = cell
                    if first_letter_cell is None:
                        first_letter_cell = (row, col)
                else:
                    if blocked_cell is None:
                        blocked_cell = (row, col)
        assert first_letter_cell is not None
        assert blocked_cell is not None
        # Pick a SECOND letter cell to keep correct for the "correct" assertion
        # and corrupt the first one.
        fr, fc = first_letter_cell
        correct_letter = g[fr][fc]
        # Use a letter guaranteed to differ
        wrong_letter = "Q" if correct_letter != "Q" else "Z"
        g[fr][fc] = wrong_letter

        r = session.post(
            f"{API}/games/crossword/easy-001/check", json={"guesses": g}
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["solved"] is False
        # Per-cell statuses
        assert d["status"][fr][fc] == "wrong"
        br, bc = blocked_cell
        assert d["status"][br][bc] == "blocked"


# ── Reveal ─────────────────────────────────────────────────────────────
class TestReveal:
    def test_reveal_first_letter_cell(self, session):
        # Find the first non-blocked cell in easy-001 and assert reveal
        # returns the letter that is in the API grid for that cell.
        r0 = session.get(f"{API}/games/crossword/easy-001")
        assert r0.status_code == 200
        p = r0.json()
        grid_in = p["grid"]
        target = None
        for row in range(p["size"]):
            for col in range(p["size"]):
                if grid_in[row][col]:
                    target = (row, col, grid_in[row][col])
                    break
            if target:
                break
        assert target is not None
        row, col, letter = target
        r = session.get(
            f"{API}/games/crossword/easy-001/reveal/{row}/{col}"
        )
        assert r.status_code == 200, r.text
        assert r.json() == {"row": row, "col": col, "letter": letter}

    def test_reveal_blocked_cell_400(self, session):
        # Find a blocked cell and assert 400.
        r0 = session.get(f"{API}/games/crossword/easy-001")
        assert r0.status_code == 200
        p = r0.json()
        grid_in = p["grid"]
        blocked = None
        for row in range(p["size"]):
            for col in range(p["size"]):
                if not grid_in[row][col]:
                    blocked = (row, col)
                    break
            if blocked:
                break
        assert blocked is not None
        r = session.get(
            f"{API}/games/crossword/easy-001/reveal/{blocked[0]}/{blocked[1]}"
        )
        assert r.status_code == 400


# ── Progress save / load ──────────────────────────────────────────────
class TestProgress:
    def test_save_then_get(self, session, maggie_id):
        guesses = [["" for _ in range(5)] for _ in range(5)]
        guesses[0][0] = "R"
        guesses[0][1] = "O"
        revealed = [[False] * 5 for _ in range(5)]
        revealed[0][0] = True
        body = {
            "puzzle_id": "easy-001",
            "guesses": guesses,
            "revealed": revealed,
            "seconds": 42,
            "completed": False,
        }
        r = session.post(
            f"{API}/games/crossword/progress/{maggie_id}", json=body
        )
        assert r.status_code == 200, r.text
        assert r.json() == {"ok": True}

        g = session.get(
            f"{API}/games/crossword/progress/{maggie_id}",
            params={"puzzle_id": "easy-001"},
        )
        assert g.status_code == 200, g.text
        saved = g.json()
        assert saved["puzzle_id"] == "easy-001"
        assert saved["seconds"] == 42
        assert saved["completed"] is False
        assert saved["guesses"][0][0] == "R"
        assert saved["guesses"][0][1] == "O"
        assert saved["revealed"][0][0] is True


# ── Tables listing surfaces the Daily Crossword table ─────────────────
class TestDailyTable:
    def test_today_crossword_table_listed(self, session):
        # First hit /daily so the table is materialised.
        d = session.get(f"{API}/games/crossword/daily")
        assert d.status_code == 200
        table_id = d.json()["discussion_table_id"]

        # Then GET /api/tables and confirm the table exists with the flags.
        r = session.get(f"{API}/tables")
        assert r.status_code == 200, r.text
        tables = r.json()
        # Endpoint may return list or {tables: [...]}
        if isinstance(tables, dict):
            tables = tables.get("tables") or tables.get("items") or []
        match = [t for t in tables if t.get("id") == table_id]
        assert match, f"Daily Crossword table {table_id} not in /api/tables listing"
        t = match[0]
        assert t.get("daily_crossword") is True
        assert t.get("persistent") is True
        assert t.get("visibility") == "public"
        assert "Today's Crossword" in t.get("name", "")
