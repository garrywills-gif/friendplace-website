"""iter164h — Butterfly Points manual recognition.

Covers:
- Preview and policy endpoints
- Award: writes ledger + credits balance + sends warm notification with
  George/Georgia attribution + writes admin_log
- Reversal: additive (new negative row) + decrements balance + preserves
  original AND badges + writes admin_log
- Validation: amount range, reason length, invalid persona, unknown
  ledger id, double-reversal blocked
- Points list endpoint
"""
from __future__ import annotations

import os
import uuid
from typing import Any

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "http://localhost:8001").rstrip("/")
ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASS = "TestPass2026!"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME   = os.environ.get("DB_NAME",   "test_database")

SEED_MARKER = "iter164h-recognition"


def _login() -> str:
    r = requests.post(
        f"{BASE_URL}/api/cms/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def token():
    return _login()


@pytest.fixture()
def member(request):
    """Insert a fresh, isolated user for each test. Cleaned up after."""
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    uid = f"seed-{uuid.uuid4()}"
    doc = {
        "id": uid,
        "username": f"iter164h-{uuid.uuid4().hex[:6]}",
        "first_name": "Aisha",
        "email": f"aisha-{uuid.uuid4().hex[:6]}@example.com",
        "points": 0,
        "badges": [],
        "seed_marker": SEED_MARKER,
    }
    db.users.insert_one(doc)

    def _teardown():
        db.users.delete_one({"id": uid})
        db.butterfly_points_ledger.delete_many({"user_id": uid})
        db.notifications.delete_many({"user_id": uid})
        client.close()
    request.addfinalizer(_teardown)
    return {"id": uid, "db": db}


def _h(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


# ---------------------------------------------------------------- Policy

def test_policy_returns_constants(token):
    r = requests.get(f"{BASE_URL}/api/cms/members/butterfly-points/policy", headers=_h(token), timeout=10)
    assert r.status_code == 200
    p = r.json()
    assert p["amount_min"] == 1 and p["amount_max"] == 100
    assert p["amount_soft_warn"] == 50
    assert p["reason_min"] == 5 and p["reason_max"] == 300
    assert set(p["personas"]) == {"george", "georgia"}


# ---------------------------------------------------------------- Preview

def test_preview_matches_award_wording(token):
    body = {"amount": 15, "reason": "helping Margaret with her garden", "persona": "george"}
    r = requests.post(f"{BASE_URL}/api/cms/members/butterfly-points/preview", headers=_h(token), json=body, timeout=10)
    assert r.status_code == 200
    msg = r.json()
    assert "George" in msg["title"] and "Butterfly points" in msg["title"]
    assert "15 Butterfly points" in msg["body"]
    assert "helping Margaret with her garden" in msg["body"]
    assert "Thank you for being that kind of person" in msg["body"]


def test_preview_singular_when_amount_is_one(token):
    r = requests.post(
        f"{BASE_URL}/api/cms/members/butterfly-points/preview",
        headers=_h(token),
        json={"amount": 1, "reason": "the small thing you did", "persona": "georgia"},
        timeout=10,
    )
    msg = r.json()
    assert "Butterfly point" in msg["title"] and "points" not in msg["title"].split("Butterfly")[1]
    assert "1 Butterfly point " in msg["body"]


# ---------------------------------------------------------------- Award

def test_award_writes_ledger_credits_balance_sends_notification(token, member):
    uid = member["id"]
    db = member["db"]
    r = requests.post(
        f"{BASE_URL}/api/cms/members/{uid}/butterfly-points/award",
        headers=_h(token),
        json={"amount": 12, "reason": "helped Bill fix his puzzle", "persona": "george"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    row = r.json()
    assert row["kind"] == "award"
    assert row["amount"] == 12
    assert row["persona"] == "george"
    assert row["admin_email"] == ADMIN_EMAIL
    assert row["notification_id"]
    # Running balance credited
    u = db.users.find_one({"id": uid})
    assert u["points"] == 12
    # Warm notification landed
    notes = list(db.notifications.find({"user_id": uid, "type": "recognition"}))
    assert len(notes) == 1
    n = notes[0]
    assert n["payload"]["sender_persona"] == "george"
    assert n["payload"]["ledger_id"] == row["id"]
    assert "12 Butterfly points" in n["body"]
    assert "Thank you for being that kind of person" in n["body"]
    # Admin audit trail
    audit = list(db.admin_log.find({"action": "member.points.award", "target_id": uid}))
    assert len(audit) >= 1
    assert audit[-1]["metadata"]["ledger_id"] == row["id"]


def test_award_georgia_attribution(token, member):
    uid = member["id"]
    r = requests.post(
        f"{BASE_URL}/api/cms/members/{uid}/butterfly-points/award",
        headers=_h(token),
        json={"amount": 7, "reason": "being warm in the Coffee Lounge", "persona": "georgia"},
        timeout=15,
    )
    assert r.status_code == 200
    row = r.json()
    assert row["persona"] == "georgia"
    n = list(member["db"].notifications.find({"user_id": uid}))[0]
    assert "Georgia" in n["title"]
    assert n["payload"]["sender_name"] == "Georgia"


# ---------------------------------------------------------------- Validation

@pytest.mark.parametrize("bad,label", [
    ({"amount": 0, "reason": "aaaaa", "persona": "george"}, "amount too low"),
    ({"amount": 101, "reason": "aaaaa", "persona": "george"}, "amount too high"),
    ({"amount": 10, "reason": "abc",   "persona": "george"}, "reason too short"),
    ({"amount": 10, "reason": "x" * 301, "persona": "george"}, "reason too long"),
    ({"amount": 10, "reason": "abcde", "persona": "gerald"},  "invalid persona"),
])
def test_award_rejects_invalid_input(token, member, bad, label):
    r = requests.post(
        f"{BASE_URL}/api/cms/members/{member['id']}/butterfly-points/award",
        headers=_h(token), json=bad, timeout=10,
    )
    assert r.status_code in (400, 422), f"{label}: got {r.status_code} {r.text}"


def test_award_unknown_member_404(token):
    r = requests.post(
        f"{BASE_URL}/api/cms/members/nonexistent-xyz/butterfly-points/award",
        headers=_h(token),
        json={"amount": 5, "reason": "hello world", "persona": "george"},
        timeout=10,
    )
    assert r.status_code == 404


# ---------------------------------------------------------------- Reversal

def _award(token: str, uid: str, amount: int = 20) -> str:
    r = requests.post(
        f"{BASE_URL}/api/cms/members/{uid}/butterfly-points/award",
        headers=_h(token),
        json={"amount": amount, "reason": "helping a neighbour move furniture", "persona": "george"},
        timeout=15,
    )
    assert r.status_code == 200
    return r.json()["id"]


def test_reversal_is_additive_and_preserves_original(token, member):
    uid = member["id"]
    db = member["db"]
    ledger_id = _award(token, uid, amount=25)
    assert db.users.find_one({"id": uid})["points"] == 25

    r = requests.post(
        f"{BASE_URL}/api/cms/members/{uid}/butterfly-points/{ledger_id}/reverse",
        headers=_h(token),
        json={"reason": "logged against the wrong member"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    out = r.json()
    original = out["original"]
    reversal = out["reversal"]

    assert original["id"] == ledger_id
    assert original["amount"] == 25, "original amount must NOT mutate"
    assert original["reversed_at"] is not None
    assert original["reversed_by_ledger_id"] == reversal["id"]

    assert reversal["kind"] == "reversal"
    assert reversal["amount"] == -25
    assert reversal["reverses_id"] == ledger_id

    # Balance back to zero
    assert db.users.find_one({"id": uid})["points"] == 0
    # admin_log records BOTH events
    actions = [e["action"] for e in db.admin_log.find({"target_id": uid})]
    assert "member.points.award" in actions
    assert "member.points.reverse" in actions


def test_reversal_does_not_revoke_badges(token, member):
    uid = member["id"]
    db = member["db"]
    # Award 30 → crosses "Helpful Neighbour" threshold.
    ledger_id = _award(token, uid, amount=30)
    u = db.users.find_one({"id": uid})
    assert "Helpful Neighbour" in u["badges"]
    assert "Friendly Member" in u["badges"]
    # Reverse — balance drops to 0 but badges stay by design.
    r = requests.post(
        f"{BASE_URL}/api/cms/members/{uid}/butterfly-points/{ledger_id}/reverse",
        headers=_h(token),
        json={"reason": "unfortunately awarded twice for the same act"},
        timeout=15,
    )
    assert r.status_code == 200
    u2 = db.users.find_one({"id": uid})
    assert u2["points"] == 0
    assert "Helpful Neighbour" in u2["badges"], "badges must NOT be revoked on reversal"
    assert "Friendly Member" in u2["badges"]


def test_double_reversal_blocked(token, member):
    uid = member["id"]
    ledger_id = _award(token, uid)
    r1 = requests.post(
        f"{BASE_URL}/api/cms/members/{uid}/butterfly-points/{ledger_id}/reverse",
        headers=_h(token),
        json={"reason": "first reversal"},
        timeout=15,
    )
    assert r1.status_code == 200
    r2 = requests.post(
        f"{BASE_URL}/api/cms/members/{uid}/butterfly-points/{ledger_id}/reverse",
        headers=_h(token),
        json={"reason": "trying to reverse again"},
        timeout=15,
    )
    assert r2.status_code == 400, r2.text


def test_reversal_unknown_ledger_404(token, member):
    r = requests.post(
        f"{BASE_URL}/api/cms/members/{member['id']}/butterfly-points/{uuid.uuid4()}/reverse",
        headers=_h(token),
        json={"reason": "trying to reverse a phantom row"},
        timeout=10,
    )
    assert r.status_code == 404


def test_reversal_wrong_member_400(token, member):
    """Reversal URL's user_id must match the ledger row's user_id."""
    uid = member["id"]
    ledger_id = _award(token, uid)
    r = requests.post(
        f"{BASE_URL}/api/cms/members/some-other-user-id/butterfly-points/{ledger_id}/reverse",
        headers=_h(token),
        json={"reason": "trying to reverse under wrong id"},
        timeout=10,
    )
    # Either 404 (member missing) or 400 (mismatch) — the point is: rejected.
    assert r.status_code in (400, 404)


# ---------------------------------------------------------------- List

def test_list_returns_ledger_and_current_balance(token, member):
    uid = member["id"]
    _award(token, uid, amount=10)
    _award(token, uid, amount=5)
    r = requests.get(
        f"{BASE_URL}/api/cms/members/{uid}/butterfly-points",
        headers=_h(token), timeout=10,
    )
    assert r.status_code == 200
    data = r.json()
    assert data["user_id"] == uid
    assert data["points"] == 15
    assert len(data["ledger"]) == 2
    # newest first
    assert data["ledger"][0]["created_at"] >= data["ledger"][1]["created_at"]
