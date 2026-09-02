"""iter164av — CTA-after-signoff layout + sent-campaign rename-only endpoint.

Part 1 (email layout): the campaign CTA button renders AFTER the
sign-off, in both HTML and plain text:
    body -> sign-off -> CTA button -> footer
Text/URL/styling/tracking are unchanged — only position moved.

Part 2 (rename): PATCH /api/cms/campaigns/{id}/rename lets an authorised
admin change ONLY the internal campaign name, even after the campaign
has been sent. Subject, body, recipients, archived HTML, delivery
history and tracking stay locked. Persisted server-side.
"""

from __future__ import annotations

import os
import uuid

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

from email_service import announcement_template

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


# ---------------------------------------------------------------------------
# Part 1 — CTA renders after the sign-off (HTML + text).
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("companion", ["team", "george", "georgia"])
def test_cta_after_signoff_html_and_text(companion):
    subj, html, text = announcement_template(
        first_name="Jane", title="News", body_md="Come and see us.",
        cta_label="Take a look around", cta_url="https://friendplace.com.au",
        greeting="Hi [Contact name],", companion=companion,
    )
    # HTML: sign-off ("Warmly,") must appear BEFORE the CTA, CTA before footer.
    i_sign = html.find("Warmly")
    i_cta = html.find("Take a look around")
    i_foot = html.find("61593250883842")   # facebook footer marker
    assert -1 < i_sign < i_cta < i_foot, "HTML order must be sign-off -> CTA -> footer"
    # Text: same order.
    t_sign = text.find("Warmly")
    t_cta = text.find("Take a look around")
    t_foot = text.find("61593250883842")
    assert -1 < t_sign < t_cta < t_foot, "text order must be sign-off -> CTA -> footer"


def test_no_cta_still_renders():
    # Without a CTA the letter still renders cleanly, sign-off intact.
    _s, html, text = announcement_template(
        first_name="Jane", title="News", body_md="Hello.", companion="team",
    )
    assert "Warmly" in html and "Warmly" in text
    assert "Take a look around" not in html


# ---------------------------------------------------------------------------
# Part 2 — rename-only endpoint.
# ---------------------------------------------------------------------------

def _make_sent_campaign(db, name="Original name"):
    cid = str(uuid.uuid4())
    doc = {
        "id": cid, "name": name, "template": "announcement",
        "subject": "Locked subject", "body_md": "Locked body",
        "status": "sent", "sent_at": "2026-09-01T00:00:00Z",
        "sample_html": "<html>archived sent html</html>",
        "audience_filter": {"audience_kind": "founding_members"},
        "stats": {"targeted": 10, "delivered": 9, "opened": 4, "clicked": 2,
                  "bounced": 1, "accepted": 10, "failed": 0},
        "created_at": "2026-08-30T00:00:00Z",
    }
    db.campaigns.insert_one(dict(doc))
    return cid, doc


def test_rename_sent_campaign_changes_only_name(db, auth):
    cid, original = _make_sent_campaign(db)
    try:
        r = requests.patch(f"{BASE}/cms/campaigns/{cid}/rename",
                           json={"name": "Renamed internal label"}, headers=auth)
        assert r.status_code == 200, r.text
        assert r.json()["name"] == "Renamed internal label"
        # Everything else locked in the DB.
        doc = db.campaigns.find_one({"id": cid}, {"_id": 0})
        assert doc["name"] == "Renamed internal label"
        assert doc["subject"] == original["subject"]
        assert doc["body_md"] == original["body_md"]
        assert doc["status"] == "sent"
        assert doc["sample_html"] == original["sample_html"]
        assert doc["stats"] == original["stats"]
        assert doc["audience_filter"] == original["audience_filter"]
        assert doc["sent_at"] == original["sent_at"]
        # Audit metadata written.
        assert doc.get("renamed_at")
        assert doc.get("renamed_by") == ADMIN_EMAIL
    finally:
        db.campaigns.delete_one({"id": cid})


def test_rename_persists_and_surfaces_in_summary(db, auth):
    cid, _ = _make_sent_campaign(db, name="Before")
    try:
        requests.patch(f"{BASE}/cms/campaigns/{cid}/rename",
                       json={"name": "After"}, headers=auth)
        got = requests.get(f"{BASE}/cms/campaigns/{cid}", headers=auth).json()
        assert got["name"] == "After"
        assert got.get("renamed_by") == ADMIN_EMAIL
        assert got.get("renamed_at")
    finally:
        db.campaigns.delete_one({"id": cid})


def test_rename_rejects_blank(db, auth):
    cid, _ = _make_sent_campaign(db)
    try:
        r = requests.patch(f"{BASE}/cms/campaigns/{cid}/rename",
                           json={"name": "   "}, headers=auth)
        assert r.status_code == 400
        r2 = requests.patch(f"{BASE}/cms/campaigns/{cid}/rename",
                            json={}, headers=auth)
        assert r2.status_code == 400
    finally:
        db.campaigns.delete_one({"id": cid})


def test_rename_missing_campaign_404(auth):
    r = requests.patch(f"{BASE}/cms/campaigns/does-not-exist/rename",
                       json={"name": "x"}, headers=auth)
    assert r.status_code == 404


def test_normal_update_still_rejects_sent_edits(db, auth):
    # The rename endpoint does NOT loosen the general lock: PATCH
    # /campaigns/{id} must still reject content edits on a sent campaign.
    cid, _ = _make_sent_campaign(db)
    try:
        r = requests.patch(f"{BASE}/cms/campaigns/{cid}",
                           json={"subject": "hacked"}, headers=auth)
        assert r.status_code == 400
        doc = db.campaigns.find_one({"id": cid}, {"_id": 0})
        assert doc["subject"] == "Locked subject"
    finally:
        db.campaigns.delete_one({"id": cid})
