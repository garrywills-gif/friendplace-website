"""iter164aw — persist enquiry lifecycle status server-side.

Replaces George's browser-local "handled" workaround
(lib/enquiry-handled.ts, localStorage key
`friendplace:handled-enquiries:v1`) with a durable backend field so
read/replied/resolved state survives refreshes, other browsers/devices,
cache clears and republishes.

Endpoint:
  PATCH /api/cms/enquiries/{kind}/{id}/status
    body { "status": "new" | "read" | "replied" | "resolved" }
  -> { ok, kind, id, status, read_at, replied_at, resolved_at,
       status_updated_at, status_updated_by }

Rules:
  * status vocabulary: new / read / replied / resolved (else 400)
  * unknown kind -> 400, missing row -> 404
  * writes status + matching lifecycle timestamp (read_at/replied_at/
    resolved_at, stamped once) + status_updated_at/_by; nothing else
  * a contact moved off "new" drops off the unread-count badge —
    permanently, not just in the browser
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

BASE = "http://localhost:8001/api"
ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASSWORD = "TestPass2026!"


@pytest.fixture(scope="module")
def db():
    load_dotenv("/app/backend/.env")
    client = MongoClient(os.environ["MONGO_URL"])
    yield client[os.environ.get("DB_NAME", "test_database")]
    client.close()


@pytest.fixture(scope="module")
def auth():
    r = requests.post(f"{BASE}/cms/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _unread(auth):
    r = requests.get(f"{BASE}/cms/enquiries/unread-count", headers=auth)
    r.raise_for_status()
    return r.json()["count"]


def test_status_lifecycle_persists_and_stamps(db, auth):
    tag = f"iter164aw-{uuid.uuid4().hex[:8]}"
    cid = f"contact-{tag}"
    db.contact_submissions.insert_one({
        "id": cid, "name": "Lifecycle", "email": f"{tag}@x.com",
        "subject": "Hi", "message": "hello", "status": "new",
        "is_test": False, "created_at": _now(),
    })
    try:
        # new -> read
        r = requests.patch(f"{BASE}/cms/enquiries/contact/{cid}/status",
                           json={"status": "read"}, headers=auth)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["status"] == "read" and b["read_at"]
        assert b["status_updated_by"] == ADMIN_EMAIL
        first_read_at = b["read_at"]

        # read -> replied (read_at preserved, replied_at stamped)
        r = requests.patch(f"{BASE}/cms/enquiries/contact/{cid}/status",
                           json={"status": "replied"}, headers=auth)
        b = r.json()
        assert b["status"] == "replied" and b["replied_at"]
        assert b["read_at"] == first_read_at, "earlier read_at must be preserved"

        # replied -> resolved
        r = requests.patch(f"{BASE}/cms/enquiries/contact/{cid}/status",
                           json={"status": "resolved"}, headers=auth)
        b = r.json()
        assert b["status"] == "resolved" and b["resolved_at"]

        # Persisted in DB (survives refresh/device/republish).
        doc = db.contact_submissions.find_one({"id": cid}, {"_id": 0})
        assert doc["status"] == "resolved"
        assert doc["read_at"] and doc["replied_at"] and doc["resolved_at"]
    finally:
        db.contact_submissions.delete_one({"id": cid})


def test_status_change_updates_badge_permanently(db, auth):
    tag = f"iter164aw-badge-{uuid.uuid4().hex[:8]}"
    cid = f"contact-{tag}"
    db.contact_submissions.insert_one({
        "id": cid, "name": "Badge", "email": f"{tag}@x.com",
        "status": "new", "is_test": False, "created_at": _now(),
    })
    try:
        before = _unread(auth)
        db_count_new = db.contact_submissions.count_documents({"id": cid, "status": "new"})
        assert db_count_new == 1
        # Mark read -> drops off the badge.
        requests.patch(f"{BASE}/cms/enquiries/contact/{cid}/status",
                       json={"status": "read"}, headers=auth)
        assert _unread(auth) == before - 1
        # Back to new -> counts again.
        requests.patch(f"{BASE}/cms/enquiries/contact/{cid}/status",
                       json={"status": "new"}, headers=auth)
        assert _unread(auth) == before
    finally:
        db.contact_submissions.delete_one({"id": cid})


def test_works_across_all_kinds(db, auth):
    tag = f"iter164aw-kinds-{uuid.uuid4().hex[:8]}"
    seeded = {
        "contact":  ("contact_submissions", {"id": f"c-{tag}"}),
        "interest": ("interest_registrations", {"id": f"i-{tag}"}),
        "support":  ("support_tickets", {"id": f"s-{tag}", "ref": f"FP-{tag}"}),
        "report":   ("reports", {"id": f"r-{tag}"}),
        "waitlist": ("waitlist", {"id": f"w-{tag}"}),
    }
    for kind, (coll, extra) in seeded.items():
        db[coll].insert_one({**extra, "email": f"{kind}-{tag}@x.com",
                             "status": "new", "is_test": False, "created_at": _now()})
    try:
        for kind, (coll, extra) in seeded.items():
            ident = extra.get("ref", extra["id"]) if kind == "support" else extra["id"]
            r = requests.patch(f"{BASE}/cms/enquiries/{kind}/{ident}/status",
                               json={"status": "read"}, headers=auth)
            assert r.status_code == 200, f"{kind}: {r.text}"
            doc = db[coll].find_one({"id": extra["id"]}, {"_id": 0})
            assert doc["status"] == "read" and doc["read_at"]
    finally:
        for _kind, (coll, extra) in seeded.items():
            db[coll].delete_one({"id": extra["id"]})


def test_invalid_status_and_kind_and_missing(auth):
    # invalid status
    r = requests.patch(f"{BASE}/cms/enquiries/contact/whatever/status",
                       json={"status": "banana"}, headers=auth)
    assert r.status_code == 400
    # unknown kind
    r = requests.patch(f"{BASE}/cms/enquiries/banana/x/status",
                       json={"status": "read"}, headers=auth)
    assert r.status_code == 400
    # missing record
    r = requests.patch(f"{BASE}/cms/enquiries/contact/does-not-exist/status",
                       json={"status": "read"}, headers=auth)
    assert r.status_code == 404
