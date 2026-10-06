"""iter247 — companion intent regression (info vs where vs explicit nav vs offer accept).

Runs against the live backend via EXPO_PUBLIC_BACKEND_URL. Each scenario
starts from a reset chat so offers never leak between cases.
"""
import os
import re

import pytest
import requests

BASE = None
for line in open("/app/frontend/.env"):
    if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
        BASE = line.split("=", 1)[1].strip().strip('"')
API = f"{BASE}/api"
PROMISE = re.compile(r"\b(taking you|i'?ll take you|opening (it|that|the)|let me take)\b", re.I)


@pytest.fixture(scope="module")
def H():
    r = requests.post(f"{API}/auth/demo-login", json={"username": "frankie"}, timeout=30)
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def reset(H):
    requests.post(f"{API}/mcgs/george/companion/reset", json={"persona": "george"}, headers=H, timeout=30)


def turn(H, text):
    r = requests.post(f"{API}/mcgs/george/companion/turn", json={"text": text, "persona": "george"}, headers=H, timeout=90)
    assert r.status_code == 200, r.text
    d = r.json()
    print(f"\n  ME: {text}\n  GEORGE: {d['message']}\n  ACTION: {d.get('navigate_to')}")
    return d


def assert_no_nav(d):
    assert not d.get("navigate_to"), d
    assert not PROMISE.search(d["message"]), f"wording promises navigation: {d['message']}"


def assert_nav(d, key):
    assert d.get("navigate_to") and d["navigate_to"]["key"] == key, d


# 1. Exact screenshot exchange
def test_screenshot_exchange(H):
    reset(H)
    d = turn(H, "Can u tell me about the notice board")
    assert_no_nav(d)
    assert "notice" in d["message"].lower()
    assert "would you like me to take you there" in d["message"].lower()


# 2. Information requests across destinations
@pytest.mark.parametrize("q,word", [
    ("Tell me about the Notice Board", "notice"),
    ("What is the FP Cafe?", "caf"),
    ("How does Find Friends work?", "friend"),
    ("What are events?", "event"),
    ("Tell me about games", "game"),
    ("What can I do in Moments?", "moment"),
    ("How do groups work?", "group"),
])
def test_info_requests_never_navigate(H, q, word):
    reset(H)
    d = turn(H, q)
    assert_no_nav(d)
    assert word in d["message"].lower()
    assert d["message"].lower().endswith("would you like me to take you there?")


# 3. Location / instructions
@pytest.mark.parametrize("q", ["Where is the Notice Board?", "How do I get to Events?"])
def test_where_requests_never_navigate(H, q):
    reset(H)
    d = turn(H, q)
    assert_no_nav(d)
    assert "would you like me to take you there" in d["message"].lower()


# 4. Explicit navigation
@pytest.mark.parametrize("q,key", [
    ("Take me to the Notice Board", "notices"),
    ("Open Events", "events"),
    ("Go to Find Friends", "friends"),
    ("Take me to games", "games"),
])
def test_explicit_navigation(H, q, key):
    reset(H)
    assert_nav(turn(H, q), key)


# 5. Accepting an offer (after info and after where)
@pytest.mark.parametrize("q,yes,key", [
    ("Can u tell me about the notice board", "Ok", "notices"),
    ("What is the FP Cafe?", "Yes please", "lounge"),
    ("How do I get to Events?", "Sure", "events"),
])
def test_accept_offer(H, q, yes, key):
    reset(H)
    assert_no_nav(turn(H, q))
    assert_nav(turn(H, yes), key)


def test_ok_without_offer_does_not_navigate(H):
    reset(H)
    assert_no_nav(turn(H, "Ok"))
    assert_no_nav(turn(H, "Yes please"))


def test_offer_used_once(H):
    reset(H)
    turn(H, "Where is the Notice Board?")
    assert_nav(turn(H, "Ok"), "notices")
    d = turn(H, "Ok")
    assert_no_nav(d)
    assert "can't" not in d["message"].lower() or "open" not in d["message"].lower()


# 6. Declining
@pytest.mark.parametrize("no", ["No thanks", "Not yet", "Ok but not now"])
def test_decline_clears_offer(H, no):
    reset(H)
    turn(H, "Where is the Notice Board?")
    assert_no_nav(turn(H, no))
    assert_no_nav(turn(H, "Ok"))  # offer must be gone


# 7. Changing the subject after an offer
def test_new_question_after_offer(H):
    reset(H)
    turn(H, "Where are the events?")
    d = turn(H, "Tell me about the Notice Board")
    assert_no_nav(d)
    assert "notice" in d["message"].lower()
    # The accept now applies to the NEW offer (Notice Board), not Events.
    assert_nav(turn(H, "Ok"), "notices")


def test_plain_chat_after_offer_clears(H):
    reset(H)
    turn(H, "Where is the FP Cafe?")
    assert_no_nav(turn(H, "I had a lovely walk this morning"))
    assert_no_nav(turn(H, "Ok"))


# 8. Onboarding (induction) chat uses the same intent rules
def _onb(H):
    r = requests.post(f"{API}/mcgs/george/onboarding/start", json={"persona": "george"}, headers=H, timeout=60)
    assert r.status_code == 200, r.text
    return r.json()["session_id"]


def _onb_turn(H, sid, text):
    r = requests.post(f"{API}/mcgs/george/onboarding/session/{sid}/turn", json={"text": text}, headers=H, timeout=90)
    assert r.status_code == 200, r.text
    d = r.json()
    msg = (d.get("turns") or [{}])[-1].get("content", "")
    print(f"\n  [onboarding] ME: {text}\n  GEORGE: {msg}\n  ACTION: {d.get('navigate_to')}")
    return d, msg


@pytest.mark.parametrize("q", ["Can u tell me about the notice board", "What is the FP Cafe?", "Where is the Notice Board?"])
def test_onboarding_info_never_navigates(H, q):
    sid = _onb(H)
    d, msg = _onb_turn(H, sid, q)
    assert not d.get("navigate_to")
    assert not PROMISE.search(msg), msg


def test_onboarding_explicit_navigates(H):
    sid = _onb(H)
    d, _ = _onb_turn(H, sid, "Take me to the Notice Board")
    assert d.get("navigate_to") == "notices", d.get("navigate_to")


def test_onboarding_accept_and_decline(H):
    sid = _onb(H)
    _onb_turn(H, sid, "Where is the Notice Board?")
    d, _ = _onb_turn(H, sid, "Ok")
    assert d.get("navigate_to") == "notices"
    sid2 = _onb(H)
    _onb_turn(H, sid2, "What is the FP Cafe?")
    d, msg = _onb_turn(H, sid2, "No thanks")
    assert not d.get("navigate_to") and not PROMISE.search(msg)
