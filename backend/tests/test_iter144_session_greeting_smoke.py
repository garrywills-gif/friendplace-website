"""
Smoke tests for iteration 144 — session-scoped George Welcome regression fix.

Backend-side this iteration had no changes. Purely a smoke sanity check to
confirm the endpoints the frontend hits during the demo login → home →
logout → login flow are still green.

Covered endpoints:
  - GET  /api/health
  - POST /api/auth/demo-login  (maggie)
  - GET  /api/mcgs/george/introduced  (authed)  --> actually POST retirement
  - GET  /api/home/summary   (authed)
  - POST /api/status/sign-off (authed)
"""

import os
import pytest
import requests


BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
if not BASE_URL:
    # Fall back to reading the frontend env directly so this file stays runnable.
    try:
        with open("/app/frontend/.env") as fh:
            for line in fh:
                if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().strip('"')
                    break
    except FileNotFoundError:
        pass

assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set for the smoke suite"
BASE_URL = BASE_URL.rstrip("/")


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def demo_session(api):
    """Log in demo user maggie once and re-use across the module."""
    r = api.post(f"{BASE_URL}/api/auth/demo-login", json={"username": "maggie"}, timeout=20)
    assert r.status_code == 200, f"demo-login failed: {r.status_code} {r.text}"
    payload = r.json()
    assert "access_token" in payload and "user" in payload
    token = payload["access_token"]
    user = payload["user"]
    assert user.get("username") == "maggie"
    return {"token": token, "user": user, "headers": {"Authorization": f"Bearer {token}"}}


# ---- Health ---------------------------------------------------------------

def test_health(api):
    r = api.get(f"{BASE_URL}/api/health", timeout=15)
    assert r.status_code == 200, f"health failed: {r.status_code} {r.text[:200]}"
    body = r.json()
    # Common health payloads either return {"status": "..."} or similar.
    assert isinstance(body, dict)


# ---- Demo login -----------------------------------------------------------

def test_demo_login_maggie(demo_session):
    assert demo_session["token"]
    assert demo_session["user"]["username"] == "maggie"


# ---- George introduced (POST retirement) ---------------------------------
# The frontend calls POST /api/mcgs/george/introduced after any intro
# acknowledgement. The route only exists as POST.

def test_george_introduced_post(api, demo_session):
    r = api.post(
        f"{BASE_URL}/api/mcgs/george/introduced",
        headers=demo_session["headers"],
        timeout=20,
    )
    assert r.status_code in (200, 204), f"introduced failed: {r.status_code} {r.text[:200]}"


# ---- Home summary (authed) -----------------------------------------------

def test_home_summary(api, demo_session):
    # NOTE: /api/home/summary was listed by the main agent but does not
    # actually exist in server.py — the home tab renders from a set of
    # smaller endpoints. Marked as xfail so the smoke suite stays green
    # while surfacing the discrepancy to the main agent.
    r = api.get(
        f"{BASE_URL}/api/home/summary",
        headers=demo_session["headers"],
        timeout=25,
    )
    if r.status_code == 404:
        pytest.xfail("/api/home/summary is not a real endpoint in server.py")
    assert r.status_code == 200, f"home summary failed: {r.status_code} {r.text[:200]}"


# ---- Status sign-off (called during logout) ------------------------------

def test_status_signoff(api, demo_session):
    r = api.post(
        f"{BASE_URL}/api/status/sign-off",
        headers=demo_session["headers"],
        timeout=20,
    )
    assert r.status_code in (200, 204), f"sign-off failed: {r.status_code} {r.text[:200]}"


# ---- George presence sanity (used by butterfly boot) --------------------

def test_george_presence(api, demo_session):
    r = api.get(
        f"{BASE_URL}/api/mcgs/george/presence",
        headers=demo_session["headers"],
        timeout=20,
    )
    assert r.status_code == 200, f"presence failed: {r.status_code} {r.text[:200]}"
    body = r.json()
    assert isinstance(body, dict)
    # Should carry name + actor_type at minimum.
    assert "actor_type" in body or "name" in body
