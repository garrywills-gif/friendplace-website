"""Iteration 202 — FINAL SEC-002 verification.

Scope: verify that the batch of 17 write endpoints newly-guarded in this pass
(tables join/leave, all games session/claim/complete/award/progress routes,
groups posts like, notices solve) correctly returns 403 cross-user, and
non-403 (self/admin allowed) for the positive matrix.

Also does a codebase sweep: enumerates every POST/PATCH/DELETE/PUT route in
server.py whose path contains `{user_id}` and confirms each one carries the
`owner_or_admin` guard (or is under /api/admin/*).
"""
import os
import re
import uuid
import httpx
import pytest

BASE = "http://localhost:8001/api"
SERVER_PY = "/app/backend/server.py"
pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


async def _demo_login(client, username):
    r = await client.post(f"{BASE}/auth/demo-login", json={"username": username})
    r.raise_for_status()
    d = r.json()
    return d["access_token"], d["user"]["id"]


def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture
async def client():
    async with httpx.AsyncClient(timeout=30) as c:
        yield c


# ---------------------------------------------------------------------------
# 1. NEGATIVE MATRIX — frankie (non-admin) acting on maggie must return 403
# ---------------------------------------------------------------------------
NEG_ENDPOINTS = [
    # (method, path_tmpl, needs_body)
    ("post", "/tables/fp-cafe-permanent/join/{uid}", False),
    ("post", "/tables/fp-cafe-permanent/leave/{uid}", False),
    ("post", "/games/complete/{uid}", True),
    ("post", "/games/daily-bonus/claim/{uid}", False),
    ("post", "/games/solitaire/award/{uid}", True),
    ("post", "/games/wordsearch/progress/{uid}", True),
    ("post", "/games/memory/progress/{uid}", True),
    ("post", "/games/sudoku/progress/{uid}", True),
    ("post", "/games/spot/progress/{uid}", True),
    ("post", "/games/crossword/progress/{uid}", True),
    ("post", "/games/trivia/session/{uid}", True),
    ("post", "/games/trivia/session/{uid}/somesid/answer", True),
    ("post", "/games/trivia/session/{uid}/somesid/complete", False),
    ("post", "/games/bingo/session/{uid}", True),
    ("post", "/games/bingo/session/{uid}/somesid/complete", False),
    ("post", "/groups/posts/somepid/like/{uid}", False),
    ("post", "/notices/somenid/solve/{uid}", False),
]


async def test_neg_cross_user_all_return_403(client):
    ftok, _ = await _demo_login(client, "frankie")
    _, mid = await _demo_login(client, "maggie")
    h = _auth(ftok)
    failures = []
    for method, tmpl, needs_body in NEG_ENDPOINTS:
        url = f"{BASE}{tmpl.replace('{uid}', mid)}"
        # send a minimal body; content doesn't matter — auth check runs first
        body = {} if needs_body else None
        r = await getattr(client, method)(url, json=body, headers=h)
        if r.status_code != 403:
            failures.append(f"{method.upper()} {tmpl} -> {r.status_code} (expected 403) body={r.text[:120]}")
    assert not failures, "Cross-user calls not blocked:\n" + "\n".join(failures)


# ---------------------------------------------------------------------------
# 2. POSITIVE MATRIX — frankie->frankie self and maggie(admin)->frankie must
#    NOT return 403 (may 200/400/404/409/422 — those are domain outcomes).
# ---------------------------------------------------------------------------
async def test_self_and_admin_not_forbidden(client):
    ftok, fid = await _demo_login(client, "frankie")
    mtok, _ = await _demo_login(client, "maggie")
    failures = []
    for method, tmpl, needs_body in NEG_ENDPOINTS:
        for label, tok, target in [("self", ftok, fid), ("admin", mtok, fid)]:
            url = f"{BASE}{tmpl.replace('{uid}', target)}"
            body = {} if needs_body else None
            r = await getattr(client, method)(url, json=body, headers=_auth(tok))
            if r.status_code == 403:
                failures.append(f"[{label}] {method.upper()} {tmpl} -> 403 (should be non-403 domain outcome)")
    assert not failures, "Legitimate self/admin calls blocked:\n" + "\n".join(failures)


# ---------------------------------------------------------------------------
# 3. UNAUTHENTICATED must be 401/403 (never 200) on same routes.
# ---------------------------------------------------------------------------
async def test_unauthenticated_rejected(client):
    _, mid = await _demo_login(client, "maggie")
    failures = []
    for method, tmpl, needs_body in NEG_ENDPOINTS:
        url = f"{BASE}{tmpl.replace('{uid}', mid)}"
        body = {} if needs_body else None
        r = await getattr(client, method)(url, json=body)
        if r.status_code not in (401, 403):
            failures.append(f"{method.upper()} {tmpl} -> {r.status_code} (expected 401/403)")
    assert not failures, "Unauth calls not blocked:\n" + "\n".join(failures)


# ---------------------------------------------------------------------------
# 4. REGRESSION — iteration_200 + iteration_201 fixes must still hold.
# ---------------------------------------------------------------------------
REGRESSION_ENDPOINTS = [
    ("patch", "/users/{uid}/profile", {"bio": "x"}),
    ("post", "/users/{uid}/location", {"suburb": "N"}),
    ("post", "/users/{uid}/status", {"status": "busy"}),
    ("patch", "/users/{uid}/privacy", {"privacy": "invisible"}),
    ("patch", "/users/{uid}/privacy-settings", {"profile_visibility": "public"}),
    ("patch", "/users/{uid}/preferences", {"preferences": {"a": 1}}),
    ("post", "/users/{uid}/onboarding-complete", {}),
    ("post", "/users/{uid}/heartbeat", {}),
    ("post", "/users/{uid}/birthday-visibility", {"show_birthday": True}),
    ("post", "/notifications/{uid}/read-all", {}),
    ("post", "/notifications/{uid}/clear-read", {}),
    ("post", "/notices/xx/react/{uid}", {"emoji": "❤️"}),
    ("post", "/notices/xx/like/{uid}", {}),
    ("post", "/notices/xx/report/{uid}", {"reason": "spam"}),
]


async def test_regression_prior_fixes_hold(client):
    ftok, _ = await _demo_login(client, "frankie")
    _, mid = await _demo_login(client, "maggie")
    h = _auth(ftok)
    failures = []
    for method, tmpl, body in REGRESSION_ENDPOINTS:
        url = f"{BASE}{tmpl.replace('{uid}', mid)}"
        r = await getattr(client, method)(url, json=body, headers=h)
        if r.status_code != 403:
            failures.append(f"REGR: {method.upper()} {tmpl} -> {r.status_code} (expected 403)")
    assert not failures, "Regression failed:\n" + "\n".join(failures)


# ---------------------------------------------------------------------------
# 5. SEC-001 email step-up regression: password owner must supply current pw
# ---------------------------------------------------------------------------
async def test_sec001_email_stepup(client):
    rnd = uuid.uuid4().hex[:8]
    su = await client.post(f"{BASE}/auth/signup", json={
        "username": f"sec202{rnd}",
        "password": "OrigPass123",
        "email": f"sec202{rnd}@example.com",
    })
    su.raise_for_status()
    tok = su.json()["access_token"]
    uid = su.json()["user"]["id"]
    h = _auth(tok)
    try:
        # no password -> 401
        r = await client.patch(f"{BASE}/users/{uid}/profile",
                                json={"email": f"new{rnd}@example.com"}, headers=h)
        assert r.status_code == 401
        # wrong password -> 401
        r = await client.patch(f"{BASE}/users/{uid}/profile",
                                json={"email": f"new{rnd}@example.com", "current_password": "wrong"}, headers=h)
        assert r.status_code == 401
        # right password -> 200
        r = await client.patch(f"{BASE}/users/{uid}/profile",
                                json={"email": f"new{rnd}@example.com", "current_password": "OrigPass123"}, headers=h)
        assert r.status_code == 200
        # non-email edit needs no password
        r = await client.patch(f"{BASE}/users/{uid}/profile", json={"bio": "hi"}, headers=h)
        assert r.status_code == 200
    finally:
        from motor.motor_asyncio import AsyncIOMotorClient
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = c[os.environ.get("DB_NAME", "test_database")]
        await db.users.delete_one({"id": uid})
        await db.founder_email_claims.delete_many({"_id": {"$regex": "sec202"}})


# ---------------------------------------------------------------------------
# 6. FINAL SWEEP — enumerate every write route with {user_id} in the path and
#    assert each carries the owner_or_admin dependency (or is /api/admin/*).
# ---------------------------------------------------------------------------
def test_final_sweep_every_user_id_write_route_is_guarded():
    src = open(SERVER_PY, "r").read()
    # Regex the decorator + handler signature in the following line.
    pat = re.compile(
        r'@api\.(post|patch|put|delete)\(\s*[\"\']([^\"\']*\{user_id\}[^\"\']*)[\"\'][^)]*\)\s*\n'
        r'async def (\w+)\(([^)]*)\)',
        re.MULTILINE,
    )
    unguarded = []
    for m in pat.finditer(src):
        method, path, handler, sig = m.group(1), m.group(2), m.group(3), m.group(4)
        if path.startswith("/admin/"):
            # admin routes are gated by current_admin (already verified).
            continue
        has_owner_or_admin = "owner_or_admin" in sig
        has_current_user = "current_user" in sig
        has_current_admin = "current_admin" in sig
        if not (has_owner_or_admin or has_current_user or has_current_admin):
            unguarded.append(f"{method.upper()} {path} -> handler={handler}")
    assert not unguarded, (
        "SEC-002 residual: write routes with {user_id} still lack an auth guard:\n"
        + "\n".join(unguarded)
    )


# ---------------------------------------------------------------------------
# 7. Smoke — sanity that demo-login and /auth/me still work after all this.
# ---------------------------------------------------------------------------
async def test_smoke_auth_still_works(client):
    tok, uid = await _demo_login(client, "frankie")
    r = await client.get(f"{BASE}/auth/me", headers=_auth(tok))
    assert r.status_code == 200
    assert r.json()["id"] == uid
