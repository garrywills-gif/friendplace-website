"""Slice 0.5 — MCGS security foundation E2E tests.

Covers:
  * summary endpoint auth + payload shape
  * four-tier progressive defence (Tier 1 alert, Tier 2 lockout, Tier 3/4 mass-attack)
  * lockout clear endpoint (cascades to attempts row)
  * successful login resets counters, JWT contains `jti`, admin_sessions row
  * sessions list + revoke → subsequent auth call 401
  * events filter by outcome
  * backwards-compat: /cms/admin-log + /cms/members still 200
  * cleanup: no test data left behind

Uses sync pymongo — pytest-asyncio isn't installed in this env.
"""
from __future__ import annotations

import base64
import json as _json
import os
import re
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://outreach-campaigns.preview.emergentagent.com"
).rstrip("/")

ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASSWORD = "TestPass2026!"
TEST_EMAIL = "e2e-slice05@friendplace-test.dev"
SYNTHETIC_IP = "10.20.30.40"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


# ─────────────────────────── fixtures ──────────────────────────────

@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def db():
    client = MongoClient(MONGO_URL)
    return client[DB_NAME]


def _cleanup_test_data(db):
    db.admin_security_log.delete_many({
        "$or": [
            {"email": TEST_EMAIL},
            {"email": {"$regex": r"^synthetic-"}},
        ]
    })
    db.admin_login_attempts.delete_many({"scope": "email", "key": TEST_EMAIL})
    db.admin_login_attempts.delete_many(
        {"scope": "email", "key": {"$regex": r"^synthetic-"}}
    )
    db.admin_login_attempts.delete_many({"scope": "ip", "key": SYNTHETIC_IP})
    db.admin_lockouts.delete_many({"scope": "email", "key": TEST_EMAIL})
    db.admin_lockouts.delete_many({"scope": "ip", "key": SYNTHETIC_IP})
    db.mcgs_signals.delete_many({"kind": "security.mass_login_attempts"})
    # Clear any residual IP-scoped lockouts/attempts from a previous run
    # (we can't know our test-machine IP up-front so we sweep recent rows).
    now = datetime.now(timezone.utc)
    recent = now - timedelta(minutes=30)
    db.admin_lockouts.delete_many({
        "scope": "ip",
        "$or": [
            {"created_at": {"$gte": recent}},
            {"updated_at": {"$gte": recent}},
        ],
    })
    db.admin_login_attempts.delete_many({
        "scope": "ip",
        "$or": [
            {"created_at": {"$gte": recent}},
            {"updated_at": {"$gte": recent}},
        ],
    })


@pytest.fixture(scope="session", autouse=True)
def _cleanup_wrap(db):
    _cleanup_test_data(db)
    yield
    _cleanup_test_data(db)


@pytest.fixture(scope="session")
def admin_token(api, db):
    # Clear lockouts on the admin email itself before logging in.
    db.admin_lockouts.delete_many({"scope": "email", "key": ADMIN_EMAIL})
    db.admin_login_attempts.delete_many({"scope": "email", "key": ADMIN_EMAIL})
    r = api.post(f"{BASE_URL}/api/cms/auth/login",
                 json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _decode_jwt(token):
    parts = token.split(".")
    assert len(parts) == 3
    payload_b64 = parts[1] + "=" * (-len(parts[1]) % 4)
    return _json.loads(base64.urlsafe_b64decode(payload_b64))


def _wrong_login(api, email=TEST_EMAIL, password="not-the-password"):
    return api.post(
        f"{BASE_URL}/api/cms/auth/login",
        json={"email": email, "password": password},
    )


# ─────────────────────────── tests ─────────────────────────────────

# ---- Summary endpoint ---------------------------------------------

def test_summary_requires_auth(api):
    r = api.get(f"{BASE_URL}/api/cms/security/summary")
    assert r.status_code == 401


def test_summary_with_auth(api, admin_token):
    r = api.get(f"{BASE_URL}/api/cms/security/summary", headers=_auth(admin_token))
    assert r.status_code == 200
    data = r.json()
    for k in ("active_sessions", "active_lockouts", "fails_last_24h",
              "successes_last_24h", "thresholds"):
        assert k in data, f"missing key {k}"
    t = data["thresholds"]
    for tk in ("alert_after", "lockout_after", "lockout_minutes",
               "mass_attack_fails", "mass_attack_urgent",
               "mass_attack_window_minutes"):
        assert tk in t


# ---- Four-tier progressive defence --------------------------------

def test_tier1_alert_after_3_fails(api, db):
    # Fresh slate for TEST_EMAIL.
    db.admin_login_attempts.delete_many({"scope": "email", "key": TEST_EMAIL})
    db.admin_lockouts.delete_many({"scope": "email", "key": TEST_EMAIL})
    db.admin_security_log.delete_many({"email": TEST_EMAIL})

    for i in range(3):
        r = _wrong_login(api)
        assert r.status_code == 401, f"attempt {i+1} got {r.status_code}: {r.text}"

    fails = db.admin_security_log.count_documents(
        {"email": TEST_EMAIL, "outcome": "fail"}
    )
    assert fails >= 3, f"expected ≥3 fail events, got {fails}"

    row = db.admin_login_attempts.find_one({"scope": "email", "key": TEST_EMAIL})
    assert row is not None, "attempts row should exist"
    assert row.get("alert_sent_at") is not None, \
        "Tier 1 alert_sent_at should be stamped after 3 fails"
    assert row.get("fail_count", 0) >= 3


def test_tier2_lockout_after_5_fails(api, db):
    # 4th + 5th failed login. 5th trips Tier 2 lockout (429).
    r4 = _wrong_login(api)
    assert r4.status_code == 401, f"4th got {r4.status_code}"

    r5 = _wrong_login(api)
    assert r5.status_code == 429, f"5th should 429, got {r5.status_code}: {r5.text}"
    assert r5.headers.get("Retry-After") is not None

    lock = db.admin_lockouts.find_one({"scope": "email", "key": TEST_EMAIL})
    assert lock is not None
    assert lock.get("locked_until") is not None

    created_ev = db.admin_security_log.count_documents(
        {"email": TEST_EMAIL, "outcome": "lockout_created"}
    )
    assert created_ev >= 1


def test_tier2_lockout_hit_on_next_attempt(api, db):
    r6 = _wrong_login(api)
    assert r6.status_code == 429
    hit = db.admin_security_log.count_documents(
        {"email": TEST_EMAIL, "outcome": "lockout_hit"}
    )
    assert hit >= 1


# ---- Clear lockout endpoint --------------------------------------

def test_clear_lockout(api, admin_token, db):
    r = api.post(
        f"{BASE_URL}/api/cms/security/lockouts/clear",
        headers=_auth(admin_token),
        json={"scope": "email", "key": TEST_EMAIL},
    )
    assert r.status_code == 200
    assert r.json().get("ok") is True

    assert db.admin_lockouts.find_one({"scope": "email", "key": TEST_EMAIL}) is None
    assert db.admin_login_attempts.find_one(
        {"scope": "email", "key": TEST_EMAIL}
    ) is None

    # Also clear IP-scoped lockout/attempts that Tier-2 created for the
    # requester IP (the wrong-login burst bumped the IP counter too).
    # Without this, subsequent legitimate admin logins from the same IP
    # are rejected with 429 during the rest of the suite.
    now = datetime.now(timezone.utc)
    recent = now - timedelta(minutes=10)
    db.admin_lockouts.delete_many({
        "scope": "ip",
        "$or": [
            {"created_at": {"$gte": recent}},
            {"updated_at": {"$gte": recent}},
        ],
    })
    db.admin_login_attempts.delete_many({
        "scope": "ip",
        "$or": [
            {"created_at": {"$gte": recent}},
            {"updated_at": {"$gte": recent}},
        ],
    })


# ---- Successful login: reset counters + jti in JWT + session row --

def test_successful_login_creates_session_with_jti(api, db):
    r = api.post(f"{BASE_URL}/api/cms/auth/login",
                 json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200
    token = r.json()["token"]

    payload = _decode_jwt(token)
    jti = payload.get("jti")
    assert jti, f"JWT missing jti claim: {payload}"

    sess = db.admin_sessions.find_one({"jti": jti})
    assert sess is not None
    assert sess.get("email") == ADMIN_EMAIL
    assert sess.get("revoked_at") is None


# ---- Sessions list + revoke gates auth ----------------------------

def test_sessions_list_and_revoke_gates_auth(api, db):
    # Login twice — one becomes victim, the other performs revoke.
    r_v = api.post(f"{BASE_URL}/api/cms/auth/login",
                   json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r_v.status_code == 200
    victim_token = r_v.json()["token"]
    victim_jti = _decode_jwt(victim_token).get("jti")
    assert victim_jti

    r_a = api.post(f"{BASE_URL}/api/cms/auth/login",
                   json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r_a.status_code == 200
    revoker_token = r_a.json()["token"]

    # sessions list contains victim_jti.
    sl = api.get(f"{BASE_URL}/api/cms/security/sessions?active_only=true",
                 headers=_auth(revoker_token))
    assert sl.status_code == 200
    jtis = [s.get("jti") for s in sl.json().get("items", [])]
    assert victim_jti in jtis, f"victim jti {victim_jti} not in returned sessions"

    # /me works on victim BEFORE revoke.
    me = api.get(f"{BASE_URL}/api/cms/auth/me", headers=_auth(victim_token))
    assert me.status_code == 200, f"/me should work pre-revoke: {me.status_code}"

    # Revoke.
    rev = api.post(
        f"{BASE_URL}/api/cms/security/sessions/{victim_jti}/revoke",
        headers=_auth(revoker_token),
    )
    assert rev.status_code == 200
    assert rev.json().get("ok") is True

    # /me on revoked token → 401.
    me2 = api.get(f"{BASE_URL}/api/cms/auth/me", headers=_auth(victim_token))
    assert me2.status_code == 401, \
        f"expected 401 after revoke, got {me2.status_code}: {me2.text}"


# ---- Events filter by outcome + backwards-compat -----------------

def test_events_filter_by_outcome(api, admin_token):
    r = api.get(f"{BASE_URL}/api/cms/security/events?outcome=fail&limit=50",
                headers=_auth(admin_token))
    assert r.status_code == 200
    for row in r.json().get("items", []):
        assert row.get("outcome") == "fail"


def test_backcompat_admin_log_endpoint(api, admin_token):
    r = api.get(f"{BASE_URL}/api/cms/admin-log?limit=5", headers=_auth(admin_token))
    assert r.status_code == 200, f"/admin-log returned {r.status_code}"


def test_backcompat_members_endpoint(api, admin_token):
    r = api.get(f"{BASE_URL}/api/cms/members?limit=5", headers=_auth(admin_token))
    assert r.status_code == 200, f"/members returned {r.status_code}: {r.text[:200]}"


# ---- Tier 3/4 mass-attack detector -------------------------------

def test_mass_attack_signal_raised(api, db):
    # Clear signals + any synthetic residue.
    db.mcgs_signals.delete_many({"kind": "security.mass_login_attempts"})
    db.admin_security_log.delete_many({"email": {"$regex": r"^synthetic-"}})

    # Insert 21 synthetic recent fail events.
    now = datetime.now(timezone.utc)
    docs = [{
        "_id": str(uuid.uuid4()),
        "created_at": now - timedelta(minutes=1),
        "outcome": "fail",
        "email": f"synthetic-{i}@friendplace-test.dev",
        "ip": SYNTHETIC_IP,
        "user_agent": "test",
        "ua": {"browser": None, "os": None, "raw": ""},
        "geo": None,
        "attempt_count": 1,
    } for i in range(21)]
    db.admin_security_log.insert_many(docs)

    # Trigger check_mass_attack via one more failed login.
    trigger_email = f"synthetic-trigger-{uuid.uuid4().hex[:8]}@friendplace-test.dev"
    r = api.post(f"{BASE_URL}/api/cms/auth/login",
                 json={"email": trigger_email, "password": "nope"})
    assert r.status_code in (401, 429)

    time.sleep(1.0)

    signal = db.mcgs_signals.find_one({"kind": "security.mass_login_attempts"})
    assert signal is not None, "expected mass_login_attempts MCGS signal"
    assert signal.get("meta", {}).get("attempts", 0) >= 20

    # Cleanup.
    db.admin_security_log.delete_many({"email": {"$regex": r"^synthetic-"}})
    db.admin_login_attempts.delete_many(
        {"scope": "email", "key": {"$regex": r"^synthetic-"}}
    )
    db.admin_login_attempts.delete_many({"scope": "ip", "key": SYNTHETIC_IP})
    db.mcgs_signals.delete_many({"kind": "security.mass_login_attempts"})


# ---- /admin/security page returns 200 ----------------------------

def test_admin_security_page_reachable():
    r = requests.get(f"{BASE_URL}/admin/security", timeout=15, allow_redirects=True)
    assert r.status_code == 200, f"/admin/security returned {r.status_code}"
