"""iter164bh — MCGS Inbox: reply preview, sent view, permanent delete,
shared reply renderer (preview == sent), mailbox preservation.

In-process FastAPI app with a MOCKED sender — NO real email is sent.
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
import services.email_inbox.router as inbox_router  # noqa: E402
from email_service import SendResult  # noqa: E402
import server  # noqa: E402
from services.email_inbox import store as inbox_store  # noqa: E402

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


def _seed_inbound(mdb, *, tag, mailbox):
    mid = str(uuid.uuid4())
    mdb.inbox_messages.insert_one({
        "id": mid, "mailbox": mailbox, "direction": "inbound",
        "from_email": f"visitor-{tag}@example.com", "from_name": "Visitor",
        "to_email": mailbox, "subject": "Question about FriendPlace",
        "subject_norm": "question about friendplace", "text": "Hi, how do I join?",
        "html": "", "snippet": "Hi, how do I join?", "message_id": f"in-{tag}",
        "thread_id": mid, "read": False, "archived_at": None,
        "received_at": "2026-09-03T00:00:00Z", "created_at": "2026-09-03T00:00:00Z",
        "references": [],
    })
    return mid


async def _run(fn):
    async with AsyncClient(transport=ASGITransport(app=server.app), base_url="http://t") as ac:
        r = await ac.post("/api/cms/auth/login",
                          json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200, r.text
        headers = {"Authorization": f"Bearer {r.json()['token']}"}
        return await fn(ac, headers)


def _capturing_sender(box):
    async def _m(**kw):
        box.append(kw)
        return SendResult(ok=True, message_id="reply-mid", http_status=200)
    return _m


# --------------------------------------------------------------------------

def test_shared_renderer_matches_and_has_footer():
    parent = {"from_email": "Visitor@Example.com", "subject": "Hello",
              "mailbox": "hello@friendplace.com.au", "message_id": "x", "references": []}
    r = inbox_store.render_reply_email(
        parent=parent, mailbox="hello@friendplace.com.au",
        subject=None, text="Thanks for reaching out!")
    assert r["subject"] == "Re: Hello"                    # Re: prefix
    assert r["from_email"] == "hello@friendplace.com.au"  # sending mailbox
    assert r["to_email"] == "visitor@example.com"         # original sender
    assert "Thanks for reaching out!" in r["html"]        # reply body
    assert "The FriendPlace Team" in r["html"]            # built-in sign-off
    assert "friendplace.com.au" in r["html"]
    assert "The FriendPlace Team" in r["text"]
    # already-Re: subject is not double-prefixed
    r2 = inbox_store.render_reply_email(
        parent={**parent, "subject": "Re: Hello"}, mailbox="x@y.com",
        subject=None, text="ok")
    assert r2["subject"] == "Re: Hello"


def test_preview_equals_send_and_preserves_mailbox(mdb, monkeypatch, loop):
    tag = uuid.uuid4().hex[:8]
    mailbox = "support@friendplace.com.au"
    mid = _seed_inbound(mdb, tag=tag, mailbox=mailbox)
    box: list = []
    monkeypatch.setattr(inbox_router, "send_email_detailed", _capturing_sender(box))
    try:
        async def scenario(ac, headers):
            body = {"body_text": "Here's how to join FriendPlace."}
            pv = await ac.post(f"/api/cms/email/messages/{mid}/reply-preview",
                               headers=headers, json=body)
            snd = await ac.post(f"/api/cms/email/messages/{mid}/reply",
                                headers=headers, json=body)
            return pv, snd
        pv, snd = loop.run_until_complete(_run(scenario))
        assert pv.status_code == 200, pv.text
        assert snd.status_code == 200, snd.text
        pvj, sndj = pv.json(), snd.json()
        # Preview HTML == what was actually sent (mocked sender captured it).
        assert len(box) == 1
        sent_kwargs = box[0]
        assert pvj["html"] == sent_kwargs["html"]
        assert pvj["subject"] == sent_kwargs["subject"] == "Re: Question about FriendPlace"
        # Mailbox preserved: reply sent FROM the exact mailbox it was addressed to.
        assert sent_kwargs["from_email"] == mailbox
        assert sent_kwargs["reply_to"] == mailbox
        assert sent_kwargs["to"] == f"visitor-{tag}@example.com"
        # Confirmation payload carries the actual mailbox.
        assert sndj["from"] == mailbox
    finally:
        mdb.inbox_messages.delete_many({"$or": [{"id": mid}, {"thread_id": mid}]})


def test_sent_view_lists_outbound(mdb, monkeypatch, loop):
    tag = uuid.uuid4().hex[:8]
    mailbox = "hello@friendplace.com.au"
    mid = _seed_inbound(mdb, tag=tag, mailbox=mailbox)
    monkeypatch.setattr(inbox_router, "send_email_detailed", _capturing_sender([]))
    try:
        async def scenario(ac, headers):
            await ac.post(f"/api/cms/email/messages/{mid}/reply",
                          headers=headers, json={"body_text": "Reply body here."})
            return await ac.get("/api/cms/email/sent?limit=50", headers=headers)
        r = loop.run_until_complete(_run(scenario))
        assert r.status_code == 200, r.text
        rows = r.json()["rows"]
        mine = [x for x in rows if x["to_email"] == f"visitor-{tag}@example.com"]
        assert len(mine) == 1
        rec = mine[0]
        assert rec["direction"] == "outbound"
        assert rec["mailbox"] == mailbox                 # sending mailbox
        assert rec["subject"].startswith("Re:")
        assert rec["to_email"] == f"visitor-{tag}@example.com"
        assert rec.get("created_at")                     # sent time
    finally:
        mdb.inbox_messages.delete_many({"$or": [{"id": mid}, {"thread_id": mid}]})


def test_permanent_delete(mdb, loop):
    tag = uuid.uuid4().hex[:8]
    mid = _seed_inbound(mdb, tag=tag, mailbox="hello@friendplace.com.au")
    try:
        async def scenario(ac, headers):
            d = await ac.delete(f"/api/cms/email/messages/{mid}", headers=headers)
            d2 = await ac.delete(f"/api/cms/email/messages/{mid}", headers=headers)  # already gone
            return d, d2
        d, d2 = loop.run_until_complete(_run(scenario))
        assert d.status_code == 200 and d.json()["ok"] is True
        assert d2.status_code == 404                       # irreversible — really gone
        assert mdb.inbox_messages.find_one({"id": mid}) is None
    finally:
        mdb.inbox_messages.delete_many({"id": mid})
