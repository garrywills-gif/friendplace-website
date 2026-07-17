"""Tests for the FriendPlace Mini-CMS module (backend).

Covers:
  * Auth: setup-required, setup (idempotency lock), login, /me, forgot,
    reset with a live-issued token.
  * Content: GET + PATCH round-trip with public read reflection.
  * Media: upload, list, patch, delete + auth guards.
  * Public read endpoints served without auth.
  * Emergency CLI reset script (list/wipe).
"""

from __future__ import annotations

import io
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

TEST_EMAIL = "admin@testcms.example.com"
TEST_PASSWORD = "TestPass1234!"


# --- Helpers -------------------------------------------------------------

def _wipe_admins():
    """Wipe cms_admins via the emergency CLI so we can re-exercise the
    first-run setup flow deterministically."""
    subprocess.run(
        [sys.executable, "/app/backend/scripts/cms_admin_reset.py", "--wipe", "--yes"],
        check=True,
        capture_output=True,
    )


@pytest.fixture(scope="module")
def admin_token():
    """Ensure a clean setup, run setup, return the JWT for the rest."""
    _wipe_admins()
    r = requests.post(f"{API}/cms/auth/setup", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD,
        "display_name": "Test Admin",
    })
    assert r.status_code == 200, f"setup failed: {r.status_code} {r.text}"
    body = r.json()
    assert body.get("ok") is True
    assert isinstance(body.get("token"), str) and body["token"]
    assert body["admin"]["email"] == TEST_EMAIL
    return body["token"]


@pytest.fixture
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# --- Auth ----------------------------------------------------------------

class TestCmsAuth:
    def test_setup_required_after_wipe(self):
        _wipe_admins()
        r = requests.get(f"{API}/cms/auth/setup-required")
        assert r.status_code == 200
        assert r.json().get("setup_required") is True

    def test_setup_creates_admin_and_locks(self):
        # setup itself is invoked by the fixture; verify second call locked
        _ = requests.post(f"{API}/cms/auth/setup", json={
            "email": TEST_EMAIL, "password": TEST_PASSWORD,
        })  # ensure at least one admin exists
        r = requests.get(f"{API}/cms/auth/setup-required")
        assert r.status_code == 200
        assert r.json().get("setup_required") is False

        r2 = requests.post(f"{API}/cms/auth/setup", json={
            "email": "second@testcms.example.com", "password": "AnotherPass1234!",
        })
        assert r2.status_code == 403, r2.text

    def test_login_wrong_password_401(self):
        r = requests.post(f"{API}/cms/auth/login", json={
            "email": TEST_EMAIL, "password": "wrong-password",
        })
        assert r.status_code == 401

    def test_login_success_and_me(self):
        r = requests.post(f"{API}/cms/auth/login", json={
            "email": TEST_EMAIL, "password": TEST_PASSWORD,
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        token = body["token"]

        me = requests.get(f"{API}/cms/auth/me",
                          headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200
        assert me.json()["email"] == TEST_EMAIL

    def test_me_requires_token(self):
        r = requests.get(f"{API}/cms/auth/me")
        assert r.status_code == 401

    def test_forgot_always_ok(self):
        # Existing admin
        r = requests.post(f"{API}/cms/auth/forgot", json={"email": TEST_EMAIL})
        assert r.status_code == 200 and r.json() == {"ok": True}
        # Unknown email — still 200 (no enumeration)
        r2 = requests.post(f"{API}/cms/auth/forgot", json={"email": "nobody@example.com"})
        assert r2.status_code == 200 and r2.json() == {"ok": True}

    def test_reset_with_valid_token(self):
        # Craft a reset token exactly the way the module does.
        sys.path.insert(0, "/app/backend")
        from dotenv import load_dotenv  # noqa
        load_dotenv("/app/backend/.env")
        from cms_module import _make_reset_token  # type: ignore

        # Get admin id
        login = requests.post(f"{API}/cms/auth/login", json={
            "email": TEST_EMAIL, "password": TEST_PASSWORD,
        })
        assert login.status_code == 200
        admin = login.json()["admin"]
        reset_token = _make_reset_token(admin["id"], admin["email"])

        new_pw = "NewPass98765!"
        r = requests.post(f"{API}/cms/auth/reset", json={
            "token": reset_token, "new_password": new_pw,
        })
        assert r.status_code == 200
        assert r.json().get("ok") is True
        assert isinstance(r.json().get("token"), str)

        # Old password no longer works, new one does.
        bad = requests.post(f"{API}/cms/auth/login", json={
            "email": TEST_EMAIL, "password": TEST_PASSWORD,
        })
        assert bad.status_code == 401
        good = requests.post(f"{API}/cms/auth/login", json={
            "email": TEST_EMAIL, "password": new_pw,
        })
        assert good.status_code == 200

        # Restore original password so the module-level admin_token
        # fixture stays valid for subsequent tests via reset chain.
        from cms_module import _make_reset_token as _mrt  # noqa
        rtok = _mrt(admin["id"], admin["email"])
        requests.post(f"{API}/cms/auth/reset", json={
            "token": rtok, "new_password": TEST_PASSWORD,
        })

    def test_reset_bad_token(self):
        r = requests.post(f"{API}/cms/auth/reset", json={
            "token": "not-a-jwt", "new_password": "SomePass1234!",
        })
        assert r.status_code == 401


# --- Content -------------------------------------------------------------

class TestCmsContent:
    def test_get_content_requires_auth(self):
        r = requests.get(f"{API}/cms/content")
        assert r.status_code == 401

    def test_get_content_authed(self, auth_headers):
        r = requests.get(f"{API}/cms/content", headers=auth_headers)
        assert r.status_code == 200, r.text
        body = r.json()
        # top-level fields we expect (from defaults)
        assert isinstance(body, dict)

    def test_patch_faqs_and_public_reflects(self, auth_headers):
        marker = f"TEST_FAQ_{int(time.time())}"
        payload = {
            "faqs": [
                {"q": marker, "a": "Yes, this is a test answer."},
                {"q": "Second Q", "a": "Second A"},
            ]
        }
        r = requests.patch(f"{API}/cms/content", json=payload, headers=auth_headers)
        assert r.status_code == 200, r.text

        # Public reflection
        pub = requests.get(f"{API}/public/faqs")
        assert pub.status_code == 200
        faqs = pub.json().get("faqs", [])
        assert any(f.get("q") == marker for f in faqs), faqs

    def test_public_endpoints_no_auth(self):
        for path in ["about", "features", "faqs", "founders", "stories", "content"]:
            r = requests.get(f"{API}/public/{path}")
            assert r.status_code == 200, f"{path} → {r.status_code} {r.text}"


# --- Media ---------------------------------------------------------------

def _tiny_png_bytes() -> bytes:
    # 1x1 transparent PNG
    import base64
    return base64.b64decode(
        b"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
    )


class TestCmsMedia:
    def test_upload_requires_auth(self):
        r = requests.post(f"{API}/cms/media/upload",
                          files={"file": ("t.png", _tiny_png_bytes(), "image/png")})
        assert r.status_code == 401

    def test_upload_rejects_non_image(self, auth_headers):
        r = requests.post(
            f"{API}/cms/media/upload",
            files={"file": ("t.txt", b"hello", "text/plain")},
            headers=auth_headers,
        )
        assert r.status_code == 415

    def test_upload_list_patch_delete(self, auth_headers):
        # upload
        up = requests.post(
            f"{API}/cms/media/upload",
            files={"file": ("test.png", _tiny_png_bytes(), "image/png")},
            headers=auth_headers,
        )
        assert up.status_code == 200, up.text
        row = up.json()
        media_id = row["id"]
        url = row["url"]
        assert url.startswith("/api/uploads/cms/")

        # fetch bytes
        got = requests.get(f"{BASE_URL}{url}")
        assert got.status_code == 200
        assert got.content[:8] == b"\x89PNG\r\n\x1a\n"

        # list
        lst = requests.get(f"{API}/cms/media", headers=auth_headers)
        assert lst.status_code == 200
        assert any(item["id"] == media_id for item in lst.json()["items"])

        # patch alt
        patched = requests.patch(
            f"{API}/cms/media/{media_id}",
            json={"alt": "TEST_alt_text"},
            headers=auth_headers,
        )
        assert patched.status_code == 200
        assert patched.json()["alt"] == "TEST_alt_text"

        # delete
        d = requests.delete(f"{API}/cms/media/{media_id}", headers=auth_headers)
        assert d.status_code == 200 and d.json().get("ok") is True

        # verify gone from list
        lst2 = requests.get(f"{API}/cms/media", headers=auth_headers)
        assert not any(item["id"] == media_id for item in lst2.json()["items"])


# --- CLI script ----------------------------------------------------------

class TestCliScript:
    def test_list_cli_after_setup(self, admin_token):
        # admin_token fixture guarantees an admin exists
        out = subprocess.run(
            [sys.executable, "/app/backend/scripts/cms_admin_reset.py", "--list"],
            capture_output=True, text=True, check=True,
        )
        assert TEST_EMAIL in out.stdout, out.stdout

    def test_wipe_without_yes_errors(self):
        out = subprocess.run(
            [sys.executable, "/app/backend/scripts/cms_admin_reset.py", "--wipe"],
            capture_output=True, text=True,
        )
        assert out.returncode != 0
        assert "Re-run with --yes" in (out.stderr + out.stdout)
