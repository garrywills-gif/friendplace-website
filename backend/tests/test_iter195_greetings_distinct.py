"""iter195 — Welcome/Birthday greetings are their OWN action types (NOT Flutters).

Verifies:
 - POST /api/greetings/send kind=welcome  → creates a notification of type 'welcome'
   with title '👋 <name> welcomed you to FriendPlace' AND does NOT create a Flutter.
 - POST /api/greetings/send kind=birthday → creates a notification of type 'birthday_wish'
   with title '🎂 <name> sent you birthday wishes' AND does NOT create a Flutter.
 - POST /api/greetings/thanks → creates a notification of type 'greeting_thanks'.
 - The Notifications payload carries `payload.from_id` (needed by the greeting action row).
"""
import os
import pytest
import requests
from pathlib import Path


def _load_backend_url() -> str:
    env = Path("/app/frontend/.env")
    for line in env.read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    raise RuntimeError("EXPO_PUBLIC_BACKEND_URL missing from /app/frontend/.env")


BASE_URL = _load_backend_url()


@pytest.fixture(scope="module")
def sess():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _demo_login(sess, username):
    r = sess.post(f"{BASE_URL}/api/auth/demo-login", json={"username": username}, timeout=15)
    assert r.status_code == 200, f"demo-login {username} → {r.status_code} {r.text[:200]}"
    j = r.json()
    return j["access_token"], j["user"]


def _flutter_count(sess, uid, token):
    r = sess.get(f"{BASE_URL}/api/flutters/{uid}", headers={"Authorization": f"Bearer {token}"}, timeout=15)
    if r.status_code != 200:
        return None
    return len(r.json() or [])


def _clear_greeting(sess, recipient_id, kind_type, sender_id, token):
    """Mark any prior unread greeting of this kind from sender as read (to bypass 409 dedupe)."""
    r = sess.get(f"{BASE_URL}/api/notifications/{recipient_id}", headers={"Authorization": f"Bearer {token}"}, timeout=15)
    if r.status_code != 200:
        return
    for n in r.json() or []:
        if n.get("type") == kind_type and (n.get("payload") or {}).get("from_id") == sender_id and not n.get("read"):
            try:
                sess.post(f"{BASE_URL}/api/notifications/{n['id']}/read", timeout=10)
            except Exception:
                pass


def test_welcome_greeting_creates_welcome_notification(sess):
    _, alex = _demo_login(sess, "maggie")  # sender
    tok_r, mag = _demo_login(sess, "frankie")  # recipient
    # Actually use maggie as sender, frankie as recipient
    sender_id = alex["id"]
    recipient_id = mag["id"]
    _clear_greeting(sess, recipient_id, "welcome", sender_id, tok_r)

    flutters_before = _flutter_count(sess, recipient_id, tok_r)

    r = sess.post(f"{BASE_URL}/api/greetings/send", json={"from_id": sender_id, "to_id": recipient_id, "kind": "welcome"}, timeout=15)
    assert r.status_code == 200, f"welcome send → {r.status_code} {r.text[:200]}"
    assert r.json().get("type") == "welcome"

    r = sess.get(f"{BASE_URL}/api/notifications/{recipient_id}", headers={"Authorization": f"Bearer {tok_r}"}, timeout=15)
    assert r.status_code == 200
    notifs = r.json() or []
    matches = [n for n in notifs if n.get("type") == "welcome" and (n.get("payload") or {}).get("from_id") == sender_id]
    assert matches, f"No welcome notification landed for recipient. Got types: {[n.get('type') for n in notifs[:10]]}"
    top = matches[0]
    assert "welcomed you to FriendPlace" in (top.get("title") or ""), f"unexpected title: {top.get('title')}"
    assert (top.get("payload") or {}).get("from_id") == sender_id, "payload.from_id missing — greeting action row won't work"

    # Flutter count must NOT increase.
    flutters_after = _flutter_count(sess, recipient_id, tok_r)
    if flutters_before is not None and flutters_after is not None:
        assert flutters_after == flutters_before, f"Welcome greeting leaked into Flutters ({flutters_before} → {flutters_after})"


def test_birthday_greeting_creates_birthday_wish_notification(sess):
    _, alex = _demo_login(sess, "maggie")
    tok_r, joyce = _demo_login(sess, "joycey")
    sender_id = alex["id"]
    recipient_id = joyce["id"]
    _clear_greeting(sess, recipient_id, "birthday_wish", sender_id, tok_r)

    flutters_before = _flutter_count(sess, recipient_id, tok_r)

    r = sess.post(f"{BASE_URL}/api/greetings/send", json={"from_id": sender_id, "to_id": recipient_id, "kind": "birthday"}, timeout=15)
    assert r.status_code == 200, f"birthday send → {r.status_code} {r.text[:200]}"
    assert r.json().get("type") == "birthday_wish"

    r = sess.get(f"{BASE_URL}/api/notifications/{recipient_id}", headers={"Authorization": f"Bearer {tok_r}"}, timeout=15)
    assert r.status_code == 200
    notifs = r.json() or []
    matches = [n for n in notifs if n.get("type") == "birthday_wish" and (n.get("payload") or {}).get("from_id") == sender_id]
    assert matches, f"No birthday_wish notification landed. Got types: {[n.get('type') for n in notifs[:10]]}"
    top = matches[0]
    assert "sent you birthday wishes" in (top.get("title") or ""), f"unexpected title: {top.get('title')}"

    flutters_after = _flutter_count(sess, recipient_id, tok_r)
    if flutters_before is not None and flutters_after is not None:
        assert flutters_after == flutters_before, f"Birthday greeting leaked into Flutters ({flutters_before} → {flutters_after})"


def test_greeting_thanks_creates_greeting_thanks_notification(sess):
    _, mag = _demo_login(sess, "maggie")     # sender of thanks
    tok_r, frank = _demo_login(sess, "frankie")  # recipient of thanks
    sender_id = mag["id"]
    recipient_id = frank["id"]

    r = sess.post(f"{BASE_URL}/api/greetings/thanks", json={"from_id": sender_id, "to_id": recipient_id}, timeout=15)
    assert r.status_code == 200, f"thanks → {r.status_code} {r.text[:200]}"

    r = sess.get(f"{BASE_URL}/api/notifications/{recipient_id}", headers={"Authorization": f"Bearer {tok_r}"}, timeout=15)
    assert r.status_code == 200
    notifs = r.json() or []
    matches = [n for n in notifs if n.get("type") == "greeting_thanks" and (n.get("payload") or {}).get("from_id") == sender_id]
    assert matches, f"No greeting_thanks landed. Got types: {[n.get('type') for n in notifs[:10]]}"
    assert "said thanks" in (matches[0].get("title") or ""), f"unexpected title: {matches[0].get('title')}"


def test_greeting_dedupe_returns_409(sess):
    _, mag = _demo_login(sess, "maggie")
    tok_r, dot = _demo_login(sess, "dot")
    _clear_greeting(sess, dot["id"], "welcome", mag["id"], tok_r)

    r1 = sess.post(f"{BASE_URL}/api/greetings/send", json={"from_id": mag["id"], "to_id": dot["id"], "kind": "welcome"}, timeout=15)
    assert r1.status_code == 200, f"first welcome → {r1.status_code}"
    r2 = sess.post(f"{BASE_URL}/api/greetings/send", json={"from_id": mag["id"], "to_id": dot["id"], "kind": "welcome"}, timeout=15)
    # Dedupe: expected 409 while first is unread
    assert r2.status_code == 409, f"expected 409 dedupe, got {r2.status_code} {r2.text[:200]}"
