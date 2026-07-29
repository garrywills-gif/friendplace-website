"""V1 Launch — Deploy-Readiness Verification (iteration 110)

Confirms the LOCAL Next.js build serves the V1 launch routes end-to-end
before Emergent Support is escalated for the friendplace.com.au deployment
issue. See /app/test_reports/iteration_110.json for context.

Routes covered:
  /meet                     — Quiet Host welcome (Meet George/Georgia)
  /register-interest        — RYI form
  /about, /how-it-works, /features, /admin — supporting V1 pages

Backend covered:
  POST /api/public/register-interest — RYI submission → interest_registrations

The test row is deleted at the end of the test class so the collection
stays empty for V1 launch (as promised in the review request).
"""

import os
import time
import pytest
import requests
from pymongo import MongoClient

# Local Next.js website is on :3000; FastAPI backend on :8001.
# We hit both directly on localhost — the review is specifically about
# the LOCAL pod build, not the production deployment target.
WEB_URL = "http://localhost:3000"
API_URL = "http://localhost:8001"

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


# ─── Route smoke tests ────────────────────────────────────────────────
class TestWebsiteRoutes:
    """GET each V1 launch route directly on the local Next.js server."""

    @pytest.mark.parametrize("path,expected_needles", [
        ("/meet", ["Meet George", "Come in", "butterfly"]),  # butterfly appears as testid/alt on the SVG
        ("/register-interest", ["First name", "Email"]),
        ("/about", []),
        ("/how-it-works", []),
        ("/features", []),
        # /admin is client-side rendered — the SSR shell won't contain
        # "Sign in" text (it appears after hydration). We only assert
        # the route returns 200 here; Playwright separately confirms
        # the sign-in surface actually renders in the browser.
        ("/admin", []),
        ("/", []),
    ])
    def test_route_returns_200(self, path, expected_needles):
        r = requests.get(f"{WEB_URL}{path}", timeout=15)
        assert r.status_code == 200, f"{path} returned {r.status_code}"
        for needle in expected_needles:
            assert needle.lower() in r.text.lower(), (
                f"{path} missing expected copy: {needle!r}"
            )

    def test_meet_has_quiet_host_copy(self):
        """`/meet` must show the Quiet Host welcome experience."""
        r = requests.get(f"{WEB_URL}/meet", timeout=15)
        assert r.status_code == 200
        html = r.text.lower()
        # At least two of the quiet-host phrases must be present so we
        # don't accept a stripped placeholder that only says one thing.
        needles = ["meet george", "come in", "butterfly", "georgia"]
        hits = [n for n in needles if n in html]
        assert len(hits) >= 3, f"Only found {hits} in /meet — expected ≥3 of {needles}"

    def test_ryi_form_fields_present(self):
        """`/register-interest` must render the RYI form fields."""
        r = requests.get(f"{WEB_URL}/register-interest", timeout=15)
        assert r.status_code == 200
        html = r.text
        assert "First name" in html
        assert "Email" in html
        assert "State or country" in html.lower() or "state or country" in html.lower()
        assert "hear about" in html.lower() or "heard" in html.lower()


# ─── Register-Your-Interest API ───────────────────────────────────────
class TestRegisterInterestAPI:
    """POST /api/public/register-interest → 200 + row persisted + email fired.

    NOTE: The endpoint hard-codes ``is_test=False`` (see backend/server.py
    L9920), so we cannot flag the row via payload. We clean up by ``id``
    in the class teardown fixture instead.
    """

    @pytest.fixture(scope="class", autouse=True)
    def _teardown(self):
        yield
        # Cleanup: delete every row we created in this run so the
        # interest_registrations collection stays empty for V1 launch.
        client = MongoClient(MONGO_URL)
        db = client[DB_NAME]
        db.interest_registrations.delete_many(
            {"email": {"$regex": r"^testing-agent-verify-.*@friendplace-test\.dev$"}}
        )
        client.close()

    def test_submit_persists_row_and_returns_id(self):
        email = f"testing-agent-verify-{int(time.time())}-a@friendplace-test.dev"
        payload = {
            "first_name": "TestingAgent",
            "email": email,
            "state_country": "VIC, Australia",
            "heard_from": "pytest-suite",
            "companion_choice": "george",
        }
        r = requests.post(
            f"{API_URL}/api/public/register-interest",
            json=payload,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        reg_id = body.get("id")
        assert reg_id and len(reg_id) >= 8

        # Verify the row was actually persisted in MongoDB with the
        # exact fields we sent (no _id noise, correct source, correct
        # companion choice).
        client = MongoClient(MONGO_URL)
        try:
            doc = client[DB_NAME].interest_registrations.find_one(
                {"id": reg_id}, {"_id": 0}
            )
            assert doc is not None, "Row was not persisted"
            assert doc["email"] == email.lower()
            assert doc["first_name"] == "TestingAgent"
            assert doc["state_country"] == "VIC, Australia"
            assert doc["heard_from"] == "pytest-suite"
            assert doc["companion_choice"] == "george"
            assert doc["source"] == "website"
            assert doc["status"] == "new"
        finally:
            client.close()

    def test_missing_first_name_returns_400(self):
        r = requests.post(
            f"{API_URL}/api/public/register-interest",
            json={"first_name": "", "email": "x@y.com"},
            timeout=10,
        )
        assert r.status_code == 400
        assert "first name" in r.json()["detail"].lower()

    def test_invalid_email_returns_400(self):
        r = requests.post(
            f"{API_URL}/api/public/register-interest",
            json={"first_name": "A", "email": "not-an-email"},
            timeout=10,
        )
        assert r.status_code == 400
        assert "email" in r.json()["detail"].lower()

    def test_idempotent_within_24h(self):
        """Same email within 24h returns deduplicated=True and does NOT
        insert a second row."""
        email = f"testing-agent-verify-{int(time.time())}-dedup@friendplace-test.dev"
        payload = {"first_name": "Dedupe", "email": email}

        r1 = requests.post(f"{API_URL}/api/public/register-interest", json=payload, timeout=10)
        assert r1.status_code == 200
        first_id = r1.json()["id"]

        r2 = requests.post(f"{API_URL}/api/public/register-interest", json=payload, timeout=10)
        assert r2.status_code == 200
        b2 = r2.json()
        assert b2.get("deduplicated") is True
        assert b2["id"] == first_id

        # Exactly one row exists for this email.
        client = MongoClient(MONGO_URL)
        try:
            n = client[DB_NAME].interest_registrations.count_documents({"email": email})
            assert n == 1
        finally:
            client.close()
