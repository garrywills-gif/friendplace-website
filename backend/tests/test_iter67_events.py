"""Iteration 67 — Events module (Session A).

Covers:
- Admin CRUD on cms_events (create/read/update/publish guards/delete).
- Slug uniqueness (regenerates -2, -3 suffixes).
- Cascade delete of event → event_rsvps.
- RSVP waitlist auto-flip when capacity is reached.
- RSVP promotion on cancellation of a "going" row.
- Public projection (no admin fields, only published+visible+upcoming).
- Stats fields events_count / events_upcoming_count.

Mints JWTs directly via `cms_module._make_admin_token` per the task
instructions — DO NOT reset the admin password.

Cleanup: any event created here is deleted at teardown, which also
cascades RSVPs. Both collections must be empty when the suite finishes.
"""

from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List

import pytest
import requests

# Import from the backend package so we can mint an admin token.
sys.path.insert(0, "/app/backend")

# Load backend/.env explicitly so JWT_SECRET (and MONGO_URL) are available
# to the test process — the FastAPI server loads them at boot, we don't.
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")

from cms_module import _make_admin_token  # noqa: E402

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://belong-together.preview.emergentagent.com"
BASE_URL = BASE_URL.rstrip("/")

ADMIN_EMAIL = "hello@friendplace.com.au"


def _iso_offset(hours: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


@pytest.fixture(scope="module")
def admin_headers() -> Dict[str, str]:
    # Look up the existing admin so we mint a token bound to their id.
    # Fall back to a synthetic id if the admin row isn't found (rare).
    from pymongo import MongoClient
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "test_database")
    client = MongoClient(mongo_url)
    admin = client[db_name].cms_admins.find_one({"email": ADMIN_EMAIL})
    if not admin:
        # Any admin row will do — pick the first.
        admin = client[db_name].cms_admins.find_one({})
    assert admin, "No CMS admin exists in DB; cannot mint token"
    token = _make_admin_token(admin["id"], admin["email"])
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def created_ids() -> List[str]:
    """Track ids for teardown."""
    return []


@pytest.fixture(scope="module", autouse=True)
def cleanup(admin_headers, created_ids):
    yield
    # Purge everything we created — cascade wipes RSVPs.
    for eid in created_ids:
        try:
            requests.delete(f"{BASE_URL}/api/cms/events/{eid}", headers=admin_headers, timeout=10)
        except Exception:
            pass
    # Belt-and-braces: sweep any TEST_-prefixed events that leaked.
    try:
        r = requests.get(f"{BASE_URL}/api/cms/events", headers=admin_headers, timeout=10)
        if r.ok:
            for ev in r.json().get("items", []):
                if (ev.get("title") or "").startswith("TEST_"):
                    requests.delete(f"{BASE_URL}/api/cms/events/{ev['id']}", headers=admin_headers, timeout=10)
    except Exception:
        pass


def _create_event(admin_headers, body=None) -> Dict[str, Any]:
    r = requests.post(
        f"{BASE_URL}/api/cms/events",
        headers=admin_headers,
        json=body or {},
        timeout=10,
    )
    assert r.status_code == 200, f"create_event returned {r.status_code}: {r.text}"
    return r.json()


# ─────────────────────────────────────────────────────────────
# Admin CRUD + defaults
# ─────────────────────────────────────────────────────────────

class TestEventCRUD:
    def test_create_draft_defaults(self, admin_headers, created_ids):
        ev = _create_event(admin_headers, {})
        created_ids.append(ev["id"])
        assert ev["title"] == "New event"
        assert ev["status"] == "draft"
        assert ev["timezone"] == "Australia/Sydney"
        assert ev["slug"].startswith("new-event")
        assert ev["capacity"] is None
        assert ev["cost_type"] == "free"
        assert ev["hidden"] is False
        assert ev["rsvp_counts"] == {"going": 0, "waitlist": 0}

    def test_slug_uniqueness_suffix(self, admin_headers, created_ids):
        # Two events with identical title should get different slugs.
        a = _create_event(admin_headers, {"title": "TEST_Coffee Chat"})
        b = _create_event(admin_headers, {"title": "TEST_Coffee Chat"})
        c = _create_event(admin_headers, {"title": "TEST_Coffee Chat"})
        created_ids.extend([a["id"], b["id"], c["id"]])
        slugs = {a["slug"], b["slug"], c["slug"]}
        assert len(slugs) == 3, f"expected 3 unique slugs, got {slugs}"
        assert "test-coffee-chat" in slugs
        assert "test-coffee-chat-2" in slugs
        assert "test-coffee-chat-3" in slugs

    def test_get_and_patch_partial(self, admin_headers, created_ids):
        ev = _create_event(admin_headers, {"title": "TEST_Original"})
        created_ids.append(ev["id"])
        r = requests.patch(
            f"{BASE_URL}/api/cms/events/{ev['id']}",
            headers=admin_headers,
            json={"description": "hello", "capacity": 10, "is_online": True},
            timeout=10,
        )
        assert r.status_code == 200
        got = r.json()
        assert got["description"] == "hello"
        assert got["capacity"] == 10
        assert got["is_online"] is True
        assert got["title"] == "TEST_Original"  # untouched

    def test_publish_requires_title_and_starts_at(self, admin_headers, created_ids):
        # Draft with empty title (blank) — force via patch, then try to publish.
        ev = _create_event(admin_headers, {"title": "TEST_Publishable"})
        created_ids.append(ev["id"])
        # Missing starts_at → publish must 400.
        r = requests.patch(
            f"{BASE_URL}/api/cms/events/{ev['id']}",
            headers=admin_headers,
            json={"status": "published"},
            timeout=10,
        )
        assert r.status_code == 400, f"expected 400 for missing starts_at, got {r.status_code}: {r.text}"
        # Empty title → publish must 400.
        r2 = requests.patch(
            f"{BASE_URL}/api/cms/events/{ev['id']}",
            headers=admin_headers,
            json={"title": "", "starts_at": _iso_offset(48), "status": "published"},
            timeout=10,
        )
        assert r2.status_code == 400, f"expected 400 for empty title, got {r2.status_code}: {r2.text}"
        # With both set → publish OK.
        r3 = requests.patch(
            f"{BASE_URL}/api/cms/events/{ev['id']}",
            headers=admin_headers,
            json={"title": "TEST_Publishable", "starts_at": _iso_offset(48), "status": "published"},
            timeout=10,
        )
        assert r3.status_code == 200, r3.text
        assert r3.json()["status"] == "published"

    def test_delete_event_cascades_rsvps(self, admin_headers):
        ev = _create_event(admin_headers, {"title": "TEST_Cascade", "capacity": 5})
        # Add 2 RSVPs.
        for name in ("A", "B"):
            r = requests.post(
                f"{BASE_URL}/api/cms/events/{ev['id']}/rsvps",
                headers=admin_headers,
                json={"name": name},
                timeout=10,
            )
            assert r.status_code == 200
        # Confirm they exist.
        r = requests.get(f"{BASE_URL}/api/cms/events/{ev['id']}/rsvps", headers=admin_headers, timeout=10)
        assert r.status_code == 200
        assert len(r.json()["items"]) == 2
        # Delete event.
        d = requests.delete(f"{BASE_URL}/api/cms/events/{ev['id']}", headers=admin_headers, timeout=10)
        assert d.status_code == 200
        # Roster lookup now returns 404 (event gone).
        r2 = requests.get(f"{BASE_URL}/api/cms/events/{ev['id']}/rsvps", headers=admin_headers, timeout=10)
        assert r2.status_code == 404
        # And in Mongo directly — ensure no orphans.
        from pymongo import MongoClient
        mongo = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
        remaining = mongo[os.environ.get("DB_NAME", "test_database")].event_rsvps.count_documents({"event_id": ev["id"]})
        assert remaining == 0, f"expected 0 orphan RSVPs after cascade, got {remaining}"


# ─────────────────────────────────────────────────────────────
# RSVP waitlist logic + promotion
# ─────────────────────────────────────────────────────────────

class TestRsvpWaitlist:
    def test_capacity_2_third_goes_to_waitlist(self, admin_headers, created_ids):
        ev = _create_event(admin_headers, {"title": "TEST_Cap2", "capacity": 2})
        created_ids.append(ev["id"])
        r1 = requests.post(f"{BASE_URL}/api/cms/events/{ev['id']}/rsvps", headers=admin_headers, json={"name": "One"}, timeout=10).json()
        r2 = requests.post(f"{BASE_URL}/api/cms/events/{ev['id']}/rsvps", headers=admin_headers, json={"name": "Two"}, timeout=10).json()
        r3 = requests.post(f"{BASE_URL}/api/cms/events/{ev['id']}/rsvps", headers=admin_headers, json={"name": "Three"}, timeout=10).json()
        assert r1["status"] == "going"
        assert r2["status"] == "going"
        assert r3["status"] == "waitlist", f"third RSVP should be waitlist, got {r3['status']}"
        # Confirm counts endpoint.
        roster = requests.get(f"{BASE_URL}/api/cms/events/{ev['id']}/rsvps", headers=admin_headers, timeout=10).json()
        assert roster["counts"] == {"going": 2, "waitlist": 1}
        assert roster["capacity"] == 2

    def test_cancelling_going_promotes_top_of_waitlist(self, admin_headers, created_ids):
        ev = _create_event(admin_headers, {"title": "TEST_Promote", "capacity": 1})
        created_ids.append(ev["id"])
        going = requests.post(f"{BASE_URL}/api/cms/events/{ev['id']}/rsvps", headers=admin_headers, json={"name": "Going"}, timeout=10).json()
        wait = requests.post(f"{BASE_URL}/api/cms/events/{ev['id']}/rsvps", headers=admin_headers, json={"name": "Wait"}, timeout=10).json()
        assert going["status"] == "going"
        assert wait["status"] == "waitlist"
        # Cancel the going row.
        p = requests.patch(
            f"{BASE_URL}/api/cms/events/{ev['id']}/rsvps/{going['id']}",
            headers=admin_headers,
            json={"status": "cancelled"},
            timeout=10,
        )
        assert p.status_code == 200
        # The waitlist row should have been auto-promoted.
        roster = requests.get(f"{BASE_URL}/api/cms/events/{ev['id']}/rsvps", headers=admin_headers, timeout=10).json()
        promoted = next(x for x in roster["items"] if x["id"] == wait["id"])
        assert promoted["status"] == "going", f"waitlist row should be promoted, got {promoted['status']}"
        assert roster["counts"] == {"going": 1, "waitlist": 0}

    def test_no_capacity_no_waitlist(self, admin_headers, created_ids):
        ev = _create_event(admin_headers, {"title": "TEST_Unlimited"})  # capacity=None
        created_ids.append(ev["id"])
        for name in ("A", "B", "C", "D"):
            r = requests.post(f"{BASE_URL}/api/cms/events/{ev['id']}/rsvps", headers=admin_headers, json={"name": name}, timeout=10).json()
            assert r["status"] == "going"


# ─────────────────────────────────────────────────────────────
# Public listing + payload leaks
# ─────────────────────────────────────────────────────────────

class TestPublicEvents:
    def test_published_upcoming_shows_up(self, admin_headers, created_ids):
        ev = _create_event(admin_headers, {"title": "TEST_PublicShow"})
        created_ids.append(ev["id"])
        r = requests.patch(
            f"{BASE_URL}/api/cms/events/{ev['id']}",
            headers=admin_headers,
            json={"starts_at": _iso_offset(48), "status": "published"},
            timeout=10,
        )
        assert r.status_code == 200
        pub = requests.get(f"{BASE_URL}/api/public/events", timeout=10)
        assert pub.status_code == 200
        events = pub.json()["events"]
        ids = [e["id"] for e in events]
        assert ev["id"] in ids
        # Admin fields must not leak.
        row = next(e for e in events if e["id"] == ev["id"])
        for leaked in ("created_by", "status", "hidden", "updated_at", "created_at"):
            assert leaked not in row, f"public payload leaked admin field: {leaked}"
        # Public payload MUST include rsvp_counts.
        assert "rsvp_counts" in row

    def test_hidden_published_is_excluded(self, admin_headers, created_ids):
        ev = _create_event(admin_headers, {"title": "TEST_HiddenPub"})
        created_ids.append(ev["id"])
        r = requests.patch(
            f"{BASE_URL}/api/cms/events/{ev['id']}",
            headers=admin_headers,
            json={"starts_at": _iso_offset(72), "status": "published", "hidden": True},
            timeout=10,
        )
        assert r.status_code == 200
        pub = requests.get(f"{BASE_URL}/api/public/events", timeout=10)
        ids = [e["id"] for e in pub.json()["events"]]
        assert ev["id"] not in ids, "hidden published event must not appear in public listing"

    def test_past_event_excluded(self, admin_headers, created_ids):
        ev = _create_event(admin_headers, {"title": "TEST_Past"})
        created_ids.append(ev["id"])
        r = requests.patch(
            f"{BASE_URL}/api/cms/events/{ev['id']}",
            headers=admin_headers,
            json={"starts_at": _iso_offset(-48), "status": "published"},
            timeout=10,
        )
        assert r.status_code == 200
        pub = requests.get(f"{BASE_URL}/api/public/events", timeout=10)
        ids = [e["id"] for e in pub.json()["events"]]
        assert ev["id"] not in ids, "past event must not appear in public listing"

    def test_public_ordering_by_starts_at(self, admin_headers, created_ids):
        a = _create_event(admin_headers, {"title": "TEST_OrderA"})
        b = _create_event(admin_headers, {"title": "TEST_OrderB"})
        created_ids.extend([a["id"], b["id"]])
        # A far future, B near future — B should come first.
        requests.patch(f"{BASE_URL}/api/cms/events/{a['id']}", headers=admin_headers,
                       json={"starts_at": _iso_offset(240), "status": "published"}, timeout=10)
        requests.patch(f"{BASE_URL}/api/cms/events/{b['id']}", headers=admin_headers,
                       json={"starts_at": _iso_offset(24), "status": "published"}, timeout=10)
        pub = requests.get(f"{BASE_URL}/api/public/events", timeout=10).json()
        ids = [e["id"] for e in pub["events"] if e["id"] in (a["id"], b["id"])]
        assert ids == [b["id"], a["id"]], f"expected B before A, got {ids}"

    def test_public_slug_missing_returns_404(self):
        slug = f"nonexistent-{uuid.uuid4().hex[:6]}"
        r = requests.get(f"{BASE_URL}/api/public/events/{slug}", timeout=10)
        assert r.status_code == 404

    def test_public_slug_draft_returns_404(self, admin_headers, created_ids):
        ev = _create_event(admin_headers, {"title": "TEST_Draft404"})
        created_ids.append(ev["id"])
        # Still draft — the public detail must 404.
        r = requests.get(f"{BASE_URL}/api/public/events/{ev['slug']}", timeout=10)
        assert r.status_code == 404


# ─────────────────────────────────────────────────────────────
# Stats
# ─────────────────────────────────────────────────────────────

class TestStats:
    def test_events_count_fields_are_integers_and_reflect_creation(self, admin_headers, created_ids):
        s0 = requests.get(f"{BASE_URL}/api/cms/stats", headers=admin_headers, timeout=10).json()
        assert isinstance(s0["events_count"], int)
        assert isinstance(s0["events_upcoming_count"], int)
        base_count = s0["events_count"]
        base_upcoming = s0["events_upcoming_count"]

        ev = _create_event(admin_headers, {"title": "TEST_StatsCounter"})
        created_ids.append(ev["id"])
        s1 = requests.get(f"{BASE_URL}/api/cms/stats", headers=admin_headers, timeout=10).json()
        assert s1["events_count"] == base_count + 1
        # Not yet published → upcoming shouldn't move.
        assert s1["events_upcoming_count"] == base_upcoming

        # Publish + future starts_at → upcoming increments.
        requests.patch(f"{BASE_URL}/api/cms/events/{ev['id']}", headers=admin_headers,
                       json={"starts_at": _iso_offset(72), "status": "published"}, timeout=10)
        s2 = requests.get(f"{BASE_URL}/api/cms/stats", headers=admin_headers, timeout=10).json()
        assert s2["events_upcoming_count"] == base_upcoming + 1
