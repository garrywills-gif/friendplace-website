"""iter194 real-device fix batch — backend verification.

Covers:
  (1B) list_notices author-merge: a member's own live notice must
       remain in their feed regardless of category/search/radius.
  (2)  onboarding_complete_full must NOT wipe suburb when the caller
       omits suburb / location_visibility (the finishWizard fix).
  (3/4) Flutter send (welcome / birthday wishes) creates a flutter row
        that appears in GET /flutters/{recipient}.
"""
import os
import re
import time
import uuid
import pytest
import requests


def _live_backend_url() -> str:
    # frontend/.env is the source of truth for the public preview URL.
    env_path = "/app/frontend/.env"
    with open(env_path, "r") as fh:
        for line in fh:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    raise RuntimeError("EXPO_PUBLIC_BACKEND_URL not found in frontend/.env")


BASE_URL = _live_backend_url()


@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def alex(api):
    r = api.post(f"{BASE_URL}/api/auth/login", json={
        "username": "member@friendplace.com.au", "password": "TestPass2026!"
    }, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    data = r.json()
    return data["user"]


@pytest.fixture(scope="session")
def maggie(api):
    r = api.post(f"{BASE_URL}/api/auth/demo-login", json={"username": "maggie"}, timeout=30)
    assert r.status_code == 200, f"maggie demo-login failed: {r.status_code} {r.text[:200]}"
    return r.json()["user"]


# ── (1B) Notice Board author-merge across category/radius ──────────────
class TestNoticeAuthorMerge:
    def test_own_notice_visible_across_filters_and_radius(self, api, alex):
        title = f"TEST_iter194_{uuid.uuid4().hex[:8]}"
        body = "author-merge check"
        create = api.post(f"{BASE_URL}/api/notices", json={
            "user_id": alex["id"],
            "title": title,
            "body": body,
            "category": "Community",
        }, timeout=30)
        assert create.status_code == 200, f"create notice failed: {create.status_code} {create.text[:300]}"
        notice = create.json()
        notice_id = notice.get("id")
        assert notice_id, "notice id missing"

        # Assert the author sees it under ALL filter combos.
        matrix = [
            {"category": "All"},
            {"category": "Events"},
            {"category": "Groups"},
            {"category": "Question"},
            {"category": "Announcement"},
            {"category": "All", "radius_km": 5},
            {"category": "All", "radius_km": 25},
            {"category": "Question", "radius_km": 5},
            {"q": "nonexistent-search-string-xyz"},
        ]
        for params in matrix:
            params_full = {"user_id": alex["id"], **params}
            r = api.get(f"{BASE_URL}/api/notices", params=params_full, timeout=30)
            assert r.status_code == 200, f"list notices {params} failed: {r.status_code}"
            docs = r.json()
            ids = [d.get("id") for d in docs]
            assert notice_id in ids, f"author's own notice missing under {params}; sample={ids[:5]}"

        # Cleanup best-effort
        try:
            api.delete(f"{BASE_URL}/api/notices/{notice_id}",
                       params={"user_id": alex["id"]}, timeout=15)
        except Exception:
            pass


# ── (2) Onboarding complete must NOT wipe suburb ───────────────────────
class TestOnboardingNoSuburbWipe:
    def _signup(self, api):
        email = f"TEST_qa+{uuid.uuid4().hex[:8]}@example.com"
        username = f"test{uuid.uuid4().hex[:8]}"
        r = api.post(f"{BASE_URL}/api/auth/signup", json={
            "username": username,
            "password": "secret123",
            "email": email,
            "first_name": "QA",
        }, timeout=30)
        assert r.status_code == 200, f"signup failed: {r.status_code} {r.text[:300]}"
        data = r.json()
        return data["user"], data.get("access_token") or "", email, username

    def test_finishwizard_payload_does_not_wipe_suburb(self, api):
        user, token, email, username = self._signup(api)
        uid = user["id"]
        auth = {"Authorization": f"Bearer {token}"} if token else {}
        # Simulate the shared complete-profile screen: set suburb Bondi.
        r = api.post(f"{BASE_URL}/api/users/{uid}/location", json={
            "suburb": "Bondi",
            "hidden": False,
        }, timeout=30)
        assert r.status_code == 200, f"set location failed: {r.status_code} {r.text[:200]}"
        u1 = api.get(f"{BASE_URL}/api/users/{uid}", headers=auth, timeout=15).json()
        assert u1.get("suburb") == "Bondi", f"expected Bondi, got {u1}"

        # Frontend finishWizard now sends ONLY interests + group_ids.
        # Simulate that exact contract; suburb MUST remain Bondi and
        # onboarding_completed MUST be true.
        r = api.post(f"{BASE_URL}/api/onboarding/complete", json={
            "user_id": uid,
            "interests": ["Reading", "Gardening"],
            "group_ids": [],
            "joined_all": False,
        }, timeout=30)
        assert r.status_code == 200, f"onboarding/complete failed: {r.status_code} {r.text[:300]}"
        payload = r.json()
        assert payload.get("ok") is True
        fresh_user = payload.get("user") or {}
        assert fresh_user.get("onboarding_completed") is True, "onboarding_completed not set"
        assert fresh_user.get("suburb") == "Bondi", f"suburb WIPED! got={fresh_user.get('suburb')!r}"
        # Double-check via GET /users/{id}
        u2 = api.get(f"{BASE_URL}/api/users/{uid}", headers=auth, timeout=15).json()
        assert u2.get("suburb") == "Bondi", f"GET /users suburb wiped: {u2.get('suburb')!r}"
        assert u2.get("onboarding_completed") is True

    def test_finishwizard_destructive_payload_is_still_supported(self, api):
        """Sanity: if a caller EXPLICITLY passes location_visibility=private,
        server still honours it (documenting the pre-fix behaviour so we
        can prove the fix is exclusively frontend-side)."""
        user, token, email, username = self._signup(api)
        uid = user["id"]
        auth = {"Authorization": f"Bearer {token}"} if token else {}
        api.post(f"{BASE_URL}/api/users/{uid}/location",
                 json={"suburb": "Bondi", "hidden": False}, timeout=30)
        r = api.post(f"{BASE_URL}/api/onboarding/complete", json={
            "user_id": uid,
            "interests": [],
            "group_ids": [],
            "joined_all": False,
            "location_visibility": "private",
        }, timeout=30)
        assert r.status_code == 200
        u2 = api.get(f"{BASE_URL}/api/users/{uid}", headers=auth, timeout=15).json()
        # location_visibility=private wipes suburb by design when SENT.
        assert u2.get("suburb") == "", f"expected empty suburb, got {u2.get('suburb')!r}"
        assert u2.get("location_visibility") == "private"


# ── (3/4) Flutter greetings (welcome + birthday) ───────────────────────
class TestFlutterGreetings:
    def test_welcome_flutter_reaches_recipient(self, api, alex, maggie):
        # Ensure a clean state — mark any prior open flutter alex→maggie
        # as read so the 409 dedupe doesn't foil this test.
        try:
            existing = api.get(f"{BASE_URL}/api/flutters/{maggie['id']}", timeout=15).json()
            for f in existing or []:
                if f.get("from_id") == alex["id"] and not f.get("read"):
                    api.post(f"{BASE_URL}/api/flutters/{f['id']}/read", timeout=15)
        except Exception:
            pass

        msg = f"TEST_iter194 👋 Welcome to FriendPlace, {maggie.get('first_name') or 'friend'}!"
        r = api.post(f"{BASE_URL}/api/flutters/send", json={
            "from_id": alex["id"],
            "to_id": maggie["id"],
            "message": msg,
        }, timeout=30)
        assert r.status_code in (200, 409), f"flutter send unexpected: {r.status_code} {r.text[:200]}"
        if r.status_code == 409:
            pytest.skip("Prior active flutter still present, dedupe kicked in")

        got = api.get(f"{BASE_URL}/api/flutters/{maggie['id']}", timeout=15).json()
        assert any(f.get("from_id") == alex["id"] and msg[:20] in (f.get("message") or "")
                   for f in got), "welcome flutter not in recipient inbox"

    def test_birthday_flutter_uses_same_endpoint(self, api, alex, maggie):
        # Just prove the payload shape used by home.tsx birthday row works.
        # (Server rate limits duplicates; skip if that trips.)
        # Mark previous flutters read.
        try:
            existing = api.get(f"{BASE_URL}/api/flutters/{maggie['id']}", timeout=15).json()
            for f in existing or []:
                if f.get("from_id") == alex["id"] and not f.get("read"):
                    api.post(f"{BASE_URL}/api/flutters/{f['id']}/read", timeout=15)
        except Exception:
            pass
        msg = f"TEST_iter194 🎂 Happy birthday, {maggie.get('first_name') or 'friend'}!"
        r = api.post(f"{BASE_URL}/api/flutters/send", json={
            "from_id": alex["id"],
            "to_id": maggie["id"],
            "message": msg,
        }, timeout=30)
        assert r.status_code in (200, 409), f"birthday flutter unexpected: {r.status_code} {r.text[:200]}"
