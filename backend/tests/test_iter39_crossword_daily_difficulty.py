"""Iter39 — Crossword Daily difficulty bump regression.

After the refactor in `crossword_puzzles.daily_puzzle()`:
  * Daily puzzle MUST come from HARD_PUZZLES or EXPERT_PUZZLES — never medium.
  * The library (/levels + /active/<level>) must still expose all four
    levels (easy/medium/hard/expert) unchanged.
  * Single-puzzle GET, check, and reveal (a.k.a. "hint") must still work
    for arbitrary puzzles.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"
API = f"{BASE_URL}/api"


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


# ── Daily must now be Hard or Expert ─────────────────────────────────
class TestDailyDifficulty:
    def test_daily_level_is_hard_or_expert(self, session):
        r = session.get(f"{API}/games/crossword/daily")
        assert r.status_code == 200, r.text
        d = r.json()
        p = d["puzzle"]
        assert p["level"] in ("hard", "expert"), (
            f"Daily puzzle level must be hard|expert, got {p['level']} "
            f"(theme={p.get('theme')!r}, id={p.get('id')!r})"
        )

    def test_daily_envelope_has_table_and_date(self, session):
        r = session.get(f"{API}/games/crossword/daily")
        assert r.status_code == 200, r.text
        d = r.json()
        # date is today UTC ISO
        from datetime import datetime, timezone
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        assert d["date"] == today
        # discussion table id is a non-empty string
        assert isinstance(d["discussion_table_id"], str)
        assert len(d["discussion_table_id"]) >= 10
        # answers stripped from clues
        for direction in ("across", "down"):
            for cl in d["puzzle"]["clues"].get(direction, []):
                assert "answer" not in cl, cl
        # Theme must NOT be one of the MEDIUM theme names — sanity
        # check that the previous medium pool is no longer surfaced.
        medium_themes = {
            "Aussie Slang", "Aussie Birds", "Tea Time", "Holidays",
            "Travel", "Sports", "Around the House", "Friends & Family",
        }
        assert d["puzzle"]["theme"] not in medium_themes, (
            f"Daily theme {d['puzzle']['theme']!r} is from MEDIUM pool"
        )

    def test_daily_points_match_level(self, session):
        r = session.get(f"{API}/games/crossword/daily")
        assert r.status_code == 200, r.text
        d = r.json()
        # hard => 15 + 5 (daily) = 20, expert => 25 + 5 = 30
        expected = 20 if d["puzzle"]["level"] == "hard" else 30
        assert d["points"] == expected, d


# ── Library (/levels + /active/<level>) still has all 4 levels ──────
class TestLibraryUnchanged:
    def test_levels_endpoint_still_shows_all_four(self, session):
        r = session.get(f"{API}/games/crossword/levels")
        assert r.status_code == 200, r.text
        data = r.json()
        by_lvl = {l["level"]: l for l in data["levels"]}
        for lvl in ("easy", "medium", "hard", "expert"):
            assert lvl in by_lvl, f"missing level {lvl}"
            assert by_lvl[lvl]["library_total"] >= 4, by_lvl[lvl]

    @pytest.mark.parametrize("level", ["easy", "medium", "hard", "expert"])
    def test_active_endpoint_per_level(self, session, level):
        r = session.get(f"{API}/games/crossword/active/{level}")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["level"] == level
        assert len(d["puzzles"]) >= 1
        for p in d["puzzles"]:
            assert p["level"] == level
            # Answers stripped
            for cl in p["clues"].get("across", []):
                assert "answer" not in cl


# ── Single puzzle GET still works for arbitrary ids ─────────────────
class TestSinglePuzzleStillWorks:
    @pytest.mark.parametrize("pid", ["easy-001", "medium-001", "hard-001", "expert-001"])
    def test_get_puzzle_returns_sanitised(self, session, pid):
        r = session.get(f"{API}/games/crossword/{pid}")
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["id"] == pid
        assert p["level"] == pid.split("-")[0]
        for direction in ("across", "down"):
            for cl in p["clues"].get(direction, []):
                assert "answer" not in cl, cl


# ── Check + Reveal (a.k.a. "hint") still work ───────────────────────
class TestCheckAndReveal:
    def test_check_wrong_marks_status(self, session):
        r0 = session.get(f"{API}/games/crossword/easy-002")
        assert r0.status_code == 200, r0.text
        p = r0.json()
        size = p["size"]
        # Empty guesses should never be solved
        guesses = [["" for _ in range(size)] for _ in range(size)]
        r = session.post(
            f"{API}/games/crossword/easy-002/check", json={"guesses": guesses}
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["solved"] is False
        # status grid should be present and shaped like the puzzle
        assert len(d["status"]) == size
        assert len(d["status"][0]) == size

    def test_reveal_first_letter_cell(self, session):
        r0 = session.get(f"{API}/games/crossword/hard-001")
        assert r0.status_code == 200
        p = r0.json()
        target = None
        for row in range(p["size"]):
            for col in range(p["size"]):
                if p["grid"][row][col]:
                    target = (row, col, p["grid"][row][col])
                    break
            if target:
                break
        assert target is not None
        row, col, letter = target
        r = session.get(f"{API}/games/crossword/hard-001/reveal/{row}/{col}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body == {"row": row, "col": col, "letter": letter}


# ── Daily Coffee Lounge table description copy ──────────────────────
class TestDailyTableCopy:
    def test_table_description_mentions_tough(self, session):
        d = session.get(f"{API}/games/crossword/daily")
        assert d.status_code == 200
        table_id = d.json()["discussion_table_id"]
        r = session.get(f"{API}/tables")
        assert r.status_code == 200
        tables = r.json()
        if isinstance(tables, dict):
            tables = tables.get("tables") or tables.get("items") or []
        match = [t for t in tables if t.get("id") == table_id]
        assert match, f"Daily Crossword table {table_id} missing from /tables"
        t = match[0]
        desc = t.get("description", "")
        # The new copy must reference "tough" or "brain-teaser" per the brief.
        assert ("tough" in desc.lower()) or ("brain-teaser" in desc.lower()), (
            f"Daily table description does not reflect new tougher copy: {desc!r}"
        )
