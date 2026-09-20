"""iter182 Wave A backend tests.

Covers:
- ITEM 1: Notice moderation for a prolific member (garage/bake sale published
  immediately; yoga studio business promo held for review). Verify listing
  contains the published items.
- ITEM 4: Word Chain invalid-move error message content — backend returns a
  friendly HTTPException(400) whose `detail` MUST NOT contain a numeric
  status code prefix.
"""
import os
import re
import time
import pytest
import requests

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
MEMBER_EMAIL = "member@friendplace.com.au"
MEMBER_PASSWORD = "TestPass2026!"


# ---------- Fixtures ----------

@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def member_token(s):
    r = s.post(f"{BASE}/api/auth/login", json={"username": MEMBER_EMAIL, "password": MEMBER_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    j = r.json()
    return j["access_token"], j["user"]


# ---------- ITEM 1 — Notice moderation ----------

def _create_notice(s, token, uid, title, body):
    r = s.post(
        f"{BASE}/api/notices",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"user_id": uid, "title": title, "body": body, "category": "General"},
        timeout=20,
    )
    return r


def test_garage_sale_publishes_immediately(s, member_token):
    token, user = member_token
    r = _create_notice(s, token, user["id"], "Garage sale Sat", "Bits and pieces, everything $2-$5")
    assert r.status_code in (200, 201), f"unexpected {r.status_code} {r.text[:300]}"
    j = r.json()
    assert j.get("held_for_review") is False, f"expected published, got held: {j}"
    assert j.get("id"), f"missing id: {j}"
    # Verify visible in listing
    lr = s.get(f"{BASE}/api/notices", timeout=15)
    assert lr.status_code == 200
    ids = [n.get("id") for n in (lr.json() or [])]
    assert j["id"] in ids, "garage sale notice missing from public listing"


def test_bake_sale_publishes_immediately(s, member_token):
    token, user = member_token
    r = _create_notice(s, token, user["id"], "Bake sale this weekend", "Home-made cakes and slices, $3-$6 each")
    assert r.status_code in (200, 201), f"{r.status_code} {r.text[:300]}"
    j = r.json()
    assert j.get("held_for_review") is False, f"expected published bake sale, got: {j}"


def test_yoga_business_promo_held(s, member_token):
    token, user = member_token
    r = _create_notice(s, token, user["id"], "Yoga studio classes", "Book now at www.myyoga.com, $20 per person")
    assert r.status_code in (200, 201), f"{r.status_code} {r.text[:300]}"
    j = r.json()
    assert j.get("held_for_review") is True, f"expected held business promo, got: {j}"


# ---------- ITEM 4 — Error messages carry no status code ----------

_STATUS_PREFIX = re.compile(r"^\s*\d{3}\b")


@pytest.fixture(scope="module")
def two_demo_tokens(s):
    a = s.post(f"{BASE}/api/auth/demo-login", json={"username": "maggie"}, timeout=15)
    b = s.post(f"{BASE}/api/auth/demo-login", json={"username": "frankie"}, timeout=15)
    assert a.status_code == 200 and b.status_code == 200, f"demo login failed {a.status_code}/{b.status_code}"
    return a.json(), b.json()


def _find_or_create_word_chain_session(s, tokA, tokB):
    """Try to accept an invite and start a session between maggie & frankie."""
    hA = {"Authorization": f"Bearer {tokA['access_token']}", "Content-Type": "application/json"}
    hB = {"Authorization": f"Bearer {tokB['access_token']}", "Content-Type": "application/json"}
    # A invites B
    inv = s.post(f"{BASE}/api/play/invite", headers=hA,
                 json={"game": "word_chain", "friend_id": tokB["user"]["id"]}, timeout=15)
    if inv.status_code not in (200, 201):
        return None, hA, hB
    sid = inv.json().get("session_id") or inv.json().get("id")
    if not sid:
        return None, hA, hB
    # B accepts
    s.post(f"{BASE}/api/play/{sid}/accept", headers=hB, timeout=15)
    return sid, hA, hB


def test_word_chain_invalid_move_error_has_no_status_prefix(s, two_demo_tokens):
    tokA, tokB = two_demo_tokens
    sid, hA, hB = _find_or_create_word_chain_session(s, tokA, tokB)
    if not sid:
        pytest.skip("could not create word_chain session")
    # Read session to know whose turn it is + last letter
    g = s.get(f"{BASE}/api/play/{sid}", headers=hA, timeout=15)
    if g.status_code != 200:
        pytest.skip(f"cannot read session: {g.status_code}")
    state = g.json()
    turn_user = state.get("turn_user_id") or state.get("current_user_id") or state.get("turn")
    my_h = hA if turn_user == tokA["user"]["id"] else hB
    # Force an invalid word (starts with 'Q' — extremely unlikely to match required starting letter)
    # Try several bad words to guarantee rejection.
    bad_word = "zzzzqqqq"
    r = s.post(f"{BASE}/api/play/{sid}/move", headers=my_h,
               json={"word": bad_word}, timeout=15)
    # Expect a 400. If it happens to succeed, retry with another obviously-bad word.
    if r.status_code == 200:
        r = s.post(f"{BASE}/api/play/{sid}/move", headers=my_h,
                   json={"word": "!!not-a-word!!"}, timeout=15)
    assert r.status_code == 400, f"expected 400 rejection, got {r.status_code} {r.text[:200]}"
    j = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    detail = j.get("detail") if isinstance(j, dict) else str(j)
    assert isinstance(detail, str) and detail, f"missing detail: {j}"
    assert not _STATUS_PREFIX.match(detail), f"detail leads with numeric status code: {detail!r}"
    # No stray '400' anywhere in message
    assert "400" not in detail, f"detail contains raw status '400': {detail!r}"
