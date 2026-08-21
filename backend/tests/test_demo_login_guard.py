"""Demo-login banned/suspended guard test.

Verifies that POST /api/auth/demo-login mirrors POST /api/auth/login for
banned/suspended users: 403 when banned or suspended, 200 once restored.
"""
import os
import requests
import pytest

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://outreach-campaigns.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def maggie(s):
    r = s.post(f"{API}/auth/demo-login", json={"username": "maggie"})
    assert r.status_code == 200, r.text
    u = r.json()["user"]
    assert u.get("is_admin") is True
    return u


@pytest.fixture(scope="module")
def frankie(s):
    r = s.post(f"{API}/auth/demo-login", json={"username": "frankie"})
    assert r.status_code == 200, r.text
    return r.json()["user"]


def test_demo_login_active_user_returns_200(s):
    """Active demo user (dot) can demo-log in normally."""
    r = s.post(f"{API}/auth/demo-login", json={"username": "dot"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "access_token" in body
    assert body["user"]["username"].lower() == "dot"


def test_demo_login_blocked_when_suspended_then_restored(s, maggie, frankie):
    """Suspend frankie via admin → demo-login 403 → restore → demo-login 200."""
    # 1. Suspend frankie for 24h
    sp = s.post(f"{API}/admin/users/suspend", json={
        "admin_id": maggie["id"],
        "user_id": frankie["id"],
        "reason": "TEST_demo_login_guard",
        "duration_hours": 24,
    })
    assert sp.status_code == 200, sp.text
    assert sp.json().get("suspended_until")

    try:
        # 2. demo-login should now 403
        r = s.post(f"{API}/auth/demo-login", json={"username": "frankie"})
        assert r.status_code == 403, (
            f"Suspended demo user should be 403 but got {r.status_code}: {r.text}"
        )
        # Friendly message body should mention 'suspended'
        assert "suspend" in r.text.lower()
    finally:
        # 3. Restore so other suites can demo-login frankie
        rs = s.post(f"{API}/admin/users/restore", json={
            "admin_id": maggie["id"],
            "user_id": frankie["id"],
        })
        assert rs.status_code == 200, rs.text

    # 4. After restore, demo-login active again
    r2 = s.post(f"{API}/auth/demo-login", json={"username": "frankie"})
    assert r2.status_code == 200, r2.text
    assert r2.json()["user"]["username"].lower() == "frankie"


def test_demo_login_blocked_when_banned_then_restored(s, maggie):
    """Ban dot via admin → demo-login 403 → restore → demo-login 200."""
    # Get dot's id
    dl = s.post(f"{API}/auth/demo-login", json={"username": "dot"})
    assert dl.status_code == 200, dl.text
    dot_id = dl.json()["user"]["id"]

    # 1. Ban
    bp = s.post(f"{API}/admin/users/ban", json={
        "admin_id": maggie["id"],
        "user_id": dot_id,
        "reason": "TEST_demo_login_ban",
    })
    assert bp.status_code == 200, bp.text

    try:
        # 2. demo-login should 403
        r = s.post(f"{API}/auth/demo-login", json={"username": "dot"})
        assert r.status_code == 403, (
            f"Banned demo user should be 403 but got {r.status_code}: {r.text}"
        )
        assert "ban" in r.text.lower()
    finally:
        # 3. Restore
        rs = s.post(f"{API}/admin/users/restore", json={
            "admin_id": maggie["id"],
            "user_id": dot_id,
        })
        assert rs.status_code == 200, rs.text

    # 4. demo-login works again
    r2 = s.post(f"{API}/auth/demo-login", json={"username": "dot"})
    assert r2.status_code == 200, r2.text
