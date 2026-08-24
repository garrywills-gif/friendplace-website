"""iter164p — Campaign Composer: editable greeting + show_founder_badge

Backend-only. Adds two campaign fields:
  • greeting            str | None
        None -> legacy "Dear <first_name>," greeting
        ""   -> render no greeting line at all
        any string (may contain "[Contact name]") -> substituted per-recipient
  • show_founder_badge  bool | None
        None -> legacy behaviour (show iff founder_number set)
        True -> show iff founder_number set
        False -> ALWAYS suppress the pill

Covers:
  01 create + GET persists both fields
  02 PATCH updates both fields (+ legacy fields still work)
  03 render-preview bulk keeps "[Contact name]" verbatim
  04 render-preview greeting=""       -> no "Dear" line at all
  05 render-preview greeting="Hi there," -> renders "Hi there,"; no "Dear"
  06 render-preview show_founder_badge=false + outreach bulk -> no Founding Member pill
  07 render-preview show_founder_badge=true + single-recipient founder -> pill present
  08 back-compat: no new fields -> bulk shows "Dear [Contact name]," and pill iff founder_number
  09 send worker: sample_html substitutes first_name and suppresses pill when show_founder_badge=false
"""
from __future__ import annotations

import asyncio
import os
import re
import time
import uuid

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

# --------------------------------------------------------------------------- #
# Config
# --------------------------------------------------------------------------- #

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
    or "http://localhost:8001"
).rstrip("/")

ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASSWORD = "TestPass2026!"

# Distinct tag so we can find/delete our test records independently.
TEST_TAG = f"iter164p_{uuid.uuid4().hex[:8]}"
TEST_EMAIL_PREFIX = "hello+iter164p"
TEST_ORG_EMAIL_A = f"{TEST_EMAIL_PREFIX}-outreach-a@friendplace.com.au"
TEST_ORG_EMAIL_B = f"{TEST_EMAIL_PREFIX}-outreach-b@friendplace.com.au"
TEST_FOUNDER_EMAIL = f"{TEST_EMAIL_PREFIX}-founder@friendplace.com.au"
TEST_FOUNDER_NUMBER = 9901
TEST_FOUNDER_FIRSTNAME = "TestyMcTestface"


# --------------------------------------------------------------------------- #
# Fixtures & helpers
# --------------------------------------------------------------------------- #

@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_token(api_client):
    r = api_client.post(
        f"{BASE_URL}/api/cms/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


def _run_async(coro_factory):
    loop = asyncio.new_event_loop()
    try:
        asyncio.set_event_loop(loop)
        client = AsyncIOMotorClient(
            os.getenv("MONGO_URL", "mongodb://localhost:27017"),
            io_loop=loop,
        )
        db = client[os.getenv("DB_NAME", "test_database")]
        try:
            return loop.run_until_complete(coro_factory(db))
        finally:
            client.close()
    finally:
        loop.close()


@pytest.fixture(scope="module", autouse=True)
def seed_and_cleanup():
    """Seed 2 outreach orgs + 1 founder interest_registration, tagged for cleanup."""
    async def _seed(db):
        # Clean any leftover data.
        await db.outreach_organisations.delete_many(
            {"email": {"$in": [TEST_ORG_EMAIL_A, TEST_ORG_EMAIL_B]}}
        )
        await db.interest_registrations.delete_many({"email": TEST_FOUNDER_EMAIL})
        # 2 outreach orgs sharing a tag (bulk audience for pill-suppress test).
        for i, em in enumerate([TEST_ORG_EMAIL_A, TEST_ORG_EMAIL_B]):
            await db.outreach_organisations.insert_one({
                "id": str(uuid.uuid4()),
                "email": em,
                "organisation_name": f"Iter164p Test Org {i+1}",
                "contact_name": f"Contact {i+1}",
                "category": "retirement_village",
                "status": "not_contacted",
                "tags": [TEST_TAG],
                "communications": [],
                "created_at": "2026-01-15T00:00:00+00:00",
                "updated_at": "2026-01-15T00:00:00+00:00",
                "is_test": False,
            })
        # 1 founder interest_registration (with founder_number).
        await db.interest_registrations.insert_one({
            "id": str(uuid.uuid4()),
            "first_name": TEST_FOUNDER_FIRSTNAME,
            "email": TEST_FOUNDER_EMAIL,
            "founder_number": TEST_FOUNDER_NUMBER,
            "status": "registered",
            "companion_choice": "george",
            "tags": [TEST_TAG],
            "is_test": False,
            "is_reserved": False,
            "created_at": "2026-01-15T00:00:00+00:00",
        })

    async def _clean(db):
        await db.outreach_organisations.delete_many(
            {"email": {"$in": [TEST_ORG_EMAIL_A, TEST_ORG_EMAIL_B]}}
        )
        await db.interest_registrations.delete_many({"email": TEST_FOUNDER_EMAIL})
        # Also cleanup any campaigns we created (identify by name prefix).
        await db.campaigns.delete_many({"name": {"$regex": "^TEST_iter164p"}})
        await db.campaign_recipients.delete_many(
            {"email": {"$in": [TEST_ORG_EMAIL_A, TEST_ORG_EMAIL_B, TEST_FOUNDER_EMAIL]}}
        )

    _run_async(_seed)
    yield
    _run_async(_clean)


def _create_campaign(api, headers, **overrides) -> dict:
    """Create a draft announcement campaign with sensible defaults."""
    payload = {
        "name":     f"TEST_iter164p_{uuid.uuid4().hex[:6]}",
        "template": "announcement",
        "subject":  "iter164p test",
        "title":    "Test heading",
        "body_md":  "Body paragraph one.\n\nBody paragraph two.",
        "companion": "george",
    }
    payload.update(overrides)
    r = api.post(f"{BASE_URL}/api/cms/campaigns", headers=headers, json=payload, timeout=15)
    assert r.status_code == 200, f"create failed: {r.status_code} {r.text[:300]}"
    return r.json()


# --------------------------------------------------------------------------- #
# 01 — POST /campaigns accepts + GET persists both new fields
# --------------------------------------------------------------------------- #

def test_01_create_persists_greeting_and_show_founder_badge(api_client, auth_headers):
    c = _create_campaign(
        api_client, auth_headers,
        greeting="Dear [Contact name],",
        show_founder_badge=False,
    )
    cid = c["id"]
    # GET back and verify persistence in DB (via GET endpoint).
    r = api_client.get(f"{BASE_URL}/api/cms/campaigns/{cid}",
                       headers=auth_headers, timeout=10)
    assert r.status_code == 200, f"GET failed: {r.status_code} {r.text[:200]}"
    got = r.json()
    # If _campaign_summary strips them, this is a bug we surface here.
    assert "greeting" in got, (
        "GET /campaigns/{id} response is missing `greeting` field. "
        "_campaign_summary must include new iter164p fields."
    )
    assert "show_founder_badge" in got, (
        "GET /campaigns/{id} response is missing `show_founder_badge` field."
    )
    assert got["greeting"] == "Dear [Contact name],"
    assert got["show_founder_badge"] is False


# --------------------------------------------------------------------------- #
# 02 — PATCH updates greeting + show_founder_badge (and legacy fields still work)
# --------------------------------------------------------------------------- #

def test_02_patch_updates_new_and_legacy_fields(api_client, auth_headers):
    c = _create_campaign(api_client, auth_headers)
    cid = c["id"]
    r = api_client.patch(
        f"{BASE_URL}/api/cms/campaigns/{cid}",
        headers=auth_headers,
        json={
            "greeting": "Hi there,",
            "show_founder_badge": True,
            "title": "Updated heading",
            "body_md": "Updated body.",
            "companion": "georgia",
        },
        timeout=10,
    )
    assert r.status_code == 200, f"PATCH failed: {r.status_code} {r.text[:200]}"
    got = api_client.get(f"{BASE_URL}/api/cms/campaigns/{cid}",
                         headers=auth_headers, timeout=10).json()
    assert got.get("greeting") == "Hi there,", f"greeting not updated: {got.get('greeting')!r}"
    assert got.get("show_founder_badge") is True
    assert got["title"] == "Updated heading"
    assert got["body_md"] == "Updated body."
    assert got["companion"] == "georgia"

    # PATCH again — explicit blank greeting.
    r = api_client.patch(
        f"{BASE_URL}/api/cms/campaigns/{cid}",
        headers=auth_headers,
        json={"greeting": "", "show_founder_badge": False},
        timeout=10,
    )
    assert r.status_code == 200
    got = api_client.get(f"{BASE_URL}/api/cms/campaigns/{cid}",
                         headers=auth_headers, timeout=10).json()
    assert got.get("greeting") == "", f"empty greeting not preserved: {got.get('greeting')!r}"
    assert got.get("show_founder_badge") is False


# --------------------------------------------------------------------------- #
# 03 — render-preview bulk keeps "[Contact name]" verbatim
# --------------------------------------------------------------------------- #

def test_03_bulk_preview_keeps_contact_name_placeholder(api_client, auth_headers):
    c = _create_campaign(
        api_client, auth_headers,
        greeting="Dear [Contact name],",
        audience_filter={"audience_kind": "outreach_contacts",
                         "outreach": {"tags_any": [TEST_TAG]}},
    )
    r = api_client.post(
        f"{BASE_URL}/api/cms/campaigns/{c['id']}/render-preview",
        headers=auth_headers, timeout=15,
    )
    assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
    body = r.json()
    html, text = body["html"], body["text"]
    assert "Dear [Contact name]," in html, (
        f"placeholder must be preserved verbatim in bulk preview. HTML snippet: "
        f"{html[html.find('Dear')-20:html.find('Dear')+80] if 'Dear' in html else '(no Dear found)'}"
    )
    assert "Dear [Contact name]," in text
    # Should NOT have substituted with a real recipient first_name.
    assert "Dear Contact," not in html, "leaked real outreach first_name into bulk preview"


# --------------------------------------------------------------------------- #
# 04 — render-preview greeting="" -> no greeting line at all
# --------------------------------------------------------------------------- #

def test_04_empty_greeting_renders_no_greeting_line(api_client, auth_headers):
    c = _create_campaign(
        api_client, auth_headers,
        greeting="",
        audience_filter={"audience_kind": "outreach_contacts",
                         "outreach": {"tags_any": [TEST_TAG]}},
    )
    r = api_client.post(
        f"{BASE_URL}/api/cms/campaigns/{c['id']}/render-preview",
        headers=auth_headers, timeout=15,
    )
    assert r.status_code == 200
    body = r.json()
    html, text = body["html"], body["text"]
    # No "Dear" anywhere (title/body/closing don't mention Dear).
    assert "Dear" not in html, (
        f"empty greeting should render no greeting line, but HTML has 'Dear'. "
        f"context: {html[max(0, html.find('Dear')-30):html.find('Dear')+60] if 'Dear' in html else ''}"
    )
    assert "Dear" not in text, "empty greeting still rendered a Dear line in text"
    # And no "<p>Hi" or "<p>Hello" block sneaking in either.
    assert not re.search(r"<p[^>]*>\s*(Dear|Hi|Hello)\b", html), (
        "empty greeting rendered some greeting <p> block"
    )


# --------------------------------------------------------------------------- #
# 05 — render-preview greeting="Hi there," -> verbatim; no "Dear"
# --------------------------------------------------------------------------- #

def test_05_custom_greeting_renders_verbatim(api_client, auth_headers):
    c = _create_campaign(
        api_client, auth_headers,
        greeting="Hi there,",
        audience_filter={"audience_kind": "outreach_contacts",
                         "outreach": {"tags_any": [TEST_TAG]}},
    )
    r = api_client.post(
        f"{BASE_URL}/api/cms/campaigns/{c['id']}/render-preview",
        headers=auth_headers, timeout=15,
    )
    assert r.status_code == 200
    body = r.json()
    html, text = body["html"], body["text"]
    assert "Hi there," in html
    assert "Hi there," in text
    assert "Dear" not in html, "custom greeting should not include any Dear line"
    assert "Dear" not in text


# --------------------------------------------------------------------------- #
# 06 — render-preview show_founder_badge=false + outreach -> NO founder pill
# --------------------------------------------------------------------------- #

def test_06_show_badge_false_suppresses_pill_outreach(api_client, auth_headers):
    c = _create_campaign(
        api_client, auth_headers,
        show_founder_badge=False,
        audience_filter={"audience_kind": "outreach_contacts",
                         "outreach": {"tags_any": [TEST_TAG]}},
    )
    r = api_client.post(
        f"{BASE_URL}/api/cms/campaigns/{c['id']}/render-preview",
        headers=auth_headers, timeout=15,
    )
    assert r.status_code == 200
    html = r.json()["html"]
    assert "Founding Member #" not in html, "pill leaked despite show_founder_badge=False"
    assert "Founding Member " not in html or "Founding Member" not in html, ""  # cheap double-check


# --------------------------------------------------------------------------- #
# 07 — render-preview show_founder_badge=true + single founder -> pill present
# --------------------------------------------------------------------------- #

def test_07_show_badge_true_renders_pill_for_single_founder(api_client, auth_headers):
    # Use founding_members audience filtered to our single seeded founder
    # via tag => 1 recipient => preview overrides use real founder_number.
    c = _create_campaign(
        api_client, auth_headers,
        show_founder_badge=True,
        audience_filter={"audience_kind": "founding_members",
                         "tags_any": [TEST_TAG]},
    )
    r = api_client.post(
        f"{BASE_URL}/api/cms/campaigns/{c['id']}/render-preview",
        headers=auth_headers, timeout=15,
    )
    assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
    body = r.json()
    html = body["html"]
    expected_pill = f"Founding Member #{TEST_FOUNDER_NUMBER:04d}"
    assert expected_pill in html, (
        f"expected pill '{expected_pill}' in HTML but not found. "
        f"audience_size={body.get('audience_size')}, "
        f"recipient={body.get('recipient')}"
    )


# --------------------------------------------------------------------------- #
# 08 — back-compat: no new fields -> legacy behaviour preserved
# --------------------------------------------------------------------------- #

def test_08_back_compat_bulk_preview_defaults(api_client, auth_headers):
    # No greeting / show_founder_badge in payload = legacy behaviour.
    c = _create_campaign(
        api_client, auth_headers,
        audience_filter={"audience_kind": "outreach_contacts",
                         "outreach": {"tags_any": [TEST_TAG]}},
    )
    # Verify DB row stored them as None (unset).
    got = api_client.get(f"{BASE_URL}/api/cms/campaigns/{c['id']}",
                         headers=auth_headers, timeout=10).json()
    assert got.get("greeting") is None
    assert got.get("show_founder_badge") is None
    # Render bulk preview -> legacy "Dear [Contact name]," (from bulk override
    # setting first_name="[Contact name]") and no pill (outreach has no founder_number).
    r = api_client.post(
        f"{BASE_URL}/api/cms/campaigns/{c['id']}/render-preview",
        headers=auth_headers, timeout=15,
    )
    assert r.status_code == 200
    html = r.json()["html"]
    assert "Dear [Contact name]," in html, "legacy bulk preview should render 'Dear [Contact name],'"
    assert "Founding Member #" not in html, (
        "outreach recipients have no founder_number so no pill expected"
    )

    # Same back-compat via single founder audience: pill should appear because
    # founder_number is set on the recipient (legacy show_founder_badge=None
    # behaves as "show if present").
    c2 = _create_campaign(
        api_client, auth_headers,
        audience_filter={"audience_kind": "founding_members",
                         "tags_any": [TEST_TAG]},
    )
    r2 = api_client.post(
        f"{BASE_URL}/api/cms/campaigns/{c2['id']}/render-preview",
        headers=auth_headers, timeout=15,
    )
    html2 = r2.json()["html"]
    expected_pill = f"Founding Member #{TEST_FOUNDER_NUMBER:04d}"
    assert expected_pill in html2, (
        "back-compat: pill should render when show_founder_badge is unset and recipient has founder_number"
    )
    # And greeting should default to "Dear <name>," using the real first_name (single-recipient).
    assert f"Dear {TEST_FOUNDER_FIRSTNAME}," in html2, (
        f"back-compat greeting should be 'Dear {TEST_FOUNDER_FIRSTNAME},' for single-recipient"
    )


# --------------------------------------------------------------------------- #
# 09 — send worker: sample_html substitutes [Contact name] and honours
#      show_founder_badge=False at actual send time
# --------------------------------------------------------------------------- #

def test_09_send_worker_substitutes_and_suppresses_badge(api_client, auth_headers):
    """Trigger a live send to the single seeded founder recipient.

    We only care about the sample_html snapshot (saved by the worker
    BEFORE calling the provider), so even if Resend fails downstream
    this test still validates the substitution + pill suppression.
    """
    c = _create_campaign(
        api_client, auth_headers,
        greeting="Dear [Contact name],",
        show_founder_badge=False,
        audience_filter={"audience_kind": "founding_members",
                         "tags_any": [TEST_TAG]},
    )
    cid = c["id"]
    # Kick off the send.
    r = api_client.post(f"{BASE_URL}/api/cms/campaigns/{cid}/send",
                        headers=auth_headers, timeout=15)
    if r.status_code == 400 and "RESEND" in r.text:
        pytest.skip("RESEND_API_KEY not configured — cannot exercise send worker")
    assert r.status_code == 200, f"send returned {r.status_code} {r.text[:200]}"

    # Poll for sample_html to appear (worker writes it before the first send).
    sample_html = None
    for _ in range(30):
        got = api_client.get(f"{BASE_URL}/api/cms/campaigns/{cid}",
                             headers=auth_headers, timeout=10).json()
        if got.get("sample_html"):
            sample_html = got["sample_html"]
            break
        time.sleep(0.5)
    assert sample_html, "sample_html not saved by send worker within 15s"

    # Substitution happened: real first_name in greeting.
    assert f"Dear {TEST_FOUNDER_FIRSTNAME}," in sample_html, (
        f"send worker did not substitute [Contact name] with '{TEST_FOUNDER_FIRSTNAME}'"
    )
    assert "[Contact name]" not in sample_html, (
        "placeholder should be fully substituted in actually-sent email HTML"
    )
    # And show_founder_badge=False suppressed the pill even though recipient
    # has founder_number set.
    assert "Founding Member #" not in sample_html, (
        "pill should be suppressed when show_founder_badge=False, even for founders"
    )
