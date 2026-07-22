"""Iter 77 — CMS display_name enhancements.

Covers:
* PATCH /api/cms/auth/me — auth, validation, persistence.
* POST /api/cms/admins — display_name is now REQUIRED.
* Regression: change-password + list/delete admins still work.
"""
from __future__ import annotations

import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("NEXT_PUBLIC_API_URL") or "https://friendplace-v1.preview.emergentagent.com"
BASE_URL = BASE_URL.rstrip("/")

ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASS = "TestPass2026!"


# ---------- shared session / fixtures ----------

@pytest.fixture(scope="module")
def token() -> str:
    r = requests.post(
        f"{BASE_URL}/api/cms/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture
def auth_headers(token) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ================================================================
# PATCH /api/cms/auth/me
# ================================================================

class TestUpdateMe:
    def test_patch_me_requires_auth(self):
        r = requests.patch(
            f"{BASE_URL}/api/cms/auth/me",
            json={"display_name": "Garry"},
            timeout=15,
        )
        assert r.status_code == 401, r.text

    def test_patch_me_missing_field_422(self, auth_headers):
        r = requests.patch(f"{BASE_URL}/api/cms/auth/me", json={}, headers=auth_headers, timeout=15)
        assert r.status_code == 422, r.text

    def test_patch_me_empty_string_422(self, auth_headers):
        r = requests.patch(
            f"{BASE_URL}/api/cms/auth/me",
            json={"display_name": ""},
            headers=auth_headers,
            timeout=15,
        )
        # Pydantic min_length=1 catches this → 422.
        assert r.status_code == 422, r.text

    def test_patch_me_whitespace_only_400_or_422(self, auth_headers):
        # Pydantic min_length=1 lets '   ' through, then the handler
        # strips and raises 400.  Either code is acceptable — what
        # matters is that whitespace is REJECTED.
        r = requests.patch(
            f"{BASE_URL}/api/cms/auth/me",
            json={"display_name": "   "},
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code in (400, 422), r.text

    def test_patch_me_over_80_chars_422(self, auth_headers):
        r = requests.patch(
            f"{BASE_URL}/api/cms/auth/me",
            json={"display_name": "x" * 81},
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code == 422, r.text

    def test_patch_me_happy_path_and_persist(self, auth_headers):
        # Update, verify response, then GET /auth/me to confirm persistence,
        # then restore to "Garry" as required by the review request.
        new_name = "Garry S."
        r = requests.patch(
            f"{BASE_URL}/api/cms/auth/me",
            json={"display_name": new_name},
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        admin = body.get("admin") or {}
        assert admin.get("display_name") == new_name
        assert admin.get("email") == ADMIN_EMAIL
        assert "id" in admin
        assert "last_login_at" in admin

        # GET /auth/me should return the new value
        r2 = requests.get(f"{BASE_URL}/api/cms/auth/me", headers=auth_headers, timeout=15)
        assert r2.status_code == 200
        assert r2.json()["display_name"] == new_name

        # Restore to Garry
        r3 = requests.patch(
            f"{BASE_URL}/api/cms/auth/me",
            json={"display_name": "Garry"},
            headers=auth_headers,
            timeout=15,
        )
        assert r3.status_code == 200
        assert r3.json()["admin"]["display_name"] == "Garry"

        # Confirm restoration via GET
        r4 = requests.get(f"{BASE_URL}/api/cms/auth/me", headers=auth_headers, timeout=15)
        assert r4.json()["display_name"] == "Garry"

    def test_patch_me_trims_whitespace(self, auth_headers):
        r = requests.patch(
            f"{BASE_URL}/api/cms/auth/me",
            json={"display_name": "  Garry  "},
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["admin"]["display_name"] == "Garry"


# ================================================================
# POST /api/cms/admins — display_name now REQUIRED
# ================================================================

class TestCreateAdminRequiresDisplayName:
    created_ids: list[str] = []

    def test_missing_display_name_422(self, auth_headers):
        email = f"TEST_noname_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(
            f"{BASE_URL}/api/cms/admins",
            json={"email": email},
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code == 422, r.text
        # Pydantic error should mention display_name
        body_text = r.text.lower()
        assert "display_name" in body_text

    def test_empty_display_name_422(self, auth_headers):
        email = f"TEST_empty_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(
            f"{BASE_URL}/api/cms/admins",
            json={"email": email, "display_name": ""},
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code == 422, r.text

    def test_happy_path_creates_admin_and_trims(self, auth_headers):
        email = f"TEST_iter77_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(
            f"{BASE_URL}/api/cms/admins",
            json={"email": email, "display_name": "  Sam Nguyen  "},
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["admin"]["email"] == email.lower()
        assert body["admin"]["display_name"] == "Sam Nguyen"  # trimmed
        assert "invite_url" in body and "token=" in body["invite_url"]
        TestCreateAdminRequiresDisplayName.created_ids.append(body["admin"]["id"])

    def test_zzz_cleanup_delete_created(self, auth_headers):
        # Runs last (zzz prefix) to clean up test admins.
        for admin_id in TestCreateAdminRequiresDisplayName.created_ids:
            r = requests.delete(
                f"{BASE_URL}/api/cms/admins/{admin_id}",
                headers=auth_headers,
                timeout=15,
            )
            assert r.status_code == 200, r.text


# ================================================================
# Regression: change-password + list/delete admins
# ================================================================

class TestRegression:
    def test_list_admins_still_works(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/cms/admins", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert "items" in body and "count" in body
        assert body["count"] >= 1
        emails = [row["email"] for row in body["items"]]
        assert ADMIN_EMAIL in emails
        # password_hash never leaks
        for row in body["items"]:
            assert "password_hash" not in row

    def test_change_password_wrong_current_401(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/cms/auth/change-password",
            json={"current_password": "wrong-pass-xxx", "new_password": "SomethingNew123!"},
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code == 401, r.text

    def test_change_password_round_trip(self, auth_headers):
        # Change to a temp value, verify login with new, then flip back.
        temp = f"Temp_{uuid.uuid4().hex[:10]}!"
        r = requests.post(
            f"{BASE_URL}/api/cms/auth/change-password",
            json={"current_password": ADMIN_PASS, "new_password": temp},
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert "token" in r.json()

        # Login with the new pw
        r2 = requests.post(
            f"{BASE_URL}/api/cms/auth/login",
            json={"email": ADMIN_EMAIL, "password": temp},
            timeout=15,
        )
        assert r2.status_code == 200

        # Restore original — must use the freshly-issued token from r2
        new_headers = {
            "Authorization": f"Bearer {r2.json()['token']}",
            "Content-Type": "application/json",
        }
        r3 = requests.post(
            f"{BASE_URL}/api/cms/auth/change-password",
            json={"current_password": temp, "new_password": ADMIN_PASS},
            headers=new_headers,
            timeout=15,
        )
        assert r3.status_code == 200, r3.text

        # Sanity: original login still works
        r4 = requests.post(
            f"{BASE_URL}/api/cms/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
            timeout=15,
        )
        assert r4.status_code == 200

    def test_delete_admin_flow(self, auth_headers):
        # Create + delete a throwaway admin.
        email = f"TEST_del_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(
            f"{BASE_URL}/api/cms/admins",
            json={"email": email, "display_name": "Delete Me"},
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code == 200
        admin_id = r.json()["admin"]["id"]

        # Cannot delete self
        me = requests.get(f"{BASE_URL}/api/cms/auth/me", headers=auth_headers, timeout=15).json()
        r_self = requests.delete(
            f"{BASE_URL}/api/cms/admins/{me['id']}", headers=auth_headers, timeout=15
        )
        assert r_self.status_code == 400

        # 404 on unknown
        r_missing = requests.delete(
            f"{BASE_URL}/api/cms/admins/{uuid.uuid4().hex}", headers=auth_headers, timeout=15
        )
        assert r_missing.status_code == 404

        # Delete the throwaway
        r_del = requests.delete(
            f"{BASE_URL}/api/cms/admins/{admin_id}", headers=auth_headers, timeout=15
        )
        assert r_del.status_code == 200
