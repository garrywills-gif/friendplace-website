"""Iteration 201 — Re-verify SEC-002 hardening on the FULL list of write
endpoints that previously trusted client-supplied user_id for identity.

Review request scope:
  * NEGATIVE  — frankie (non-admin) acting on maggie must return 403.
  * SELF      — frankie acting on frankie must return 200 (legitimate flow).
  * ADMIN     — maggie (is_admin) acting on frankie must return 200.
  * REGRESSION — originally-fixed endpoints (profile/location/status/privacy,
                 notices create/edit/delete, groups join/post/comment,
                 email step-up) must still pass.
  * SWEEP     — probe remaining suspect write endpoints for identity-spoof.
"""
import os
import uuid
import httpx
import pytest
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


async def _signup(client, prefix="sec201"):
    rnd = uuid.uuid4().hex[:8]
    r = await client.post(f"{BASE}/auth/signup", json={
        "username": f"{prefix}{rnd}",
        "password": "OrigPass123",
        "email": f"{prefix}{rnd}@example.com",
    })
    r.raise_for_status()
    d = r.json()
    return d["access_token"], d["user"]["id"], d["user"]["username"], rnd


async def _cleanup(prefixes):
    load_dotenv("/app/backend/.env")
    mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = mongo[os.environ.get("DB_NAME", "test_database")]
    for p in prefixes:
        await db.users.delete_many({"username": {"$regex": f"^{p}"}})
        await db.founder_email_claims.delete_many({"_id": {"$regex": p}})
    mongo.close()


# ---------- The 11 additional SEC-002 endpoints (path-target = another user)
# For each: (method, path_template, body, needs_seed_notice_or_event)
# We build these in a helper so they can be exercised in all 3 modes.

def _user_scoped_specs(target_id):
    return [
        ("patch", f"/users/{target_id}/privacy-settings", {"profile_visibility": "friends"}),
        ("patch", f"/users/{target_id}/preferences",       {"nearby_chat_alerts": False}),
        ("post",  f"/users/{target_id}/onboarding-complete", {}),
        ("post",  f"/users/{target_id}/heartbeat",           {}),
        ("post",  f"/users/{target_id}/birthday-visibility", {"visibility": "off"}),
        ("post",  f"/notifications/{target_id}/read-all",    {}),
        ("post",  f"/notifications/{target_id}/clear-read",  {}),
    ]


# ------------------------------------------------------------------
# NEGATIVE: frankie -> maggie must be 403 for every listed endpoint
# ------------------------------------------------------------------

async def test_frankie_vs_maggie_user_scoped_writes_403(client):
    ftok, _, _ = await _demo_login(client, "frankie")
    _, mid, _ = await _demo_login(client, "maggie")
    h = _auth(ftok)
    failures = []
    for method, path, body in _user_scoped_specs(mid):
        r = await getattr(client, method)(f"{BASE}{path}", json=body, headers=h)
        if r.status_code != 403:
            failures.append(f"{method.upper()} {path} -> {r.status_code} (expected 403)")
    assert not failures, "SEC-002 STILL EXPLOITABLE:\n" + "\n".join(failures)


async def test_frankie_block_unblock_maggie_403(client):
    ftok, _, _ = await _demo_login(client, "frankie")
    _, mid, _ = await _demo_login(client, "maggie")
    _, dot_id, _ = await _demo_login(client, "dot")
    h = _auth(ftok)
    r = await client.post(f"{BASE}/users/{mid}/block/{dot_id}", headers=h)
    assert r.status_code == 403, f"block -> {r.status_code}: {r.text}"
    r = await client.post(f"{BASE}/users/{mid}/unblock/{dot_id}", headers=h)
    assert r.status_code == 403, f"unblock -> {r.status_code}: {r.text}"


async def test_frankie_remove_maggies_friend_403(client):
    ftok, _, _ = await _demo_login(client, "frankie")
    _, mid, _ = await _demo_login(client, "maggie")
    _, dot_id, _ = await _demo_login(client, "dot")
    r = await client.delete(f"{BASE}/friends/{mid}/{dot_id}", headers=_auth(ftok))
    assert r.status_code == 403, f"remove-friend -> {r.status_code}: {r.text}"


async def test_frankie_cross_user_event_rsvp_403(client):
    ftok, _, _ = await _demo_login(client, "frankie")
    _, mid, _ = await _demo_login(client, "maggie")
    r = await client.get(f"{BASE}/events")
    if r.status_code != 200 or not r.json():
        pytest.skip("No events available")
    eid = r.json()[0]["id"]
    r = await client.post(f"{BASE}/events/{eid}/rsvp/{mid}",
                          json={"response": "going"}, headers=_auth(ftok))
    assert r.status_code == 403, f"rsvp -> {r.status_code}: {r.text}"
    r = await client.post(f"{BASE}/events/{eid}/unrsvp/{mid}", headers=_auth(ftok))
    assert r.status_code == 403, f"unrsvp -> {r.status_code}: {r.text}"


async def test_frankie_cross_user_notice_actions_403(client):
    ftok, _, _ = await _demo_login(client, "frankie")
    mtok, mid, _ = await _demo_login(client, "maggie")
    # Create notice as maggie herself
    r = await client.post(f"{BASE}/notices", json={
        "user_id": mid, "title": "PROP_iter201_reactions",
        "body": "x", "category": "Announcement",
    }, headers=_auth(mtok))
    assert r.status_code == 200
    nid = r.json()["id"]
    try:
        # frankie tries to react/like/report AS maggie
        r = await client.post(f"{BASE}/notices/{nid}/react/{mid}",
                              json={"reaction": "well_done"}, headers=_auth(ftok))
        assert r.status_code == 403, f"react -> {r.status_code}: {r.text}"
        r = await client.post(f"{BASE}/notices/{nid}/like/{mid}", headers=_auth(ftok))
        assert r.status_code == 403, f"like -> {r.status_code}: {r.text}"
        r = await client.post(f"{BASE}/notices/{nid}/report/{mid}",
                              json={"reason": "spam"}, headers=_auth(ftok))
        assert r.status_code == 403, f"report -> {r.status_code}: {r.text}"
    finally:
        load_dotenv("/app/backend/.env")
        mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = mongo[os.environ.get("DB_NAME", "test_database")]
        await db.notices.delete_one({"id": nid})
        mongo.close()


# ------------------------------------------------------------------
# SELF: frankie -> frankie must be 200
# ------------------------------------------------------------------

async def test_frankie_own_user_scoped_writes_200(client):
    ftok, fid, _ = await _demo_login(client, "frankie")
    h = _auth(ftok)
    failures = []
    for method, path, body in _user_scoped_specs(fid):
        r = await getattr(client, method)(f"{BASE}{path}", json=body, headers=h)
        if r.status_code != 200:
            failures.append(f"{method.upper()} {path} -> {r.status_code}: {r.text[:120]}")
    assert not failures, "Legitimate self-write broken:\n" + "\n".join(failures)


async def test_frankie_self_block_unblock_200(client):
    ftok, fid, _ = await _demo_login(client, "frankie")
    _, dot_id, _ = await _demo_login(client, "dot")
    h = _auth(ftok)
    # block dot, then unblock — frankie acting on frankie's own list.
    r = await client.post(f"{BASE}/users/{fid}/block/{dot_id}", headers=h)
    assert r.status_code == 200, f"self-block -> {r.status_code}: {r.text}"
    r = await client.post(f"{BASE}/users/{fid}/unblock/{dot_id}", headers=h)
    assert r.status_code == 200, f"self-unblock -> {r.status_code}: {r.text}"


async def test_frankie_self_rsvp_unrsvp_200(client):
    ftok, fid, _ = await _demo_login(client, "frankie")
    r = await client.get(f"{BASE}/events")
    if r.status_code != 200 or not r.json():
        pytest.skip("No events")
    eid = r.json()[0]["id"]
    r = await client.post(f"{BASE}/events/{eid}/rsvp/{fid}",
                          json={"response": "going"}, headers=_auth(ftok))
    assert r.status_code == 200, f"self-rsvp -> {r.status_code}: {r.text}"
    r = await client.post(f"{BASE}/events/{eid}/unrsvp/{fid}", headers=_auth(ftok))
    assert r.status_code == 200, f"self-unrsvp -> {r.status_code}: {r.text}"


async def test_frankie_self_notice_react_like_report_200(client):
    """Owner reacting/liking/reporting their own notice should succeed
    (auth passes; even if backend blocks self-report at business layer,
    the AUTHZ guard must not return 403)."""
    ftok, fid, _ = await _demo_login(client, "frankie")
    # Create a notice as frankie
    r = await client.post(f"{BASE}/notices", json={
        "user_id": fid, "title": "PROP_iter201_self",
        "body": "x", "category": "Announcement",
    }, headers=_auth(ftok))
    assert r.status_code == 200
    nid = r.json()["id"]
    try:
        r = await client.post(f"{BASE}/notices/{nid}/react/{fid}",
                              json={"reaction": "well_done"}, headers=_auth(ftok))
        assert r.status_code == 200, f"self-react -> {r.status_code}: {r.text}"
        r = await client.post(f"{BASE}/notices/{nid}/like/{fid}", headers=_auth(ftok))
        assert r.status_code == 200, f"self-like -> {r.status_code}: {r.text}"
        # /report may be business-rejected on self, but authz must pass (not 403)
        r = await client.post(f"{BASE}/notices/{nid}/report/{fid}",
                              json={"reason": "spam"}, headers=_auth(ftok))
        assert r.status_code in (200, 400), \
            f"self-report authz should pass; got {r.status_code}: {r.text}"
    finally:
        load_dotenv("/app/backend/.env")
        mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = mongo[os.environ.get("DB_NAME", "test_database")]
        await db.notices.delete_one({"id": nid})
        mongo.close()


# ------------------------------------------------------------------
# ADMIN: maggie (is_admin) -> frankie must be 200
# ------------------------------------------------------------------

async def test_admin_cross_user_scoped_writes_200(client):
    mtok, _, _ = await _demo_login(client, "maggie")
    _, fid, _ = await _demo_login(client, "frankie")
    h = _auth(mtok)
    failures = []
    for method, path, body in _user_scoped_specs(fid):
        r = await getattr(client, method)(f"{BASE}{path}", json=body, headers=h)
        if r.status_code != 200:
            failures.append(f"{method.upper()} {path} -> {r.status_code}: {r.text[:120]}")
    assert not failures, "Admin cross-user write broken:\n" + "\n".join(failures)


async def test_admin_cross_user_block_unblock_200(client):
    mtok, _, _ = await _demo_login(client, "maggie")
    _, fid, _ = await _demo_login(client, "frankie")
    _, dot_id, _ = await _demo_login(client, "dot")
    h = _auth(mtok)
    r = await client.post(f"{BASE}/users/{fid}/block/{dot_id}", headers=h)
    assert r.status_code == 200, r.text
    r = await client.post(f"{BASE}/users/{fid}/unblock/{dot_id}", headers=h)
    assert r.status_code == 200, r.text


async def test_admin_cross_user_rsvp_200(client):
    mtok, _, _ = await _demo_login(client, "maggie")
    _, fid, _ = await _demo_login(client, "frankie")
    r = await client.get(f"{BASE}/events")
    if r.status_code != 200 or not r.json():
        pytest.skip("No events")
    eid = r.json()[0]["id"]
    r = await client.post(f"{BASE}/events/{eid}/rsvp/{fid}",
                          json={"response": "going"}, headers=_auth(mtok))
    assert r.status_code == 200, r.text
    r = await client.post(f"{BASE}/events/{eid}/unrsvp/{fid}", headers=_auth(mtok))
    assert r.status_code == 200, r.text


# ------------------------------------------------------------------
# REGRESSION: iteration_200 fixes still hold
# ------------------------------------------------------------------

async def test_regr_profile_location_status_privacy_frankie_vs_maggie_403(client):
    ftok, _, _ = await _demo_login(client, "frankie")
    _, mid, _ = await _demo_login(client, "maggie")
    h = _auth(ftok)
    for method, path, body in [
        ("patch", f"/users/{mid}/profile",  {"bio": "hi"}),
        ("post",  f"/users/{mid}/location", {"suburb": "Nowhere"}),
        ("post",  f"/users/{mid}/status",   {"status": "busy"}),
        ("patch", f"/users/{mid}/privacy",  {"privacy": "invisible"}),
    ]:
        r = await getattr(client, method)(f"{BASE}{path}", json=body, headers=h)
        assert r.status_code == 403, f"{method.upper()} {path} -> {r.status_code}"


async def test_regr_unauth_profile_401(client):
    r = await client.patch(f"{BASE}/users/{uuid.uuid4()}/profile", json={"bio": "x"})
    assert r.status_code == 401


async def test_regr_email_stepup_matrix(client):
    tok, uid, _, rnd = await _signup(client, prefix="stepr201")
    h = _auth(tok)
    try:
        # no pw
        r = await client.patch(f"{BASE}/users/{uid}/profile",
                               json={"email": f"n{rnd}@ex.com"}, headers=h)
        assert r.status_code == 401
        # wrong pw
        r = await client.patch(f"{BASE}/users/{uid}/profile",
                               json={"email": f"n{rnd}@ex.com", "current_password": "wrong"},
                               headers=h)
        assert r.status_code == 401
        # correct pw
        r = await client.patch(f"{BASE}/users/{uid}/profile",
                               json={"email": f"n{rnd}@ex.com", "current_password": "OrigPass123"},
                               headers=h)
        assert r.status_code == 200
        # non-email edit — no pw needed
        r = await client.patch(f"{BASE}/users/{uid}/profile",
                               json={"bio": "no-pw"}, headers=h)
        assert r.status_code == 200
    finally:
        await _cleanup(["stepr201"])


async def test_regr_notice_jwt_author_and_owner_only_delete(client):
    ftok, fid, _ = await _demo_login(client, "frankie")
    _, mid, _ = await _demo_login(client, "maggie")
    r = await client.post(f"{BASE}/notices", json={
        "user_id": mid,  # spoof
        "title": "PROP_iter201_regr", "body": "x", "category": "Announcement",
    }, headers=_auth(ftok))
    assert r.status_code == 200
    nid = r.json()["id"]
    assert r.json()["user_id"] == fid
    try:
        # Non-owner cannot edit or delete
        atk_tok, _, _, _ = await _signup(client, prefix="atk201")
        r = await client.patch(f"{BASE}/notices/{nid}",
                               json={"title": "hacked"}, headers=_auth(atk_tok))
        assert r.status_code == 403
        r = await client.delete(f"{BASE}/notices/{nid}?user_id={fid}",
                                headers=_auth(atk_tok))
        assert r.status_code == 403
        # Owner can delete
        r = await client.delete(f"{BASE}/notices/{nid}?user_id={fid}",
                                headers=_auth(ftok))
        assert r.status_code == 200
    finally:
        load_dotenv("/app/backend/.env")
        mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = mongo[os.environ.get("DB_NAME", "test_database")]
        await db.notices.delete_one({"id": nid})
        mongo.close()
        await _cleanup(["atk201"])


async def test_regr_group_join_and_post_jwt_author(client):
    ftok, fid, _ = await _demo_login(client, "frankie")
    _, mid, _ = await _demo_login(client, "maggie")
    r = await client.get(f"{BASE}/groups")
    r.raise_for_status()
    if not r.json():
        pytest.skip("No groups")
    gid = r.json()[0]["id"]
    # Frankie can't join AS maggie
    r = await client.post(f"{BASE}/groups/{gid}/join/{mid}", headers=_auth(ftok))
    assert r.status_code == 403
    # Join self ok
    r = await client.post(f"{BASE}/groups/{gid}/join/{fid}", headers=_auth(ftok))
    assert r.status_code == 200
    # Post with spoofed author -> author becomes JWT owner
    r = await client.post(f"{BASE}/groups/{gid}/posts", json={
        "user_id": mid, "user_name": "spoofed",
        "text": "PROP_iter201_grp", "group_id": gid,
    }, headers=_auth(ftok))
    assert r.status_code == 200
    pid = r.json()["id"]
    assert r.json()["user_id"] == fid
    load_dotenv("/app/backend/.env")
    mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = mongo[os.environ.get("DB_NAME", "test_database")]
    await db.group_posts.delete_one({"id": pid})
    mongo.close()


# ------------------------------------------------------------------
# SWEEP: additional write endpoints that still take a path user_id
# and may still trust it. These are informational — probe & report.
# ------------------------------------------------------------------

async def test_sweep_remaining_path_uid_write_endpoints(client):
    """Probe additional write routes that take a path `{user_id}` and were
    NOT in the ~11 endpoints extended by the main agent. A 200 flags a
    residual identity-spoof gap (attacker=frankie posting as maggie)."""
    ftok, _, _ = await _demo_login(client, "frankie")
    _, mid, _ = await _demo_login(client, "maggie")
    h = _auth(ftok)
    probes = [
        ("post",   f"/games/daily-bonus/claim/{mid}",   {}),
        ("post",   f"/games/complete/{mid}",            {"game_id": "trivia", "score": 1}),
        ("post",   f"/games/solitaire/award/{mid}",     {"score": 1}),
        ("post",   f"/games/wordsearch/progress/{mid}", {"theme": "animals", "difficulty": "easy"}),
        ("post",   f"/games/memory/progress/{mid}",     {"theme": "animals", "difficulty": "easy"}),
        ("post",   f"/games/sudoku/progress/{mid}",     {"difficulty": "easy"}),
        ("post",   f"/games/spot/progress/{mid}",       {"theme": "garden", "difficulty": "easy"}),
        ("post",   f"/games/trivia/session/{mid}",      {"difficulty": "easy"}),
        ("post",   f"/games/bingo/session/{mid}",       {"difficulty": "easy"}),
    ]
    # Fetch a table id if any
    r = await client.get(f"{BASE}/tables")
    tables = r.json() if r.status_code == 200 else []
    if tables:
        tid = tables[0]["id"]
        probes += [
            ("post", f"/tables/{tid}/join/{mid}",  {}),
            ("post", f"/tables/{tid}/leave/{mid}", {}),
        ]
    # Notice solve (need a notice id) — skip if none
    r = await client.get(f"{BASE}/notices")
    if r.status_code == 200 and r.json():
        nid = r.json()[0]["id"]
        probes.append(("post", f"/notices/{nid}/solve/{mid}", {}))

    exploitable = []
    for method, path, body in probes:
        try:
            r = await getattr(client, method)(f"{BASE}{path}", json=body, headers=h)
        except Exception as e:
            print(f"SWEEP {method.upper()} {path} ERROR {e}")
            continue
        code = r.status_code
        # 200 = still exploitable; 403 = properly guarded; 400/404/422 = validation reject (still no authz — record)
        if code == 200:
            exploitable.append(f"{method.upper()} {path} -> 200 (SPOOFABLE)")
        else:
            print(f"SWEEP {method.upper()} {path} -> {code}")
    # Do NOT hard-fail (out of the explicit scope) — print for the report.
    if exploitable:
        print("SWEEP RESIDUAL GAPS:\n" + "\n".join(exploitable))
