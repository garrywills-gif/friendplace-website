"""iter164az — Outreach restore/unarchive endpoint fix.

The MCGS frontend calls POST /api/cms/outreach/organisations/{id}/unarchive
to restore an archived organisation. The backend only exposed /restore,
so the call 404'd and nothing was restored. This verifies the /unarchive
alias restores the record to the active list while preserving id, status
and contact history, and that it is idempotent.
"""

from __future__ import annotations

import os
import uuid

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


def _list_ids(auth, archived):
    r = requests.get(
        f"{BASE}/cms/outreach/organisations?archived={'true' if archived else 'false'}&limit=2000",
        headers=auth)
    r.raise_for_status()
    return {o["id"] for o in r.json()["organisations"]}


@pytest.fixture
def archived_org(db):
    oid = str(uuid.uuid4())
    doc = {
        "id": oid,
        "organisation_name": f"Archived Library {uuid.uuid4().hex[:6]}",
        "contact_name": "Pat Jones",
        "email": f"{uuid.uuid4().hex[:10]}@example.com",
        "phone": "0400000000", "category": "library_council",
        "tags": ["library_council"], "suburb": "Sydney", "state": "NSW",
        "notes": "NSW Library service", "status": "not_contacted",
        "is_test": False,
        "communications": [{"kind": "note", "at": "2026-09-01T00:00:00Z", "body": "history entry"}],
        "outreach_number": 29999,
        "archived_at": "2026-09-01T00:00:00Z", "archived_by": "admin@x",
        "created_at": "2026-08-01T00:00:00Z", "updated_at": "2026-09-01T00:00:00Z",
    }
    db.outreach_organisations.insert_one(doc)
    yield doc
    db.outreach_organisations.delete_one({"id": oid})


def test_unarchive_restores_to_active(db, auth, archived_org):
    oid = archived_org["id"]
    # Precondition: shows in archived, not in active.
    assert oid in _list_ids(auth, archived=True)
    assert oid not in _list_ids(auth, archived=False)

    r = requests.post(
        f"{BASE}/cms/outreach/organisations/{oid}/unarchive", headers=auth)
    assert r.status_code == 200, r.text

    # Now: gone from archived, present in active.
    assert oid not in _list_ids(auth, archived=True)
    assert oid in _list_ids(auth, archived=False)

    # Data preserved: id, status, history, number, contact all intact.
    doc = db.outreach_organisations.find_one({"id": oid}, {"_id": 0})
    assert doc["archived_at"] is None
    assert doc["status"] == "not_contacted"
    assert doc["contact_name"] == "Pat Jones"
    assert doc["outreach_number"] == 29999
    assert doc["communications"][0]["body"] == "history entry"


def test_unarchive_idempotent(db, auth, archived_org):
    oid = archived_org["id"]
    r1 = requests.post(f"{BASE}/cms/outreach/organisations/{oid}/unarchive", headers=auth)
    r2 = requests.post(f"{BASE}/cms/outreach/organisations/{oid}/unarchive", headers=auth)
    assert r1.status_code == 200 and r2.status_code == 200, (r1.text, r2.text)
    assert oid in _list_ids(auth, archived=False)


def test_restore_alias_still_works(db, auth, archived_org):
    oid = archived_org["id"]
    r = requests.post(f"{BASE}/cms/outreach/organisations/{oid}/restore", headers=auth)
    assert r.status_code == 200, r.text
    assert oid in _list_ids(auth, archived=False)


def test_unarchive_unknown_is_404(auth):
    r = requests.post(
        f"{BASE}/cms/outreach/organisations/{uuid.uuid4()}/unarchive", headers=auth)
    assert r.status_code == 404, r.text
