"""iter164ao — Mission Control Contact-only unread count.

Contract:
  GET /api/cms/enquiries/unread-count -> {"count": <int>}

  Counts ONLY brand-new Contact-form enquiries:
    * kind == contact (i.e. lives in `contact_submissions`)
    * status == "new" (missing/empty status treated as new, matching
      the unified Enquiries list)

  Must NOT count:
    * Register Interest / interest (`interest_registrations`)
    * support, report, waitlist
    * resolved / replied contact enquiries
    * test fixtures (is_test)

These tests exercise the exact Mongo query the endpoint runs so the
behaviour is verified deterministically without HTTP auth plumbing.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

import pytest
from dotenv import load_dotenv
from pymongo import MongoClient


@pytest.fixture(scope="module")
def db():
    load_dotenv("/app/backend/.env")
    client = MongoClient(os.environ["MONGO_URL"])
    yield client[os.environ.get("DB_NAME", "test_database")]
    client.close()


# The exact filter cms_module's /enquiries/unread-count endpoint uses.
_UNREAD_Q = {
    "is_test": {"$ne": True},
    "$or": [
        {"status": "new"},
        {"status": {"$in": [None, ""]}},
        {"status": {"$exists": False}},
    ],
}


def _count(db) -> int:
    return db.contact_submissions.count_documents(_UNREAD_Q)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def test_new_contact_increments_interest_does_not(db):
    tag = f"iter164ao-{uuid.uuid4().hex[:8]}"
    contact_id = f"c-{tag}"
    interest_id = f"i-{tag}"
    try:
        before = _count(db)

        # A brand-new Register Interest registration must NOT move the count.
        db.interest_registrations.insert_one({
            "id": interest_id,
            "first_name": "Pat",
            "email": f"pat-{tag}@example.com",
            "status": "new",
            "is_test": False,
            "created_at": _now(),
        })
        after_interest = _count(db)
        assert after_interest == before, (
            "Register Interest must not affect the Contact unread count"
        )

        # A brand-new Contact-form enquiry MUST increment the count by 1.
        db.contact_submissions.insert_one({
            "id": contact_id,
            "name": "Alex Real",
            "email": f"alex-{tag}@example.com",
            "subject": "Hello",
            "message": "A genuine enquiry",
            "status": "new",
            "is_test": False,
            "created_at": _now(),
        })
        after_contact = _count(db)
        assert after_contact == before + 1, (
            "A new Contact enquiry must increment the unread count by exactly 1"
        )
    finally:
        db.contact_submissions.delete_one({"id": contact_id})
        db.interest_registrations.delete_one({"id": interest_id})


def test_replied_and_resolved_contacts_not_counted(db):
    tag = f"iter164ao-r-{uuid.uuid4().hex[:8]}"
    ids = [f"replied-{tag}", f"archived-{tag}", f"read-{tag}"]
    try:
        before = _count(db)
        db.contact_submissions.insert_many([
            {"id": ids[0], "name": "R", "email": f"r-{tag}@x.com",
             "status": "replied", "is_test": False, "created_at": _now()},
            {"id": ids[1], "name": "A", "email": f"a-{tag}@x.com",
             "status": "archived", "is_test": False, "created_at": _now()},
            {"id": ids[2], "name": "D", "email": f"d-{tag}@x.com",
             "status": "read", "is_test": False, "created_at": _now()},
        ])
        after = _count(db)
        assert after == before, (
            "replied/archived/read contacts must not be counted as unread"
        )
    finally:
        db.contact_submissions.delete_many({"id": {"$in": ids}})


def test_missing_status_counts_as_new(db):
    tag = f"iter164ao-m-{uuid.uuid4().hex[:8]}"
    cid = f"nostatus-{tag}"
    try:
        before = _count(db)
        # No status field at all — the unified list renders it "new",
        # so the count must include it.
        db.contact_submissions.insert_one({
            "id": cid,
            "name": "No Status",
            "email": f"nostatus-{tag}@x.com",
            "is_test": False,
            "created_at": _now(),
        })
        after = _count(db)
        assert after == before + 1
    finally:
        db.contact_submissions.delete_one({"id": cid})


def test_test_fixtures_not_counted(db):
    tag = f"iter164ao-t-{uuid.uuid4().hex[:8]}"
    cid = f"fixture-{tag}"
    try:
        before = _count(db)
        db.contact_submissions.insert_one({
            "id": cid,
            "name": "TEST_fixture",
            "email": f"fixture-{tag}@example.com",
            "status": "new",
            "is_test": True,          # fixture -> excluded
            "created_at": _now(),
        })
        after = _count(db)
        assert after == before, "is_test fixtures must never be counted"
    finally:
        db.contact_submissions.delete_one({"id": cid})
