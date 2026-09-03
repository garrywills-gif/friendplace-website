"""iter164ba — MCGS combined email inbox.

Covers: default mailbox seeding, inbound webhook ingestion + threading,
combined list with per-mailbox unread, open/mark-read, mark unread,
archive/restore, unread-count, add/remove mailbox (no code change), and
reply guard rails (we do NOT trigger a real Resend send in tests).
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


def _inbound(to, frm, subject, text, *, message_id=None, in_reply_to=None):
    payload = {
        "to": to, "from": {"email": frm, "name": "Test Sender"},
        "subject": subject, "text": text,
        "message_id": message_id or f"<{uuid.uuid4()}@mail>",
    }
    if in_reply_to:
        payload["in_reply_to"] = in_reply_to
    r = requests.post(f"{BASE}/cms/email/inbound", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def cleanup(db):
    tag = f"iter164ba-{uuid.uuid4().hex[:8]}"
    yield tag
    db.inbox_messages.delete_many({"from_email": {"$regex": tag}})


def test_default_mailboxes_seeded(auth):
    r = requests.get(f"{BASE}/cms/email/mailboxes", headers=auth)
    assert r.status_code == 200, r.text
    addrs = {m["address"] for m in r.json()["mailboxes"]}
    for a in ["hello@friendplace.com.au", "support@friendplace.com.au",
              "enquiries@friendplace.com.au", "garry@friendplace.com.au",
              "privacy@friendplace.com.au"]:
        assert a in addrs, addrs


def test_inbound_list_read_archive_flow(db, auth, cleanup):
    frm = f"{cleanup}@example.com"
    ing = _inbound("support@friendplace.com.au", frm, "Need help", "Please help me.")
    mid_row = db.inbox_messages.find_one({"id": ing["id"]}, {"_id": 0})
    assert mid_row["mailbox"] == "support@friendplace.com.au"
    assert mid_row["read"] is False

    # unread-count reflects it
    base_unread = requests.get(f"{BASE}/cms/email/unread-count", headers=auth).json()["count"]
    assert base_unread >= 1

    # appears in combined list; shows which mailbox
    lst = requests.get(f"{BASE}/cms/email/messages?mailbox=support@friendplace.com.au", headers=auth).json()
    ids = {r["id"] for r in lst["rows"]}
    assert ing["id"] in ids
    assert any(m["address"] == "support@friendplace.com.au" and m["unread"] >= 1
               for m in lst["mailboxes"])

    # open marks read
    got = requests.get(f"{BASE}/cms/email/messages/{ing['id']}", headers=auth).json()
    assert got["message"]["read"] is True
    assert got["message"]["mailbox"] == "support@friendplace.com.au"

    # mark unread again
    r = requests.post(f"{BASE}/cms/email/messages/{ing['id']}/read",
                      json={"read": False}, headers=auth)
    assert r.status_code == 200 and r.json()["read"] is False

    # archive → drops from active, shows in archived
    requests.post(f"{BASE}/cms/email/messages/{ing['id']}/archive", headers=auth)
    active_ids = {r["id"] for r in requests.get(f"{BASE}/cms/email/messages", headers=auth).json()["rows"]}
    assert ing["id"] not in active_ids
    arch_ids = {r["id"] for r in requests.get(f"{BASE}/cms/email/messages?archived=true", headers=auth).json()["rows"]}
    assert ing["id"] in arch_ids

    # restore
    requests.post(f"{BASE}/cms/email/messages/{ing['id']}/restore", headers=auth)
    active_ids2 = {r["id"] for r in requests.get(f"{BASE}/cms/email/messages", headers=auth).json()["rows"]}
    assert ing["id"] in active_ids2


def test_inbound_threading(db, auth, cleanup):
    frm = f"{cleanup}@example.com"
    m1 = _inbound("hello@friendplace.com.au", frm, "Question about groups", "First message.",
                  message_id=f"<{cleanup}-1@mail>")
    m2 = _inbound("hello@friendplace.com.au", frm, "Re: Question about groups", "Follow up.",
                  message_id=f"<{cleanup}-2@mail>", in_reply_to=f"<{cleanup}-1@mail>")
    r1 = db.inbox_messages.find_one({"id": m1["id"]})
    r2 = db.inbox_messages.find_one({"id": m2["id"]})
    assert r1["thread_id"] == r2["thread_id"]

    # thread view returns both, oldest first
    thread = requests.get(f"{BASE}/cms/email/messages/{m2['id']}", headers=auth).json()["thread"]
    assert len(thread) == 2

    # combined list collapses the thread to a single row
    lst = requests.get(f"{BASE}/cms/email/messages?mailbox=hello@friendplace.com.au&limit=500", headers=auth).json()
    thread_rows = [r for r in lst["rows"] if r["thread_id"] == r1["thread_id"]]
    assert len(thread_rows) == 1


def test_add_and_remove_mailbox_no_code_change(db, auth):
    addr = f"team-{uuid.uuid4().hex[:6]}@friendplace.com.au"
    try:
        r = requests.post(f"{BASE}/cms/email/mailboxes",
                          json={"address": addr, "label": "Team"}, headers=auth)
        assert r.status_code == 200, r.text
        addrs = {m["address"] for m in requests.get(f"{BASE}/cms/email/mailboxes", headers=auth).json()["mailboxes"]}
        assert addr in addrs
        # inbound to the brand-new mailbox routes correctly
        ing = _inbound(addr, "sender@example.com", "Hi new box", "Routing test")
        assert db.inbox_messages.find_one({"id": ing["id"]})["mailbox"] == addr
        db.inbox_messages.delete_one({"id": ing["id"]})

        mb_id = next(m["id"] for m in requests.get(f"{BASE}/cms/email/mailboxes", headers=auth).json()["mailboxes"] if m["address"] == addr)
        rd = requests.delete(f"{BASE}/cms/email/mailboxes/{mb_id}", headers=auth)
        assert rd.status_code == 200
        addrs2 = {m["address"] for m in requests.get(f"{BASE}/cms/email/mailboxes", headers=auth).json()["mailboxes"]}
        assert addr not in addrs2
    finally:
        db.inbox_mailboxes.delete_one({"address": addr})


def test_reply_guards(db, auth, cleanup):
    frm = f"{cleanup}@example.com"
    ing = _inbound("hello@friendplace.com.au", frm, "Ping", "hello")
    # empty body → 400
    r = requests.post(f"{BASE}/cms/email/messages/{ing['id']}/reply",
                      json={"body_text": "   "}, headers=auth)
    assert r.status_code == 400, r.text
    # unknown message → 404
    r = requests.post(f"{BASE}/cms/email/messages/{uuid.uuid4()}/reply",
                      json={"body_text": "hi"}, headers=auth)
    assert r.status_code == 404, r.text


def test_inbound_requires_recipient():
    r = requests.post(f"{BASE}/cms/email/inbound", json={"from": "x@y.com", "subject": "no to"})
    assert r.status_code == 400, r.text
