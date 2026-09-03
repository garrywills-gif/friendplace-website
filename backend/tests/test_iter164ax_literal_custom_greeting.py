"""iter164ax — Literal custom Outreach greeting must be honoured verbatim.

Regression for the bug where POST /campaigns/{id}/render-recipient (and
the shared send path) clobbered a LITERAL custom greeting such as
"Dear COTA Team," with "Hello friend," whenever the outreach recipient
had no contact name.

Contract:
  * A greeting WITHOUT the "[Contact name]" token is a literal string —
    honoured EXACTLY for every recipient, named or not. No personalised
    substitution, no "Hello friend," fallback.
  * A greeting WITH the "[Contact name]" token is a named-contact preset —
    substituted per recipient, and a no-name recipient falls back to
    "Hello friend," (existing iter164at behaviour, unchanged).
  * "" (No greeting) stays blank for everyone (unchanged).

Because render-recipient, test-send and the real send worker all share
_apply_outreach_safety, proving it via render-recipient proves the whole
send path.
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


def _outreach_campaign(auth, tag, greeting):
    payload = {"name": "iter164ax", "template": "announcement",
               "title": "News", "body_md": "Body here.",
               "greeting": greeting,
               "audience_filter": {"audience_kind": "outreach_contacts",
                                    "outreach": {"tags_any": [tag]}}}
    r = requests.post(f"{BASE}/cms/campaigns", json=payload, headers=auth)
    r.raise_for_status()
    return r.json()["id"]


def _render(auth, cid, email):
    r = requests.post(f"{BASE}/cms/campaigns/{cid}/render-recipient",
                      json={"email": email}, headers=auth)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def orgs(db):
    tag = f"iter164ax-{uuid.uuid4().hex[:8]}"
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
    yield {"tag": tag, "named_email": f"named-{tag}@example.com",
           "anon_email": f"anon-{tag}@example.com"}
    db.outreach_organisations.delete_many({"id": {"$in": [named, anon]}})


def _cleanup(db, cid):
    db.campaigns.delete_one({"id": cid})


# ---------------------------------------------------------------------------
# 1. Literal custom greeting is honoured verbatim for a NO-NAME recipient
#    (this is the reported bug: it used to become "Hello friend,").
# ---------------------------------------------------------------------------

def test_literal_greeting_no_name_recipient(db, auth, orgs):
    cid = _outreach_campaign(auth, orgs["tag"], greeting="Dear COTA Team,")
    try:
        out = _render(auth, cid, orgs["anon_email"])
        html, text = out["html"], out["text"]
        assert "Dear COTA Team," in html, html
        assert "Hello friend," not in html
        assert "Dear COTA Team," in text
        assert "Hello friend," not in text
    finally:
        _cleanup(db, cid)


# ---------------------------------------------------------------------------
# 2. Literal custom greeting is honoured verbatim for a NAMED recipient too
#    (no accidental "[Contact name]" substitution / no name injected).
# ---------------------------------------------------------------------------

def test_literal_greeting_named_recipient(db, auth, orgs):
    cid = _outreach_campaign(auth, orgs["tag"], greeting="Dear COTA Team,")
    try:
        html = _render(auth, cid, orgs["named_email"])["html"]
        assert "Dear COTA Team," in html
        assert "Dear Jane," not in html  # no personalisation for literal greeting
    finally:
        _cleanup(db, cid)


# ---------------------------------------------------------------------------
# 3. Named-contact preset (has token) STILL falls back to "Hello friend,"
#    for a no-name recipient — existing behaviour preserved.
# ---------------------------------------------------------------------------

def test_token_preset_still_falls_back_for_no_name(db, auth, orgs):
    cid = _outreach_campaign(auth, orgs["tag"], greeting="Dear [Contact name],")
    try:
        html = _render(auth, cid, orgs["anon_email"])["html"]
        assert "Hello friend," in html
        assert "Dear friend," not in html
    finally:
        _cleanup(db, cid)


# ---------------------------------------------------------------------------
# 4. Explicit "No greeting" ("") stays blank for a no-name recipient.
# ---------------------------------------------------------------------------

def test_blank_greeting_stays_blank(db, auth, orgs):
    cid = _outreach_campaign(auth, orgs["tag"], greeting="")
    try:
        html = _render(auth, cid, orgs["anon_email"])["html"]
        assert "Hello friend," not in html
        assert "Dear" not in html
    finally:
        _cleanup(db, cid)
