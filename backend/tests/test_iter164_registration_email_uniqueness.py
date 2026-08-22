"""iter164 — Register-Your-Interest email uniqueness.

Bug reproduced: Dora registered with the same email 14 h after her
original registration and got a SECOND row + a SECOND founder number
(#0011 was a duplicate of #0010). The dedup window was only 10 min.

These tests lock in:
  1. Same email hours later returns the ORIGINAL registration and
     ORIGINAL founder number — no new row is created.
  2. Email is normalised (case + surrounding whitespace) before lookup,
     so "Dora@Example.com  " still matches the stored "dora@example.com".
  3. The counter is NOT $inc'd for a duplicate submission (no gap
     leaks in the numbering just because Dora came back).
  4. The "already registered" acknowledgement message is triggered
     on the return visit — the visitor gets the warm receipt again
     with their original founder number.

Tests hit the LIVE backend on localhost:8001 (started by supervisor)
so we avoid the pytest-asyncio + motor global-loop entanglement that
ASGITransport would otherwise cause.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
import pytest_asyncio
from motor.motor_asyncio import AsyncIOMotorClient

BACKEND_URL = "http://localhost:8001"
MONGO_URL = os.environ.get("MONGO_URL") or "mongodb://localhost:27017"
DB_NAME = os.environ.get("DB_NAME") or "test_database"


# Session-scoped event loop so motor client stays valid across tests.
@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest_asyncio.fixture(loop_scope="session")
async def db():
    client = AsyncIOMotorClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest_asyncio.fixture(autouse=True, loop_scope="session")
async def _clean_iter164(db):
    """Purge any rows for iter164- prefixed emails before + after so
    reruns start from a clean slate."""
    await db.interest_registrations.delete_many(
        {"email": {"$regex": "^iter164-"}}
    )
    await db.retired_registrations.delete_many(
        {"email": {"$regex": "^iter164-"}}
    )
    yield
    await db.interest_registrations.delete_many(
        {"email": {"$regex": "^iter164-"}}
    )
    await db.retired_registrations.delete_many(
        {"email": {"$regex": "^iter164-"}}
    )


def _fresh_email():
    return f"iter164-{uuid.uuid4().hex[:8]}@example.com"


async def _post_register(client, email, first_name="Dora", companion="george"):
    return await client.post(
        f"{BACKEND_URL}/api/public/register-interest",
        json={
            "first_name": first_name,
            "email": email,
            "companion_choice": companion,
            "heard_from": "iter164 regression",
        },
    )


# ─────────────────────────────────────────────────────────────────────
#  Regression scenarios
# ─────────────────────────────────────────────────────────────────────

async def test_first_registration_gets_a_founder_number(db):
    async with httpx.AsyncClient(timeout=15) as client:
        r = await _post_register(client, _fresh_email())
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body.get("deduplicated") in (False, None)
        assert isinstance(body["founder_number"], int)
        assert body["founder_number"] >= 3


async def test_same_email_hours_later_returns_original_registration(db):
    """The exact bug: Dora registers, then re-submits ~14 h later.
    Second call MUST return the original founder number, not create a
    new row."""
    email = _fresh_email()
    async with httpx.AsyncClient(timeout=15) as client:
        r1 = await _post_register(client, email)
        assert r1.status_code == 200, r1.text
        original_number = r1.json()["founder_number"]

        # Back-date the row so nothing in the endpoint's timing logic
        # considers this a "rapid" resubmit (still fires the resend
        # thanks to the 60-second cooldown NOT applying).
        fourteen_hours_ago = (
            datetime.now(timezone.utc) - timedelta(hours=14)
        ).isoformat()
        await db.interest_registrations.update_one(
            {"email": email},
            {"$set": {"created_at": fourteen_hours_ago}},
        )

        # Second submission — same normalised email.
        r2 = await _post_register(client, email)
        assert r2.status_code == 200, r2.text
        body2 = r2.json()

    assert body2["founder_number"] == original_number, (
        f"Return visit must reuse founder number {original_number}, "
        f"got {body2['founder_number']}"
    )
    assert body2.get("deduplicated") is True
    assert body2.get("already_registered") is True
    # The "already registered" acknowledgement DID fire on the return
    # visit (60-second cooldown didn't block it — that row's created_at
    # was 14h ago and no last_re_registered_at was set).
    assert body2.get("acknowledgement_resent") is True

    total = await db.interest_registrations.count_documents({"email": email})
    assert total == 1, (
        f"Expected 1 row for {email}, got {total} — duplicate leaked through!"
    )


async def test_normalisation_case_and_whitespace(db):
    """`DORA@Example.com` and `'  dora@example.com  '` must be treated
    as the same address so the return visit still dedups."""
    email_lower = _fresh_email()
    async with httpx.AsyncClient(timeout=15) as client:
        r1 = await _post_register(client, email_lower)
        assert r1.status_code == 200
        first_num = r1.json()["founder_number"]

        variants = [
            email_lower.upper(),
            email_lower.title(),
            f"  {email_lower}  ",
        ]
        for variant in variants:
            r = await _post_register(client, variant)
            assert r.status_code == 200, f"variant {variant!r} rejected: {r.text}"
            body = r.json()
            assert body["founder_number"] == first_num, (
                f"variant {variant!r} got a NEW number {body['founder_number']} "
                f"instead of the original {first_num}"
            )
            assert body.get("deduplicated") is True

    total = await db.interest_registrations.count_documents({"email": email_lower})
    assert total == 1


async def test_counter_does_not_advance_on_duplicate(db):
    """The next NEW registration after Dora's return visit must pick up
    right after Dora, NOT one higher (i.e. the $inc for the second
    Dora attempt must not fire)."""
    from server import _FOUNDER_NUMBER_COUNTER_ID

    dora = _fresh_email()
    async with httpx.AsyncClient(timeout=15) as client:
        r1 = await _post_register(client, dora)
        assert r1.status_code == 200
        dora_num = r1.json()["founder_number"]

        counter_after_first = await db.counters.find_one(
            {"id": _FOUNDER_NUMBER_COUNTER_ID},
        )

        # Dora re-submits.
        r2 = await _post_register(client, dora)
        assert r2.status_code == 200

        counter_after_dupe = await db.counters.find_one(
            {"id": _FOUNDER_NUMBER_COUNTER_ID},
        )
        assert counter_after_dupe["value"] == counter_after_first["value"], (
            "Counter must NOT advance on a duplicate submission — "
            f"before={counter_after_first['value']} "
            f"after={counter_after_dupe['value']}"
        )

        # New visitor comes in — must get exactly dora_num + 1 (no gap).
        fresh = _fresh_email()
        r3 = await _post_register(client, fresh, first_name="Fresh", companion="georgia")
        assert r3.status_code == 200
        assert r3.json()["founder_number"] == dora_num + 1


async def test_test_flagged_rows_are_not_treated_as_dupes(db):
    """The dedup lookup must exclude ``is_test:true`` rows so a QA
    fixture with the same email as a real visitor doesn't hijack the
    return."""
    email = _fresh_email()

    # Insert a test-flagged row FIRST with the same email.
    await db.interest_registrations.insert_one({
        "id": "fake-test-row", "email": email, "first_name": "QA",
        "founder_number": 999, "is_test": True, "created_at": "2020-01-01T00:00:00+00:00",
        "status": "registered",
    })

    async with httpx.AsyncClient(timeout=15) as client:
        r = await _post_register(client, email, first_name="Real")
        assert r.status_code == 200, r.text
        body = r.json()

    # We got a fresh founder number, NOT the test row's 999.
    assert body.get("deduplicated") in (False, None)
    assert body["founder_number"] != 999


async def test_repeat_within_60_seconds_does_not_spam_email(db):
    """Cooldown: rapid re-submits within 60 s share the record but do
    not resend the acknowledgement — protects against bot / stuck
    retry loops without punishing legitimate return visits."""
    email = _fresh_email()
    async with httpx.AsyncClient(timeout=15) as client:
        r1 = await _post_register(client, email)
        assert r1.status_code == 200
        first_num = r1.json()["founder_number"]

        # Fire again immediately.
        r2 = await _post_register(client, email)
        assert r2.status_code == 200
        body2 = r2.json()

    assert body2["founder_number"] == first_num
    assert body2.get("deduplicated") is True
    assert body2.get("already_registered") is True
    # Cooldown was hit — no second email fired.
    assert body2.get("acknowledgement_resent") is False, (
        "60-second cooldown must suppress the resend for rapid duplicates."
    )


# ─────────────────────────────────────────────────────────────────────
#  Retire-duplicates script
# ─────────────────────────────────────────────────────────────────────

async def test_retire_script_finds_duplicates_and_picks_lowest_number(db):
    """The retire script's core function correctly identifies
    duplicates and picks the lowest founder_number as the keeper.

    Note: we seed rows with ``is_test`` OMITTED so they bypass the
    new partial unique index — this mirrors the LEGACY state the
    retire script exists to clean up (pre-iter164 rows never had
    the index enforced)."""
    from scripts.retire_duplicate_founding_members import _find_duplicate_groups

    email = _fresh_email()
    await db.interest_registrations.insert_one({
        "id": "keeper-id", "email": email, "first_name": "Dora",
        "founder_number": 10, "is_reserved": False,
        "created_at": "2026-08-01T00:00:00+00:00", "status": "registered",
    })
    await db.interest_registrations.insert_one({
        "id": "dupe-id", "email": email, "first_name": "Dora",
        "founder_number": 11, "is_reserved": False,
        "created_at": "2026-08-01T14:00:00+00:00", "status": "registered",
    })

    groups = await _find_duplicate_groups(db, only_email=email)
    assert len(groups) == 1
    g = groups[0]
    assert g["email"] == email
    assert g["keeper"]["founder_number"] == 10
    assert len(g["duplicates"]) == 1
    assert g["duplicates"][0]["founder_number"] == 11


async def test_retire_script_moves_row_to_audit_collection(db):
    """Applying the retire moves the row into retired_registrations
    with the correct reason + keeper pointer, and removes it from
    interest_registrations. Numbering gaps are intentional.

    Seeds legacy-style rows (no ``is_test`` field) to bypass the
    partial unique index — see previous test."""
    from scripts.retire_duplicate_founding_members import (
        _find_duplicate_groups, _retire_row,
    )

    email = _fresh_email()
    await db.interest_registrations.insert_one({
        "id": "keeper-id-2", "email": email, "first_name": "Dora",
        "founder_number": 10, "is_reserved": False,
        "created_at": "2026-08-01T00:00:00+00:00", "status": "registered",
    })
    await db.interest_registrations.insert_one({
        "id": "dupe-id-2", "email": email, "first_name": "Dora",
        "founder_number": 11, "is_reserved": False,
        "created_at": "2026-08-01T14:00:00+00:00", "status": "registered",
    })

    groups = await _find_duplicate_groups(db, only_email=email)
    g = groups[0]
    await _retire_row(db, g["duplicates"][0], g["keeper"],
                      reason="iter164 test retire")

    keeper_row = await db.interest_registrations.find_one({"id": "keeper-id-2"})
    assert keeper_row is not None
    assert keeper_row["founder_number"] == 10

    gone = await db.interest_registrations.find_one({"id": "dupe-id-2"})
    assert gone is None

    audit = await db.retired_registrations.find_one({"id": "dupe-id-2"})
    assert audit is not None
    assert audit["retire_keeper_id"] == "keeper-id-2"
    assert audit["retire_keeper_founder_number"] == 10
    assert "retired_at" in audit
    assert "test retire" in audit["retire_reason"]


async def test_retire_script_ignores_test_flagged_rows(db):
    """Test-flagged duplicates must NOT show up in the retire scan —
    QA fixtures may deliberately share emails for iteration."""
    from scripts.retire_duplicate_founding_members import _find_duplicate_groups

    email = _fresh_email()
    await db.interest_registrations.insert_one({
        "id": "qa-1", "email": email, "founder_number": 501,
        "is_test": True, "created_at": "2026-08-01T00:00:00+00:00",
    })
    await db.interest_registrations.insert_one({
        "id": "qa-2", "email": email, "founder_number": 502,
        "is_test": True, "created_at": "2026-08-01T01:00:00+00:00",
    })

    groups = await _find_duplicate_groups(db)
    for g in groups:
        assert g["email"] != email, (
            "Test-flagged duplicates must be excluded from the retire scan"
        )


async def test_retire_script_refuses_reserved_rows(db):
    """The retire script must NEVER retire reserved seed rows even if
    somehow they end up sharing an email with another row."""
    from scripts.retire_duplicate_founding_members import _find_duplicate_groups

    email = _fresh_email()
    await db.interest_registrations.insert_one({
        "id": "res-x", "email": email, "founder_number": 1,
        "is_reserved": True,
        "created_at": "2026-08-01T00:00:00+00:00",
    })
    # A "real" row also happens to share the address (hypothetical
    # legacy state — the partial unique index doesn't cover reserved).
    await db.interest_registrations.insert_one({
        "id": "real-x", "email": email, "founder_number": 42,
        "is_reserved": False,
        "created_at": "2026-08-01T01:00:00+00:00",
    })

    groups = await _find_duplicate_groups(db, only_email=email)
    # Reserved row is filtered out, so only the single 'real-x' row
    # remains — that's not a duplicate group, so no group is emitted.
    assert groups == [], (
        "Reserved rows must be filtered out of the retire scan, "
        f"but got: {groups}"
    )
