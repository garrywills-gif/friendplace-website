"""Iteration 167 — Organisation Outreach endpoint verification.

The Vercel MCGS frontend (chunk ``page-31212faa3c28b253.js``) calls
these endpoints. This suite exercises each one against a running local
backend, seeds/asserts against Mongo directly, and cleans up its own
data at the end. It NEVER touches organisations that weren't inserted
by this test module.

Frontend contract from the deployed chunk (verified by direct JS
inspection at time of writing):

    listActive(params)  → GET  /cms/outreach/organisations?archived=false&...
    list(params)        → GET  /cms/outreach/organisations?archived=true&...
    archive(id)         → POST /cms/outreach/organisations/{id}/archive
    restore(id)         → POST /cms/outreach/organisations/{id}/unarchive
    create(payload)     → POST /cms/outreach/organisations
      (spreadsheet import loops one POST per row; manual form
       posts once from /admin/outreach/new)
    401 on any of the above with an invalid/missing token; frontend
    now surfaces that as an error message rather than empty state.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = "http://localhost:8001"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

# Real CMS admin credentials from /app/memory/test_credentials.md.
# Only ever used to mint a real JWT — never mutated. If the admin is
# in cooldown from earlier test runs, the whole suite skips instead of
# hammering the login endpoint.
CMS_EMAIL = "hello@friendplace.com.au"
CMS_PASSWORD = "TestPass2026!"

# Every test doc gets this prefix so cleanup can wipe them by pattern
# without touching any pre-existing production-flavoured rows in the
# dev DB.
MARKER = "iter167-outreach-verify-"


# ─── fixtures ──────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def db():
    return MongoClient(MONGO_URL)[DB_NAME]


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/cms/auth/login",
        json={"email": CMS_EMAIL, "password": CMS_PASSWORD},
        timeout=10,
    )
    if r.status_code == 429:
        pytest.skip("Real CMS admin currently in lockout — try later.")
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return r.json()["token"]


@pytest.fixture(scope="module", autouse=True)
def _cleanup(db):
    """Guarantees test rows never leak between runs."""
    def _wipe():
        db.cms_organisations.delete_many({"id": {"$regex": f"^{MARKER}"}})
        db.cms_organisations.delete_many({"contact_email": {"$regex": f"^{MARKER}"}})
    _wipe()
    yield
    _wipe()


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ─── 1. Auth surface — 401 shape is stable ────────────────────────────

class TestAuthErrorContract:
    """The frontend's failsafe requires that auth failures return a
    proper 4xx with a body it can distinguish from an empty list."""

    def test_missing_token_returns_401_not_200_empty(self):
        r = requests.get(f"{BASE_URL}/api/cms/outreach/organisations", timeout=10)
        assert r.status_code == 401
        body = r.json()
        assert "detail" in body
        # And CRUCIALLY: the body is NOT the shape a happy response
        # would have. A frontend that reads `.rows` on this response
        # gets `undefined` and MUST branch to an error state.
        assert "rows" not in body

    def test_bogus_token_returns_401_not_200_empty(self):
        r = requests.get(
            f"{BASE_URL}/api/cms/outreach/organisations",
            headers={"Authorization": "Bearer not-a-real-jwt"},
            timeout=10,
        )
        assert r.status_code == 401
        assert "rows" not in r.json()

    def test_missing_token_on_create_returns_401(self):
        r = requests.post(
            f"{BASE_URL}/api/cms/outreach/organisations",
            json={"organisation_name": "Test", "email": "t@example.com"},
            timeout=10,
        )
        assert r.status_code == 401


# ─── 2. List — active + archived views work independently ─────────────

class TestListing:
    def test_active_listing_returns_rows_shape(self, token):
        r = requests.get(
            f"{BASE_URL}/api/cms/outreach/organisations?archived=false",
            headers=_h(token), timeout=10,
        )
        assert r.status_code == 200
        body = r.json()
        assert "count" in body
        assert "rows" in body
        assert isinstance(body["rows"], list)
        # Every row must have the projection fields the frontend
        # relies on — never leak _id.
        if body["rows"]:
            row = body["rows"][0]
            for k in ("id", "name", "archived"):
                assert k in row, f"missing '{k}' in row projection: {row}"
            assert "_id" not in row

    def test_archived_listing_uses_different_filter(self, token):
        r = requests.get(
            f"{BASE_URL}/api/cms/outreach/organisations?archived=true",
            headers=_h(token), timeout=10,
        )
        assert r.status_code == 200
        body = r.json()
        # Every row returned must actually be archived.
        for row in body["rows"]:
            assert row["archived"] is True

    def test_default_view_is_active_not_archived(self, token):
        """No ``archived`` param → default MUST be active-only.
        Previously the buggy frontend hardcoded ``archived=true``;
        the backend default is the authoritative source of truth."""
        r = requests.get(
            f"{BASE_URL}/api/cms/outreach/organisations",
            headers=_h(token), timeout=10,
        )
        assert r.status_code == 200
        for row in r.json()["rows"]:
            assert row["archived"] is False


# ─── 3. Create — spreadsheet import loop + manual form ────────────────

class TestCreate:
    def test_create_from_spreadsheet_shape(self, db, token):
        """Payload as sent by the ``ea`` spreadsheet import handler
        in the deployed chunk. Uses ``organisation_name`` +
        ``email`` + ``phone`` (frontend names, not schema names).
        """
        payload = {
            "rowNumber": 42,     # frontend metadata, should be ignored
            "organisation_name": "Iter167 RSL Manly",
            "email": f"{MARKER}manly-rsl@example.com",
            "contact_name": "Wendy Manly",
            "phone": "0400 000 001",
            "category": "RSL",
            "tags": ["RSL", "spreadsheet_import"],
            "suburb": "Manly",
            "state": "NSW",
            "notes": "Left message with concierge.",
            "status": "contacted",
        }
        r = requests.post(
            f"{BASE_URL}/api/cms/outreach/organisations",
            headers=_h(token), json=payload, timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["existing"] is False
        assert "organisation" in body

        # DB assertions — the frontend-shaped keys must be normalised
        # into the storage schema, so the list endpoint reads them back
        # cleanly on the next fetch.
        doc = db.cms_organisations.find_one({"id": body["id"]})
        assert doc is not None
        assert doc["name"] == "Iter167 RSL Manly"
        assert doc["contact_email"] == payload["email"].lower()
        assert doc["contact_phone"] == "0400 000 001"
        assert doc["category"] == "RSL"
        assert doc["archived"] is False
        assert doc["status"] == "contacted"
        assert "spreadsheet_import" in doc["tags"]

    def test_create_from_manual_form_shape(self, db, token):
        """Payload as sent by the /admin/outreach/new manual form —
        same required fields, more optional fields."""
        payload = {
            "organisation_name": "Iter167 Coastal Library",
            "email": f"{MARKER}coastal-library@example.com",
            "contact_name": "Ada Verify",
            "phone": "07 3000 0000",
            "category": "Library",
            "suburb": "Redcliffe",
            "state": "QLD",
            "postcode": "4020",
            "website": "https://redcliffe.example.gov.au",
            "notes": "Follow up next Tuesday.",
            "tags": ["Library"],
            "status": "not_contacted",
        }
        r = requests.post(
            f"{BASE_URL}/api/cms/outreach/organisations",
            headers=_h(token), json=payload, timeout=10,
        )
        assert r.status_code == 200
        doc = db.cms_organisations.find_one({"id": r.json()["id"]})
        assert doc["postcode"] == "4020"
        assert doc["website"] == "https://redcliffe.example.gov.au"

    def test_create_requires_name(self, token):
        r = requests.post(
            f"{BASE_URL}/api/cms/outreach/organisations",
            headers=_h(token),
            json={"email": f"{MARKER}noname@example.com"},
            timeout=10,
        )
        assert r.status_code == 400
        assert "name" in r.json()["detail"].lower()

    def test_create_requires_valid_email(self, token):
        r = requests.post(
            f"{BASE_URL}/api/cms/outreach/organisations",
            headers=_h(token),
            json={"organisation_name": "No Email Ltd", "email": "not-an-email"},
            timeout=10,
        )
        assert r.status_code == 400
        assert "email" in r.json()["detail"].lower()


# ─── 4. Idempotent duplicate protection ───────────────────────────────

class TestDuplicateProtection:
    """Spreadsheet re-runs must be safe: same email → same row,
    zero data mutation."""

    def test_duplicate_email_returns_existing_no_duplicate(self, db, token):
        email = f"{MARKER}dupe-test@example.com"
        first = requests.post(
            f"{BASE_URL}/api/cms/outreach/organisations",
            headers=_h(token),
            json={"organisation_name": "Iter167 Dupe Original", "email": email},
            timeout=10,
        )
        assert first.status_code == 200
        first_id = first.json()["id"]
        assert first.json()["existing"] is False

        # Re-run with the SAME email but a different display name and
        # different notes — a naive implementation would either 500 or
        # overwrite. Ours must return the ORIGINAL untouched.
        second = requests.post(
            f"{BASE_URL}/api/cms/outreach/organisations",
            headers=_h(token),
            json={
                "organisation_name": "Iter167 Dupe Attempted Overwrite",
                "email": email,
                "notes": "This must NOT overwrite the original notes",
            },
            timeout=10,
        )
        assert second.status_code == 200
        body = second.json()
        assert body["id"] == first_id, "duplicate MUST return the same id, not create a new row"
        assert body["existing"] is True

        # And the DB row must NOT have been mutated.
        doc = db.cms_organisations.find_one({"id": first_id})
        assert doc["name"] == "Iter167 Dupe Original", (
            "existing row must NEVER be overwritten by a duplicate create"
        )
        # Exactly one row per email.
        cnt = db.cms_organisations.count_documents({"contact_email": email})
        assert cnt == 1

    def test_case_insensitive_duplicate_detection(self, db, token):
        first = requests.post(
            f"{BASE_URL}/api/cms/outreach/organisations",
            headers=_h(token),
            json={
                "organisation_name": "Iter167 Case Test",
                "email": f"{MARKER}case-test@example.com",
            },
            timeout=10,
        )
        assert first.status_code == 200
        # Re-submit with UPPERCASE email — must still hit the dupe.
        second = requests.post(
            f"{BASE_URL}/api/cms/outreach/organisations",
            headers=_h(token),
            json={
                "organisation_name": "Iter167 Case Test SHOUTED",
                "email": f"{MARKER.upper()}CASE-TEST@EXAMPLE.COM",
            },
            timeout=10,
        )
        assert second.status_code == 200
        assert second.json()["existing"] is True
        assert second.json()["id"] == first.json()["id"]


# ─── 5. Archive → visible via ?archived=true, hidden from active ──────

class TestArchiveFlow:
    def test_archive_moves_row_out_of_active_view(self, db, token):
        # Seed one row.
        seed = requests.post(
            f"{BASE_URL}/api/cms/outreach/organisations",
            headers=_h(token),
            json={
                "organisation_name": "Iter167 Archive Target",
                "email": f"{MARKER}archive-target@example.com",
            },
            timeout=10,
        )
        assert seed.status_code == 200
        org_id = seed.json()["id"]

        # Active listing sees it.
        active_before = requests.get(
            f"{BASE_URL}/api/cms/outreach/organisations?archived=false&limit=500",
            headers=_h(token), timeout=10,
        ).json()
        assert any(r["id"] == org_id for r in active_before["rows"])

        # Archive it.
        arch = requests.post(
            f"{BASE_URL}/api/cms/outreach/organisations/{org_id}/archive",
            headers=_h(token), timeout=10,
        )
        assert arch.status_code == 200
        assert arch.json()["archived"] is True

        # Active listing no longer sees it.
        active_after = requests.get(
            f"{BASE_URL}/api/cms/outreach/organisations?archived=false&limit=500",
            headers=_h(token), timeout=10,
        ).json()
        assert not any(r["id"] == org_id for r in active_after["rows"])

        # Archived listing DOES see it.
        archived = requests.get(
            f"{BASE_URL}/api/cms/outreach/organisations?archived=true&limit=500",
            headers=_h(token), timeout=10,
        ).json()
        assert any(r["id"] == org_id for r in archived["rows"])

        # DB row is preserved, not deleted.
        doc = db.cms_organisations.find_one({"id": org_id})
        assert doc is not None
        assert doc["archived"] is True


# ─── 6. Unarchive / restore alias ─────────────────────────────────────

class TestUnarchiveAndRestoreAlias:
    def _seed_archived(self, token: str) -> str:
        r = requests.post(
            f"{BASE_URL}/api/cms/outreach/organisations",
            headers=_h(token),
            json={
                "organisation_name": f"Iter167 Restore {uuid.uuid4().hex[:6]}",
                "email": f"{MARKER}restore-{uuid.uuid4().hex[:6]}@example.com",
            },
            timeout=10,
        )
        assert r.status_code == 200
        org_id = r.json()["id"]
        requests.post(
            f"{BASE_URL}/api/cms/outreach/organisations/{org_id}/archive",
            headers=_h(token), timeout=10,
        )
        return org_id

    def test_unarchive_puts_row_back_in_active(self, token):
        org_id = self._seed_archived(token)
        r = requests.post(
            f"{BASE_URL}/api/cms/outreach/organisations/{org_id}/unarchive",
            headers=_h(token), timeout=10,
        )
        assert r.status_code == 200
        assert r.json()["archived"] is False

    def test_restore_alias_matches_unarchive(self, token):
        """The old deployed chunk called /restore; the new one calls
        /unarchive. Both must succeed identically."""
        org_id = self._seed_archived(token)
        r = requests.post(
            f"{BASE_URL}/api/cms/outreach/organisations/{org_id}/restore",
            headers=_h(token), timeout=10,
        )
        assert r.status_code == 200
        assert r.json()["archived"] is False

    def test_unarchive_nonexistent_id_returns_404(self, token):
        r = requests.post(
            f"{BASE_URL}/api/cms/outreach/organisations/does-not-exist/unarchive",
            headers=_h(token), timeout=10,
        )
        assert r.status_code == 404
        # And the body has a `detail` — never an empty rows envelope.
        assert "rows" not in r.json()
