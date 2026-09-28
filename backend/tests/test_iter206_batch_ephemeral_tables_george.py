"""
iter206 backend regression:

1) Play Together game notifications: only 'game_invite' persists in the
   recipient's Notifications; game_start / game_move / game_end are
   ephemeral socket-only signals (never in db.notifications).
2) Matchmaking: POST /api/play/find-match returns origin=='matchmaking'
   (404 accepted if truly no eligible online member).
3) Table invitee roster: create → GET shows 'invitees' with status
   'invited'; POST /decline flips to 'declined'; POST /join flips to
   'joined' (declined cleared).
4) George/Georgia companion instant greeting: GET
   /api/mcgs/george/companion returns a session whose turns[0].role
   == 'george' with non-empty content quickly (no multi-second wait
   on a brand-new session).
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"
API = f"{BASE_URL}/api"

MEMBER_EMAIL = "member@friendplace.com.au"
MEMBER_PASSWORD = "TestPass2026!"


# ---------- shared helpers / fixtures ----------

def _demo_login(username: str):
    r = requests.post(f"{API}/auth/demo-login", json={"username": username}, timeout=15)
    r.raise_for_status()
    j = r.json()
    return j["access_token"], j["user"]


def _hdr(tok: str):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def maggie():
    tok, u = _demo_login("maggie")
    return {"tok": tok, "id": u["id"], "user": u}


@pytest.fixture(scope="module")
def frankie():
    tok, u = _demo_login("frankie")
    return {"tok": tok, "id": u["id"], "user": u}


@pytest.fixture(scope="module")
def billdo():
    tok, u = _demo_login("billdo")
    return {"tok": tok, "id": u["id"], "user": u}


def _ensure_friends(a, b):
    """Make sure a & b are confirmed friends. maggie/frankie usually
    already are, but re-run friendliness so play/invite passes."""
    # Try friend-request → accept if not friends
    ra = requests.get(f"{API}/friends/{a['id']}", headers=_hdr(a["tok"]), timeout=15)
    if ra.status_code == 200:
        payload = ra.json() or {}
        friends = payload.get("friends") if isinstance(payload, dict) else payload
        friends = friends or []
        if any((f.get("id") if isinstance(f, dict) else f) == b["id"] for f in friends):
            return
    # Send friend request
    rr = requests.post(
        f"{API}/friends/request",
        headers=_hdr(a["tok"]),
        json={"from_id": a["id"], "to_id": b["id"]},
        timeout=15,
    )
    # Ignore 400 duplicate — fall through to accept path
    # Find pending request b received
    reqs = requests.get(f"{API}/friends/requests/{b['id']}", headers=_hdr(b["tok"]), timeout=15)
    if reqs.status_code == 200:
        for r in reqs.json() or []:
            if r.get("from_id") == a["id"] and (r.get("status") in (None, "pending")):
                rid = r.get("id") or r.get("_id")
                if rid:
                    requests.post(f"{API}/friends/accept/{rid}", headers=_hdr(b["tok"]), timeout=15)
                    return


# =========================================================
# Section 1 — Play Together notifications (ephemeral except invite)
# =========================================================

class TestPlayTogetherNotifications:
    def test_only_game_invite_persists(self, maggie, frankie):
        _ensure_friends(maggie, frankie)

        # Snapshot guest's notifications count BEFORE the invite so we can
        # count what specifically was added by this flow.
        before = requests.get(
            f"{API}/notifications/{frankie['id']}",
            headers=_hdr(frankie["tok"]),
            timeout=15,
        )
        assert before.status_code == 200, before.text
        before_list = before.json()
        before_types_count = {}
        for n in before_list:
            before_types_count[n.get("type", "")] = before_types_count.get(n.get("type", ""), 0) + 1

        # Host invites guest to this_or_that
        inv = requests.post(
            f"{API}/play/invite",
            headers=_hdr(maggie["tok"]),
            json={"game": "this_or_that", "friend_id": frankie["id"]},
            timeout=15,
        )
        assert inv.status_code == 200, inv.text
        sess = inv.json()
        sid = sess["id"]
        assert sess["origin"] == "friend"

        # Give the async _notify a beat to persist
        time.sleep(0.5)

        after = requests.get(
            f"{API}/notifications/{frankie['id']}",
            headers=_hdr(frankie["tok"]),
            timeout=15,
        ).json()

        # Count delta by type for THIS session id
        delta_types = {}
        session_scoped = [
            n for n in after
            if (n.get("payload") or {}).get("session_id") == sid
        ]
        for n in session_scoped:
            delta_types[n.get("type", "")] = delta_types.get(n.get("type", ""), 0) + 1

        assert delta_types.get("game_invite", 0) == 1, f"expected exactly one game_invite for this session, got {delta_types}"
        assert "game_start" not in delta_types, f"game_start MUST be ephemeral, found: {delta_types}"
        assert "game_move" not in delta_types
        assert "game_end" not in delta_types

        # Guest accepts
        acc = requests.post(
            f"{API}/play/{sid}/accept",
            headers=_hdr(frankie["tok"]),
            timeout=15,
        )
        assert acc.status_code == 200, acc.text
        acc_sess = acc.json()
        assert acc_sess["status"] in ("active", "playing"), acc_sess

        # Play a couple of moves — this_or_that: submit pick per question
        # Grab session state
        state = requests.get(f"{API}/play/{sid}", headers=_hdr(maggie["tok"]), timeout=15).json()
        qs = (state.get("content") or {}).get("questions") or []
        # Both players pick on each question until finished, cap safety at 10 iterations
        for i in range(min(len(qs), 5)):
            qid = qs[i]["id"] if isinstance(qs[i], dict) else None
            for pl in (maggie, frankie):
                try:
                    requests.post(
                        f"{API}/play/{sid}/answer",
                        headers=_hdr(pl["tok"]),
                        json={"question_id": qid, "choice": "A"},
                        timeout=15,
                    )
                except Exception:
                    pass

        # Give the socket flush + potential DB writes time
        time.sleep(1.0)

        after2 = requests.get(
            f"{API}/notifications/{frankie['id']}",
            headers=_hdr(frankie["tok"]),
            timeout=15,
        ).json()
        session_scoped2 = [
            n for n in after2
            if (n.get("payload") or {}).get("session_id") == sid
        ]
        types2 = [n.get("type") for n in session_scoped2]
        # Still no ephemeral events persisted
        assert types2.count("game_invite") == 1
        for forbidden in ("game_start", "game_move", "game_end"):
            assert forbidden not in types2, f"{forbidden} was persisted (should be ephemeral). types2={types2}"

        # Also verify the HOST never received persisted ephemeral events
        host_notifs = requests.get(
            f"{API}/notifications/{maggie['id']}",
            headers=_hdr(maggie["tok"]),
            timeout=15,
        ).json()
        host_scoped = [
            n for n in host_notifs
            if (n.get("payload") or {}).get("session_id") == sid
        ]
        for n in host_scoped:
            assert n.get("type") not in ("game_start", "game_move", "game_end"), \
                f"host got persisted ephemeral event: {n}"


# =========================================================
# Section 2 — Matchmaking origin
# =========================================================

class TestMatchmakingOrigin:
    def test_find_match_returns_matchmaking_origin_or_404(self, maggie):
        r = requests.post(
            f"{API}/play/find-match",
            headers=_hdr(maggie["tok"]),
            json={"game": "this_or_that"},
            timeout=15,
        )
        # 404 is acceptable if no eligible online member
        assert r.status_code in (200, 404), r.text
        if r.status_code == 200:
            sess = r.json()
            assert sess.get("origin") == "matchmaking", sess


# =========================================================
# Section 3 — Table invitee roster
# =========================================================

class TestTableInviteeRoster:
    def test_roster_flow_invited_declined_joined(self, maggie, frankie):
        _ensure_friends(maggie, frankie)
        # Host creates a table & explicitly invites frankie
        create = requests.post(
            f"{API}/tables",
            headers=_hdr(maggie["tok"]),
            json={
                "host_id": maggie["id"],
                "name": "TEST_iter206_roster",
                "emoji": "☕",
                "description": "roster fixture",
                "invite_ids": [frankie["id"]],
            },
            timeout=15,
        )
        assert create.status_code == 200, create.text
        t = create.json()
        tid = t["id"]

        try:
            # Initial GET → frankie shows as 'invited'
            g1 = requests.get(f"{API}/tables/{tid}", timeout=15).json()
            inv1 = g1.get("invitees") or []
            frow = next((i for i in inv1 if i["id"] == frankie["id"]), None)
            assert frow is not None, f"invitee row missing: {inv1}"
            assert frow["status"] == "invited", frow

            # Decline
            dec = requests.post(
                f"{API}/tables/{tid}/decline/{frankie['id']}",
                headers=_hdr(frankie["tok"]),
                timeout=15,
            )
            assert dec.status_code == 200, dec.text
            g2 = requests.get(f"{API}/tables/{tid}", timeout=15).json()
            frow2 = next((i for i in (g2.get("invitees") or []) if i["id"] == frankie["id"]), None)
            assert frow2 and frow2["status"] == "declined", frow2

            # Join → declined cleared
            jn = requests.post(
                f"{API}/tables/{tid}/join/{frankie['id']}",
                headers=_hdr(frankie["tok"]),
                timeout=15,
            )
            assert jn.status_code == 200, jn.text
            g3 = requests.get(f"{API}/tables/{tid}", timeout=15).json()
            frow3 = next((i for i in (g3.get("invitees") or []) if i["id"] == frankie["id"]), None)
            assert frow3 and frow3["status"] == "joined", frow3
            # declined_ids should have been $pull-ed
            # (frow3 confirms status is now 'joined', which requires not-in-declined)
        finally:
            # Cleanup
            try:
                requests.delete(
                    f"{API}/tables/{tid}",
                    headers=_hdr(maggie["tok"]),
                    params={"host_id": maggie["id"]},
                    timeout=15,
                )
            except Exception:
                pass


# =========================================================
# Section 4 — George / Georgia companion instant greeting
# =========================================================

class TestCompanionInstantGreeting:
    @pytest.fixture(scope="class")
    def member_tok(self):
        r = requests.post(
            f"{API}/auth/login",
            json={"username": MEMBER_EMAIL, "password": MEMBER_PASSWORD},
            timeout=15,
        )
        if r.status_code != 200:
            pytest.skip(f"member login failed: {r.status_code} {r.text[:200]}")
        return r.json()["access_token"]

    def _reset(self, tok, persona):
        try:
            requests.post(
                f"{API}/mcgs/george/companion/reset",
                headers=_hdr(tok),
                json={"persona": persona},
                timeout=15,
            )
        except Exception:
            pass

    def test_george_instant_greeting_fast(self, member_tok):
        # Reset so we test the brand-new-session path (instant, no LLM)
        self._reset(member_tok, "george")
        t0 = time.time()
        r = requests.get(
            f"{API}/mcgs/george/companion",
            headers=_hdr(member_tok),
            params={"persona": "george"},
            timeout=15,
        )
        dt = time.time() - t0
        assert r.status_code == 200, r.text
        sess = r.json()
        turns = sess.get("turns") or []
        assert turns, "no opening turn"
        assert turns[0]["role"] == "george", turns[0]
        assert (turns[0].get("content") or "").strip(), "empty opening"
        # Instant templated opener; allow generous network slack but still
        # well under a typical LLM cold call (5-15s+). Anything <5s means the
        # instant opener is firing.
        assert dt < 5.0, f"first-open too slow ({dt:.2f}s) — instant opener may not be firing"

    def test_georgia_instant_greeting_fast(self, member_tok):
        self._reset(member_tok, "georgia")
        t0 = time.time()
        r = requests.get(
            f"{API}/mcgs/george/companion",
            headers=_hdr(member_tok),
            params={"persona": "georgia"},
            timeout=15,
        )
        dt = time.time() - t0
        assert r.status_code == 200, r.text
        sess = r.json()
        turns = sess.get("turns") or []
        assert turns and turns[0]["role"] == "george"
        content = (turns[0].get("content") or "").strip()
        assert content
        # Georgia-flavored: name should include 'Georgia' in the opener
        assert "Georgia" in content, f"expected Georgia name in opener: {content!r}"
        assert dt < 5.0, f"georgia first-open too slow ({dt:.2f}s)"
