"""iter164ag — Campaign Resend-webhook rollup + reconcile regression tests.

P0 backstop for the 26/27 Aug 2026 Retirement Villages campaigns whose
Delivered/Opened/Clicked stats stayed at 0 despite the sends going out.

Verified end-to-end (no real emails):
  * Signed synthetic webhooks flow through /api/webhooks/resend and
    update campaign_recipients + campaigns.stats.
  * Works for outreach recipients that carry NO founder record.
  * Bounces on outreach recipients propagate to
    outreach_organisations.email_invalid — not to interest_registrations
    (which have no matching row).
  * The new /reconcile-stats endpoint rebuilds a campaign's stats
    idempotently from the raw resend_webhook_events log.
  * Extended /webhooks/resend/health surfaces the last 24h of raw
    activity so admins can eyeball whether Resend is actually posting.

NO REAL SENDS are performed. The Resend send worker is not invoked;
we insert campaign_recipient rows directly to simulate the state
that the worker produces after a live send.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
import uuid

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

BASE = "http://localhost:8001"
ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASSWORD = "TestPass2026!"


@pytest.fixture(scope="module")
def admin_token() -> str:
    r = requests.post(
        f"{BASE}/api/cms/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture(scope="module")
def db():
    load_dotenv("/app/backend/.env")
    client = MongoClient(os.environ["MONGO_URL"])
    yield client[os.environ.get("DB_NAME", "test_database")]
    client.close()


@pytest.fixture(scope="module")
def webhook_secret_bytes() -> bytes:
    load_dotenv("/app/backend/.env")
    secret = os.environ.get("RESEND_WEBHOOK_SECRET", "").strip()
    if not secret:
        pytest.skip("RESEND_WEBHOOK_SECRET not set")
    if secret.startswith("whsec_"):
        secret = secret[len("whsec_"):]
    try:
        return base64.b64decode(secret)
    except Exception:
        return secret.encode()


def _sign_and_post(secret_bytes: bytes, evt_type: str, email_id: str) -> requests.Response:
    body = json.dumps({
        "type": evt_type,
        "created_at": "2026-08-26T01:00:00Z",
        "data": {"email_id": email_id, "subject": "iter164ag probe"},
    }).encode("utf-8")
    svix_id = f"msg_{uuid.uuid4().hex[:16]}"
    svix_ts = str(int(time.time()))
    signed = f"{svix_id}.{svix_ts}.".encode("utf-8") + body
    sig = base64.b64encode(
        hmac.new(secret_bytes, signed, hashlib.sha256).digest()
    ).decode("ascii")
    return requests.post(
        f"{BASE}/api/webhooks/resend",
        data=body,
        headers={
            "Content-Type":    "application/json",
            "svix-id":         svix_id,
            "svix-timestamp":  svix_ts,
            "svix-signature":  f"v1,{sig}",
        }, timeout=10,
    )


@pytest.fixture()
def outreach_send(db):
    """Seed a fake sent outreach campaign with 1 recipient row —
    exactly the shape the send worker leaves behind.
    """
    tag = f"iter164ag-{uuid.uuid4().hex[:8]}"
    campaign_id = str(uuid.uuid4())
    org_id = str(uuid.uuid4())
    email = f"probe-{tag}@example.com"
    message_id = f"probe-mid-{uuid.uuid4().hex[:12]}"

    db.outreach_organisations.insert_one({
        "id":                org_id,
        "organisation_name": f"Probe Org {tag}",
        "contact_name":      "",
        "email":             email,
        "category":          "retirement_village",
        "status":            "new",
        "tags":              [tag],
        "is_test":           False,
        "created_at":        "2026-08-26T00:00:00Z",
        "updated_at":        "2026-08-26T00:00:00Z",
    })
    db.campaigns.insert_one({
        "id":               campaign_id,
        "name":             f"iter164ag campaign {tag}",
        "template":         "announcement",
        "status":           "sent",
        "audience_filter":  {"audience_kind": "outreach_contacts",
                             "outreach": {"tags_any": [tag]}},
        "stats":            {"targeted": 1, "accepted": 1, "failed": 0,
                             "delivered": 0, "opened": 0, "clicked": 0,
                             "bounced": 0},
        "created_at":       "2026-08-26T00:00:00Z",
        "sent_at":          "2026-08-26T00:00:00Z",
    })
    recipient_id = str(uuid.uuid4())
    db.campaign_recipients.insert_one({
        "id":              recipient_id,
        "campaign_id":     campaign_id,
        "founder_id":      org_id,        # iter164ag: also as legacy
        "outreach_id":     org_id,        # iter164ag: NEW field
        "audience_kind":   "outreach_contacts",
        "email":           email,
        "message_id":      message_id,
        "status":          "sent",
        "sent_at":         "2026-08-26T00:00:00Z",
    })
    yield {
        "tag":          tag,
        "campaign_id":  campaign_id,
        "recipient_id": recipient_id,
        "org_id":       org_id,
        "email":        email,
        "message_id":   message_id,
    }
    db.outreach_organisations.delete_one({"id": org_id})
    db.campaigns.delete_one({"id": campaign_id})
    db.campaign_recipients.delete_one({"id": recipient_id})
    db.campaign_recipient_events.delete_many({"campaign_id": campaign_id})
    db.resend_webhook_events.delete_many(
        {"payload.data.email_id": message_id},
    )


# ---------------------------------------------------------------------------
# 1. Signed webhook → rollup update for outreach recipient (no founder).
# ---------------------------------------------------------------------------

def test_outreach_delivered_updates_stats(webhook_secret_bytes, outreach_send, db):
    r = _sign_and_post(webhook_secret_bytes, "email.delivered",
                       outreach_send["message_id"])
    assert r.status_code == 200, r.text
    assert r.json()["matched"] is True

    cp = db.campaigns.find_one({"id": outreach_send["campaign_id"]},
                               {"_id": 0, "stats": 1})
    assert cp["stats"]["delivered"] == 1
    recip = db.campaign_recipients.find_one(
        {"id": outreach_send["recipient_id"]}, {"_id": 0, "status": 1,
                                                "delivered_at": 1},
    )
    assert recip["status"] == "delivered"
    assert recip["delivered_at"]


def test_outreach_opened_and_clicked_bump_unique_counters(
    webhook_secret_bytes, outreach_send, db,
):
    for evt in ("email.delivered", "email.opened", "email.opened",
                "email.clicked"):
        r = _sign_and_post(webhook_secret_bytes, evt,
                           outreach_send["message_id"])
        assert r.status_code == 200, r.text

    cp = db.campaigns.find_one({"id": outreach_send["campaign_id"]},
                               {"_id": 0, "stats": 1})
    stats = cp["stats"]
    # Two opens hit → total opened=2, unique_opens=1.
    assert stats["opened"] == 2
    assert stats.get("unique_opens") == 1
    assert stats["clicked"] == 1
    assert stats.get("unique_clicks") == 1

    recip = db.campaign_recipients.find_one(
        {"id": outreach_send["recipient_id"]},
        {"_id": 0, "open_count": 1, "click_count": 1,
         "first_opened_at": 1, "first_clicked_at": 1},
    )
    assert recip["open_count"] == 2
    assert recip["click_count"] == 1
    # "First" timestamps stay pinned to the first fire.
    assert recip["first_opened_at"]
    assert recip["first_clicked_at"]


# ---------------------------------------------------------------------------
# 2. Bounce on an outreach recipient flags the outreach org, NOT the
#    interest_registrations collection (which has no matching row).
# ---------------------------------------------------------------------------

def test_outreach_bounce_flags_outreach_org(
    webhook_secret_bytes, outreach_send, db,
):
    r = _sign_and_post(webhook_secret_bytes, "email.bounced",
                       outreach_send["message_id"])
    assert r.status_code == 200, r.text

    org = db.outreach_organisations.find_one(
        {"id": outreach_send["org_id"]},
        {"_id": 0, "email_invalid": 1, "email_invalid_reason": 1,
         "status": 1},
    )
    assert org["email_invalid"] is True
    assert org["email_invalid_reason"] == "bounce"
    assert org["status"] == "email_invalid"

    # No collateral write on the founders collection.
    fm = db.interest_registrations.find_one(
        {"id": outreach_send["org_id"]},
    )
    assert fm is None, "outreach bounce must not create/update an IR row"


def test_outreach_complaint_flags_outreach_org(
    webhook_secret_bytes, outreach_send, db,
):
    r = _sign_and_post(webhook_secret_bytes, "email.complained",
                       outreach_send["message_id"])
    assert r.status_code == 200, r.text

    org = db.outreach_organisations.find_one(
        {"id": outreach_send["org_id"]},
        {"_id": 0, "status": 1, "opted_out_reason": 1},
    )
    assert org["status"] == "opted_out"
    assert org["opted_out_reason"] == "spam_complaint"


# ---------------------------------------------------------------------------
# 3. Extended /health diagnostic surfaces recent 24h activity.
# ---------------------------------------------------------------------------

def test_webhook_health_includes_recent_activity(
    webhook_secret_bytes, outreach_send,
):
    # Fire a few events so the aggregate is non-empty.
    for evt in ("email.delivered", "email.opened"):
        _sign_and_post(webhook_secret_bytes, evt,
                       outreach_send["message_id"])

    r = requests.get(f"{BASE}/api/webhooks/resend/health", timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["secret_configured"] is True
    assert body["route"] == "/api/webhooks/resend"
    recent = body.get("recent") or {}
    assert "events_by_type" in recent
    assert recent["events_by_type"].get("email.delivered", 0) >= 1
    assert recent["events_by_type"].get("email.opened",    0) >= 1
    assert recent["total_24h"] >= 2
    assert recent["last_event_at"]


# ---------------------------------------------------------------------------
# 4. Reconcile endpoint rebuilds a campaign's stats from the raw log.
#    Idempotent: running it twice gives the same numbers.
# ---------------------------------------------------------------------------

def test_reconcile_stats_rebuilds_from_raw_log(
    webhook_secret_bytes, outreach_send, admin_token, db,
):
    # 1. Post a set of events.
    for evt in ("email.delivered", "email.opened", "email.opened",
                "email.clicked"):
        _sign_and_post(webhook_secret_bytes, evt,
                       outreach_send["message_id"])

    # 2. Zero the campaign stats (simulate a dropped rollup).
    db.campaigns.update_one(
        {"id": outreach_send["campaign_id"]},
        {"$set": {"stats.delivered": 0, "stats.opened": 0,
                  "stats.clicked": 0, "stats.unique_opens": 0,
                  "stats.unique_clicks": 0}},
    )

    # 3. Reconcile.
    r = requests.post(
        f"{BASE}/api/cms/campaigns/{outreach_send['campaign_id']}/reconcile-stats",
        headers={"Authorization": f"Bearer {admin_token}"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["recipients_matched"] >= 4  # 4 events, all matched
    assert body["events_by_type"].get("email.delivered", 0) == 1
    assert body["events_by_type"].get("email.opened",    0) == 2
    assert body["events_by_type"].get("email.clicked",   0) == 1
    stats = body["stats_after"]
    assert stats["delivered"] == 1
    assert stats["opened"]    == 2
    assert stats["clicked"]   == 1
    assert stats.get("unique_opens")  == 1
    assert stats.get("unique_clicks") == 1

    # 4. Idempotency — running it again yields the same numbers.
    r2 = requests.post(
        f"{BASE}/api/cms/campaigns/{outreach_send['campaign_id']}/reconcile-stats",
        headers={"Authorization": f"Bearer {admin_token}"},
        timeout=15,
    )
    assert r2.status_code == 200, r2.text
    stats2 = r2.json()["stats_after"]
    assert stats2["delivered"]        == 1
    assert stats2["opened"]           == 2
    assert stats2["clicked"]          == 1
    assert stats2.get("unique_opens") == 1
    assert stats2.get("unique_clicks") == 1


# ---------------------------------------------------------------------------
# 5. Signature verification — invalid signature returns 401 and does
#    NOT touch any state.
# ---------------------------------------------------------------------------

def test_bad_signature_rejected_with_401(outreach_send, db):
    body = json.dumps({
        "type": "email.delivered",
        "created_at": "2026-08-26T01:00:00Z",
        "data": {"email_id": outreach_send["message_id"]},
    }).encode("utf-8")
    svix_id = f"msg_{uuid.uuid4().hex[:16]}"
    svix_ts = str(int(time.time()))
    r = requests.post(
        f"{BASE}/api/webhooks/resend",
        data=body,
        headers={
            "Content-Type":   "application/json",
            "svix-id":        svix_id,
            "svix-timestamp": svix_ts,
            "svix-signature": "v1,not-a-real-signature",
        }, timeout=10,
    )
    assert r.status_code == 401, r.text
    # No stats bump.
    cp = db.campaigns.find_one({"id": outreach_send["campaign_id"]},
                               {"_id": 0, "stats": 1})
    assert cp["stats"]["delivered"] == 0


# ---------------------------------------------------------------------------
# 6. Message ID join contract — a webhook for an unknown email_id
#    returns 200 with matched=False and doesn't error.
# ---------------------------------------------------------------------------

def test_unknown_email_id_accepted_but_not_matched(webhook_secret_bytes):
    r = _sign_and_post(webhook_secret_bytes, "email.delivered",
                       f"nonexistent-{uuid.uuid4().hex}")
    assert r.status_code == 200
    body = r.json()
    assert body["matched"] is False
