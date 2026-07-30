"""Slice 0 (Foundation) — Admin audit log backend smoke tests.

Covers:
  1. `/api/cms/admin-log` requires auth (401 unauth, 200 with JWT).
  2. `/api/cms/admin-log/actions` returns the KNOWN_ACTIONS catalogue.
  3. `services.audit.log_admin_action` persists an entry that surfaces via
     the read endpoint. Test cleans up after itself so the log stays
     effectively empty (append-only in prod, but tests must be tidy).
"""
from __future__ import annotations

import asyncio
import os
import sys

import pytest
import requests
from dotenv import load_dotenv

# Make the backend package importable so we can call the audit helper
# directly and clean up via Motor.
BACKEND_DIR = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.abspath(BACKEND_DIR))
# Load backend/.env so MONGO_URL / DB_NAME are visible to the round-trip test
load_dotenv(os.path.join(BACKEND_DIR, ".env"))

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://george-mcgs-cms.preview.emergentagent.com",
).rstrip("/")

ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASSWORD = "TestPass2026!"


# --------------------------------------------------------------------------
# Fixtures
# --------------------------------------------------------------------------

@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_token(api):
    r = api.post(
        f"{BASE_URL}/api/cms/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=30,
    )
    if r.status_code != 200:
        pytest.skip(f"CMS admin login failed ({r.status_code}): {r.text[:200]}")
    tok = r.json().get("token")
    assert tok, "login returned no token"
    return tok


@pytest.fixture(scope="module")
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# --------------------------------------------------------------------------
# Auth-required guard
# --------------------------------------------------------------------------

class TestAuditLogAuth:
    def test_admin_log_requires_auth(self, api):
        r = api.get(f"{BASE_URL}/api/cms/admin-log", timeout=15)
        assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text[:200]}"

    def test_admin_log_actions_requires_auth(self, api):
        r = api.get(f"{BASE_URL}/api/cms/admin-log/actions", timeout=15)
        assert r.status_code == 401


# --------------------------------------------------------------------------
# Happy paths
# --------------------------------------------------------------------------

class TestAuditLogRead:
    def test_admin_log_shape(self, api, auth_headers):
        r = api.get(
            f"{BASE_URL}/api/cms/admin-log",
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        # Required shape: {items: [], total, limit, skip}
        for key in ("items", "total", "limit", "skip"):
            assert key in data, f"missing key '{key}' in response: {data}"
        assert isinstance(data["items"], list)
        assert isinstance(data["total"], int)
        assert isinstance(data["limit"], int)
        assert isinstance(data["skip"], int)

    def test_actions_catalogue(self, api, auth_headers):
        r = api.get(
            f"{BASE_URL}/api/cms/admin-log/actions",
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        assert "actions" in data
        actions = data["actions"]
        assert isinstance(actions, list)
        assert len(actions) >= 20, f"expected >= 20 known actions, got {len(actions)}"
        # Spot-check a few namespaced actions
        for expected in ("member.warn", "content.remove", "group.approve"):
            assert expected in actions, f"missing '{expected}' in KNOWN_ACTIONS"


# --------------------------------------------------------------------------
# Round-trip: log via helper → read via API → clean up
# --------------------------------------------------------------------------

class TestAuditLogRoundTrip:
    def test_helper_write_reads_back(self, api, auth_headers):
        # Import lazily so import-time errors don't break the earlier tests.
        from services import audit  # noqa: WPS433
        from motor.motor_asyncio import AsyncIOMotorClient  # type: ignore

        mongo_url = os.environ.get("MONGO_URL")
        db_name = os.environ.get("DB_NAME")
        assert mongo_url and db_name, "MONGO_URL / DB_NAME must be set"

        async def _insert() -> str:
            client = AsyncIOMotorClient(mongo_url)
            db = client[db_name]
            entry = await audit.log_admin_action(
                db,
                admin_id="TEST_slice0_admin",
                admin_email="TEST_slice0@example.com",
                admin_name="TEST Slice0",
                action="member.warn",
                target_type="user",
                target_id="TEST_slice0_target",
                reason="pytest smoke",
                metadata={"pytest": True},
            )
            return entry["_id"]

        async def _delete(entry_id: str):
            client = AsyncIOMotorClient(mongo_url)
            db = client[db_name]
            await db[audit.COLLECTION].delete_one({"_id": entry_id})

        loop = asyncio.new_event_loop()
        try:
            entry_id = loop.run_until_complete(_insert())
            assert entry_id

            # Read back via the API — filter by our test admin to keep it precise.
            r = api.get(
                f"{BASE_URL}/api/cms/admin-log",
                params={"limit": 5, "admin_id": "TEST_slice0_admin"},
                headers=auth_headers,
                timeout=15,
            )
            assert r.status_code == 200
            data = r.json()
            ids = [row.get("_id") for row in data["items"]]
            assert entry_id in ids, f"inserted entry {entry_id} not surfaced (got ids={ids})"

            # Verify serialised fields present
            row = next(r for r in data["items"] if r.get("_id") == entry_id)
            assert row["action"] == "member.warn"
            assert row["admin_email"] == "TEST_slice0@example.com"
            assert row["target_id"] == "TEST_slice0_target"
            assert "ts" in row and isinstance(row["ts"], str)
        finally:
            # Always clean up the test row.
            if "entry_id" in locals():
                loop.run_until_complete(_delete(entry_id))
            loop.close()


# --------------------------------------------------------------------------
# Frontend route smoke — new placeholder pages + regression list
# --------------------------------------------------------------------------

NEW_PLACEHOLDER_ROUTES = [
    "/admin/bridge",
    "/admin/audit-log",
    "/admin/members",
    "/admin/reports",
    "/admin/support",
    "/admin/groups/pending",
    "/admin/announcements",
    "/admin/admins",
    "/admin/settings",
    "/admin/analytics",
]

EXISTING_ADMIN_ROUTES = [
    "/admin/home",
    "/admin/about",
    "/admin/faqs",
    "/admin/media",
    "/admin/success-stories",
    "/admin/founding-members",
    "/admin/events",
    "/admin/event-submissions",
    "/admin/dashboard",
    "/admin/george",
]

PUBLIC_REGRESSION_ROUTES = [
    "/meet",
    "/register-interest",
    "/",
    "/flyer-mockups/founding-a4.png",
]


class TestFrontendRoutes:
    @pytest.mark.parametrize("path", NEW_PLACEHOLDER_ROUTES)
    def test_new_placeholder_route_200(self, path):
        r = requests.get(f"{BASE_URL}{path}", timeout=30, allow_redirects=True)
        assert r.status_code == 200, f"{path} returned {r.status_code}"

    @pytest.mark.parametrize("path", EXISTING_ADMIN_ROUTES)
    def test_existing_admin_route_200(self, path):
        r = requests.get(f"{BASE_URL}{path}", timeout=30, allow_redirects=True)
        assert r.status_code == 200, f"{path} returned {r.status_code}"

    @pytest.mark.parametrize("path", PUBLIC_REGRESSION_ROUTES)
    def test_public_route_200(self, path):
        r = requests.get(f"{BASE_URL}{path}", timeout=30, allow_redirects=True)
        assert r.status_code == 200, f"{path} returned {r.status_code}"
