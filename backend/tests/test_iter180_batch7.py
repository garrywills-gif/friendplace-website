"""
Iter180 — 7-item batch (backend items 4 + 5)
Item 4  Notification sanitisation:
        - Sending a DM whose text contains a data:image/base64 blob / preset:
          / portrait-<n> / long base64 run must yield a CLEAN notification
          body and CLEAN conversations preview (nothing raw).
        - A normal, plain-text DM must still deliver a clean, human-readable
          notification title/body.
Item 5  Play again both directions:
        - Host rematch  -> new session status='invited', game_invite for GUEST
        - Guest rematch -> new session status='invited', game_invite for HOST
"""
import asyncio
import json
import os
import time
import uuid

import pytest
import requests
import websockets

# NOTE: hardcoded to the *current* preview URL per the review request.
# conftest.py pre-sets EXPO_PUBLIC_BACKEND_URL to a stale host, so relying on
# the env var here yields 404s. The main agent test-runner explicitly
# specifies https://friendplace-stable.preview.emergentagent.com.
BASE_URL = "https://friendplace-stable.preview.emergentagent.com".rstrip("/")
API = f"{BASE_URL}/api"
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")


# ---- helpers ---------------------------------------------------------------

def _demo_login(username: str):
    r = requests.post(f"{API}/auth/demo-login", json={"username": username}, timeout=15)
    assert r.status_code == 200, f"demo-login {username} failed: {r.status_code} {r.text}"
    body = r.json()
    return body["access_token"], body["user"]


def _headers(token: str):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _wait_for_notification(user_id: str, n_type: str, since_ts: float, session_id: str = None,
                           text_predicate=None, timeout: int = 15):
    """Poll GET /api/notifications/{user_id} until we see a notification of the
    requested type. Returns the notification dict or None on timeout."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = requests.get(f"{API}/notifications/{user_id}", timeout=10)
        if r.status_code == 200:
            for n in r.json() or []:
                if n.get("type") != n_type:
                    continue
                if session_id and (n.get("payload") or {}).get("session_id") != session_id:
                    continue
                if text_predicate and not text_predicate(n):
                    continue
                return n
        time.sleep(0.6)
    return None


def _ensure_friends(a_id: str, a_token: str, b_id: str, b_token: str):
    """maggie + frankie are already friends per test_credentials.md, but verify."""
    r = requests.get(f"{API}/auth/me", headers=_headers(a_token), timeout=10)
    friends = (r.json() or {}).get("friends") or []
    return b_id in friends


# ---- Item 4: notification sanitisation --------------------------------------

class TestItem4NotificationSanitisation:
    """DM notification body + conversations preview must always be clean."""

    @classmethod
    def setup_class(cls):
        cls.a_token, cls.a = _demo_login("maggie")
        cls.b_token, cls.b = _demo_login("frankie")
        # ensure a conversation exists
        r = requests.post(
            f"{API}/dm/start",
            headers=_headers(cls.a_token),
            json={"user_id": cls.a["id"], "other_id": cls.b["id"]},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        cls.conv_id = r.json()["id"]

    def _send_dm(self, sender_token, sender_id, text):
        ws_url = f"{WS_BASE}/api/ws/dm/{self.conv_id}?user_id={sender_id}&token={sender_token}"

        async def _go():
            async with websockets.connect(ws_url) as ws:
                await ws.send(json.dumps({"text": text}))
                # wait for the echo (ensures server persisted + fanned out)
                for _ in range(4):
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=4)
                        m = json.loads(raw)
                        if m.get("type") == "message":
                            return m
                    except asyncio.TimeoutError:
                        break
            return None

        return asyncio.get_event_loop().run_until_complete(_go())

    def test_dm_with_base64_blob_produces_clean_notification(self):
        """Backend _clean_notification_text must strip base64 / preset: /
        portrait-<n> / long base64 runs from BOTH the notification body and
        the conversations last-message preview."""
        # send a message that would leak raw payload if not sanitised
        dirty = (
            "hey mate check this out data:image/png;base64,"
            "AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKKKLLLLMMMMNNNN"
            "OOOOPPPPQQQQRRRRSSSSTTTT preset:portrait gallery:one "
            "portrait-42 sending along."
        )
        echo = self._send_dm(self.a_token, self.a["id"], dirty)
        assert echo is not None, "server did not echo the DM message"
        time.sleep(1.5)  # allow notification insert + fan-out

        # 1) Notifications list for the RECIPIENT must be clean
        r = requests.get(f"{API}/notifications/{self.b['id']}", timeout=10)
        assert r.status_code == 200
        dm_notifs = [n for n in r.json() if n.get("type") in ("dm", "dm_request") and (n.get("payload") or {}).get("dm_id") == self.conv_id]
        assert dm_notifs, "no dm notification created for the recipient"
        latest = dm_notifs[0]
        body = (latest.get("body") or "")
        title = (latest.get("title") or "")
        for banned in ["data:image", "base64,", "preset:", "gallery:", "portrait-42"]:
            assert banned not in body, f"raw '{banned}' leaked into notification body: {body!r}"
            assert banned not in title, f"raw '{banned}' leaked into notification title: {title!r}"
        # long base64 runs are stripped by _clean_notification_text
        import re
        assert not re.search(r"[A-Za-z0-9+/]{40,}={0,2}", body), f"long base64 run leaked: {body!r}"

        # 2) Conversations preview for the RECIPIENT must be clean
        r = requests.get(
            f"{API}/dm/{self.b['id']}/conversations",
            headers=_headers(self.b_token),
            timeout=10,
        )
        assert r.status_code == 200
        convs = r.json() or []
        this_conv = next((c for c in convs if c.get("id") == self.conv_id), None)
        assert this_conv is not None, "conversation missing from list"
        prev_text = ((this_conv.get("last") or {}).get("text") or "")
        for banned in ["data:image", "base64,", "preset:", "gallery:", "portrait-42"]:
            assert banned not in prev_text, f"raw '{banned}' leaked into conv preview: {prev_text!r}"
        assert not re.search(r"[A-Za-z0-9+/]{40,}={0,2}", prev_text), f"long base64 run in preview: {prev_text!r}"

    def test_normal_dm_produces_clean_human_notification(self):
        """A plain-text DM must produce a normal 'sent you a message' /
        'started a chat with you' notification with the message body intact."""
        text = "hello friend, how are you today?"
        self._send_dm(self.a_token, self.a["id"], text)
        time.sleep(1.5)
        n = _wait_for_notification(
            self.b["id"],
            "dm",
            since_ts=0,
            text_predicate=lambda nn: (nn.get("payload") or {}).get("dm_id") == self.conv_id,
            timeout=10,
        ) or _wait_for_notification(
            self.b["id"],
            "dm_request",
            since_ts=0,
            text_predicate=lambda nn: (nn.get("payload") or {}).get("dm_id") == self.conv_id,
            timeout=5,
        )
        assert n is not None, "expected a dm/dm_request notification for the recipient"
        title = n.get("title") or ""
        body = n.get("body") or ""
        # title should mention the sender and 'message' or 'chat'
        assert ("message" in title.lower()) or ("chat" in title.lower()), \
            f"notification title not human-readable: {title!r}"
        # body should be the actual text (or at worst empty) — never a payload dump
        assert "{" not in body and "}" not in body, f"raw JSON in body: {body!r}"


# ---- Item 5: Play again both directions -------------------------------------

class TestItem5RematchBothDirections:
    """POST /api/play/{session_id}/rematch must work for both host and guest
    and produce a game_invite notification for the OTHER player each time."""

    GAME = "this_or_that"  # no correct-answer complexity; both submit, finishes.

    @classmethod
    def setup_class(cls):
        cls.host_token, cls.host = _demo_login("maggie")
        cls.guest_token, cls.guest = _demo_login("frankie")

    def _play_a_full_game(self, host_token, host, guest_token, guest):
        """Invite -> accept -> both submit answers -> finished."""
        # invite
        r = requests.post(
            f"{API}/play/invite",
            headers=_headers(host_token),
            json={"friend_id": guest["id"], "game": self.GAME},
            timeout=15,
        )
        assert r.status_code == 200, f"invite failed: {r.status_code} {r.text}"
        sess = r.json()
        sid = sess["id"]
        # accept
        r = requests.post(f"{API}/play/{sid}/accept", headers=_headers(guest_token), timeout=10)
        assert r.status_code == 200, r.text
        sess = r.json()
        # this_or_that: prompts are 5; each player submits 5 answers (0 or 1)
        prompts = sess.get("content", {}).get("prompts") or []
        assert len(prompts) == 5
        answers = [0] * 5
        for tok in (host_token, guest_token):
            r = requests.post(
                f"{API}/play/{sid}/move",
                headers=_headers(tok),
                json={"answers": answers},
                timeout=10,
            )
            assert r.status_code == 200, r.text
        # session should now be finished
        r = requests.get(f"{API}/play/{sid}", headers=_headers(host_token), timeout=10)
        assert r.status_code == 200
        assert r.json().get("status") == "finished", r.json()
        return sid

    def test_host_rematch_notifies_guest(self):
        sid = self._play_a_full_game(self.host_token, self.host, self.guest_token, self.guest)
        r = requests.post(f"{API}/play/{sid}/rematch", headers=_headers(self.host_token), timeout=10)
        assert r.status_code == 200, f"rematch (host) failed: {r.status_code} {r.text}"
        new_sess = r.json()
        assert new_sess["id"] != sid, "rematch must create a NEW session id"
        assert new_sess["status"] == "invited", f"new session status: {new_sess['status']}"
        assert new_sess["host_id"] == self.host["id"]
        assert new_sess["guest_id"] == self.guest["id"]
        # guest must get a game_invite notification with the new session_id
        n = _wait_for_notification(
            self.guest["id"], "game_invite", since_ts=0, session_id=new_sess["id"], timeout=10,
        )
        assert n is not None, "guest did not receive a game_invite for the rematch"
        assert (n.get("payload") or {}).get("session_id") == new_sess["id"]

    def test_guest_rematch_notifies_host(self):
        sid = self._play_a_full_game(self.host_token, self.host, self.guest_token, self.guest)
        # this time GUEST calls rematch
        r = requests.post(f"{API}/play/{sid}/rematch", headers=_headers(self.guest_token), timeout=10)
        assert r.status_code == 200, f"rematch (guest) failed: {r.status_code} {r.text}"
        new_sess = r.json()
        assert new_sess["id"] != sid
        assert new_sess["status"] == "invited"
        # when guest initiates the rematch, guest becomes the new host
        assert new_sess["host_id"] == self.guest["id"], f"host: {new_sess['host_id']}"
        assert new_sess["guest_id"] == self.host["id"], f"guest: {new_sess['guest_id']}"
        # host (original inviter A) must get the game_invite
        n = _wait_for_notification(
            self.host["id"], "game_invite", since_ts=0, session_id=new_sess["id"], timeout=10,
        )
        assert n is not None, "host did not receive a game_invite for the reverse rematch"
        assert (n.get("payload") or {}).get("session_id") == new_sess["id"]
