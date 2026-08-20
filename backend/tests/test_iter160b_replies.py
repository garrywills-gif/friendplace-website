"""iter160b — Inbound Replies CRM tests.

Covers the /api/cms/replies/* router + cross-collection linkage with
outreach organisations + the auto-resolve hook in marketing send.
"""
from __future__ import annotations

import asyncio
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://george-mcgs-cms.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASSWORD = "TestPass2026!"


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def admin_token() -> str:
    r = requests.post(
        f"{BASE_URL}/api/cms/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    assert data.get("ok") is True
    assert data.get("token")
    return data["token"]


@pytest.fixture(scope="module")
def auth_headers(admin_token: str) -> dict:
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture
def created_reply_ids() -> list:
    ids: list = []
    yield ids


@pytest.fixture
def created_org_ids() -> list:
    ids: list = []
    yield ids


@pytest.fixture(autouse=True)
def _cleanup(created_reply_ids, created_org_ids, auth_headers):
    """Clean created replies + orgs after each test."""
    yield
    for rid in created_reply_ids:
        try:
            requests.delete(f"{BASE_URL}/api/cms/replies/{rid}", headers=auth_headers, timeout=10)
        except Exception:
            pass
    for oid in created_org_ids:
        try:
            requests.delete(f"{BASE_URL}/api/cms/outreach/organisations/{oid}", headers=auth_headers, timeout=10)
        except Exception:
            pass


def _uniq_email() -> str:
    return f"iter160b_test_{uuid.uuid4().hex[:10]}@example.test"


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


class TestAuth:
    """All replies endpoints must require CMS admin bearer."""

    def test_list_without_token_401(self):
        r = requests.get(f"{BASE_URL}/api/cms/replies", timeout=10)
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}"

    def test_create_without_token_401(self):
        r = requests.post(f"{BASE_URL}/api/cms/replies", json={"from_email": _uniq_email()}, timeout=10)
        assert r.status_code in (401, 403)

    def test_unread_count_without_token_401(self):
        r = requests.get(f"{BASE_URL}/api/cms/replies/unread-count", timeout=10)
        assert r.status_code in (401, 403)


# ---------------------------------------------------------------------------
# CRUD basics
# ---------------------------------------------------------------------------


class TestRepliesCRUD:

    def test_meta_channels(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/cms/replies/meta/channels", headers=auth_headers, timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        chans = data.get("channels") or []
        for c in ("email", "phone", "in_person", "sms", "other"):
            assert c in chans, f"missing channel {c} in {chans}"

    def test_create_defaults_and_get(self, auth_headers, created_reply_ids):
        email = _uniq_email()
        body = {
            "from_email": email,
            "from_name":  "Test Person",
            "subject":    "Hi FriendPlace",
            "body":       "This is a test reply body.",
            "channel":    "email",
        }
        r = requests.post(f"{BASE_URL}/api/cms/replies", headers=auth_headers, json=body, timeout=15)
        assert r.status_code == 200, r.text
        row = r.json()
        created_reply_ids.append(row["id"])

        # Defaults
        assert row["read"] is False
        assert row["resolved"] is False
        assert row["resolved_at"] is None
        assert row["resolved_by"] is None
        assert row["from_email"] == email.lower()
        assert row["channel"] == "email"
        assert row.get("created_at")
        assert row.get("received_at")

        # GET verify persistence
        g = requests.get(f"{BASE_URL}/api/cms/replies/{row['id']}", headers=auth_headers, timeout=10)
        assert g.status_code == 200
        assert g.json()["id"] == row["id"]

    def test_list_filters_and_counts(self, auth_headers, created_reply_ids):
        # baseline counts before
        r0 = requests.get(f"{BASE_URL}/api/cms/replies/unread-count", headers=auth_headers, timeout=10)
        assert r0.status_code == 200
        base = r0.json()
        assert "unread_count" in base and "awaiting_count" in base

        # Create a fresh row
        email = _uniq_email()
        r = requests.post(
            f"{BASE_URL}/api/cms/replies", headers=auth_headers,
            json={"from_email": email, "subject": "listfilter_iter160b_probe"}, timeout=15,
        )
        assert r.status_code == 200
        created_reply_ids.append(r.json()["id"])

        # unread_count should be >= 1 now
        r1 = requests.get(f"{BASE_URL}/api/cms/replies/unread-count", headers=auth_headers, timeout=10)
        assert r1.status_code == 200
        after = r1.json()
        assert after["unread_count"] >= base["unread_count"] + 1
        assert after["awaiting_count"] >= base["awaiting_count"] + 1

        # list with read=false includes it
        rl = requests.get(f"{BASE_URL}/api/cms/replies?read=false", headers=auth_headers, timeout=10)
        assert rl.status_code == 200
        listed = rl.json()
        ids = [row["id"] for row in listed["replies"]]
        assert r.json()["id"] in ids
        assert "unread_count" in listed
        assert "awaiting_count" in listed

        # q filter matches subject
        rq = requests.get(f"{BASE_URL}/api/cms/replies?q=listfilter_iter160b_probe", headers=auth_headers, timeout=10)
        assert rq.status_code == 200
        assert any(row["id"] == r.json()["id"] for row in rq.json()["replies"])

        # resolved=true does NOT include it (still unresolved)
        rr = requests.get(f"{BASE_URL}/api/cms/replies?resolved=true", headers=auth_headers, timeout=10)
        assert rr.status_code == 200
        assert r.json()["id"] not in [row["id"] for row in rr.json()["replies"]]

    def test_toggle_read(self, auth_headers, created_reply_ids):
        r = requests.post(
            f"{BASE_URL}/api/cms/replies", headers=auth_headers,
            json={"from_email": _uniq_email()}, timeout=15,
        )
        rid = r.json()["id"]
        created_reply_ids.append(rid)

        # mark read
        p = requests.patch(f"{BASE_URL}/api/cms/replies/{rid}/read", headers=auth_headers, json={"read": True}, timeout=10)
        assert p.status_code == 200
        assert p.json()["read"] is True

        # toggle back off
        p2 = requests.patch(f"{BASE_URL}/api/cms/replies/{rid}/read", headers=auth_headers, json={"read": False}, timeout=10)
        assert p2.status_code == 200
        assert p2.json()["read"] is False

    def test_toggle_resolve(self, auth_headers, created_reply_ids):
        r = requests.post(
            f"{BASE_URL}/api/cms/replies", headers=auth_headers,
            json={"from_email": _uniq_email()}, timeout=15,
        )
        rid = r.json()["id"]
        created_reply_ids.append(rid)

        p = requests.patch(f"{BASE_URL}/api/cms/replies/{rid}/resolve", headers=auth_headers, json={"resolved": True}, timeout=10)
        assert p.status_code == 200
        row = p.json()
        assert row["resolved"] is True
        assert row["read"] is True
        assert row["resolved_at"] is not None
        assert row["resolved_by"] == ADMIN_EMAIL

        # toggle back off — fields cleared
        p2 = requests.patch(f"{BASE_URL}/api/cms/replies/{rid}/resolve", headers=auth_headers, json={"resolved": False}, timeout=10)
        assert p2.status_code == 200
        row2 = p2.json()
        assert row2["resolved"] is False
        assert row2["resolved_at"] is None
        assert row2["resolved_by"] is None

    def test_delete_reply(self, auth_headers, created_reply_ids):
        r = requests.post(
            f"{BASE_URL}/api/cms/replies", headers=auth_headers,
            json={"from_email": _uniq_email()}, timeout=15,
        )
        rid = r.json()["id"]
        # DO NOT add to cleanup list — we delete it here.
        d = requests.delete(f"{BASE_URL}/api/cms/replies/{rid}", headers=auth_headers, timeout=10)
        assert d.status_code == 200
        assert d.json().get("ok") is True

        g = requests.get(f"{BASE_URL}/api/cms/replies/{rid}", headers=auth_headers, timeout=10)
        assert g.status_code == 404


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


class TestValidation:

    def test_missing_email_400(self, auth_headers):
        r = requests.post(f"{BASE_URL}/api/cms/replies", headers=auth_headers, json={}, timeout=10)
        # pydantic missing field returns 422; body-level ValueError returns 400.
        # from_email is required (no default), so pydantic 422 is acceptable too.
        assert r.status_code in (400, 422), r.text

    def test_invalid_email_400(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/cms/replies", headers=auth_headers,
            json={"from_email": "not-an-email"}, timeout=10,
        )
        assert r.status_code == 400, r.text

    def test_invalid_channel_400(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/cms/replies", headers=auth_headers,
            json={"from_email": _uniq_email(), "channel": "carrier_pigeon"}, timeout=10,
        )
        assert r.status_code == 400, r.text


# ---------------------------------------------------------------------------
# Cross-collection linkage
# ---------------------------------------------------------------------------


class TestOutreachLinkage:

    def _create_outreach_org(self, auth_headers, created_org_ids, email: str) -> str:
        r = requests.post(
            f"{BASE_URL}/api/cms/outreach/organisations",
            headers=auth_headers,
            json={
                "organisation_name": f"iter160b Test Org {uuid.uuid4().hex[:6]}",
                "email": email,
                "is_test": True,
            },
            timeout=15,
        )
        assert r.status_code == 200, r.text
        org = r.json()
        created_org_ids.append(org["id"])
        return org["id"]

    def test_reply_transitions_org_to_awaiting_reply(
        self, auth_headers, created_org_ids, created_reply_ids,
    ):
        email = _uniq_email()
        org_id = self._create_outreach_org(auth_headers, created_org_ids, email)

        # Create reply linked by email
        r = requests.post(
            f"{BASE_URL}/api/cms/replies", headers=auth_headers,
            json={"from_email": email, "subject": "Yes we want to help"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        reply = r.json()
        created_reply_ids.append(reply["id"])
        assert reply.get("outreach_id") == org_id, f"reply outreach_id mismatch: {reply}"

        # GET org — status should be awaiting_reply, last_reply_at set
        g = requests.get(
            f"{BASE_URL}/api/cms/outreach/organisations/{org_id}",
            headers=auth_headers, timeout=10,
        )
        assert g.status_code == 200, g.text
        org = g.json()
        assert org["status"] == "awaiting_reply", f"expected awaiting_reply got {org.get('status')}"
        assert org.get("last_reply_at") is not None

    def test_resolve_transitions_org_to_replied(
        self, auth_headers, created_org_ids, created_reply_ids,
    ):
        email = _uniq_email()
        org_id = self._create_outreach_org(auth_headers, created_org_ids, email)

        r = requests.post(
            f"{BASE_URL}/api/cms/replies", headers=auth_headers,
            json={"from_email": email}, timeout=15,
        )
        reply_id = r.json()["id"]
        created_reply_ids.append(reply_id)

        # Resolve
        p = requests.patch(
            f"{BASE_URL}/api/cms/replies/{reply_id}/resolve",
            headers=auth_headers, json={"resolved": True}, timeout=10,
        )
        assert p.status_code == 200

        g = requests.get(
            f"{BASE_URL}/api/cms/outreach/organisations/{org_id}",
            headers=auth_headers, timeout=10,
        )
        assert g.status_code == 200
        org = g.json()
        assert org["status"] == "replied", f"expected replied got {org.get('status')}"


# ---------------------------------------------------------------------------
# Marketing send auto-resolve hook (DB-only path)
# ---------------------------------------------------------------------------


class TestMarketingSendAutoResolve:

    def test_resolve_replies_for_email_direct(self, auth_headers, created_reply_ids):
        """Directly invoke services.replies.store.resolve_replies_for_email — pure DB.

        Preferred path per test brief: avoid burning Resend credits.
        """
        import sys
        sys.path.insert(0, "/app/backend")
        from motor.motor_asyncio import AsyncIOMotorClient
        from services.replies.store import resolve_replies_for_email

        mongo_url = os.environ.get("MONGO_URL") or "mongodb://localhost:27017"
        db_name = os.environ.get("DB_NAME") or "test_database"

        async def _run():
            client = AsyncIOMotorClient(mongo_url)
            db = client[db_name]

            # First create a reply via API so it has full shape
            email = _uniq_email()
            r = requests.post(
                f"{BASE_URL}/api/cms/replies", headers=auth_headers,
                json={"from_email": email, "subject": "auto_resolve_probe"}, timeout=15,
            )
            assert r.status_code == 200, r.text
            reply_id = r.json()["id"]
            created_reply_ids.append(reply_id)

            # Confirm unresolved
            assert r.json()["resolved"] is False

            # Invoke DB path directly
            modified = await resolve_replies_for_email(
                db, from_email=email, resolved_by="test_runner", send_id="fake_send_1",
            )
            assert modified >= 1, f"expected >=1 modified, got {modified}"

            # Verify via API
            g = requests.get(f"{BASE_URL}/api/cms/replies/{reply_id}", headers=auth_headers, timeout=10)
            assert g.status_code == 200
            row = g.json()
            assert row["resolved"] is True
            assert row["read"] is True
            assert row.get("resolved_via") == "fake_send_1"

            client.close()

        asyncio.get_event_loop().run_until_complete(_run())
