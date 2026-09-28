"""Regression tests for the SEC-001 / SEC-002 authorization hardening
(Security Audit, 27 Sep 2026).

SEC-001: unauthenticated / cross-user account takeover via profile-email change.
SEC-002: client-supplied user_id trusted as identity on write endpoints.

Runs against the live local backend (http://localhost:8001) which the test
harness already has running. Uses the seeded demo accounts maggie (is_admin)
and frankie (non-admin), plus a throwaway password account it creates and
deletes. No production data is touched.
"""
import os
import uuid
import httpx
import pytest

BASE = "http://localhost:8001/api"
pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


async def _demo_login(client, username):
    r = await client.post(f"{BASE}/auth/demo-login", json={"username": username})
    r.raise_for_status()
    d = r.json()
    return d["access_token"], d["user"]["id"]


async def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture
async def clients():
    async with httpx.AsyncClient(timeout=20) as client:
        yield client


async def test_unauthenticated_profile_write_blocked(clients):
    # SEC-001 core: no token at all must be rejected (was a 200 takeover path).
    r = await clients.patch(f"{BASE}/users/{uuid.uuid4()}/profile", json={"bio": "x"})
    assert r.status_code == 401


async def test_non_admin_cannot_write_other_users(clients):
    # SEC-002: frankie (non-admin) must not touch maggie's account.
    ftok, _ = await _demo_login(clients, "frankie")
    _, mid = await _demo_login(clients, "maggie")
    h = await _auth(ftok)
    for method, path, body in [
        ("patch", f"/users/{mid}/profile", {"bio": "hacked"}),
        ("post", f"/users/{mid}/location", {"suburb": "Nowhere"}),
        ("post", f"/users/{mid}/status", {"status": "busy"}),
        ("patch", f"/users/{mid}/privacy", {"privacy": "invisible"}),
    ]:
        r = await getattr(clients, method)(f"{BASE}{path}", json=body, headers=h)
        assert r.status_code == 403, f"{path} expected 403, got {r.status_code}"


async def test_owner_can_write_own_account(clients):
    ftok, fid = await _demo_login(clients, "frankie")
    h = await _auth(ftok)
    r = await clients.patch(f"{BASE}/users/{fid}/profile", json={"bio": "legit"}, headers=h)
    assert r.status_code == 200
    r = await clients.post(f"{BASE}/users/{fid}/status", json={"status": "busy"}, headers=h)
    assert r.status_code == 200


async def test_admin_can_write_other_accounts(clients):
    # Legitimate admin access must be preserved.
    mtok, _ = await _demo_login(clients, "maggie")
    _, fid = await _demo_login(clients, "frankie")
    r = await clients.patch(f"{BASE}/users/{fid}/profile", json={"bio": "admin-set"},
                            headers=await _auth(mtok))
    assert r.status_code == 200


async def test_email_change_requires_current_password(clients):
    # SEC-001 step-up: a password account must re-auth to change its email.
    rnd = uuid.uuid4().hex[:8]
    su = await clients.post(f"{BASE}/auth/signup", json={
        "username": f"sectest{rnd}", "password": "OrigPass123",
        "email": f"sectest{rnd}@example.com",
    })
    su.raise_for_status()
    tok = su.json()["access_token"]
    uid = su.json()["user"]["id"]
    h = await _auth(tok)
    try:
        # no password -> 401
        r = await clients.patch(f"{BASE}/users/{uid}/profile",
                                json={"email": f"changed{rnd}@example.com"}, headers=h)
        assert r.status_code == 401
        # wrong password -> 401
        r = await clients.patch(f"{BASE}/users/{uid}/profile",
                                json={"email": f"changed{rnd}@example.com", "current_password": "nope"}, headers=h)
        assert r.status_code == 401
        # correct password -> 200
        r = await clients.patch(f"{BASE}/users/{uid}/profile",
                                json={"email": f"changed{rnd}@example.com", "current_password": "OrigPass123"}, headers=h)
        assert r.status_code == 200
        # non-email edit needs no password -> 200
        r = await clients.patch(f"{BASE}/users/{uid}/profile", json={"bio": "hi"}, headers=h)
        assert r.status_code == 200
    finally:
        from motor.motor_asyncio import AsyncIOMotorClient
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = c[os.environ.get("DB_NAME", "test_database")]
        await db.users.delete_one({"id": uid})
        await db.founder_email_claims.delete_many({"_id": {"$regex": "sectest"}})


async def test_notice_delete_requires_ownership(clients):
    # SEC-002: create a notice as frankie, ensure the stored author is frankie
    # (spoofed user_id ignored) and a different non-admin can't delete it.
    ftok, fid = await _demo_login(clients, "frankie")
    # spoof a different user_id in the body — server must override with JWT id.
    r = await clients.post(f"{BASE}/notices", json={
        "user_id": "SPOOFED-ATTACKER-ID", "title": "Sec test notice", "body": "hello",
        "category": "Announcement",
    }, headers=await _auth(ftok))
    assert r.status_code == 200, r.text
    notice = r.json()
    nid = notice.get("id")
    assert notice.get("user_id") == fid, "author must be the JWT owner, not the spoofed id"
    try:
        # A DIFFERENT non-admin (create a throwaway) must not delete it.
        rnd = uuid.uuid4().hex[:8]
        su = await clients.post(f"{BASE}/auth/signup", json={
            "username": f"secdel{rnd}", "password": "OrigPass123", "email": f"secdel{rnd}@example.com"})
        su.raise_for_status()
        atk_tok = su.json()["access_token"]
        atk_id = su.json()["user"]["id"]
        r = await clients.delete(f"{BASE}/notices/{nid}?user_id={fid}", headers=await _auth(atk_tok))
        assert r.status_code == 403, f"non-owner delete expected 403, got {r.status_code}"
        # owner can delete
        r = await clients.delete(f"{BASE}/notices/{nid}?user_id={fid}", headers=await _auth(ftok))
        assert r.status_code == 200
    finally:
        from motor.motor_asyncio import AsyncIOMotorClient
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = c[os.environ.get("DB_NAME", "test_database")]
        await db.notices.delete_one({"id": nid})
        await db.users.delete_many({"username": {"$regex": "^secdel"}})
        await db.founder_email_claims.delete_many({"_id": {"$regex": "secdel"}})
