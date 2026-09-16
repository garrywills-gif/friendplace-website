"""Tests for the founder-number reserved-slot / gap-fill queue.

Covers the four scenarios required for option (a):
  1. Normal allocation — no reserved slots → monotonic counter, strictly
     increasing.
  2. Reserved-slot allocation — a seeded gap number (e.g. #0100) is issued
     next even though the counter's max is already well above it, and the
     counter is NOT disturbed.
  3. Concurrent consumption — two reserved slots, many simultaneous callers;
     every issued number is unique (no double-issue) and both reserved
     numbers are handed out before the counter is touched.
  4. Fallback — once the queue is drained, allocation falls back to the
     monotonic counter and keeps counting up from where it was.

Also verifies the reserve helper is idempotent and refuses to reserve a
number already held by a live registration.

These talk to `server._next_founder_number` / `_reserve_founder_slot` /
`_consume_reserved_founder_slot` directly against a throwaway Mongo database
so they never touch real founder data.
"""
from __future__ import annotations

import os
import sys
import uuid
import asyncio

import pytest

sys.path.insert(0, "/app/backend")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
import server  # noqa: E402

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
TEST_DB_NAME = f"founder_slots_test_{uuid.uuid4().hex[:8]}"

_COUNTER_ID = server._FOUNDER_NUMBER_COUNTER_ID
_SLOTS = server._FOUNDER_RESERVED_SLOTS_COLL


@pytest.fixture()
def slot_db(monkeypatch):
    """Point server.db at a fresh throwaway database for each test.

    server._next_founder_number and friends close over the module-level
    `db`, so we monkeypatch `server.db` and restore it afterwards. The
    database is dropped on teardown.
    """
    client = AsyncIOMotorClient(MONGO_URL)
    test_db = client[TEST_DB_NAME]
    monkeypatch.setattr(server, "db", test_db)

    async def _reset():
        await test_db.counters.delete_many({})
        await test_db[_SLOTS].delete_many({})
        await test_db.interest_registrations.delete_many({})

    asyncio.get_event_loop().run_until_complete(_reset())
    yield test_db
    asyncio.get_event_loop().run_until_complete(client.drop_database(TEST_DB_NAME))
    client.close()


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


async def _set_counter(db, value: int):
    await db.counters.update_one(
        {"id": _COUNTER_ID}, {"$set": {"value": value}}, upsert=True
    )


# ─── 1) Normal allocation (monotonic counter) ────────────────────────────

def test_normal_allocation_is_monotonic(slot_db):
    async def _t():
        await _set_counter(slot_db, 102)  # production-like: max already 102
        got = [await server._next_founder_number() for _ in range(3)]
        assert got == [103, 104, 105], got
        # No reserved slots existed, so none were created/consumed.
        assert await slot_db[_SLOTS].count_documents({}) == 0
    _run(_t())


# ─── 2) Reserved-slot allocation ─────────────────────────────────────────

def test_reserved_slot_issued_before_counter(slot_db):
    async def _t():
        await _set_counter(slot_db, 102)  # counter max is already 102
        res = await server._reserve_founder_slot(100, note="restore #0100")
        assert res["ok"] and res["status"] == "available", res

        # Next allocation must hand out the gap number 100, NOT 103.
        first = await server._next_founder_number()
        assert first == 100, first

        # The monotonic counter must be untouched by the reserved allocation.
        counter = await slot_db.counters.find_one({"id": _COUNTER_ID})
        assert counter["value"] == 102, counter

        # The slot is now consumed, not available.
        slot = await slot_db[_SLOTS].find_one({"number": 100})
        assert slot["status"] == "consumed", slot

        # The very next allocation falls back to the counter → 103.
        second = await server._next_founder_number()
        assert second == 103, second
    _run(_t())


def test_reserve_is_idempotent_and_rejects_taken_numbers(slot_db):
    async def _t():
        # Idempotent: reserving the same number twice doesn't duplicate.
        r1 = await server._reserve_founder_slot(100)
        r2 = await server._reserve_founder_slot(100)
        assert r1["ok"] and r1["already_present"] is False
        assert r2["ok"] and r2["already_present"] is True
        assert await slot_db[_SLOTS].count_documents({"number": 100}) == 1

        # Refuses to reserve a number already held by a live registration.
        await slot_db.interest_registrations.insert_one(
            {"id": str(uuid.uuid4()), "founder_number": 55, "is_test": False}
        )
        taken = await server._reserve_founder_slot(55)
        assert taken["ok"] is False and taken["reason"] == "number already assigned"
        assert await slot_db[_SLOTS].count_documents({"number": 55}) == 0
    _run(_t())


def test_lowest_reserved_slot_is_issued_first(slot_db):
    async def _t():
        await _set_counter(slot_db, 200)
        await server._reserve_founder_slot(150)
        await server._reserve_founder_slot(100)
        await server._reserve_founder_slot(175)
        got = [await server._next_founder_number() for _ in range(3)]
        assert got == [100, 150, 175], got  # ascending, gap-first
        # Then fall back to the counter.
        assert await server._next_founder_number() == 201
    _run(_t())


# ─── 3) Concurrent consumption ───────────────────────────────────────────

def test_concurrent_consumption_never_double_issues(slot_db):
    async def _t():
        await _set_counter(slot_db, 102)
        await server._reserve_founder_slot(100)
        await server._reserve_founder_slot(101)

        # Fire many simultaneous allocations.
        results = await asyncio.gather(
            *[server._next_founder_number() for _ in range(10)]
        )
        # Every issued number is unique — no collisions under concurrency.
        assert len(results) == len(set(results)), results
        # Both reserved gap numbers were handed out exactly once.
        assert 100 in results and 101 in results
        assert results.count(100) == 1 and results.count(101) == 1
        # The remaining 8 came from the monotonic counter (103..110).
        counter_issued = sorted(r for r in results if r not in (100, 101))
        assert counter_issued == list(range(103, 111)), counter_issued
        # Both slots are marked consumed.
        assert await slot_db[_SLOTS].count_documents({"status": "consumed"}) == 2
        assert await slot_db[_SLOTS].count_documents({"status": "available"}) == 0
    _run(_t())


# ─── 4) Fallback to the main counter ─────────────────────────────────────

def test_fallback_after_queue_drained(slot_db):
    async def _t():
        await _set_counter(slot_db, 102)
        await server._reserve_founder_slot(100)
        # Drain the single reserved slot.
        assert await server._next_founder_number() == 100
        # Queue empty → fall back and keep counting from the counter.
        got = [await server._next_founder_number() for _ in range(3)]
        assert got == [103, 104, 105], got
    _run(_t())


def test_voids_slot_if_number_already_assigned(slot_db):
    async def _t():
        await _set_counter(slot_db, 102)
        # Reserve 100, but then simulate it being filled by another path.
        await server._reserve_founder_slot(100)
        await server._reserve_founder_slot(105)
        await slot_db.interest_registrations.insert_one(
            {"id": str(uuid.uuid4()), "founder_number": 100, "is_test": False}
        )
        # Consumption must skip the now-invalid 100 and hand out 105.
        got = await server._next_founder_number()
        assert got == 105, got
        voided = await slot_db[_SLOTS].find_one({"number": 100})
        assert voided["status"] == "voided", voided
    _run(_t())
