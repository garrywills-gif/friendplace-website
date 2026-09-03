"""iter164bc — Resend native inbound webhook (email.received) for the Inbox.

Runs the app IN-PROCESS with a MOCKED Resend fetch, so no real Resend API
call and no email is ever sent. Verifies:
  • Svix signature verification against RESEND_INBOUND_WEBHOOK_SECRET
  • email.received is accepted; body fetched by email_id and stored
  • message stored against the correct FriendPlace mailbox
  • sender / subject / message-id / received timestamp / body / thread kept
  • bad signature → 401; other event types → 200 ignored
The campaign webhook is untouched (separate secret + endpoint).
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import os
import time
import uuid

import pytest
from dotenv import load_dotenv
from httpx import ASGITransport, AsyncClient
from pymongo import MongoClient

load_dotenv("/app/backend/.env")

_LOOP = asyncio.new_event_loop()
asyncio.set_event_loop(_LOOP)

from services.email_inbox import store  # noqa: E402
import server  # noqa: E402

SECRET_KEY = os.urandom(24)
SECRET = "whsec_" + base64.b64encode(SECRET_KEY).decode()


@pytest.fixture(scope="module")
def mdb():
    client = MongoClient(os.environ["MONGO_URL"])
    yield client[os.environ.get("DB_NAME", "test_database")]
    client.close()


@pytest.fixture(scope="module")
def loop():
    yield _LOOP
    _LOOP.close()


def _sign(raw: bytes):
    svix_id = f"msg_{uuid.uuid4().hex}"
    ts = str(int(time.time()))
    signed = f"{svix_id}.{ts}.".encode() + raw
    sig = base64.b64encode(hmac.new(SECRET_KEY, signed, hashlib.sha256).digest()).decode()
    return {"svix-id": svix_id, "svix-timestamp": ts, "svix-signature": f"v1,{sig}"}


async def _post(body: dict, *, headers):
    raw = json.dumps(body).encode()
    async with AsyncClient(transport=ASGITransport(app=server.app), base_url="http://t") as ac:
        return await ac.post("/api/cms/email/inbound", content=raw, headers=headers)


def _received_event(email_id, to, frm, subject, message_id):
    return {
        "type": "email.received",
        "created_at": "2026-09-03T10:00:00.000Z",
        "data": {
            "email_id": email_id,
            "created_at": "2026-09-03T09:59:59.000Z",
            "from": frm,
            "to": [to],
            "message_id": message_id,
            "subject": subject,
        },
    }


def test_signed_email_received_is_fetched_and_stored(mdb, monkeypatch, loop):
    monkeypatch.setenv("RESEND_INBOUND_WEBHOOK_SECRET", SECRET)
    email_id = str(uuid.uuid4())
    tag = uuid.uuid4().hex[:8]
    mid = f"<{tag}@sender.com>"

    async def fake_fetch(eid):
        assert eid == email_id
        return {
            "id": eid, "from": f"pat-{tag}@example.com", "to": ["support@friendplace.com.au"],
            "subject": "Need help please",
            "html": "<p>Hello team</p>", "text": "Hello team",
            "message_id": mid,
            "headers": {"from": f'Pat Jones <pat-{tag}@example.com>'},
            "created_at": "2026-09-03T09:59:59.000Z",
        }
    monkeypatch.setattr(store, "fetch_received_email", fake_fetch)

    body = _received_event(email_id, "support@friendplace.com.au", f"pat-{tag}@example.com",
                           "Need help please", mid)
    raw = json.dumps(body).encode()
    r = loop.run_until_complete(_post(body, headers=_sign(raw)))
    try:
        assert r.status_code == 200, r.text
        stored = mdb.inbox_messages.find_one({"resend_email_id": email_id})
        assert stored is not None
        assert stored["mailbox"] == "support@friendplace.com.au"
        assert stored["from_email"] == f"pat-{tag}@example.com"
        assert stored["from_name"] == "Pat Jones"
        assert stored["subject"] == "Need help please"
        assert stored["text"] == "Hello team"
        assert stored["html"] == "<p>Hello team</p>"
        assert stored["message_id"] == mid
        assert stored["read"] is False
        assert stored["received_at"].startswith("2026-09-03")
        assert stored["thread_id"]
    finally:
        mdb.inbox_messages.delete_many({"resend_email_id": email_id})


def test_bad_signature_rejected(mdb, monkeypatch, loop):
    monkeypatch.setenv("RESEND_INBOUND_WEBHOOK_SECRET", SECRET)
    monkeypatch.setattr(store, "fetch_received_email", lambda eid: {})
    body = _received_event(str(uuid.uuid4()), "hello@friendplace.com.au", "x@y.com", "Hi", "<1@x>")
    bad = {"svix-id": "msg_x", "svix-timestamp": str(int(time.time())), "svix-signature": "v1,not-a-valid-sig"}
    r = loop.run_until_complete(_post(body, headers=bad))
    assert r.status_code == 401, r.text


def test_other_event_type_ignored(mdb, monkeypatch, loop):
    monkeypatch.setenv("RESEND_INBOUND_WEBHOOK_SECRET", SECRET)
    body = {"type": "email.delivered", "data": {"email_id": "x"}}
    raw = json.dumps(body).encode()
    r = loop.run_until_complete(_post(body, headers=_sign(raw)))
    assert r.status_code == 200
    assert r.json().get("ignored") == "email.delivered"


def test_threading_via_in_reply_to(mdb, monkeypatch, loop):
    monkeypatch.setenv("RESEND_INBOUND_WEBHOOK_SECRET", SECRET)
    tag = uuid.uuid4().hex[:8]
    e1, e2 = str(uuid.uuid4()), str(uuid.uuid4())
    m1 = f"<{tag}-1@x.com>"
    m2 = f"<{tag}-2@x.com>"

    fulls = {
        e1: {"id": e1, "from": f"a-{tag}@x.com", "to": ["hello@friendplace.com.au"],
             "subject": "Topic", "text": "one", "message_id": m1, "headers": {}},
        e2: {"id": e2, "from": f"a-{tag}@x.com", "to": ["hello@friendplace.com.au"],
             "subject": "Re: Topic", "text": "two", "message_id": m2,
             "headers": {"in-reply-to": m1}},
    }

    async def fake_fetch(eid):
        return fulls[eid]
    monkeypatch.setattr(store, "fetch_received_email", fake_fetch)

    b1 = _received_event(e1, "hello@friendplace.com.au", f"a-{tag}@x.com", "Topic", m1)
    b2 = _received_event(e2, "hello@friendplace.com.au", f"a-{tag}@x.com", "Re: Topic", m2)
    try:
        loop.run_until_complete(_post(b1, headers=_sign(json.dumps(b1).encode())))
        loop.run_until_complete(_post(b2, headers=_sign(json.dumps(b2).encode())))
        r1 = mdb.inbox_messages.find_one({"resend_email_id": e1})
        r2 = mdb.inbox_messages.find_one({"resend_email_id": e2})
        assert r1 and r2 and r1["thread_id"] == r2["thread_id"]
    finally:
        mdb.inbox_messages.delete_many({"resend_email_id": {"$in": [e1, e2]}})
