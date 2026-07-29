"""Iteration 43 — Sign in with Apple negative-path tests.

We cannot generate a valid Apple identity_token without Apple's private key,
so the happy path (existing user login + new user creation) is *only*
testable in a real iOS dev build. These tests exhaustively cover the
verification logic for malformed / wrong-signature / wrong-kid tokens, plus
regression smoke tests on the other auth endpoints.
"""
import os
import time
import uuid
import pytest
import requests
from jose import jwt as jose_jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://george-mcgs-cms.preview.emergentagent.com").rstrip("/")
APPLE_URL = f"{BASE_URL}/api/auth/apple"


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------------------------------------------------------------------------
# Apple Sign-In negative paths
# ---------------------------------------------------------------------------
class TestAppleSignInNegative:
    def test_empty_identity_token(self, api_client):
        r = api_client.post(APPLE_URL, json={"identity_token": ""})
        assert r.status_code == 400, r.text
        body = r.json()
        assert "detail" in body
        assert "Missing identity_token" in body["detail"]

    def test_missing_identity_token_field(self, api_client):
        # Pydantic should reject missing required field → 422
        r = api_client.post(APPLE_URL, json={})
        assert r.status_code in (400, 422), r.text

    def test_malformed_token(self, api_client):
        r = api_client.post(APPLE_URL, json={"identity_token": "not-a-jwt"})
        assert r.status_code == 401, r.text
        body = r.json()
        assert "detail" in body
        assert "malformed" in body["detail"].lower()

    def test_wrong_signature_hs256_token(self, api_client):
        """JWT signed with HS256 + junk secret → must be rejected (alg not allowed)."""
        payload = {
            "iss": "https://appleid.apple.com",
            "aud": "au.com.friendplace.app",
            "sub": "abc123.deadbeef",
            "email": "test@example.com",
            "exp": int(time.time()) + 600,
            "iat": int(time.time()),
        }
        # Forge an HS256 token with arbitrary kid so it gets past the header parse
        tok = jose_jwt.encode(payload, "junk-secret", algorithm="HS256", headers={"kid": "DOES_NOT_EXIST"})
        r = api_client.post(APPLE_URL, json={"identity_token": tok})
        assert r.status_code == 401, r.text
        body = r.json()
        assert "detail" in body
        # Either "key not recognised" (kid lookup failed) or "could not be verified"
        msg = body["detail"].lower()
        assert ("key not recognised" in msg) or ("could not be verified" in msg) or ("not recognized" in msg), msg

    def test_bogus_kid_rs256_token(self, api_client):
        """RS256-signed token with a kid Apple has never published → 401 key not recognised."""
        # Generate an RSA keypair locally so we can sign an RS256 JWT
        priv = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = priv.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode()
        payload = {
            "iss": "https://appleid.apple.com",
            "aud": "au.com.friendplace.app",
            "sub": "fake.sub.999",
            "email": "fake@example.com",
            "exp": int(time.time()) + 600,
            "iat": int(time.time()),
        }
        tok = jose_jwt.encode(payload, pem, algorithm="RS256", headers={"kid": "DOES_NOT_EXIST_xyz"})
        r = api_client.post(APPLE_URL, json={"identity_token": tok})
        assert r.status_code == 401, r.text
        body = r.json()
        assert "detail" in body
        msg = body["detail"].lower()
        # Backend should report unrecognised key (after JWK refresh fallback)
        assert ("key not recognised" in msg) or ("not recognized" in msg), msg

    def test_jwt_missing_kid(self, api_client):
        """A JWT with no `kid` in its header should also be rejected with 401."""
        # We cannot easily encode a JWT without a kid using python-jose without
        # also providing one, so construct manually with HS256 (no kid header).
        tok = jose_jwt.encode(
            {"iss": "https://appleid.apple.com", "aud": "au.com.friendplace.app", "sub": "x", "exp": int(time.time()) + 600},
            "secret",
            algorithm="HS256",
        )
        # python-jose includes a default header with no kid → triggers "missing key id"
        r = api_client.post(APPLE_URL, json={"identity_token": tok})
        assert r.status_code == 401, r.text
        body = r.json()
        assert "detail" in body
        msg = body["detail"].lower()
        # Either "missing a key id" or downstream "key not recognised"
        assert ("key id" in msg) or ("key not recognised" in msg) or ("not recognized" in msg), msg

    def test_envelope_shape_is_fastapi_detail(self, api_client):
        """All errors come back as `{"detail": "..."}` (FastAPI standard)."""
        r = api_client.post(APPLE_URL, json={"identity_token": ""})
        body = r.json()
        assert isinstance(body, dict)
        assert "detail" in body
        assert isinstance(body["detail"], str)

    def test_jwk_endpoint_reachable_from_backend(self, api_client):
        """Side-effect: after any 401 above, the JWK cache should be populated.
        We can't introspect the backend cache directly via HTTP, but we can
        confirm the JWK URL itself is reachable from this container (mirrors
        what the backend does)."""
        r = requests.get("https://appleid.apple.com/auth/keys", timeout=10)
        assert r.status_code == 200
        keys = (r.json() or {}).get("keys", [])
        assert isinstance(keys, list) and len(keys) >= 1
        assert all("kid" in k for k in keys)


# ---------------------------------------------------------------------------
# Regression smoke tests — other auth endpoints must still work
# ---------------------------------------------------------------------------
class TestAuthRegression:
    def test_demo_login_maggie(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/demo-login", json={"username": "maggie"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "access_token" in data
        assert "user" in data
        assert data["user"]["username"].lower() == "maggie"

    def test_signup_and_login(self, api_client):
        uname = f"appletest_{uuid.uuid4().hex[:8]}"
        signup = api_client.post(f"{BASE_URL}/api/auth/signup", json={
            "username": uname,
            "password": "secret123",
            "email": f"{uname}@example.com",
            "first_name": "AppleTest",
        })
        assert signup.status_code == 200, signup.text
        data = signup.json()
        assert "access_token" in data
        assert data["user"]["username"].lower() == uname.lower()

        login = api_client.post(f"{BASE_URL}/api/auth/login", json={
            "username": uname,
            "password": "secret123",
        })
        assert login.status_code == 200, login.text
        ldata = login.json()
        assert "access_token" in ldata
        assert ldata["user"]["username"].lower() == uname.lower()

    def test_google_endpoint_rejects_invalid_session(self, api_client):
        """Google OAuth endpoint should reject a bogus session_id — proves the
        route still exists & validates input, without needing a real session."""
        r = api_client.post(f"{BASE_URL}/api/auth/google", json={"session_id": "obviously-invalid-session-id-xxx"})
        assert r.status_code in (401, 400), r.text
        body = r.json()
        assert "detail" in body

    def test_login_invalid_credentials(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/login", json={
            "username": "nonexistent_user_xyz",
            "password": "badbadbad",
        })
        assert r.status_code in (400, 401), r.text
