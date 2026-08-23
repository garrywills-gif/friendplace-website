"""iter164g — Replies "Resolve without sending" + audit trail.

Verifies:
- POST /cms/replies logs a reply.
- PATCH /cms/replies/{id}/resolve with resolution_kind='no_reply_needed'
  and a note closes the reply, keeps it in history, stamps resolved_by,
  and records the audit fields.
- Toggling back to resolved=false clears the audit fields (no leakage
  into a subsequent resolve).
- Explicit resolution_kind='replied' still works.
- Invalid resolution_kind is rejected with 400.
- Legacy resolve (no kind/note) still succeeds — backward compatible.
"""

from __future__ import annotations

import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "http://localhost:8001").rstrip("/")
ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASS = "TestPass2026!"


def _login() -> str:
    r = requests.post(
        f"{BASE_URL}/api/cms/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def token():
    return _login()


def _create_reply(token: str, from_email: str) -> str:
    r = requests.post(
        f"{BASE_URL}/api/cms/replies",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "from_email": from_email,
            "from_name": "Test Sender",
            "subject": "Spam offer",
            "body": "Buy crypto now",
            "channel": "email",
            "notes": "iter164g-test",
        },
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _delete_reply(token: str, reply_id: str) -> None:
    requests.delete(
        f"{BASE_URL}/api/cms/replies/{reply_id}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )


class TestResolveWithoutSend:
    def test_resolve_without_send_stores_audit(self, token):
        email = f"iter164g-{uuid.uuid4().hex[:8]}@example.com"
        reply_id = _create_reply(token, email)
        try:
            note = "Spam — no action needed"
            r = requests.patch(
                f"{BASE_URL}/api/cms/replies/{reply_id}/resolve",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "resolved": True,
                    "resolution_kind": "no_reply_needed",
                    "resolution_note": note,
                },
                timeout=15,
            )
            assert r.status_code == 200, r.text
            row = r.json()
            assert row["resolved"] is True
            assert row["resolved_at"]
            assert row["resolved_by"] == ADMIN_EMAIL
            assert row["resolution_kind"] == "no_reply_needed"
            assert row["resolution_note"] == note
            # Still present in the list (history retained)
            r = requests.get(
                f"{BASE_URL}/api/cms/replies",
                headers={"Authorization": f"Bearer {token}"},
                timeout=15,
            )
            ids = [x["id"] for x in r.json().get("replies", [])]
            assert reply_id in ids, "resolved reply should stay in history"
        finally:
            _delete_reply(token, reply_id)

    def test_reopen_clears_audit_fields(self, token):
        email = f"iter164g-reopen-{uuid.uuid4().hex[:8]}@example.com"
        reply_id = _create_reply(token, email)
        try:
            requests.patch(
                f"{BASE_URL}/api/cms/replies/{reply_id}/resolve",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "resolved": True,
                    "resolution_kind": "no_reply_needed",
                    "resolution_note": "Handled offline",
                },
                timeout=15,
            )
            # Reopen — kind/note must be cleared.
            r = requests.patch(
                f"{BASE_URL}/api/cms/replies/{reply_id}/resolve",
                headers={"Authorization": f"Bearer {token}"},
                json={"resolved": False},
                timeout=15,
            )
            row = r.json()
            assert row["resolved"] is False
            assert row["resolved_at"] is None
            assert row["resolved_by"] is None
            assert row["resolution_kind"] is None
            assert row["resolution_note"] is None
        finally:
            _delete_reply(token, reply_id)

    def test_replied_kind_accepted(self, token):
        email = f"iter164g-replied-{uuid.uuid4().hex[:8]}@example.com"
        reply_id = _create_reply(token, email)
        try:
            r = requests.patch(
                f"{BASE_URL}/api/cms/replies/{reply_id}/resolve",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "resolved": True,
                    "resolution_kind": "replied",
                    "resolution_note": "Sent outbound reply",
                },
                timeout=15,
            )
            assert r.status_code == 200
            row = r.json()
            assert row["resolution_kind"] == "replied"
            assert row["resolution_note"] == "Sent outbound reply"
        finally:
            _delete_reply(token, reply_id)

    def test_invalid_resolution_kind_rejected(self, token):
        email = f"iter164g-bad-{uuid.uuid4().hex[:8]}@example.com"
        reply_id = _create_reply(token, email)
        try:
            r = requests.patch(
                f"{BASE_URL}/api/cms/replies/{reply_id}/resolve",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "resolved": True,
                    "resolution_kind": "made_up_state",
                },
                timeout=15,
            )
            assert r.status_code == 400, r.text
        finally:
            _delete_reply(token, reply_id)

    def test_legacy_resolve_no_kind_still_works(self, token):
        email = f"iter164g-legacy-{uuid.uuid4().hex[:8]}@example.com"
        reply_id = _create_reply(token, email)
        try:
            r = requests.patch(
                f"{BASE_URL}/api/cms/replies/{reply_id}/resolve",
                headers={"Authorization": f"Bearer {token}"},
                json={"resolved": True},
                timeout=15,
            )
            assert r.status_code == 200
            row = r.json()
            assert row["resolved"] is True
            assert row.get("resolution_kind") is None
            assert row.get("resolution_note") is None
        finally:
            _delete_reply(token, reply_id)
