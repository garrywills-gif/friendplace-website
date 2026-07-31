"""Iteration 127: Founding Members CRM (Phase 1) — backend tests.

Coverage:
- GET /api/cms/crm/founding-members (list + status filter + q search + legacy 'new' backfill)
- GET /api/cms/crm/founding-members/stats
- PATCH /api/cms/crm/founding-members/{id} (status/notes/tags + history + 404)
- Regression on curated showcase (/api/cms/founding-members CRUD + reorder)
- POST /api/public/register-interest defaults status='registered' and bumps stats
- POST /api/cms/email-previews/preview-token → 64-hex token grants iframe access
- George live tools: count_interest_registrations, list_interest_registrations, founding_members_summary
"""
from __future__ import annotations

import os
import re
import sys
import asyncio
import time
import uuid
import pytest
import requests

sys.path.insert(0, "/app/backend")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = "http://localhost:8001"

ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASSWORD = "TestPass2026!"

HEX64 = re.compile(r"^[0-9a-f]{64}$")


# ─── Fixtures ─────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{BASE_URL}/api/cms/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok, f"no token in login response: {r.json()}"
    return tok


@pytest.fixture(scope="module")
def client(admin_token):
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {admin_token}",
    })
    return s


@pytest.fixture(scope="module")
def anon():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ─── Seed test rows so we can exercise filters + PATCH deterministically ──

_SEEDED_IDS: list[str] = []


@pytest.fixture(scope="module", autouse=True)
def _seed_and_cleanup(client):
    """Seed a couple of live (non-is_test) rows via the public endpoint so
    the CRM list/stats have deterministic data. Cleanup after."""
    from motor.motor_asyncio import AsyncIOMotorClient
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "test_database")

    # Insert directly to MongoDB so we can guarantee timestamps, is_test=False,
    # and unique emails without triggering the 24h idempotency guard.
    async def _seed():
        from datetime import datetime, timezone
        c = AsyncIOMotorClient(mongo_url)
        db = c[db_name]
        now = datetime.now(timezone.utc).isoformat()
        for i, status in enumerate(["registered", "new", "invited"]):
            doc_id = f"iter127-test-{uuid.uuid4()}"
            _SEEDED_IDS.append(doc_id)
            await db.interest_registrations.insert_one({
                "id": doc_id,
                "first_name": f"Iter127Seed{i}",
                "email": f"iter127-seed-{i}-{doc_id[:8]}@example.com",
                "state_country": "NSW, Australia" if i != 2 else "VIC, Australia",
                "heard_from": "test-suite" if i == 0 else "friend",
                "companion_choice": "george" if i % 2 == 0 else "georgia",
                "status": status,
                "tags": [] if i == 0 else ["seed"],
                "admin_notes": "",
                "created_at": now,
                "is_test": False,   # we want these to be visible to CRM
            })
        c.close()

    async def _wipe():
        c = AsyncIOMotorClient(mongo_url)
        db = c[db_name]
        if _SEEDED_IDS:
            await db.interest_registrations.delete_many({"id": {"$in": _SEEDED_IDS}})
        # also clean up any register-interest emails we created below
        await db.interest_registrations.delete_many({"email": {"$regex": r"^iter127-pub-"}})
        c.close()

    asyncio.get_event_loop().run_until_complete(_seed())
    yield
    asyncio.get_event_loop().run_until_complete(_wipe())


# ─── 1. GET /api/cms/crm/founding-members — list, filter, search ──────────

class TestCrmList:
    def test_list_returns_shape(self, client):
        r = client.get(f"{BASE_URL}/api/cms/crm/founding-members")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "count" in data and "rows" in data
        assert isinstance(data["rows"], list)

    def test_seeded_rows_visible_and_legacy_new_backfilled(self, client):
        r = client.get(f"{BASE_URL}/api/cms/crm/founding-members?limit=1000")
        assert r.status_code == 200
        rows = r.json()["rows"]
        by_id = {row["id"]: row for row in rows if row.get("id") in _SEEDED_IDS}
        assert set(by_id.keys()) == set(_SEEDED_IDS), f"missing seeded rows: found {set(by_id.keys())}, want {set(_SEEDED_IDS)}"
        # Legacy 'new' MUST be mapped to 'registered' in the response
        legacy = by_id[_SEEDED_IDS[1]]
        assert legacy["status"] == "registered", f"legacy 'new' not mapped: {legacy}"
        # Defaults injected
        for row in by_id.values():
            assert "admin_notes" in row
            assert isinstance(row.get("tags"), list)

    def test_status_filter_registered_includes_legacy_new(self, client):
        r = client.get(f"{BASE_URL}/api/cms/crm/founding-members?status=registered&limit=1000")
        assert r.status_code == 200
        rows = r.json()["rows"]
        ids = {row["id"] for row in rows}
        # Both the 'registered' seed and the legacy 'new' seed must appear
        assert _SEEDED_IDS[0] in ids
        assert _SEEDED_IDS[1] in ids
        # The 'invited' seed must NOT
        assert _SEEDED_IDS[2] not in ids

    def test_status_filter_invited(self, client):
        r = client.get(f"{BASE_URL}/api/cms/crm/founding-members?status=invited&limit=1000")
        assert r.status_code == 200
        rows = r.json()["rows"]
        ids = {row["id"] for row in rows}
        assert _SEEDED_IDS[2] in ids
        assert _SEEDED_IDS[0] not in ids
        assert _SEEDED_IDS[1] not in ids

    def test_free_text_search_on_first_name(self, client):
        r = client.get(f"{BASE_URL}/api/cms/crm/founding-members?q=Iter127Seed0")
        assert r.status_code == 200
        rows = r.json()["rows"]
        assert any(row["id"] == _SEEDED_IDS[0] for row in rows)

    def test_free_text_search_on_state_country(self, client):
        r = client.get(f"{BASE_URL}/api/cms/crm/founding-members?q=VIC")
        assert r.status_code == 200
        rows = r.json()["rows"]
        assert any(row["id"] == _SEEDED_IDS[2] for row in rows)

    def test_free_text_search_on_tag(self, client):
        r = client.get(f"{BASE_URL}/api/cms/crm/founding-members?q=seed")
        assert r.status_code == 200
        rows = r.json()["rows"]
        # tag "seed" is only on seeds 1 & 2
        ids = {row["id"] for row in rows}
        assert _SEEDED_IDS[1] in ids or _SEEDED_IDS[2] in ids

    def test_requires_auth(self, anon):
        r = anon.get(f"{BASE_URL}/api/cms/crm/founding-members")
        assert r.status_code in (401, 403)


# ─── 2. GET stats ─────────────────────────────────────────────────────────

class TestCrmStats:
    def test_stats_envelope(self, client):
        r = client.get(f"{BASE_URL}/api/cms/crm/founding-members/stats")
        assert r.status_code == 200, r.text
        s = r.json()
        for k in ("total", "new_today", "awaiting_contact", "invited", "joined", "opted_out", "latest"):
            assert k in s, f"missing key '{k}' in stats: {s}"
        # counts are ints
        for k in ("total", "new_today", "awaiting_contact", "invited", "joined", "opted_out"):
            assert isinstance(s[k], int)
        # latest, if present, has the required fields
        if s["latest"] is not None:
            for k in ("name", "email", "state_country", "created_at", "id"):
                assert k in s["latest"], f"latest missing '{k}': {s['latest']}"

    def test_awaiting_contact_includes_legacy_new(self, client):
        s = client.get(f"{BASE_URL}/api/cms/crm/founding-members/stats").json()
        # Our two 'registered' + 'new' seeds should both be in awaiting_contact
        assert s["awaiting_contact"] >= 2

    def test_invited_count_reflects_seed(self, client):
        s = client.get(f"{BASE_URL}/api/cms/crm/founding-members/stats").json()
        assert s["invited"] >= 1


# ─── 3. PATCH /api/cms/crm/founding-members/{id} ──────────────────────────

class TestCrmPatch:
    def test_patch_status_persists_and_appends_history(self, client):
        mid = _SEEDED_IDS[0]
        r = client.patch(
            f"{BASE_URL}/api/cms/crm/founding-members/{mid}",
            json={"status": "invited"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "invited"
        # verify via list read-back
        listed = client.get(f"{BASE_URL}/api/cms/crm/founding-members?limit=1000").json()["rows"]
        got = next(x for x in listed if x["id"] == mid)
        assert got["status"] == "invited"
        # history entry appended
        assert isinstance(got.get("history"), list) and len(got["history"]) >= 1
        assert got["history"][-1].get("status") == "invited"
        assert got["history"][-1].get("admin_id")

    def test_patch_notes_and_tags(self, client):
        mid = _SEEDED_IDS[0]
        r = client.patch(
            f"{BASE_URL}/api/cms/crm/founding-members/{mid}",
            json={"admin_notes": "Rang Mon. Callback Wed.", "tags": ["priority", "coast"]},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["admin_notes"] == "Rang Mon. Callback Wed."
        assert body["tags"] == ["priority", "coast"]

    def test_patch_invalid_status(self, client):
        mid = _SEEDED_IDS[0]
        r = client.patch(
            f"{BASE_URL}/api/cms/crm/founding-members/{mid}",
            json={"status": "banana"},
        )
        assert r.status_code == 400

    def test_patch_unknown_id_returns_404(self, client):
        r = client.patch(
            f"{BASE_URL}/api/cms/crm/founding-members/does-not-exist",
            json={"status": "invited"},
        )
        assert r.status_code == 404

    def test_patch_empty_body_400(self, client):
        mid = _SEEDED_IDS[0]
        r = client.patch(f"{BASE_URL}/api/cms/crm/founding-members/{mid}", json={})
        assert r.status_code == 400

    def test_patch_requires_auth(self, anon):
        r = anon.patch(f"{BASE_URL}/api/cms/crm/founding-members/xxx", json={"status": "invited"})
        assert r.status_code in (401, 403)


# ─── 4. Regression: curated showcase /api/cms/founding-members still works ─

class TestCuratedShowcaseRegression:
    _created_id: str | None = None

    def test_showcase_list(self, client):
        r = client.get(f"{BASE_URL}/api/cms/founding-members")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "items" in data and "count" in data

    def test_showcase_create(self, client):
        r = client.post(
            f"{BASE_URL}/api/cms/founding-members",
            json={"name": "TEST_iter127_showcase", "role": "Founding Member"},
        )
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["id"]
        type(self)._created_id = doc["id"]

    def test_showcase_patch(self, client):
        assert self._created_id
        r = client.patch(
            f"{BASE_URL}/api/cms/founding-members/{self._created_id}",
            json={"name": "TEST_iter127_showcase_updated", "location": "Newcastle"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["name"] == "TEST_iter127_showcase_updated"

    def test_showcase_reorder(self, client):
        # Fetch current showcase items, reorder same list (no-op reorder)
        listed = client.get(f"{BASE_URL}/api/cms/founding-members").json()["items"]
        ids = [x["id"] for x in listed]
        if not ids:
            pytest.skip("no showcase items to reorder")
        r = client.post(f"{BASE_URL}/api/cms/founding-members/reorder", json={"ids": ids})
        assert r.status_code == 200, r.text

    def test_showcase_delete(self, client):
        assert self._created_id
        r = client.delete(f"{BASE_URL}/api/cms/founding-members/{self._created_id}")
        assert r.status_code == 200, r.text


# ─── 5. POST /api/public/register-interest — defaults + stats bump ────────

class TestPublicRegisterInterestFlow:
    def test_register_sets_default_registered_and_bumps_stats(self, client, anon):
        stats_before = client.get(f"{BASE_URL}/api/cms/crm/founding-members/stats").json()
        email = f"iter127-pub-{uuid.uuid4().hex[:12]}@example.com"
        r = anon.post(
            f"{BASE_URL}/api/public/register-interest",
            json={
                "first_name": "Iter127Pub",
                "email": email,
                "state_country": "NSW, Australia",
                "heard_from": "test",
                "companion_choice": "george",
            },
        )
        assert r.status_code in (200, 201), r.text
        # Give the write a moment
        time.sleep(0.5)
        # Verify it appears in CRM list with status='registered'
        listed = client.get(f"{BASE_URL}/api/cms/crm/founding-members?q=" + email).json()["rows"]
        assert listed, f"newly registered {email} not in CRM list"
        assert listed[0]["status"] == "registered", f"got status={listed[0]['status']}"
        # Stats total + awaiting_contact both bumped by at least 1
        stats_after = client.get(f"{BASE_URL}/api/cms/crm/founding-members/stats").json()
        assert stats_after["total"] >= stats_before["total"] + 1
        assert stats_after["awaiting_contact"] >= stats_before["awaiting_contact"] + 1


# ─── 6. Preview-token flow: 64-hex → grants iframe access ─────────────────

class TestPreviewTokenSecurity:
    def test_mint_returns_64_hex(self, client):
        r = client.post(f"{BASE_URL}/api/cms/email-previews/preview-token", json={})
        assert r.status_code == 200, r.text
        body = r.json()
        assert "token" in body and "expires_at" in body and "ttl_seconds" in body
        tok = body["token"]
        assert HEX64.match(tok), f"token not 64-hex: {tok!r}"
        assert isinstance(body["ttl_seconds"], int) and body["ttl_seconds"] > 0

    def test_iframe_missing_token_401(self, anon):
        r = anon.get(f"{BASE_URL}/api/cms/email-previews/welcome.html")
        assert r.status_code == 401, f"expected 401 without token, got {r.status_code}"

    def test_iframe_with_preview_token_200(self, client, anon):
        tok = client.post(f"{BASE_URL}/api/cms/email-previews/preview-token", json={}).json()["token"]
        r = anon.get(f"{BASE_URL}/api/cms/email-previews/welcome.html?token={tok}")
        assert r.status_code == 200, f"preview-token iframe failed: {r.status_code} {r.text[:300]}"
        assert r.headers.get("content-type", "").startswith("text/html")
        assert len(r.text) > 500  # rendered welcome HTML

    def test_iframe_with_bad_token_401(self, anon):
        r = anon.get(
            f"{BASE_URL}/api/cms/email-previews/welcome.html?token=" + ("f" * 64)
        )
        assert r.status_code == 401

    def test_iframe_with_admin_jwt_still_works_backwards_compat(self, admin_token, anon):
        r = anon.get(
            f"{BASE_URL}/api/cms/email-previews/welcome.html?token={admin_token}"
        )
        assert r.status_code == 200, f"legacy JWT-in-URL should still work: {r.status_code}"


# ─── 7. George live tools (direct exec, no SSE) ───────────────────────────

class TestGeorgeLiveTools:
    @pytest.fixture(scope="class")
    def db(self):
        from motor.motor_asyncio import AsyncIOMotorClient
        mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
        db_name = os.environ.get("DB_NAME", "test_database")
        c = AsyncIOMotorClient(mongo_url)
        return c[db_name]

    def test_count_all(self, db):
        from services.george.tools import execute_tool
        n = asyncio.get_event_loop().run_until_complete(execute_tool(db, "count_interest_registrations", {}))
        assert isinstance(n, int) and n >= 3  # our 3 seeds at minimum

    def test_count_by_status_registered_includes_legacy_new(self, db):
        from services.george.tools import execute_tool
        n = asyncio.get_event_loop().run_until_complete(
            execute_tool(db, "count_interest_registrations", {"status": "registered"})
        )
        assert n >= 2  # SEEDED_IDS[0]=registered and [1]=new (legacy)

    def test_count_by_status_invited(self, db):
        from services.george.tools import execute_tool
        n = asyncio.get_event_loop().run_until_complete(
            execute_tool(db, "count_interest_registrations", {"status": "invited"})
        )
        assert n >= 1

    def test_count_since_days(self, db):
        from services.george.tools import execute_tool
        n = asyncio.get_event_loop().run_until_complete(
            execute_tool(db, "count_interest_registrations", {"since_days": 1})
        )
        assert n >= 3  # all seeds are 'now'

    def test_count_by_state_country(self, db):
        from services.george.tools import execute_tool
        n = asyncio.get_event_loop().run_until_complete(
            execute_tool(db, "count_interest_registrations", {"state_country": "VIC"})
        )
        assert n >= 1

    def test_list_latest_limit_1(self, db):
        from services.george.tools import execute_tool
        rows = asyncio.get_event_loop().run_until_complete(
            execute_tool(db, "list_interest_registrations", {"limit": 1})
        )
        assert isinstance(rows, list) and len(rows) == 1
        row = rows[0]
        for k in ("id", "first_name", "email", "created_at"):
            assert k in row

    def test_founding_members_summary(self, db):
        from services.george.tools import execute_tool
        s = asyncio.get_event_loop().run_until_complete(
            execute_tool(db, "founding_members_summary", {})
        )
        for k in ("total", "new_today", "awaiting_contact", "invited", "joined", "opted_out", "latest"):
            assert k in s
        assert s["total"] >= 3
        assert s["awaiting_contact"] >= 2
        assert s["invited"] >= 1
