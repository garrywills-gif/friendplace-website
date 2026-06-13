"""Backend tests for the Trivia Game feature in YouBelong's Games Hub.

Covers:
- Catalog (categories, difficulties, difficulty_meta with points)
- Daily Trivia (deterministic question_ids, length 10)
- Start session (no answer leak)
- Submit answer (correct=true / correct=false, score & advance)
- Complete session (Butterfly Points by difficulty, first_game + hard/nightmare achievements)
- Sessions list + stats aggregation
"""

import os
import time
import pytest
import requests

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"


# ----------------------------- fixtures -----------------------------
@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers["Content-Type"] = "application/json"
    return sess


@pytest.fixture(scope="session")
def demo_user(s):
    # Use a demo account from /app/memory/test_credentials.md
    r = s.post(f"{API}/auth/demo-login", json={"username": "billdo"})
    assert r.status_code == 200, r.text
    body = r.json()
    return body["user"]


# ----------------------------- catalog ------------------------------
class TestTriviaCatalog:
    def test_catalog_shape(self, s):
        r = s.get(f"{API}/games/trivia/catalog")
        assert r.status_code == 200
        data = r.json()
        # 7 mandated categories
        assert set(data["categories"]) == {
            "Australia", "History", "Music", "Movies",
            "Sport", "Gardening", "General Knowledge",
        }, data["categories"]
        # 4 mandated difficulties
        assert data["difficulties"] == ["easy", "moderate", "hard", "nightmare"]
        # difficulty_meta carries points
        meta = {m["key"]: m for m in data["difficulty_meta"]}
        assert meta["easy"]["points"] == 5
        assert meta["moderate"]["points"] == 10
        assert meta["hard"]["points"] == 20
        assert meta["nightmare"]["points"] == 35
        # counts present
        assert "counts" in data and "Australia" in data["counts"]


# ----------------------------- daily --------------------------------
class TestTriviaDaily:
    def test_daily_ten_questions_and_deterministic(self, s):
        r1 = s.get(f"{API}/games/trivia/daily").json()
        r2 = s.get(f"{API}/games/trivia/daily").json()
        assert len(r1["question_ids"]) == 10
        assert r1["count"] == 10
        # Deterministic for the same date
        assert r1["question_ids"] == r2["question_ids"]
        # Questions must not include 'answer' field
        for q in r1["questions"]:
            assert "answer" not in q, q


# ------------------------- start / answer ---------------------------
class TestTriviaSessionFlow:
    def test_start_does_not_leak_answer(self, s, demo_user):
        body = {"category": "Australia", "difficulty": "easy"}
        r = s.post(f"{API}/games/trivia/session/{demo_user['id']}", json=body)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "session_id" in d
        for q in d["questions"]:
            assert "answer" not in q
            assert "explain" not in q
        # GET should not leak either
        sid = d["session_id"]
        g = s.get(f"{API}/games/trivia/session/{demo_user['id']}/{sid}").json()
        for q in g["questions"]:
            assert "answer" not in q
            assert "explain" not in q

    def test_invalid_difficulty_rejected(self, s, demo_user):
        r = s.post(
            f"{API}/games/trivia/session/{demo_user['id']}",
            json={"category": "Mixed", "difficulty": "expert"},
        )
        assert r.status_code == 400

    def test_answer_correct_wrong_and_advance(self, s, demo_user):
        # Use catalogue lookup so we know the correct answer index.
        # Pull the trivia_data on the server side -- here we just brute force:
        # answer index 0..3, find the one returning correct=true.
        body = {"category": "Australia", "difficulty": "easy"}
        start = s.post(f"{API}/games/trivia/session/{demo_user['id']}", json=body).json()
        sid = start["session_id"]
        q0 = start["questions"][0]

        # Find the correct answer by trying each index against an isolated session.
        # Simpler: import trivia_data here in tests.
        from trivia_data import QUESTIONS  # noqa: E402
        correct_idx = next(q["answer"] for q in QUESTIONS if q["id"] == q0["id"])
        wrong_idx = (correct_idx + 1) % len(q0["choices"])

        # Wrong answer first, no advance
        r1 = s.post(
            f"{API}/games/trivia/session/{demo_user['id']}/{sid}/answer",
            json={"qid": q0["id"], "picked": wrong_idx, "advance": False},
        )
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        assert d1["correct"] is False
        assert d1["correct_answer"] == correct_idx
        assert d1["current_index"] == 0  # no advance
        assert d1["score"] == 0

        # Now overwrite with the correct answer and advance.
        r2 = s.post(
            f"{API}/games/trivia/session/{demo_user['id']}/{sid}/answer",
            json={"qid": q0["id"], "picked": correct_idx, "advance": True},
        )
        d2 = r2.json()
        assert d2["correct"] is True
        assert d2["score"] == 1
        assert d2["current_index"] == 1


# ---------- completion + achievements (hard) ------------------------
class TestTriviaCompletion:
    @staticmethod
    def _play_full(s, user_id, category, difficulty, get_correct=True):
        """Start a session and answer every question. Returns the completion body."""
        from trivia_data import QUESTIONS
        start = s.post(
            f"{API}/games/trivia/session/{user_id}",
            json={"category": category, "difficulty": difficulty},
        ).json()
        sid = start["session_id"]
        for q in start["questions"]:
            ans = next(qq["answer"] for qq in QUESTIONS if qq["id"] == q["id"])
            picked = ans if get_correct else (ans + 1) % len(q["choices"])
            s.post(
                f"{API}/games/trivia/session/{user_id}/{sid}/answer",
                json={"qid": q["id"], "picked": picked, "advance": True},
            )
        # Complete
        comp = s.post(f"{API}/games/trivia/session/{user_id}/{sid}/complete").json()
        return comp

    def test_easy_full_score_awards_5_points(self, s, demo_user):
        # Use 'joycey' for a clean-ish profile (independent of billdo).
        u = s.post(f"{API}/auth/demo-login", json={"username": "joycey"}).json()["user"]
        comp = self._play_full(s, u["id"], "General Knowledge", "easy", get_correct=True)
        assert comp["points_earned"] == 5
        assert comp["score"] == comp["total"]
        # granted may include 'first_game' for fresh accounts (idempotent for repeat runs)
        assert isinstance(comp.get("granted"), list)

    def test_hard_full_score_awards_20_and_hard_achievement(self, s):
        # 'art' demo user — verify hard achievement is granted (was previously broken
        # with legacy 'expert' key).
        u = s.post(f"{API}/auth/demo-login", json={"username": "art"}).json()["user"]
        comp = self._play_full(s, u["id"], "History", "hard", get_correct=True)
        assert comp["points_earned"] == 20, comp
        # Check achievements list contains a 'hard' achievement after completion.
        stats = s.get(f"{API}/games/stats/{u['id']}").json()
        keys = {a["key"] for a in stats.get("achievements", [])}
        assert "hard" in keys, f"expected 'hard' achievement, got {keys}"
        # Ensure the legacy bug-name is not used.
        assert "expert" not in keys

    def test_low_score_prorates_points(self, s):
        u = s.post(f"{API}/auth/demo-login", json={"username": "eil"}).json()["user"]
        comp = self._play_full(s, u["id"], "Sport", "easy", get_correct=False)
        # All wrong -> ratio 0 -> max(1, int(round(5*max(0.2,0)))) = max(1, int(round(1))) = 1
        assert comp["points_earned"] >= 1
        assert comp["points_earned"] < 5


# ----------------------- sessions list + stats ----------------------
class TestSessionsAndStats:
    def test_sessions_list_has_active_and_recent(self, s, demo_user):
        # Start a fresh session to ensure 'active' is populated.
        start = s.post(
            f"{API}/games/trivia/session/{demo_user['id']}",
            json={"category": "Music", "difficulty": "easy"},
        ).json()
        assert "session_id" in start
        r = s.get(f"{API}/games/trivia/sessions/{demo_user['id']}").json()
        assert "active" in r and "recent" in r
        assert any(x["id"] == start["session_id"] for x in r["active"])

    def test_stats_aggregation(self, s, demo_user):
        r = s.get(f"{API}/games/trivia/stats/{demo_user['id']}").json()
        for key in ("total_completed", "total_points", "total_correct",
                    "total_questions", "accuracy", "by_difficulty"):
            assert key in r, key
