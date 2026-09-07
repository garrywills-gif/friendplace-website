"""iter164be — outreach campaigns send from the Community mailbox.

Runs the FastAPI app IN-PROCESS with a MOCKED sender that captures the
kwargs — NOT A SINGLE real email is sent. Confirms:
  • an outreach campaign test-send passes
    from_email=community@friendplace.com.au /
    from_name="FriendPlace Community Team"
  • a founding-members (transactional) campaign passes NEITHER override
    (so it keeps the configured noreply@ identity)
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

_LOOP = asyncio.new_event_loop()
asyncio.set_event_loop(_LOOP)

import email_service  # noqa: E402
from email_service import SendResult  # noqa: E402
import server  # noqa: E402

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


def _seed(mdb, *, kind):
    cid = str(uuid.uuid4())
    mdb.campaigns.insert_one({
        "id": cid, "name": "iter164be", "template": "announcement",
        "title": "Update", "body_md": "Hello.", "companion": "team",
        "subject": "News", "status": "draft",
        "audience_filter": {"audience_kind": kind},
        "created_at": "2026-09-03T00:00:00Z", "updated_at": "2026-09-03T00:00:00Z",
    })
    return cid


def _capturing_sender(box):
    async def _m(**kw):
        box.append(kw)
        return SendResult(ok=True, message_id="cap-msg", http_status=200)
    return _m


async def _run(fn):
    async with AsyncClient(transport=ASGITransport(app=server.app), base_url="http://t") as ac:
        r = await ac.post("/api/cms/auth/login",
                          json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200, r.text
        headers = {"Authorization": f"Bearer {r.json()['token']}"}
        return await fn(ac, headers)


def test_outreach_test_send_uses_community_sender(mdb, monkeypatch, loop):
    cid = _seed(mdb, kind="outreach_contacts")
    box: list = []
    monkeypatch.setattr(email_service, "send_email_detailed", _capturing_sender(box))
    try:
        async def scenario(ac, headers):
            return await ac.post(f"/api/cms/campaigns/{cid}/test-send",
                                 headers=headers, json={})
        r = loop.run_until_complete(_run(scenario))
        assert r.status_code == 200, r.text
        assert len(box) == 1
        assert box[0].get("from_email") == "community@friendplace.com.au"
        assert box[0].get("from_name") == "FriendPlace Community Team"
    finally:
        mdb.campaigns.delete_one({"id": cid})


def test_transactional_test_send_keeps_default_sender(mdb, monkeypatch, loop):
    cid = _seed(mdb, kind="founding_members")
    box: list = []
    monkeypatch.setattr(email_service, "send_email_detailed", _capturing_sender(box))
    try:
        async def scenario(ac, headers):
            return await ac.post(f"/api/cms/campaigns/{cid}/test-send",
                                 headers=headers, json={})
        r = loop.run_until_complete(_run(scenario))
        assert r.status_code == 200, r.text
        assert len(box) == 1
        # No overrides -> falls through to the configured noreply@ identity.
        assert box[0].get("from_email") is None
        assert box[0].get("from_name") is None
    finally:
        mdb.campaigns.delete_one({"id": cid})
