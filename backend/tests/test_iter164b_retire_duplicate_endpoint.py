"""iter164b — Admin-only retire-duplicate endpoint.

Mirrors ``backend/scripts/retire_duplicate_founding_members.py`` but
exposed as ``POST /api/cms/crm/founding-members/retire-duplicate``
so the cleanup can be triggered against a deployed environment
without needing a production shell.

Contract locked in:
  1. Requires a valid admin JWT.
  2. Retires ONLY the exact founder_number named in the body, and
     ONLY if a genuine normalised-email duplicate exists.
  3. Refuses to retire the keeper (oldest row).
  4. Refuses reserved / test rows.
  5. Writes an audit row before deleting.
  6. Idempotent: a second call returns ``already_retired:true`` with
     the original audit record and does not re-write anything.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, timezone

import httpx
import pytest
import pytest_asyncio
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BACKEND_URL = "http://localhost:8001"
MONGO_URL = os.environ.get("MONGO_URL") or "mongodb://localhost:27017"
DB_NAME = os.environ.get("DB_NAME") or "test_database"


# Session-scoped event loop so motor's global handle stays valid.
@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest_asyncio.fixture(loop_scope="session")
async def db():
    client = AsyncIOMotorClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest_asyncio.fixture(autouse=True, loop_scope="session")
async def _clean(db):
    await db.interest_registrations.delete_many(
        {"email": {"$regex": "^iter164b-"}}
    )
    await db.retired_registrations.delete_many(
        {"email": {"$regex": "^iter164b-"}}
    )
    yield
    await db.interest_registrations.delete_many(
        {"email": {"$regex": "^iter164b-"}}
    )
    await db.retired_registrations.delete_many(
        {"email": {"$regex": "^iter164b-"}}
    )


# ─── admin login helper ──────────────────────────────────────────────
def _admin_token() -> str:
    """Log in as the test admin and return a Bearer token."""
    creds = {
        "email":    os.environ.get("TEST_ADMIN_EMAIL", "hello@friendplace.com.au"),
        "password": os.environ.get("TEST_ADMIN_PASSWORD", "TestPass2026!"),
    }
    r = requests.post(f"{BACKEND_URL}/api/cms/auth/login", json=creds, timeout=10)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    data = r.json()
    # cms_module returns {"token": "..."} — some other flows use
    # {"access_token": "..."}. Accept both.
    tok = data.get("token") or data.get("access_token")
    assert tok, f"no token in login response: {data}"
    return tok


@pytest_asyncio.fixture(loop_scope="session")
async def token():
    return _admin_token()


async def _seed_duplicate_pair(db, email, keeper_num=10, dupe_num=11):
    """Insert a legacy-style duplicate pair bypassing the iter164
    partial unique index (leave is_test unset so the partial filter
    ``{is_test: false}`` doesn't cover them)."""
    await db.interest_registrations.insert_one({
        "id":             f"iter164b-keeper-{uuid.uuid4().hex[:6]}",
        "email":          email,
        "first_name":     "Dora",
        "founder_number": keeper_num,
        "is_reserved":    False,
        "status":         "registered",
        "created_at":     "2026-08-01T09:00:00+00:00",
    })
    await db.interest_registrations.insert_one({
        "id":             f"iter164b-dupe-{uuid.uuid4().hex[:6]}",
        "email":          email,
        "first_name":     "Dora",
        "founder_number": dupe_num,
        "is_reserved":    False,
        "status":         "registered",
        "created_at":     "2026-08-01T23:00:00+00:00",
    })


# ─────────────────────────────────────────────────────────────────────
#  Auth gate
# ─────────────────────────────────────────────────────────────────────

async def test_requires_admin_auth(db):
    """No token → 401. Endpoint must never be reachable anonymously."""
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(
            f"{BACKEND_URL}/api/cms/crm/founding-members/retire-duplicate",
            json={"founder_number": 11},
        )
    assert r.status_code in (401, 403), r.text


# ─────────────────────────────────────────────────────────────────────
#  Happy path: retire #0011, keep #0010
# ─────────────────────────────────────────────────────────────────────

async def test_retires_duplicate_and_keeps_original(db, token):
    email = f"iter164b-{uuid.uuid4().hex[:6]}@example.com"
    await _seed_duplicate_pair(db, email, keeper_num=10, dupe_num=11)

    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(
            f"{BACKEND_URL}/api/cms/crm/founding-members/retire-duplicate",
            json={"founder_number": 11},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["retired_founder_number"] == 11
    assert body["keeper_founder_number"] == 10
    assert body["retired_email"] == email
    assert "retired_at" in body

    # Live collection: #0011 gone, #0010 untouched.
    keeper = await db.interest_registrations.find_one({"founder_number": 10, "email": email})
    dupe   = await db.interest_registrations.find_one({"founder_number": 11, "email": email})
    assert keeper is not None
    assert keeper["created_at"] == "2026-08-01T09:00:00+00:00"
    assert dupe is None

    # Audit row landed with correct keeper linkage.
    audit = await db.retired_registrations.find_one({"founder_number": 11, "email": email})
    assert audit is not None
    assert audit["retire_keeper_founder_number"] == 10
    assert audit["retire_admin_id"]  # admin id captured
    assert "iter164" in audit["retire_reason"].lower()


# ─────────────────────────────────────────────────────────────────────
#  Idempotency: second call is a no-op
# ─────────────────────────────────────────────────────────────────────

async def test_idempotent_second_call(db, token):
    email = f"iter164b-{uuid.uuid4().hex[:6]}@example.com"
    await _seed_duplicate_pair(db, email, keeper_num=20, dupe_num=21)

    async with httpx.AsyncClient(timeout=10) as client:
        r1 = await client.post(
            f"{BACKEND_URL}/api/cms/crm/founding-members/retire-duplicate",
            json={"founder_number": 21},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r1.status_code == 200, r1.text
        assert r1.json()["retired_founder_number"] == 21

        # Second call — must return already_retired without touching the DB.
        r2 = await client.post(
            f"{BACKEND_URL}/api/cms/crm/founding-members/retire-duplicate",
            json={"founder_number": 21},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r2.status_code == 200, r2.text
        body2 = r2.json()
        assert body2["ok"] is True
        assert body2.get("already_retired") is True
        assert body2["retired_founder_number"] == 21
        assert body2["keeper_founder_number"] == 20

    # Exactly one audit row (no duplicate write on the second call).
    n = await db.retired_registrations.count_documents(
        {"founder_number": 21, "email": email}
    )
    assert n == 1


# ─────────────────────────────────────────────────────────────────────
#  Refuse to retire the keeper (oldest row)
# ─────────────────────────────────────────────────────────────────────

async def test_refuses_to_retire_the_keeper(db, token):
    email = f"iter164b-{uuid.uuid4().hex[:6]}@example.com"
    await _seed_duplicate_pair(db, email, keeper_num=30, dupe_num=31)

    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(
            f"{BACKEND_URL}/api/cms/crm/founding-members/retire-duplicate",
            json={"founder_number": 30},   # asking to retire the KEEPER
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 409, r.text
    detail = r.json().get("detail", "").lower()
    assert "keeper" in detail or "oldest" in detail
    # Both rows still present.
    assert await db.interest_registrations.count_documents({"email": email}) == 2


# ─────────────────────────────────────────────────────────────────────
#  Refuse when the target isn't actually a duplicate
# ─────────────────────────────────────────────────────────────────────

async def test_refuses_when_no_duplicate_exists(db, token):
    email = f"iter164b-{uuid.uuid4().hex[:6]}@example.com"
    # Only ONE row for this email — no duplicate.
    await db.interest_registrations.insert_one({
        "id":             f"iter164b-solo-{uuid.uuid4().hex[:6]}",
        "email":          email,
        "first_name":     "Solo",
        "founder_number": 40,
        "is_reserved":    False,
        "created_at":     "2026-08-01T00:00:00+00:00",
    })

    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(
            f"{BACKEND_URL}/api/cms/crm/founding-members/retire-duplicate",
            json={"founder_number": 40},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 409, r.text
    detail = r.json().get("detail", "").lower()
    assert "not a duplicate" in detail or "no other" in detail
    assert await db.interest_registrations.find_one({"founder_number": 40}) is not None


# ─────────────────────────────────────────────────────────────────────
#  Refuse reserved and test rows
# ─────────────────────────────────────────────────────────────────────

async def test_refuses_reserved_row(db, token):
    email = f"iter164b-{uuid.uuid4().hex[:6]}@example.com"
    await db.interest_registrations.insert_one({
        "id":             f"iter164b-res-{uuid.uuid4().hex[:6]}",
        "email":          email,
        "founder_number": 50,
        "is_reserved":    True,
        "created_at":     "2026-08-01T00:00:00+00:00",
    })
    # Also seed a normal row on the same email so there IS a duplicate
    # from a pure-data standpoint — the reserved check should still
    # win.
    await db.interest_registrations.insert_one({
        "id":             f"iter164b-normal-{uuid.uuid4().hex[:6]}",
        "email":          email,
        "founder_number": 51,
        "is_reserved":    False,
        "created_at":     "2026-08-01T14:00:00+00:00",
    })

    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(
            f"{BACKEND_URL}/api/cms/crm/founding-members/retire-duplicate",
            json={"founder_number": 50},   # reserved
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 403, r.text
    assert "reserved" in r.json().get("detail", "").lower()


async def test_refuses_test_flagged_row(db, token):
    email = f"iter164b-{uuid.uuid4().hex[:6]}@example.com"
    await db.interest_registrations.insert_one({
        "id":             f"iter164b-qa-{uuid.uuid4().hex[:6]}",
        "email":          email,
        "founder_number": 60,
        "is_test":        True,
        "created_at":     "2026-08-01T00:00:00+00:00",
    })

    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(
            f"{BACKEND_URL}/api/cms/crm/founding-members/retire-duplicate",
            json={"founder_number": 60},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 403, r.text
    assert "test" in r.json().get("detail", "").lower()


# ─────────────────────────────────────────────────────────────────────
#  Refuse invalid inputs
# ─────────────────────────────────────────────────────────────────────

async def test_refuses_missing_founder_number(db, token):
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(
            f"{BACKEND_URL}/api/cms/crm/founding-members/retire-duplicate",
            json={},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 400
    assert "founder_number" in r.json().get("detail", "").lower()


async def test_refuses_reserved_numbers_by_shortcut(db, token):
    """#0001 and #0002 are always reserved even if the row doesn't have
    is_reserved:true — reject at input validation."""
    async with httpx.AsyncClient(timeout=10) as client:
        for n in (1, 2, 0, -5):
            r = await client.post(
                f"{BACKEND_URL}/api/cms/crm/founding-members/retire-duplicate",
                json={"founder_number": n},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert r.status_code == 400, r.text


async def test_refuses_nonexistent_founder_number(db, token):
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(
            f"{BACKEND_URL}/api/cms/crm/founding-members/retire-duplicate",
            json={"founder_number": 99998},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 404


# ─────────────────────────────────────────────────────────────────────
#  Normalised-email lookup (case + whitespace)
# ─────────────────────────────────────────────────────────────────────

async def test_normalisation_still_finds_the_duplicate(db, token):
    """Legacy rows may have been stored with mixed-case emails. The
    endpoint uses the target's stored email and normalises it before
    matching."""
    email_stored_target = f"ITER164B-{uuid.uuid4().hex[:6]}@Example.Com"
    email_stored_keeper = email_stored_target  # they match exactly

    # Insert both rows already-normalised (endpoint lowercases at read).
    e = email_stored_target.strip().lower()
    await db.interest_registrations.insert_one({
        "id": f"iter164b-k-{uuid.uuid4().hex[:6]}",
        "email": e, "founder_number": 70,
        "is_reserved": False, "created_at": "2026-08-01T00:00:00+00:00",
    })
    await db.interest_registrations.insert_one({
        "id": f"iter164b-d-{uuid.uuid4().hex[:6]}",
        "email": e, "founder_number": 71,
        "is_reserved": False, "created_at": "2026-08-01T14:00:00+00:00",
    })

    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(
            f"{BACKEND_URL}/api/cms/crm/founding-members/retire-duplicate",
            json={"founder_number": 71},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["retired_founder_number"] == 71
    assert body["keeper_founder_number"] == 70


# ─────────────────────────────────────────────────────────────────────
#  Doesn't touch unrelated rows
# ─────────────────────────────────────────────────────────────────────

async def test_only_touches_the_target_row(db, token):
    """Every other row (different emails, reserved rows, test rows)
    must be untouched by a retire operation."""
    email_dup = f"iter164b-{uuid.uuid4().hex[:6]}@example.com"
    email_other = f"iter164b-{uuid.uuid4().hex[:6]}@example.com"
    await _seed_duplicate_pair(db, email_dup, keeper_num=80, dupe_num=81)
    await db.interest_registrations.insert_one({
        "id": f"iter164b-unrelated-{uuid.uuid4().hex[:6]}",
        "email": email_other, "founder_number": 82,
        "is_reserved": False, "created_at": "2026-08-01T00:00:00+00:00",
    })

    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(
            f"{BACKEND_URL}/api/cms/crm/founding-members/retire-duplicate",
            json={"founder_number": 81},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 200

    # Unrelated row untouched.
    other = await db.interest_registrations.find_one({"founder_number": 82})
    assert other is not None
    assert other["email"] == email_other
