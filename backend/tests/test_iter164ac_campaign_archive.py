"""iter164ac — Campaign soft-archive tests.

Contract with Garry (25 Aug 2026):

  • Sent campaigns are permanent — never hard-deleted.
  • Archive is a bookkeeping flip (`archived_at`, `archived_by`,
    `archived_by_email`) that DOES NOT touch:
      - `status`
      - the recipient/delivery sub-collection
      - `stats` (targeted / accepted / failed / opened / clicked)
      - `sample_html` / `sample_subject`
      - message-ids, send records, or any other historical data
  • Default `GET /api/cms/campaigns` hides archived campaigns.
  • `?include_archived=true`  → union (audit view).
  • `?archived=true`          → archived only (recovery view).
  • Archive allowed only for status ∈ {sent, failed}. `sending`
    campaigns cannot be archived (footgun guard).
  • Idempotent: archive-of-archived and unarchive-of-active are
    no-ops that return the current shape.
  • Draft DELETE endpoint stays: still rejects non-draft campaigns.

The tests below hit a running backend on localhost:8001.
"""

from __future__ import annotations

import time
import uuid

import pytest
import requests

BASE = "http://localhost:8001"
ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASSWORD = "TestPass2026!"


@pytest.fixture(scope="module")
def admin_token() -> str:
    r = requests.post(
        f"{BASE}/api/cms/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["token"]


def _create_draft(admin_token: str, name: str) -> dict:
    r = requests.post(
        f"{BASE}/api/cms/campaigns",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "template": "announcement",
            "name": name,
            "subject": "iter164ac test",
            "title": "hi",
            "body_md": "hello",
            "audience_filter": {"kind": "founding_members"},
        },
        timeout=15,
    )
    r.raise_for_status()
    return r.json()


def _force_status(campaign_id: str, status: str,
                  stats: dict | None = None,
                  sample_html: str | None = None) -> None:
    """Bypass the send worker and stamp a terminal status directly on
    the doc. Uses PyMongo (not the API surface) because the API
    doesn't have a knob to fake a send outcome — and we want
    hermetic tests that don't actually hit Resend.
    """
    import os
    from pymongo import MongoClient
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    client = MongoClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "test_database")]
    updates = {"status": status}
    if stats:
        updates["stats"] = stats
    if sample_html:
        updates["sample_html"] = sample_html
    updates["finished_at"] = "2026-08-25T00:00:00Z"
    updates["sent_at"] = "2026-08-25T00:00:00Z"
    db.campaigns.update_one({"id": campaign_id}, {"$set": updates})
    client.close()


def _get(admin_token: str, path: str) -> dict:
    r = requests.get(
        f"{BASE}{path}",
        headers={"Authorization": f"Bearer {admin_token}"},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()


def _archive(admin_token: str, cid: str, expected: int = 200):
    r = requests.post(
        f"{BASE}/api/cms/campaigns/{cid}/archive",
        headers={"Authorization": f"Bearer {admin_token}"},
        timeout=15,
    )
    assert r.status_code == expected, r.text
    return r


def _unarchive(admin_token: str, cid: str, expected: int = 200):
    r = requests.post(
        f"{BASE}/api/cms/campaigns/{cid}/unarchive",
        headers={"Authorization": f"Bearer {admin_token}"},
        timeout=15,
    )
    assert r.status_code == expected, r.text
    return r


# ─── Archive gate: which statuses are archivable ─────────────────


class TestArchiveGate:
    def test_401_without_admin_token(self):
        # Create with a token, then hit archive without.
        rlogin = requests.post(
            f"{BASE}/api/cms/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            timeout=10,
        )
        token = rlogin.json()["token"]
        c = _create_draft(token, f"noauth-{uuid.uuid4().hex[:8]}")
        _force_status(c["id"], "sent")
        r = requests.post(
            f"{BASE}/api/cms/campaigns/{c['id']}/archive",
            timeout=10,
        )
        assert r.status_code == 401

    def test_404_when_missing(self, admin_token):
        r = requests.post(
            f"{BASE}/api/cms/campaigns/does-not-exist/archive",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=10,
        )
        assert r.status_code == 404

    def test_refuses_draft(self, admin_token):
        c = _create_draft(admin_token, f"draft-{uuid.uuid4().hex[:8]}")
        r = _archive(admin_token, c["id"], expected=400)
        assert "completed" in r.text.lower()

    def test_refuses_scheduled(self, admin_token):
        c = _create_draft(admin_token, f"sched-{uuid.uuid4().hex[:8]}")
        _force_status(c["id"], "scheduled")
        r = _archive(admin_token, c["id"], expected=400)
        assert "completed" in r.text.lower()

    def test_refuses_sending(self, admin_token):
        c = _create_draft(admin_token, f"sending-{uuid.uuid4().hex[:8]}")
        _force_status(c["id"], "sending")
        r = _archive(admin_token, c["id"], expected=400)
        assert "sending" not in r.text.lower() or "completed" in r.text.lower()

    def test_allows_sent(self, admin_token):
        c = _create_draft(admin_token, f"sent-{uuid.uuid4().hex[:8]}")
        _force_status(c["id"], "sent")
        r = _archive(admin_token, c["id"])
        b = r.json()
        assert b["ok"] is True
        assert b["is_archived"] is True
        assert b["archived_at"]
        assert b["archived_by_email"] == ADMIN_EMAIL.lower()

    def test_allows_failed(self, admin_token):
        c = _create_draft(admin_token, f"failed-{uuid.uuid4().hex[:8]}")
        _force_status(c["id"], "failed")
        r = _archive(admin_token, c["id"])
        assert r.json()["is_archived"] is True


# ─── List filtering ──────────────────────────────────────────────


class TestListFiltering:
    def test_default_hides_archived_and_include_archived_shows_all(
        self, admin_token
    ):
        marker = f"listfilter-{uuid.uuid4().hex[:8]}"
        c_active = _create_draft(admin_token, f"{marker}-active")
        c_arch = _create_draft(admin_token, f"{marker}-arch")
        _force_status(c_arch["id"], "sent")
        _archive(admin_token, c_arch["id"])

        default_list = _get(admin_token, "/api/cms/campaigns")
        default_ids = {r["id"] for r in default_list["rows"]}
        assert c_active["id"] in default_ids
        assert c_arch["id"] not in default_ids, (
            "archived campaign must be hidden from default list"
        )

        include_list = _get(
            admin_token, "/api/cms/campaigns?include_archived=true",
        )
        include_ids = {r["id"] for r in include_list["rows"]}
        assert c_active["id"] in include_ids
        assert c_arch["id"] in include_ids

    def test_archived_only_view(self, admin_token):
        marker = f"archived-only-{uuid.uuid4().hex[:8]}"
        c_active = _create_draft(admin_token, f"{marker}-active")
        c_arch = _create_draft(admin_token, f"{marker}-arch")
        _force_status(c_arch["id"], "sent")
        _archive(admin_token, c_arch["id"])

        archived = _get(admin_token, "/api/cms/campaigns?archived=true")
        arch_ids = {r["id"] for r in archived["rows"]}
        assert c_arch["id"] in arch_ids
        assert c_active["id"] not in arch_ids


# ─── Preservation: archive must NOT mutate downstream data ───────


class TestArchivePreserves:
    def test_status_stats_sample_html_and_metadata_preserved(self, admin_token):
        c = _create_draft(admin_token, f"preserve-{uuid.uuid4().hex[:8]}")
        stats = {
            "targeted": 250, "accepted": 244, "failed": 6,
            "delivered": 240, "opened": 120, "clicked": 40, "bounced": 4,
        }
        sample_html = "<div>this is the exact rendered sample the send worker stored</div>"
        _force_status(c["id"], "sent", stats=stats, sample_html=sample_html)

        # Snapshot BEFORE
        detail_before = _get(admin_token, f"/api/cms/campaigns/{c['id']}")
        assert detail_before["status"] == "sent"
        assert detail_before["stats"] == stats
        assert detail_before["sample_html"] == sample_html

        # Archive
        _archive(admin_token, c["id"])

        # Snapshot AFTER — every downstream field must match byte-for-byte.
        detail_after = _get(admin_token, f"/api/cms/campaigns/{c['id']}")
        assert detail_after["status"] == "sent", (
            "archive MUST NOT change status"
        )
        assert detail_after["stats"] == stats, (
            "archive MUST NOT change stats"
        )
        assert detail_after["sample_html"] == sample_html, (
            "archive MUST NOT change the rendered sample HTML"
        )
        # New metadata IS added.
        assert detail_after["is_archived"] is True
        assert detail_after["archived_at"]
        assert detail_after["archived_by_email"] == ADMIN_EMAIL.lower()

    def test_recipient_rows_untouched(self, admin_token):
        """Archive must not delete or mutate any recipient row."""
        import os
        from pymongo import MongoClient
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
        client = MongoClient(os.environ["MONGO_URL"])
        db = client[os.environ.get("DB_NAME", "test_database")]
        try:
            c = _create_draft(admin_token, f"recipients-{uuid.uuid4().hex[:8]}")
            # Seed a few fake recipient rows.
            for i in range(3):
                db.campaign_recipients.insert_one({
                    "id":            f"cr-{c['id']}-{i}",
                    "campaign_id":   c["id"],
                    "user_id":       f"user-{i}",
                    "email":         f"seed{i}@example.com",
                    "status":        "delivered",
                    "message_id":    f"msg-{i}",
                    "delivered_at":  "2026-08-25T00:00:00Z",
                })
            _force_status(c["id"], "sent")
            before = list(db.campaign_recipients.find({"campaign_id": c["id"]}))
            _archive(admin_token, c["id"])
            after = list(db.campaign_recipients.find({"campaign_id": c["id"]}))
            assert len(after) == len(before), (
                "archive dropped recipient rows"
            )
            # Bytes-for-bytes match on every recipient row.
            def _norm(r):
                return {k: v for k, v in r.items() if k != "_id"}
            assert sorted([_norm(r) for r in after], key=lambda r: r["id"]) == \
                   sorted([_norm(r) for r in before], key=lambda r: r["id"])
        finally:
            client.close()


# ─── Idempotency ─────────────────────────────────────────────────


class TestIdempotency:
    def test_archive_twice_is_a_noop(self, admin_token):
        c = _create_draft(admin_token, f"twice-{uuid.uuid4().hex[:8]}")
        _force_status(c["id"], "sent")
        first = _archive(admin_token, c["id"]).json()
        second = _archive(admin_token, c["id"]).json()
        assert first["archived_at"] == second["archived_at"], (
            "second archive must not overwrite the timestamp"
        )
        assert second["already_archived"] is True

    def test_unarchive_active_is_a_noop(self, admin_token):
        c = _create_draft(admin_token, f"unarch-noop-{uuid.uuid4().hex[:8]}")
        _force_status(c["id"], "sent")
        r = _unarchive(admin_token, c["id"]).json()
        assert r["is_archived"] is False
        assert r["already_active"] is True


# ─── Round-trip: archive → unarchive returns to default list ─────


class TestRoundTrip:
    def test_archive_then_unarchive(self, admin_token):
        marker = f"roundtrip-{uuid.uuid4().hex[:8]}"
        c = _create_draft(admin_token, marker)
        _force_status(c["id"], "sent")

        # Baseline: appears in default list.
        assert c["id"] in {
            r["id"] for r in _get(admin_token, "/api/cms/campaigns")["rows"]
        }

        # Archive → gone from default.
        _archive(admin_token, c["id"])
        assert c["id"] not in {
            r["id"] for r in _get(admin_token, "/api/cms/campaigns")["rows"]
        }

        # Unarchive → back in default.
        r = _unarchive(admin_token, c["id"]).json()
        assert r["is_archived"] is False
        assert r["already_active"] is False
        assert c["id"] in {
            r["id"] for r in _get(admin_token, "/api/cms/campaigns")["rows"]
        }

        # ...and clears from the archived-only view.
        arch_only = _get(admin_token, "/api/cms/campaigns?archived=true")
        assert c["id"] not in {r["id"] for r in arch_only["rows"]}


# ─── Draft DELETE endpoint still guarded ─────────────────────────


class TestDraftDeleteStillProtected:
    def test_deleting_a_sent_campaign_still_rejected(self, admin_token):
        c = _create_draft(admin_token, f"deldef-{uuid.uuid4().hex[:8]}")
        _force_status(c["id"], "sent")
        r = requests.delete(
            f"{BASE}/api/cms/campaigns/{c['id']}",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=10,
        )
        assert r.status_code == 400
        assert "permanent" in r.text.lower() or "deleted" in r.text.lower()

    def test_deleting_a_draft_still_works(self, admin_token):
        c = _create_draft(admin_token, f"draftok-{uuid.uuid4().hex[:8]}")
        r = requests.delete(
            f"{BASE}/api/cms/campaigns/{c['id']}",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=10,
        )
        assert r.status_code == 200
