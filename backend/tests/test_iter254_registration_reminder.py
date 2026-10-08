"""iter254 — Registration-reminder service tests (Vik's missing FMN).

Verifies the guarantees documented in services/registration_reminder.py:

Phase 1 insert (via /api/public/register-interest):
  - Fresh row stamps `reminder_eligible: True` and `status: pending_confirmation`.

Background loop (services.registration_reminder):
  - Pre-existing pending rows (no `reminder_eligible` field OR False) are
    NEVER retro-emailed. This is Garry's absolute rule for Vik's cohort.
  - Rows younger than 24h are not nudged.
  - Rows with `founder_number` set are not nudged.
  - Rows already confirmed (status != pending_confirmation) are not nudged.
  - Suppressed emails are skipped and stamped `reminder_skipped_at` /
    `reminder_skip_reason: 'suppressed'`.
  - Successful send stamps `reminder_sent_at` + `reminder_message_id` and
    pushes a `history[]` entry. Second pass is a no-op (idempotent).
  - Failed send stamps `reminder_failed_at` + reason, no retry.

Each async block opens a fresh Motor client so Motor's executor binds to
the current `asyncio.run(...)` loop (avoids `Event loop is closed`).
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import requests

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from services import registration_reminder as rr  # noqa: E402

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://friendplace-stable.preview.emergentagent.com",
).rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


def _db():
    """Return a Motor db bound to the CURRENTLY running event loop."""
    return AsyncIOMotorClient(MONGO_URL)[DB_NAME]


@pytest.fixture
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(autouse=True)
def _clean_fixtures_before_each_test():
    """Delete all iter254 fixture rows BEFORE each test so a prior test's
    rows can't leak into the current test's `_once` batch."""
    async def _wipe():
        db = _db()
        try:
            await db.interest_registrations.delete_many({"iter254_fixture": True})
        except Exception:
            pass
    try:
        asyncio.run(_wipe())
    except Exception:
        pass
    yield


def _unique_email(label: str) -> str:
    return f"TEST_iter254_{label}_{uuid.uuid4().hex[:8]}@friendplace.test"


def _hours_ago(h: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=h)).isoformat()


async def _insert(db, **overrides) -> dict:
    doc = {
        "id": str(uuid.uuid4()),
        "founder_number": None,
        "founder_number_locked": False,
        "is_reserved": False,
        "first_name": "Vik",
        "email": _unique_email("row"),
        "state_country": "VIC, Australia",
        "heard_from": "friend",
        "companion_choice": "george",
        "status": "pending_confirmation",
        "source": "website",
        "is_test": False,  # service filters is_test!=True
        "created_at": _hours_ago(30),
        "merged_into": None,
        "iter254_fixture": True,
    }
    doc.update(overrides)
    await db.interest_registrations.insert_one(dict(doc))
    return doc


# --------------------------------------------------------------------------- #
# Module teardown — reap all iter254 fixture rows (and any phase-1 row
# we created via the live endpoint that we tagged).
# --------------------------------------------------------------------------- #
def pytest_sessionfinish(session, exitstatus):  # noqa: D401
    async def _reap():
        db = _db()
        try:
            await db.interest_registrations.delete_many({"iter254_fixture": True})
        except Exception:
            pass
    try:
        asyncio.run(_reap())
    except Exception:
        pass


# --------------------------------------------------------------------------- #
# Patch helpers
# --------------------------------------------------------------------------- #
class _OkResult:
    ok = True
    message_id = "msg_test_iter254"
    error = None


class _FailResult:
    ok = False
    message_id = None
    error = "simulated transport failure"


@pytest.fixture
def patch_send_ok(monkeypatch):
    async def _fake(**kwargs):
        _fake.calls.append(kwargs)
        return _OkResult()
    _fake.calls = []
    import email_service
    monkeypatch.setattr(email_service, "send_email_detailed", _fake)
    return _fake


@pytest.fixture
def patch_send_fail(monkeypatch):
    async def _fake(**kwargs):
        _fake.calls.append(kwargs)
        return _FailResult()
    _fake.calls = []
    import email_service
    monkeypatch.setattr(email_service, "send_email_detailed", _fake)
    return _fake


@pytest.fixture
def patch_suppressed(monkeypatch):
    async def _is_sup(_db, _email):
        return True
    from services import suppression as _sup
    monkeypatch.setattr(_sup, "is_suppressed", _is_sup)


# --------------------------------------------------------------------------- #
# Phase 1 insert — new rows must stamp reminder_eligible=True
# --------------------------------------------------------------------------- #
class TestPhase1Insert:
    def test_phase1_insert_stamps_reminder_eligible(self, http):
        payload = {
            "first_name": "Vik",
            "email": _unique_email("phase1"),
            "state_country": "VIC, Australia",
            "heard_from": "friend",
            "companion_choice": "george",
        }
        r = http.post(f"{BASE_URL}/api/public/register-interest", json=payload, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("confirmed") is False
        reg_id = body.get("id")
        assert reg_id

        async def _check():
            db = _db()
            row = await db.interest_registrations.find_one({"id": reg_id})
            if row:
                await db.interest_registrations.update_one(
                    {"id": reg_id}, {"$set": {"iter254_fixture": True}}
                )
            return row

        row = asyncio.run(_check())
        assert row is not None, "Phase 1 row not persisted"
        assert row.get("reminder_eligible") is True, (
            "New Phase-1 insert MUST stamp reminder_eligible=True (Vik regression guard)"
        )
        assert row.get("status") == "pending_confirmation"
        assert not row.get("founder_number")


# --------------------------------------------------------------------------- #
# Eligibility guards — these rows must NEVER be nudged
# --------------------------------------------------------------------------- #
class TestEligibilityGuards:
    def test_pre_existing_pending_row_without_flag_is_ignored(self, patch_send_ok):
        """Vik's cohort: legacy pending rows (no `reminder_eligible` field)
        are left strictly alone even if 24h+ old."""
        async def _run():
            db = _db()
            doc = await _insert(db)  # NO reminder_eligible field at all
            await rr._once(db)
            return await db.interest_registrations.find_one({"id": doc["id"]})
        fresh = asyncio.run(_run())
        assert fresh is not None
        assert "reminder_sent_at" not in fresh, "Legacy pending row was retro-emailed — Vik regression!"
        assert len(patch_send_ok.calls) == 0

    def test_reminder_eligible_false_is_ignored(self, patch_send_ok):
        async def _run():
            db = _db()
            doc = await _insert(db, reminder_eligible=False)
            await rr._once(db)
            return await db.interest_registrations.find_one({"id": doc["id"]})
        fresh = asyncio.run(_run())
        assert "reminder_sent_at" not in fresh
        assert len(patch_send_ok.calls) == 0

    def test_young_row_is_not_nudged(self, patch_send_ok):
        """Row <24h old must not be touched even with reminder_eligible=True."""
        async def _run():
            db = _db()
            doc = await _insert(db, reminder_eligible=True, created_at=_hours_ago(2))
            await rr._once(db)
            return await db.interest_registrations.find_one({"id": doc["id"]})
        fresh = asyncio.run(_run())
        assert "reminder_sent_at" not in fresh
        assert len(patch_send_ok.calls) == 0

    def test_row_with_founder_number_is_ignored(self, patch_send_ok):
        async def _run():
            db = _db()
            doc = await _insert(db, reminder_eligible=True, founder_number=42)
            await rr._once(db)
            return await db.interest_registrations.find_one({"id": doc["id"]})
        fresh = asyncio.run(_run())
        assert "reminder_sent_at" not in fresh
        assert len(patch_send_ok.calls) == 0

    def test_confirmed_row_is_ignored(self, patch_send_ok):
        async def _run():
            db = _db()
            doc = await _insert(db, reminder_eligible=True, status="registered")
            await rr._once(db)
            return await db.interest_registrations.find_one({"id": doc["id"]})
        fresh = asyncio.run(_run())
        assert "reminder_sent_at" not in fresh
        assert len(patch_send_ok.calls) == 0

    def test_reserved_row_is_ignored(self, patch_send_ok):
        async def _run():
            db = _db()
            doc = await _insert(db, reminder_eligible=True, is_reserved=True)
            await rr._once(db)
            return await db.interest_registrations.find_one({"id": doc["id"]})
        fresh = asyncio.run(_run())
        assert "reminder_sent_at" not in fresh
        assert len(patch_send_ok.calls) == 0


# --------------------------------------------------------------------------- #
# Happy / suppression / failure / idempotence
# --------------------------------------------------------------------------- #
class TestSendPaths:
    def test_eligible_row_sends_and_stamps(self, patch_send_ok):
        async def _run():
            db = _db()
            doc = await _insert(db, reminder_eligible=True)
            await rr._once(db)
            return doc, await db.interest_registrations.find_one({"id": doc["id"]})
        doc, fresh = asyncio.run(_run())
        assert fresh.get("reminder_sent_at"), "Eligible row was not stamped reminder_sent_at"
        assert fresh.get("reminder_message_id") == "msg_test_iter254"
        assert fresh.get("reminder_source") == "registration_reminder.service"
        hist = fresh.get("history") or []
        assert any(h.get("kind") == "reminder_sent" for h in hist), "History entry missing"
        assert len(patch_send_ok.calls) == 1
        kwargs = patch_send_ok.calls[0]
        assert kwargs["to"].lower() == doc["email"].lower()
        assert "Founding Member spot is waiting" in kwargs["subject"]
        assert f"rid={doc['id']}" in kwargs["html"]
        assert f"rid={doc['id']}" in kwargs["text"]

    def test_idempotent_second_pass(self, patch_send_ok):
        async def _run():
            db = _db()
            doc = await _insert(db, reminder_eligible=True)
            await rr._once(db)
            await rr._once(db)
            return await db.interest_registrations.find_one({"id": doc["id"]})
        fresh = asyncio.run(_run())
        assert fresh.get("reminder_sent_at")
        assert len(patch_send_ok.calls) == 1, "Second pass resent — idempotence broken"

    def test_suppressed_email_is_skipped(self, patch_send_ok, patch_suppressed):
        async def _run():
            db = _db()
            doc = await _insert(db, reminder_eligible=True)
            await rr._once(db)
            return await db.interest_registrations.find_one({"id": doc["id"]})
        fresh = asyncio.run(_run())
        assert "reminder_sent_at" not in fresh, "Suppressed email was still sent"
        assert fresh.get("reminder_skip_reason") == "suppressed"
        assert fresh.get("reminder_skipped_at")
        assert len(patch_send_ok.calls) == 0

    def test_failed_send_stamps_failure(self, patch_send_fail):
        async def _run():
            db = _db()
            doc = await _insert(db, reminder_eligible=True)
            await rr._once(db)
            return await db.interest_registrations.find_one({"id": doc["id"]})
        fresh = asyncio.run(_run())
        assert "reminder_sent_at" not in fresh
        assert fresh.get("reminder_failed_at"), "Failed sends must stamp reminder_failed_at"
        assert fresh.get("reminder_failure_reason")
        assert len(patch_send_fail.calls) == 1

    def test_georgia_companion_uses_georgia_host(self, patch_send_ok):
        async def _run():
            db = _db()
            await _insert(db, reminder_eligible=True, companion_choice="georgia")
            await rr._once(db)
        asyncio.run(_run())
        assert len(patch_send_ok.calls) == 1
        kwargs = patch_send_ok.calls[0]
        assert "Georgia at FriendPlace" in kwargs["html"]
        assert "Georgia at FriendPlace" in kwargs["text"]


# --------------------------------------------------------------------------- #
# Config constants / finish URL
# --------------------------------------------------------------------------- #
class TestConfig:
    def test_wait_hours_is_24(self):
        assert rr._WAIT_HOURS == 24

    def test_poll_seconds_is_5min(self):
        assert rr._POLL_SECONDS == 300

    def test_finish_url_binds_rid(self):
        rid = "abc-123"
        url = rr._finish_url(rid)
        assert url.endswith(f"/register-interest/finish?rid={rid}")
