"""Backend tests for the Launch Manager feature (iteration 123).

Covers:
- Public GET /api/public/launch-status (unauth)
- Admin GET/PATCH /api/cms/settings/launch (auth)
- Store-URL validation (rejects invalid App Store / Play Store URLs)
- Anti-premature-click safeguard (store URLs empty until is_live=true)
- George's readiness observation tones across states
- Grammar check: plural "aren't" + "them" when BOTH store links missing
- admin_log dual-write of `launch.settings.update`
"""
import os
import time
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = "http://localhost:8001"
ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PW = "TestPass2026!"

VALID_APP = "https://apps.apple.com/au/app/friendplace/id0000"
VALID_PLAY = "https://play.google.com/store/apps/details?id=com.friendplace"


# ─── fixtures ──────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{BASE_URL}/api/cms/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PW},
        timeout=10,
    )
    assert r.status_code == 200, f"CMS login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def h(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module", autouse=True)
def _restore_settings(admin_token):
    """Snapshot settings before tests → restore after so we leave a
    reasonable state per the review-request cleanup contract."""
    hh = {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}
    r = requests.get(f"{BASE_URL}/api/cms/settings/launch", headers=hh, timeout=10)
    snapshot = r.json().get("settings") if r.status_code == 200 else {}
    yield
    # Leave a well-formed far-future state with valid URLs
    future = (datetime.now(timezone.utc) + timedelta(days=45)).isoformat()
    requests.patch(
        f"{BASE_URL}/api/cms/settings/launch",
        headers=hh,
        json={
            "launch_at": snapshot.get("launch_at") or future,
            "enabled": bool(snapshot.get("enabled", True)),
            "appstore_url": snapshot.get("appstore_url") or VALID_APP,
            "playstore_url": snapshot.get("playstore_url") or VALID_PLAY,
            "press_kit_ready": bool(snapshot.get("press_kit_ready", False)),
            "launch_complete": False,
            "founding_target": int(snapshot.get("founding_target") or 100),
            "welcome_message": snapshot.get("welcome_message")
            or "🦋 The doors are open. Welcome to FriendPlace.",
        },
        timeout=10,
    )


def _patch(h, body):
    r = requests.patch(
        f"{BASE_URL}/api/cms/settings/launch", headers=h, json=body, timeout=10
    )
    return r


def _public():
    r = requests.get(f"{BASE_URL}/api/public/launch-status", timeout=10)
    return r


# ─── 1. Public endpoint ────────────────────────────────────────────────
class TestPublicLaunchStatus:
    def test_shape_and_unauthenticated(self):
        r = requests.get(f"{BASE_URL}/api/public/launch-status", timeout=10)
        assert r.status_code == 200
        j = r.json()
        for k in ("enabled", "launch_at", "is_live", "welcome_message",
                  "appstore_url", "playstore_url"):
            assert k in j, f"missing key: {k}"
        assert isinstance(j["enabled"], bool)
        assert isinstance(j["is_live"], bool)

    def test_store_links_hidden_until_live(self, h):
        # Set future launch + populate store URLs
        future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        r = _patch(h, {
            "launch_at": future, "enabled": True,
            "appstore_url": VALID_APP, "playstore_url": VALID_PLAY,
            "launch_complete": False,
        })
        assert r.status_code == 200, r.text
        pub = _public().json()
        assert pub["is_live"] is False
        assert pub["appstore_url"] == "", "leak! App Store link exposed pre-launch"
        assert pub["playstore_url"] == "", "leak! Play Store link exposed pre-launch"

    def test_store_links_exposed_when_live(self, h):
        # Flip launch_complete = true
        r = _patch(h, {"launch_complete": True})
        assert r.status_code == 200
        pub = _public().json()
        assert pub["is_live"] is True
        assert pub["appstore_url"] == VALID_APP
        assert pub["playstore_url"] == VALID_PLAY
        # revert
        _patch(h, {"launch_complete": False})

    def test_is_live_when_launch_at_past(self, h):
        past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        r = _patch(h, {"launch_at": past, "launch_complete": False,
                       "appstore_url": VALID_APP, "playstore_url": VALID_PLAY})
        assert r.status_code == 200
        pub = _public().json()
        assert pub["is_live"] is True
        assert pub["appstore_url"] == VALID_APP


# ─── 2. Admin GET ──────────────────────────────────────────────────────
class TestAdminGetLaunch:
    def test_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/cms/settings/launch", timeout=10)
        assert r.status_code in (401, 403)

    def test_returns_settings_and_readiness(self, h):
        r = requests.get(f"{BASE_URL}/api/cms/settings/launch", headers=h, timeout=10)
        assert r.status_code == 200
        j = r.json()
        assert "settings" in j and "readiness" in j
        s = j["settings"]
        for k in ("enabled", "launch_at", "appstore_url", "playstore_url",
                  "press_kit_ready", "launch_complete", "founding_target",
                  "welcome_message"):
            assert k in s
        rd = j["readiness"]
        for k in ("text", "tone", "checklist", "founding"):
            assert k in rd
        assert rd["tone"] in ("ready", "wait", "warn", "live")
        assert isinstance(rd["checklist"], dict)
        assert isinstance(rd["founding"], dict)
        assert "current" in rd["founding"] and "target" in rd["founding"]


# ─── 3. PATCH validation ───────────────────────────────────────────────
class TestPatchValidation:
    def test_rejects_invalid_appstore(self, h):
        r = _patch(h, {"appstore_url": "https://example.com/apple"})
        assert r.status_code == 400
        assert "appstore" in r.text.lower() or "apple" in r.text.lower()

    def test_rejects_invalid_playstore(self, h):
        r = _patch(h, {"playstore_url": "https://example.com/play"})
        assert r.status_code == 400
        assert "play" in r.text.lower()

    def test_accepts_valid_apple_and_play(self, h):
        r = _patch(h, {"appstore_url": VALID_APP, "playstore_url": VALID_PLAY})
        assert r.status_code == 200
        s = r.json()["settings"]
        assert s["appstore_url"] == VALID_APP
        assert s["playstore_url"] == VALID_PLAY

    def test_accepts_itunes_apple(self, h):
        alt = "https://itunes.apple.com/us/app/foo/id123"
        r = _patch(h, {"appstore_url": alt})
        assert r.status_code == 200
        # restore
        _patch(h, {"appstore_url": VALID_APP})

    def test_partial_patch_persists(self, h):
        r = _patch(h, {"founding_target": 250})
        assert r.status_code == 200
        # Re-read
        rr = requests.get(f"{BASE_URL}/api/cms/settings/launch", headers=h, timeout=10)
        assert rr.json()["settings"]["founding_target"] == 250
        _patch(h, {"founding_target": 100})


# ─── 4. Audit log dual-write ───────────────────────────────────────────
class TestAuditLog:
    def test_patch_writes_admin_log(self, h):
        # Do a distinctive patch
        _patch(h, {"welcome_message": "🦋 test audit marker"})
        time.sleep(0.5)
        # Check admin log endpoint
        r = requests.get(
            f"{BASE_URL}/api/cms/admin-log?action_prefix=launch&limit=20",
            headers=h, timeout=10,
        )
        assert r.status_code == 200, f"admin-log endpoint failed: {r.status_code} {r.text}"
        items = r.json().get("items", [])
        actions = [it.get("action") for it in items]
        assert "launch.settings.update" in actions, \
            f"admin_log missing launch.settings.update; recent actions: {actions[:5]}"
        # restore welcome
        _patch(h, {"welcome_message": "🦋 The doors are open. Welcome to FriendPlace."})


# ─── 5. Readiness observation tones ────────────────────────────────────
class TestReadinessTones:
    def _read(self, h):
        r = requests.get(f"{BASE_URL}/api/cms/settings/launch", headers=h, timeout=10)
        return r.json()["readiness"]

    def test_wait_no_date(self, h):
        _patch(h, {"launch_at": None, "enabled": False, "launch_complete": False})
        rd = self._read(h)
        assert rd["tone"] == "wait"
        assert "No launch date" in rd["text"]

    def test_wait_not_enabled(self, h):
        future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        _patch(h, {
            "launch_at": future, "enabled": False,
            "appstore_url": VALID_APP, "playstore_url": VALID_PLAY,
            "launch_complete": False,
        })
        rd = self._read(h)
        assert rd["tone"] == "wait"
        # Match either "isn't enabled yet" or "aren't in yet"
        assert "enabled" in rd["text"].lower() or "listing" in rd["text"].lower()

    def test_warn_missing_both_stores_grammar(self, h):
        """Grammar contract: BOTH links missing → plural 'aren't' and 'them'."""
        future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        _patch(h, {
            "launch_at": future, "enabled": True,
            "appstore_url": "", "playstore_url": "",
            "launch_complete": False,
        })
        rd = self._read(h)
        assert rd["tone"] == "warn", f"expected warn, got {rd['tone']}: {rd['text']}"
        t = rd["text"]
        assert "App Store and Google Play" in t, f"joined phrase missing: {t}"
        assert "aren't" in t, f"expected plural 'aren't': {t}"
        assert "isn't" not in t, f"unexpected singular 'isn't': {t}"
        assert "them" in t, f"expected plural 'them': {t}"
        assert " it " not in t and not t.endswith(" it."), f"unexpected singular 'it': {t}"

    def test_warn_missing_only_appstore(self, h):
        future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        _patch(h, {
            "launch_at": future, "enabled": True,
            "appstore_url": "", "playstore_url": VALID_PLAY,
            "launch_complete": False,
        })
        rd = self._read(h)
        assert rd["tone"] == "warn"
        assert "App Store" in rd["text"]
        # Singular grammar
        assert "isn't" in rd["text"]

    def test_ready_with_outstanding_items(self, h):
        future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        _patch(h, {
            "launch_at": future, "enabled": True,
            "appstore_url": VALID_APP, "playstore_url": VALID_PLAY,
            "press_kit_ready": False, "founding_target": 999999,
            "launch_complete": False,
        })
        rd = self._read(h)
        assert rd["tone"] == "ready"
        assert "Press kit" in rd["text"] or "Founding" in rd["text"]

    def test_ready_all_done(self, h):
        future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        _patch(h, {
            "launch_at": future, "enabled": True,
            "appstore_url": VALID_APP, "playstore_url": VALID_PLAY,
            "press_kit_ready": True, "founding_target": 0,
            "launch_complete": False,
        })
        rd = self._read(h)
        assert rd["tone"] == "ready"
        assert "Everything needed for launch is ready" in rd["text"]

    def test_live_via_launch_complete(self, h):
        _patch(h, {"launch_complete": True})
        rd = self._read(h)
        assert rd["tone"] == "live"
        assert "doors have been open" in rd["text"]
        _patch(h, {"launch_complete": False})

    def test_live_via_past_launch_at(self, h):
        past = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        _patch(h, {"launch_at": past, "launch_complete": False})
        rd = self._read(h)
        assert rd["tone"] == "live"
        assert "doors have been open" in rd["text"]
