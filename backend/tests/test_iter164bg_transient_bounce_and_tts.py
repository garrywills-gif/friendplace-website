"""iter164bg — transient/soft-bounce retry + George TTS silent retry.

In-process FastAPI app with a MOCKED sender (no real emails). Covers:
  • soft/transient bounce does NOT suppress the address (webhook)
  • hard/permanent bounce DOES suppress (webhook, unchanged)
  • retry-transient-bounces resends ONLY transient/soft bounced recipients,
    never hard/permanent
  • the original bounce event is preserved and the retry result is appended
    (both events kept)
  • returns counts attempted / succeeded / failed_again
  • George TTS: synthesize retries once silently, and re-raises if both fail;
    the text path is never touched by a synth failure
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


def _seed_bounced_campaign(mdb, *, tag):
    cid = str(uuid.uuid4())
    mdb.campaigns.insert_one({
        "id": cid, "name": f"bg-{tag}", "template": "announcement",
        "title": "Update", "body_md": "Hello.", "companion": "george",
        "subject": "News", "status": "sent",
        "stats": {"targeted": 3, "accepted": 3, "failed": 0, "bounced": 3,
                  "delivered": 0, "opened": 0, "clicked": 0},
        "audience_filter": {"audience_kind": "founding_members"},
        "created_at": "2026-09-03T00:00:00Z", "updated_at": "2026-09-03T00:00:00Z",
    })
    rows = {}
    for key, btype in (("soft", "Transient"), ("hard", "Permanent"), ("soft2", "soft")):
        rid = str(uuid.uuid4())
        rows[key] = rid
        email = f"{key}-{tag}@example.com"
        mdb.campaign_recipients.insert_one({
            "id": rid, "campaign_id": cid, "founder_id": str(uuid.uuid4()),
            "first_name": key.title(), "email": email, "status": "bounced",
            "bounce_type": btype, "bounce_message": "test bounce",
            "message_id": f"mid-{key}", "sent_at": "2026-09-03T01:00:00Z",
            "subject": "News",
        })
        # original bounce event (as the webhook would have written)
        mdb.campaign_recipient_events.insert_one({
            "id": str(uuid.uuid4()), "campaign_id": cid, "recipient_id": rid,
            "type": "email.bounced", "at": "2026-09-03T01:00:05Z",
            "meta": {"bounce_type": btype},
        })
    return cid, rows


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


def _ok_sender():
    async def _m(**kw):
        return SendResult(ok=True, message_id="rb-msg", http_status=200)
    return _m


# --------------------------------------------------------------------------
# Transient bounce retry
# --------------------------------------------------------------------------

def test_retry_transient_bounces_only(mdb, monkeypatch, loop):
    tag = uuid.uuid4().hex[:8]
    cid, rows = _seed_bounced_campaign(mdb, tag=tag)
    monkeypatch.setattr(email_service, "send_email_detailed", _ok_sender())
    try:
        async def scenario(ac, headers):
            return await ac.post(
                f"/api/cms/campaigns/{cid}/retry-transient-bounces", headers=headers)
        r = loop.run_until_complete(_run(scenario))
        assert r.status_code == 200, r.text
        body = r.json()
        # Only the two transient/soft rows are eligible; the hard one is excluded.
        assert body["eligible"] == 2
        assert body["attempted"] == 2
        assert body["succeeded"] == 2
        assert body["failed_again"] == 0

        # Soft rows flipped to sent; hard row untouched (still bounced).
        assert mdb.campaign_recipients.find_one({"id": rows["soft"]})["status"] == "sent"
        assert mdb.campaign_recipients.find_one({"id": rows["soft2"]})["status"] == "sent"
        assert mdb.campaign_recipients.find_one({"id": rows["hard"]})["status"] == "bounced"

        # Original bounce event preserved AND retry result appended (both kept).
        evs = list(mdb.campaign_recipient_events.find(
            {"campaign_id": cid, "recipient_id": rows["soft"]}))
        types = sorted(e["type"] for e in evs)
        assert "email.bounced" in types
        assert "email.retry_succeeded" in types

        # Hard bounce got NO retry event.
        hard_evs = list(mdb.campaign_recipient_events.find(
            {"campaign_id": cid, "recipient_id": rows["hard"]}))
        assert all("retry" not in e["type"] for e in hard_evs)
    finally:
        _cleanup(mdb, cid)


# --------------------------------------------------------------------------
# Webhook suppression classification
# --------------------------------------------------------------------------

def test_webhook_suppression_by_bounce_type(mdb, loop):
    import services.campaign_webhooks as cw
    import services.suppression as supp
    from motor.motor_asyncio import AsyncIOMotorClient
    amc = AsyncIOMotorClient(os.environ["MONGO_URL"])
    adb = amc[os.environ.get("DB_NAME", "test_database")]
    tag = uuid.uuid4().hex[:8]
    soft_email = f"wsoft-{tag}@example.com"
    hard_email = f"whard-{tag}@example.com"

    async def go():
        # Transient/soft bounce -> NOT suppressed.
        await cw._flag_founder_if_needed(
            adb, recipient={"email": soft_email}, evt_type="email.bounced",
            at="2026-09-03T00:00:00Z",
            payload_data={"bounce": {"type": "Transient"}})
        # Permanent/hard bounce -> suppressed.
        await cw._flag_founder_if_needed(
            adb, recipient={"email": hard_email}, evt_type="email.bounced",
            at="2026-09-03T00:00:00Z",
            payload_data={"bounce": {"type": "Permanent"}})
        soft_s = await supp.get_suppression(adb, soft_email)
        hard_s = await supp.get_suppression(adb, hard_email)
        return soft_s, hard_s

    try:
        soft_s, hard_s = loop.run_until_complete(go())
        assert soft_s is None, "transient bounce must NOT suppress"
        assert hard_s is not None and hard_s.get("suppression_reason") == "hard_bounce"
    finally:
        mdb.email_suppressions.delete_many({"email": {"$in": [soft_email, hard_email]}})
        amc.close()


# --------------------------------------------------------------------------
# George TTS silent retry
# --------------------------------------------------------------------------

def test_tts_silent_retry_recovers(monkeypatch, loop):
    import services.george.voice.synthesize as syn

    class _FlakyTTS:
        def __init__(self, *a, **k):
            self.calls = 0
        async def generate_speech(self, **kw):
            self.calls += 1
            if self.calls == 1:
                raise RuntimeError("transient upstream hiccup")
            return b"MP3BYTES"

    flaky = _FlakyTTS()
    monkeypatch.setattr(syn, "OpenAITextToSpeech", lambda *a, **k: flaky)
    out = loop.run_until_complete(syn.synthesize_george_speech("Hello there", persona="george"))
    assert out == b"MP3BYTES"
    assert flaky.calls == 2  # failed once, silent retry succeeded


def test_tts_reraises_after_two_failures(monkeypatch, loop):
    import services.george.voice.synthesize as syn

    class _DeadTTS:
        def __init__(self, *a, **k):
            self.calls = 0
        async def generate_speech(self, **kw):
            self.calls += 1
            raise RuntimeError("upstream down")

    dead = _DeadTTS()
    monkeypatch.setattr(syn, "OpenAITextToSpeech", lambda *a, **k: dead)
    with pytest.raises(RuntimeError):
        loop.run_until_complete(syn.synthesize_george_speech("Hi", persona="george"))
    assert dead.calls == 2  # exactly one silent retry, then re-raise


def test_tts_empty_text_does_not_retry(monkeypatch, loop):
    import services.george.voice.synthesize as syn
    calls = {"n": 0}

    class _CountTTS:
        def __init__(self, *a, **k):
            pass
        async def generate_speech(self, **kw):
            calls["n"] += 1
            return b"x"

    monkeypatch.setattr(syn, "OpenAITextToSpeech", lambda *a, **k: _CountTTS())
    with pytest.raises(ValueError):
        loop.run_until_complete(syn.synthesize_george_speech("   ", persona="george"))
    assert calls["n"] == 0  # empty text never reaches synthesis
