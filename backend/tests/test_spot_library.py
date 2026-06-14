"""Spot the Difference — Curated Library backend tests (iteration 19).

Covers:
- GET /api/games/spot/library  (active puzzles, no Christmas in June)
- GET /api/games/spot/library/{id}  (full playable puzzle)
- GET /api/games/spot/library/p999  (404)
- GET /api/games/spot/daily  (curated rotation, lib: prefix)
- GET /api/games/spot/catalog  (legacy unaffected)
- GET /api/games/spot/puzzle?theme=&difficulty=  (legacy unaffected)
- POST /api/games/spot/progress/{uid} for a lib:p003:* puzzle_id + GET persistence
- Hard difficulty completion → points granted
- Static /api/static/spot_bg/library/*.jpg  (200 OK + jpeg content-type)
"""
import os
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


# --- Fixtures ---------------------------------------------------------------
@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def demo_user(s):
    r = s.post(f"{API}/auth/demo-login", json={"username": "maggie"})
    assert r.status_code == 200, f"demo-login failed: {r.status_code} {r.text}"
    data = r.json()
    return data["user"]


# --- Library list -----------------------------------------------------------
class TestLibraryList:
    def test_library_list_returns_12_launch_puzzles(self, s):
        r = s.get(f"{API}/games/spot/library")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "puzzles" in data and isinstance(data["puzzles"], list)
        ids = [p["id"] for p in data["puzzles"]]
        # 12 launch puzzles always; Christmas (x001,x002) only Nov 25–Jan 5.
        # Today is mid-June 2026 → no Christmas.
        assert "x001" not in ids
        assert "x002" not in ids
        # Spot-check core launch puzzles present
        for required in ["p001", "p002", "p003", "p010", "p012"]:
            assert required in ids, f"Missing launch puzzle {required}; got {ids}"
        assert len(data["puzzles"]) == 12, f"Expected 12 active puzzles, got {len(data['puzzles'])}: {ids}"

    def test_library_card_shape(self, s):
        r = s.get(f"{API}/games/spot/library")
        cards = r.json()["puzzles"]
        c = next(c for c in cards if c["id"] == "p003")
        assert c["title"] == "Sunset at the beach"
        assert c["photo_url"] == "/api/static/spot_bg/library/beach_sunset.jpg"
        assert c["theme"] == "beaches"
        assert c["difficulty"] == "easy"
        assert c["season"] is None


# --- Library puzzle GET -----------------------------------------------------
class TestLibraryPuzzle:
    def test_get_p003_playable(self, s):
        r = s.get(f"{API}/games/spot/library/p003")
        assert r.status_code == 200, r.text
        p = r.json()
        assert p.get("title") == "Sunset at the beach"
        assert p.get("background_url") == "/api/static/spot_bg/library/beach_sunset.jpg"
        assert isinstance(p.get("scene_a"), list) and len(p["scene_a"]) > 0
        assert isinstance(p.get("scene_b"), list) and len(p["scene_b"]) > 0
        assert isinstance(p.get("differences"), list)
        assert p.get("diff_count") == len(p["differences"])
        assert p["diff_count"] > 0
        assert isinstance(p.get("puzzle_id"), str) and p["puzzle_id"].startswith("lib:p003:")

    def test_get_p003_deterministic_same_day(self, s):
        a = s.get(f"{API}/games/spot/library/p003").json()
        b = s.get(f"{API}/games/spot/library/p003").json()
        assert a["puzzle_id"] == b["puzzle_id"]
        assert [d.get("id") for d in a["differences"]] == [d.get("id") for d in b["differences"]]

    def test_get_p999_404(self, s):
        r = s.get(f"{API}/games/spot/library/p999")
        assert r.status_code == 404


# --- Daily ------------------------------------------------------------------
class TestDaily:
    def test_daily_is_curated(self, s):
        r = s.get(f"{API}/games/spot/daily")
        assert r.status_code == 200, r.text
        p = r.json()
        assert p.get("is_daily") is True
        # Library rotation → puzzle_id starts with "lib:"
        assert isinstance(p.get("puzzle_id"), str)
        assert p["puzzle_id"].startswith("lib:"), f"daily puzzle_id should start lib:, got {p['puzzle_id']}"
        assert p.get("title"), "daily should have a curated title"
        assert isinstance(p.get("background_url"), str)
        assert p["background_url"].startswith("/api/static/spot_bg/library/")
        # season key present (may be None or 'christmas' etc.)
        assert "season" in p
        # season must be None today (mid-June, no seasonal active)
        assert p.get("season") is None


# --- Legacy unaffected ------------------------------------------------------
class TestLegacy:
    def test_catalog_still_works(self, s):
        r = s.get(f"{API}/games/spot/catalog")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "themes" in data and isinstance(data["themes"], list) and len(data["themes"]) > 0
        assert "difficulties" in data and isinstance(data["difficulties"], list) and len(data["difficulties"]) > 0

    def test_legacy_puzzle_random_still_works(self, s):
        r = s.get(f"{API}/games/spot/puzzle", params={"theme": "beaches", "difficulty": "easy"})
        assert r.status_code == 200, r.text
        p = r.json()
        assert p.get("puzzle_id", "").startswith("std:beaches:easy:"), f"legacy puzzle_id: {p.get('puzzle_id')}"
        assert isinstance(p.get("differences"), list) and len(p["differences"]) > 0


# --- Progress + points (lib puzzle) -----------------------------------------
class TestProgress:
    def test_save_and_get_progress_for_lib_puzzle(self, s, demo_user):
        # 1) Pull p003 puzzle to get a real lib puzzle_id + diff ids
        puz = s.get(f"{API}/games/spot/library/p003").json()
        puzzle_id = puz["puzzle_id"]
        assert puzzle_id.startswith("lib:p003:")
        uid = demo_user["id"]

        # 2) Save partial progress (not complete) for easy difficulty
        body = {
            "puzzle_id": puzzle_id,
            "theme": "beaches",
            "difficulty": "easy",
            "found_ids": [puz["differences"][0]["id"]],
            "hints_used": 0,
            "seconds": 5,
            "completed": False,
            "is_daily": False,
            "beat_the_clock": False,
        }
        r = s.post(f"{API}/games/spot/progress/{uid}", json=body)
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["ok"] is True
        # not completed → no points
        assert out.get("points_awarded", 0) == 0

        # 3) GET persistence
        r2 = s.get(f"{API}/games/spot/progress/{uid}", params={"puzzle_id": puzzle_id})
        assert r2.status_code == 200, r2.text
        got = r2.json()
        assert got.get("puzzle_id") == puzzle_id
        assert got.get("theme") == "beaches"
        assert got.get("difficulty") == "easy"
        assert got.get("found_ids") == body["found_ids"]
        assert got.get("completed") is False

    def test_complete_hard_lib_puzzle_grants_points(self, s, demo_user):
        # p003 is 'easy' in the library, but the progress endpoint accepts whatever
        # difficulty the player picked — we test Hard awards points.
        puz = s.get(f"{API}/games/spot/library/p003").json()
        # Use a unique puzzle_id (different seed) so completion is fresh for this test
        unique_puzzle_id = f"lib:p003:test-hard-{os.getpid()}"
        uid = demo_user["id"]

        # Snapshot points before
        me_before = s.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {demo_user.get('id','')}"})
        # Auth/me may not work with id-as-token; use direct user lookup endpoint or skip pre-check.
        # We rely on response.points_awarded > 0 instead.

        body = {
            "puzzle_id": unique_puzzle_id,
            "theme": "beaches",
            "difficulty": "hard",
            "found_ids": [d["id"] for d in puz["differences"]],
            "hints_used": 0,
            "seconds": 60,
            "completed": True,
            "is_daily": False,
            "beat_the_clock": False,
        }
        r = s.post(f"{API}/games/spot/progress/{uid}", json=body)
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["ok"] is True
        # Hard difficulty must grant > 0 points per backend spec
        assert out.get("points_awarded", 0) > 0, f"Hard completion granted 0 points: {out}"

        # Re-submitting same completion should NOT double-award
        r2 = s.post(f"{API}/games/spot/progress/{uid}", json=body)
        assert r2.status_code == 200
        out2 = r2.json()
        assert out2.get("points_awarded", 0) == 0, f"Re-submit awarded points again: {out2}"

    def test_easy_lib_completion_no_points(self, s, demo_user):
        puz = s.get(f"{API}/games/spot/library/p003").json()
        unique_puzzle_id = f"lib:p003:test-easy-{os.getpid()}"
        uid = demo_user["id"]
        body = {
            "puzzle_id": unique_puzzle_id,
            "theme": "beaches",
            "difficulty": "easy",
            "found_ids": [d["id"] for d in puz["differences"]],
            "hints_used": 0,
            "seconds": 30,
            "completed": True,
            "is_daily": False,
            "beat_the_clock": False,
        }
        r = s.post(f"{API}/games/spot/progress/{uid}", json=body)
        assert r.status_code == 200, r.text
        # Easy awards 0 points per spec (only Hard & Nightmare)
        assert r.json().get("points_awarded", 0) == 0


# --- Static photos ----------------------------------------------------------
class TestStaticPhotos:
    @pytest.mark.parametrize("photo", [
        "beach_sunset.jpg",
        "garden_morning.jpg",
        "cafe_window.jpg",
        "kitchen_baking.jpg",
        "trail_eucalypt.jpg",
    ])
    def test_static_photo_200(self, s, photo):
        r = s.get(f"{API}/static/spot_bg/library/{photo}")
        assert r.status_code == 200, f"{photo}: {r.status_code}"
        ct = r.headers.get("content-type", "")
        assert "image" in ct.lower(), f"{photo} content-type: {ct}"
        assert len(r.content) > 1000, f"{photo} suspiciously small: {len(r.content)} bytes"
