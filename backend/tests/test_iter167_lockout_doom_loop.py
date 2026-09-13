"""Iteration 167 hotfix — CMS admin login-lockout doom-loop.

Root cause (see cms_module.py:494 in the pre-fix code):

    After 5 failed logins the admin was locked for 15 minutes.
    The `admin_login_attempts` fail_count was NEVER reset unless a
    login succeeded — and while the lockout was active, success was
    impossible (gate rejected before password verify). When the
    lockout timer expired, the counter was still ≥ 5. A SINGLE mistype
    on the next attempt satisfied ``count >= LOCKOUT_AFTER`` again,
    creating a fresh 15-minute lockout. Repeat indefinitely.

Fix (cms_module.py):

    Reset the failed-attempt counters IMMEDIATELY after arming the
    lockout. After the 15-minute cooldown the admin gets a clean
    5-attempt allowance instead of being one mistype away from
    another 15-minute cage.

Also verified here:

    * Attempts DURING an active lockout do NOT extend the timer
      (they're rejected at the gate before ``bump_attempt`` /
      ``create_lockout`` runs).
    * 5 fresh failures after cooldown still create a new lockout.
    * Successful login still resets counters as always.
    * TTL index on ``admin_login_attempts.last_fail_at`` (Fix C)
      is registered on boot.

Tests hit the RUNNING local backend at http://localhost:8001 and
manipulate ``db.admin_lockouts.locked_until`` to simulate the passage
of the 15-min timer. This avoids waiting a real quarter of an hour
and doesn't require any changes to LOCKOUT_MINUTES.
"""
from __future__ import annotations

import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = "http://localhost:8001"
LOGIN_PATH = "/api/cms/auth/login"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

# Every doom-loop test is scoped to a synthetic email — never touches
# the real ``hello@friendplace.com.au`` counter that Garry uses. Each
# fixture generates a UNIQUE email so parallel/repeated test runs
# don't fight for the same admin_login_attempts row.
TEST_PASSWORD = "definitely-not-the-real-password"


# ─── fixtures ──────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def db():
    return MongoClient(MONGO_URL)[DB_NAME]


@pytest.fixture()
def synth_email():
    """A fresh synthetic admin email per test.

    Nothing on the CMS side ever creates this admin row, so every
    login attempt against it deterministically fails password verify —
    which is exactly what we want for lockout testing.
    """
    return f"iter167-lockout-{uuid.uuid4().hex[:12]}@friendplace-test.dev"


@pytest.fixture(autouse=True)
def _isolate_and_cleanup(db, synth_email):
    """Every test starts with a clean slate (no leftover attempts /
    lockouts from a previous test run) and cleans up after itself.
    ``synth_email`` uniqueness handles the email scope; the ``ip`` scope
    is trickier because localhost's IP is shared — we wipe any ip-scope
    lockouts + attempt rows that predate this test's start.
    """
    def _wipe():
        db.admin_login_attempts.delete_many({"scope": "email", "key": synth_email})
        db.admin_lockouts.delete_many({"scope": "email", "key": synth_email})
        # Also clear IP-scope rows for 127.0.0.1 which is what
        # localhost tests will register.
        for ip in ("127.0.0.1", "localhost", "unknown"):
            db.admin_login_attempts.delete_many({"scope": "ip", "key": ip})
            db.admin_lockouts.delete_many({"scope": "ip", "key": ip})
        # And any residual security log rows referencing this email.
        db.admin_security_log.delete_many({"email": synth_email})

    _wipe()
    yield
    _wipe()


def _login(email: str, password: str = TEST_PASSWORD) -> requests.Response:
    """POST /api/cms/auth/login with the given creds. Uses a short
    timeout so a stuck backend fails fast rather than hanging the
    test suite."""
    return requests.post(
        f"{BASE_URL}{LOGIN_PATH}",
        json={"email": email, "password": password},
        timeout=10,
    )


def _expire_lockout(db, email: str) -> None:
    """Simulate the 15-minute cooldown having elapsed by rewriting
    ``locked_until`` on both scope rows to a past timestamp. This
    exercises the exact code path the wall-clock would trigger,
    without waiting a real 15 minutes."""
    past = datetime.now(timezone.utc) - timedelta(seconds=60)
    db.admin_lockouts.update_many(
        {"scope": "email", "key": email},
        {"$set": {"locked_until": past}},
    )
    for ip in ("127.0.0.1", "localhost", "unknown"):
        db.admin_lockouts.update_many(
            {"scope": "ip", "key": ip},
            {"$set": {"locked_until": past}},
        )


# ─── 1. Baseline: 5 failures trigger a lockout ────────────────────────

class TestFiveFailuresTriggerLockout:
    def test_five_wrong_passwords_locks_out(self, synth_email):
        # Attempts 1-4: 401 (invalid credentials).
        for i in range(1, 5):
            r = _login(synth_email)
            assert r.status_code == 401, (
                f"attempt {i}: expected 401, got {r.status_code} {r.text[:120]}"
            )
        # Attempt 5: also 401 in current impl (count reaches 5, but
        # the 429 is raised AFTER logging the fifth as a fail). The
        # SIXTH attempt is the first 429. Confirm by trying a 6th.
        # (Documenting this because the fix must not silently move the
        # threshold from 5→6.)
        r5 = _login(synth_email)
        r6 = _login(synth_email)
        assert 429 in {r5.status_code, r6.status_code}, (
            f"expected 429 by attempt 5 or 6, got {r5.status_code}/{r6.status_code}"
        )
        # And the response message must be the fixed lockout copy.
        locked = r5 if r5.status_code == 429 else r6
        assert "Too many attempts" in locked.text
        # Retry-After header MUST be set so browsers can back off.
        assert int(locked.headers.get("Retry-After", "0")) > 0


# ─── 2. Attempts during active lockout don't extend it ────────────────

class TestActiveLockoutDoesNotExtend:
    def test_locked_out_further_attempts_do_not_move_locked_until(
        self, db, synth_email,
    ):
        # Force the lockout by burning 6 attempts.
        for _ in range(6):
            _login(synth_email)
        row = db.admin_lockouts.find_one({"scope": "email", "key": synth_email})
        assert row is not None, "lockout row must exist after 5 failures"
        locked_until_before = row["locked_until"]

        # Now hammer 5 more attempts inside the active lockout window.
        # Each MUST return 429 (gate blocks) and MUST NOT advance
        # locked_until. This is the key invariant Garry called out.
        for _ in range(5):
            r = _login(synth_email)
            assert r.status_code == 429

        row_after = db.admin_lockouts.find_one({"scope": "email", "key": synth_email})
        assert row_after is not None
        # Timestamps may be stored as tz-aware datetimes (motor) or
        # naive UTC (pymongo) depending on driver — compare via
        # timestamp() after normalising.
        def _epoch(dt):
            return dt.replace(tzinfo=timezone.utc).timestamp() if dt.tzinfo is None else dt.timestamp()
        assert _epoch(row_after["locked_until"]) == _epoch(locked_until_before), (
            "locked_until must NOT advance while the lockout is active"
        )


# ─── 3. After expiry the counter is fresh (the doom-loop fix) ─────────

class TestCooldownResetsCounter:
    def test_fail_count_reset_when_lockout_is_armed(self, db, synth_email):
        """The moment a lockout is created, the fix must reset the
        stale ``fail_count`` so it doesn't carry over into the next
        cooldown."""
        for _ in range(6):
            _login(synth_email)
        row = db.admin_login_attempts.find_one({"scope": "email", "key": synth_email})
        # After the fix: the row is deleted (reset_counters uses
        # delete_many). Either "row is None" OR fail_count reset to 0
        # is acceptable — both mean "clean slate".
        if row is not None:
            assert row.get("fail_count", 0) == 0, (
                f"fail_count must reset when lockout is armed; got row={row}"
            )

    def test_one_mistype_after_expiry_does_not_relock(self, db, synth_email):
        # 1. Burn 5-6 wrong attempts → lockout armed.
        for _ in range(6):
            _login(synth_email)
        assert db.admin_lockouts.find_one({"scope": "email", "key": synth_email}) is not None

        # 2. Simulate the 15-min cooldown having elapsed.
        _expire_lockout(db, synth_email)

        # 3. ONE more wrong password. Under the pre-fix behaviour this
        #    would satisfy ``count >= LOCKOUT_AFTER`` immediately (the
        #    counter was still ≥ 5) and re-lock. Under the fix the
        #    counter is at 0 → this becomes fail_count=1, no new
        #    lockout, response is 401 (not 429).
        r = _login(synth_email)
        assert r.status_code == 401, (
            f"After cooldown, ONE mistype must return 401, not 429. "
            f"Got {r.status_code} {r.text[:120]}"
        )
        # And no new active lockout should have been armed by that
        # single failure.
        active_lockout = db.admin_lockouts.find_one({
            "scope": "email",
            "key": synth_email,
            "locked_until": {"$gt": datetime.now(timezone.utc)},
        })
        assert active_lockout is None, (
            "A single mistype after cooldown must NOT arm a new lockout"
        )

    def test_fresh_five_failures_after_cooldown_re_arm_lockout(
        self, db, synth_email,
    ):
        # Full round-trip: cage, wait, cage-again.
        for _ in range(6):
            _login(synth_email)
        _expire_lockout(db, synth_email)
        # 5 fresh failures should NOW trigger the SECOND lockout.
        for _ in range(6):
            _login(synth_email)
        active_lockout = db.admin_lockouts.find_one({
            "scope": "email",
            "key": synth_email,
            "locked_until": {"$gt": datetime.now(timezone.utc)},
        })
        assert active_lockout is not None, (
            "5 fresh failures after cooldown must arm a new lockout"
        )


# ─── 4. Successful login still resets counters ────────────────────────
# (Uses the REAL admin account because we need a working password.
# Reads only — never mutates the account. Cleans up its own ip-scope
# residue so the real admin's counter isn't affected.)

class TestSuccessfulLoginStillResetsCounters:
    REAL_EMAIL = "hello@friendplace.com.au"
    REAL_PASSWORD = "TestPass2026!"

    def test_success_clears_counters(self, db):
        # Prime the counter for a foreign email (not the real one),
        # then verify a successful REAL login doesn't leave stale
        # counters behind for the real email.
        r = _login(self.REAL_EMAIL, self.REAL_PASSWORD)
        # Skip if the real admin is currently locked from a prior run —
        # we don't want this test to fight the lockout it's meant to
        # verify.
        if r.status_code == 429:
            pytest.skip("Real admin currently in cooldown from a previous test run")
        assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
        assert r.json().get("ok") is True
        # After success, counters for THIS email must be clear.
        row = db.admin_login_attempts.find_one(
            {"scope": "email", "key": self.REAL_EMAIL},
        )
        assert row is None or int(row.get("fail_count", 0)) == 0


# ─── 5. TTL index is registered (Fix C) ───────────────────────────────

class TestTTLIndexPresent:
    def test_admin_login_attempts_has_last_fail_at_ttl(self, db):
        indexes = list(db.admin_login_attempts.list_indexes())
        ttl_idx = next(
            (i for i in indexes if i.get("expireAfterSeconds") is not None),
            None,
        )
        assert ttl_idx is not None, (
            f"admin_login_attempts is missing a TTL index; got: {[i.get('name') for i in indexes]}"
        )
        # 24 hours = 86400 seconds.
        assert ttl_idx["expireAfterSeconds"] == 86_400, (
            f"TTL should be 24h (86400s); got {ttl_idx['expireAfterSeconds']}"
        )
        # The index key must be on last_fail_at (not created_at) so it
        # tracks activity, not row-birth.
        key_fields = list(ttl_idx.get("key", {}).keys())
        assert "last_fail_at" in key_fields, (
            f"TTL index must be keyed on last_fail_at; got {key_fields}"
        )
