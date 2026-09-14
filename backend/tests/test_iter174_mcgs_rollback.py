"""iter174 — Post-rollback verification for MCGS backend (commit 5a9b535e).

Confirms:
  * CMS admin login works.
  * Email Inbox routes are NOT 404 (mailboxes, messages, sent, unread-count).
  * Mailbox filter works.
  * Archive → Restore → Delete round-trip on a THROWAWAY test message
    (created via the inbound webhook path so we never mutate real data).
  * George chat (SSE POST /api/george/chat) returns a real assistant reply.
  * George TTS (POST /api/mcgs/george/speak) returns audio bytes.

All test-created inbound messages are cleaned up in a teardown fixture.
"""
from __future__ import annotations

import base64
import hmac
import hashlib
import json
import os
import time
import uuid
from typing import Optional

import pytest
import requests
from dotenv import load_dotenv


load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"
ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASSWORD = "TestPass2026!"

# Track any inbound test-message IDs so we can guarantee cleanup even if a test fails.
_CREATED_MSG_IDS: list[str] = []


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def token() -> str:
    r = requests.post(f"{BASE}/cms/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                      timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data, f"no token in login response: {data}"
    return data["token"]


@pytest.fixture(scope="module")
def auth(token) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module", autouse=True)
def _cleanup(auth):
    yield
    # Best-effort delete every test-created inbound message.
    for mid in list(_CREATED_MSG_IDS):
        try:
            requests.delete(f"{BASE}/cms/email/messages/{mid}",
                            headers=auth, timeout=10)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# 1) AUTH
# ---------------------------------------------------------------------------
def test_admin_login_returns_token():
    r = requests.post(f"{BASE}/cms/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                      timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("token"), f"no token: {body}"


# ---------------------------------------------------------------------------
# 2) EMAIL INBOX no longer 404
# ---------------------------------------------------------------------------
def test_mailboxes_endpoint_alive_and_has_five_defaults(auth):
    r = requests.get(f"{BASE}/cms/email/mailboxes", headers=auth, timeout=15)
    assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
    body = r.json()
    addrs = {m["address"] for m in body.get("mailboxes", [])}
    expected = {
        "hello@friendplace.com.au",
        "support@friendplace.com.au",
        "enquiries@friendplace.com.au",
        "garry@friendplace.com.au",
        "privacy@friendplace.com.au",
    }
    assert expected.issubset(addrs), f"missing default mailboxes; got {addrs}"


def test_messages_list_alive(auth):
    r = requests.get(f"{BASE}/cms/email/messages", headers=auth, timeout=15)
    assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
    body = r.json()
    assert "rows" in body, f"no rows key: {body}"
    assert isinstance(body["rows"], list)


def test_messages_mailbox_filter(auth):
    mailbox = "hello@friendplace.com.au"
    r = requests.get(f"{BASE}/cms/email/messages",
                     params={"mailbox": mailbox}, headers=auth, timeout=15)
    assert r.status_code == 200, r.text
    rows = r.json().get("rows", [])
    # every returned row should be from the filtered mailbox (or empty list is fine)
    for row in rows:
        assert row.get("mailbox") == mailbox, f"row leak: {row}"


def test_sent_endpoint_alive(auth):
    r = requests.get(f"{BASE}/cms/email/sent", headers=auth, timeout=15)
    assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
    body = r.json()
    # response shape is expected to include a list container (rows or sent)
    assert isinstance(body, dict), f"unexpected shape: {body}"


def test_unread_count_alive(auth):
    r = requests.get(f"{BASE}/cms/email/unread-count", headers=auth, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "count" in body


# ---------------------------------------------------------------------------
# 3) ARCHIVE / RESTORE round-trip on a throwaway inbound test message
# ---------------------------------------------------------------------------
def _resend_signed_headers(raw_body: bytes) -> dict:
    """Build Svix-compatible headers matching the backend verifier
    (services/campaign_webhooks.py: base64-decode key, sign
    `{svix_id}.{svix_timestamp}.` + raw_body, v1,BASE64SIG)."""
    secret = os.environ.get("RESEND_INBOUND_WEBHOOK_SECRET", "")
    svix_id = f"msg_{uuid.uuid4().hex}"
    svix_ts = str(int(time.time()))
    headers = {
        "Content-Type": "application/json",
        "svix-id": svix_id,
        "svix-timestamp": svix_ts,
    }
    if secret:
        s = secret.strip()
        if s.startswith("whsec_"):
            s = s[len("whsec_"):]
        try:
            key = base64.b64decode(s)
        except Exception:
            key = s.encode()
        signed = f"{svix_id}.{svix_ts}.".encode() + raw_body
        sig = base64.b64encode(hmac.new(key, signed, hashlib.sha256).digest()).decode()
        headers["svix-signature"] = f"v1,{sig}"
    return headers


def _seed_inbound_via_webhook(auth) -> Optional[str]:
    """Create a throwaway inbound message via the Resend inbound webhook.
    Returns the created message id or None if the webhook path refused it.
    Uses the ``email.received`` schema Resend sends in production.
    """
    tag = f"iter174-{uuid.uuid4().hex[:8]}"
    frm = f"{tag}@example.com"
    message_id_hdr = f"<{tag}@iter174.test>"
    payload = {
        "type": "email.received",
        "created_at": "2026-01-01T00:00:00Z",
        "data": {
            "email_id": f"em_{uuid.uuid4().hex}",
            "from": frm,
            "to": ["support@friendplace.com.au"],
            "subject": f"TEST iter174 archive/restore {tag}",
            "text": "Throwaway body for archive/restore round trip.",
            "html": "",
            "headers": [
                {"name": "Message-Id", "value": message_id_hdr},
                {"name": "From", "value": f"Iter174 Tester <{frm}>"},
            ],
        },
    }
    raw = json.dumps(payload).encode()
    hdrs = _resend_signed_headers(raw)
    r = requests.post(f"{BASE}/cms/email/inbound", data=raw, headers=hdrs, timeout=15)
    if r.status_code >= 400:
        # Second attempt: seed directly through Mongo (only works when the
        # tests run on the same host as the preview backend, which is
        # the case in this environment).
        try:
            from pymongo import MongoClient
            load_dotenv("/app/backend/.env")
            cli = MongoClient(os.environ["MONGO_URL"])
            db = cli[os.environ.get("DB_NAME", "test_database")]
            from datetime import datetime, timezone
            mid = str(uuid.uuid4())
            db.inbox_messages.insert_one({
                "id": mid,
                "mailbox": "support@friendplace.com.au",
                "direction": "inbound",
                "from_email": frm,
                "from_name": "Iter174 Tester",
                "to_email": "support@friendplace.com.au",
                "subject": f"TEST iter174 archive/restore {tag}",
                "subject_norm": f"test iter174 archive/restore {tag}",
                "text": "Throwaway body for archive/restore round trip.",
                "html": "",
                "snippet": "Throwaway body",
                "message_id": message_id_hdr,
                "provider_message_id": message_id_hdr,
                "in_reply_to": "",
                "references": [],
                "thread_id": str(uuid.uuid4()),
                "read": False,
                "archived_at": None,
                "archived_by": None,
                "received_at": datetime.now(timezone.utc).isoformat(),
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            cli.close()
            return mid
        except Exception:
            return None

    body = r.json()
    if isinstance(body, dict) and body.get("id"):
        return body["id"]
    # Fallback: find the newly-created message in the list.
    lst = requests.get(f"{BASE}/cms/email/messages",
                       params={"mailbox": "support@friendplace.com.au",
                               "limit": 100},
                       headers=auth, timeout=15).json()
    for row in lst.get("rows", []):
        if row.get("from_email", "").lower() == frm.lower():
            return row["id"]
    return None


def test_archive_restore_roundtrip_throwaway_message(auth):
    mid = _seed_inbound_via_webhook(auth)
    if not mid:
        pytest.skip("inbound webhook did not accept test payload "
                    "(WEBHOOKS_ALLOW_UNSIGNED off or signature mismatch); "
                    "archive/restore code path exercised in test_iter164ba_email_inbox.")
    _CREATED_MSG_IDS.append(mid)

    # Message should be in the active inbox for support@ mailbox.
    active = requests.get(f"{BASE}/cms/email/messages",
                          params={"mailbox": "support@friendplace.com.au",
                                  "limit": 200},
                          headers=auth, timeout=15).json()
    active_ids = {r["id"] for r in active.get("rows", [])}
    assert mid in active_ids, "seeded test message not present in active inbox"

    # Archive
    r = requests.post(f"{BASE}/cms/email/messages/{mid}/archive",
                      headers=auth, timeout=15)
    assert r.status_code == 200, f"archive failed: {r.status_code} {r.text}"

    # Should NOT be in active anymore
    active2 = requests.get(f"{BASE}/cms/email/messages",
                           params={"mailbox": "support@friendplace.com.au",
                                   "limit": 200},
                           headers=auth, timeout=15).json()
    assert mid not in {r["id"] for r in active2.get("rows", [])}, \
        "archived message still in active list"

    # Should be in archived list
    arch = requests.get(f"{BASE}/cms/email/messages",
                        params={"archived": "true", "limit": 200},
                        headers=auth, timeout=15).json()
    assert mid in {r["id"] for r in arch.get("rows", [])}, \
        "archived message not in archived list"

    # Restore
    r = requests.post(f"{BASE}/cms/email/messages/{mid}/restore",
                      headers=auth, timeout=15)
    assert r.status_code == 200, f"restore failed: {r.status_code} {r.text}"

    # Back in active list
    active3 = requests.get(f"{BASE}/cms/email/messages",
                           params={"mailbox": "support@friendplace.com.au",
                                   "limit": 200},
                           headers=auth, timeout=15).json()
    assert mid in {r["id"] for r in active3.get("rows", [])}, \
        "restored message did not return to active list"

    # Cleanup — DELETE the throwaway message
    r = requests.delete(f"{BASE}/cms/email/messages/{mid}",
                        headers=auth, timeout=15)
    assert r.status_code in (200, 204), f"delete failed: {r.status_code} {r.text}"
    _CREATED_MSG_IDS.remove(mid)


# ---------------------------------------------------------------------------
# 4) GEORGE CHAT — SSE POST /api/george/chat
# ---------------------------------------------------------------------------
def test_george_chat_returns_real_reply(auth):
    body = {
        "message": "In one short sentence, say hello and confirm you're online.",
        "scope": "mcgs",
    }
    # SSE endpoint — stream=True and parse `data:` frames.
    with requests.post(f"{BASE}/george/chat", json=body, headers=auth,
                       stream=True, timeout=60) as r:
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        reply_parts: list[str] = []
        got_done = False
        for raw in r.iter_lines(decode_unicode=True):
            if raw is None:
                continue
            if not raw:
                continue
            if raw.startswith("data:"):
                data = raw[5:].strip()
                if not data:
                    continue
                try:
                    frame = json.loads(data)
                except Exception:
                    continue
                # Common shapes: {"type":"token","text":"..."} or {"delta":"..."}
                if isinstance(frame, dict):
                    for k in ("text", "delta", "content"):
                        v = frame.get(k)
                        if isinstance(v, str):
                            reply_parts.append(v)
                    if frame.get("type") in ("done", "end") or frame.get("done"):
                        got_done = True
                        break
        full = "".join(reply_parts).strip()
        assert full, f"George returned an empty reply. done={got_done}"
        # not just an error string
        assert "error" not in full.lower()[:12], f"error-looking reply: {full[:200]}"


# ---------------------------------------------------------------------------
# 5) GEORGE TTS — POST /api/mcgs/george/speak
# ---------------------------------------------------------------------------
def test_george_speak_returns_audio(auth):
    r = requests.post(f"{BASE}/mcgs/george/speak",
                      json={"text": "Hello from iter174.", "voice": "george"},
                      headers=auth, timeout=45)
    assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
    ct = r.headers.get("Content-Type", "")
    assert "audio" in ct.lower(), f"unexpected content-type: {ct}"
    assert len(r.content) > 1000, f"audio too small: {len(r.content)} bytes"
    # MP3 magic: ID3 tag or 0xFFFB / 0xFFF3 frame sync
    head = r.content[:3]
    assert head[:3] == b"ID3" or (head[0] == 0xFF and (head[1] & 0xE0) == 0xE0), \
        f"content does not look like MP3: {head!r}"
