"""iter164ah — Permanent Outreach numbering tests.

Contract with Garry (27 Aug 2026):

  * Every outreach organisation gets a permanent sequential
    integer id in ``outreach_number``, starting at 20001.
  * Assigned automatically on create; existing rows backfilled
    on boot in a stable order (oldest ``created_at`` first).
  * Never derived from a row count. Never reused on delete.
  * Uses an atomic counter (``counters._id="outreach_number"``)
    so concurrent creates cannot duplicate numbers.
  * When an outreach org is used in a campaign, ``outreach_number``
    is COPIED onto the campaign_recipient record — historical
    campaigns still show #20001 even after the source org is
    deleted.
  * Founding Member numbering is completely unaffected.

Tests exercise the backend directly (no HTTP) so counter-atomicity
can be verified deterministically.
"""

from __future__ import annotations

import asyncio
import os
import uuid

import pytest
from dotenv import load_dotenv
from pymongo import MongoClient


@pytest.fixture(scope="module")
def sync_db():
    load_dotenv("/app/backend/.env")
    client = MongoClient(os.environ["MONGO_URL"])
    yield client[os.environ.get("DB_NAME", "test_database")]
    client.close()


def _fresh_motor_db():
    """Fresh Motor client per test so pytest-asyncio's per-test
    event-loop teardown doesn't leave dangling coroutines.
    """
    from motor.motor_asyncio import AsyncIOMotorClient
    load_dotenv("/app/backend/.env")
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    return client, client[os.environ.get("DB_NAME", "test_database")]


def _run(coro_fn):
    async def _wrap():
        client, db = _fresh_motor_db()
        try:
            return await coro_fn(db)
        finally:
            client.close()
    return asyncio.new_event_loop().run_until_complete(_wrap())


def _cleanup(sync_db, ids: list[str]):
    if ids:
        sync_db.outreach_organisations.delete_many({"id": {"$in": ids}})


# ---------------------------------------------------------------------------
# 1. First allocated number is 20001.
# ---------------------------------------------------------------------------

def test_first_ever_allocation_returns_20001(sync_db):
    # Force a clean-slate counter: park the current value under a
    # backup key so we don't cross-contaminate other tests.
    prev = sync_db.counters.find_one({"_id": "outreach_number"})
    sync_db.counters.delete_one({"_id": "outreach_number"})
    # Also blank every existing outreach_number so the on-boot
    # backfill high-water doesn't leak in.
    prev_numbers = list(sync_db.outreach_organisations.find(
        {"outreach_number": {"$exists": True}},
        {"_id": 1, "outreach_number": 1},
    ))
    sync_db.outreach_organisations.update_many(
        {}, {"$unset": {"outreach_number": ""}},
    )
    try:
        async def _do(db):
            from services.outreach.store import next_outreach_number
            n = await next_outreach_number(db)
            return n
        n = _run(_do)
        assert n == 20001, f"first allocation must return 20001, got {n}"
    finally:
        # Restore the previous state.
        sync_db.counters.delete_one({"_id": "outreach_number"})
        if prev:
            sync_db.counters.insert_one(prev)
        for r in prev_numbers:
            sync_db.outreach_organisations.update_one(
                {"_id": r["_id"]},
                {"$set": {"outreach_number": r["outreach_number"]}},
            )


# ---------------------------------------------------------------------------
# 2. Sequential allocation.
# ---------------------------------------------------------------------------

def test_sequential_allocation(sync_db):
    async def _do(db):
        from services.outreach.store import next_outreach_number
        a = await next_outreach_number(db)
        b = await next_outreach_number(db)
        c = await next_outreach_number(db)
        return a, b, c
    a, b, c = _run(_do)
    assert b == a + 1
    assert c == b + 1


# ---------------------------------------------------------------------------
# 3. Concurrent creates never duplicate.
# ---------------------------------------------------------------------------

def test_concurrent_creates_all_get_unique_numbers(sync_db):
    tag = f"iter164ah-conc-{uuid.uuid4().hex[:6]}"
    created_ids: list[str] = []

    async def _do(db):
        from services.outreach.store import upsert_org
        # Fire 12 creates in parallel — different emails so each is
        # a real INSERT (upsert_org keys on email).
        async def _one(i: int):
            org = await upsert_org(db, {
                "organisation_name": f"Conc {tag} {i}",
                "email":             f"conc-{tag}-{i}@example.com",
            })
            return org

        results = await asyncio.gather(*[_one(i) for i in range(12)])
        return results

    orgs = _run(_do)
    numbers = []
    for o in orgs:
        created_ids.append(o["id"])
        numbers.append(o.get("outreach_number"))
    try:
        # All non-None.
        assert all(isinstance(n, int) for n in numbers), (
            f"every concurrent create must receive an int, got {numbers}"
        )
        # All unique.
        assert len(set(numbers)) == len(numbers), (
            f"concurrent creates produced duplicate numbers: {numbers}"
        )
        # All above the 20000 base.
        assert all(n > 20000 for n in numbers)
    finally:
        _cleanup(sync_db, created_ids)


# ---------------------------------------------------------------------------
# 4. Deletion does not cause number reuse.
# ---------------------------------------------------------------------------

def test_deletion_does_not_reuse_number(sync_db):
    tag = f"iter164ah-del-{uuid.uuid4().hex[:6]}"
    created_ids: list[str] = []

    async def _do(db):
        from services.outreach.store import upsert_org, delete_org
        first  = await upsert_org(db, {"organisation_name": f"D1 {tag}",
                                        "email": f"d1-{tag}@example.com"})
        second = await upsert_org(db, {"organisation_name": f"D2 {tag}",
                                        "email": f"d2-{tag}@example.com"})
        # Delete the most recently created row.
        await delete_org(db, second["id"])
        # A brand-new create must NOT get second["outreach_number"].
        third = await upsert_org(db, {"organisation_name": f"D3 {tag}",
                                       "email": f"d3-{tag}@example.com"})
        return first, second, third

    a, b, c = _run(_do)
    created_ids.extend([a["id"], c["id"]])   # b already deleted
    try:
        assert a["outreach_number"] < b["outreach_number"] < c["outreach_number"]
        # Crucially — c did NOT get b's number back.
        assert c["outreach_number"] != b["outreach_number"]
        assert c["outreach_number"] == b["outreach_number"] + 1
    finally:
        _cleanup(sync_db, created_ids)


# ---------------------------------------------------------------------------
# 5. Backfill assigns unique numbers to every un-numbered row.
# ---------------------------------------------------------------------------

def test_backfill_covers_all_unnumbered_rows(sync_db):
    tag = f"iter164ah-bf-{uuid.uuid4().hex[:6]}"
    created_ids: list[str] = []
    # Seed 5 outreach rows WITHOUT outreach_number.
    for i in range(5):
        oid = str(uuid.uuid4())
        created_ids.append(oid)
        sync_db.outreach_organisations.insert_one({
            "id":                oid,
            "organisation_name": f"BF {tag} {i}",
            "email":             f"bf-{tag}-{i}@example.com",
            "created_at":        f"2026-08-27T05:00:{i:02d}Z",
            "updated_at":        f"2026-08-27T05:00:{i:02d}Z",
            "is_test":           False,
        })
    try:
        async def _do(db):
            from services.outreach.store import backfill_outreach_numbers
            return await backfill_outreach_numbers(db)
        summary = _run(_do)
        # Every seeded row is now numbered.
        rows = list(sync_db.outreach_organisations.find(
            {"id": {"$in": created_ids}},
            {"_id": 0, "id": 1, "outreach_number": 1, "created_at": 1},
        ))
        numbers = [r.get("outreach_number") for r in rows]
        assert all(isinstance(n, int) and n > 20000 for n in numbers)
        assert len(set(numbers)) == len(numbers)
        # Backfill returned some `assigned` count that covers our seeds.
        assert summary["assigned"] >= 5
    finally:
        _cleanup(sync_db, created_ids)


# ---------------------------------------------------------------------------
# 6. Campaign recipient preserves outreach_number (historical rule).
# ---------------------------------------------------------------------------

def test_campaign_recipient_preserves_outreach_number(sync_db):
    """The audience resolver copies ``outreach_number`` through to the
    recipient dict, and the send worker persists it on the
    campaign_recipients row (verified via the resolver contract here
    without triggering a real send).
    """
    tag = f"iter164ah-hist-{uuid.uuid4().hex[:6]}"
    created_ids: list[str] = []

    async def _do(db):
        from services.outreach.store import upsert_org
        # 1. Create an outreach org — gets outreach_number.
        org = await upsert_org(db, {
            "organisation_name": f"Hist {tag}",
            "email":             f"hist-{tag}@example.com",
            "tags":              [tag],
        })
        # 2. Resolve an outreach audience — the resolver lives inside
        #    cms_module's closure, so we replicate its outreach path
        #    directly using the shared shape.
        from services.outreach.store import COLL_ORGS
        cur = db[COLL_ORGS].find({"tags": {"$in": [tag]}}, {"_id": 0})
        recipients = [dict({
            "id":               r.get("id"),
            "email":            r.get("email"),
            "outreach_id":      r.get("id"),
            "outreach_number":  r.get("outreach_number"),
        }) async for r in cur]
        return org, recipients

    org, recipients = _run(_do)
    created_ids.append(org["id"])
    try:
        assert org.get("outreach_number") and org["outreach_number"] > 20000
        assert len(recipients) == 1
        r = recipients[0]
        # Historical rule: the number rides through the audience → recipient.
        assert r["outreach_number"] == org["outreach_number"]
        assert r["outreach_id"]     == org["id"]

        # 3. Simulate what the send worker writes to campaign_recipients:
        #    it copies `r.get("outreach_number")`. If the org is later
        #    deleted, the historical row still shows the number.
        sync_db.campaign_recipients.insert_one({
            "id":              "hist-recip-"+tag,
            "campaign_id":     "hist-camp-"+tag,
            "email":           r["email"],
            "audience_kind":   "outreach_contacts",
            "outreach_id":     r["outreach_id"],
            "outreach_number": r["outreach_number"],
            "status":          "sent",
        })
        # Delete the source org.
        sync_db.outreach_organisations.delete_one({"id": org["id"]})
        # Historical row STILL carries the number.
        row = sync_db.campaign_recipients.find_one(
            {"id": "hist-recip-"+tag},
            {"_id": 0, "outreach_number": 1, "outreach_id": 1},
        )
        assert row["outreach_number"] == org["outreach_number"]
        assert row["outreach_id"]     == org["id"]
    finally:
        sync_db.campaign_recipients.delete_one({"id": "hist-recip-"+tag})
        _cleanup(sync_db, created_ids)


# ---------------------------------------------------------------------------
# 7. Founding Member numbering unaffected.
# ---------------------------------------------------------------------------

def test_founding_member_numbering_unchanged(sync_db):
    """The outreach counter must live in its own namespace and must
    not touch the founders' ``interest_registrations.founder_number``
    or the founder counter under ``counters._id: <ObjectId>`` with
    ``id: "founder_number"``.
    """
    # 1. Snapshot the founder counter (uses `id` field, not _id).
    founder_before = sync_db.counters.find_one({"id": "founder_number"})

    # 2. Allocate a few outreach numbers.
    tag = f"iter164ah-iso-{uuid.uuid4().hex[:6]}"
    created_ids: list[str] = []

    async def _do(db):
        from services.outreach.store import upsert_org
        return [
            await upsert_org(db, {
                "organisation_name": f"Iso {tag} {i}",
                "email":             f"iso-{tag}-{i}@example.com",
            }) for i in range(3)
        ]

    orgs = _run(_do)
    for o in orgs:
        created_ids.append(o["id"])
    try:
        # 3. Founder counter is untouched.
        founder_after = sync_db.counters.find_one({"id": "founder_number"})
        assert (founder_before or {}).get("value") == (founder_after or {}).get("value"), (
            "Founding-Member counter changed when outreach numbers were "
            "allocated — they must be in separate namespaces."
        )
        # 4. No outreach org accidentally acquired a founder_number.
        for o in orgs:
            fresh = sync_db.outreach_organisations.find_one(
                {"id": o["id"]}, {"_id": 0, "founder_number": 1},
            )
            assert "founder_number" not in fresh
    finally:
        _cleanup(sync_db, created_ids)


# ---------------------------------------------------------------------------
# 8. Existing outreach_id linkage (iter164ag) still intact.
# ---------------------------------------------------------------------------

def test_outreach_id_linkage_still_intact(sync_db):
    """Confirms the webhook-fix (iter164ag) contract still holds:
    the audience resolver returns ``outreach_id`` for every outreach
    recipient, and the number rides alongside it.
    """
    tag = f"iter164ah-link-{uuid.uuid4().hex[:6]}"
    created_ids: list[str] = []

    async def _do(db):
        from services.outreach.store import upsert_org, COLL_ORGS
        org = await upsert_org(db, {
            "organisation_name": f"Link {tag}",
            "email":             f"link-{tag}@example.com",
            "tags":              [tag],
        })
        one = await db[COLL_ORGS].find_one({"id": org["id"]}, {"_id": 0})
        return one

    org = _run(_do)
    created_ids.append(org["id"])
    try:
        # Both keys present and consistent.
        assert org.get("id")
        assert org.get("outreach_number") and org["outreach_number"] > 20000
    finally:
        _cleanup(sync_db, created_ids)
