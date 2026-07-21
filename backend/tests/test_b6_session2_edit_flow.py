"""B6 Session 2 — Conversational Event Editing tests.

Tests George's ability to detect edit intents, apply low-risk edits
immediately, ask for confirmation on high-risk edits, honor undo,
preserve pending edits on ambiguous replies, and not interfere with
normal event creation or companion chat.

Runs against the public preview backend using EXPO_PUBLIC_BACKEND_URL.
The account is Alex (member@friendplace.com.au) who already hosts a
seeded "Coffee Catch-Up" event.
"""
from __future__ import annotations

import os
import sys
import time
import uuid
import asyncio
import pytest
import requests
from typing import Optional

# Load backend .env so MONGO_URL is available for direct DB checks.
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL") or "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL missing from frontend/.env"

EMAIL = "member@friendplace.com.au"
PASSWORD = "TestPass2026!"
EVENT_TITLE = "Coffee Catch-Up"

TURN_TIMEOUT = 45  # per turn (Haiku + optional Sonnet)


# ------------------------------------------------------------------
# Fixtures
# ------------------------------------------------------------------

@pytest.fixture(scope="module")
def auth():
    """Log in Alex and return (token, user_id)."""
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": EMAIL, "password": PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    body = r.json()
    tok = body["access_token"]
    uid = body["user"]["id"]
    return tok, uid


@pytest.fixture(scope="module")
def headers(auth):
    return {"Authorization": f"Bearer {auth[0]}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def db():
    """Async Motor DB — used for direct Mongo assertions."""
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    return client[os.environ["DB_NAME"]]


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _mongo_event(db, event_id: str) -> dict:
    return _run(db.events.find_one({"id": event_id}, {"_id": 0})) or {}


def _mongo_session(db, sid: str) -> dict:
    return _run(db.george_event_conversations.find_one({"session_id": sid}, {"_id": 0})) or {}


def _latest_edit(db, event_id: str) -> Optional[dict]:
    docs = _run(db.event_edits.find({"event_id": event_id}, {"_id": 0}).sort("created_at", -1).to_list(1))
    return docs[0] if docs else None


def _find_event_id(db, host_id: str, title: str) -> str:
    doc = _run(db.events.find_one({"host_id": host_id, "title": title}, {"_id": 0}))
    assert doc, f"seeded event '{title}' not found"
    return doc["id"]


# ------------------------------------------------------------------
# Conversation helpers
# ------------------------------------------------------------------

def _start_session(headers, seed_text="hello") -> str:
    r = requests.post(
        f"{BASE_URL}/api/mcgs/george/event/start",
        json={"text": seed_text},
        headers=headers,
        timeout=TURN_TIMEOUT,
    )
    assert r.status_code == 200, f"start failed: {r.status_code} {r.text[:200]}"
    return r.json()["session_id"]


def _turn(headers, sid: str, text: str) -> dict:
    r = requests.post(
        f"{BASE_URL}/api/mcgs/george/event/session/{sid}/turn",
        json={"text": text},
        headers=headers,
        timeout=TURN_TIMEOUT,
    )
    assert r.status_code == 200, f"turn failed: {r.status_code} {r.text[:300]}"
    return r.json()


def _last_george_turn(session: dict) -> dict:
    turns = session.get("turns") or []
    for t in reversed(turns):
        if t.get("role") == "george":
            return t
    raise AssertionError("no George turn found in session")


# ------------------------------------------------------------------
# Module state — the seven-scenario conversation runs sequentially.
# ------------------------------------------------------------------

STATE: dict = {}


@pytest.fixture(scope="module", autouse=True)
def _init_conversation(auth, headers, db):
    """Prepare state: find event, seed session, capture original values."""
    _tok, uid = auth
    event_id = _find_event_id(db, uid, EVENT_TITLE)
    ev = _mongo_event(db, event_id)
    STATE["event_id"] = event_id
    STATE["original"] = {
        "description": ev.get("description"),
        "time": ev.get("time"),
        "date": ev.get("date"),
        "location": ev.get("location"),
        "cancelled": bool(ev.get("cancelled")),
    }
    STATE["sid"] = _start_session(headers, "hello George")
    yield


# ------------------------------------------------------------------
# Scenario 1 — LOW-RISK edit applies immediately
# ------------------------------------------------------------------

def test_1_low_risk_description_applied_immediately(headers, db):
    sid = STATE["sid"]
    event_id = STATE["event_id"]
    session = _turn(
        headers, sid,
        "please update the description of my Coffee Catch-Up to mention that parking is limited near the venue",
    )
    tt = _last_george_turn(session)
    edit = tt.get("edit") or {}
    assert edit.get("kind") == "edit_applied", f"expected edit_applied, got {edit}"
    assert edit.get("action") == "update"
    assert (edit.get("applied") or {}).get("description"), f"no applied.description: {edit}"
    assert (tt.get("content") or "").lower().startswith("done"), f"content: {tt.get('content')!r}"

    # DB verification — description was updated
    ev = _mongo_event(db, event_id)
    assert "parking" in (ev.get("description") or "").lower()
    STATE["desc_after_1"] = ev.get("description")


# ------------------------------------------------------------------
# Scenario 2 — HIGH-RISK time change requires confirmation
# ------------------------------------------------------------------

def test_2_high_risk_time_awaits_confirmation(headers, db):
    sid = STATE["sid"]
    event_id = STATE["event_id"]
    time_before = _mongo_event(db, event_id).get("time")
    STATE["time_before_confirm"] = time_before

    session = _turn(headers, sid, "actually let's move the Coffee Catch-Up to 3pm instead")
    tt = _last_george_turn(session)
    edit = tt.get("edit") or {}
    assert edit.get("kind") == "edit_awaiting_confirm", f"expected awaiting_confirm, got {edit}"
    assert (edit.get("pending_changes") or {}).get("time") == "15:00", f"pending_changes: {edit.get('pending_changes')}"
    assert "confirm" in (tt.get("content") or "").lower(), f"content: {tt.get('content')!r}"

    # Session state persisted
    stored = _mongo_session(db, sid)
    flow = stored.get("edit_flow") or {}
    assert flow.get("step") == "awaiting_confirm"
    assert (flow.get("pending_changes") or {}).get("time") == "15:00"

    # Event time NOT changed yet
    assert _mongo_event(db, event_id).get("time") == time_before


# ------------------------------------------------------------------
# Scenario 3 — "yes please" applies the pending change
# ------------------------------------------------------------------

def test_3_confirmation_applies_change(headers, db):
    sid = STATE["sid"]
    event_id = STATE["event_id"]
    session = _turn(headers, sid, "yes please")
    tt = _last_george_turn(session)
    edit = tt.get("edit") or {}
    assert edit.get("kind") == "edit_applied", f"expected edit_applied, got {edit}"

    ev = _mongo_event(db, event_id)
    assert ev.get("time") == "15:00", f"time should now be 15:00, got {ev.get('time')}"

    latest = _latest_edit(db, event_id)
    assert latest, "no event_edits row"
    assert latest.get("action") == "update"
    assert latest.get("severity") == "significant"
    STATE["update_edit_id"] = latest.get("id")

    stored = _mongo_session(db, sid)
    step = ((stored.get("edit_flow") or {}).get("step")) or ""
    assert step in ("", "idle", None), f"edit_flow.step should be reset, got {step!r}"


# ------------------------------------------------------------------
# Scenario 4 — HIGH-RISK denial preserves original
# ------------------------------------------------------------------

def test_4_high_risk_date_denied_preserves_original(headers, db):
    sid = STATE["sid"]
    event_id = STATE["event_id"]
    date_before = _mongo_event(db, event_id).get("date")

    session = _turn(headers, sid, "change the date of Coffee Catch-Up to next Monday")
    tt = _last_george_turn(session)
    edit = tt.get("edit") or {}
    assert edit.get("kind") == "edit_awaiting_confirm", f"expected awaiting_confirm, got {edit}"
    proposed_date = (edit.get("pending_changes") or {}).get("date")
    assert proposed_date, f"expected a proposed date, got {edit.get('pending_changes')}"

    session = _turn(headers, sid, "no, keep it as is")
    tt = _last_george_turn(session)
    edit = tt.get("edit") or {}
    assert edit.get("kind") == "edit_declined", f"expected edit_declined, got {edit}"

    assert _mongo_event(db, event_id).get("date") == date_before


# ------------------------------------------------------------------
# Scenario 5 — Cancel requires confirmation, decline works
# ------------------------------------------------------------------

def test_5_cancel_declined_keeps_event_active(headers, db):
    sid = STATE["sid"]
    event_id = STATE["event_id"]

    session = _turn(headers, sid, "cancel the Coffee Catch-Up event")
    tt = _last_george_turn(session)
    edit = tt.get("edit") or {}
    assert edit.get("kind") == "edit_awaiting_confirm", f"expected awaiting_confirm, got {edit}"
    assert edit.get("action") == "cancel"

    session = _turn(headers, sid, "no, actually don't")
    tt = _last_george_turn(session)
    edit = tt.get("edit") or {}
    assert edit.get("kind") == "edit_declined", f"expected edit_declined, got {edit}"

    ev = _mongo_event(db, event_id)
    assert not bool(ev.get("cancelled")), f"event cancelled unexpectedly: {ev.get('cancelled')}"


# ------------------------------------------------------------------
# Scenario 6 — Undo reverts last change
# ------------------------------------------------------------------

def test_6_undo_reverts_last_change(headers, db):
    sid = STATE["sid"]
    event_id = STATE["event_id"]

    # The last APPLIED change was the time=15:00 update (scenario 3).
    time_before_undo = _mongo_event(db, event_id).get("time")
    assert time_before_undo == "15:00", f"pre-undo time expected 15:00, got {time_before_undo}"

    session = _turn(headers, sid, "undo the last change please")
    tt = _last_george_turn(session)
    edit = tt.get("edit") or {}
    assert edit.get("kind") == "edit_applied", f"expected edit_applied, got {edit}"
    assert edit.get("action") == "undo"

    ev = _mongo_event(db, event_id)
    assert ev.get("time") == STATE["time_before_confirm"], (
        f"time should revert to {STATE['time_before_confirm']}, got {ev.get('time')}"
    )

    latest = _latest_edit(db, event_id)
    assert latest and latest.get("action") == "undo", f"latest audit: {latest}"
    assert latest.get("reverses_edit_id") == STATE.get("update_edit_id"), (
        f"reverses_edit_id: {latest.get('reverses_edit_id')} expected {STATE.get('update_edit_id')}"
    )


# ------------------------------------------------------------------
# Scenario 7 — Ambiguous confirm preserves pending edit; yes then applies
# ------------------------------------------------------------------

def test_7_ambiguous_confirm_preserves_and_then_applies(headers, db):
    sid = STATE["sid"]
    event_id = STATE["event_id"]

    # Fresh high-risk edit
    session = _turn(headers, sid, "move Coffee Catch-Up to 4pm")
    tt = _last_george_turn(session)
    edit = tt.get("edit") or {}
    assert edit.get("kind") == "edit_awaiting_confirm", f"expected awaiting_confirm, got {edit}"
    assert (edit.get("pending_changes") or {}).get("time") == "16:00"

    # Ambiguous reply
    _turn(headers, sid, "hmm not sure")

    stored = _mongo_session(db, sid)
    flow = stored.get("edit_flow") or {}
    assert flow.get("step") == "awaiting_confirm", f"flow.step should be preserved, got {flow.get('step')}"
    assert (flow.get("pending_changes") or {}).get("time") == "16:00", (
        f"pending_changes lost: {flow.get('pending_changes')}"
    )

    # Now confirm
    session = _turn(headers, sid, "yes please")
    tt = _last_george_turn(session)
    edit = tt.get("edit") or {}
    assert edit.get("kind") == "edit_applied", f"expected edit_applied, got {edit}"

    ev = _mongo_event(db, event_id)
    assert ev.get("time") == "16:00", f"time should be 16:00, got {ev.get('time')}"


# ------------------------------------------------------------------
# Scenario 8 — Normal event creation still works (fresh session)
# ------------------------------------------------------------------

def test_8_regression_normal_event_creation(headers):
    sid = _start_session(headers, "hello")
    session = _turn(headers, sid, "I'd like to organise a bingo night on Friday at 6pm")
    tt = _last_george_turn(session)
    edit = tt.get("edit")
    assert not edit, f"normal creation should not carry edit metadata, got {edit}"
    # composer typically progresses the session toward in_progress/drafted
    assert session.get("status") in {"in_progress", "drafted", "ready"}, (
        f"unexpected status: {session.get('status')}"
    )


# ------------------------------------------------------------------
# Scenario 9 — Companion chat unaffected (fresh session)
# ------------------------------------------------------------------

def test_9_regression_companion_chat(headers):
    sid = _start_session(headers, "hello")
    session = _turn(headers, sid, "hello George, where are the games?")
    tt = _last_george_turn(session)
    edit = tt.get("edit")
    assert not edit, f"companion chat should not carry edit metadata, got {edit}"
    content = (tt.get("content") or "").lower()
    # We don't over-assert the copy; just make sure something came back
    assert content, "empty George response"
