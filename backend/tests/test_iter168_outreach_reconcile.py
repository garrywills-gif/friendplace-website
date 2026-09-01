"""Iter168 — Outreach reconciliation script safety net.

The ``scripts/outreach_reconcile.py`` script is the ONLY code path that
seeds ``cms_organisations`` from adjacent collections. Its filters are
deliberately conservative — but conservative filters only earn their
keep if we prove them with tests. This suite locks in:

    • Rejected event submissions never leak in.
    • QA "test" reviewer notes never leak in.
    • Obvious synthetic emails (@example.com, TEST_ prefix, etc.)
      never leak in.
    • Legit rows DO come through and dedupe correctly against any
      pre-existing ``cms_organisations`` row (by email + by name).
    • Send evidence in ``email_test_log`` bumps status → contacted.
    • Idempotency: running twice never duplicates.

Uses a scratch DB namespace so it never touches real collections.
"""
from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
import pytest_asyncio
from motor.motor_asyncio import AsyncIOMotorClient

import sys
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from scripts import outreach_reconcile as R  # noqa: E402


MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@pytest_asyncio.fixture
async def scratch_env(monkeypatch):
    """Spin up an isolated Mongo database per test so parallel/repeat
    runs never clash. Restore env at teardown."""
    scratch_name = f"iter168_outreach_recon_{uuid.uuid4().hex[:8]}"
    monkeypatch.setenv("MONGO_URL", MONGO_URL)
    monkeypatch.setenv("DB_NAME", scratch_name)
    cli = AsyncIOMotorClient(MONGO_URL)
    try:
        yield cli[scratch_name]
    finally:
        await cli.drop_database(scratch_name)
        cli.close()


async def _seed_event_submissions(db):
    """Mix of legit + test + rejected rows."""
    await db.cms_event_submissions.insert_many([
        # 1. Legit approved
        {"id": "sub-legit-1",
         "submission_ref": "FP-SUB-LEGIT",
         "organisation_name": "Turramurra Community Centre",
         "contact_name": "Sara Nguyen",
         "contact_email": "events@turramurra.org.au",
         "contact_phone": "02 8888 1111",
         "status": "approved",
         "reviewer_notes": None,
         "created_at": _iso()},
        # 2. Rejected
        {"id": "sub-rejected-1",
         "submission_ref": "FP-SUB-REJ",
         "organisation_name": "North Ryde RSL",
         "contact_email": "hello@friendplace.com.au",
         "status": "rejected",
         "reviewer_notes": "testing the reject button",
         "created_at": _iso()},
        # 3. Test-flavoured name
        {"id": "sub-ping",
         "organisation_name": "Ping",
         "contact_email": "ping@example.com",
         "status": "approved",
         "created_at": _iso()},
        # 4. Test-flavoured reviewer note
        {"id": "sub-smoke",
         "organisation_name": "Smoke Test Co",
         "contact_email": "smoke@nowhere.local",
         "status": "approved",
         "reviewer_notes": "test smoke, please ignore",
         "created_at": _iso()},
    ])


async def _seed_email_history(db, email: str):
    await db.email_test_log.insert_one({
        "message_id": "hist-msg-1",
        "template": "invitation",
        "recipient": email,
        "subject": "Would you like to host a FriendPlace event?",
        "sent_at": "2026-08-15T09:00:00+00:00",
        "created_at": "2026-08-15T09:00:00+00:00",
        "mode": "real",
    })


@pytest.mark.asyncio
async def test_dry_run_reports_only_legit_candidate(scratch_env):
    await _seed_event_submissions(scratch_env)
    report = await R.reconcile(commit=False, verbose=False)
    assert report["candidates"]["total"] == 1, report["candidates"]
    assert report["reconciled"]["net_new"] == 1
    assert report["reconciled"]["created"] == 0, "dry run must not write"
    assert report["after"]["cms_organisations_total"] == 0


@pytest.mark.asyncio
async def test_commit_creates_only_legit_rows(scratch_env):
    await _seed_event_submissions(scratch_env)
    report = await R.reconcile(commit=True, verbose=False)
    assert report["reconciled"]["created"] == 1
    total = await scratch_env.cms_organisations.count_documents({})
    assert total == 1
    row = await scratch_env.cms_organisations.find_one({}, {"_id": 0})
    assert row["name"] == "Turramurra Community Centre"
    assert row["contact_email"] == "events@turramurra.org.au"
    assert row["status"] == "not_contacted"
    assert row["reconciled_from"]["collection"] == "cms_event_submissions"


@pytest.mark.asyncio
async def test_send_history_marks_contacted(scratch_env):
    await _seed_event_submissions(scratch_env)
    await _seed_email_history(scratch_env, "events@turramurra.org.au")
    report = await R.reconcile(commit=True, verbose=False)
    assert report["reconciled"]["created"] == 1
    row = await scratch_env.cms_organisations.find_one({}, {"_id": 0})
    assert row["status"] == "contacted"
    assert row["last_contact_at"] == "2026-08-15T09:00:00+00:00"
    assert len(row["communications"]) == 1
    assert row["communications"][0]["kind"] == "reconciled_send_evidence"


@pytest.mark.asyncio
async def test_idempotent_run_never_duplicates(scratch_env):
    await _seed_event_submissions(scratch_env)
    await R.reconcile(commit=True, verbose=False)
    await R.reconcile(commit=True, verbose=False)
    total = await scratch_env.cms_organisations.count_documents({})
    assert total == 1, f"reconciliation duplicated rows on 2nd run: {total}"


@pytest.mark.asyncio
async def test_dedupe_against_existing_by_name_and_email(scratch_env):
    # Pre-existing row with same email
    await scratch_env.cms_organisations.insert_one({
        "id": "existing-1",
        "name": "Turramurra Community Centre",
        "contact_email": "events@turramurra.org.au",
        "status": "replied",
        "archived": False,
        "created_at": _iso(),
    })
    await _seed_event_submissions(scratch_env)
    report = await R.reconcile(commit=True, verbose=False)
    assert report["reconciled"]["created"] == 0
    assert report["reconciled"]["existing_skipped"] == 1
    # Existing status must not be regressed
    existing = await scratch_env.cms_organisations.find_one({"id": "existing-1"})
    assert existing["status"] == "replied"


@pytest.mark.asyncio
async def test_synthetic_email_when_source_missing(scratch_env):
    await scratch_env.cms_event_submissions.insert_one({
        "id": "sub-no-email",
        "organisation_name": "Manly RSL",
        "contact_email": "",  # missing
        "status": "approved",
        "created_at": _iso(),
    })
    report = await R.reconcile(commit=True, verbose=False)
    assert report["reconciled"]["created"] == 1
    row = await scratch_env.cms_organisations.find_one({}, {"_id": 0})
    assert row["name"] == "Manly RSL"
    assert row["contact_email"].endswith("@no-email.reconciled.local")


@pytest.mark.asyncio
async def test_existing_org_without_contact_gets_bumped_by_send_history(scratch_env):
    """A row already in cms_organisations with status=not_contacted must
    be moved to ``contacted`` if email evidence exists in
    ``email_test_log``."""
    await scratch_env.cms_organisations.insert_one({
        "id": "old-1",
        "name": "Ryde Library",
        "contact_email": "librarian@ryde.nsw.gov.au",
        "status": "not_contacted",
        "archived": False,
        "communications": [],
        "created_at": _iso(),
    })
    await _seed_email_history(scratch_env, "librarian@ryde.nsw.gov.au")
    report = await R.reconcile(commit=True, verbose=False)
    row = await scratch_env.cms_organisations.find_one({"id": "old-1"}, {"_id": 0})
    assert row["status"] == "contacted"
    assert row["last_contact_at"] == "2026-08-15T09:00:00+00:00"
    assert any(c.get("kind") == "reconciled_send_evidence" for c in row["communications"])
    assert report["contact_bumps"]["marked_contacted"] >= 1
