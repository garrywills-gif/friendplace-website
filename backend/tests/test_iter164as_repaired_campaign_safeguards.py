"""iter164as — Repaired campaign safeguards audit (commit 271640d5).

Locks in the four behaviours restored from the backup:

  #4  preview-audience resolves up to 5000 and returns the FULL list
      (in both `recipients` and `sample`), not a 10-row teaser.
  #5  render-preview forces a single recipient's blank first_name to
      "" so the sample "Sarah" never leaks.
  #10 _preview_render honours an explicit empty first_name override.
  D   Outreach recipient with no contact name renders "Hello friend,"
      (scoped to Outreach only — Founding Member / other campaigns keep
      their existing no-name greeting).

Preserves all newer safeguards (iter164af/ag/ah/an) — those have their
own suites which still pass.
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


def _create_campaign(auth, audience_filter, **extra):
    payload = {"name": "iter164as", "template": "announcement",
               "title": "News", "body_md": "Hello everyone.",
               "audience_filter": audience_filter, **extra}
    r = requests.post(f"{BASE}/cms/campaigns", json=payload, headers=auth)
    r.raise_for_status()
    return r.json()["id"]


# ---------------------------------------------------------------------------
# #4 — preview-audience returns the FULL resolved list (not first 10).
# ---------------------------------------------------------------------------

def test_preview_audience_returns_full_list(db, auth):
    tag = f"iter164as-aud-{uuid.uuid4().hex[:8]}"
    ids = []
    # Seed 15 active outreach orgs so a 10-cap would be visible.
    for i in range(15):
        oid = str(uuid.uuid4())
        ids.append(oid)
        db.outreach_organisations.insert_one({
            "id": oid, "organisation_name": f"Org {tag} {i}",
            "email": f"{tag}-{i}@example.com", "tags": [tag],
            "is_test": False, "archived_at": None,
            "created_at": "2026-09-01T00:00:00Z", "updated_at": "2026-09-01T00:00:00Z",
        })
    cid = _create_campaign(auth, {"audience_kind": "outreach_contacts",
                                   "outreach": {"tags_any": [tag]}})
    try:
        r = requests.post(f"{BASE}/cms/campaigns/{cid}/preview-audience", headers=auth)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["count"] == 15
        assert len(body["sample"]) == 15, "sample must carry the FULL list, not 10"
        assert len(body.get("recipients", [])) == 15, "full recipient list must be returned"
    finally:
        db.outreach_organisations.delete_many({"id": {"$in": ids}})
        db.campaigns.delete_one({"id": cid})


# ---------------------------------------------------------------------------
# #5 + #10 — single-recipient blank name never falls back to "Sarah".
# ---------------------------------------------------------------------------

def test_render_preview_blank_single_recipient_no_sarah(db, auth):
    tag = f"iter164as-blank-{uuid.uuid4().hex[:8]}"
    # A single-recipient NON-outreach "individual" audience with no name.
    cid = _create_campaign(auth, {
        "audience_kind": "individual",
        "recipient_email": f"{tag}@example.com",
        "recipient_name": "",
    })
    try:
        r = requests.post(f"{BASE}/cms/campaigns/{cid}/render-preview", headers=auth)
        assert r.status_code == 200, r.text
        html = r.json()["html"]
        assert "Sarah" not in html, "blank single recipient must not fall back to sample 'Sarah'"
        # announcement default greeting for a nameless non-outreach recipient
        # collapses to "Dear there," — NOT a sample name.
        assert "Dear there," in html
    finally:
        db.campaigns.delete_one({"id": cid})


# ---------------------------------------------------------------------------
# #10 — _preview_render honours an explicit empty first_name override.
# ---------------------------------------------------------------------------

def test_preview_render_allows_empty_first_name():
    # Unit-level: reach into the router's closure is awkward, so assert on
    # announcement_template directly with the same empty-name semantics
    # _preview_render now forwards.
    from email_service import announcement_template
    _subj, html, _text = announcement_template(
        first_name="", title="T", body_md="Body", greeting=None,
    )
    assert "Sarah" not in html
    assert "Dear there," in html   # "" -> "there", never a sample name


# ---------------------------------------------------------------------------
# D — Outreach no-name greeting is "Hello friend,"; named stays "Hi <name>,".
# ---------------------------------------------------------------------------

def test_outreach_no_name_hello_friend(db, auth):
    tag = f"iter164as-hf-{uuid.uuid4().hex[:8]}"
    named = str(uuid.uuid4())
    anon = str(uuid.uuid4())
    db.outreach_organisations.insert_many([
        {"id": named, "organisation_name": f"Named {tag}", "contact_name": "Jane Smith",
         "email": f"named-{tag}@example.com", "tags": [tag], "is_test": False,
         "archived_at": None, "created_at": "2026-09-01T00:00:00Z", "updated_at": "2026-09-01T00:00:00Z"},
        {"id": anon, "organisation_name": f"Anon {tag}", "contact_name": "",
         "email": f"anon-{tag}@example.com", "tags": [tag], "is_test": False,
         "archived_at": None, "created_at": "2026-09-01T00:00:00Z", "updated_at": "2026-09-01T00:00:00Z"},
    ])
    cid = _create_campaign(auth, {"audience_kind": "outreach_contacts",
                                   "outreach": {"tags_any": [tag]}})
    try:
        # Named recipient -> "Hi Jane,"
        r1 = requests.post(f"{BASE}/cms/campaigns/{cid}/render-recipient",
                           json={"email": f"named-{tag}@example.com"}, headers=auth)
        # Anonymous recipient -> "Hello friend,"
        r2 = requests.post(f"{BASE}/cms/campaigns/{cid}/render-recipient",
                           json={"email": f"anon-{tag}@example.com"}, headers=auth)
        assert r1.status_code == 200 and r2.status_code == 200, (r1.text, r2.text)
        h1, h2 = r1.json()["html"], r2.json()["html"]
        assert "Hi Jane," in h1
        assert "Hello friend," in h2
        assert "Sarah" not in h2
        assert "Founding Member" not in h1 and "Founding Member" not in h2
    finally:
        db.outreach_organisations.delete_many({"id": {"$in": [named, anon]}})
        db.campaigns.delete_one({"id": cid})
