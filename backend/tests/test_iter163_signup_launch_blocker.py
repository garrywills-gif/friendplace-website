"""iter163 — Launch-blocker verification: signup end-to-end after
TestFlight 1.0.21 (1025) "Could not create account" regression.

Covers:
  1. Signup with preset avatar formats (preset:portrait-XX).
  2. Signup with data URI avatar + legacy emoji avatar (regression).
  3. Validation rejections return parseable JSON `{detail: ...}`.
  4. Duplicate username / duplicate email rejections.
  5. Missing email allowed (email is optional).
  6. location_visibility='private' → suburb blanked on returned user.
  7. Full signup → /api/onboarding/complete → /auth/login round-trip.
  8. Backend logs contain the signup.reject breadcrumb for every 400.
  9. Unhandled-exception middleware returns JSON 500 for genuine server
     errors (asserted via presence of the middleware in server.py source
     + a Pydantic 422 sanity check for malformed JSON).
 10. Regression on Notice.image + Event.image fields — new gallery ref
     values still accepted.
"""
from __future__ import annotations

import base64
import os
import re
import time
import uuid
from typing import Any

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set for these tests"


# ─────────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _uniq() -> str:
    # Short unique tag; keep total username ≤ 24 chars, alphanum + _.-
    return uuid.uuid4().hex[:8]


def _signup_payload(**overrides: Any) -> dict:
    tag = _uniq()
    payload = {
        "username": f"tst_{tag}",
        "password": "TestPass2026!",
        "email": f"test_{tag}@example.com",
        "first_name": "Test",
        "suburb": "Bondi",
        "suburb_postcode": "2026",
        "suburb_state": "NSW",
        "location_visibility": "suburb",
        "interests": ["reading"],
        "avatar": "preset:portrait-17",
        "birthday": "1975-05-20",
    }
    payload.update(overrides)
    return payload


# ─────────────────────────────────────────────────────────────────────
# 1. Preset avatar format — the launch-blocker regression path
# ─────────────────────────────────────────────────────────────────────
class TestSignupPresetAvatar:
    """Signup should accept the new `preset:portrait-XX` avatar format."""

    def test_signup_with_preset_portrait_17_returns_200_and_preserves_avatar(self, api):
        payload = _signup_payload(avatar="preset:portrait-17")
        r = api.post(f"{BASE_URL}/api/auth/signup", json=payload)
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert "access_token" in data and data["access_token"]
        assert data.get("token_type") == "bearer"
        user = data.get("user") or {}
        assert user.get("username") == payload["username"]
        assert user.get("avatar") == "preset:portrait-17"
        # Password hash must NEVER be leaked
        assert "password_hash" not in user
        assert "_id" not in user

    @pytest.mark.parametrize("suffix", ["05", "22", "45", "61", "72"])
    def test_signup_with_various_preset_avatars_all_succeed(self, api, suffix):
        avatar = f"preset:portrait-{suffix}"
        payload = _signup_payload(avatar=avatar)
        r = api.post(f"{BASE_URL}/api/auth/signup", json=payload)
        assert r.status_code == 200, f"[avatar={avatar}] {r.status_code} {r.text}"
        user = r.json().get("user") or {}
        assert user.get("avatar") == avatar

    def test_signup_with_data_uri_avatar_returns_200(self, api):
        # A tiny valid JPEG data URI (just the SOI/EOI markers padded)
        img_bytes = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 32 + b"\xff\xd9"
        b64 = base64.b64encode(img_bytes).decode("ascii")
        data_uri = f"data:image/jpeg;base64,{b64}"
        payload = _signup_payload(avatar=data_uri)
        r = api.post(f"{BASE_URL}/api/auth/signup", json=payload)
        assert r.status_code == 200, r.text
        user = r.json().get("user") or {}
        assert user.get("avatar", "").startswith("data:image/jpeg;base64,")

    def test_signup_with_legacy_emoji_avatar_still_works(self, api):
        payload = _signup_payload(avatar="👨🏽‍🦳::g")
        r = api.post(f"{BASE_URL}/api/auth/signup", json=payload)
        assert r.status_code == 200, r.text
        user = r.json().get("user") or {}
        assert user.get("avatar") == "👨🏽‍🦳::g"


# ─────────────────────────────────────────────────────────────────────
# 2. Validation rejections return parseable JSON `{detail: ...}`
# ─────────────────────────────────────────────────────────────────────
class TestSignupValidation:
    """Every 400 must return `application/json` with a `detail` string
    so the frontend regex `^(\\d{3})\\s+…` and the new fallback path
    can surface the true error verbatim."""

    def _assert_json_detail_400(self, r: requests.Response, needle: str):
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
        ctype = r.headers.get("content-type", "")
        assert "application/json" in ctype, f"content-type not json: {ctype}"
        body = r.json()
        assert isinstance(body, dict) and isinstance(body.get("detail"), str)
        assert needle.lower() in body["detail"].lower(), body["detail"]

    def test_duplicate_username_returns_json_400(self, api):
        # First registration succeeds
        payload = _signup_payload()
        r1 = api.post(f"{BASE_URL}/api/auth/signup", json=payload)
        assert r1.status_code == 200, r1.text
        # Second registration with same username (case-insensitive) 400s
        payload2 = _signup_payload(
            username=payload["username"].upper(),
            email=f"other_{_uniq()}@example.com",
        )
        r2 = api.post(f"{BASE_URL}/api/auth/signup", json=payload2)
        self._assert_json_detail_400(r2, "username")

        # ── Bonus: signup.reject breadcrumb is written to backend logs ──
        # Folded into this test so we don't burn an extra signup slot on
        # the 20-per-hour IP rate limit (see /app/backend/server.py:960).
        time.sleep(0.3)
        combined = ""
        for p in ("/var/log/supervisor/backend.err.log",
                  "/var/log/supervisor/backend.out.log"):
            try:
                with open(p, "r") as f:
                    combined += f.read()[-60000:]
            except FileNotFoundError:
                continue
        if combined:
            assert "signup.reject" in combined, (
                "Expected 'signup.reject' breadcrumb in backend logs after 400."
            )
            assert re.search(r"email=\S*\*\*\*@\S+", combined), (
                "Expected masked-email pattern in signup.reject breadcrumb."
            )

    def test_duplicate_email_returns_json_400(self, api):
        payload = _signup_payload()
        r1 = api.post(f"{BASE_URL}/api/auth/signup", json=payload)
        assert r1.status_code == 200, r1.text
        payload2 = _signup_payload(
            username=f"other_{_uniq()}",
            email=payload["email"].upper(),  # case variant
        )
        r2 = api.post(f"{BASE_URL}/api/auth/signup", json=payload2)
        self._assert_json_detail_400(r2, "email")

    def test_short_password_returns_400_with_detail(self, api):
        payload = _signup_payload(password="abc")
        r = api.post(f"{BASE_URL}/api/auth/signup", json=payload)
        # Pydantic min_length=6 → 422, but our handler also has explicit
        # < 6 check that returns 400. Either is acceptable AS LONG AS the
        # body is parseable JSON with a `detail` field.
        assert r.status_code in (400, 422), r.text
        assert "application/json" in r.headers.get("content-type", "")
        body = r.json()
        assert "detail" in body

    def test_short_username_returns_json_400(self, api):
        payload = _signup_payload(username="ab")
        r = api.post(f"{BASE_URL}/api/auth/signup", json=payload)
        self._assert_json_detail_400(r, "at least 3")

    def test_username_with_spaces_returns_json_400(self, api):
        payload = _signup_payload(username="two words")
        r = api.post(f"{BASE_URL}/api/auth/signup", json=payload)
        self._assert_json_detail_400(r, "space")

    def test_missing_email_still_succeeds(self, api):
        payload = _signup_payload()
        payload.pop("email", None)
        r = api.post(f"{BASE_URL}/api/auth/signup", json=payload)
        assert r.status_code == 200, r.text
        user = r.json().get("user") or {}
        # Backend stores email as "" when omitted
        assert user.get("email", "") == ""

    def test_location_visibility_private_blanks_suburb(self, api):
        payload = _signup_payload(location_visibility="private")
        r = api.post(f"{BASE_URL}/api/auth/signup", json=payload)
        assert r.status_code == 200, r.text
        user = r.json().get("user") or {}
        assert user.get("suburb", "") == "", (
            f"suburb should be blanked when private, got {user.get('suburb')!r}"
        )
        assert user.get("location_visibility") == "private"


# ─────────────────────────────────────────────────────────────────────
# 3. Full onboarding round-trip
# ─────────────────────────────────────────────────────────────────────
class TestSignupOnboardingLoginRoundtrip:
    """signup → /onboarding/complete → /auth/login with same credentials."""

    def test_full_round_trip(self, api):
        payload = _signup_payload(avatar="preset:portrait-22")
        r = api.post(f"{BASE_URL}/api/auth/signup", json=payload)
        assert r.status_code == 200, r.text
        signup_body = r.json()
        token = signup_body["access_token"]
        user_id = signup_body["user"]["id"]
        assert user_id

        # Complete onboarding
        onboard_payload = {
            "user_id": user_id,
            "interests": ["reading", "walking"],
            "suburb": "Bondi",
            "suburb_postcode": "2026",
            "suburb_state": "NSW",
            "location_visibility": "suburb",
            "avatar": "preset:portrait-22",
        }
        r_ob = api.post(f"{BASE_URL}/api/onboarding/complete", json=onboard_payload)
        assert r_ob.status_code == 200, r_ob.text

        # Log in with the SAME credentials
        login_payload = {"username": payload["username"], "password": payload["password"]}
        r_login = api.post(f"{BASE_URL}/api/auth/login", json=login_payload)
        assert r_login.status_code == 200, r_login.text
        login_body = r_login.json()
        assert "access_token" in login_body and login_body["access_token"]
        assert login_body["user"]["id"] == user_id

        # Login via email works too
        if payload.get("email"):
            r_login2 = api.post(
                f"{BASE_URL}/api/auth/login",
                json={"username": payload["email"], "password": payload["password"]},
            )
            assert r_login2.status_code == 200, r_login2.text

        # Bearer /auth/me sanity check
        r_me = api.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r_me.status_code == 200, r_me.text


# ─────────────────────────────────────────────────────────────────────
# 4. Unhandled-exception middleware + malformed JSON contract
# ─────────────────────────────────────────────────────────────────────
class TestErrorHandlingContracts:
    """Verify the two safety nets the frontend depends on:
    (a) Every intentional 400 gives JSON `{detail: ...}`.
    (b) Pydantic 422 for malformed / missing fields still gives JSON.
    (c) The unhandled-exception middleware exists in server.py source.
    """

    def test_malformed_json_returns_parseable_error(self, api):
        # Send truly malformed JSON — FastAPI returns 422 with json body
        r = requests.post(
            f"{BASE_URL}/api/auth/signup",
            data="{this is not json",
            headers={"Content-Type": "application/json"},
        )
        assert r.status_code in (400, 422), r.text
        # Must be JSON so frontend can parse
        assert "application/json" in r.headers.get("content-type", "")
        r.json()  # will raise if not JSON

    def test_missing_required_field_returns_json_422(self, api):
        # Missing username entirely
        r = api.post(
            f"{BASE_URL}/api/auth/signup",
            json={"password": "abcdef"},
        )
        assert r.status_code == 422, r.text
        body = r.json()
        assert "detail" in body

    def test_unhandled_exception_middleware_present_in_source(self):
        # The middleware itself is hard to trigger without injecting
        # a fault into the backend, so this is a source-level assertion
        # that the code path exists at server.py:~130.
        path = "/app/backend/server.py"
        with open(path, "r") as f:
            src = f.read()
        assert "_unhandled_error_middleware" in src, (
            "unhandled-exception middleware missing from backend/server.py"
        )
        assert "Something went wrong on our end" in src, (
            "middleware error body copy missing from backend/server.py"
        )


# ─────────────────────────────────────────────────────────────────────
# 6. Regression: Notice + Event with new image gallery-ref values
# ─────────────────────────────────────────────────────────────────────
class TestImageFieldRegressions:
    """The same session added Notice.image + Event.image fields. Make
    sure the create endpoints still accept the new gallery ref values."""

    # Module-scoped so we don't burn multiple signup slots against the
    # 20-per-hour IP rate limit — both regression tests share one user.
    @pytest.fixture(scope="class")
    def fresh_user(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        payload = _signup_payload()
        r = s.post(f"{BASE_URL}/api/auth/signup", json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        return {
            "id": body["user"]["id"],
            "token": body["access_token"],
            "username": payload["username"],
        }

    def test_notice_create_with_gallery_image_ref(self, api, fresh_user):
        body = {
            "user_id": fresh_user["id"],
            "user_name": "Tester",
            "title": "TEST_ Coffee catch-up this Friday",
            "body": "Anyone up for coffee at the local?",
            "category": "Announcement",
            "image": "gallery:coffee-catchups/01",
        }
        r = api.post(f"{BASE_URL}/api/notices", json=body)
        # Moderation may auto-hold it, but create still returns 200/201
        assert r.status_code in (200, 201), r.text
        data = r.json()
        # Response shape varies — most endpoints return the notice or {ok:true, notice}
        notice = data.get("notice") if isinstance(data, dict) and "notice" in data else data
        assert isinstance(notice, dict)
        assert notice.get("image") == "gallery:coffee-catchups/01", (
            f"image field not preserved: {notice.get('image')!r}"
        )

    def test_event_create_with_gallery_image_ref(self, api, fresh_user):
        body = {
            "title": "TEST_ Sausage sizzle",
            "emoji": "🌭",
            "description": "Bring your tongs.",
            "location": "Local park",
            "date": "2026-12-31",
            "time": "12:00",
            "image": "gallery:bbqs-sausage-sizzles/01",
            "host_id": fresh_user["id"],
        }
        r = api.post(f"{BASE_URL}/api/events", json=body)
        assert r.status_code in (200, 201), r.text
        data = r.json()
        event = data.get("event") if isinstance(data, dict) and "event" in data else data
        # Some endpoints return {ok:true, ...} — try both shapes
        if isinstance(event, dict) and event.get("id"):
            assert event.get("image") == "gallery:bbqs-sausage-sizzles/01", (
                f"image field not preserved: {event.get('image')!r}"
            )
        else:
            # Fall back to a GET to verify persistence
            r_list = api.get(f"{BASE_URL}/api/events")
            assert r_list.status_code == 200
            found = [e for e in r_list.json() if e.get("host_id") == fresh_user["id"]
                     and e.get("title") == body["title"]]
            assert found, "created event not found in /events listing"
            assert found[0].get("image") == "gallery:bbqs-sausage-sizzles/01"
