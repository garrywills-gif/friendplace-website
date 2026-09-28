"""Iteration 200 — independent verification for SEC-001 / SEC-002 fix
and probe for any MISSED endpoints that still trust a client-supplied
user_id for identity on WRITE operations.

Scope per the review request:
  * Confirm every explicitly-listed endpoint (profile / location / status /
    privacy / notices / groups / step-up email) enforces JWT current_user
    + ownership / admin as advertised.
  * Probe additional /users/{user_id}/* + /friends /notifications /events
    /notices /tables write endpoints for silent identity-spoof gaps.
    Read endpoints and /api/admin/* (already SEC-004 gated) are out of scope.

Uses the seeded demo accounts + throwaway signups; cleans up after itself.
"""
import os
import uuid
import pytest
import httpx
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

BASE = "http://localhost:8001/api"
pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    async with httpx.AsyncClient(timeout=20) as c:
        yield c


async def _demo_login(client, username):
    r = await client.post(f"{BASE}/auth/demo-login", json={"username": username})
    r.raise_for_status()
    d = r.json()
    return d["access_token"], d["user"]["id"], d["user"]


def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


async def _signup(client, prefix="probe"):
    rnd = uuid.uuid4().hex[:8]
    r = await client.post(f"{BASE}/auth/signup", json={
        "username": f"{prefix}{rnd}",
        "password": "OrigPass123",
        "email": f"{prefix}{rnd}@example.com",
    })
    r.raise_for_status()
    d = r.json()
    return d["access_token"], d["user"]["id"], d["user"]["username"], rnd


async def _cleanup_users(prefixes):
    load_dotenv("/app/backend/.env")
    mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = mongo[os.environ.get("DB_NAME", "test_database")]
    for p in prefixes:
        await db.users.delete_many({"username": {"$regex": f"^{p}"}})
        await db.founder_email_claims.delete_many({"_id": {"$regex": p}})
    mongo.close()


# ------------------------------------------------------------------
# Explicit endpoints listed in the review request
# ------------------------------------------------------------------

async def test_scoped_endpoints_all_reject_cross_user(client):
    """SEC-002 core: PATCH /profile, POST /location, POST /status,
    PATCH /privacy must all 403 for a non-admin acting on another user."""
    ftok, _, _ = await _demo_login(client, "frankie")
    _, mid, _ = await _demo_login(client, "maggie")
    h = _auth(ftok)
    endpoints = [
        ("patch", f"/users/{mid}/profile", {"bio": "hi"}),
        ("post",  f"/users/{mid}/location", {"suburb": "Nowhere"}),
        ("post",  f"/users/{mid}/status", {"status": "busy"}),
        ("patch", f"/users/{mid}/privacy", {"privacy": "invisible"}),
    ]
    for method, path, body in endpoints:
        r = await getattr(client, method)(f"{BASE}{path}", json=body, headers=h)
        assert r.status_code == 403, f"{method.upper()} {path} expected 403, got {r.status_code}: {r.text}"


async def test_scoped_endpoints_reject_unauth(client):
    """SEC-001: every scoped write must 401 without a bearer token."""
    fake = uuid.uuid4().hex
    endpoints = [
        ("patch", f"/users/{fake}/profile", {"bio": "x"}),
        ("post",  f"/users/{fake}/location", {"suburb": "x"}),
        ("post",  f"/users/{fake}/status", {"status": "busy"}),
        ("patch", f"/users/{fake}/privacy", {"privacy": "invisible"}),
    ]
    for method, path, body in endpoints:
        r = await getattr(client, method)(f"{BASE}{path}", json=body)
        assert r.status_code == 401, f"{method.upper()} {path} without auth expected 401, got {r.status_code}"


async def test_admin_maggie_can_cross_write(client):
    mtok, _, _ = await _demo_login(client, "maggie")
    _, fid, _ = await _demo_login(client, "frankie")
    h = _auth(mtok)
    r = await client.patch(f"{BASE}/users/{fid}/profile", json={"bio": "admin-set"}, headers=h)
    assert r.status_code == 200
    r = await client.post(f"{BASE}/users/{fid}/status", json={"status": "busy"}, headers=h)
    assert r.status_code == 200
    r = await client.patch(f"{BASE}/users/{fid}/privacy", json={"privacy": "everyone"}, headers=h)
    assert r.status_code == 200


async def test_owner_can_write_own(client):
    ftok, fid, _ = await _demo_login(client, "frankie")
    h = _auth(ftok)
    r = await client.patch(f"{BASE}/users/{fid}/profile", json={"bio": "hello"}, headers=h)
    assert r.status_code == 200
    r = await client.post(f"{BASE}/users/{fid}/location", json={"suburb": "Testville"}, headers=h)
    assert r.status_code == 200


# ------------------------------------------------------------------
# SEC-001 step-up: email change re-auth
# ------------------------------------------------------------------

async def test_email_change_stepup_full_matrix(client):
    """no pw -> 401, wrong pw -> 401, correct pw -> 200, non-email edit -> 200."""
    tok, uid, _, rnd = await _signup(client, prefix="stepup")
    h = _auth(tok)
    try:
        new_email = f"changed{rnd}@example.com"
        # No password
        r = await client.patch(f"{BASE}/users/{uid}/profile",
                               json={"email": new_email}, headers=h)
        assert r.status_code == 401, r.text
        # Wrong password
        r = await client.patch(f"{BASE}/users/{uid}/profile",
                               json={"email": new_email, "current_password": "wrong123"},
                               headers=h)
        assert r.status_code == 401, r.text
        # Correct password
        r = await client.patch(f"{BASE}/users/{uid}/profile",
                               json={"email": new_email, "current_password": "OrigPass123"},
                               headers=h)
        assert r.status_code == 200, r.text
        assert r.json()["user"]["email"] == new_email
        # Non-email profile edit — no password required
        r = await client.patch(f"{BASE}/users/{uid}/profile",
                               json={"bio": "no-pw needed"}, headers=h)
        assert r.status_code == 200, r.text
    finally:
        await _cleanup_users(["stepup"])


async def test_admin_email_change_does_not_require_target_password(client):
    """An admin editing another user's email must NOT need their password."""
    tok, uid, _, rnd = await _signup(client, prefix="adminmail")
    mtok, _, _ = await _demo_login(client, "maggie")
    try:
        new_email = f"admin-changed{rnd}@example.com"
        r = await client.patch(f"{BASE}/users/{uid}/profile",
                               json={"email": new_email}, headers=_auth(mtok))
        assert r.status_code == 200, r.text
        assert r.json()["user"]["email"] == new_email
    finally:
        await _cleanup_users(["adminmail"])


# ------------------------------------------------------------------
# Notices + groups (write-side identity)
# ------------------------------------------------------------------

async def test_notice_author_overridden_from_jwt(client):
    ftok, fid, _ = await _demo_login(client, "frankie")
    _, mid, _ = await _demo_login(client, "maggie")
    r = await client.post(f"{BASE}/notices", json={
        "user_id": mid,  # spoof — must be ignored
        "title": "PROP_probe200",  # PROP_ prefix keeps it out of live counts
        "body": "hello",
        "category": "Announcement",
    }, headers=_auth(ftok))
    assert r.status_code == 200, r.text
    nid = r.json()["id"]
    try:
        assert r.json()["user_id"] == fid, "JWT owner must overwrite spoofed body user_id"
        # Non-owner attacker cannot edit or delete.
        atk_tok, atk_id, _, _ = await _signup(client, prefix="atk")
        r = await client.patch(f"{BASE}/notices/{nid}", json={"title": "hacked"},
                               headers=_auth(atk_tok))
        assert r.status_code == 403
        r = await client.delete(f"{BASE}/notices/{nid}?user_id={fid}",
                                headers=_auth(atk_tok))
        assert r.status_code == 403
        # Owner can edit + delete
        r = await client.patch(f"{BASE}/notices/{nid}", json={"title": "PROP_updated"},
                               headers=_auth(ftok))
        assert r.status_code == 200
        r = await client.delete(f"{BASE}/notices/{nid}?user_id={fid}",
                                headers=_auth(ftok))
        assert r.status_code == 200
    finally:
        load_dotenv("/app/backend/.env")
        mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = mongo[os.environ.get("DB_NAME", "test_database")]
        await db.notices.delete_one({"id": nid})
        mongo.close()
        await _cleanup_users(["atk"])


async def test_group_join_rejects_spoofed_uid(client):
    ftok, fid, _ = await _demo_login(client, "frankie")
    _, mid, _ = await _demo_login(client, "maggie")
    # Pick any existing group id — grab first from /groups
    r = await client.get(f"{BASE}/groups")
    r.raise_for_status()
    groups = r.json()
    if not groups:
        pytest.skip("No groups available in this env")
    gid = groups[0]["id"]
    # Attempt to join AS maggie while authed as frankie
    r = await client.post(f"{BASE}/groups/{gid}/join/{mid}", headers=_auth(ftok))
    assert r.status_code == 403, r.text
    # Joining as self is fine
    r = await client.post(f"{BASE}/groups/{gid}/join/{fid}", headers=_auth(ftok))
    assert r.status_code == 200


async def test_group_post_and_comment_author_from_jwt(client):
    ftok, fid, fu = await _demo_login(client, "frankie")
    _, mid, _ = await _demo_login(client, "maggie")
    r = await client.get(f"{BASE}/groups")
    r.raise_for_status()
    groups = r.json()
    if not groups:
        pytest.skip("No groups")
    gid = groups[0]["id"]
    r = await client.post(f"{BASE}/groups/{gid}/posts", json={
        "user_id": mid,  # spoof
        "user_name": "spoofed",
        "text": "PROP_probe200 group post",
        "group_id": gid,
    }, headers=_auth(ftok))
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    try:
        assert r.json()["user_id"] == fid
        r = await client.post(f"{BASE}/groups/posts/{pid}/comment", json={
            "user_id": mid,  # spoof again
            "user_name": "spoofed-cmt",
            "text": "PROP_hi",
        }, headers=_auth(ftok))
        assert r.status_code == 200, r.text
        assert r.json()["user_id"] == fid, "comment author must come from JWT"
    finally:
        load_dotenv("/app/backend/.env")
        mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = mongo[os.environ.get("DB_NAME", "test_database")]
        await db.group_posts.delete_one({"id": pid})
        mongo.close()


# ------------------------------------------------------------------
# MISSED-endpoint probes (identity spoof on other /users/{user_id}/*
# write routes). These are informational — a 200 flags a gap that
# the main agent should decide about.
# ------------------------------------------------------------------

@pytest.mark.parametrize("path,body", [
    ("/users/{mid}/privacy-settings",       {"profile_visibility": "friends"}),
    ("/users/{mid}/preferences",            {"nearby_chat_alerts": False}),
    ("/users/{mid}/birthday-visibility",    {"visibility": "off"}),
    ("/users/{mid}/onboarding-complete",    {}),
    ("/users/{mid}/heartbeat",              {}),
])
async def test_probe_other_user_scoped_writes(client, path, body):
    """Probe: can frankie mutate maggie via other /users/{id}/* writes?
    A 200 from any of these means the endpoint still trusts the path-supplied
    user_id and belongs in the SEC-002 hardening pass. A 401/403 means it's
    already guarded (either via current_user + ownership, or auth-required)."""
    ftok, _, _ = await _demo_login(client, "frankie")
    _, mid, _ = await _demo_login(client, "maggie")
    method = "patch" if "privacy-settings" in path or "preferences" in path else "post"
    fullpath = path.format(mid=mid)
    r = await getattr(client, method)(f"{BASE}{fullpath}", json=body, headers=_auth(ftok))
    # Record BOTH the status and whether it was allowed for the report.
    print(f"PROBE {method.upper()} {fullpath} -> {r.status_code}")
    # We don't hard-assert here — the test always passes and the print
    # output is what carries the signal for the report.


@pytest.mark.parametrize("path", [
    "/notifications/{mid}/read-all",
    "/notifications/{mid}/clear-read",
])
async def test_probe_notifications_cross_user(client, path):
    ftok, _, _ = await _demo_login(client, "frankie")
    _, mid, _ = await _demo_login(client, "maggie")
    r = await client.post(f"{BASE}{path.format(mid=mid)}", headers=_auth(ftok))
    print(f"PROBE POST {path.format(mid=mid)} -> {r.status_code}")


async def test_probe_block_unblock_and_friend_removal(client):
    ftok, fid, _ = await _demo_login(client, "frankie")
    _, mid, _ = await _demo_login(client, "maggie")
    _, dot_id, _ = await _demo_login(client, "dot")
    # Attempt: frankie makes maggie block dot
    r = await client.post(f"{BASE}/users/{mid}/block/{dot_id}", headers=_auth(ftok))
    print(f"PROBE POST /users/{mid}/block/{dot_id} (attacker=frankie) -> {r.status_code}")
    r2 = await client.post(f"{BASE}/users/{mid}/unblock/{dot_id}", headers=_auth(ftok))
    print(f"PROBE POST /users/{mid}/unblock/{dot_id} (attacker=frankie) -> {r2.status_code}")
    r3 = await client.delete(f"{BASE}/friends/{mid}/{dot_id}", headers=_auth(ftok))
    print(f"PROBE DELETE /friends/{mid}/{dot_id} (attacker=frankie) -> {r3.status_code}")


async def test_probe_notice_reactions_and_solve_report_cross_user(client):
    """Probe: can frankie react/like/solve/report a notice AS maggie?"""
    ftok, fid, _ = await _demo_login(client, "frankie")
    _, mid, _ = await _demo_login(client, "maggie")
    # Create a notice as maggie (authenticated) so it truly belongs to her.
    mtok, _, _ = await _demo_login(client, "maggie")
    r = await client.post(f"{BASE}/notices", json={
        "user_id": mid,  # required by Notice model; JWT owner still overrides
        "title": "PROP_probe200_reactions", "body": "x", "category": "Announcement",
    }, headers=_auth(mtok))
    assert r.status_code == 200
    nid = r.json()["id"]
    try:
        r = await client.post(f"{BASE}/notices/{nid}/react/{mid}",
                              json={"reaction": "well_done"}, headers=_auth(ftok))
        print(f"PROBE POST /notices/{nid}/react/{mid} (attacker=frankie) -> {r.status_code}")
        r = await client.post(f"{BASE}/notices/{nid}/like/{mid}", headers=_auth(ftok))
        print(f"PROBE POST /notices/{nid}/like/{mid} (attacker=frankie) -> {r.status_code}")
        r = await client.post(f"{BASE}/notices/{nid}/report/{mid}",
                              json={"reason": "spam"}, headers=_auth(ftok))
        print(f"PROBE POST /notices/{nid}/report/{mid} (attacker=frankie) -> {r.status_code}")
    finally:
        load_dotenv("/app/backend/.env")
        mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = mongo[os.environ.get("DB_NAME", "test_database")]
        await db.notices.delete_one({"id": nid})
        mongo.close()


async def test_probe_events_rsvp_cross_user(client):
    """Probe: can frankie RSVP AS maggie for an existing event?"""
    ftok, fid, _ = await _demo_login(client, "frankie")
    _, mid, _ = await _demo_login(client, "maggie")
    r = await client.get(f"{BASE}/events")
    if r.status_code != 200 or not r.json():
        pytest.skip("No events")
    eid = r.json()[0]["id"]
    r = await client.post(f"{BASE}/events/{eid}/rsvp/{mid}",
                          json={"response": "going"}, headers=_auth(ftok))
    print(f"PROBE POST /events/{eid}/rsvp/{mid} (attacker=frankie) -> {r.status_code}")
    r = await client.post(f"{BASE}/events/{eid}/unrsvp/{mid}", headers=_auth(ftok))
    print(f"PROBE POST /events/{eid}/unrsvp/{mid} (attacker=frankie) -> {r.status_code}")


# ------------------------------------------------------------------
# Regression: legitimate auth flows still work
# ------------------------------------------------------------------

async def test_demo_login_and_me_still_work(client):
    tok, uid, _ = await _demo_login(client, "frankie")
    r = await client.get(f"{BASE}/auth/me", headers=_auth(tok))
    assert r.status_code == 200
    assert r.json()["id"] == uid


async def test_signup_and_login_and_own_profile_edit(client):
    tok, uid, uname, rnd = await _signup(client, prefix="regr")
    try:
        # Own profile edit succeeds without a password (non-email).
        r = await client.patch(f"{BASE}/users/{uid}/profile",
                               json={"bio": "yay"}, headers=_auth(tok))
        assert r.status_code == 200
        # Login by username also works.
        r = await client.post(f"{BASE}/auth/login", json={
            "username": uname, "password": "OrigPass123",
        })
        assert r.status_code == 200, r.text
    finally:
        await _cleanup_users(["regr"])
