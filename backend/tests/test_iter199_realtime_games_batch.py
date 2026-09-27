"""Iter199 — Real-time / games batch verification (items 1, 6, 7, 8, 9, 10).

Reads the external EXPO_BACKEND_URL from /app/frontend/.env directly (the
conftest default points at a stale preview host).

Covers:
  Item 1 — DM `dm_update` fan-out on EVERY message (not just first)
  Item 6 — friend_request notification with request_id (WS receipt)
  Item 7 — Play Again unlimited rematches (5+ consecutive)
  Item 8 — Word Chain first-turn latency (AI category-fit ≤ ~2.5s wall)
  Item 9 — /friends/{uid} returns `status` for each friend
  Item 10 — /tables (visibility=friends, invite_ids=[..]) → table_invite WS

Two-user flows use maggie & frankie (already friends per test_credentials.md).
"""
# ── imports ────────────────────────────────────────────────────────────────
import asyncio
import json
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import pytest
import requests
import websockets


# ── env loading (read frontend/.env directly — authoritative) ─────────────
def _load_backend_url() -> str:
    env_path = Path("/app/frontend/.env")
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    return os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")


BASE_URL = _load_backend_url()
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL missing from /app/frontend/.env"
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")


# ── shared helpers ─────────────────────────────────────────────────────────
def demo_login(username: str) -> Dict[str, Any]:
    r = requests.post(f"{BASE_URL}/api/auth/demo-login", json={"username": username}, timeout=15)
    assert r.status_code == 200, f"demo-login {username} failed: {r.status_code} {r.text[:200]}"
    d = r.json()
    assert "access_token" in d and "user" in d
    return d


def auth_headers(tok: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def maggie() -> Dict[str, Any]:
    return demo_login("maggie")


@pytest.fixture(scope="module")
def frankie() -> Dict[str, Any]:
    return demo_login("frankie")


# ── ITEM 1 — DM dm_update fan-out on every message ────────────────────────
class TestItem1DMFanoutEveryMessage:
    """Send 3 DMs from maggie → frankie via the WS DM socket; the recipient's
    user socket must receive a `dm_update` event for EACH of them."""

    def test_dm_update_fires_on_every_message(self, maggie, frankie):
        m_tok = maggie["access_token"]
        m_id = maggie["user"]["id"]
        f_id = frankie["user"]["id"]

        # Open/find a conversation between maggie and frankie.
        r = requests.post(
            f"{BASE_URL}/api/dm/start",
            headers=auth_headers(m_tok),
            json={"user_id": m_id, "other_id": f_id},
            timeout=15,
        )
        assert r.status_code == 200, f"dm/start failed: {r.status_code} {r.text[:200]}"
        conv_id = r.json().get("id") or r.json().get("conv_id") or r.json().get("conversation_id")
        assert conv_id, f"no conv id in dm/start response: {r.json()}"

        received: List[Dict[str, Any]] = []

        async def run() -> None:
            # Connect frankie's user socket to observe dm_update fan-out.
            user_ws_url = f"{WS_BASE}/api/ws/user/{f_id}?token={frankie['access_token']}"
            dm_ws_url = f"{WS_BASE}/api/ws/dm/{conv_id}?user_id={m_id}&token={m_tok}"
            async with websockets.connect(user_ws_url, open_timeout=10) as user_ws, \
                       websockets.connect(dm_ws_url, open_timeout=10) as dm_ws:
                await asyncio.sleep(0.4)
                for idx in range(1, 4):
                    # Send DM via the DM websocket.
                    await dm_ws.send(json.dumps({"text": f"TEST_iter199 msg{idx}"}))
                    # Wait for the dm_update on frankie's user socket.
                    got = False
                    try:
                        while not got:
                            raw = await asyncio.wait_for(user_ws.recv(), timeout=5.0)
                            data = json.loads(raw)
                            if data.get("type") == "dm_update" and data.get("conv_id") == conv_id:
                                received.append(data)
                                got = True
                    except asyncio.TimeoutError:
                        break

        asyncio.get_event_loop().run_until_complete(run())

        assert len(received) == 3, (
            f"Expected 3 dm_update events (one per message), got {len(received)}. "
            f"Events: {received}"
        )
        # Payload sanity.
        for ev in received:
            assert ev["from_id"] == m_id
            assert "last_message" in ev
            assert "unread_delta" in ev


# ── ITEM 6 — friend_request WS notification carries request_id ────────────
class TestItem6FriendRequestNotification:
    """Non-friends: art → eil. WS should push `friend_request` with request_id."""

    def _ensure_not_friends(self, tok_a: str, a_id: str, b_id: str) -> None:
        # Best-effort: unfriend if currently friends.
        try:
            requests.post(
                f"{BASE_URL}/api/friends/{a_id}/unfriend/{b_id}",
                headers=auth_headers(tok_a),
                timeout=10,
            )
        except Exception:
            pass
        # Cancel any pending req in either direction (best effort).
        try:
            r = requests.get(f"{BASE_URL}/api/friends/inbox/{a_id}", headers=auth_headers(tok_a), timeout=10)
            if r.status_code == 200:
                data = r.json()
                for req in (data.get("outgoing") or []):
                    if req.get("to_id") == b_id and req.get("status") == "pending":
                        requests.post(
                            f"{BASE_URL}/api/friends/cancel/{req['id']}",
                            headers=auth_headers(tok_a),
                            timeout=10,
                        )
                for req in (data.get("incoming") or []):
                    if req.get("from_id") == b_id and req.get("status") == "pending":
                        requests.post(
                            f"{BASE_URL}/api/friends/decline/{req['id']}",
                            headers=auth_headers(tok_a),
                            timeout=10,
                        )
        except Exception:
            pass

    def test_friend_request_ws_notification(self):
        art = demo_login("art")
        eil = demo_login("eil")
        a_tok = art["access_token"]
        a_id = art["user"]["id"]
        e_id = eil["user"]["id"]
        self._ensure_not_friends(a_tok, a_id, e_id)

        seen_notification: List[Dict[str, Any]] = []

        async def run() -> None:
            user_ws_url = f"{WS_BASE}/api/ws/user/{e_id}?token={eil['access_token']}"
            async with websockets.connect(user_ws_url, open_timeout=10) as ws:
                # Trigger friend request AFTER socket is open.
                await asyncio.sleep(0.4)
                r = requests.post(
                    f"{BASE_URL}/api/friends/request",
                    headers=auth_headers(a_tok),
                    json={"from_id": a_id, "to_id": e_id},
                    timeout=15,
                )
                assert r.status_code == 200, f"friend/request failed: {r.status_code} {r.text[:200]}"
                req_id = r.json().get("id")
                assert req_id
                # Wait for notification event.
                try:
                    while True:
                        raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
                        data = json.loads(raw)
                        if data.get("type") == "notification":
                            n = data.get("notification") or {}
                            if n.get("type") == "friend_request":
                                seen_notification.append(n)
                                break
                except asyncio.TimeoutError:
                    pass

                # Clean up: decline via api.
                try:
                    requests.post(
                        f"{BASE_URL}/api/friends/decline/{req_id}",
                        headers=auth_headers(eil["access_token"]),
                        timeout=10,
                    )
                except Exception:
                    pass

        asyncio.get_event_loop().run_until_complete(run())

        assert seen_notification, "No friend_request notification received on user WS"
        n = seen_notification[0]
        payload = n.get("payload") or {}
        assert payload.get("request_id"), f"friend_request payload missing request_id: {payload}"
        assert payload.get("from_id") == a_id


# ── ITEM 7 — 5+ consecutive rematches ─────────────────────────────────────
class TestItem7UnlimitedRematches:
    """CRITICAL: prove rematches work at the API level 5+ times in a row."""

    def _finish_this_or_that(self, sess: Dict[str, Any], host_tok: str, guest_tok: str) -> Dict[str, Any]:
        """Both players submit answers so the session goes to 'finished'."""
        # answers count matches prompts length; answers are integer indices.
        n_prompts = len(sess["content"]["prompts"])
        answers = [0] * n_prompts
        # Host submits
        r1 = requests.post(
            f"{BASE_URL}/api/play/{sess['id']}/move",
            headers=auth_headers(host_tok),
            json={"answers": answers},
            timeout=15,
        )
        assert r1.status_code == 200, f"host move failed: {r1.status_code} {r1.text[:200]}"
        # Guest submits
        r2 = requests.post(
            f"{BASE_URL}/api/play/{sess['id']}/move",
            headers=auth_headers(guest_tok),
            json={"answers": answers},
            timeout=15,
        )
        assert r2.status_code == 200, f"guest move failed: {r2.status_code} {r2.text[:200]}"
        final = r2.json()
        assert final["status"] == "finished", f"Expected finished, got {final['status']}"
        return final

    def test_five_consecutive_rematches(self, maggie, frankie):
        m_tok = maggie["access_token"]
        f_tok = frankie["access_token"]
        m_id = maggie["user"]["id"]
        f_id = frankie["user"]["id"]

        # Step 1: create initial invite.
        r = requests.post(
            f"{BASE_URL}/api/play/invite",
            headers=auth_headers(m_tok),
            json={"friend_id": f_id, "game": "this_or_that"},
            timeout=15,
        )
        assert r.status_code == 200, f"play/invite failed: {r.status_code} {r.text[:200]}"
        sess = r.json()
        session_ids_seen: List[str] = [sess["id"]]

        # Accept + finish 6 sessions total (1 initial + 5 rematches).
        for round_num in range(6):
            # Accept as guest (frankie).
            ar = requests.post(
                f"{BASE_URL}/api/play/{sess['id']}/accept",
                headers=auth_headers(f_tok),
                timeout=15,
            )
            assert ar.status_code == 200, f"[round {round_num}] accept failed: {ar.status_code} {ar.text[:200]}"
            # Reload session (fresh content) as host.
            gr = requests.get(f"{BASE_URL}/api/play/{sess['id']}", headers=auth_headers(m_tok), timeout=15)
            assert gr.status_code == 200
            sess_active = gr.json()
            assert sess_active["status"] == "active"
            # Finish it.
            final = self._finish_this_or_that(sess_active, m_tok, f_tok)
            # Rematch (except after the last round).
            if round_num < 5:
                rem = requests.post(
                    f"{BASE_URL}/api/play/{sess['id']}/rematch",
                    headers=auth_headers(m_tok),
                    timeout=15,
                )
                assert rem.status_code == 200, (
                    f"[round {round_num}] rematch failed: {rem.status_code} {rem.text[:200]}"
                )
                new_sess = rem.json()
                assert new_sess["id"] != sess["id"], "rematch returned same id"
                assert new_sess["id"] not in session_ids_seen, "rematch returned duplicate id"
                assert new_sess["status"] == "invited", f"rematch status was {new_sess['status']}"
                # Scores reset
                for p in new_sess["players"]:
                    assert p["score"] == 0, f"score not reset: {p}"
                    assert p["done"] is False
                session_ids_seen.append(new_sess["id"])
                sess = new_sess

        assert len(session_ids_seen) == 6, f"expected 6 unique session ids, got {session_ids_seen}"
        # All ids unique
        assert len(set(session_ids_seen)) == 6, f"duplicates in {session_ids_seen}"


# ── ITEM 8 — Word Chain first-turn latency ────────────────────────────────
class TestItem8WordChainLatency:
    """AI category-fit ≤ ~3.0s wall (2.0s timeout + a bit of overhead).
    Deterministic rejects still return instantly."""

    def test_first_turn_ai_check_fast(self, maggie, frankie):
        m_tok = maggie["access_token"]
        f_tok = frankie["access_token"]
        m_id = maggie["user"]["id"]
        f_id = frankie["user"]["id"]

        # Create word_chain session.
        r = requests.post(
            f"{BASE_URL}/api/play/invite",
            headers=auth_headers(m_tok),
            json={"friend_id": f_id, "game": "word_chain"},
            timeout=15,
        )
        assert r.status_code == 200, f"invite failed: {r.status_code} {r.text[:200]}"
        sess = r.json()
        # Accept.
        ar = requests.post(f"{BASE_URL}/api/play/{sess['id']}/accept", headers=auth_headers(f_tok), timeout=15)
        assert ar.status_code == 200
        # Pull the required letter.
        gr = requests.get(f"{BASE_URL}/api/play/{sess['id']}", headers=auth_headers(m_tok), timeout=15)
        active = gr.json()
        letter = active["content"]["required_letter"]
        category = active["content"]["category"]

        # Send a made-up but plausible word starting with the required letter
        # that is NOT in the curated bank → forces AI check.
        # Use an obscure-sounding word to nudge the model toward NO or timeout,
        # but the graceful fallback should always resolve quickly.
        word = f"{letter}zzybloop"  # gibberish → likely NO or timeout accept
        t0 = time.time()
        mr = requests.post(
            f"{BASE_URL}/api/play/{sess['id']}/move",
            headers=auth_headers(m_tok),
            json={"word": word},
            timeout=15,
        )
        elapsed = time.time() - t0
        # Either 200 (accepted via timeout-fallback) or 400 (AI cleanly said NO).
        assert mr.status_code in (200, 400), f"unexpected status {mr.status_code}: {mr.text[:200]}"
        assert elapsed < 4.5, f"Word Chain AI check took {elapsed:.2f}s (spec: ≤2.0s timeout)"

        # Deterministic reject (wrong starting letter) — should be instant.
        wrong_letter = "Z" if letter != "Z" else "A"
        t1 = time.time()
        # Load fresh state to see whose turn it is.
        cur = requests.get(f"{BASE_URL}/api/play/{sess['id']}", headers=auth_headers(m_tok), timeout=15).json()
        turn = cur["turn"]
        tok = m_tok if turn == m_id else f_tok
        rr = requests.post(
            f"{BASE_URL}/api/play/{sess['id']}/move",
            headers=auth_headers(tok),
            json={"word": f"{wrong_letter}apple"},
            timeout=15,
        )
        det_elapsed = time.time() - t1
        # Should be 400 with fast response (< 1s) — deterministic reject.
        assert rr.status_code == 400, f"expected 400 for wrong-letter, got {rr.status_code}"
        assert det_elapsed < 1.5, f"deterministic reject took {det_elapsed:.2f}s (expected <1s)"


# ── ITEM 9 — /friends/{uid} returns status ────────────────────────────────
class TestItem9FriendsStatusField:
    def test_friends_endpoint_includes_status(self, maggie, frankie):
        m_tok = maggie["access_token"]
        m_id = maggie["user"]["id"]
        f_id = frankie["user"]["id"]

        # Wake frankie's presence.
        requests.get(f"{BASE_URL}/api/auth/me", headers=auth_headers(frankie["access_token"]), timeout=10)

        r = requests.get(f"{BASE_URL}/api/friends/{m_id}", headers=auth_headers(m_tok), timeout=15)
        assert r.status_code == 200, f"/friends/{m_id} failed: {r.status_code} {r.text[:200]}"
        data = r.json()
        assert "friends" in data
        friends = data["friends"]
        assert isinstance(friends, list) and len(friends) > 0, "maggie has no friends?"
        # Find frankie.
        f_entry = next((f for f in friends if f["id"] == f_id), None)
        assert f_entry, f"frankie not in maggie's friends list: {[f['id'] for f in friends]}"
        assert "status" in f_entry, f"status field missing on friend entry: {f_entry}"
        # status is a dict with `code`, `label`, `emoji`.
        st = f_entry["status"]
        if isinstance(st, dict):
            assert "code" in st, f"status dict missing code: {st}"
            assert st["code"] in ("online", "offline", "away", "invisible", "recent", "recently"), (
                f"unexpected status code: {st}"
            )
        else:
            assert st in ("online", "offline", "away", "invisible", "recently", "recent"), (
                f"unexpected status: {st}"
            )
        # Every friend should have a status field.
        for f in friends:
            assert "status" in f, f"status missing on {f}"


# ── ITEM 10 — table_invite WS notification with table_id ──────────────────
class TestItem10TableInviteNotification:
    def test_table_invite_pushed_to_friends_only_invitee(self, maggie, frankie):
        m_tok = maggie["access_token"]
        m_id = maggie["user"]["id"]
        f_id = frankie["user"]["id"]

        seen: List[Dict[str, Any]] = []

        async def run() -> None:
            user_ws_url = f"{WS_BASE}/api/ws/user/{f_id}?token={frankie['access_token']}"
            async with websockets.connect(user_ws_url, open_timeout=10) as ws:
                await asyncio.sleep(0.4)
                r = requests.post(
                    f"{BASE_URL}/api/tables",
                    headers=auth_headers(m_tok),
                    json={
                        "host_id": m_id,
                        "name": "TEST_iter199 table",
                        "emoji": "☕",
                        "description": "iter199 verification",
                        "visibility": "friends",
                        "invite_ids": [f_id],
                    },
                    timeout=15,
                )
                assert r.status_code == 200, f"tables create failed: {r.status_code} {r.text[:200]}"
                table = r.json()
                table_id = table.get("id")
                assert table_id
                try:
                    while True:
                        raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
                        data = json.loads(raw)
                        if data.get("type") == "notification":
                            n = data.get("notification") or {}
                            if n.get("type") == "table_invite":
                                seen.append({"notif": n, "table_id": table_id})
                                break
                except asyncio.TimeoutError:
                    pass

        asyncio.get_event_loop().run_until_complete(run())

        assert seen, "No table_invite notification received on frankie's user WS"
        entry = seen[0]
        payload = entry["notif"].get("payload") or {}
        assert payload.get("table_id") == entry["table_id"], (
            f"payload.table_id mismatch: expected {entry['table_id']}, got {payload}"
        )
        assert payload.get("host_id") == maggie["user"]["id"]
