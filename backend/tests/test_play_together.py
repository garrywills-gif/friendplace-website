"""Backend tests for Play Together (invite/accept/decline/move/rematch/mine/anti-farm).

Uses demo-login for two accounts (maggie=host, frankie=guest) who are pre-friended.
Runs against local backend at http://localhost:8001 (routes prefixed with /api).
"""
import os
import pytest
import requests
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get("PLAY_BACKEND_URL", "http://localhost:8001").rstrip("/")


# ---- fixtures ---------------------------------------------------------

@pytest.fixture(scope="module")
def maggie():
    r = requests.post(f"{BASE_URL}/api/auth/demo-login", json={"username": "maggie"})
    assert r.status_code == 200, r.text
    d = r.json()
    return {"token": d["access_token"], "id": d["user"]["id"], "user": d["user"]}


@pytest.fixture(scope="module")
def frankie():
    r = requests.post(f"{BASE_URL}/api/auth/demo-login", json={"username": "frankie"})
    assert r.status_code == 200, r.text
    d = r.json()
    return {"token": d["access_token"], "id": d["user"]["id"], "user": d["user"]}


@pytest.fixture(scope="module")
def joycey():
    r = requests.post(f"{BASE_URL}/api/auth/demo-login", json={"username": "joycey"})
    assert r.status_code == 200, r.text
    d = r.json()
    return {"token": d["access_token"], "id": d["user"]["id"], "user": d["user"]}


def hdr(u):
    return {"Authorization": f"Bearer {u['token']}", "Content-Type": "application/json"}


def invite(host, guest, game):
    r = requests.post(f"{BASE_URL}/api/play/invite",
                      json={"game": game, "friend_id": guest["id"]},
                      headers=hdr(host))
    return r


# ---- daily cap reset helper (module-scoped) --------------------------

@pytest.fixture(scope="module", autouse=True)
def _reset_daily_cap(maggie, frankie):
    """Clean daily point counters so tests are deterministic."""
    import asyncio
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "test_database")

    async def _clean():
        client = AsyncIOMotorClient(mongo_url)
        db = client[db_name]
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        await db.play_daily_points.delete_many({"user_id": {"$in": [maggie["id"], frankie["id"]]}, "date": today})
        # Also clean any leftover play_sessions for these two — keeps state clean
        await db.play_sessions.delete_many({
            "host_id": {"$in": [maggie["id"], frankie["id"]]},
            "guest_id": {"$in": [maggie["id"], frankie["id"]]},
        })
        client.close()

    asyncio.get_event_loop().run_until_complete(_clean())
    yield


# ---- INVITE tests ----------------------------------------------------

class TestInvite:
    def test_unknown_game_400(self, maggie, frankie):
        r = invite(maggie, frankie, "bogus_game")
        assert r.status_code == 400, r.text

    def test_self_invite_400(self, maggie):
        r = requests.post(f"{BASE_URL}/api/play/invite",
                          json={"game": "this_or_that", "friend_id": maggie["id"]},
                          headers=hdr(maggie))
        assert r.status_code == 400, r.text

    def test_non_friend_400(self, maggie):
        # Find a demo user who is NOT in maggie's friends
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=hdr(maggie)).json()
        my_friends = set(me.get("friends") or [])
        non_friend_id = None
        for username in ("billdo", "dot", "art", "eil", "roy"):
            r = requests.post(f"{BASE_URL}/api/auth/demo-login", json={"username": username})
            uid = r.json()["user"]["id"]
            if uid not in my_friends and uid != maggie["id"]:
                non_friend_id = uid
                break
        if not non_friend_id:
            pytest.skip("could not find a non-friend demo user")
        r2 = requests.post(f"{BASE_URL}/api/play/invite",
                           json={"game": "this_or_that", "friend_id": non_friend_id},
                           headers=hdr(maggie))
        assert r2.status_code == 400, r2.text
        assert "friend" in r2.text.lower()

    def test_invite_ok_creates_invited_session(self, maggie, frankie):
        r = invite(maggie, frankie, "quick_trivia")
        assert r.status_code == 200, r.text
        s = r.json()
        assert s["status"] == "invited"
        assert s["host_id"] == maggie["id"]
        assert s["guest_id"] == frankie["id"]
        assert s["game"] == "quick_trivia"
        # quick_trivia MUST NOT leak answer field before finish
        for q in s["content"]["questions"]:
            assert "answer" not in q, f"answer leaked in invited state: {q}"


# ---- ACCEPT / DECLINE ------------------------------------------------

class TestAcceptDecline:
    def test_only_guest_can_accept(self, maggie, frankie):
        s = invite(maggie, frankie, "this_or_that").json()
        # host tries to accept -> 403
        r = requests.post(f"{BASE_URL}/api/play/{s['id']}/accept", headers=hdr(maggie))
        assert r.status_code == 403, r.text
        # guest accepts -> 200 active
        r2 = requests.post(f"{BASE_URL}/api/play/{s['id']}/accept", headers=hdr(frankie))
        assert r2.status_code == 200, r2.text
        assert r2.json()["status"] == "active"

    def test_accept_idempotent(self, maggie, frankie):
        s = invite(maggie, frankie, "this_or_that").json()
        r1 = requests.post(f"{BASE_URL}/api/play/{s['id']}/accept", headers=hdr(frankie))
        r2 = requests.post(f"{BASE_URL}/api/play/{s['id']}/accept", headers=hdr(frankie))
        assert r1.status_code == 200 and r2.status_code == 200
        assert r2.json()["status"] == "active"

    def test_decline_sets_declined(self, maggie, frankie):
        s = invite(maggie, frankie, "this_or_that").json()
        r = requests.post(f"{BASE_URL}/api/play/{s['id']}/decline", headers=hdr(frankie))
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "declined"


# ---- QUICK TRIVIA ---------------------------------------------------

class TestQuickTrivia:
    def test_trivia_scored_no_answer_leak(self, maggie, frankie):
        s = invite(maggie, frankie, "quick_trivia").json()
        requests.post(f"{BASE_URL}/api/play/{s['id']}/accept", headers=hdr(frankie))

        # Read the raw session from DB to know the correct answers (server hides them).
        # Instead of DB access here, we fetch via GET as maggie (should still NOT include answer).
        r_get = requests.get(f"{BASE_URL}/api/play/{s['id']}", headers=hdr(maggie))
        assert r_get.status_code == 200
        for q in r_get.json()["content"]["questions"]:
            assert "answer" not in q

        # Submit all-zeros for both players (deterministic completion)
        n = len(r_get.json()["content"]["questions"])
        r1 = requests.post(f"{BASE_URL}/api/play/{s['id']}/move",
                           json={"answers": [0] * n}, headers=hdr(maggie))
        assert r1.status_code == 200
        r2 = requests.post(f"{BASE_URL}/api/play/{s['id']}/move",
                           json={"answers": [1] * n}, headers=hdr(frankie))
        assert r2.status_code == 200
        final = r2.json()
        assert final["status"] == "finished"
        # answer field should now be present
        assert all("answer" in q for q in final["content"]["questions"])
        # winner_id is null if tied; else higher score
        scores = {p["id"]: p["score"] for p in final["players"]}
        if scores[maggie["id"]] == scores[frankie["id"]]:
            assert final["winner_id"] is None
        else:
            top = maggie["id"] if scores[maggie["id"]] > scores[frankie["id"]] else frankie["id"]
            assert final["winner_id"] == top


# ---- THIS OR THAT ---------------------------------------------------

class TestThisOrThat:
    def test_matches_count(self, maggie, frankie):
        s = invite(maggie, frankie, "this_or_that").json()
        requests.post(f"{BASE_URL}/api/play/{s['id']}/accept", headers=hdr(frankie))
        n = len(s["content"]["prompts"])
        r1 = requests.post(f"{BASE_URL}/api/play/{s['id']}/move",
                           json={"answers": [0] * n}, headers=hdr(maggie))
        assert r1.status_code == 200
        # frankie picks: matches on i=0,2,4 (3 matches expected for n=5)
        picks = [0 if i % 2 == 0 else 1 for i in range(n)]
        expected_matches = sum(1 for i in range(n) if picks[i] == 0)
        r2 = requests.post(f"{BASE_URL}/api/play/{s['id']}/move",
                           json={"answers": picks}, headers=hdr(frankie))
        assert r2.status_code == 200
        final = r2.json()
        assert final["status"] == "finished"
        assert final["content"]["matches"] == expected_matches


# ---- WORD CHAIN -----------------------------------------------------

def _make_word(letter):
    """A simple word starting with the required letter (min length 2)."""
    # Use letter + 'a' — always a valid alphabetic 2-char word
    return f"{letter.lower()}a"


class TestWordChain:
    def test_turn_enforced_and_wrong_letter(self, maggie, frankie):
        s = invite(maggie, frankie, "word_chain").json()
        s = requests.post(f"{BASE_URL}/api/play/{s['id']}/accept", headers=hdr(frankie)).json()
        req_letter = s["content"]["required_letter"]

        # guest (frankie) tries first — but host starts -> not your turn
        r_bad = requests.post(f"{BASE_URL}/api/play/{s['id']}/move",
                              json={"word": _make_word(req_letter)}, headers=hdr(frankie))
        assert r_bad.status_code == 400, r_bad.text
        assert "turn" in r_bad.text.lower()

        # host uses wrong-letter word
        wrong_letter = "Z" if req_letter != "Z" else "Y"
        r_wrong = requests.post(f"{BASE_URL}/api/play/{s['id']}/move",
                                json={"word": _make_word(wrong_letter)}, headers=hdr(maggie))
        assert r_wrong.status_code == 400, r_wrong.text

        # host plays valid word -> flip turn, next required_letter = last char
        r_ok = requests.post(f"{BASE_URL}/api/play/{s['id']}/move",
                             json={"word": _make_word(req_letter)}, headers=hdr(maggie))
        assert r_ok.status_code == 200, r_ok.text
        s2 = r_ok.json()
        assert s2["turn"] == frankie["id"]
        # word was letter+"a" -> new required letter is "A"
        assert s2["content"]["required_letter"].upper() == "A"

    def test_give_up_winner_other(self, maggie, frankie):
        s = invite(maggie, frankie, "word_chain").json()
        s = requests.post(f"{BASE_URL}/api/play/{s['id']}/accept", headers=hdr(frankie)).json()
        # host gives up
        r = requests.post(f"{BASE_URL}/api/play/{s['id']}/move",
                          json={"give_up": True}, headers=hdr(maggie))
        assert r.status_code == 200
        final = r.json()
        assert final["status"] == "finished"
        assert final["winner_id"] == frankie["id"]

    def test_reach_12_shared_no_winner(self, maggie, frankie):
        s = invite(maggie, frankie, "word_chain").json()
        s = requests.post(f"{BASE_URL}/api/play/{s['id']}/accept", headers=hdr(frankie)).json()
        current_letter = s["content"]["required_letter"]
        turn = s["turn"]
        final = None
        for i in range(12):
            player = maggie if turn == maggie["id"] else frankie
            word = _make_word(current_letter)
            r = requests.post(f"{BASE_URL}/api/play/{s['id']}/move",
                              json={"word": word}, headers=hdr(player))
            assert r.status_code == 200, f"iter {i}: {r.text}"
            resp = r.json()
            current_letter = resp["content"]["required_letter"]
            turn = resp["turn"]
            final = resp
        assert final["status"] == "finished"
        assert final["winner_id"] is None
        assert len(final["content"]["chain"]) >= 12


# ---- REMATCH --------------------------------------------------------

class TestRematch:
    def test_rematch_creates_new_active_session(self, maggie, frankie):
        s = invite(maggie, frankie, "this_or_that").json()
        requests.post(f"{BASE_URL}/api/play/{s['id']}/accept", headers=hdr(frankie))
        n = len(s["content"]["prompts"])
        requests.post(f"{BASE_URL}/api/play/{s['id']}/move",
                      json={"answers": [0] * n}, headers=hdr(maggie))
        requests.post(f"{BASE_URL}/api/play/{s['id']}/move",
                      json={"answers": [0] * n}, headers=hdr(frankie))
        # Frankie initiates the rematch — becomes host
        r = requests.post(f"{BASE_URL}/api/play/{s['id']}/rematch", headers=hdr(frankie))
        assert r.status_code == 200, r.text
        new = r.json()
        assert new["id"] != s["id"]
        assert new["status"] == "active"
        assert new["host_id"] == frankie["id"]
        assert new["guest_id"] == maggie["id"]


# ---- MINE LIST ------------------------------------------------------

class TestMineList:
    def test_mine_returns_invited_and_active(self, maggie, frankie):
        s = invite(maggie, frankie, "this_or_that").json()
        r = requests.get(f"{BASE_URL}/api/play/mine/list", headers=hdr(maggie))
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()["sessions"]]
        assert s["id"] in ids
        # frankie also sees it as guest
        r2 = requests.get(f"{BASE_URL}/api/play/mine/list", headers=hdr(frankie))
        ids2 = [x["id"] for x in r2.json()["sessions"]]
        assert s["id"] in ids2


# ---- ANTI-FARM (last, so daily cap tests don't pollute other cases) --

@pytest.fixture(scope="class")
def _reset_anti_farm(maggie, frankie):
    import asyncio
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "test_database")

    async def _clean():
        client = AsyncIOMotorClient(mongo_url)
        db = client[db_name]
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        await db.play_daily_points.delete_many({
            "user_id": {"$in": [maggie["id"], frankie["id"]]},
            "date": today,
        })
        client.close()
    asyncio.get_event_loop().run_until_complete(_clean())
    yield


class TestAntiFarm:
    @pytest.fixture(autouse=True)
    def _cleanup(self, _reset_anti_farm):
        pass

    def test_points_cap_at_daily_limit(self, maggie, frankie):
        """After 3 point-earning games per player per day, additional games
        should still play but no further points should accrue for those users.
        We measure Butterfly Points on both users before and after a
        4th completed game — the delta on the 4th game must be 0."""
        # Fetch starting points
        me_start = requests.get(f"{BASE_URL}/api/auth/me", headers=hdr(maggie)).json()
        fr_start = requests.get(f"{BASE_URL}/api/auth/me", headers=hdr(frankie)).json()
        m_pts_0 = me_start.get("butterfly_points", me_start.get("points", 0))
        f_pts_0 = fr_start.get("butterfly_points", fr_start.get("points", 0))

        # Play 3 quick this_or_that games to completion (fills the daily cap)
        for i in range(3):
            s = invite(maggie, frankie, "this_or_that").json()
            requests.post(f"{BASE_URL}/api/play/{s['id']}/accept", headers=hdr(frankie))
            n = len(s["content"]["prompts"])
            requests.post(f"{BASE_URL}/api/play/{s['id']}/move",
                          json={"answers": [0] * n}, headers=hdr(maggie))
            requests.post(f"{BASE_URL}/api/play/{s['id']}/move",
                          json={"answers": [0] * n}, headers=hdr(frankie))

        me_mid = requests.get(f"{BASE_URL}/api/auth/me", headers=hdr(maggie)).json()
        fr_mid = requests.get(f"{BASE_URL}/api/auth/me", headers=hdr(frankie)).json()
        m_pts_3 = me_mid.get("butterfly_points", me_mid.get("points", 0))
        f_pts_3 = fr_mid.get("butterfly_points", fr_mid.get("points", 0))
        assert m_pts_3 > m_pts_0, "expected points to increase within the daily cap"
        assert f_pts_3 > f_pts_0, "expected points to increase within the daily cap"

        # 4th game — should still play, but grant NO new points
        s4 = invite(maggie, frankie, "this_or_that").json()
        requests.post(f"{BASE_URL}/api/play/{s4['id']}/accept", headers=hdr(frankie))
        n = len(s4["content"]["prompts"])
        r_a = requests.post(f"{BASE_URL}/api/play/{s4['id']}/move",
                            json={"answers": [0] * n}, headers=hdr(maggie))
        r_b = requests.post(f"{BASE_URL}/api/play/{s4['id']}/move",
                            json={"answers": [0] * n}, headers=hdr(frankie))
        assert r_a.status_code == 200 and r_b.status_code == 200
        assert r_b.json()["status"] == "finished", "4th game must still complete"

        me_end = requests.get(f"{BASE_URL}/api/auth/me", headers=hdr(maggie)).json()
        fr_end = requests.get(f"{BASE_URL}/api/auth/me", headers=hdr(frankie)).json()
        m_pts_4 = me_end.get("butterfly_points", me_end.get("points", 0))
        f_pts_4 = fr_end.get("butterfly_points", fr_end.get("points", 0))
        assert m_pts_4 == m_pts_3, f"maggie earned points beyond daily cap ({m_pts_3} -> {m_pts_4})"
        assert f_pts_4 == f_pts_3, f"frankie earned points beyond daily cap ({f_pts_3} -> {f_pts_4})"
