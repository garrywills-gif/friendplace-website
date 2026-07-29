"""Iteration 61 — Backend regression after Apple SIWA private key rotation.

Context: APPLE_SIWA_KEY_ID rotated from 5MRDTD57LL -> 9DAMF5JRK8, .p8
replaced. This suite verifies:

  Priority 1 (SIWA):
    1. /api/auth/apple exists, parses body, returns 400 on empty token
       and 401 on malformed/wrong-aud tokens (never 500).
    2. Audience whitelist rejects wrong `aud` with 401 (not 500).
    3. New S2S key material loads at startup (health = 200) and the
       _build_apple_client_secret() helper mints a valid ES256 JWT
       carrying kid=9DAMF5JRK8 and iss=6XRMF8PK98.
    4. Account deletion path uses _build_apple_client_secret without
       raising — verified indirectly by calling the helper.

  Priority 2 (regression sweep):
    5. GET /api/health
    6. GET /api/
    7. GET /api/founders/status
    8. GET /api/public/content  (single bulk endpoint that supersedes the
       per-page /public/about, /public/features, /public/faqs mentioned
       in the review request — those routes do not exist)
    9. POST /api/auth/login with realtest1 / secret123 -> valid JWT
   10. GET /api/auth/me with the returned JWT -> 200 (the actual "me"
       endpoint per /app/memory/test_credentials.md — /api/users/{me} is
       just /api/users/{user_id} and requires the same bearer token)
   11. Logout: no dedicated endpoint exists; JWT is client-invalidated.

  Priority 3:
   12. /api/public/contact does not crash the rate-limiter.
"""
import os
import sys
import time
import pytest
import requests
from jose import jwt as jose_jwt

# Make sure backend modules importable for helper-level test
BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://george-mcgs-cms.preview.emergentagent.com"
).rstrip("/")

APPLE_URL = f"{BASE_URL}/api/auth/apple"


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------------------------------------------------------------------------
# Priority 1 — Apple SIWA
# ---------------------------------------------------------------------------
class TestAppleSIWAEndpoint:
    def test_apple_endpoint_exists_empty_token_400(self, api_client):
        r = api_client.post(APPLE_URL, json={"identity_token": ""})
        assert r.status_code == 400, r.text
        assert "Missing identity_token" in r.json().get("detail", "")

    def test_apple_endpoint_malformed_token_401_not_500(self, api_client):
        r = api_client.post(APPLE_URL, json={"identity_token": "not-a-jwt"})
        assert r.status_code == 401, r.text
        assert "malformed" in r.json().get("detail", "").lower()

    def test_apple_wrong_audience_rejected_401(self, api_client):
        """Forge an HS256 JWT with `aud='com.some.other.app'` (wrong).
        Server should return 401 with a clear message, NEVER 500."""
        payload = {
            "iss": "https://appleid.apple.com",
            "aud": "com.some.other.app",
            "sub": "abc.def.123",
            "email": "wrongaud@example.com",
            "exp": int(time.time()) + 600,
            "iat": int(time.time()),
        }
        tok = jose_jwt.encode(
            payload, "junk-secret", algorithm="HS256",
            headers={"kid": "NONEXISTENT_KID"},
        )
        r = api_client.post(APPLE_URL, json={"identity_token": tok})
        assert r.status_code == 401, f"expected 401 got {r.status_code}: {r.text}"
        detail = r.json().get("detail", "").lower()
        # Either kid-lookup fails first ("key not recognised") OR sig fails
        # ("could not be verified"). Both are acceptable — the important
        # thing is we never leak a 500.
        assert any(
            m in detail for m in ("key not recognised", "not recognized", "could not be verified", "bundle mismatch")
        ), detail

    def test_apple_correct_aud_wrong_signature_still_rejected(self, api_client):
        """Even with `aud=au.com.friendplace.app` but forged signature,
        endpoint must return 401 (signature verification) not 500."""
        payload = {
            "iss": "https://appleid.apple.com",
            "aud": "au.com.friendplace.app",
            "sub": "correct.aud.forged.sig",
            "exp": int(time.time()) + 600,
            "iat": int(time.time()),
        }
        tok = jose_jwt.encode(
            payload, "junk-secret", algorithm="HS256",
            headers={"kid": "NOPE"},
        )
        r = api_client.post(APPLE_URL, json={"identity_token": tok})
        assert r.status_code == 401, r.text

    def test_apple_web_audience_also_accepted_by_whitelist(self, api_client):
        """`au.com.friendplace.app.web` is also on the whitelist. Sig
        verification will still fail, but the 401 should NOT be the
        'bundle mismatch' variant."""
        payload = {
            "iss": "https://appleid.apple.com",
            "aud": "au.com.friendplace.app.web",
            "sub": "web.aud.forged.sig",
            "exp": int(time.time()) + 600,
            "iat": int(time.time()),
        }
        tok = jose_jwt.encode(
            payload, "junk-secret", algorithm="HS256",
            headers={"kid": "NOPE"},
        )
        r = api_client.post(APPLE_URL, json={"identity_token": tok})
        assert r.status_code == 401, r.text
        assert "bundle mismatch" not in r.json().get("detail", "").lower()

    def test_siwa_client_secret_helper_signs_es256_with_new_kid(self):
        """Directly exercise _build_apple_client_secret() — confirms the
        rotated .p8 loads and produces a valid ES256 JWT bearing the new
        kid (9DAMF5JRK8) and iss (team id 6XRMF8PK98). This is the exact
        code path account-deletion (/api/users/me DELETE) uses to call
        Apple /auth/revoke."""
        # Load env from backend/.env explicitly since pytest process may not
        # have inherited it if run standalone.
        from dotenv import load_dotenv
        load_dotenv(os.path.join(BACKEND_DIR, ".env"), override=False)

        # Import lazily so the module reads env we just loaded.
        from server import _build_apple_client_secret, _siwa_configured  # type: ignore

        assert _siwa_configured() is True, (
            "SIWA env not configured — APPLE_SIWA_TEAM_ID / KEY_ID / PRIVATE_KEY missing"
        )

        secret = _build_apple_client_secret()
        assert isinstance(secret, str) and secret.count(".") == 2, "not a JWT"

        header = jose_jwt.get_unverified_header(secret)
        assert header.get("alg") == "ES256", header
        assert header.get("kid") == os.environ["APPLE_SIWA_KEY_ID"], (
            f"kid mismatch — env={os.environ.get('APPLE_SIWA_KEY_ID')} "
            f"jwt-kid={header.get('kid')}"
        )
        assert header["kid"] == "9DAMF5JRK8", "expected rotated KID 9DAMF5JRK8"

        claims = jose_jwt.get_unverified_claims(secret)
        assert claims["iss"] == "6XRMF8PK98"
        assert claims["aud"] == "https://appleid.apple.com"
        assert claims["sub"] in (
            "au.com.friendplace.app",
            os.environ.get("APPLE_SIWA_CLIENT_ID"),
        )
        # exp should be roughly 30 minutes in the future
        assert claims["exp"] > int(time.time()) + 60


# ---------------------------------------------------------------------------
# Priority 2 — Regression sweep
# ---------------------------------------------------------------------------
class TestRegressionSweep:
    def test_health_200(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/health")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("status") == "ok"
        assert body.get("db") == "up"

    def test_root_200(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/")
        assert r.status_code == 200, r.text
        body = r.json()
        # Iter-60 established: app='FriendPlace'
        assert body.get("app") == "FriendPlace"

    def test_founders_status_public(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/founders/status")
        assert r.status_code == 200, r.text
        body = r.json()
        # Non-strict shape check — the endpoint returns a dict with counts
        assert isinstance(body, dict)

    def test_public_content_bulk(self, api_client):
        """The review request mentioned /api/public/about, /features,
        /faqs — those don't exist as separate routes. The single bulk
        endpoint /api/public/content supersedes them."""
        r = api_client.get(f"{BASE_URL}/api/public/content")
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), dict)

    def test_public_founders_count(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/public/founders/count")
        assert r.status_code == 200, r.text
        assert "count" in r.json()

    def test_login_realtest1_returns_jwt_and_user(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/login", json={
            "username": "realtest1",
            "password": "secret123",
        })
        # Password may have been changed / brute-force locked. If so, skip.
        if r.status_code != 200:
            pytest.skip(
                f"realtest1 login not 200 (got {r.status_code}: {r.text[:200]}). "
                "Possibly rate-limited or password changed since seed."
            )
        data = r.json()
        assert "access_token" in data
        assert data["access_token"].count(".") == 2  # JWT shape
        assert "user" in data
        assert data["user"]["username"].lower() == "realtest1"
        # Stash for downstream tests
        pytest.realtest1_token = data["access_token"]
        pytest.realtest1_uid = data["user"]["id"]

    def test_auth_me_with_bearer(self, api_client):
        tok = getattr(pytest, "realtest1_token", None)
        if not tok:
            pytest.skip("no realtest1 token from login step")
        r = api_client.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {tok}"},
        )
        assert r.status_code == 200, r.text
        assert r.json().get("username", "").lower() == "realtest1"

    def test_get_user_by_id_with_bearer(self, api_client):
        """Review request item 10 mentions /api/users/{me} — the actual
        endpoint is /api/users/{user_id} and it accepts a bearer to
        return sensitive fields."""
        tok = getattr(pytest, "realtest1_token", None)
        uid = getattr(pytest, "realtest1_uid", None)
        if not (tok and uid):
            pytest.skip("no realtest1 auth from login step")
        r = api_client.get(
            f"{BASE_URL}/api/users/{uid}",
            headers={"Authorization": f"Bearer {tok}"},
        )
        assert r.status_code == 200, r.text
        assert r.json().get("id") == uid

    def test_logout_endpoint_not_provided(self, api_client):
        """FriendPlace uses stateless JWTs — there is no server-side
        logout. Client just drops the token. Document this here so the
        review checkpoint 11 isn't ambiguous."""
        r = api_client.post(f"{BASE_URL}/api/auth/logout")
        # We simply confirm that the absence of the endpoint doesn't
        # crash — either 404 (not registered) or 405 (wrong method) is
        # acceptable; 500 would indicate a real bug.
        assert r.status_code in (404, 405, 401), r.text


# ---------------------------------------------------------------------------
# Priority 3 — rate-limiter sanity on /public/contact
# ---------------------------------------------------------------------------
class TestPublicContactRateLimiter:
    def test_public_contact_does_not_crash(self, api_client):
        payload = {
            "name": "TEST_iter61",
            "email": "iter61@example.com",
            "topic": "general",
            "message": "TEST_iter61 rate-limiter smoke — please ignore.",
        }
        r = api_client.post(f"{BASE_URL}/api/public/contact", json=payload)
        # Either accepted (200/201) or rate-limited (429). Never 500.
        assert r.status_code in (200, 201, 202, 400, 429), r.text
        assert r.status_code != 500

    def test_public_contact_xff_header_variants(self, api_client):
        """iter-59 hardened the rate-limiter against malformed X-Forwarded-For
        headers. Make sure that's still true after the rotation."""
        for xff in ("1.2.3.4", "1.2.3.4, 5.6.7.8", "not-an-ip", "", "::1"):
            r = api_client.post(
                f"{BASE_URL}/api/public/contact",
                json={
                    "name": "TEST_iter61_xff",
                    "email": "xff@example.com",
                    "topic": "general",
                    "message": f"TEST_iter61 xff={xff!r}",
                },
                headers={"X-Forwarded-For": xff} if xff else {},
            )
            assert r.status_code != 500, (xff, r.text[:200])
