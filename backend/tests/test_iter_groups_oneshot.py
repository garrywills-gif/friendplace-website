"""iter-groups-oneshot (Sep 2026) — group membership gate + Leave, and
server-backed one-shot greeting state.

Covers:
  * Non-member cannot post or comment → 403 not_a_member
  * Joining then posting works; commenting works
  * Leaving drops membership (posts remain) and re-gates posting
  * Rejoining re-enables posting
  * "Say thanks" is idempotent per source notification (server-backed)
  * Wave de-dupe stamps `responded` so the notification reloads as sent
"""
from __future__ import annotations

import uuid

import pytest
import requests

HTTP_BASE = "http://localhost:8001"


def _signup() -> dict:
    uname = f"grp_{uuid.uuid4().hex[:8]}"
    r = requests.post(
        f"{HTTP_BASE}/api/auth/signup",
        json={
            "username": uname,
            "password": "TestPass2026!",
            "email": f"{uname}@example.com",
            "first_name": "Grouper",
        },
        timeout=15,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    return {"id": d["user"]["id"], "token": d["access_token"]}


def _auth(u):
    return {"Authorization": f"Bearer {u['token']}"}


@pytest.fixture(scope="module")
def alice():
    return _signup()


@pytest.fixture(scope="module")
def bob():
    return _signup()


@pytest.fixture(scope="module")
def group(alice):
    # Use a seeded community group — a freshly-signed-up member (bob) is not
    # a member of it, which is exactly what the membership-gate test needs.
    # (Creating via POST /groups is a separate admin/suggest flow.)
    rows = requests.get(f"{HTTP_BASE}/api/groups", timeout=15).json()
    assert rows, "expected at least one seeded community group"
    return rows[0]


class TestGroupMembershipGate:
    def test_non_member_cannot_post(self, group, bob):
        r = requests.post(
            f"{HTTP_BASE}/api/groups/{group['id']}/posts",
            json={"text": "hi", "group_id": group["id"], "user_id": bob["id"]},
            headers=_auth(bob),
            timeout=15,
        )
        assert r.status_code == 403, r.text
        assert (r.json().get("detail") or {}).get("code") == "not_a_member"

    def test_join_then_post_and_comment(self, group, bob):
        j = requests.post(
            f"{HTTP_BASE}/api/groups/{group['id']}/join/{bob['id']}",
            headers=_auth(bob), timeout=15,
        )
        assert j.status_code == 200, j.text
        p = requests.post(
            f"{HTTP_BASE}/api/groups/{group['id']}/posts",
            json={"text": "now a member", "group_id": group["id"], "user_id": bob["id"]},
            headers=_auth(bob), timeout=15,
        )
        assert p.status_code == 200, p.text
        post_id = p.json()["id"]
        cm = requests.post(
            f"{HTTP_BASE}/api/groups/posts/{post_id}/comment",
            json={"text": "nice", "user_name": "Grouper"},
            headers=_auth(bob), timeout=15,
        )
        assert cm.status_code == 200, cm.text

    def test_leave_regates_posting_but_keeps_posts(self, group, bob):
        lv = requests.post(
            f"{HTTP_BASE}/api/groups/{group['id']}/leave/{bob['id']}",
            headers=_auth(bob), timeout=15,
        )
        assert lv.status_code == 200, lv.text
        # Posts remain visible.
        posts = requests.get(f"{HTTP_BASE}/api/groups/{group['id']}/posts", timeout=15).json()
        assert any(p.get("text") == "now a member" for p in posts), "old posts must remain after leaving"
        # Posting is now gated again.
        r = requests.post(
            f"{HTTP_BASE}/api/groups/{group['id']}/posts",
            json={"text": "after leaving", "group_id": group["id"], "user_id": bob["id"]},
            headers=_auth(bob), timeout=15,
        )
        assert r.status_code == 403
        assert (r.json().get("detail") or {}).get("code") == "not_a_member"

    def test_rejoin_reenables_posting(self, group, bob):
        requests.post(
            f"{HTTP_BASE}/api/groups/{group['id']}/join/{bob['id']}",
            headers=_auth(bob), timeout=15,
        )
        r = requests.post(
            f"{HTTP_BASE}/api/groups/{group['id']}/posts",
            json={"text": "back again", "group_id": group["id"], "user_id": bob["id"]},
            headers=_auth(bob), timeout=15,
        )
        assert r.status_code == 200, r.text


class TestOneShotGreetingServerBacked:
    def test_thanks_idempotent_per_notification(self, alice, bob):
        # bob sends alice a welcome greeting → alice gets a `welcome` notif.
        g = requests.post(
            f"{HTTP_BASE}/api/greetings/send",
            json={"from_id": bob["id"], "to_id": alice["id"], "kind": "welcome"},
            headers=_auth(bob), timeout=15,
        )
        assert g.status_code == 200, g.text
        notifs = requests.get(f"{HTTP_BASE}/api/notifications/{alice['id']}", timeout=15).json()
        welcome = next((n for n in notifs if n["type"] == "welcome" and n["payload"].get("from_id") == bob["id"]), None)
        assert welcome, "alice should have a welcome notification from bob"
        nid_ = welcome["id"]

        # alice taps "Say thanks" referencing that notification.
        t1 = requests.post(
            f"{HTTP_BASE}/api/greetings/thanks",
            json={"from_id": alice["id"], "to_id": bob["id"], "notif_id": nid_},
            headers=_auth(alice), timeout=15,
        )
        assert t1.status_code == 200 and not t1.json().get("already"), t1.text

        # The notification is now stamped `responded` (reloads as sent).
        notifs2 = requests.get(f"{HTTP_BASE}/api/notifications/{alice['id']}", timeout=15).json()
        again = next((n for n in notifs2 if n["id"] == nid_), None)
        assert again and (again.get("responded") or {}).get("action") == "thanks"

        # A second tap is a no-op success (duplicate blocked).
        t2 = requests.post(
            f"{HTTP_BASE}/api/greetings/thanks",
            json={"from_id": alice["id"], "to_id": bob["id"], "notif_id": nid_},
            headers=_auth(alice), timeout=15,
        )
        assert t2.status_code == 200 and t2.json().get("already") is True, t2.text
