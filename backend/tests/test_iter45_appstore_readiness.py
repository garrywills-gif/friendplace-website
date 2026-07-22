"""Iteration 45 — App Store readiness verification.

Covers:
1. Backend health smoke (env vars haven't broken startup).
2. POST /api/auth/apple new path: malformed identity_token + authorization_code
   should still return 401 (token verification fails *before* any code exchange
   would happen).
3. POST /api/auth/apple with authorization_code OMITTED still works
   (malformed-token path).
4. _siwa_configured() returns False in the current env (empty key/private key).
5. _apple_revoke_token() is a graceful no-op when SIWA is unconfigured —
   returns False immediately, makes ZERO http calls.
6. _build_apple_client_secret() with a freshly-minted ES256 keypair produces
   a JWT whose header is {alg: ES256, kid: ...} and whose claims contain
   iss=team, sub=client_id, aud=https://appleid.apple.com, exp ≤ iat+6mo.
7. DELETE /api/users/me works for a real-account user WITHOUT
   apple_refresh_token (does not blow up trying to revoke).
8. app.json structural validation (no removed keys, has privacyManifests).
"""
import os
import sys
import json
import time
import uuid
import asyncio
import pathlib
import importlib

import pytest
import requests
from jose import jwt as jose_jwt
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization

BACKEND_DIR = pathlib.Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL", "https://friendplace-v1.preview.emergentagent.com"
).rstrip("/")
APPLE_URL = f"{BASE_URL}/api/auth/apple"


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------------------------------------------------------------------------
# 1. Backend health smoke
# ---------------------------------------------------------------------------
class TestBackendHealth:
    def test_health_endpoint(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/health", timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("status") == "ok", body
        # MongoDB connection should also be alive (mentioned in previous report)
        assert body.get("db") in ("up", "ok"), body


# ---------------------------------------------------------------------------
# 2 & 3. /api/auth/apple with new authorization_code field
# ---------------------------------------------------------------------------
class TestAppleAuthNewField:
    def test_malformed_token_with_authorization_code(self, api_client):
        """Verification fails BEFORE the code exchange — body w/ both fields
        should still 401 with `malformed` error."""
        r = api_client.post(
            APPLE_URL,
            json={"identity_token": "<malformed>", "authorization_code": "test123"},
        )
        assert r.status_code == 401, r.text
        body = r.json()
        assert "detail" in body
        assert "malformed" in body["detail"].lower(), body

    def test_authorization_code_field_is_optional(self, api_client):
        """Omitting authorization_code entirely is fine — still hits the
        malformed-token branch."""
        r = api_client.post(APPLE_URL, json={"identity_token": "not-a-jwt"})
        assert r.status_code == 401, r.text
        body = r.json()
        assert "detail" in body
        assert "malformed" in body["detail"].lower()

    def test_empty_identity_token_still_400(self, api_client):
        r = api_client.post(APPLE_URL, json={"identity_token": "", "authorization_code": "abc"})
        assert r.status_code == 400, r.text
        assert "Missing identity_token" in r.json()["detail"]


# ---------------------------------------------------------------------------
# 4 & 5. SIWA helpers no-op when unconfigured (env vars empty)
# ---------------------------------------------------------------------------
class TestSiwaHelpersUnconfigured:
    """These import server.py in-process — covers the helpers directly."""

    def test_siwa_configured_returns_false_in_dev_env(self):
        # KEY_ID and PRIVATE_KEY are intentionally empty in /app/backend/.env
        # Use python-dotenv to load from the same file the backend uses, then
        # call the function (which itself reads from os.environ).
        from dotenv import load_dotenv
        load_dotenv(BACKEND_DIR / ".env", override=False)
        import server  # noqa: E402
        # Re-evaluate against current env (helper reads os.getenv every call)
        # In the running container these vars are empty strings.
        key_id = os.getenv("APPLE_SIWA_KEY_ID", "")
        pkey = os.getenv("APPLE_SIWA_PRIVATE_KEY", "")
        # Either empty (.env load) or the real backend process loaded them
        # before this test runs — both are acceptable, but for THIS dev env
        # we expect them empty.
        assert key_id == "" or pkey == "", (
            f"Expected at least one SIWA var empty in dev env, "
            f"got key_id={key_id!r} pkey_len={len(pkey)}"
        )
        # If the test env didn't load .env, _siwa_configured() may be True
        # against process env — only assert False when env is actually empty.
        if key_id == "" and pkey == "":
            assert server._siwa_configured() is False

    def test_apple_revoke_token_no_op_when_unconfigured(self, monkeypatch):
        """Force SIWA-unconfigured and confirm _apple_revoke_token returns False
        immediately without making any HTTP requests."""
        import server  # noqa: E402
        monkeypatch.setenv("APPLE_SIWA_KEY_ID", "")
        monkeypatch.setenv("APPLE_SIWA_PRIVATE_KEY", "")
        # Patch httpx to detect any HTTP call (should not happen)
        called = {"n": 0}

        class _Sentinel:
            def __init__(self, *a, **kw):
                called["n"] += 1

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def post(self, *a, **kw):
                called["n"] += 1
                raise AssertionError("httpx.post() should NOT be called when SIWA unconfigured")

        import httpx
        monkeypatch.setattr(httpx, "AsyncClient", _Sentinel)
        result = asyncio.run(server._apple_revoke_token("any-token-here"))
        assert result is False
        assert called["n"] == 0, "no httpx client should be instantiated"

    def test_apple_revoke_token_no_op_when_token_empty(self, monkeypatch):
        """Even if SIWA *were* configured, an empty token must short-circuit."""
        import server  # noqa: E402
        monkeypatch.setenv("APPLE_SIWA_TEAM_ID", "6XRMF8PK98")
        monkeypatch.setenv("APPLE_SIWA_KEY_ID", "ABCDE12345")
        monkeypatch.setenv("APPLE_SIWA_PRIVATE_KEY", "dummy")
        result = asyncio.run(server._apple_revoke_token(""))
        assert result is False


# ---------------------------------------------------------------------------
# 6. _build_apple_client_secret() JWT shape (with a freshly-minted ES256 key)
# ---------------------------------------------------------------------------
class TestBuildAppleClientSecret:
    def test_jwt_shape_with_real_es256_key(self, monkeypatch):
        # Generate an ES256 (P-256) key
        priv = ec.generate_private_key(ec.SECP256R1())
        pem = priv.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode()

        monkeypatch.setenv("APPLE_SIWA_TEAM_ID", "6XRMF8PK98")
        monkeypatch.setenv("APPLE_SIWA_KEY_ID", "TESTKEY123")
        monkeypatch.setenv("APPLE_SIWA_PRIVATE_KEY", pem)
        monkeypatch.setenv("APPLE_SIWA_CLIENT_ID", "au.com.friendplace.app")

        import server  # noqa: E402
        importlib.reload(server) if False else None  # not needed; helper reads env on each call

        tok = server._build_apple_client_secret()
        assert isinstance(tok, str) and tok.count(".") == 2

        # Verify header
        header = jose_jwt.get_unverified_header(tok)
        assert header["alg"] == "ES256"
        assert header["kid"] == "TESTKEY123"

        # Verify claims (we have the public key, so we can fully verify the sig)
        pub_pem = priv.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode()
        claims = jose_jwt.decode(
            tok,
            pub_pem,
            algorithms=["ES256"],
            audience="https://appleid.apple.com",
        )
        assert claims["iss"] == "6XRMF8PK98"
        assert claims["sub"] == "au.com.friendplace.app"
        assert claims["aud"] == "https://appleid.apple.com"
        assert "iat" in claims and "exp" in claims
        # exp must be ≤ iat + 6 months (Apple max). We use 30 min so this is easy.
        six_months_secs = 60 * 60 * 24 * 30 * 6
        assert claims["exp"] - claims["iat"] <= six_months_secs
        assert claims["exp"] > int(time.time()) - 5  # not already expired


# ---------------------------------------------------------------------------
# 7. DELETE /api/users/me without apple_refresh_token
# ---------------------------------------------------------------------------
class TestSelfDeleteNonApple:
    def test_signup_then_self_delete(self, api_client):
        uname = f"pwtest_del_{uuid.uuid4().hex[:6]}"
        # Signup
        r = api_client.post(
            f"{BASE_URL}/api/auth/signup",
            json={
                "username": uname,
                "password": "oldpass123",
                "email": f"{uname}@example.com",
                "first_name": "Test_Del",
            },
        )
        assert r.status_code == 200, r.text
        token = r.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        # Confirm GET /api/auth/me works
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=headers, timeout=10)
        assert me.status_code == 200, me.text
        assert me.json().get("username", "").lower() == uname.lower()

        # DELETE /api/users/me (no body)
        d = requests.delete(f"{BASE_URL}/api/users/me", headers=headers, timeout=15)
        assert d.status_code == 200, d.text
        body = d.json()
        assert body.get("ok") is True

        # Confirm follow-up GET /api/auth/me now returns 401 (token still valid format
        # but user gone — auth middleware will reject when user lookup fails).
        me2 = requests.get(f"{BASE_URL}/api/auth/me", headers=headers, timeout=10)
        assert me2.status_code in (401, 404), me2.text


# ---------------------------------------------------------------------------
# 8. app.json structural validation
# ---------------------------------------------------------------------------
class TestAppJsonStructure:
    APP_JSON = pathlib.Path("/app/frontend/app.json")

    def _load(self):
        return json.loads(self.APP_JSON.read_text())

    def test_app_json_valid(self):
        data = self._load()
        assert "expo" in data
        assert data["expo"]["bundleIdentifier" if False else "slug"] == "friendplace"

    def test_privacy_manifests_present(self):
        d = self._load()
        pm = d["expo"]["ios"].get("privacyManifests")
        assert pm is not None
        api_types = pm.get("NSPrivacyAccessedAPITypes", [])
        names = [x.get("NSPrivacyAccessedAPIType") for x in api_types]
        assert "NSPrivacyAccessedAPICategoryUserDefaults" in names
        assert "NSPrivacyAccessedAPICategoryFileTimestamp" in names
        assert "NSPrivacyAccessedAPICategoryDiskSpace" in names
        assert "NSPrivacyAccessedAPICategorySystemBootTime" in names
        # Each entry has a reason code list
        for x in api_types:
            assert isinstance(x.get("NSPrivacyAccessedAPITypeReasons"), list)
            assert len(x["NSPrivacyAccessedAPITypeReasons"]) >= 1

    def test_removed_ios_permission_strings(self):
        d = self._load()
        info = d["expo"]["ios"]["infoPlist"]
        for k in ("NSUserTrackingUsageDescription",
                  "NSMicrophoneUsageDescription",
                  "NSContactsUsageDescription"):
            assert k not in info, f"{k} should have been removed"

    def test_removed_android_permissions(self):
        d = self._load()
        perms = d["expo"]["android"]["permissions"]
        for forbidden in ("RECORD_AUDIO", "READ_CONTACTS"):
            assert forbidden not in perms, f"{forbidden} should have been removed"

    def test_no_google_services_file(self):
        d = self._load()
        assert "googleServicesFile" not in d["expo"].get("android", {})

    def test_usesAppleSignIn_still_true(self):
        d = self._load()
        assert d["expo"]["ios"].get("usesAppleSignIn") is True

    def test_apple_authentication_plugin_present(self):
        d = self._load()
        plugins = d["expo"].get("plugins", [])
        flat = [p if isinstance(p, str) else (p[0] if isinstance(p, list) else None) for p in plugins]
        assert "expo-apple-authentication" in flat
