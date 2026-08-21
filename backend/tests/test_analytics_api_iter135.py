"""
API integration tests for George Analytics Engine (Commits 1 & 2).

Covers the HTTP surface via the public preview URL:
  - Admin: GET /api/mcgs/george/analytics/catalogue
  - Admin: POST /api/mcgs/george/analytics/run
  - Admin: POST /api/mcgs/george/analytics/drilldown
  - Public: POST /api/public/bridge/hit  (auth-free, rate-limited, IP-hashed)
  - Interest-registration acquisition capture
  - /admin/invite-flyer PNG rendering
  - Regression: /api/health

Cleans up any test-generated data at teardown (bridge_events + interest_registrations).
"""

from __future__ import annotations

import os
import time
import uuid

import pytest
import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
import asyncio

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")

BASE_URL = (
    os.getenv("EXPO_BACKEND_URL")
    or os.getenv("EXPO_PUBLIC_BACKEND_URL")
    or "https://outreach-campaigns.preview.emergentagent.com"
).rstrip("/")

ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASSWORD = "TestPass2026!"

# Marker prefixes for test-generated data (used for cleanup)
QR_TEST_PREFIX = "qr_test_iter135_"
IDEMP_TEST_PREFIX = "test_iter135_"
TEST_EMAIL_PREFIX = "test_iter135_"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{BASE_URL}/api/cms/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    body = r.json()
    assert body.get("ok") is True
    tok = body.get("token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module", autouse=True)
def cleanup_at_end():
    yield
    # Best-effort cleanup of test-generated rows
    async def _cleanup():
        client = AsyncIOMotorClient(os.getenv("MONGO_URL"))
        db = client[os.getenv("DB_NAME")]
        try:
            await db.bridge_events.delete_many(
                {
                    "$or": [
                        {"qr_code_id": {"$regex": f"^{QR_TEST_PREFIX}"}},
                        {"idempotency_key": {"$regex": f"^{IDEMP_TEST_PREFIX}"}},
                    ]
                }
            )
            await db.interest_registrations.delete_many(
                {"email": {"$regex": f"^{TEST_EMAIL_PREFIX}"}}
            )
        finally:
            client.close()
    asyncio.run(_cleanup())


# ---------------------------------------------------------------------------
# Health regression
# ---------------------------------------------------------------------------


def test_health_ok():
    r = requests.get(f"{BASE_URL}/api/health", timeout=10)
    assert r.status_code == 200


def test_onboarding_suggested_groups_regression():
    # spot-check existing endpoint (any user id works — returns curated list)
    r = requests.get(
        f"{BASE_URL}/api/onboarding/suggested-groups",
        params={"user_id": "nonexistent"},
        timeout=10,
    )
    # 200 or 404, but not 500
    assert r.status_code < 500, f"unexpected 5xx: {r.text[:200]}"


# ---------------------------------------------------------------------------
# Analytics catalogue
# ---------------------------------------------------------------------------


def test_catalogue_requires_auth():
    r = requests.get(f"{BASE_URL}/api/mcgs/george/analytics/catalogue", timeout=10)
    assert r.status_code == 401


def test_catalogue_returns_12_queries(auth_headers):
    r = requests.get(
        f"{BASE_URL}/api/mcgs/george/analytics/catalogue",
        headers=auth_headers,
        timeout=15,
    )
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    queries = data.get("queries", [])
    assert len(queries) == 12, f"expected 12 queries, got {len(queries)}"
    ids = {q["query_id"] for q in queries}
    for expected in {
        "members.joined",
        "members.founding_numbers",
        "members.founding_profiles",
        "members.online",
        "members.active_today",
        "members.active_this_week",
        "events.created",
        "support.open_tickets",
        "campaigns.best_by_open_rate",
        "campaigns.best_by_click_rate",
        "flyers.best_by_registrations",
        "bridge.top_sources",
    }:
        assert expected in ids, f"missing query {expected}"
    # descriptions are present + non-empty
    for q in queries:
        assert q.get("description"), f"query {q['query_id']} missing description"


# ---------------------------------------------------------------------------
# Analytics run
# ---------------------------------------------------------------------------


def test_run_founding_numbers_all_time(auth_headers):
    r = requests.post(
        f"{BASE_URL}/api/mcgs/george/analytics/run",
        headers=auth_headers,
        json={
            "query_id": "members.founding_numbers",
            "range_kind": "all_time",
            "compare": False,
        },
        timeout=15,
    )
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert body["query_id"] == "members.founding_numbers"
    assert body["value"] == 2, f"expected value=2 (reserved), got {body['value']}"
    assert body["metric_label"] == "Reserved Founding Member Numbers"
    assert body["comparison"] is None  # non-periodic


def test_run_periodic_with_compare_returns_comparison_block(auth_headers):
    r = requests.post(
        f"{BASE_URL}/api/mcgs/george/analytics/run",
        headers=auth_headers,
        json={
            "query_id": "members.joined",
            "range_kind": "this_week",
            "compare": True,
        },
        timeout=15,
    )
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    comp = body.get("comparison")
    assert comp is not None, "expected comparison block on periodic query"
    assert comp["previous_time_range"]["key"] == "last_week"
    assert comp["direction"] in {"up", "down", "flat"}
    # delta_pct is None only when previous_value == 0
    if comp["previous_value"] > 0:
        assert comp["delta_pct"] is not None


def test_run_non_periodic_omits_comparison_even_when_compare_true(auth_headers):
    # founding_numbers, founding_profiles, open_tickets, online, active_* are non-periodic
    for qid, rk in [
        ("members.founding_numbers", "all_time"),
        ("members.founding_profiles", "all_time"),
        ("support.open_tickets", "all_time"),
        ("members.online", "today"),
        ("members.active_today", "today"),
        ("members.active_this_week", "this_week"),
    ]:
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/analytics/run",
            headers=auth_headers,
            json={"query_id": qid, "range_kind": rk, "compare": True},
            timeout=15,
        )
        assert r.status_code == 200, f"{qid}: {r.text[:200]}"
        body = r.json()
        assert body["comparison"] is None, f"{qid} should omit comparison"


def test_partial_coverage_notes_mention_2026_06_15(auth_headers):
    for qid in ["flyers.best_by_registrations", "bridge.top_sources"]:
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/analytics/run",
            headers=auth_headers,
            json={"query_id": qid, "range_kind": "this_month", "compare": False},
            timeout=15,
        )
        assert r.status_code == 200, f"{qid}: {r.text[:200]}"
        body = r.json()
        assert body["coverage"] in {"partial", "full"}
        notes_blob = " ".join(body.get("notes", []))
        assert "2026-06-15" in notes_blob, (
            f"{qid} notes must mention 2026-06-15; got: {notes_blob}"
        )


def test_all_12_queries_execute(auth_headers):
    r = requests.get(
        f"{BASE_URL}/api/mcgs/george/analytics/catalogue",
        headers=auth_headers,
        timeout=15,
    )
    assert r.status_code == 200
    for entry in r.json()["queries"]:
        rr = requests.post(
            f"{BASE_URL}/api/mcgs/george/analytics/run",
            headers=auth_headers,
            json={
                "query_id": entry["query_id"],
                "range_kind": "this_week",
                "compare": True,
            },
            timeout=20,
        )
        assert rr.status_code == 200, (
            f"{entry['query_id']} failed: {rr.status_code} {rr.text[:200]}"
        )
        b = rr.json()
        assert b["query_id"] == entry["query_id"]
        assert isinstance(b["value"], (int, float))


def test_unknown_query_returns_404(auth_headers):
    r = requests.post(
        f"{BASE_URL}/api/mcgs/george/analytics/run",
        headers=auth_headers,
        json={"query_id": "does.not.exist", "range_kind": "this_week"},
        timeout=10,
    )
    assert r.status_code == 404


def test_unknown_range_kind_returns_400(auth_headers):
    r = requests.post(
        f"{BASE_URL}/api/mcgs/george/analytics/run",
        headers=auth_headers,
        json={"query_id": "members.joined", "range_kind": "next_millennium"},
        timeout=10,
    )
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# Drilldown
# ---------------------------------------------------------------------------


def test_drilldown_returns_paginated_docs(auth_headers):
    r = requests.post(
        f"{BASE_URL}/api/mcgs/george/analytics/drilldown",
        headers=auth_headers,
        json={
            "query_id": "members.founding_numbers",
            "range_kind": "all_time",
            "limit": 10,
            "skip": 0,
        },
        timeout=15,
    )
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    for key in ("query_id", "entity", "filter", "total", "returned", "items"):
        assert key in body, f"missing key {key}"
    assert isinstance(body["items"], list)
    assert body["returned"] == len(body["items"])
    # items should NOT contain mongo _id
    for item in body["items"]:
        assert "_id" not in item


# ---------------------------------------------------------------------------
# Public bridge-hit endpoint
# ---------------------------------------------------------------------------


def test_bridge_hit_basic():
    qr = f"{QR_TEST_PREFIX}basic_{uuid.uuid4().hex[:6]}"
    r = requests.post(
        f"{BASE_URL}/api/public/bridge/hit",
        json={"channel": "flyer", "flyer_id": "test_x", "qr_code_id": qr},
        timeout=10,
    )
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert body["ok"] is True
    assert body["duplicate"] is False
    assert body["id"]


def test_bridge_hit_idempotent():
    key = f"{IDEMP_TEST_PREFIX}dedup_{uuid.uuid4().hex[:6]}"
    qr = f"{QR_TEST_PREFIX}idemp_{uuid.uuid4().hex[:6]}"
    r1 = requests.post(
        f"{BASE_URL}/api/public/bridge/hit",
        json={"channel": "flyer", "qr_code_id": qr, "idempotency_key": key},
        timeout=10,
    )
    assert r1.status_code == 200, r1.text[:200]
    b1 = r1.json()
    assert b1["duplicate"] is False
    r2 = requests.post(
        f"{BASE_URL}/api/public/bridge/hit",
        json={"channel": "flyer", "qr_code_id": qr, "idempotency_key": key},
        timeout=10,
    )
    assert r2.status_code == 200
    b2 = r2.json()
    assert b2["duplicate"] is True
    assert b2["id"] == b1["id"]


def test_bridge_hit_stores_no_raw_ip():
    """Verify bridge_events docs only carry ip_hash (64 hex), never raw IP."""
    async def _go():
        client = AsyncIOMotorClient(os.getenv("MONGO_URL"))
        db = client[os.getenv("DB_NAME")]
        key = f"{IDEMP_TEST_PREFIX}ip_check_{uuid.uuid4().hex[:6]}"
        qr = f"{QR_TEST_PREFIX}ip_check_{uuid.uuid4().hex[:6]}"
        try:
            r = requests.post(
                f"{BASE_URL}/api/public/bridge/hit",
                json={"channel": "flyer", "qr_code_id": qr, "idempotency_key": key},
                timeout=10,
            )
            assert r.status_code == 200
            evt_id = r.json()["id"]
            doc = await db.bridge_events.find_one({"id": evt_id}, {"_id": 0})
            assert doc is not None
            assert "ip" not in doc, f"raw ip leaked into doc: {doc}"
            assert "ip_hash" in doc
            assert len(doc["ip_hash"]) == 64
            int(doc["ip_hash"], 16)  # must be hex
        finally:
            client.close()
    asyncio.run(_go())


def test_bridge_hit_rate_limit_returns_429():
    """>10 hits/min from the same IP → 429. We spoof X-Forwarded-For.

    Note: BRIDGE_RATE_LIMIT_PER_MIN defaults to 10 (see bridge.py).
    """
    fake_ip = f"198.51.100.{uuid.uuid4().int % 200 + 30}"
    headers = {"X-Forwarded-For": fake_ip}
    got_429 = False
    for i in range(14):
        key = f"{IDEMP_TEST_PREFIX}rl_{fake_ip}_{i}"
        qr = f"{QR_TEST_PREFIX}rl_{fake_ip}_{i}"
        r = requests.post(
            f"{BASE_URL}/api/public/bridge/hit",
            json={"channel": "flyer", "qr_code_id": qr, "idempotency_key": key},
            headers=headers,
            timeout=10,
        )
        if r.status_code == 429:
            got_429 = True
            break
    assert got_429, "expected 429 after >10 hits/min from the same IP"


# ---------------------------------------------------------------------------
# Interest-registration acquisition capture
# ---------------------------------------------------------------------------


def _fresh_reg_email():
    return f"{TEST_EMAIL_PREFIX}{uuid.uuid4().hex[:10]}@example.com"


def test_register_interest_captures_nested_acquisition():
    async def _fetch(email):
        client = AsyncIOMotorClient(os.getenv("MONGO_URL"))
        db = client[os.getenv("DB_NAME")]
        try:
            return await db.interest_registrations.find_one(
                {"email": email}, {"_id": 0}
            )
        finally:
            client.close()

    email = _fresh_reg_email()
    payload = {
        "first_name": "TestNested",
        "email": email,
        "state_country": "VIC, Australia",
        "companion_choice": "george",
        "acquisition": {
            "channel": "flyer",
            "flyer_id": "founding_member_invite",
            "qr_code_id": f"{QR_TEST_PREFIX}reg_nested",
            "campaign_id": "cmp_test_iter135",
            "ref_source": "poster-fitzroy",
        },
    }
    r = requests.post(
        f"{BASE_URL}/api/public/register-interest", json=payload, timeout=15
    )
    assert r.status_code == 200, r.text[:300]

    doc = asyncio.run(_fetch(email))
    assert doc is not None, "registration not persisted"
    acq = doc.get("acquisition")
    assert acq is not None, "acquisition sub-object missing"
    assert acq["channel"] == "flyer"
    assert acq["flyer_id"] == "founding_member_invite"
    assert acq["qr_code_id"] == f"{QR_TEST_PREFIX}reg_nested"
    assert acq["campaign_id"] == "cmp_test_iter135"
    assert acq.get("captured_at")


def test_register_interest_captures_flat_acquisition():
    async def _fetch(email):
        client = AsyncIOMotorClient(os.getenv("MONGO_URL"))
        db = client[os.getenv("DB_NAME")]
        try:
            return await db.interest_registrations.find_one(
                {"email": email}, {"_id": 0}
            )
        finally:
            client.close()

    email = _fresh_reg_email()
    payload = {
        "first_name": "TestFlat",
        "email": email,
        "state_country": "NSW",
        "companion_choice": "georgia",
        "acq_channel": "qr",
        "acq_flyer_id": "founding_member_invite",
        "acq_ref_source": "poster-mon",
    }
    r = requests.post(
        f"{BASE_URL}/api/public/register-interest", json=payload, timeout=15
    )
    assert r.status_code == 200, r.text[:300]

    doc = asyncio.run(_fetch(email))
    assert doc is not None
    acq = doc.get("acquisition")
    assert acq is not None
    assert acq["channel"] == "qr"
    assert acq["flyer_id"] == "founding_member_invite"
    assert acq["ref_source"] == "poster-mon"


# ---------------------------------------------------------------------------
# Flyer QR embedding
# ---------------------------------------------------------------------------


def test_admin_invite_flyer_returns_png():
    async def _get_admin_id():
        client = AsyncIOMotorClient(os.getenv("MONGO_URL"))
        db = client[os.getenv("DB_NAME")]
        try:
            u = await db.users.find_one({"is_admin": True}, {"_id": 0, "id": 1})
            return u["id"] if u else None
        finally:
            client.close()

    admin_id = asyncio.run(_get_admin_id())
    if not admin_id:
        pytest.skip("no admin user found to call /admin/invite-flyer")

    qr_id = f"{QR_TEST_PREFIX}flyer_{uuid.uuid4().hex[:6]}"
    r = requests.get(
        f"{BASE_URL}/api/admin/invite-flyer",
        params={
            "admin_id": admin_id,
            "flyer_id": "founding_test",
            "qr_code_id": qr_id,
            "campaign_id": "cmp_test_iter135",
        },
        timeout=30,
    )
    assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"
    assert r.headers.get("content-type", "").startswith("image/png"), (
        f"expected image/png, got {r.headers.get('content-type')}"
    )
    # PNG magic
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n"


# ---------------------------------------------------------------------------
# George tool registration
# ---------------------------------------------------------------------------


def test_george_tool_registered_with_12_query_enum():
    from services.george.tools import TOOL_REGISTRY

    assert "run_analytics_query" in TOOL_REGISTRY
    tool = TOOL_REGISTRY["run_analytics_query"]
    enum = tool["args"]["query_id"]["enum"]
    assert len(enum) == 12
    for expected in ["members.joined", "flyers.best_by_registrations", "bridge.top_sources"]:
        assert expected in enum


def test_george_tool_partial_coverage_note_mentions_tracking_start():
    from services.george.tools import TOOL_REGISTRY
    tool = TOOL_REGISTRY["run_analytics_query"]

    async def _go():
        client = AsyncIOMotorClient(os.getenv("MONGO_URL"))
        db = client[os.getenv("DB_NAME")]
        try:
            envelope = await tool["run"](
                db,
                {
                    "query_id": "flyers.best_by_registrations",
                    "range_kind": "this_month",
                    "compare": False,
                },
            )
            assert "coverage_notes" in envelope
            notes = envelope.get("coverage_notes") or []
            blob = " ".join(notes)
            assert "2026-06-15" in blob, f"expected tracking date in notes; got {blob}"
        finally:
            client.close()

    asyncio.run(_go())
