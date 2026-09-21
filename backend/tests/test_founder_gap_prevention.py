"""Gap-proof Founding Member number allocation (iter190).

Root cause being fixed: the old flow drew (and thus permanently consumed) a
Founding Member number BEFORE the registration persisted, so a failed /
duplicate / concurrent submission burned a number that the monotonic counter
could never re-issue — leaving permanent gaps.

New flow (two phases):
  * POST /public/register-interest         → SAVE only, NO number.
  * POST /public/register-interest/{id}/confirm → draw + lock the number.
The number is drawn only on confirm, atomically-with-success, and recycled to
the reserved-slot queue if the attach write fails.

These talk to the real endpoint functions + helpers against a throwaway Mongo
database (server.db is monkeypatched) so real founder data is never touched.
Required scenarios:
  1. successful registration consumes exactly one number
  2. duplicate email consumes zero additional numbers
  3. concurrent same-email submissions consume one number
  4. forced insert failure does not advance the counter
  5. forced attach failure does not consume an available reserved slot
  6. normal concurrent different-email registrations remain unique/sequential
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
import email_service  # noqa: E402
from services.analytics import acquisition as acq_mod  # noqa: E402

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
TEST_DB_NAME = f"founder_gap_test_{uuid.uuid4().hex[:8]}"

_COUNTER_ID = server._FOUNDER_NUMBER_COUNTER_ID
_SLOTS = server._FOUNDER_RESERVED_SLOTS_COLL


class _FakeAck:
    ok = True
    message_id = "test-msg-id"
    error = None


class _FakeRequest:
    def __init__(self, ip="203.0.113.9"):
        self.headers = {"x-forwarded-for": ip}

        class _C:
            host = ip
        self.client = _C()


class _CollProxy:
    """Wraps a motor collection; makes the named ops raise, delegates the rest."""
    def __init__(self, real, boom_ops):
        self._real = real
        self._boom_ops = boom_ops

    def __getattr__(self, name):
        if name in self._boom_ops:
            async def _raise(*a, **k):
                raise RuntimeError(f"simulated {name} failure")
            return _raise
        return getattr(self._real, name)


class _DBProxy:
    """Delegates to the real motor db, but makes one collection's chosen ops
    raise — motor returns a fresh collection wrapper on every attribute access,
    so a plain monkeypatch can't shadow a single method; this proxy can."""
    def __init__(self, real, boom_coll, boom_ops):
        object.__setattr__(self, "_real", real)
        object.__setattr__(self, "_boom_coll", boom_coll)
        object.__setattr__(self, "_boom_ops", set(boom_ops))

    def __getattr__(self, name):
        real_attr = getattr(self._real, name)
        if name == self._boom_coll:
            return _CollProxy(real_attr, self._boom_ops)
        return real_attr

    def __getitem__(self, name):
        real_coll = self._real[name]
        if name == self._boom_coll:
            return _CollProxy(real_coll, self._boom_ops)
        return real_coll


@pytest.fixture()
def gap_db(monkeypatch):
    client = AsyncIOMotorClient(MONGO_URL)
    test_db = client[TEST_DB_NAME]
    monkeypatch.setattr(server, "db", test_db)

    # Neutralise all side-effect emails / telemetry so tests stay hermetic.
    async def _fake_send_detailed(*a, **k):
        return _FakeAck()

    async def _fake_send(*a, **k):
        return _FakeAck()

    def _fake_waitlist(*a, **k):
        return ("subj", "<p>hi</p>", "hi")

    def _fake_parse(_payload):
        return {"channel": "test"}

    async def _fake_attach(*a, **k):
        return None

    monkeypatch.setattr(email_service, "send_email_detailed", _fake_send_detailed)
    monkeypatch.setattr(email_service, "send_email", _fake_send)
    monkeypatch.setattr(email_service, "waitlist_template", _fake_waitlist)
    monkeypatch.setattr(acq_mod, "parse_acquisition", _fake_parse)
    monkeypatch.setattr(acq_mod, "attach_acquisition_to_registration", _fake_attach)

    async def _reset():
        for coll in ("counters", _SLOTS, "interest_registrations",
                     "founder_email_claims", "email_test_log"):
            await test_db[coll].delete_many({})
        # Counter rebased to 2 (Garry/George reserved) → first public = 3.
        await test_db.counters.update_one(
            {"id": _COUNTER_ID}, {"$set": {"value": 2}}, upsert=True)

    asyncio.get_event_loop().run_until_complete(_reset())
    yield test_db
    asyncio.get_event_loop().run_until_complete(client.drop_database(TEST_DB_NAME))
    client.close()


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


async def _counter_value(db):
    doc = await db.counters.find_one({"id": _COUNTER_ID})
    return int((doc or {}).get("value") or 0)


async def _save(email, first="Ada"):
    return await server.public_register_interest(
        {"first_name": first, "email": email, "companion_choice": "george"},
        _FakeRequest(),
    )


async def _confirm(reg_id):
    return await server.public_register_interest_confirm(reg_id, _FakeRequest())


# ── 1) Successful registration consumes exactly one number ───────────────
def test_success_consumes_exactly_one_number(gap_db):
    async def _t():
        before = await _counter_value(gap_db)
        saved = await _save("ada@example.com")
        assert saved["founder_number"] is None and saved["confirmed"] is False
        # SAVE must NOT have drawn a number.
        assert await _counter_value(gap_db) == before
        confirmed = await _confirm(saved["id"])
        assert confirmed["founder_number"] == before + 1
        assert await _counter_value(gap_db) == before + 1
        # Pressing again is idempotent — same number, no further consumption.
        again = await _confirm(saved["id"])
        assert again["founder_number"] == before + 1
        assert await _counter_value(gap_db) == before + 1
        # Exactly one row, exactly one number.
        rows = await gap_db.interest_registrations.find(
            {"email": "ada@example.com"}).to_list(None)
        assert len(rows) == 1 and rows[0]["founder_number"] == before + 1
    _run(_t())


# ── 2) Duplicate email consumes zero additional numbers ──────────────────
def test_duplicate_email_consumes_zero_additional(gap_db):
    async def _t():
        s = await _save("dup@example.com")
        c = await _confirm(s["id"])
        num = c["founder_number"]
        counter_after_first = await _counter_value(gap_db)
        # Re-submit the SAME email (any time later).
        s2 = await _save("dup@example.com")
        assert s2["deduplicated"] is True and s2["confirmed"] is True
        assert s2["founder_number"] == num and s2["id"] == s["id"]
        # Confirm again → same number, no new draw.
        c2 = await _confirm(s2["id"])
        assert c2["founder_number"] == num
        assert await _counter_value(gap_db) == counter_after_first
        assert await gap_db.interest_registrations.count_documents(
            {"email": "dup@example.com"}) == 1
    _run(_t())


# ── 3) Concurrent same-email submissions consume one number ──────────────
def test_concurrent_same_email_one_number(gap_db):
    async def _t():
        results = await asyncio.gather(
            *[_save("race@example.com") for _ in range(6)]
        )
        ids = {r["id"] for r in results}
        # The atomic per-email claim collapses them to a single pending row.
        assert len(ids) == 1, ids
        reg_id = ids.pop()
        # Exactly one row for the email, and only one after confirm.
        assert await gap_db.interest_registrations.count_documents(
            {"email": "race@example.com"}) == 1
        c = await _confirm(reg_id)
        assert isinstance(c["founder_number"], int)
        # Even confirming concurrently many times yields one number.
        more = await asyncio.gather(*[_confirm(reg_id) for _ in range(5)])
        nums = {m["founder_number"] for m in more} | {c["founder_number"]}
        assert len(nums) == 1, nums
        assert await gap_db.interest_registrations.count_documents(
            {"email": "race@example.com", "founder_number": {"$gt": 0}}) == 1
    _run(_t())


# ── 4) Forced insert failure does not advance the counter ────────────────
def test_forced_insert_failure_does_not_advance_counter(gap_db, monkeypatch):
    async def _t():
        before = await _counter_value(gap_db)
        monkeypatch.setattr(
            server, "db",
            _DBProxy(gap_db, boom_coll="interest_registrations", boom_ops={"insert_one"}),
        )
        with pytest.raises(Exception):
            await _save("fail@example.com")
        monkeypatch.undo()
        # No number was drawn (draw happens only on confirm), so the counter
        # must be exactly where it started — nothing burned.
        assert await _counter_value(gap_db) == before
        # And the email claim was released so the visitor isn't blocked.
        assert await gap_db.founder_email_claims.count_documents(
            {"_id": "fail@example.com"}) == 0
    _run(_t())


# ── 5) Forced attach failure does not consume an available reserved slot ─
def test_forced_attach_failure_recycles_reserved_slot(gap_db, monkeypatch):
    async def _t():
        # Seed a reserved gap slot (#0100) and a pending registration row.
        await server._reserve_founder_slot(100, note="gap")
        before_counter = await _counter_value(gap_db)
        reg_id = str(uuid.uuid4())
        await gap_db.interest_registrations.insert_one({
            "id": reg_id, "email": "attach@example.com", "founder_number": None,
            "is_test": False, "created_at": server.now_iso(),
        })
        monkeypatch.setattr(
            server, "db",
            _DBProxy(gap_db, boom_coll="interest_registrations", boom_ops={"update_one"}),
        )
        with pytest.raises(Exception):
            await server._assign_founder_number_to_registration(reg_id)
        monkeypatch.undo()  # restore real db for assertions

        # The reserved slot must be AVAILABLE again (recycled), not consumed.
        slot = await gap_db[_SLOTS].find_one({"number": 100})
        assert slot["status"] == "available", slot
        # The monotonic counter was never touched (reserved path).
        assert await _counter_value(gap_db) == before_counter
        # Row still has no number → nothing was burned.
        row = await gap_db.interest_registrations.find_one({"id": reg_id})
        assert row["founder_number"] is None
    _run(_t())


# ── 6) Concurrent DIFFERENT-email registrations remain unique/sequential ─
def test_concurrent_different_emails_unique_sequential(gap_db):
    async def _t():
        before = await _counter_value(gap_db)
        emails = [f"user{i}@example.com" for i in range(5)]
        saved = await asyncio.gather(*[_save(e) for e in emails])
        assert len({s["id"] for s in saved}) == 5
        # None consumed a number at save time.
        assert await _counter_value(gap_db) == before
        confirmed = await asyncio.gather(*[_confirm(s["id"]) for s in saved])
        nums = sorted(c["founder_number"] for c in confirmed)
        assert len(set(nums)) == 5, nums                       # all unique
        assert nums == list(range(before + 1, before + 6)), nums  # sequential
        assert await _counter_value(gap_db) == before + 5
    _run(_t())
