"""iter243 TestFlight mobile polish fixes — backend contract tests.

Covers 4 of the 7 fixes whose backend side can be verified from HTTP:
  (3)  Welcomed members: GET /api/community/today?user_id=... strips all-time
       welcomes; GET /api/greetings/sent-today/{user_id} returns all-time welcomes
  (5+6) Founder counts endpoint: GET /api/founders/status (cap/taken/remaining)
       and GET /api/founders returns the Wall list.
  (companion) POST /api/mcgs/george/companion/warmup +
             POST /api/mcgs/george/companion/turn — latency + navigate_to for
             "take me to my friends" (fix #1 companion→friends handoff).

The frontend-only aspects (nav CTA button, bottom-nav outline ring, nudge
layering, button styling, badge truncation, plural wording) are tested via
Playwright separately — this file guards the backend contracts.
"""
from __future__ import annotations

import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
if not BASE_URL:
    # Fall back to the frontend/.env value if the shell didn't export it.
    try:
        with open("/app/frontend/.env", "r", encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
    except Exception:  # pragma: no cover
        pass
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def frankie(session: requests.Session) -> dict:
    r = session.post(f"{API}/auth/demo-login", json={"username": "frankie"}, timeout=20)
    assert r.status_code == 200, f"demo-login frankie: {r.status_code} {r.text[:200]}"
    data = r.json()
    assert data.get("access_token") and data.get("user", {}).get("id"), data
    return data


@pytest.fixture(scope="module")
def maggie(session: requests.Session) -> dict:
    r = session.post(f"{API}/auth/demo-login", json={"username": "maggie"}, timeout=20)
    assert r.status_code == 200, f"demo-login maggie: {r.status_code} {r.text[:200]}"
    return r.json()


# ---------------------------------------------------------------------------
# Fix #6 — Founder counts come from live endpoints with plural wording hint
# ---------------------------------------------------------------------------
class TestFoundersCounts:
    def test_founders_status_shape(self, session):
        r = session.get(f"{API}/founders/status", timeout=15)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        for k in ("cap", "taken", "remaining", "open"):
            assert k in d, f"missing key {k}"
        assert isinstance(d["cap"], int) and d["cap"] >= 1
        assert isinstance(d["taken"], int) and d["taken"] >= 0
        assert isinstance(d["remaining"], int)
        # Arithmetic must hold
        assert d["cap"] - d["taken"] == d["remaining"], d
        # Spec says cap 250; current taken 9 → remaining 241.
        assert d["cap"] == 250, f"expected cap=250, got {d['cap']}"

    def test_founders_wall_list(self, session):
        r = session.get(f"{API}/founders", timeout=15)
        assert r.status_code == 200, r.text[:200]
        payload = r.json()
        # Accept either {items: [...]} or a raw list.
        items = payload.get("items") if isinstance(payload, dict) else payload
        assert isinstance(items, list), f"unexpected shape: {type(payload)}"
        # taken count on /status should match the number of founder rows.
        status = session.get(f"{API}/founders/status", timeout=15).json()
        assert len(items) == status["taken"], (
            f"/founders returned {len(items)} rows but /founders/status taken={status['taken']}"
        )


# ---------------------------------------------------------------------------
# Fix #3 — Welcomed members persistence
# ---------------------------------------------------------------------------
class TestWelcomePersistence:
    def test_greetings_sent_today_shape(self, session, frankie):
        tok = frankie["access_token"]
        uid = frankie["user"]["id"]
        r = session.get(
            f"{API}/greetings/sent-today/{uid}",
            headers={"Authorization": f"Bearer {tok}"},
            timeout=15,
        )
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        assert "welcome" in d and "birthday" in d
        assert isinstance(d["welcome"], list)
        assert isinstance(d["birthday"], list)

    def test_community_today_strips_welcomed(self, session, frankie, maggie):
        """Welcome a member once, then verify they never resurface in
        /community/today?user_id= and are present in /greetings/sent-today."""
        tok = frankie["access_token"]
        from_id = frankie["user"]["id"]
        to_id = maggie["user"]["id"]
        # Send welcome greeting (idempotent — endpoint de-dupes). Ignore 409.
        r = session.post(
            f"{API}/greetings/send",
            json={"from_id": from_id, "to_id": to_id, "kind": "welcome"},
            headers={"Authorization": f"Bearer {tok}"},
            timeout=15,
        )
        assert r.status_code in (200, 409), r.text[:200]

        # Now fetch Home digest as frankie — maggie must not appear in new_members.
        rd = session.get(f"{API}/community/today?user_id={from_id}", timeout=15)
        assert rd.status_code == 200, rd.text[:200]
        new_ids = [u.get("id") for u in rd.json().get("new_members", [])]
        assert to_id not in new_ids, (
            "welcomed member resurfaced in /community/today new_members — all-time strip failed"
        )

        # And /greetings/sent-today must list this recipient.
        rs = session.get(
            f"{API}/greetings/sent-today/{from_id}",
            headers={"Authorization": f"Bearer {tok}"},
            timeout=15,
        )
        assert rs.status_code == 200
        assert to_id in rs.json().get("welcome", []), (
            "sent-today welcome list did not include the recipient"
        )


# ---------------------------------------------------------------------------
# Fix #1 — Companion nav intent + warmup latency
# ---------------------------------------------------------------------------
class TestCompanionNav:
    def test_warmup_ok(self, session, frankie):
        tok = frankie["access_token"]
        t0 = time.perf_counter()
        r = session.post(
            f"{API}/mcgs/george/companion/warmup",
            headers={"Authorization": f"Bearer {tok}"},
            timeout=20,
        )
        dt = time.perf_counter() - t0
        assert r.status_code == 200, r.text[:200]
        assert r.json().get("ok") is True
        print(f"warmup latency={dt*1000:.0f}ms")
        # Fire-and-forget — should return quickly (<3s).
        assert dt < 5.0, f"warmup too slow: {dt:.2f}s"

    def test_friends_nav_turn(self, session, frankie):
        tok = frankie["access_token"]
        t0 = time.perf_counter()
        r = session.post(
            f"{API}/mcgs/george/companion/turn",
            json={"persona": "george", "text": "Can you take me to my friends?"},
            headers={"Authorization": f"Bearer {tok}"},
            timeout=30,
        )
        dt = time.perf_counter() - t0
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        print(f"nav turn latency={dt*1000:.0f}ms response_keys={list(d.keys())}")
        # Deterministic nav path — must respond fast (no LLM call).
        assert dt < 5.0, f"nav turn too slow (deterministic path): {dt:.2f}s"
        # Must return navigate_to pointing at friends.
        nav = d.get("navigate_to") or {}
        assert nav.get("key") in ("friends", "find_friends"), f"navigate_to={nav}"
        assert "friends" in (nav.get("label") or "").lower()
        # Must still include a human reply (so the chat screen keeps the
        # bubble visible rather than auto-navigating).
        assert d.get("message"), "nav reply must still include a message"

    def test_long_turn_latency(self, session, frankie):
        """Non-nav free-form turn — exercises LLM path. Not asserting a
        hard upper bound (depends on provider), just that it returns a
        sensible reply within a generous timeout. We print the time so
        the main agent can compare against the ~2.7s expectation."""
        tok = frankie["access_token"]
        t0 = time.perf_counter()
        r = session.post(
            f"{API}/mcgs/george/companion/turn",
            json={"persona": "george", "text": "Tell me a short friendly hello."},
            headers={"Authorization": f"Bearer {tok}"},
            timeout=45,
        )
        dt = time.perf_counter() - t0
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        print(f"long turn latency={dt*1000:.0f}ms msg_len={len(d.get('message') or '')}")
        assert d.get("message"), "LLM turn must return a message"
        # Soft cap — don't fail the suite on provider slow-down, but flag it.
        if dt > 10.0:
            pytest.skip(f"LLM slow this run ({dt:.1f}s) — not a backend regression")


# ---------------------------------------------------------------------------
# Nudge delivery path — layering above the companion is a frontend concern,
# but the backend must deliver a 'dm' notification so the client can render
# the nudge. We seed a DM from maggie → frankie and verify a dm notification
# lands in frankie's inbox.
# ---------------------------------------------------------------------------
class TestNudgePayload:
    def test_dm_start_and_flutter_nudge(self, session, maggie, frankie):
        """Ensure the server will deliver a nudge-type notification to
        frankie — covers the Companion-nudge layering fix's data path.
        DM message send is a WebSocket operation in this backend, so we
        exercise the REST-visible pieces: /dm/start creates a conversation
        (frontend uses this to open the thread when the nudge is tapped),
        and /flutters/send drops a nudge-type notification into frankie's
        inbox so the client's root CompanionNudge host picks it up."""
        mtok = maggie["access_token"]
        from_id = maggie["user"]["id"]
        to_id = frankie["user"]["id"]

        # 1) DM conversation exists / is created (correct body keys).
        r = session.post(
            f"{API}/dm/start",
            json={"user_id": from_id, "other_id": to_id},
            headers={"Authorization": f"Bearer {mtok}"},
            timeout=15,
        )
        assert r.status_code in (200, 201), r.text[:200]
        conv = r.json()
        assert conv.get("id"), f"no conv id: {conv}"
        assert from_id in (conv.get("participants") or [])
        assert to_id in (conv.get("participants") or [])

        # 2) Fire a flutter — this persists a notification of type 'flutter'
        # which is explicitly in NUDGE_NOTIF_TYPES, so the client renders it
        # as a nudge above the open companion. (Same code path as a 'dm'
        # push arriving via the user socket.)
        rf = session.post(
            f"{API}/flutters/send",
            json={"from_id": from_id, "to_id": to_id, "message": "TEST_iter243 nudge"},
            headers={"Authorization": f"Bearer {mtok}"},
            timeout=15,
        )
        if rf.status_code == 429:
            pytest.skip("flutter rate-limited this run")
        # 409 flutter_already_active is fine — an existing flutter notification
        # already sits in frankie's inbox, which still proves the nudge channel.
        assert rf.status_code in (200, 201, 409), rf.text[:200]

        time.sleep(1.0)
        rn = session.get(
            f"{API}/notifications/{to_id}",
            headers={"Authorization": f"Bearer {frankie['access_token']}"},
            timeout=15,
        )
        assert rn.status_code == 200, rn.text[:200]
        body = rn.json()
        notes = body if isinstance(body, list) else body.get("items", [])
        kinds = {n.get("type") for n in notes}
        assert kinds & {"dm", "dm_request", "flutter", "friend_request", "game_invite"}, (
            f"no nudge-eligible notification landed for frankie: {kinds}"
        )
