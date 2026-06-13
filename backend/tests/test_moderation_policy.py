"""Backend tests for the rebuilt Admin/Moderation Dashboard + policy.

Covers:
  - GET /api/admin/policy (4 rules, thresholds, auto_ban=false)
  - GET /api/admin/summary (policy + flagged count, 403 for non-admin)
  - GET /api/admin/repeat-offenders (shape + filtering + sorting + flags)
  - Threshold logic (3 unique reports → flagged, 5 → restricted, never auto-ban
    even at 10+, notices auto-hidden)
  - POST /api/admin/users/clear-restriction (success path, 404 unknown user,
    403 non-admin, clears flag, un-hides notices, writes admin_log)
  - Legacy 24-hour auto-restrict rule is GONE
  - Smoke regressions: /admin/reports, /admin/reports/{id}, /admin/support/tickets,
    /admin/users/{warn,suspend,ban,restore}, /community/today,
    /games/wordsearch/daily, demo-login

Hygiene:
  - All disposable users are created via /api/auth/signup with the prefix
    "TEST_modpol_<run-id>_..." so cleanup can target them precisely.
  - Canonical demo accounts (maggie/frankie/...) are NEVER mutated.
"""

import os
import time
import uuid
from typing import Dict, List

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

RUN_ID = uuid.uuid4().hex[:8]
PREFIX = f"TEST_modpol_{RUN_ID}_"


# ============================================================ Fixtures =====

@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def mongo():
    cl = MongoClient(MONGO_URL)
    yield cl[DB_NAME]
    cl.close()


@pytest.fixture(scope="module")
def admin_id(api):
    """Log in as maggie (admin demo)."""
    r = api.post(f"{BASE_URL}/api/auth/demo-login", json={"username": "maggie"})
    assert r.status_code == 200, r.text
    uid = r.json()["user"]["id"]
    assert r.json()["user"].get("is_admin"), "maggie must be admin"
    return uid


@pytest.fixture(scope="module")
def non_admin_id(api):
    """Log in as frankie (regular demo)."""
    r = api.post(f"{BASE_URL}/api/auth/demo-login", json={"username": "frankie"})
    assert r.status_code == 200, r.text
    return r.json()["user"]["id"]


def _signup(api, label: str) -> str:
    """Create a disposable real-account user; returns user id."""
    uname = f"{PREFIX}{label}"
    r = api.post(
        f"{BASE_URL}/api/auth/signup",
        json={
            "username": uname,
            "password": "testpass123",
            "first_name": f"T{label[:6]}",
            "email": f"{uname}@example.com",
            "avatar": "🧪",
        },
    )
    assert r.status_code == 200, f"signup failed for {uname}: {r.status_code} {r.text}"
    return r.json()["user"]["id"]


@pytest.fixture(scope="module")
def disposable_users(api, mongo):
    """Create 1 target + 10 reporters (we use 5 for thresholds + 5 spare for
    over-threshold no-auto-ban test). Cleans up at module teardown."""
    target = _signup(api, "tgt")
    reporters: List[str] = [_signup(api, f"rep{i}") for i in range(10)]
    yield {"target": target, "reporters": reporters}

    # ----------------- cleanup -----------------
    all_ids = [target] + reporters
    try:
        mongo.reports.delete_many({"reporter_id": {"$in": all_ids}})
        mongo.reports.delete_many({"target_user_id": {"$in": all_ids}})
        mongo.notices.delete_many({"user_id": {"$in": all_ids}})
        mongo.notifications.delete_many({"user_id": {"$in": all_ids}})
        mongo.notifications.delete_many({"ref_user_id": {"$in": all_ids}})
        mongo.admin_log.delete_many({"target_user_id": {"$in": all_ids}})
        mongo.users.delete_many({"id": {"$in": all_ids}})
    except Exception as e:  # pragma: no cover
        print(f"cleanup warning: {e}")


def _seed_notice(mongo, user_id: str) -> str:
    """Insert a dummy notice owned by user_id so we can verify auto_hidden behaviour."""
    nid = f"TEST_notice_{uuid.uuid4().hex[:8]}"
    mongo.notices.insert_one({
        "id": nid,
        "user_id": user_id,
        "title": f"TEST notice {nid}",
        "body": "disposable",
        "type": "general",
        "auto_hidden": False,
        "created_at": "2026-01-01T00:00:00+00:00",
    })
    return nid


def _submit_report(api, reporter_id: str, target_user_id: str, reason: str = "Harassment / Bullying") -> Dict:
    r = api.post(
        f"{BASE_URL}/api/reports",
        json={
            "reporter_id": reporter_id,
            "target_user_id": target_user_id,
            "target_type": "user",
            "reason": reason,
            "notes": "automated test",
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


# ============================================================ /policy =====

class TestPolicyEndpoint:
    def test_admin_policy_shape(self, api):
        r = api.get(f"{BASE_URL}/api/admin/policy")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["flag_threshold"] == 3
        assert data["restrict_threshold"] == 5
        assert data["window_days"] == 30
        assert data["auto_ban"] is False
        rules = data["rules"]
        assert isinstance(rules, list) and len(rules) == 4
        # Sanity: every rule is a non-empty string and the never-auto-ban rule is present.
        assert all(isinstance(s, str) and s.strip() for s in rules)
        joined = " ".join(rules).lower()
        assert "never auto-banned" in joined or "never auto" in joined
        assert "flagged" in joined
        assert "temporary restriction" in joined


# ============================================================ /summary =====

class TestSummaryEndpoint:
    def test_summary_requires_admin(self, api, non_admin_id):
        r = api.get(f"{BASE_URL}/api/admin/summary", params={"admin_id": non_admin_id})
        assert r.status_code == 403, r.text

    def test_summary_shape_with_admin(self, api, admin_id):
        r = api.get(f"{BASE_URL}/api/admin/summary", params={"admin_id": admin_id})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "users" in data and "policy" in data
        users = data["users"]
        for k in ("total", "flagged", "restricted", "banned"):
            assert k in users and isinstance(users[k], int)
        policy = data["policy"]
        assert policy["flag_threshold"] == 3
        assert policy["restrict_threshold"] == 5
        assert policy["window_days"] == 30
        assert policy["auto_ban"] is False
        # Reports + support sections still present (regression).
        assert {"new", "reviewing", "urgent", "resolved"} <= set(data["reports"].keys())
        assert {"open", "resolved"} <= set(data["support"].keys())


# ====================================================== /repeat-offenders ===

class TestRepeatOffendersEndpoint:
    def test_repeat_offenders_requires_admin(self, api, non_admin_id):
        r = api.get(f"{BASE_URL}/api/admin/repeat-offenders", params={"admin_id": non_admin_id})
        assert r.status_code == 403

    def test_repeat_offenders_shape(self, api, admin_id):
        r = api.get(
            f"{BASE_URL}/api/admin/repeat-offenders",
            params={"admin_id": admin_id, "min_reporters": 2, "days": 30},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["window_days"] == 30
        assert data["policy"]["flag_at"] == 3
        assert data["policy"]["restrict_at"] == 5
        assert "users" in data and isinstance(data["users"], list)
        # Sorted desc by unique_reporters.
        if len(data["users"]) >= 2:
            uniqs = [u["unique_reporters"] for u in data["users"]]
            assert uniqs == sorted(uniqs, reverse=True), uniqs


# ===================================================== Threshold scenarios ==

class TestModerationThresholds:
    """Drives the full lifecycle of the policy against one disposable target."""

    def test_three_unique_reports_flags_but_does_not_restrict(self, api, admin_id, disposable_users, mongo):
        target = disposable_users["target"]
        reporters = disposable_users["reporters"]

        # Seed a notice so we can later assert auto_hidden flips.
        notice_id = _seed_notice(mongo, target)

        # Submit 3 reports from 3 different reporters in quick succession.
        results = [_submit_report(api, reporters[i], target) for i in range(3)]
        for res in results:
            assert res["ok"] is True
            assert res["auto_restricted"] is False, (
                "Legacy 24h rule must be GONE — 3 rapid reports should not restrict"
            )

        u = mongo.users.find_one({"id": target}, {"_id": 0})
        assert u.get("flagged_for_review") is True, "Expected user FLAGGED after 3 unique reporters"
        assert not u.get("restricted"), "User must NOT be restricted at 3 reports"
        assert not u.get("banned"), "User must NEVER be auto-banned"

        # Notice should still be visible (auto_hidden only flips at restrict).
        n = mongo.notices.find_one({"id": notice_id}, {"_id": 0})
        assert n.get("auto_hidden") in (False, None), "Notice must not auto-hide at FLAG stage"

        # /repeat-offenders should now show this user as FLAGGED.
        r = api.get(
            f"{BASE_URL}/api/admin/repeat-offenders",
            params={"admin_id": admin_id, "min_reporters": 3, "days": 30},
        )
        assert r.status_code == 200, r.text
        rows = r.json()["users"]
        row = next((x for x in rows if x["user_id"] == target), None)
        assert row is not None, "Target should appear in repeat-offenders"
        # Required fields per spec
        for f in ("user_id", "username", "first_name", "avatar",
                  "unique_reporters", "total_reports", "last_reported_at",
                  "reasons", "restricted", "flagged_for_review", "banned"):
            assert f in row, f"missing field {f} in repeat-offender row"
        assert row["flagged_for_review"] is True
        assert row["restricted"] is False
        assert row["banned"] is False
        assert row["unique_reporters"] == 3
        assert row["total_reports"] == 3
        assert isinstance(row["reasons"], list) and len(row["reasons"]) >= 1

    def test_fifth_unique_report_restricts(self, api, admin_id, disposable_users, mongo):
        target = disposable_users["target"]
        reporters = disposable_users["reporters"]

        # We already have reports from reporters[0..2]. Add reporters[3] and [4].
        r4 = _submit_report(api, reporters[3], target)
        assert r4["auto_restricted"] is False, "4 unique reports should still NOT restrict"

        r5 = _submit_report(api, reporters[4], target)
        assert r5["auto_restricted"] is True, (
            "5th unique reporter must trigger temporary restriction"
        )

        u = mongo.users.find_one({"id": target}, {"_id": 0})
        assert u.get("restricted") is True
        assert u.get("flagged_for_review") is True
        assert not u.get("banned"), "User must NEVER be auto-banned"
        rr = u.get("restricted_reason", "")
        assert "5" in rr or str(5) in rr, f"restricted_reason should mention 5: {rr!r}"

        # Notice should now be auto-hidden.
        n = mongo.notices.find_one({"user_id": target, "title": {"$regex": "^TEST notice"}})
        assert n is not None and n.get("auto_hidden") is True, "Notices must auto-hide at restrict"

        # Admin notification fired.
        urgent_count = mongo.notifications.count_documents({
            "type": "moderation_urgent", "ref_user_id": target,
        })
        assert urgent_count >= 1, "Admins must be notified of urgent restriction"

    def test_no_auto_ban_even_with_many_unique_reports(self, api, disposable_users, mongo):
        target = disposable_users["target"]
        reporters = disposable_users["reporters"]
        # Push to 10 unique reporters (we already have 5).
        for i in range(5, 10):
            _submit_report(api, reporters[i], target)

        u = mongo.users.find_one({"id": target}, {"_id": 0})
        assert u.get("banned") in (False, None), (
            f"User must NEVER be auto-banned regardless of report count; got banned={u.get('banned')}"
        )
        # Should still be restricted+flagged.
        assert u.get("restricted") is True
        assert u.get("flagged_for_review") is True


# ====================================================== /clear-restriction ==

class TestClearRestriction:
    def test_non_admin_forbidden(self, api, non_admin_id, disposable_users):
        target = disposable_users["target"]
        r = api.post(
            f"{BASE_URL}/api/admin/users/clear-restriction",
            json={"admin_id": non_admin_id, "target_user_id": target, "clear_flag": True},
        )
        assert r.status_code == 403, r.text

    def test_unknown_user_returns_404(self, api, admin_id):
        r = api.post(
            f"{BASE_URL}/api/admin/users/clear-restriction",
            json={"admin_id": admin_id, "target_user_id": "does-not-exist-xyz", "clear_flag": True},
        )
        assert r.status_code == 404, r.text

    def test_clear_restriction_success_and_side_effects(self, api, admin_id, disposable_users, mongo):
        target = disposable_users["target"]
        # Sanity: target should be restricted from earlier tests.
        before = mongo.users.find_one({"id": target}, {"_id": 0})
        assert before.get("restricted") is True
        assert before.get("flagged_for_review") is True

        r = api.post(
            f"{BASE_URL}/api/admin/users/clear-restriction",
            json={"admin_id": admin_id, "target_user_id": target, "clear_flag": True, "notes": "all good"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["user_id"] == target
        assert body["cleared_flag"] is True

        after = mongo.users.find_one({"id": target}, {"_id": 0})
        assert not after.get("restricted"), "restricted should be cleared/unset"
        assert not after.get("flagged_for_review"), "flag should be cleared/unset"
        # Notices auto_hidden should be cleared.
        n = mongo.notices.find_one({"user_id": target, "title": {"$regex": "^TEST notice"}})
        assert n is not None
        # endpoint $unsets auto_hidden so the field should be missing
        assert "auto_hidden" not in n, f"Notice auto_hidden should be unset, got {n.get('auto_hidden')}"

        # admin_log entry written
        logs = list(mongo.admin_log.find(
            {"target_user_id": target, "action": "clear_restriction"}, {"_id": 0},
        ))
        assert len(logs) >= 1
        assert logs[-1]["admin_id"] == admin_id
        assert logs[-1]["notes"] == "all good"


# =========================================================== Regressions ===

class TestRegressionEndpoints:
    def test_admin_reports_list_and_filter(self, api, admin_id):
        r_all = api.get(f"{BASE_URL}/api/admin/reports", params={"admin_id": admin_id, "status": "all"})
        assert r_all.status_code == 200
        assert "reports" in r_all.json()
        r_new = api.get(f"{BASE_URL}/api/admin/reports", params={"admin_id": admin_id, "status": "new"})
        assert r_new.status_code == 200
        for row in r_new.json()["reports"]:
            assert row["status"] == "new"

    def test_admin_report_detail(self, api, admin_id, disposable_users):
        # Find a report against our target so we know it exists.
        target = disposable_users["target"]
        r_list = api.get(
            f"{BASE_URL}/api/admin/reports", params={"admin_id": admin_id, "status": "all"},
        )
        assert r_list.status_code == 200
        reports = [x for x in r_list.json()["reports"] if x.get("target_user_id") == target]
        assert reports, "Expected at least one report against the disposable target"
        rid = reports[0]["id"]
        r_one = api.get(f"{BASE_URL}/api/admin/reports/{rid}", params={"admin_id": admin_id})
        assert r_one.status_code == 200
        body = r_one.json()
        assert body["report"]["id"] == rid
        assert "target_user" in body and "reporter" in body and "target_history" in body

    def test_admin_support_tickets_list(self, api, admin_id):
        r = api.get(f"{BASE_URL}/api/admin/support/tickets", params={"admin_id": admin_id})
        assert r.status_code == 200
        assert "tickets" in r.json()

    def test_admin_user_actions_warn_suspend_ban_restore_roundtrip(self, api, admin_id, mongo):
        """Run warn/suspend/ban/restore against a throwaway user (NOT a demo)."""
        uname = f"{PREFIX}actiontgt"
        sr = api.post(
            f"{BASE_URL}/api/auth/signup",
            json={"username": uname, "password": "pw123456", "first_name": "Act"},
        )
        assert sr.status_code == 200, sr.text
        uid = sr.json()["user"]["id"]
        try:
            # warn
            assert api.post(f"{BASE_URL}/api/admin/users/warn", json={
                "admin_id": admin_id, "user_id": uid, "reason": "test warn",
            }).status_code == 200
            # suspend
            sus = api.post(f"{BASE_URL}/api/admin/users/suspend", json={
                "admin_id": admin_id, "user_id": uid, "reason": "test suspend", "duration_hours": 1,
            })
            assert sus.status_code == 200
            assert sus.json().get("suspended_until")
            # ban
            assert api.post(f"{BASE_URL}/api/admin/users/ban", json={
                "admin_id": admin_id, "user_id": uid, "reason": "test ban",
            }).status_code == 200
            u_after_ban = mongo.users.find_one({"id": uid}, {"_id": 0})
            assert u_after_ban.get("banned") is True
            # restore
            assert api.post(f"{BASE_URL}/api/admin/users/restore", json={
                "admin_id": admin_id, "user_id": uid,
            }).status_code == 200
            u_after_restore = mongo.users.find_one({"id": uid}, {"_id": 0})
            assert u_after_restore.get("banned") is False
            assert u_after_restore.get("restricted") is False
        finally:
            mongo.users.delete_one({"id": uid})
            mongo.notifications.delete_many({"user_id": uid})

    def test_community_today(self, api, admin_id):
        r = api.get(f"{BASE_URL}/api/community/today", params={"user_id": admin_id})
        assert r.status_code == 200, r.text

    def test_wordsearch_daily(self, api):
        r = api.get(f"{BASE_URL}/api/games/wordsearch/daily")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "grid" in data or "words" in data or "puzzle_id" in data

    def test_frankie_demo_login(self, api):
        r = api.post(f"{BASE_URL}/api/auth/demo-login", json={"username": "frankie"})
        assert r.status_code == 200
        assert r.json()["user"]["username"].lower() == "frankie"
