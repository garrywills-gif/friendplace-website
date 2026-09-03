"""iter164ay — NSW library reclassification + safe bulk group delete.

Backend contract:
  * POST /api/cms/outreach/maintenance/reclassify-libraries
      Moves ACTIVE, untouched (not_contacted), Library-in-notes rows out
      of community_organisation into library_council. Idempotent. Never
      touches other Community Organisations. Returns counts.
  * DELETE /api/cms/outreach/groups/{category}
      Bulk-deletes every ACTIVE org in a category in ONE operation, but
      only when every org is not_contacted. Refuses (409) otherwise.
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


def _org(tag, name, *, category, status="not_contacted", notes="",
         archived=False, is_test=False, email=None):
    return {
        "id": str(uuid.uuid4()),
        "organisation_name": f"{name} {tag}",
        "contact_name": "",
        "email": email or f"{uuid.uuid4().hex[:10]}@example.com",
        "phone": "", "category": category, "tags": [category],
        "suburb": "", "state": "NSW", "notes": notes, "status": status,
        "is_test": is_test,
        "archived_at": None if not archived else "2026-09-01T00:00:00Z",
        "created_at": "2026-09-02T00:00:00Z", "updated_at": "2026-09-02T00:00:00Z",
    }


# ---------------------------------------------------------------------------
# Reclassification
# ---------------------------------------------------------------------------

def test_reclassify_libraries(db, auth):
    tag = f"iter164ay-recl-{uuid.uuid4().hex[:8]}"
    docs = []
    # 20 NSW libraries wrongly filed under community_organisation.
    for i in range(20):
        docs.append(_org(tag, f"City Library {i}", category="community_organisation",
                         status="not_contacted", notes=f"NSW Library service #{i}"))
    # Decoys that MUST NOT move:
    decoy_plain = _org(tag, "Neighbourhood House", category="community_organisation",
                       status="not_contacted", notes="A community centre")
    decoy_contacted = _org(tag, "Old Library Friends", category="community_organisation",
                           status="contacted", notes="Library history but already contacted")
    docs.extend([decoy_plain, decoy_contacted])
    db.outreach_organisations.insert_many(docs)
    ids = [d["id"] for d in docs]
    try:
        r = requests.post(f"{BASE}/cms/outreach/maintenance/reclassify-libraries", headers=auth)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["matched"] == 20, body
        assert body["reclassified"] == 20, body

        # DB proof: exactly the 20 moved; decoys untouched.
        moved = list(db.outreach_organisations.find(
            {"id": {"$in": ids}, "category": "library_council"}, {"_id": 0, "id": 1}))
        assert len(moved) == 20
        assert db.outreach_organisations.find_one({"id": decoy_plain["id"]})["category"] == "community_organisation"
        assert db.outreach_organisations.find_one({"id": decoy_contacted["id"]})["category"] == "community_organisation"

        # Idempotent: a second run moves nothing more.
        r2 = requests.post(f"{BASE}/cms/outreach/maintenance/reclassify-libraries", headers=auth)
        assert r2.status_code == 200
        assert r2.json()["reclassified"] == 0
    finally:
        db.outreach_organisations.delete_many({"id": {"$in": ids}})


# ---------------------------------------------------------------------------
# Safe bulk group delete
# ---------------------------------------------------------------------------

def test_delete_group_all_not_contacted(db, auth):
    cat = f"iter164ay_del_{uuid.uuid4().hex[:8]}"
    docs = [_org(cat, f"Org {i}", category=cat) for i in range(5)]
    # An archived + a test record in the same category must be untouched.
    archived = _org(cat, "Archived", category=cat, archived=True)
    testrec = _org(cat, "Test", category=cat, is_test=True)
    db.outreach_organisations.insert_many(docs + [archived, testrec])
    ids = [d["id"] for d in docs + [archived, testrec]]
    try:
        r = requests.delete(f"{BASE}/cms/outreach/groups/{cat}", headers=auth)
        assert r.status_code == 200, r.text
        assert r.json()["deleted"] == 5

        assert db.outreach_organisations.count_documents(
            {"id": {"$in": [d["id"] for d in docs]}}) == 0
        # archived + test survive
        assert db.outreach_organisations.find_one({"id": archived["id"]}) is not None
        assert db.outreach_organisations.find_one({"id": testrec["id"]}) is not None
    finally:
        db.outreach_organisations.delete_many({"id": {"$in": ids}})


def test_delete_group_blocked_when_contacted(db, auth):
    cat = f"iter164ay_blk_{uuid.uuid4().hex[:8]}"
    docs = [_org(cat, f"Org {i}", category=cat) for i in range(4)]
    docs.append(_org(cat, "Engaged", category=cat, status="replied"))
    db.outreach_organisations.insert_many(docs)
    ids = [d["id"] for d in docs]
    try:
        r = requests.delete(f"{BASE}/cms/outreach/groups/{cat}", headers=auth)
        assert r.status_code == 409, r.text
        # Nothing deleted — history preserved.
        assert db.outreach_organisations.count_documents({"id": {"$in": ids}}) == 5
    finally:
        db.outreach_organisations.delete_many({"id": {"$in": ids}})


def test_delete_group_empty_is_404(auth):
    r = requests.delete(f"{BASE}/cms/outreach/groups/nope_{uuid.uuid4().hex}", headers=auth)
    assert r.status_code == 404, r.text
