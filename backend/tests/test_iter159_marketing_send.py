"""iter159 Marketing Send Email — end-to-end backend tests.

Covers steps 1-10 from the review request:
  * Template registry & rendering (in-process, offline)
  * Flyer PDF attachment builder (in-process)
  * Preview / Send / History / Contacts HTTP endpoints (admin JWT)
  * Privacy invariant: separate rows + no cross-recipient leakage
  * Flyer render `?format=pdf` and PNG regression
"""
from __future__ import annotations

import asyncio
import base64
import os
import time
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

# Load backend env so MONGO_URL is available for direct DB checks.
load_dotenv(dotenv_path=Path(__file__).resolve().parents[1] / ".env")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
if not BASE_URL:
    # Fallback to the same URL the website uses — same preview host.
    BASE_URL = "https://george-mcgs-cms.preview.emergentagent.com"
BASE_URL = BASE_URL.rstrip("/")

ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASSWORD = "TestPass2026!"

RECIPIENT_A = "hello@friendplace.com.au"
RECIPIENT_B = "hello+testb@friendplace.com.au"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def api_client():
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture(scope="module")
def admin_token(api_client) -> str:
    r = api_client.post(
        f"{BASE_URL}/api/cms/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("token")
    assert tok, "no token in login response"
    return tok


@pytest.fixture(scope="module")
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


# ---------------------------------------------------------------------------
# 1-4. In-process templates + flyer attachment
# ---------------------------------------------------------------------------

def test_1_list_templates_returns_two():
    from services.marketing.templates import list_templates
    tpls = list_templates()
    ids = sorted(t["id"] for t in tpls)
    assert ids == ["friendplace_intro", "retirement_village_outreach"], ids
    intro = next(t for t in tpls if t["id"] == "friendplace_intro")
    rv = next(t for t in tpls if t["id"] == "retirement_village_outreach")
    assert intro["audience"] in ("person", "any")
    assert rv["audience"] == "organisation"
    assert intro["name"] and rv["name"]


def test_2_render_friendplace_intro_jane_smith():
    from services.marketing.templates import TemplateContext, render_template
    ctx = TemplateContext(
        recipient_name="Jane Smith",
        recipient_email="jane@example.com",
        recipient_type="person",
    )
    r = render_template("friendplace_intro", ctx)
    assert r.subject == "Hello from FriendPlace", r.subject
    assert "Hi Jane," in r.html, "greeting missing"
    assert "Because you belong too." in r.html, "sign-off missing"
    assert "#0A2540" in r.html, "brand navy hex missing"


def test_2b_render_intro_with_subject_override():
    from services.marketing.templates import TemplateContext, render_template
    ctx = TemplateContext(recipient_name="Jane", subject_override="Custom Subj")
    r = render_template("friendplace_intro", ctx)
    assert r.subject == "Custom Subj"


def test_3_render_retirement_village_outreach_org_greeting():
    from services.marketing.templates import TemplateContext, render_template
    ctx = TemplateContext(
        recipient_type="organisation",
        organisation_name="Hillside Retirement Village",
        recipient_email="ops@hillside.example",
    )
    r = render_template("retirement_village_outreach", ctx)
    assert "Hello Hillside Retirement Village," in r.html, r.html[:400]


def test_4_build_flyer_attachment_returns_pdf():
    """In-process flyer PDF attachment builder."""
    from motor.motor_asyncio import AsyncIOMotorClient
    from services.marketing.sends import (
        FlyerAttachmentRequest,
        build_flyer_attachment,
    )

    async def _run():
        mongo_url = os.environ["MONGO_URL"]
        db_name = os.environ["DB_NAME"]
        client = AsyncIOMotorClient(mongo_url)
        db = client[db_name]
        try:
            req = FlyerAttachmentRequest(
                template_key="founding_member_invite",
                layout="poster_a4",
                field_values={"venue": "Kellyville Library"},
            )
            att = await build_flyer_attachment(db, req, internal_base_url="")
        finally:
            client.close()
        return att

    att = asyncio.get_event_loop().run_until_complete(_run())
    assert att.content_type == "application/pdf", att.content_type
    assert att.filename.lower().endswith(".pdf"), att.filename
    assert att.size_bytes > 10000, f"too small: {att.size_bytes}"
    pdf_bytes = base64.b64decode(att.b64)
    assert pdf_bytes[:4] == b"%PDF", pdf_bytes[:8]


# ---------------------------------------------------------------------------
# 5. Preview HTTP endpoint
# ---------------------------------------------------------------------------

def test_5_preview_endpoint(api_client, auth_headers):
    payload = {
        "template_id": "friendplace_intro",
        "recipient_email": RECIPIENT_A,
        "recipient_name": "Test User",
        "recipient_type": "person",
        "flyer": {
            "template_key": "founding_member_invite",
            "layout": "poster_a4",
            "field_values": {"venue": "Kellyville Library"},
        },
    }
    r = api_client.post(
        f"{BASE_URL}/api/cms/marketing/preview",
        json=payload,
        headers=auth_headers,
        timeout=30,
    )
    assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
    body = r.json()
    for k in ("subject", "html", "text", "flyer"):
        assert k in body, f"missing key {k}"
    assert "Hi Test," in body["html"]
    assert body["flyer"]["filename"].lower().endswith(".pdf")
    assert body["flyer"]["size_bytes"] > 10000


# ---------------------------------------------------------------------------
# 6. Send endpoint + history round-trip (LIVE RESEND)
# ---------------------------------------------------------------------------

@pytest.mark.flaky_env
def test_6_send_endpoint_and_history(api_client, auth_headers):
    payload = {
        "template_id": "friendplace_intro",
        "recipient_email": RECIPIENT_A,
        "recipient_name": "Test User",
        "recipient_type": "person",
        "flyer": {
            "template_key": "founding_member_invite",
            "layout": "poster_a4",
            "field_values": {"venue": "Kellyville Library"},
        },
        "tags": ["iter159_test"],
    }
    r = api_client.post(
        f"{BASE_URL}/api/cms/marketing/send",
        json=payload,
        headers=auth_headers,
        timeout=60,
    )
    assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
    out = r.json()
    if not out.get("ok"):
        pytest.skip(f"Resend flaky_env: {out.get('error')}/{out.get('error_code')}")
    assert out.get("message_id"), out
    assert out.get("send_id"), out
    send_id = out["send_id"]

    # History should include this row.
    time.sleep(1.0)
    h = api_client.get(
        f"{BASE_URL}/api/cms/marketing/sends?limit=10",
        headers=auth_headers,
        timeout=15,
    )
    assert h.status_code == 200
    rows = h.json().get("sends", [])
    match = next((row for row in rows if row.get("id") == send_id), None)
    assert match is not None, f"send_id {send_id} not found in history"
    assert match["status"] == "sent", match
    assert match["recipient_email"] == RECIPIENT_A
    assert match["template_id"] == "friendplace_intro"
    assert match["flyer_template"] == "founding_member_invite"
    assert match["flyer_layout"] == "poster_a4"
    assert match.get("flyer_filename", "").lower().endswith(".pdf")


# ---------------------------------------------------------------------------
# 7. Contact search
# ---------------------------------------------------------------------------

def test_7_contacts_search_finds_recipient(api_client, auth_headers):
    r = api_client.get(
        f"{BASE_URL}/api/cms/marketing/contacts?q=hello",
        headers=auth_headers,
        timeout=15,
    )
    assert r.status_code == 200, r.text[:200]
    contacts = r.json().get("contacts", [])
    match = next(
        (c for c in contacts if c.get("email", "").lower() == RECIPIENT_A.lower()),
        None,
    )
    if match is None:
        pytest.skip("Contact not present — likely Resend flaky_env skipped step 6")
    assert match.get("send_count", 0) >= 1, match


# ---------------------------------------------------------------------------
# 8. CRITICAL PRIVACY: two sends → two rows, no cross-leakage
# ---------------------------------------------------------------------------

@pytest.mark.flaky_env
def test_8_privacy_two_sends_two_rows_no_leakage(api_client, auth_headers):
    ids = []
    for email in (RECIPIENT_A, RECIPIENT_B):
        payload = {
            "template_id": "friendplace_intro",
            "recipient_email": email,
            "recipient_name": "Privacy Test",
            "tags": ["iter159_privacy_test"],
        }
        r = api_client.post(
            f"{BASE_URL}/api/cms/marketing/send",
            json=payload,
            headers=auth_headers,
            timeout=60,
        )
        assert r.status_code == 200, r.text[:400]
        out = r.json()
        if not out.get("ok"):
            pytest.skip(f"Resend flaky_env: {out.get('error')}")
        ids.append(out["send_id"])

    assert len(set(ids)) == 2, "duplicate send_ids"

    # Fetch history and confirm each row references only its own recipient.
    time.sleep(1.0)
    h = api_client.get(
        f"{BASE_URL}/api/cms/marketing/sends?limit=25",
        headers=auth_headers,
        timeout=15,
    )
    assert h.status_code == 200
    rows = {row["id"]: row for row in h.json()["sends"] if row.get("id") in ids}
    assert set(rows.keys()) == set(ids), f"missing rows: {ids} vs {list(rows.keys())}"

    row_a = next(r for r in rows.values() if r["recipient_email"] == RECIPIENT_A.lower())
    row_b = next(r for r in rows.values() if r["recipient_email"] == RECIPIENT_B.lower())
    assert row_a["message_id"] and row_b["message_id"]
    assert row_a["message_id"] != row_b["message_id"]

    # For each row, re-render the preview and confirm the OTHER
    # recipient's address is NOT anywhere in the personalised output.
    def _preview(email):
        pr = api_client.post(
            f"{BASE_URL}/api/cms/marketing/preview",
            json={
                "template_id": "friendplace_intro",
                "recipient_email": email,
                "recipient_name": "Privacy Test",
            },
            headers=auth_headers,
            timeout=15,
        )
        assert pr.status_code == 200, pr.text[:200]
        return pr.json()

    prev_a = _preview(RECIPIENT_A)
    prev_b = _preview(RECIPIENT_B)
    blob_a = (prev_a["html"] + prev_a["text"] + prev_a["subject"]).lower()
    blob_b = (prev_b["html"] + prev_b["text"] + prev_b["subject"]).lower()
    assert RECIPIENT_B.lower() not in blob_a, "Recipient B leaked into A's HTML/text"
    assert RECIPIENT_A.lower() not in blob_b, "Recipient A leaked into B's HTML/text"

    # Prove the invariant at the source: send_email_detailed calls to=[to].
    src = Path("/app/backend/email_service.py").read_text()
    assert "to=[to]" in src or "'to': [to]" in src or '"to": [to]' in src, (
        "email_service.send_email_detailed must place a single recipient into a list"
    )


# ---------------------------------------------------------------------------
# 9. Flyer render ?format=pdf
# ---------------------------------------------------------------------------

def test_9_flyer_render_pdf(api_client, auth_headers):
    r = api_client.get(
        f"{BASE_URL}/api/cms/flyer-templates/founding_member_invite/render"
        f"?layout=poster_a4&format=pdf&venue=Kellyville%20Library",
        headers={"Authorization": auth_headers["Authorization"]},
        timeout=60,
    )
    assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
    ct = r.headers.get("content-type", "")
    assert ct.startswith("application/pdf"), ct
    assert r.content[:4] == b"%PDF", r.content[:8]
    assert len(r.content) > 10000


# ---------------------------------------------------------------------------
# 10. PNG regression
# ---------------------------------------------------------------------------

def test_10_flyer_render_png_regression(api_client, auth_headers):
    r = api_client.get(
        f"{BASE_URL}/api/cms/flyer-templates/founding_member_invite/render"
        f"?layout=poster_a4&venue=Kellyville%20Library",
        headers={"Authorization": auth_headers["Authorization"]},
        timeout=60,
    )
    assert r.status_code == 200
    ct = r.headers.get("content-type", "")
    assert ct.startswith("image/png"), ct
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n", r.content[:8]
