"""iter215 — RED #1: Founder link-account lookup robustness.

Tests the deterministic variant lookup in
`POST /api/cms/crm/founding-members/{member_id}/link-account`:
  1. Whitespace + case-insensitive email match
  2. Gmail dot-alias (forward and reverse)
  3. user_id payload → apple_id fallback
  4. 404 when no match (no fuzzy false-positive)
  5. Happy path: plain exact email still works
"""
import os
import uuid
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASSWORD = "TestPass2026!"


@pytest.fixture(scope="module")
def mongo():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="module")
def admin_token():
    assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"
    r = requests.post(
        f"{BASE_URL}/api/cms/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200, f"CMS admin login failed: {r.status_code} {r.text}"
    data = r.json()
    tok = data.get("token")
    assert tok, f"no token in login response: {data}"
    return tok


@pytest.fixture
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


def _seed_user(mongo, *, email=None, username=None, apple_id=None, google_id=None):
    uid = f"TEST_iter215_{uuid.uuid4().hex[:8]}"
    doc = {
        "id": uid,
        "email": email,
        "username": username or uid,
        "first_name": "Test",
        "is_demo": False,
    }
    if apple_id:
        doc["apple_id"] = apple_id
    if google_id:
        doc["google_id"] = google_id
    mongo.users.insert_one(doc)
    return uid


def _seed_registration(mongo, *, founder_number=None):
    rid = f"TEST_iter215_reg_{uuid.uuid4().hex[:8]}"
    doc = {
        "id": rid,
        "first_name": "Test",
        "email": f"reg-{rid}@example.com",
        "founder_number": founder_number or (90000 + (uuid.uuid4().int % 9000)),
        "status": "pending",
        "is_test": True,
    }
    mongo.interest_registrations.insert_one(doc)
    return rid, doc["founder_number"]


@pytest.fixture
def cleanup(mongo):
    created_users = []
    created_regs = []
    yield (created_users, created_regs)
    if created_users:
        mongo.users.delete_many({"id": {"$in": created_users}})
    if created_regs:
        mongo.interest_registrations.delete_many({"id": {"$in": created_regs}})


# ---- 1. Happy path: exact email ------------------------------------------------

def test_link_account_exact_email_match(mongo, auth_headers, cleanup):
    users, regs = cleanup
    tag = uuid.uuid4().hex[:8]
    email = f"TEST_iter215_exact_{tag}@example.com"
    uid = _seed_user(mongo, email=email)
    users.append(uid)
    rid, fnum = _seed_registration(mongo)
    regs.append(rid)

    r = requests.post(
        f"{BASE_URL}/api/cms/crm/founding-members/{rid}/link-account",
        headers=auth_headers, json={"email": email}, timeout=20,
    )
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    data = r.json()
    assert data.get("ok") is True
    assert data["linked_user"]["id"] == uid
    assert data["founder_number"] == fnum
    # Verify DB persistence
    db_user = mongo.users.find_one({"id": uid}, {"_id": 0})
    assert db_user.get("founder_number") == fnum
    assert db_user.get("is_founder") is True


# ---- 2. Whitespace-tolerant + case-insensitive match ---------------------------

def test_link_account_email_with_whitespace_and_mixed_case(mongo, auth_headers, cleanup):
    users, regs = cleanup
    tag = uuid.uuid4().hex[:8]
    # Stored WITH surrounding whitespace and uppercase. Admin types lowercase trimmed.
    stored_email = f"  TEST_iter215_WS_{tag}@Example.com  "
    typed_email = f"test_iter215_ws_{tag}@example.com"
    uid = _seed_user(mongo, email=stored_email)
    users.append(uid)
    rid, fnum = _seed_registration(mongo)
    regs.append(rid)

    r = requests.post(
        f"{BASE_URL}/api/cms/crm/founding-members/{rid}/link-account",
        headers=auth_headers, json={"email": typed_email}, timeout=20,
    )
    assert r.status_code == 200, f"whitespace lookup failed: {r.status_code} {r.text}"
    data = r.json()
    assert data["linked_user"]["id"] == uid


# ---- 3a. Gmail dot-alias: forward (admin types dotted, member stored plain) ----

def test_link_account_gmail_dot_alias_forward(mongo, auth_headers, cleanup):
    users, regs = cleanup
    tag = uuid.uuid4().hex[:6]
    stored = f"testiter215dot{tag}@gmail.com"              # plain
    typed = f"test.iter215.dot.{tag}@gmail.com"            # dotted
    uid = _seed_user(mongo, email=stored)
    users.append(uid)
    rid, fnum = _seed_registration(mongo)
    regs.append(rid)

    r = requests.post(
        f"{BASE_URL}/api/cms/crm/founding-members/{rid}/link-account",
        headers=auth_headers, json={"email": typed}, timeout=20,
    )
    assert r.status_code == 200, f"gmail dot forward failed: {r.status_code} {r.text}"
    assert r.json()["linked_user"]["id"] == uid


# ---- 3b. Gmail dot-alias: reverse (admin types plain, member stored dotted) ----

def test_link_account_gmail_dot_alias_reverse(mongo, auth_headers, cleanup):
    users, regs = cleanup
    tag = uuid.uuid4().hex[:6]
    stored = f"test.iter215.rev.{tag}@gmail.com"           # dotted
    typed = f"testiter215rev{tag}@gmail.com"               # plain
    uid = _seed_user(mongo, email=stored)
    users.append(uid)
    rid, fnum = _seed_registration(mongo)
    regs.append(rid)

    r = requests.post(
        f"{BASE_URL}/api/cms/crm/founding-members/{rid}/link-account",
        headers=auth_headers, json={"email": typed}, timeout=20,
    )
    assert r.status_code == 200, f"gmail dot reverse failed: {r.status_code} {r.text}"
    assert r.json()["linked_user"]["id"] == uid


# ---- 4. user_id payload → apple_id fallback ------------------------------------

def test_link_account_user_id_apple_sub_fallback(mongo, auth_headers, cleanup):
    users, regs = cleanup
    tag = uuid.uuid4().hex[:8]
    apple_sub = f"TEST_iter215_apple_{tag}.001234.abcd"
    uid = _seed_user(mongo, email=f"applefn-{tag}@example.com", apple_id=apple_sub)
    users.append(uid)
    rid, fnum = _seed_registration(mongo)
    regs.append(rid)

    r = requests.post(
        f"{BASE_URL}/api/cms/crm/founding-members/{rid}/link-account",
        headers=auth_headers, json={"user_id": apple_sub}, timeout=20,
    )
    assert r.status_code == 200, f"apple_id fallback failed: {r.status_code} {r.text}"
    assert r.json()["linked_user"]["id"] == uid


# ---- 5. 404 when nothing matches (no fuzzy false-positive) ---------------------

def test_link_account_404_no_match(mongo, auth_headers, cleanup):
    _, regs = cleanup
    rid, _ = _seed_registration(mongo)
    regs.append(rid)

    unlikely = f"TEST_iter215_nobody_{uuid.uuid4().hex}@nope.invalid"
    r = requests.post(
        f"{BASE_URL}/api/cms/crm/founding-members/{rid}/link-account",
        headers=auth_headers, json={"email": unlikely}, timeout=20,
    )
    assert r.status_code == 404, f"expected 404, got {r.status_code} {r.text}"
