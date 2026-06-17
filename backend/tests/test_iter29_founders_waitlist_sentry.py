"""
Iteration 29 tests:
- Sentry no-op init log line on boot
- 17 indexes created (incl. ix_waitlist_email unique, ix_waitlist_created, ix_users_founder)
- /api/founders/status counts (cap/taken/remaining/open)
- _assign_founder_status on /api/auth/signup (real accounts only, demos excluded,
  badge + 50-point bonus + extra "Founding Member #N" notification)
- /api/waitlist: idempotent by email, EmailStr validation, rate-limit 5/10min
- /api/waitlist/stats aggregation by source
- /api/admin/waitlist (admin only, 403 otherwise)
- /api/admin/waitlist/{id}/mark-invited (idempotent, 404 unknown, 403 non-admin)
- Regression: /api/health, /api/auth/signup + /api/auth/me + /api/auth/login,
  iter28 rate-limit (signup 5/IP) still fires
"""
import os
import re
import uuid
import time
import asyncio
import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
MAGGIE_ID = "7452ce79-7027-4a94-9669-0ee3a521a5ec"
RUN_TAG = uuid.uuid4().hex[:8]


# ---------------- Mongo helpers (for assertions & cleanup) ----------------
def _mongo():
    return AsyncIOMotorClient("mongodb://localhost:27017")["test_database"]


async def _count_notifications_for(user_id, title_substr):
    db = _mongo()
    return await db.notifications.count_documents({
        "user_id": user_id,
        "title": {"$regex": re.escape(title_substr)},
    })


# --------------- Fixtures ---------------
@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module", autouse=True)
def restart_backend_for_clean_buckets():
    """Iter28-style in-process rate-limit buckets are reset by a backend
    restart. We restart once before this module so the signup/waitlist
    counters start at zero, then clean up afterwards."""
    os.system("sudo supervisorctl restart backend >/dev/null 2>&1")
    # Wait for backend to be ready
    deadline = time.time() + 30
    while time.time() < deadline:
        try:
            r = requests.get(f"{API}/health", timeout=2)
            if r.status_code == 200 and r.json().get("db") == "up":
                break
        except Exception:
            pass
        time.sleep(0.5)
    yield
    # Cleanup test data
    async def _clean():
        db = _mongo()
        await db.users.delete_many({"username": {"$regex": f"^founder_test_{RUN_TAG}"}})
        await db.waitlist.delete_many({"email": {"$regex": f"iter29test_{RUN_TAG}"}})
        await db.notifications.delete_many({"title": {"$regex": "Founding Member #"}})
    asyncio.get_event_loop().run_until_complete(_clean())


# ---------------- 0. Sentry log line on fresh boot ----------------
class TestSentryAndIndexes:
    def test_sentry_disabled_log_present(self):
        with open("/var/log/supervisor/backend.err.log", "r") as f:
            text = f.read()[-15000:]
        assert "Sentry DSN not set" in text, \
            "Expected 'Sentry DSN not set' line in backend.err.log after restart"

    def test_indexes_verified_17_of_17(self):
        with open("/var/log/supervisor/backend.err.log", "r") as f:
            text = f.read()[-15000:]
        assert "Indexes verified: 17 / 17 targets" in text, \
            "Expected '17 / 17' line in backend.err.log after restart"

    def test_mongo_has_new_indexes(self):
        async def _check():
            db = _mongo()
            wl = await db.waitlist.index_information()
            u = await db.users.index_information()
            assert "ix_waitlist_email" in wl, f"missing ix_waitlist_email; got {list(wl)}"
            assert wl["ix_waitlist_email"].get("unique") is True
            assert "ix_waitlist_created" in wl
            assert "ix_users_founder" in u
            assert u["ix_users_founder"].get("sparse") is True
        asyncio.get_event_loop().run_until_complete(_check())


# ---------------- 1. Health regression ----------------
class TestHealth:
    def test_health(self, s):
        r = s.get(f"{API}/health", timeout=5)
        assert r.status_code == 200
        data = r.json()
        assert data.get("status") == "ok"
        assert data.get("db") == "up"


# ---------------- 2. Founders status + signup founder assignment ----------------
class TestFoundersFlow:
    """Sign up 2 real accounts and verify founder fields, badge, points, notifs."""

    def test_initial_founders_status(self, s):
        r = s.get(f"{API}/founders/status", timeout=5)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["cap"] == 500
        assert data["taken"] == 0, f"expected 0 founders initially, got {data}"
        assert data["remaining"] == 500
        assert data["open"] is True
        pytest.shared_initial_taken = 0

    @pytest.mark.parametrize("n", [1, 2])
    def test_signup_assigns_founder(self, s, n):
        uname = f"founder_test_{RUN_TAG}_{n}"
        body = {
            "username": uname,
            "password": "secret123",
            "email": f"{uname}@example.com",
            "first_name": f"Tester{n}",
            "suburb": "Carlton",
            "location_visibility": "suburb",
        }
        r = s.post(f"{API}/auth/signup", json=body, timeout=10)
        assert r.status_code == 200, f"signup failed: {r.status_code} {r.text}"
        out = r.json()
        assert "access_token" in out and "user" in out, out
        u = out["user"]
        assert u.get("is_founder") is True, f"user not marked founder: {u}"
        assert u.get("founder_number") == n, f"expected founder_number={n}, got {u.get('founder_number')}"
        assert "Founding Member" in (u.get("badges") or []), u
        assert (u.get("points") or 0) >= 55, f"expected points>=55 got {u.get('points')}"
        # Save for later tests
        if not hasattr(pytest, "shared_founder_ids"):
            pytest.shared_founder_ids = []
            pytest.shared_founder_tokens = []
        pytest.shared_founder_ids.append(u["id"])
        pytest.shared_founder_tokens.append(out["access_token"])
        # Notification check
        cnt = asyncio.get_event_loop().run_until_complete(
            _count_notifications_for(u["id"], f"You're Founding Member #{n}!")
        )
        assert cnt >= 1, f"missing Founding Member #{n} notification for {u['id']}"

    def test_founders_status_after_signups(self, s):
        r = s.get(f"{API}/founders/status", timeout=5)
        data = r.json()
        assert data["taken"] == 2, f"expected 2 founders after 2 signups, got {data}"
        assert data["remaining"] == 498
        assert data["open"] is True

    def test_demo_users_not_founders(self):
        async def _check():
            db = _mongo()
            demo_founders = await db.users.count_documents({
                "is_demo": True, "is_founder": True,
            })
            assert demo_founders == 0, "demo accounts should never be founders"
            # And total founders should equal real non-demo only
            total_f = await db.users.count_documents({"is_founder": True})
            real_f = await db.users.count_documents({
                "is_founder": True, "is_demo": {"$ne": True},
            })
            assert total_f == real_f, "founder count must include only non-demo users"
        asyncio.get_event_loop().run_until_complete(_check())

    def test_auth_me_returns_founder_fields(self, s):
        token = pytest.shared_founder_tokens[0]
        r = s.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"}, timeout=5)
        assert r.status_code == 200, r.text
        u = r.json()
        assert u.get("is_founder") is True
        assert u.get("founder_number") == 1

    def test_login_still_works_for_new_account(self, s):
        uname = f"founder_test_{RUN_TAG}_1"
        r = s.post(f"{API}/auth/login", json={"username": uname, "password": "secret123"}, timeout=5)
        assert r.status_code == 200, r.text
        assert "access_token" in r.json()


# ---------------- 3. Waitlist endpoints ----------------
class TestWaitlist:
    def test_join_waitlist_first(self, s):
        email = f"iter29test_{RUN_TAG}_a@example.com"
        r = s.post(f"{API}/waitlist", json={"email": email, "source": "facebook", "name": "Alice"}, timeout=5)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert data["already_on_list"] is False
        assert data["position"] >= 1
        assert "joined_at" in data
        pytest.shared_first_email = email
        pytest.shared_first_position = data["position"]
        pytest.shared_first_joined_at = data["joined_at"]

    def test_join_waitlist_idempotent(self, s):
        email = pytest.shared_first_email
        r = s.post(f"{API}/waitlist", json={"email": email, "source": "ignored"}, timeout=5)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["already_on_list"] is True
        assert d["position"] == pytest.shared_first_position
        assert d["joined_at"] == pytest.shared_first_joined_at

    def test_invalid_email_returns_422(self, s):
        r = s.post(f"{API}/waitlist", json={"email": "not-an-email"}, timeout=5)
        assert r.status_code == 422, r.text

    def test_stats_sources_aggregation(self, s):
        # Add a second facebook and a flyer (total per request: 2 fb + 1 flyer)
        e2 = f"iter29test_{RUN_TAG}_b@example.com"
        e3 = f"iter29test_{RUN_TAG}_c@example.com"
        r2 = s.post(f"{API}/waitlist", json={"email": e2, "source": "facebook"}, timeout=5)
        r3 = s.post(f"{API}/waitlist", json={"email": e3, "source": "flyer"}, timeout=5)
        assert r2.status_code == 200 and r3.status_code == 200
        r = s.get(f"{API}/waitlist/stats", timeout=5)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["total"] >= 3
        assert "invited" in data and "waiting" in data
        sources = {x["source"]: x["count"] for x in data["sources"]}
        assert sources.get("facebook", 0) >= 2, sources
        assert sources.get("flyer", 0) >= 1, sources

    def test_rate_limit_5_per_10min(self, s):
        # We've already made 3 successful POSTs above + 1 invalid (which counts
        # against bucket BEFORE the 422 — rate_limit runs first).
        # We need to be careful: the rate_limit fires before validation.
        # Plus 1 idempotent call. So bucket count so far = 5. Next must 429.
        attempt_email = f"iter29test_{RUN_TAG}_rl_{{i}}@example.com"
        last_status = None
        for i in range(8):
            r = s.post(f"{API}/waitlist", json={"email": attempt_email.format(i=i)}, timeout=5)
            last_status = r.status_code
            if last_status == 429:
                break
        assert last_status == 429, f"expected 429 within 8 attempts, last={last_status}"


# ---------------- 4. Admin waitlist endpoints ----------------
class TestAdminWaitlist:
    def test_admin_list_as_maggie(self, s):
        r = s.get(f"{API}/admin/waitlist", params={"admin_id": MAGGIE_ID}, timeout=5)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "entries" in data and "total" in data
        assert data["total"] >= 3
        pytest.shared_entry_id = data["entries"][0]["id"]

    def test_admin_list_forbidden_for_non_admin(self, s):
        # Use a founder we created (not admin)
        non_admin = pytest.shared_founder_ids[0]
        r = s.get(f"{API}/admin/waitlist", params={"admin_id": non_admin}, timeout=5)
        assert r.status_code == 403, r.text

    def test_mark_invited_success(self, s):
        eid = pytest.shared_entry_id
        r = s.post(f"{API}/admin/waitlist/{eid}/mark-invited", params={"admin_id": MAGGIE_ID}, timeout=5)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True
        # Idempotent — call again
        r2 = s.post(f"{API}/admin/waitlist/{eid}/mark-invited", params={"admin_id": MAGGIE_ID}, timeout=5)
        assert r2.status_code == 200

    def test_mark_invited_404_for_unknown(self, s):
        r = s.post(f"{API}/admin/waitlist/does-not-exist/mark-invited",
                   params={"admin_id": MAGGIE_ID}, timeout=5)
        assert r.status_code == 404, r.text

    def test_mark_invited_403_for_non_admin(self, s):
        eid = pytest.shared_entry_id
        non_admin = pytest.shared_founder_ids[0]
        r = s.post(f"{API}/admin/waitlist/{eid}/mark-invited",
                   params={"admin_id": non_admin}, timeout=5)
        assert r.status_code == 403, r.text


# ---------------- 5. Regression: signup rate-limit still fires (iter28) ----------------
class TestSignupRateLimitRegression:
    """5/10min/IP. We already used 2 signup slots earlier. So this run can
    spend at most 3 more before hitting 429. Use unique usernames to avoid
    the username-taken short-circuit.
    """
    def test_signup_429_after_burst(self, s):
        last = None
        for i in range(8):
            uname = f"founder_test_{RUN_TAG}_rl_{i}"
            r = s.post(f"{API}/auth/signup", json={
                "username": uname, "password": "secret123",
                "email": f"{uname}@example.com", "first_name": "RL",
            }, timeout=5)
            last = r.status_code
            if last == 429:
                break
        assert last == 429, f"expected 429 from signup rate-limit, last={last}"
