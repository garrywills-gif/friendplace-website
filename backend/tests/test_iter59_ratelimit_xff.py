"""
Iter-59 — Re-verify the X-Forwarded-For based rate-limit fix on
POST /api/public/contact.

Iter-58 flagged that request.client.host was the k8s ingress pod IP,
letting the 5/hour cap be bypassed. The fix in server.py (~L8919) now
derives the client IP from the X-Forwarded-For header (first hop) with
request.client.host as a fallback.

This suite:
    1. Sends 5 POSTs with a stable spoofed XFF → all 200.
    2. Sends the 6th with the same XFF → 429 + "Too many messages".
    3. Sends a POST with a *different* XFF → 200 (per-IP, not global).
    4. Cleans up every submission it created.

Run:
    pytest /app/backend/tests/test_iter59_ratelimit_xff.py -v \
        --junitxml=/app/test_reports/pytest/iter59.xml
"""
import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
    or ""
).rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL / EXPO_BACKEND_URL must be set"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

# Unique per-run tag so parallel/leftover runs don't interfere.
RUN_TAG = f"TEST_iter59_{uuid.uuid4().hex[:8]}"
STABLE_IP = "203.0.113.99"        # RFC 5737 TEST-NET-3, safe to use
OTHER_IP = "203.0.113.88"


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _cleanup(mongo):
    """Delete every submission this run created — by IP and by email tag."""
    mongo.contact_submissions.delete_many({"ip": {"$in": [STABLE_IP, OTHER_IP]}})
    mongo.contact_submissions.delete_many(
        {"email": {"$regex": f"^{RUN_TAG.lower()}"}}
    )


def _post_contact(api, xff, i, body_suffix="probe"):
    return api.post(
        f"{BASE_URL}/api/public/contact",
        json={
            "name": f"TEST iter59 {i}",
            "email": f"{RUN_TAG}_{i}@example.com",
            "message": f"iter59 {body_suffix} {i} — {uuid.uuid4().hex[:6]}",
        },
        headers={"X-Forwarded-For": xff},
        timeout=15,
    )


class TestRateLimitXFF:
    """Rate-limit behaviour after the X-Forwarded-For fix."""

    @classmethod
    def teardown_class(cls):
        c = MongoClient(MONGO_URL)
        try:
            _cleanup(c[DB_NAME])
        finally:
            c.close()

    def test_1_five_probes_from_same_ip_all_succeed(self, api, mongo):
        _cleanup(mongo)
        for i in range(5):
            r = _post_contact(api, STABLE_IP, i, body_suffix="warmup")
            assert r.status_code == 200, (
                f"probe {i} unexpectedly failed: {r.status_code} {r.text[:200]}"
            )
            body = r.json()
            assert body.get("ok") is True
            assert isinstance(body.get("id"), str) and len(body["id"]) >= 8

        # Confirm all 5 rows were persisted with the SPOOFED IP (proves the
        # server read the XFF header — otherwise the ip column would be
        # 10.227.x.x ingress pod IPs).
        docs = list(
            mongo.contact_submissions.find(
                {"email": {"$regex": f"^{RUN_TAG.lower()}_"}},
                {"_id": 0, "ip": 1, "email": 1},
            )
        )
        assert len(docs) == 5, f"expected 5 rows, got {len(docs)}: {docs}"
        distinct_ips = sorted({d["ip"] for d in docs})
        assert distinct_ips == [STABLE_IP], (
            f"server did not honour X-Forwarded-For; distinct ips recorded={distinct_ips}. "
            f"Full rows: {docs}"
        )

    def test_2_sixth_probe_same_ip_returns_429(self, api, mongo):
        # Precondition: 5 rows already inserted by test_1.
        pre_count = mongo.contact_submissions.count_documents({"ip": STABLE_IP})
        assert pre_count >= 5, (
            f"expected >=5 pre-existing rows for {STABLE_IP}, got {pre_count} — "
            "test_1 must run before test_2"
        )
        r6 = _post_contact(api, STABLE_IP, 6, body_suffix="over-limit")
        assert r6.status_code == 429, (
            f"expected 429, got {r6.status_code}: {r6.text[:200]}"
        )
        # Message check per implementation
        try:
            detail = r6.json().get("detail", "")
        except Exception:
            detail = r6.text
        assert "Too many" in detail or "too many" in detail.lower(), (
            f"429 detail did not mention 'too many': {detail!r}"
        )
        # No 6th row should have been persisted
        post_count = mongo.contact_submissions.count_documents({"ip": STABLE_IP})
        assert post_count == pre_count, (
            f"429 should not persist a row; before={pre_count} after={post_count}"
        )

    def test_3_different_ip_still_succeeds(self, api, mongo):
        # Different XFF → separate bucket → should still return 200.
        r = _post_contact(api, OTHER_IP, 99, body_suffix="fresh-ip")
        assert r.status_code == 200, (
            f"different-IP submission should succeed, got {r.status_code}: {r.text[:200]}"
        )
        body = r.json()
        assert body.get("ok") is True
        # Verify persisted under the OTHER_IP bucket
        doc = mongo.contact_submissions.find_one(
            {"id": body["id"]}, {"_id": 0, "ip": 1}
        )
        assert doc is not None
        assert doc["ip"] == OTHER_IP, (
            f"expected ip={OTHER_IP} on persisted row, got {doc['ip']}"
        )

    def test_4_xff_first_hop_is_used_when_chain_present(self, api, mongo):
        """
        Real proxies prepend the client IP to any existing chain. The fix
        must use the *first* comma-separated entry as the caller.
        """
        chain_ip = "198.51.100.42"     # RFC 5737 TEST-NET-2
        r = api.post(
            f"{BASE_URL}/api/public/contact",
            json={
                "name": "TEST iter59 chain",
                "email": f"{RUN_TAG}_chain@example.com",
                "message": "chain probe",
            },
            headers={"X-Forwarded-For": f"{chain_ip}, 10.0.0.1, 10.0.0.2"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        doc = mongo.contact_submissions.find_one(
            {"id": r.json()["id"]}, {"_id": 0, "ip": 1}
        )
        assert doc is not None
        assert doc["ip"] == chain_ip, (
            f"expected first-hop {chain_ip} in ip column, got {doc.get('ip')!r}"
        )
        # cleanup this one row
        mongo.contact_submissions.delete_many({"ip": chain_ip})
