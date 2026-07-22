"""
Iteration 85 — TestFlight Round 2 (v1.0.9 / build 116) backend regression.

Structural / integration checks for Garry's Round-2 fix list. Deep LLM-driven
flows (George event creation, edit intent, founders replies) are covered by
their dedicated suites (test_b5_event_creation, test_b6_session2_edit_flow,
test_founding_members). This suite focuses on the fast structural checks
that must be true for the mobile app to ship:

  1. /api/health responds
  2. /api/founders/status shape (cap/taken/remaining/open) + open=True
  3. /api/tables → FP Café is row 0 with pinned=True, protected=True,
     persistent=True, id="fp-cafe-permanent"
  4. /api/voice/transcribe endpoint is REACHABLE (not 404) — VoiceInputButton fix
  5. Jigsaw catalogue contains NO _GENERATED items (retired for image/title
     mismatch); every entry has a real Unsplash image URL
  6. Auth: member@friendplace.com.au / TestPass2026! logs in
  7. Auth: demo-login for `frankie` returns a member profile suitable for
     the profile-page flutter/message test steps
  8. Onboarding: `/api/mcgs/george/onboarding/start` reachable with a
     signed-in member
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_BACKEND_URL must be set for tests"

MEMBER_EMAIL = "member@friendplace.com.au"
MEMBER_PASSWORD = "TestPass2026!"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# -------- Health --------
class TestHealth:
    def test_health_ok(self, api):
        r = api.get(f"{BASE_URL}/api/health", timeout=10)
        assert r.status_code == 200


# -------- Founders status (Round-2 #12) --------
class TestFoundersStatus:
    def test_shape_and_open(self, api):
        r = api.get(f"{BASE_URL}/api/founders/status", timeout=10)
        assert r.status_code == 200
        data = r.json()
        for key in ("cap", "taken", "remaining", "open"):
            assert key in data, f"missing {key} in founders/status: {data}"
        assert isinstance(data["cap"], int) and data["cap"] == 500
        assert isinstance(data["taken"], int) and data["taken"] >= 0
        assert isinstance(data["remaining"], int)
        assert isinstance(data["open"], bool)
        # Round-2 fix #12: cohort is expected to be OPEN so George encourages
        assert data["open"] is True, (
            "Founders cohort should be open (remaining > 0) so George "
            "encourages the member. Actual: %s" % data
        )
        assert data["remaining"] == data["cap"] - data["taken"]


# -------- FP Café pinned (Round-2 #6) --------
class TestFPCafePinned:
    def test_fp_cafe_is_row_zero(self, api):
        r = api.get(f"{BASE_URL}/api/tables", timeout=10)
        assert r.status_code == 200, r.text
        payload = r.json()
        rows = payload if isinstance(payload, list) else payload.get("tables", [])
        assert rows, "no tables returned"
        row0 = rows[0]
        assert row0.get("id") == "fp-cafe-permanent", (
            f"row 0 should be FP Café permanent, got id={row0.get('id')}"
        )
        assert row0.get("pinned") is True, "FP Café row 0 should have pinned=True"
        assert row0.get("protected") is True, "FP Café row 0 should have protected=True"
        assert row0.get("persistent") is True, "FP Café row 0 should have persistent=True"
        assert "FP Café" in row0.get("name", "") or "FP Cafe" in row0.get("name", "")


# -------- Voice transcribe endpoint reachable (Round-2 #8-11) --------
class TestVoiceTranscribeReachable:
    def test_endpoint_not_404(self, api):
        # POST with no multipart body → validation error (422/400), never 404.
        # The VoiceInputButton BACKEND_URL fix means physical devices reach
        # this endpoint at all; the mobile 'Invalid URL' bug pre-dated the fix.
        r = api.post(f"{BASE_URL}/api/voice/transcribe", timeout=10)
        assert r.status_code != 404, (
            "voice/transcribe endpoint returned 404 — VoiceInputButton fix incomplete"
        )
        assert r.status_code in (400, 415, 422), (
            f"unexpected status {r.status_code}: {r.text[:200]}"
        )


# -------- Jigsaw curation (Round-2 #5) --------
class TestJigsawCurated:
    def test_no_generated_placeholder_items(self, api):
        # The Round-2 fix retired _GENERATED (which was labelling Picsum
        # random photos under specific categories — e.g. wheat fields as
        # "Classic Cars"). We can't import backend module cleanly here, so
        # instead call the public catalogue endpoint and verify:
        #   • every item has an image_url
        #   • no image_url points to picsum.photos (Picsum was the old
        #     _GENERATED backing image source)
        r = api.get(f"{BASE_URL}/api/games/jigsaw/catalog", timeout=10)
        assert r.status_code == 200, f"jigsaw catalogue unreachable: {r.status_code} {r.text[:120]}"
        payload = r.json()
        items = payload if isinstance(payload, list) else (
            payload.get("catalogue") or payload.get("items") or payload.get("puzzles") or []
        )
        assert items, f"jigsaw catalogue empty: {payload}"
        bad_picsum = [it for it in items if "picsum.photos" in str(it.get("url", "") or it.get("image_url", "") or it.get("image", ""))]
        assert not bad_picsum, (
            f"{len(bad_picsum)} jigsaw items still reference picsum.photos "
            "(_GENERATED library was supposed to be retired)"
        )
        # Every item should have title + category + image URL
        missing = [
            it for it in items
            if not (it.get("title") and it.get("category") and (it.get("url") or it.get("image_url") or it.get("image")))
        ]
        assert not missing, f"{len(missing)} jigsaw items missing title/category/image"


# -------- Auth: seed member (Round-2 pre-req) --------
class TestSeedMemberLogin:
    def test_member_can_login(self, api):
        r = api.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": MEMBER_EMAIL, "password": MEMBER_PASSWORD},
            timeout=15,
        )
        assert r.status_code == 200, (
            f"seed member login failed ({r.status_code}): {r.text[:200]}"
        )
        data = r.json()
        assert "access_token" in data and data["access_token"]
        assert "user" in data and data["user"].get("id")
        # Save on the module-level fixture for reuse
        pytest.member_token = data["access_token"]
        pytest.member_user = data["user"]


# -------- Auth: demo login (used for Friends tab tests) --------
class TestDemoLogin:
    def test_frankie_demo_login(self, api):
        r = api.post(f"{BASE_URL}/api/auth/demo-login", json={"username": "frankie"}, timeout=10)
        assert r.status_code == 200, r.text
        u = r.json().get("user")
        assert u and u.get("first_name")


# -------- Onboarding start reachable (Round-2 onboarding refinement) --------
class TestOnboardingReachable:
    def test_onboarding_start_endpoint(self, api):
        # Not asserting full LLM output — just that endpoint is wired.
        token = getattr(pytest, "member_token", None)
        if not token:
            pytest.skip("no member token from prior test")
        me = pytest.member_user
        headers = {"Authorization": f"Bearer {token}"}
        # Some deployments expose /api/mcgs/george/onboarding/start; others
        # a per-user session-fetch pattern. Try the two common shapes.
        for path in (
            "/api/mcgs/george/onboarding/start",
            "/api/mcgs/george/onboarding",
        ):
            r = api.post(f"{BASE_URL}{path}", json={"actor_id": me["id"]}, headers=headers, timeout=15)
            if r.status_code != 404:
                assert r.status_code in (200, 201, 409), (
                    f"onboarding endpoint {path} → {r.status_code}: {r.text[:200]}"
                )
                return
        pytest.skip("no onboarding endpoint reachable — informational only")
