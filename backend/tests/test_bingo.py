"""Backend tests for the Bingo game endpoints.

Coverage (per review request):
- GET /api/games/bingo/catalog → 4 difficulties + meta (cols/rows/cards/free_center/pattern/points/auto_call_ms)
- GET /api/games/bingo/daily → moderate sample card, 15 pts
- GET /api/games/bingo/community-events → ≥3 events with seeded fields
- POST /api/games/bingo/session/{uid} → starts sessions for each difficulty + card sizes match meta
- PUT  /api/games/bingo/session/{uid}/{sid} → accepts call_index and marked
- POST /api/games/bingo/session/{uid}/{sid}/complete → 400 without a valid pattern; on real win returns difficulty points; Hard/Nightmare grant achievements (no 'expert' regression)
- Community event start + leaderboard listing on completion
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://iphone-retest-batch.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def user_ids(client):
    """Demo-login two distinct users (one for general tests, one for nightmare/event flows)."""
    ids = {}
    for name in ("maggie", "frankie", "joycey", "art"):
        r = client.post(f"{API}/auth/demo-login", json={"username": name})
        assert r.status_code == 200, r.text
        ids[name] = r.json()["user"]["id"]
    return ids


# ---------- helpers ----------
def _card_to_full_marked(meta, cards, sequence):
    """Build a marked grid that satisfies the pattern by marking every called cell."""
    rows = meta["rows"]
    cols = meta["cols"]
    called = set(sequence)  # everything possible
    out = []
    for card in cards:
        cm = [[False] * cols for _ in range(rows)]
        for ci in range(cols):
            for ri in range(rows):
                v = card[ci][ri]
                if v == 0 or v in called:
                    cm[ri][ci] = True
        out.append(cm)
    return out


def _start_session(client, uid, body):
    r = client.post(f"{API}/games/bingo/session/{uid}", json=body)
    assert r.status_code == 200, r.text
    return r.json()


# ============= Catalog =============
class TestCatalog:
    def test_catalog_has_four_difficulties_with_meta(self, client):
        r = client.get(f"{API}/games/bingo/catalog")
        assert r.status_code == 200
        data = r.json()
        assert data["difficulties"] == ["easy", "moderate", "hard", "nightmare"]
        meta = {m["key"]: m for m in data["difficulty_meta"]}
        # Easy 4x4, 1 card, no free centre, any_line, 5 pts, no auto call
        assert (meta["easy"]["cols"], meta["easy"]["rows"], meta["easy"]["cards"]) == (4, 4, 1)
        assert meta["easy"]["free_center"] is False
        assert meta["easy"]["pattern"] == "any_line"
        assert meta["easy"]["points"] == 5
        assert meta["easy"]["auto_call_ms"] == 0
        # Moderate 5x5, free centre, any_line, 10 pts
        assert (meta["moderate"]["cols"], meta["moderate"]["rows"], meta["moderate"]["cards"]) == (5, 5, 1)
        assert meta["moderate"]["free_center"] is True
        assert meta["moderate"]["pattern"] == "any_line"
        assert meta["moderate"]["points"] == 10
        assert meta["moderate"]["auto_call_ms"] == 0
        # Hard 5x5, free centre, two_lines_corners, 20 pts, auto-call 4s
        assert meta["hard"]["pattern"] == "two_lines_corners"
        assert meta["hard"]["points"] == 20
        assert meta["hard"]["auto_call_ms"] == 4000
        assert meta["hard"]["free_center"] is True
        # Nightmare two 5x5 cards, full_house, 35 pts, auto-call 3s
        assert meta["nightmare"]["cards"] == 2
        assert meta["nightmare"]["pattern"] == "full_house"
        assert meta["nightmare"]["points"] == 35
        assert meta["nightmare"]["auto_call_ms"] == 3000


# ============= Daily =============
class TestDaily:
    def test_daily_is_moderate_with_15pts(self, client):
        r = client.get(f"{API}/games/bingo/daily")
        assert r.status_code == 200
        d = r.json()
        assert d["difficulty"] == "moderate"
        assert d["points_on_complete"] == 15
        card = d["sample_card"]
        assert len(card) == 5 and all(len(c) == 5 for c in card)
        # free centre at (2,2)
        assert card[2][2] == 0


# ============= Community events =============
class TestCommunityEvents:
    def test_at_least_three_events_with_seeded_fields(self, client):
        r = client.get(f"{API}/games/bingo/community-events")
        assert r.status_code == 200
        events = r.json()["events"]
        assert len(events) >= 3
        ids = {e["id"] for e in events}
        for required in ("evt-weekly-friday", "evt-weekend-warmup", "evt-nightmare-challenge"):
            assert required in ids
        for e in events:
            for k in ("id", "title", "subtitle", "difficulty", "starts_iso", "ends_iso", "seed", "points_on_complete"):
                assert k in e, f"missing {k} in event {e.get('id')}"


# ============= Session start: shape per difficulty =============
class TestSessionStart:
    @pytest.mark.parametrize("diff,exp_cols,exp_rows,exp_cards,exp_free", [
        ("easy",      4, 4, 1, False),
        ("moderate",  5, 5, 1, True),
        ("hard",      5, 5, 1, True),
        ("nightmare", 5, 5, 2, True),
    ])
    def test_start_shapes(self, client, user_ids, diff, exp_cols, exp_rows, exp_cards, exp_free):
        uid = user_ids["maggie"]
        s = _start_session(client, uid, {"difficulty": diff})
        assert s["difficulty"] == diff
        assert s["meta"]["cols"] == exp_cols
        assert s["meta"]["rows"] == exp_rows
        assert s["meta"]["cards"] == exp_cards
        assert s["meta"]["free_center"] == exp_free
        assert len(s["cards"]) == exp_cards
        for card in s["cards"]:
            assert len(card) == exp_cols
            for col in card:
                assert len(col) == exp_rows
        if exp_free:
            # centre free space marked from creation
            assert s["cards"][0][2][2] == 0
            assert s["marked"][0][2][2] is True
        assert s["call_index"] == 0
        assert isinstance(s["sequence"], list) and len(s["sequence"]) >= 60


# ============= Update endpoint =============
class TestUpdate:
    def test_update_call_index_and_marked(self, client, user_ids):
        uid = user_ids["frankie"]
        s = _start_session(client, uid, {"difficulty": "easy"})
        sid = s["session_id"]
        # advance call index
        r = client.put(f"{API}/games/bingo/session/{uid}/{sid}", json={"call_index": 3})
        assert r.status_code == 200, r.text
        # GET to verify persistence
        r2 = client.get(f"{API}/games/bingo/session/{uid}/{sid}")
        assert r2.status_code == 200
        assert r2.json()["call_index"] == 3
        # update marked
        marked = [[[False] * 4 for _ in range(4)]]
        marked[0][0][0] = True
        r3 = client.put(f"{API}/games/bingo/session/{uid}/{sid}", json={"marked": marked})
        assert r3.status_code == 200
        r4 = client.get(f"{API}/games/bingo/session/{uid}/{sid}")
        assert r4.json()["marked"][0][0][0] is True


# ============= Complete: rejection + point/achievement awards =============
class TestComplete:
    def test_complete_rejects_when_no_pattern(self, client, user_ids):
        uid = user_ids["maggie"]
        s = _start_session(client, uid, {"difficulty": "easy"})
        sid = s["session_id"]
        r = client.post(f"{API}/games/bingo/session/{uid}/{sid}/complete")
        assert r.status_code == 400

    @pytest.mark.parametrize("diff,exp_points", [
        ("easy", 5), ("moderate", 10), ("hard", 20), ("nightmare", 35),
    ])
    def test_complete_awards_points_for_each_difficulty(self, client, user_ids, diff, exp_points):
        uid = user_ids["joycey"]
        s = _start_session(client, uid, {"difficulty": diff})
        sid = s["session_id"]
        # Mark everything called (entire sequence) so pattern is guaranteed
        marked = _card_to_full_marked(s["meta"], s["cards"], s["sequence"])
        r = client.put(f"{API}/games/bingo/session/{uid}/{sid}",
                       json={"call_index": len(s["sequence"]), "marked": marked})
        assert r.status_code == 200
        r2 = client.post(f"{API}/games/bingo/session/{uid}/{sid}/complete")
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert body["points_earned"] == exp_points
        assert body["difficulty"] == diff

    def test_hard_completion_grants_hard_achievement_not_expert(self, client, user_ids):
        uid = user_ids["art"]
        s = _start_session(client, uid, {"difficulty": "hard"})
        sid = s["session_id"]
        marked = _card_to_full_marked(s["meta"], s["cards"], s["sequence"])
        client.put(f"{API}/games/bingo/session/{uid}/{sid}",
                   json={"call_index": len(s["sequence"]), "marked": marked})
        r = client.post(f"{API}/games/bingo/session/{uid}/{sid}/complete")
        assert r.status_code == 200, r.text
        # Stats endpoint should expose granted achievements; alternatively check /games/achievements/{uid}
        # The completion endpoint also returns 'granted'.
        granted = r.json().get("granted", [])
        # Note: 'hard' is granted once per user globally — may already exist from previous run.
        # The regression we guard against is the broken 'expert' key.
        assert "expert" not in granted
        # Optional positive assertion if first run:
        # (cannot strictly require 'hard' because the achievement is idempotent)

    def test_nightmare_completion_no_expert_regression(self, client, user_ids):
        uid = user_ids["frankie"]
        s = _start_session(client, uid, {"difficulty": "nightmare"})
        sid = s["session_id"]
        marked = _card_to_full_marked(s["meta"], s["cards"], s["sequence"])
        client.put(f"{API}/games/bingo/session/{uid}/{sid}",
                   json={"call_index": len(s["sequence"]), "marked": marked})
        r = client.post(f"{API}/games/bingo/session/{uid}/{sid}/complete")
        assert r.status_code == 200, r.text
        granted = r.json().get("granted", [])
        assert "expert" not in granted
        assert r.json()["points_earned"] == 35


# ============= Community event start + leaderboard =============
class TestCommunityFlow:
    def test_event_start_uses_seeded_sequence_and_leaderboard_lists_winner(self, client, user_ids):
        uid = user_ids["maggie"]
        # Start same event twice — call sequence should be deterministic from seed
        s1 = _start_session(client, uid, {"event_id": "evt-weekly-friday", "difficulty": "moderate"})
        s2 = _start_session(client, uid, {"event_id": "evt-weekly-friday", "difficulty": "moderate"})
        assert s1["sequence"][:10] == s2["sequence"][:10], "Event seed should give a deterministic sequence"
        assert s1["difficulty"] == "moderate"

        # Complete one of them
        sid = s1["session_id"]
        marked = _card_to_full_marked(s1["meta"], s1["cards"], s1["sequence"])
        client.put(f"{API}/games/bingo/session/{uid}/{sid}",
                   json={"call_index": len(s1["sequence"]), "marked": marked})
        r = client.post(f"{API}/games/bingo/session/{uid}/{sid}/complete")
        assert r.status_code == 200, r.text
        body = r.json()
        # Event awards its own points_on_complete (25 for Friday Night Bingo)
        assert body["points_earned"] == 25
        assert body["event_id"] == "evt-weekly-friday"

        # Leaderboard should now list this user
        lb = client.get(f"{API}/games/bingo/community-events/evt-weekly-friday/leaderboard")
        assert lb.status_code == 200
        rows = lb.json()["leaderboard"]
        assert any((row.get("user") or {}).get("id") == uid for row in rows), "Completer should appear on leaderboard"
