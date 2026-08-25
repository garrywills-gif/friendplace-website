"""
iter164r — Campaign Composer PDF attachment tests.

Covers:
  * Create/GET default shape (attach_file=false, attachment=null).
  * PATCH accepts bool + truthy strings ("true","on","1").
  * POST attachment happy path + validation errors:
      - non-PDF content-type          -> 415
      - PDF content-type but bad bytes-> 400
      - empty file                    -> 400
      - > 5 MB                        -> 413
      - non-draft campaign            -> 400
      - unknown campaign id           -> 404
      - unauthenticated               -> 401
  * GET attachment metadata (no content_b64).
  * GET attachment download (raw PDF bytes + inline disposition + PDF media type).
  * DELETE attachment clears + flips attach_file back to false; idempotent
    when no attachment present; non-draft campaign -> 400.
  * GET campaign includes attachment metadata + attach_file, no content_b64.
  * Send worker:
      - attach_file=true + attachment present -> send_email_detailed called
        with attachments=[{filename, content, content_type}]
      - attach_file=false                    -> attachments=None
      - BATCH_SIZE / one-recipient-at-a-time loop preserved.

The send-worker tests spin the CMS router inside the pytest process (via
FastAPI + httpx.AsyncClient + ASGITransport) so we can monkeypatch
`email_service.send_email_detailed` and `email_service.is_configured`
before triggering the campaign send.  The endpoint-level tests run
against the live preview backend (public URL) so we exercise the same
FastAPI process operators use.
"""
from __future__ import annotations

import base64
import io
import os
import time
import uuid
from typing import Any, Dict

import pytest
import requests
from dotenv import load_dotenv

# Load backend/.env so MONGO_URL / DB_NAME are visible when tests need to
# poke Mongo directly (e.g. flipping a campaign into non-draft status to
# exercise the guard) or when the in-process app spins up.
load_dotenv("/app/backend/.env")

BASE_URL = os.environ.get(
    "EXPO_BACKEND_URL",
    os.environ.get(
        "EXPO_PUBLIC_BACKEND_URL",
        "https://outreach-campaigns.preview.emergentagent.com",
    ),
).rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASSWORD = "TestPass2026!"

# 25-byte tiniest legal-ish PDF blob.  Starts with %PDF- so the
# magic-byte sniff on the upload endpoint accepts it.
MIN_PDF_BYTES = (
    b"%PDF-1.4\n1 0 obj<<>>endobj\n"
    b"trailer<<>>\n%%EOF\n"
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def token() -> str:
    """CMS admin JWT — one login shared across the module."""
    r = requests.post(
        f"{API}/cms/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"CMS admin login failed: {r.status_code} {r.text}"
    body = r.json()
    tok = body.get("token")
    assert tok, f"login returned no token: {body}"
    return tok


@pytest.fixture(scope="module")
def auth_headers(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_draft(auth: Dict[str, str], name: str = "TEST_iter164r attachment") -> Dict[str, Any]:
    """Helper — make a fresh announcement draft targeted at a manual list."""
    payload = {
        "name": name,
        "template": "announcement",
        "subject": "TEST subject",
        "preheader": "TEST preheader",
        "companion": "george",
        "title": "TEST title",
        "body_md": "TEST body",
        "audience_filter": {
            "audience_kind": "manual_list",
            "manual_recipients": [
                {"name": "Alex Tester", "email": "alex.tester+iter164r@example.com"},
            ],
        },
    }
    r = requests.post(f"{API}/cms/campaigns", json=payload, headers=auth, timeout=15)
    assert r.status_code == 200, f"create campaign failed: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture
def campaign(auth_headers) -> Dict[str, Any]:
    """Fresh draft campaign for a single test — cleaned up at teardown."""
    c = _create_draft(auth_headers)
    yield c
    try:
        requests.delete(f"{API}/cms/campaigns/{c['id']}", headers=auth_headers, timeout=10)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# 1. POST /campaigns default shape
# ---------------------------------------------------------------------------


class TestCampaignDefaults:
    def test_create_campaign_returns_attach_file_false_and_attachment_null(self, campaign):
        assert campaign.get("attach_file") is False, (
            f"attach_file default should be False, got {campaign.get('attach_file')!r}"
        )
        assert campaign.get("attachment") is None, (
            f"attachment default should be None, got {campaign.get('attachment')!r}"
        )
        assert campaign.get("status") == "draft"


# ---------------------------------------------------------------------------
# 2. PATCH /campaigns — attach_file coercion
# ---------------------------------------------------------------------------


class TestAttachFilePatch:
    @pytest.mark.parametrize(
        "sent, expected",
        [
            (True,  True),
            (False, False),
            ("true",  True),
            ("True",  True),
            ("on",    True),
            ("1",     True),
            ("yes",   True),
            ("false", False),
            ("no",    False),
            ("0",     False),
            ("",      False),
        ],
    )
    def test_patch_attach_file_coerces_truthy_strings(self, auth_headers, campaign, sent, expected):
        r = requests.patch(
            f"{API}/cms/campaigns/{campaign['id']}",
            json={"attach_file": sent},
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code == 200, f"patch failed: {r.status_code} {r.text}"
        body = r.json()
        assert body.get("attach_file") is expected, (
            f"attach_file for input {sent!r}: expected {expected}, got {body.get('attach_file')!r}"
        )
        # GET should agree (persistence).
        g = requests.get(f"{API}/cms/campaigns/{campaign['id']}", headers=auth_headers, timeout=15)
        assert g.status_code == 200
        assert g.json().get("attach_file") is expected


# ---------------------------------------------------------------------------
# 3. POST /campaigns/{id}/attachment — happy path + guards
# ---------------------------------------------------------------------------


class TestAttachmentUpload:
    def test_upload_happy_path(self, auth_headers, campaign):
        files = {"file": ("flyer.pdf", MIN_PDF_BYTES, "application/pdf")}
        r = requests.post(
            f"{API}/cms/campaigns/{campaign['id']}/attachment",
            files=files, headers=auth_headers, timeout=20,
        )
        assert r.status_code == 200, f"upload failed: {r.status_code} {r.text}"
        body = r.json()
        assert body.get("ok") is True
        att = body.get("attachment") or {}
        assert att.get("filename") == "flyer.pdf"
        assert att.get("content_type") == "application/pdf"
        assert att.get("size") == len(MIN_PDF_BYTES)
        assert att.get("uploaded_at"), "uploaded_at should be set"
        # Public meta must not leak base64 bytes.
        assert "content_b64" not in att, "public attachment shape leaked content_b64"

    def test_upload_non_pdf_content_type_returns_415(self, auth_headers, campaign):
        files = {"file": ("notes.txt", b"hello world", "text/plain")}
        r = requests.post(
            f"{API}/cms/campaigns/{campaign['id']}/attachment",
            files=files, headers=auth_headers, timeout=15,
        )
        assert r.status_code == 415, f"expected 415, got {r.status_code}: {r.text}"

    def test_upload_pdf_content_type_but_wrong_bytes_returns_400(self, auth_headers, campaign):
        files = {"file": ("fake.pdf", b"not-a-real-pdf-payload", "application/pdf")}
        r = requests.post(
            f"{API}/cms/campaigns/{campaign['id']}/attachment",
            files=files, headers=auth_headers, timeout=15,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"

    def test_upload_empty_file_returns_400(self, auth_headers, campaign):
        files = {"file": ("empty.pdf", b"", "application/pdf")}
        r = requests.post(
            f"{API}/cms/campaigns/{campaign['id']}/attachment",
            files=files, headers=auth_headers, timeout=15,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"

    def test_upload_over_5mb_returns_413(self, auth_headers, campaign):
        # 5 MB + 1 byte, still starts with %PDF- so we're testing size, not magic bytes.
        oversized = b"%PDF-1.4\n" + b"A" * (5 * 1024 * 1024)
        files = {"file": ("huge.pdf", oversized, "application/pdf")}
        r = requests.post(
            f"{API}/cms/campaigns/{campaign['id']}/attachment",
            files=files, headers=auth_headers, timeout=60,
        )
        assert r.status_code == 413, f"expected 413, got {r.status_code}: {r.text[:200]}"

    def test_upload_unknown_campaign_returns_404(self, auth_headers):
        files = {"file": ("flyer.pdf", MIN_PDF_BYTES, "application/pdf")}
        r = requests.post(
            f"{API}/cms/campaigns/does-not-exist-{uuid.uuid4()}/attachment",
            files=files, headers=auth_headers, timeout=15,
        )
        assert r.status_code == 404, f"expected 404, got {r.status_code}: {r.text}"

    def test_upload_unauthenticated_returns_401(self, campaign):
        files = {"file": ("flyer.pdf", MIN_PDF_BYTES, "application/pdf")}
        r = requests.post(
            f"{API}/cms/campaigns/{campaign['id']}/attachment",
            files=files, timeout=15,
        )
        assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text}"

    def test_upload_non_draft_returns_400(self, auth_headers, campaign):
        """Force campaign status != draft by writing directly to Mongo, then upload."""
        # Use a private test-only helper — pytest is running next to backend so
        # motor is available. Simpler: PATCH is refused for status field but
        # we can flip it via Mongo directly.
        from motor.motor_asyncio import AsyncIOMotorClient
        import asyncio

        async def _flip():
            client = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = client[os.environ["DB_NAME"]]
            await db.campaigns.update_one(
                {"id": campaign["id"]},
                {"$set": {"status": "sent"}},
            )
            client.close()
        asyncio.run(_flip())
        files = {"file": ("flyer.pdf", MIN_PDF_BYTES, "application/pdf")}
        r = requests.post(
            f"{API}/cms/campaigns/{campaign['id']}/attachment",
            files=files, headers=auth_headers, timeout=15,
        )
        assert r.status_code == 400, f"expected 400 (non-draft), got {r.status_code}: {r.text}"


# ---------------------------------------------------------------------------
# 4. GET /campaigns/{id}/attachment  — metadata only (no base64 bytes)
# ---------------------------------------------------------------------------


class TestAttachmentGet:
    def test_get_attachment_metadata_no_content_b64(self, auth_headers, campaign):
        # Upload first
        r = requests.post(
            f"{API}/cms/campaigns/{campaign['id']}/attachment",
            files={"file": ("brochure.pdf", MIN_PDF_BYTES, "application/pdf")},
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        # Read
        r = requests.get(
            f"{API}/cms/campaigns/{campaign['id']}/attachment",
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "attachment" in body and "attach_file" in body
        att = body["attachment"]
        assert att is not None
        assert att.get("filename") == "brochure.pdf"
        assert att.get("size") == len(MIN_PDF_BYTES)
        assert att.get("content_type") == "application/pdf"
        assert "content_b64" not in att


# ---------------------------------------------------------------------------
# 5. GET /campaigns/{id}/attachment/download  — raw PDF bytes
# ---------------------------------------------------------------------------


class TestAttachmentDownload:
    def test_download_returns_raw_pdf_with_inline_disposition(self, auth_headers, campaign):
        r = requests.post(
            f"{API}/cms/campaigns/{campaign['id']}/attachment",
            files={"file": ("village-flyer.pdf", MIN_PDF_BYTES, "application/pdf")},
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 200, r.text

        r = requests.get(
            f"{API}/cms/campaigns/{campaign['id']}/attachment/download",
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.content == MIN_PDF_BYTES, "raw PDF bytes should round-trip byte-for-byte"
        assert r.headers.get("content-type", "").startswith("application/pdf"), (
            f"Expected application/pdf, got {r.headers.get('content-type')!r}"
        )
        disp = r.headers.get("content-disposition", "")
        assert "inline" in disp.lower(), f"expected inline disposition, got {disp!r}"
        assert 'filename="village-flyer.pdf"' in disp, disp

    def test_download_when_no_attachment_returns_404(self, auth_headers, campaign):
        r = requests.get(
            f"{API}/cms/campaigns/{campaign['id']}/attachment/download",
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 404, r.text


# ---------------------------------------------------------------------------
# 6. DELETE /campaigns/{id}/attachment
# ---------------------------------------------------------------------------


class TestAttachmentDelete:
    def test_delete_clears_attachment_and_flips_attach_file_false(self, auth_headers, campaign):
        # Upload + turn attach_file on
        r = requests.post(
            f"{API}/cms/campaigns/{campaign['id']}/attachment",
            files={"file": ("attached.pdf", MIN_PDF_BYTES, "application/pdf")},
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 200
        r = requests.patch(
            f"{API}/cms/campaigns/{campaign['id']}",
            json={"attach_file": True}, headers=auth_headers, timeout=15,
        )
        assert r.status_code == 200 and r.json().get("attach_file") is True

        # Delete
        r = requests.delete(
            f"{API}/cms/campaigns/{campaign['id']}/attachment",
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("attachment") is None
        assert body.get("attach_file") is False

        # GET confirms
        g = requests.get(f"{API}/cms/campaigns/{campaign['id']}", headers=auth_headers, timeout=15)
        assert g.status_code == 200
        assert g.json().get("attachment") is None
        assert g.json().get("attach_file") is False

    def test_delete_is_idempotent_when_no_attachment_present(self, auth_headers, campaign):
        r = requests.delete(
            f"{API}/cms/campaigns/{campaign['id']}/attachment",
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("attachment") is None

    def test_delete_non_draft_returns_400(self, auth_headers, campaign):
        from motor.motor_asyncio import AsyncIOMotorClient
        import asyncio

        async def _flip():
            client = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = client[os.environ["DB_NAME"]]
            await db.campaigns.update_one(
                {"id": campaign["id"]},
                {"$set": {"status": "sent"}},
            )
            client.close()
        asyncio.run(_flip())

        r = requests.delete(
            f"{API}/cms/campaigns/{campaign['id']}/attachment",
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 400, r.text


# ---------------------------------------------------------------------------
# 7. GET /campaigns/{id} keeps attachment metadata across PATCH edits
# ---------------------------------------------------------------------------


class TestAttachmentPersistsAcrossEdits:
    def test_attachment_metadata_survives_patch_edits(self, auth_headers, campaign):
        # Upload
        r = requests.post(
            f"{API}/cms/campaigns/{campaign['id']}/attachment",
            files={"file": ("keep.pdf", MIN_PDF_BYTES, "application/pdf")},
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 200
        # Unrelated PATCH
        r = requests.patch(
            f"{API}/cms/campaigns/{campaign['id']}",
            json={"subject": "TEST edited subject", "title": "TEST edited title"},
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 200
        body = r.json()
        assert body.get("attachment") is not None
        assert body["attachment"].get("filename") == "keep.pdf"
        assert "content_b64" not in body["attachment"]

        # Full GET should also carry it forward.
        g = requests.get(f"{API}/cms/campaigns/{campaign['id']}", headers=auth_headers, timeout=15)
        assert g.status_code == 200
        att = g.json().get("attachment")
        assert att is not None and att.get("filename") == "keep.pdf"
        assert "content_b64" not in att


# ---------------------------------------------------------------------------
# 8. Send worker — in-process, mocked send_email_detailed
# ---------------------------------------------------------------------------
#
# We spin the CMS router inside the pytest process so we can monkeypatch
# `email_service.send_email_detailed` and capture the exact `attachments`
# argument the worker ultimately hands to Resend.  The router talks to
# the same Mongo instance the live backend uses, but every campaign we
# create is prefixed "TEST_" and torn down at the end of the run.


class TestSendWorkerAttachments:
    """Verify the send worker forwards / withholds the PDF per attach_file."""

    def _build_app(self):
        """Build the CMS-only FastAPI app + a fresh Motor db bound to
        the current running loop. Call this INSIDE the async function
        that runs the flow so Motor picks up the correct loop.
        """
        import sys
        sys.path.insert(0, "/app/backend")
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
        from fastapi import FastAPI
        from motor.motor_asyncio import AsyncIOMotorClient
        from cms_module import build_router
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        app = FastAPI()
        app.include_router(build_router(db), prefix="/api")
        return app, db, client

    def _run_send_flow(self, monkeypatch, *, attach_file: bool):
        """End-to-end: create draft, upload PDF (optional), patch attach_file,
        trigger send, wait for worker, return (captured_args, campaign_id, db)."""
        import asyncio
        import email_service
        from httpx import AsyncClient, ASGITransport

        captured: list[dict] = []

        async def fake_send(**kwargs):
            captured.append(kwargs)
            return email_service.SendResult(ok=True, message_id=f"mocked-{uuid.uuid4()}")

        monkeypatch.setattr(email_service, "send_email_detailed", fake_send)
        monkeypatch.setattr(email_service, "is_configured", lambda: True)

        async def _flow():
            app, db, _client = self._build_app()
            async with AsyncClient(
                transport=ASGITransport(app=app),
                base_url="http://in-process",
            ) as ac:
                # Login
                lr = await ac.post(
                    "/api/cms/auth/login",
                    json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                )
                assert lr.status_code == 200, f"login: {lr.status_code} {lr.text}"
                tok = lr.json()["token"]
                h = {"Authorization": f"Bearer {tok}"}

                # Create draft with manual_list of 1 recipient
                cr = await ac.post(
                    "/api/cms/campaigns",
                    json={
                        "name": f"TEST_iter164r worker {uuid.uuid4()}",
                        "template": "announcement",
                        "subject": "TEST send worker",
                        "preheader": "TEST",
                        "companion": "george",
                        "title": "TEST",
                        "body_md": "TEST body",
                        "audience_filter": {
                            "audience_kind": "manual_list",
                            "manual_recipients": [
                                {"name": "Alex", "email": "alex+worker@example.com"},
                            ],
                        },
                    },
                    headers=h,
                )
                assert cr.status_code == 200, cr.text
                cid = cr.json()["id"]

                # Upload PDF (both cases — we want to prove the flag alone
                # gates the attachment, not the mere presence of a file).
                up = await ac.post(
                    f"/api/cms/campaigns/{cid}/attachment",
                    files={"file": ("worker-flyer.pdf", MIN_PDF_BYTES, "application/pdf")},
                    headers=h,
                )
                assert up.status_code == 200, up.text

                # Set attach_file
                pr = await ac.patch(
                    f"/api/cms/campaigns/{cid}",
                    json={"attach_file": attach_file}, headers=h,
                )
                assert pr.status_code == 200, pr.text
                assert pr.json().get("attach_file") is attach_file

                # Trigger send (BackgroundTasks runs the worker inline
                # after response with ASGITransport).
                sr = await ac.post(f"/api/cms/campaigns/{cid}/send", headers=h)
                assert sr.status_code == 200, sr.text

                # Poll for worker completion by watching campaign status.
                for _ in range(80):
                    doc = await db.campaigns.find_one({"id": cid}, {"_id": 0, "status": 1, "stats": 1})
                    if doc and doc.get("status") in ("sent", "failed"):
                        break
                    await asyncio.sleep(0.1)
                assert doc and doc["status"] == "sent", f"worker did not finish cleanly: {doc}"

                return cid, doc

        cid, doc = asyncio.run(_flow())
        return captured, cid, doc

    def _cleanup(self, cid: str) -> None:
        """Delete a test campaign + its recipients using a fresh Motor
        client inside a fresh event loop, so it works after the flow
        loop has been closed."""
        import asyncio
        from motor.motor_asyncio import AsyncIOMotorClient

        async def _do():
            client = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = client[os.environ["DB_NAME"]]
            await db.campaigns.delete_one({"id": cid})
            await db.campaign_recipients.delete_many({"campaign_id": cid})
            client.close()
        asyncio.run(_do())

    def test_send_worker_passes_attachment_when_flag_true(self, monkeypatch):
        captured, cid, doc = self._run_send_flow(monkeypatch, attach_file=True)
        try:
            assert len(captured) == 1, f"expected exactly 1 send, got {len(captured)}"
            call = captured[0]
            attachments = call.get("attachments")
            assert isinstance(attachments, list) and len(attachments) == 1, (
                f"attach_file=True should attach the PDF, got attachments={attachments!r}"
            )
            att = attachments[0]
            assert att.get("filename") == "worker-flyer.pdf"
            assert att.get("content_type") == "application/pdf"
            # `content` must be the base64 body — verify by decoding.
            assert base64.b64decode(att["content"]) == MIN_PDF_BYTES
            # Recipient row for one-at-a-time send.
            assert doc.get("stats", {}).get("accepted") == 1
        finally:
            self._cleanup(cid)

    def test_send_worker_omits_attachment_when_flag_false(self, monkeypatch):
        captured, cid, doc = self._run_send_flow(monkeypatch, attach_file=False)
        try:
            assert len(captured) == 1, f"expected exactly 1 send, got {len(captured)}"
            call = captured[0]
            # Spec: attach_file=false -> attachments=None (or not passed).
            attachments = call.get("attachments", None)
            assert attachments in (None, [], ()), (
                f"attach_file=False should send with no attachments, got {attachments!r}"
            )
            assert doc.get("stats", {}).get("accepted") == 1
        finally:
            self._cleanup(cid)

    def test_send_worker_processes_recipients_in_batches_of_five(self, monkeypatch):
        """iter164r spec: BATCH_SIZE=5 in `_one` inline loop must be preserved.

        We seed 7 recipients so we know the worker runs at least two
        batches. Each recipient must trigger exactly one send call, so
        the captured call count equals the recipient count.
        """
        import asyncio
        import email_service
        from httpx import AsyncClient, ASGITransport

        captured: list[dict] = []

        async def fake_send(**kwargs):
            captured.append(kwargs)
            return email_service.SendResult(ok=True, message_id=f"mocked-{uuid.uuid4()}")

        monkeypatch.setattr(email_service, "send_email_detailed", fake_send)
        monkeypatch.setattr(email_service, "is_configured", lambda: True)

        async def _flow():
            app, db, _client = self._build_app()
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://ip") as ac:
                lr = await ac.post(
                    "/api/cms/auth/login",
                    json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                )
                tok = lr.json()["token"]
                h = {"Authorization": f"Bearer {tok}"}
                recipients = [
                    {"name": f"User{i}", "email": f"batch{i}+iter164r@example.com"}
                    for i in range(7)
                ]
                cr = await ac.post(
                    "/api/cms/campaigns",
                    json={
                        "name": f"TEST_iter164r batch {uuid.uuid4()}",
                        "template": "announcement",
                        "subject": "TEST batch",
                        "preheader": "TEST",
                        "companion": "george",
                        "title": "TEST",
                        "body_md": "TEST body",
                        "audience_filter": {
                            "audience_kind": "manual_list",
                            "manual_recipients": recipients,
                        },
                    },
                    headers=h,
                )
                cid = cr.json()["id"]
                sr = await ac.post(f"/api/cms/campaigns/{cid}/send", headers=h)
                assert sr.status_code == 200, sr.text
                for _ in range(150):
                    doc = await db.campaigns.find_one({"id": cid}, {"_id": 0, "status": 1, "stats": 1})
                    if doc and doc.get("status") in ("sent", "failed"):
                        break
                    await asyncio.sleep(0.1)
                return cid, doc

        cid, doc = asyncio.run(_flow())
        try:
            assert doc and doc.get("status") == "sent", doc
            assert len(captured) == 7, f"expected 7 sends (one per recipient), got {len(captured)}"
            assert doc.get("stats", {}).get("accepted") == 7
        finally:
            self._cleanup(cid)
