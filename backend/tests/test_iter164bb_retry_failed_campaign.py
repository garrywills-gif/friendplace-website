"""iter164bb — Retry failed campaign emails + failed-recipient timeline.

Runs the FastAPI app IN-PROCESS with a MOCKED sender, so NOT A SINGLE
real email is sent (the live Resend key is never exercised). Covers:
  • eligibility computed from live failed rows, never a stale aggregate
  • only status=="failed" recipients are retried (sent/bounced untouched)
  • success flips failed→sent and moves KPI failed→accepted
  • repeat failure keeps "failed", stores the real provider error
  • original failure is preserved; each retry appends a new event
  • the retry_in_progress guard is cleared afterwards
  • timeline shows the actual failure reason, not "Sent"
"""

from __future__ import annotations

import asyncio
import os
import uuid

import pytest
from dotenv import load_dotenv
from httpx import ASGITransport, AsyncClient
from pymongo import MongoClient

load_dotenv("/app/backend/.env")

# Motor's AsyncIOMotorClient binds to the current event loop at
# construction time (which happens when `server` is imported). Make our
# long-lived test loop the current one BEFORE importing server, so every
# await in this module runs on the same loop the db client is bound to.
_LOOP = asyncio.new_event_loop()
asyncio.set_event_loop(_LOOP)

import email_service  # noqa: E402
from email_service import SendResult  # noqa: E402
import server  # noqa: E402  (imports the FastAPI app + module-level db)

ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASSWORD = "TestPass2026!"


@pytest.fixture(scope="module")
def mdb():
    client = MongoClient(os.environ["MONGO_URL"])
    yield client[os.environ.get("DB_NAME", "test_database")]
    client.close()


@pytest.fixture(scope="module")
def loop():
    yield _LOOP
    _LOOP.close()


def _seed_campaign(mdb, *, failed=3, extra=True):
    cid = str(uuid.uuid4())
    stats = {"targeted": failed + (2 if extra else 0),
             "accepted": (1 if extra else 0), "failed": failed,
             "delivered": 0, "opened": 0, "clicked": 0, "bounced": 0}
    mdb.campaigns.insert_one({
        "id": cid, "name": "iter164bb", "template": "announcement",
        "title": "Update", "body_md": "Hello everyone.", "companion": "george",
        "subject": "News", "status": "sent", "stats": stats,
        "audience_filter": {"audience_kind": "founding_members"},
        "created_at": "2026-09-03T00:00:00Z", "updated_at": "2026-09-03T00:00:00Z",
    })
    rids = []
    for i in range(failed):
        rid = str(uuid.uuid4())
        rids.append(rid)
        mdb.campaign_recipients.insert_one({
            "id": rid, "campaign_id": cid, "founder_id": str(uuid.uuid4()),
            "first_name": f"Fail{i}", "email": f"fail{i}-{cid[:6]}@example.com",
            "status": "failed", "message_id": None,
            "error": "Reached the daily sending quota", "http_status": 429,
            "sent_at": "2026-09-03T01:00:00Z", "subject": "News",
        })
    if extra:
        mdb.campaign_recipients.insert_one({
            "id": str(uuid.uuid4()), "campaign_id": cid, "founder_id": str(uuid.uuid4()),
            "first_name": "Good", "email": f"good-{cid[:6]}@example.com",
            "status": "sent", "message_id": "msg-ok", "error": None,
            "sent_at": "2026-09-03T01:00:00Z", "subject": "News",
        })
        mdb.campaign_recipients.insert_one({
            "id": str(uuid.uuid4()), "campaign_id": cid, "founder_id": str(uuid.uuid4()),
            "first_name": "Bounced", "email": f"bounce-{cid[:6]}@example.com",
            "status": "bounced", "message_id": "msg-b", "error": None,
            "sent_at": "2026-09-03T01:00:00Z", "subject": "News",
        })
    return cid, rids


def _cleanup(mdb, cid):
    mdb.campaigns.delete_one({"id": cid})
    mdb.campaign_recipients.delete_many({"campaign_id": cid})
    mdb.campaign_recipient_events.delete_many({"campaign_id": cid})


async def _run(fn):
    async with AsyncClient(transport=ASGITransport(app=server.app), base_url="http://t") as ac:
        r = await ac.post("/api/cms/auth/login",
                          json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200, r.text
        headers = {"Authorization": f"Bearer {r.json()['token']}"}
        return await fn(ac, headers)


def _ok_sender(mid="retry-msg"):
    async def _m(**kw):
        return SendResult(ok=True, message_id=mid, http_status=200)
    return _m


def _fail_sender(err="Reached the daily sending quota", code=429):
    async def _m(**kw):
        return SendResult(ok=False, message_id=None, http_status=code, error=err,
                          error_code="rate_limit_exceeded")
    return _m


# ---------------------------------------------------------------------------

def test_retry_success_moves_failed_to_accepted(mdb, monkeypatch, loop):
    cid, rids = _seed_campaign(mdb, failed=3, extra=True)
    monkeypatch.setattr(email_service, "send_email_detailed", _ok_sender())
    try:
        async def scenario(ac, headers):
            return await ac.post(f"/api/cms/campaigns/{cid}/retry-failed", headers=headers)
        r = loop.run_until_complete(_run(scenario))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["eligible"] == 3
        assert body["retried"] == 3
        assert body["succeeded"] == 3
        assert body["failed_again"] == 0

        # the 3 failed are now sent; sent + bounced untouched
        for rid in rids:
            row = mdb.campaign_recipients.find_one({"id": rid})
            assert row["status"] == "sent"
            assert row["error"] is None
            assert row["message_id"] == "retry-msg"
        assert mdb.campaign_recipients.count_documents({"campaign_id": cid, "status": "bounced"}) == 1

        # KPI moved failed -> accepted
        c = mdb.campaigns.find_one({"id": cid})
        assert c["stats"]["failed"] == 0
        assert c["stats"]["accepted"] == 4
        assert "retry_in_progress" not in c or not c.get("retry_in_progress")

        # history preserved: original failure + retry success per recipient
        for rid in rids:
            evs = list(mdb.campaign_recipient_events.find({"recipient_id": rid}))
            types = {e["type"] for e in evs}
            assert "email.failed" in types
            assert "email.retry_succeeded" in types
    finally:
        _cleanup(mdb, cid)


def test_retry_failure_preserves_state_and_reason(mdb, monkeypatch, loop):
    cid, rids = _seed_campaign(mdb, failed=2, extra=False)
    monkeypatch.setattr(email_service, "send_email_detailed",
                        _fail_sender(err="Reached the daily sending quota"))
    try:
        async def scenario(ac, headers):
            return await ac.post(f"/api/cms/campaigns/{cid}/retry-failed", headers=headers)
        r = loop.run_until_complete(_run(scenario))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["succeeded"] == 0
        assert body["failed_again"] == 2

        c = mdb.campaigns.find_one({"id": cid})
        assert c["stats"]["failed"] == 2   # unchanged
        assert c["stats"]["accepted"] == 0
        for rid in rids:
            row = mdb.campaign_recipients.find_one({"id": rid})
            assert row["status"] == "failed"
            assert row["error"] == "Reached the daily sending quota"
            assert row["retry_count"] == 1
            types = {e["type"] for e in mdb.campaign_recipient_events.find({"recipient_id": rid})}
            assert "email.failed" in types and "email.retry_failed" in types
    finally:
        _cleanup(mdb, cid)


def test_eligible_uses_live_rows_not_stale_stat(mdb, monkeypatch, loop):
    cid, _ = _seed_campaign(mdb, failed=0, extra=False)
    # Corrupt the aggregate to prove we don't trust it.
    mdb.campaigns.update_one({"id": cid}, {"$set": {"stats.failed": 99}})
    monkeypatch.setattr(email_service, "send_email_detailed", _ok_sender())
    try:
        async def scenario(ac, headers):
            return await ac.post(f"/api/cms/campaigns/{cid}/retry-failed", headers=headers)
        r = loop.run_until_complete(_run(scenario))
        assert r.status_code == 200, r.text
        assert r.json()["eligible"] == 0
        assert r.json()["retried"] == 0
    finally:
        _cleanup(mdb, cid)


def test_timeline_shows_failure_reason_not_sent(mdb, monkeypatch, loop):
    cid, rids = _seed_campaign(mdb, failed=1, extra=False)
    try:
        async def scenario(ac, headers):
            return await ac.get(f"/api/cms/campaigns/{cid}/recipients/{rids[0]}/timeline", headers=headers)
        r = loop.run_until_complete(_run(scenario))
        assert r.status_code == 200, r.text
        events = r.json()["events"]
        types = [e["type"] for e in events]
        assert "email.failed" in types
        assert "email.sent" not in types
        failed_ev = next(e for e in events if e["type"] == "email.failed")
        assert failed_ev["meta"]["error"] == "Reached the daily sending quota"
    finally:
        _cleanup(mdb, cid)
