"""iter232 backend tests — Snooze recovery, snooze notification,
Bingo flat 50 points re-verify, and /health deployment regression guard.

Scope (per review_request):
 1. SNOOZE RECOVERY: /play/invite + /play/find-match auto-cancel any
    still-'invited' sessions where the caller is host.
 2. SNOOZE NOTIFICATION: /play/{sid}/snooze still marks status='declined'
    and sends game_end "X isn't ready to play right now".
 3. BINGO POINTS: catalog/daily/community-events all 50; /complete awards
    exactly 50 once, second call returns already_completed:true.
 4. /health and /api/health both return 200.

Auth: maggie signs in via /api/auth/demo-login. Her friend member_first
(Alex) is reciprocally friended but is not a demo account, so we mint
her a token via server.make_token().
"""
import os
import sys
import asyncio
import pytest
import requests

BASE_URL = os.environ.get("PLAY_BACKEND_URL", "http://localhost:8001").rstrip("/")

sys.path.insert(0, "/app/backend")
from server import make_token  # noqa: E402

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


# --------------------------- fixtures ---------------------------------

@pytest.fixture(scope="module")
def db():
    loop = asyncio.new_event_loop()
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    yield (db, loop)
    client.close()
    loop.close()


@pytest.fixture(scope="module")
def pair(db):
    """Return host (maggie, demo login) + guest (first reciprocal friend)."""
    database, loop = db
    r = requests.post(f"{BASE_URL}/api/auth/demo-login", json={"username": "maggie"})
    assert r.status_code == 200, r.text
    md = r.json()
    maggie = {"token": md["access_token"], "id": md["user"]["id"],
              "name": md["user"].get("first_name") or "Margaret"}

    async def _find_guest():
        mu = await database.users.find_one({"id": maggie["id"]}, {"_id": 0, "friends": 1})
        for fid in mu.get("friends") or []:
            fu = await database.users.find_one({"id": fid}, {"_id": 0, "id": 1, "friends": 1,
                                                              "first_name": 1, "banned": 1})
            if not fu:
                continue
            if fu.get("banned"):
                continue
            if maggie["id"] in (fu.get("friends") or []):
                return fu
        return None

    guest_doc = loop.run_until_complete(_find_guest())
    assert guest_doc, "No reciprocal friend available for maggie"
    guest = {"token": make_token(guest_doc["id"]), "id": guest_doc["id"],
             "name": guest_doc.get("first_name") or "Friend"}
    # Clean prior pending play state between the pair to avoid cross-run pollution.
    loop.run_until_complete(database.play_sessions.delete_many(
        {"$or": [{"host_id": maggie["id"], "guest_id": guest["id"]},
                 {"host_id": guest["id"], "guest_id": maggie["id"]}]}))
    loop.run_until_complete(database.play_declines.delete_many(
        {"members": {"$all": [maggie["id"], guest["id"]]}}))
    return {"host": maggie, "guest": guest, "db": database, "loop": loop}


def _hdr(u):
    return {"Authorization": f"Bearer {u['token']}", "Content-Type": "application/json"}


def _invite(host, guest, game="word_chain"):
    return requests.post(f"{BASE_URL}/api/play/invite",
                         json={"game": game, "friend_id": guest["id"]},
                         headers=_hdr(host))


def _session_status(loop, database, sid):
    return loop.run_until_complete(database.play_sessions.find_one({"id": sid}, {"_id": 0, "status": 1}))


# --------------------------- (1) SNOOZE RECOVERY ----------------------

class TestSnoozeRecovery:
    def test_a_initial_invite_creates_invited_session(self, pair):
        r = _invite(pair["host"], pair["guest"])
        assert r.status_code == 200, r.text
        sess = r.json()
        assert sess["status"] == "invited"
        assert sess["id"]
        # Verify in DB
        doc = _session_status(pair["loop"], pair["db"], sess["id"])
        assert doc and doc["status"] == "invited"
        pytest.session1_id = sess["id"]

    def test_b_second_invite_cancels_prior_invited(self, pair):
        assert pytest.session1_id, "session1 must exist"
        r = _invite(pair["host"], pair["guest"])
        assert r.status_code == 200, r.text
        sess2 = r.json()
        assert sess2["status"] == "invited"
        assert sess2["id"] != pytest.session1_id
        # session1 must now be cancelled
        s1 = _session_status(pair["loop"], pair["db"], pytest.session1_id)
        assert s1 and s1["status"] == "cancelled", f"session1 should be cancelled, got {s1}"
        # session2 must still be invited
        s2 = _session_status(pair["loop"], pair["db"], sess2["id"])
        assert s2 and s2["status"] == "invited"
        pytest.session2_id = sess2["id"]

    def test_c_find_match_cancels_prior_invited(self, pair):
        """find-match also auto-cancels caller's stale 'invited' sessions.
        We don't assert that a NEW match session was created — matchmaking
        is subject to online-presence and may legitimately return 404. The
        guarantee under test is that session2 becomes 'cancelled' either way.
        """
        assert pytest.session2_id, "session2 must exist"
        r = requests.post(f"{BASE_URL}/api/play/find-match",
                          json={"game": "quick_trivia"}, headers=_hdr(pair["host"]))
        # Accept 200 (match found) or 404 (nobody online) — either path
        # must have invoked the stale-invite auto-cancel guard first.
        assert r.status_code in (200, 404), r.text
        s2 = _session_status(pair["loop"], pair["db"], pytest.session2_id)
        assert s2 and s2["status"] == "cancelled", f"session2 should be cancelled, got {s2}"

    def test_d_snooze_still_goes_to_declined(self, pair):
        """Snooze path must stay independent of the new stale-cancel guard."""
        # Fresh invite
        r = _invite(pair["host"], pair["guest"])
        assert r.status_code == 200, r.text
        sid = r.json()["id"]
        # Guest snoozes
        rs = requests.post(f"{BASE_URL}/api/play/{sid}/snooze", headers=_hdr(pair["guest"]))
        assert rs.status_code == 200, rs.text
        assert rs.json()["status"] == "declined"
        # DB persistence check — must be 'declined', not 'cancelled'
        doc = _session_status(pair["loop"], pair["db"], sid)
        assert doc and doc["status"] == "declined", f"expected declined, got {doc}"


# --------------------------- (2) SNOOZE NOTIFICATION ------------------

class TestSnoozeNotification:
    def test_snooze_sends_game_end_notification_via_user_ws(self, pair):
        """game_end is intentionally ephemeral (play_together.py:_notify sets
        ephemeral=True for all non-'game_invite' events — Garry Jun 2026) so
        it is NOT persisted to db.notifications. We verify delivery via the
        /api/ws/user/{host_id} websocket fan-out instead, which is the real
        channel the host's app listens on.
        """
        import json
        import threading
        import websocket

        # Clear prior declines to avoid matchmaking filter noise.
        pair["loop"].run_until_complete(pair["db"].play_declines.delete_many(
            {"members": {"$all": [pair["host"]["id"], pair["guest"]["id"]]}}))

        host = pair["host"]
        ws_url = BASE_URL.replace("http://", "ws://").replace("https://", "wss://")
        ws_url = f"{ws_url}/api/ws/user/{host['id']}?token={host['token']}"
        received = []
        done = threading.Event()

        def on_message(ws, msg):
            try:
                data = json.loads(msg)
            except Exception:
                return
            if data.get("type") == "notification":
                n = data.get("notification") or {}
                if n.get("type") == "game_end":
                    received.append(n)
                    done.set()

        ws = websocket.WebSocketApp(ws_url, on_message=on_message)
        t = threading.Thread(target=ws.run_forever, daemon=True)
        t.start()
        # Give the WS a moment to connect
        import time
        time.sleep(1.0)

        try:
            # Fresh invite then snooze
            r = _invite(host, pair["guest"])
            assert r.status_code == 200, r.text
            sid = r.json()["id"]
            rs = requests.post(f"{BASE_URL}/api/play/{sid}/snooze", headers=_hdr(pair["guest"]))
            assert rs.status_code == 200, rs.text
            assert rs.json()["status"] == "declined"

            # Wait up to 5s for the fan-out
            done.wait(timeout=5.0)
        finally:
            try:
                ws.close()
            except Exception:
                pass

        assert received, "No game_end notification broadcast received over user WS"
        n = received[-1]
        title = n.get("title") or ""
        assert "isn't ready to play right now" in title, (
            f"Expected '…isn't ready to play right now' title, got: {title!r}")
        # Payload should reference the session id
        payload = n.get("payload") or {}
        assert payload.get("session_id") == sid, f"session_id mismatch in payload: {payload}"


# --------------------------- (3) BINGO POINTS = 50 --------------------

class TestBingoFlat50:
    def test_catalog_all_difficulties_50pts(self):
        r = requests.get(f"{BASE_URL}/api/games/bingo/catalog")
        assert r.status_code == 200, r.text
        meta_list = r.json()["difficulty_meta"]
        assert len(meta_list) == 4
        for m in meta_list:
            assert m["points"] == 50, f"{m['key']} points should be 50, got {m['points']}"

    def test_daily_50pts(self):
        r = requests.get(f"{BASE_URL}/api/games/bingo/daily")
        assert r.status_code == 200, r.text
        assert r.json()["points_on_complete"] == 50

    def test_community_events_50pts(self):
        r = requests.get(f"{BASE_URL}/api/games/bingo/community-events")
        assert r.status_code == 200, r.text
        events = r.json()["events"] if isinstance(r.json(), dict) and "events" in r.json() else r.json()
        assert len(events) >= 3
        for ev in events:
            assert ev["points_on_complete"] == 50, f"{ev['id']} points_on_complete should be 50"

    def test_complete_awards_50_and_is_idempotent(self, pair, db):
        """Create a bingo session for maggie, force a winning marked grid at
        DB level, then call /complete twice. First call awards 50; second
        call returns already_completed=True with points_earned reflecting
        the single prior award (no double-credit).
        """
        database, loop = db
        host = pair["host"]
        # Start a bingo session (easy = 4x4 any_line, no free center)
        r = requests.post(f"{BASE_URL}/api/games/bingo/session/{host['id']}",
                          json={"difficulty": "easy"}, headers=_hdr(host))
        assert r.status_code == 200, r.text
        sess = r.json()
        sid = sess["session_id"]
        cards = sess["cards"]
        # Build a winning marked grid: mark entire first row of first card
        rows = len(cards[0])
        cols = len(cards[0][0])
        marked = [[[False] * cols for _ in range(rows)] for _ in cards]
        for c in range(cols):
            marked[0][0][c] = True
        # Persist the marked grid via DB directly (bypass server validation of calls)
        loop.run_until_complete(database.bingo_sessions.update_one(
            {"id": sid}, {"$set": {"marked": marked, "call_index": cols}}))
        # First complete
        r1 = requests.post(f"{BASE_URL}/api/games/bingo/session/{host['id']}/{sid}/complete",
                           headers=_hdr(host))
        assert r1.status_code == 200, r1.text
        body1 = r1.json()
        assert body1["points_earned"] == 50, f"Expected 50 pts, got {body1}"
        assert not body1.get("already_completed"), f"First call should not be already_completed: {body1}"
        # Second complete — must be idempotent
        r2 = requests.post(f"{BASE_URL}/api/games/bingo/session/{host['id']}/{sid}/complete",
                           headers=_hdr(host))
        assert r2.status_code == 200, r2.text
        body2 = r2.json()
        assert body2.get("already_completed") is True, f"Second call must be already_completed: {body2}"
        assert body2["points_earned"] == 50, f"already-completed should surface stored 50 pts, got {body2}"
        # Cleanup
        loop.run_until_complete(database.bingo_sessions.delete_one({"id": sid}))


# --------------------------- (4) HEALTH ENDPOINTS ---------------------

class TestHealth:
    def test_api_health_200(self):
        r = requests.get(f"{BASE_URL}/api/health")
        assert r.status_code == 200, r.text

    def test_root_health_200(self):
        r = requests.get(f"{BASE_URL}/health")
        assert r.status_code == 200, r.text
