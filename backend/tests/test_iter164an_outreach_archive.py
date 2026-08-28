"""iter164an — Outreach soft-archive / restore tests.

Contract:

  * ``archived_at`` (nullable ISO timestamp) + optional ``archived_by``
    are the only new fields. Existing records with no field are ACTIVE.
  * ``list_orgs`` defaults to active-only; ``archived=True`` returns the
    archived set.
  * ``archive_org`` sets ``archived_at`` WITHOUT touching anything else —
    communications history, notes, delivery/reply dates and the
    permanent ``outreach_number`` are all preserved.
  * ``restore_org`` clears ``archived_at`` so the org is active again.
  * Archived orgs are excluded from campaign audience resolution
    (preview counts + bulk sends); restore makes them eligible again.
  * No hard-delete of historical campaign_recipients rows.

Endpoints (for the frontend to wire without guessing):
  GET  /api/cms/outreach/organisations?archived=false   (default active)
  GET  /api/cms/outreach/organisations?archived=true     (archived only)
  POST /api/cms/outreach/organisations/{id}/archive       -> updated org
  POST /api/cms/outreach/organisations/{id}/restore       -> updated org
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


# The exact query cms_module._resolve_audience builds for the
# outreach_contacts kind (iter164an added the archived_at guard).
def _audience_query(extra: dict | None = None) -> dict:
    q = {"is_test": {"$ne": True}, "archived_at": None}
    if extra:
        q.update(extra)
    return q


# ---------------------------------------------------------------------------
# 1. Active-default list excludes archived; archived=True returns them.
# ---------------------------------------------------------------------------

def test_list_active_default_and_archived_filter(sync_db):
    tag = f"iter164an-list-{uuid.uuid4().hex[:6]}"
    created_ids: list[str] = []

    async def _do(db):
        from services.outreach.store import upsert_org, archive_org, list_orgs
        active = await upsert_org(db, {
            "organisation_name": f"Active {tag}",
            "email":             f"active-{tag}@example.com",
            "tags":              [tag],
        })
        archived = await upsert_org(db, {
            "organisation_name": f"Archived {tag}",
            "email":             f"archived-{tag}@example.com",
            "tags":              [tag],
        })
        await archive_org(db, archived["id"], archived_by="tester@fp.com")

        default_list = await list_orgs(db, tags_any=[tag])           # active only
        archived_list = await list_orgs(db, tags_any=[tag], archived=True)
        return active, archived, default_list, archived_list

    active, archived, default_list, archived_list = _run(_do)
    created_ids.extend([active["id"], archived["id"]])
    try:
        default_ids = {r["id"] for r in default_list}
        archived_ids = {r["id"] for r in archived_list}
        assert active["id"] in default_ids
        assert archived["id"] not in default_ids
        assert archived["id"] in archived_ids
        assert active["id"] not in archived_ids
    finally:
        _cleanup(sync_db, created_ids)


# ---------------------------------------------------------------------------
# 2. Pre-migration records (no archived_at field) are active by default.
# ---------------------------------------------------------------------------

def test_legacy_records_without_field_are_active(sync_db):
    tag = f"iter164an-legacy-{uuid.uuid4().hex[:6]}"
    oid = str(uuid.uuid4())
    created_ids = [oid]
    # Insert directly WITHOUT archived_at, mimicking a pre-migration row.
    sync_db.outreach_organisations.insert_one({
        "id":                oid,
        "organisation_name": f"Legacy {tag}",
        "email":             f"legacy-{tag}@example.com",
        "tags":              [tag],
        "is_test":           False,
        "created_at":        "2026-01-01T00:00:00Z",
        "updated_at":        "2026-01-01T00:00:00Z",
    })
    try:
        async def _do(db):
            from services.outreach.store import list_orgs
            return await list_orgs(db, tags_any=[tag])
        rows = _run(_do)
        assert oid in {r["id"] for r in rows}, (
            "records with no archived_at field must be active by default"
        )
        # And the audience query (archived_at: None) matches it too.
        assert sync_db.outreach_organisations.count_documents(
            _audience_query({"tags": {"$in": [tag]}})
        ) == 1
    finally:
        _cleanup(sync_db, created_ids)


# ---------------------------------------------------------------------------
# 3. Archive preserves the entire document + history.
# ---------------------------------------------------------------------------

def test_archive_preserves_history(sync_db):
    tag = f"iter164an-hist-{uuid.uuid4().hex[:6]}"
    created_ids: list[str] = []

    async def _do(db):
        from services.outreach.store import (
            upsert_org, log_communication, mark_replied, touch_last_contact,
            archive_org, get_org,
        )
        org = await upsert_org(db, {
            "organisation_name": f"Hist {tag}",
            "email":             f"hist-{tag}@example.com",
            "contact_name":      "Jane Doe",
            "notes":             "Important prospect",
            "tags":              [tag],
        })
        # Build up history: outbound send, inbound reply, a note.
        await touch_last_contact(
            db, email=f"hist-{tag}@example.com",
            campaign_id="camp-1", subject="Hello", send_id="send-1",
        )
        await mark_replied(
            db, org_id=org["id"], subject="Re: Hello",
            body="Sounds good", direction="inbound",
        )
        await log_communication(db, org_id=org["id"], kind="note", body="Called them")
        before = await get_org(db, org["id"])

        archived = await archive_org(db, org["id"], archived_by="tester@fp.com")
        after = await get_org(db, org["id"])
        return before, archived, after

    before, archived, after = _run(_do)
    created_ids.append(before["id"])
    try:
        # archived_at / archived_by set correctly.
        assert archived["archived_at"]
        assert archived["archived_by"] == "tester@fp.com"
        # Everything else preserved verbatim.
        assert after["outreach_number"] == before["outreach_number"]
        assert after["notes"] == before["notes"]
        assert after["contact_name"] == before["contact_name"]
        assert after["last_contact_at"] == before["last_contact_at"]
        assert after["last_reply_at"] == before["last_reply_at"]
        assert after["created_at"] == before["created_at"]
        # Full communications timeline intact (3 entries).
        assert len(after["communications"]) == len(before["communications"]) == 3
        kinds = [c["kind"] for c in after["communications"]]
        assert "outbound" in kinds
        assert "reply_inbound" in kinds
        assert "note" in kinds
    finally:
        _cleanup(sync_db, created_ids)


# ---------------------------------------------------------------------------
# 4. Restore clears archived_at and keeps the document intact.
# ---------------------------------------------------------------------------

def test_restore_reactivates(sync_db):
    tag = f"iter164an-restore-{uuid.uuid4().hex[:6]}"
    created_ids: list[str] = []

    async def _do(db):
        from services.outreach.store import (
            upsert_org, archive_org, restore_org, list_orgs,
        )
        org = await upsert_org(db, {
            "organisation_name": f"Restore {tag}",
            "email":             f"restore-{tag}@example.com",
            "tags":              [tag],
        })
        await archive_org(db, org["id"])
        after_archive = await list_orgs(db, tags_any=[tag])          # active
        restored = await restore_org(db, org["id"])
        after_restore = await list_orgs(db, tags_any=[tag])          # active
        return org, after_archive, restored, after_restore

    org, after_archive, restored, after_restore = _run(_do)
    created_ids.append(org["id"])
    try:
        assert org["id"] not in {r["id"] for r in after_archive}
        assert restored["archived_at"] is None
        assert restored["archived_by"] is None
        assert org["id"] in {r["id"] for r in after_restore}
        # outreach_number survived the archive→restore cycle.
        assert restored["outreach_number"] == org["outreach_number"]
    finally:
        _cleanup(sync_db, created_ids)


# ---------------------------------------------------------------------------
# 5. Campaign audience excludes archived; restore re-includes.
# ---------------------------------------------------------------------------

def test_campaign_audience_excludes_archived(sync_db):
    tag = f"iter164an-aud-{uuid.uuid4().hex[:6]}"
    created_ids: list[str] = []

    async def _do(db):
        from services.outreach.store import upsert_org, archive_org, restore_org
        a = await upsert_org(db, {"organisation_name": f"Aud A {tag}",
                                   "email": f"aud-a-{tag}@example.com",
                                   "tags": [tag]})
        b = await upsert_org(db, {"organisation_name": f"Aud B {tag}",
                                   "email": f"aud-b-{tag}@example.com",
                                   "tags": [tag]})
        # Archive B.
        await archive_org(db, b["id"])
        return a, b

    a, b = _run(_do)
    created_ids.extend([a["id"], b["id"]])
    try:
        # Audience count (the query the resolver / preview / bulk send uses).
        cnt = sync_db.outreach_organisations.count_documents(
            _audience_query({"tags": {"$in": [tag]}})
        )
        assert cnt == 1, "archived org must be excluded from audience"
        ids_in = {
            r["id"] for r in sync_db.outreach_organisations.find(
                _audience_query({"tags": {"$in": [tag]}}), {"_id": 0, "id": 1}
            )
        }
        assert a["id"] in ids_in
        assert b["id"] not in ids_in

        # Restore B -> eligible again.
        _run(lambda db: __import__(
            "services.outreach.store", fromlist=["restore_org"]
        ).restore_org(db, b["id"]))
        cnt2 = sync_db.outreach_organisations.count_documents(
            _audience_query({"tags": {"$in": [tag]}})
        )
        assert cnt2 == 2, "restored org must be eligible for audience again"
    finally:
        _cleanup(sync_db, created_ids)


# ---------------------------------------------------------------------------
# 6. Historical campaign_recipients rows are never hard-deleted on archive.
# ---------------------------------------------------------------------------

def test_archive_does_not_touch_campaign_recipients(sync_db):
    tag = f"iter164an-recip-{uuid.uuid4().hex[:6]}"
    created_ids: list[str] = []
    recip_id = "recip-" + tag

    async def _do(db):
        from services.outreach.store import upsert_org, archive_org
        org = await upsert_org(db, {"organisation_name": f"Recip {tag}",
                                     "email": f"recip-{tag}@example.com",
                                     "tags": [tag]})
        return org

    org = _run(_do)
    created_ids.append(org["id"])
    # Simulate a historical sent recipient row for this org.
    sync_db.campaign_recipients.insert_one({
        "id":              recip_id,
        "campaign_id":     "camp-" + tag,
        "email":           f"recip-{tag}@example.com",
        "audience_kind":   "outreach_contacts",
        "outreach_id":     org["id"],
        "outreach_number": org["outreach_number"],
        "status":          "sent",
    })
    try:
        _run(lambda db: __import__(
            "services.outreach.store", fromlist=["archive_org"]
        ).archive_org(db, org["id"]))
        # The historical recipient row still exists untouched.
        row = sync_db.campaign_recipients.find_one({"id": recip_id}, {"_id": 0})
        assert row is not None, "archive must not delete campaign_recipients"
        assert row["outreach_number"] == org["outreach_number"]
        assert row["status"] == "sent"
    finally:
        sync_db.campaign_recipients.delete_one({"id": recip_id})
        _cleanup(sync_db, created_ids)


# ---------------------------------------------------------------------------
# 7. Archive is idempotent (preserves the original archived_at).
# ---------------------------------------------------------------------------

def test_archive_idempotent(sync_db):
    tag = f"iter164an-idem-{uuid.uuid4().hex[:6]}"
    created_ids: list[str] = []

    async def _do(db):
        from services.outreach.store import upsert_org, archive_org
        org = await upsert_org(db, {"organisation_name": f"Idem {tag}",
                                     "email": f"idem-{tag}@example.com"})
        first = await archive_org(db, org["id"])
        second = await archive_org(db, org["id"])
        return org, first, second

    org, first, second = _run(_do)
    created_ids.append(org["id"])
    try:
        assert first["archived_at"] == second["archived_at"], (
            "re-archiving must preserve the original archived_at timestamp"
        )
    finally:
        _cleanup(sync_db, created_ids)


# ---------------------------------------------------------------------------
# 8. archive/restore on a missing org returns None (router -> 404).
# ---------------------------------------------------------------------------

def test_archive_restore_missing_returns_none(sync_db):
    async def _do(db):
        from services.outreach.store import archive_org, restore_org
        a = await archive_org(db, "does-not-exist")
        b = await restore_org(db, "does-not-exist")
        return a, b
    a, b = _run(_do)
    assert a is None
    assert b is None
