"""iter164at — Outreach greeting preset selector (persisted).

Replaces the free-text Outreach greeting/addressee with a persisted
preset stored in campaigns.greeting. Rules (Outreach ONLY):

  * Default (greeting unset/None) -> "Dear [Contact name],"
  * "" ("No greeting")            -> no greeting line
  * named-contact presets         -> "Dear/Hi/Hello [Contact name],"
  * resolved recipient with NO contact name -> "Hello friend,"
    regardless of which NAMED-contact preset was selected
  * "No greeting" ("") stays blank even for a no-name recipient
  * Founding Member / other campaigns are unaffected

Endpoint: GET /api/cms/campaigns/greeting-presets -> {presets, default,
no_name_fallback, applies_to}.
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


def _outreach_campaign(auth, tag, greeting="__unset__"):
    payload = {"name": "iter164at", "template": "announcement",
               "title": "News", "body_md": "Body here.",
               "audience_filter": {"audience_kind": "outreach_contacts",
                                    "outreach": {"tags_any": [tag]}}}
    if greeting != "__unset__":
        payload["greeting"] = greeting
    r = requests.post(f"{BASE}/cms/campaigns", json=payload, headers=auth)
    r.raise_for_status()
    return r.json()["id"]


def _render(auth, cid, email):
    r = requests.post(f"{BASE}/cms/campaigns/{cid}/render-recipient",
                      json={"email": email}, headers=auth)
    assert r.status_code == 200, r.text
    return r.json()["html"]


@pytest.fixture
def orgs(db):
    tag = f"iter164at-{uuid.uuid4().hex[:8]}"
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
# 1. Presets endpoint contract.
# ---------------------------------------------------------------------------

def test_greeting_presets_endpoint(auth):
    r = requests.get(f"{BASE}/cms/campaigns/greeting-presets", headers=auth)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["default"] == "Dear [Contact name],"
    assert body["no_name_fallback"] == "Hello friend,"
    assert body["applies_to"] == "outreach"
    values = [p["value"] for p in body["presets"]]
    assert values == ["Dear [Contact name],", "Hi [Contact name],",
                      "Hello [Contact name],", ""]


# ---------------------------------------------------------------------------
# 2. Unset greeting -> default "Dear [Contact name]," (named recipient).
# ---------------------------------------------------------------------------

def test_unset_defaults_to_dear(db, auth, orgs):
    cid = _outreach_campaign(auth, orgs["tag"])   # greeting unset (None)
    try:
        html = _render(auth, cid, orgs["named_email"])
        assert "Dear Jane," in html
    finally:
        _cleanup(db, cid)


# ---------------------------------------------------------------------------
# 3. Each named-contact preset renders for a named recipient.
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("preset,expected", [
    ("Dear [Contact name],",  "Dear Jane,"),
    ("Hi [Contact name],",    "Hi Jane,"),
    ("Hello [Contact name],", "Hello Jane,"),
])
def test_named_presets(db, auth, orgs, preset, expected):
    cid = _outreach_campaign(auth, orgs["tag"], greeting=preset)
    try:
        html = _render(auth, cid, orgs["named_email"])
        assert expected in html
    finally:
        _cleanup(db, cid)


# ---------------------------------------------------------------------------
# 4. No-name recipient -> "Hello friend," regardless of NAMED preset.
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("preset", [
    "__unset__", "Dear [Contact name],", "Hi [Contact name],", "Hello [Contact name],",
])
def test_no_name_always_hello_friend(db, auth, orgs, preset):
    cid = _outreach_campaign(auth, orgs["tag"], greeting=preset)
    try:
        html = _render(auth, cid, orgs["anon_email"])
        assert "Hello friend," in html, f"preset={preset!r} should still give 'Hello friend,'"
        assert "Sarah" not in html
        assert "Dear friend," not in html and "Hi friend," not in html
    finally:
        _cleanup(db, cid)


# ---------------------------------------------------------------------------
# 5. "No greeting" ("") -> blank line for BOTH named and no-name.
# ---------------------------------------------------------------------------

def test_no_greeting_stays_blank(db, auth, orgs):
    cid = _outreach_campaign(auth, orgs["tag"], greeting="")
    try:
        h_named = _render(auth, cid, orgs["named_email"])
        h_anon = _render(auth, cid, orgs["anon_email"])
        for h in (h_named, h_anon):
            assert "Dear" not in h
            assert "Hello friend," not in h
            assert "Hi Jane," not in h and "Dear Jane," not in h
    finally:
        _cleanup(db, cid)


# ---------------------------------------------------------------------------
# 6. Preset persists on the campaign doc (create + update).
# ---------------------------------------------------------------------------

def test_preset_persists(db, auth, orgs):
    cid = _outreach_campaign(auth, orgs["tag"], greeting="Hi [Contact name],")
    try:
        got = requests.get(f"{BASE}/cms/campaigns/{cid}", headers=auth).json()
        assert got["greeting"] == "Hi [Contact name],"
        # update to "No greeting"
        requests.patch(f"{BASE}/cms/campaigns/{cid}", json={"greeting": ""}, headers=auth)
        got2 = requests.get(f"{BASE}/cms/campaigns/{cid}", headers=auth).json()
        assert got2["greeting"] == ""
    finally:
        _cleanup(db, cid)
