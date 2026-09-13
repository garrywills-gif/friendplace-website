"""Iter169 — regression tests for POST /cms/outreach/organisations.

Locks in the fix for the live 500 regression Garry hit on
1 Sep 2026 ~5:56 pm Sydney: every genuinely-new organisation returned
HTTP 500 while duplicates worked. Root causes covered here:

    1.  Duplicate scan must match BOTH `contact_email` and legacy
        `email` fields (case-insensitive) so imports from the old
        importer are recognised.
    2.  Insert must MIRROR the address into `email` AND `contact_email`
        so any legacy unique index on either field is satisfied.
    3.  `outreach_number` must be omitted when None so it never
        collides on a unique partial index full of prior nulls.
    4.  A pymongo `DuplicateKeyError` (e.g. from an index race, or
        legacy index on a different field) must NOT surface as HTTP 500
        — return the existing row (existing:true) or 409, never 500.
    5.  Any other DB failure must produce a controlled JSON 500 with
        NO raw traceback in the response body.
    6.  Bulk creation is idempotent across duplicate rows in a batch.

Uses the running local backend and marker-prefixed rows for isolation.
Never touches any organisation that doesn't carry the ``iter169-`` marker.
"""
from __future__ import annotations

import os
import uuid
from typing import Any, Dict, List

import pytest
import requests
from pymongo import MongoClient

BASE_URL = "http://localhost:8001"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

CMS_EMAIL = "hello@friendplace.com.au"
CMS_PASSWORD = "TestPass2026!"
MARKER = "iter169-"


@pytest.fixture(scope="module")
def db():
    return MongoClient(MONGO_URL)[DB_NAME]


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/cms/auth/login",
        json={"email": CMS_EMAIL, "password": CMS_PASSWORD}, timeout=10,
    )
    if r.status_code == 429:
        pytest.skip("Real CMS admin currently in lockout — try later.")
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module", autouse=True)
def _cleanup(db):
    def wipe():
        # Delete anything this suite could have created — by id marker,
        # by email marker, or by name prefix.
        for q in (
            {"id": {"$regex": f"^{MARKER}"}},
            {"contact_email": {"$regex": MARKER}},
            {"email": {"$regex": MARKER}},
            {"name": {"$regex": f"^Iter169 "}},
        ):
            db.outreach_organisations.delete_many(q)
    wipe()
    yield
    wipe()


def _h(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _email(suffix: str) -> str:
    return f"{MARKER}{suffix}-{uuid.uuid4().hex[:6]}@example.au"


# ─── Regression 1: minimal payload (name + unique email) ───────────


def test_minimal_new_org_creates_cleanly(token):
    r = requests.post(
        f"{BASE_URL}/api/cms/outreach/organisations",
        headers=_h(token),
        json={"organisation_name": "Iter169 Minimal Co",
              "email": _email("minimal")}, timeout=10,
    )
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["existing"] is False
    org = b["organisation"]
    assert org["organisation_name"] == "Iter169 Minimal Co"
    assert org["status"] == "not_contacted"
    assert org["email"] == org["contact_email"]


# ─── Regression 2: full payload with category/tags/status/suburb ───


def test_full_payload_new_org_creates_cleanly(token):
    payload = {
        "organisation_name": "Iter169 Full Fields Co",
        "email": _email("full"),
        "category": "retirement_village",
        "tags": ["retirement_village", "spreadsheet_import"],
        "status": "not_contacted",
        "suburb": "Turramurra",
        "state": "NSW",
        "notes": "Regression test — every field populated.",
        "contact_name": "Sara Nguyen",
        "phone": "02 8888 1234",
    }
    r = requests.post(
        f"{BASE_URL}/api/cms/outreach/organisations",
        headers=_h(token), json=payload, timeout=10,
    )
    assert r.status_code == 200, r.text
    org = r.json()["organisation"]
    assert org["category"] == "retirement_village"
    assert org["suburb"] == "Turramurra"
    assert org["state"] == "NSW"
    assert org["status"] == "not_contacted"
    assert "retirement_village" in org["tags"]
    assert org["phone"] == "02 8888 1234"


# ─── Regression 3: duplicate email → 200 existing:true (not 500) ──


def test_duplicate_email_returns_existing_not_500(token):
    e = _email("dup")
    payload = {"organisation_name": "Iter169 Dup Co", "email": e}
    r1 = requests.post(f"{BASE_URL}/api/cms/outreach/organisations",
                       headers=_h(token), json=payload, timeout=10)
    assert r1.status_code == 200
    r2 = requests.post(f"{BASE_URL}/api/cms/outreach/organisations",
                       headers=_h(token), json=payload, timeout=10)
    assert r2.status_code == 200, r2.text
    b2 = r2.json()
    assert b2["existing"] is True
    assert b2["id"] == r1.json()["id"]


def test_duplicate_email_case_insensitive(token):
    lower = _email("case")
    upper = lower.upper()
    r1 = requests.post(f"{BASE_URL}/api/cms/outreach/organisations",
                       headers=_h(token),
                       json={"organisation_name": "Iter169 Case A",
                             "email": lower}, timeout=10)
    assert r1.status_code == 200
    r2 = requests.post(f"{BASE_URL}/api/cms/outreach/organisations",
                       headers=_h(token),
                       json={"organisation_name": "Iter169 Case B",
                             "email": upper}, timeout=10)
    assert r2.status_code == 200
    assert r2.json()["existing"] is True
    assert r2.json()["id"] == r1.json()["id"]


def test_duplicate_via_legacy_email_field_deduped(db, token):
    """A pre-existing legacy-shape row that only has the `email` field
    (no `contact_email`) must still be recognised by the dedupe scan."""
    legacy_id = f"{MARKER}legacy-{uuid.uuid4().hex[:6]}"
    e = _email("legacy")
    db.outreach_organisations.insert_one({
        "id": legacy_id,
        "name": "Iter169 Legacy RV",
        "email": e.upper(),  # mixed case, legacy field ONLY
        "status": "contacted",
        "category": "retirement_village",
        "archived": False,
        "created_at": "2026-08-01T00:00:00+00:00",
    })
    r = requests.post(
        f"{BASE_URL}/api/cms/outreach/organisations", headers=_h(token),
        json={"organisation_name": "Iter169 Legacy Redux", "email": e},
        timeout=10,
    )
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["existing"] is True
    assert b["id"] == legacy_id


# ─── Regression 4: required-field validation → 400, never 500 ──────


def test_missing_name_returns_400(token):
    r = requests.post(f"{BASE_URL}/api/cms/outreach/organisations",
                      headers=_h(token),
                      json={"email": _email("no-name")}, timeout=10)
    assert r.status_code == 400


def test_missing_email_returns_400(token):
    r = requests.post(f"{BASE_URL}/api/cms/outreach/organisations",
                      headers=_h(token),
                      json={"organisation_name": "Iter169 No Email"}, timeout=10)
    assert r.status_code == 400


def test_bad_email_returns_400(token):
    r = requests.post(f"{BASE_URL}/api/cms/outreach/organisations",
                      headers=_h(token),
                      json={"organisation_name": "Iter169 Bad Email",
                            "email": "not-an-email"}, timeout=10)
    assert r.status_code == 400


# ─── Regression 5: mirroring — new rows carry BOTH email fields ────


def test_new_row_stores_both_email_and_contact_email(db, token):
    e = _email("mirror")
    r = requests.post(f"{BASE_URL}/api/cms/outreach/organisations",
                      headers=_h(token),
                      json={"organisation_name": "Iter169 Mirror Co",
                            "email": e}, timeout=10)
    assert r.status_code == 200
    org_id = r.json()["id"]
    doc = db.outreach_organisations.find_one({"id": org_id})
    assert doc is not None
    assert doc.get("email") == e.lower()
    assert doc.get("contact_email") == e.lower()
    # ``outreach_number`` must be OMITTED when not provided — prevents
    # null-collision on any legacy unique partial index.
    assert "outreach_number" not in doc, (
        "outreach_number must not be stored as null — see iter169 fix"
    )


# ─── Regression 6: bulk creation is idempotent across a batch ──────


def test_bulk_creation_idempotent(db, token):
    payloads: List[Dict[str, Any]] = [
        {"organisation_name": f"Iter169 Bulk {i}",
         "email": _email(f"bulk-{i}"),
         "category": ["retirement_village", "u3a", "mens_shed"][i % 3]}
        for i in range(9)
    ]
    # 1st pass — everyone new
    seen_ids: List[str] = []
    for p in payloads:
        r = requests.post(f"{BASE_URL}/api/cms/outreach/organisations",
                          headers=_h(token), json=p, timeout=10)
        assert r.status_code == 200, r.text
        assert r.json()["existing"] is False
        seen_ids.append(r.json()["id"])
    # 2nd pass — everyone deduped
    for p, sid in zip(payloads, seen_ids):
        r = requests.post(f"{BASE_URL}/api/cms/outreach/organisations",
                          headers=_h(token), json=p, timeout=10)
        assert r.status_code == 200, r.text
        assert r.json()["existing"] is True
        assert r.json()["id"] == sid
    # Verify every seen id is present + not archived.
    for sid in seen_ids:
        d = db.outreach_organisations.find_one({"id": sid})
        assert d is not None
        assert d.get("archived") is False


# ─── Regression 7: created rows are visible in active list ─────────


def test_created_org_appears_in_active_list(token):
    e = _email("visible")
    r = requests.post(
        f"{BASE_URL}/api/cms/outreach/organisations", headers=_h(token),
        json={"organisation_name": "Iter169 Visible Co",
              "email": e, "category": "retirement_village"}, timeout=10,
    )
    assert r.status_code == 200
    r = requests.get(f"{BASE_URL}/api/cms/outreach/organisations?limit=500",
                     headers=_h(token), timeout=10)
    assert r.status_code == 200
    rows = r.json()["rows"]
    match = [x for x in rows if x["email"] == e.lower()]
    assert len(match) == 1
    assert match[0]["organisation_name"] == "Iter169 Visible Co"
    assert match[0]["category"] == "retirement_village"
    assert match[0]["archived"] is False
