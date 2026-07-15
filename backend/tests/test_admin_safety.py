"""FriendPlace Admin Moderation & Safety backend tests.

Covers:
- /api/safety/report-reasons (6-reason taxonomy)
- /api/reports submission & friendly Thank-you message
- Auto-restriction: 3 reporters / 24h → restricted + urgent + auto_hidden notices
- /api/admin/* RBAC (non-admin → 403, admin → 200)
- /api/admin/summary, /api/admin/reports list & detail
- Admin actions: warn, suspend (blocks /api/auth/login), ban + restore
- Content removal: hides notice from GET /api/notices
- POST /api/notices rejected for restricted / banned authors
- Support tickets create + admin notification
"""
import os
import time
import uuid
import requests
import pytest

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://belong-together.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


# ---------------- Fixtures ----------------

@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


def _demo_login(s, username):
    r = s.post(f"{API}/auth/demo-login", json={"username": username})
    assert r.status_code == 200, f"demo-login {username}: {r.status_code} {r.text}"
    return r.json()["user"]


@pytest.fixture(scope="module")
def maggie(s):
    """Demo admin."""
    u = _demo_login(s, "maggie")
    assert u.get("is_admin") is True, f"maggie should be admin: {u}"
    return u


@pytest.fixture(scope="module")
def frankie(s):
    return _demo_login(s, "frankie")


@pytest.fixture(scope="module")
def dot(s):
    return _demo_login(s, "dot")


@pytest.fixture(scope="module")
def betty(s):
    # 'betty' is not in test_credentials.md; use 'billdo' as a 3rd reporter
    return _demo_login(s, "billdo")


@pytest.fixture(scope="module")
def joycey(s):
    return _demo_login(s, "joycey")


# ---------------- 1. Report reasons taxonomy ----------------

def test_safety_report_reasons_taxonomy(s):
    r = s.get(f"{API}/safety/report-reasons")
    assert r.status_code == 200, r.text
    data = r.json()
    assert "reasons" in data
    reasons = data["reasons"]
    assert len(reasons) == 6
    expected = {
        "Spam",
        "Harassment / Bullying",
        "Inappropriate Content",
        "Fake Profile",
        "Scam / Suspicious Behaviour",
        "Other",
    }
    assert set(reasons) == expected, f"Got: {reasons}"


# ---------------- 2. /api/reports submit + friendly message ----------------

def test_submit_report_returns_friendly_message(s, frankie, joycey):
    r = s.post(f"{API}/reports", json={
        "reporter_id": frankie["id"],
        "target_user_id": joycey["id"],
        "target_type": "user",
        "reason": "Spam",
        "notes": "TEST_smoke_report",
    })
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("ok") is True
    assert "report_id" in j and j["report_id"]
    assert j["message"] == "Thank you. We've received your report and will review it."


# ---------------- 3. Auto-restriction (3 reporters / 24h) ----------------

@pytest.fixture(scope="module")
def fresh_target(s, maggie):
    """Create a fresh real-account target so we don't pollute demo users.
    The target will then be auto-restricted by 3 different reporters.
    """
    uname = f"TEST_target_{uuid.uuid4().hex[:8]}"
    r = s.post(f"{API}/auth/signup", json={
        "username": uname, "password": "secret123", "first_name": "TEST", "suburb": "Bondi",
    })
    assert r.status_code == 200, f"signup target: {r.status_code} {r.text}"
    u = r.json()["user"]
    yield u
    # Cleanup: restore (clears restricted/banned/suspended + un-hides notices)
    try:
        s.post(f"{API}/admin/users/restore", json={"admin_id": maggie["id"], "user_id": u["id"]})
    except Exception:
        pass


def test_auto_restrict_flow(s, maggie, frankie, dot, betty, fresh_target):
    target = fresh_target

    # The target posts a notice — to verify auto_hidden flag at the end.
    nr = s.post(f"{API}/notices", json={
        "user_id": target["id"], "user_name": target["first_name"], "avatar": "🧪",
        "title": "TEST_target_notice", "body": "hello", "category": "Announcement",
    })
    assert nr.status_code == 200, nr.text
    notice_id = nr.json()["id"]

    # Reporter 1
    r1 = s.post(f"{API}/reports", json={"reporter_id": frankie["id"], "target_user_id": target["id"], "target_type": "user", "reason": "Spam"})
    assert r1.status_code == 200
    assert r1.json()["auto_restricted"] is False

    # Reporter 2
    r2 = s.post(f"{API}/reports", json={"reporter_id": dot["id"], "target_user_id": target["id"], "target_type": "user", "reason": "Harassment / Bullying"})
    assert r2.status_code == 200
    assert r2.json()["auto_restricted"] is False

    # Reporter 3 — triggers auto-restrict
    r3 = s.post(f"{API}/reports", json={"reporter_id": betty["id"], "target_user_id": target["id"], "target_type": "user", "reason": "Scam / Suspicious Behaviour"})
    assert r3.status_code == 200
    j3 = r3.json()
    assert j3["auto_restricted"] is True, f"3rd report should auto-restrict: {j3}"

    # (b) Target user has restricted=true with auto reason
    ru = s.get(f"{API}/users/{target['id']}")
    assert ru.status_code == 200
    target_now = ru.json()
    assert target_now.get("restricted") is True
    assert target_now.get("restricted_reason") == "Auto-restricted: 3+ reports in 24h"

    # (c) All open reports for that target are urgent=true
    rep_list = s.get(f"{API}/admin/reports", params={"admin_id": maggie["id"], "status": "all"})
    assert rep_list.status_code == 200
    related = [r for r in rep_list.json()["reports"] if r.get("target_user_id") == target["id"]]
    assert len(related) >= 3
    assert all(r.get("urgent") is True for r in related), f"Expected all urgent: {related}"

    # (d) Notices auto-hidden — should not appear in GET /api/notices
    notices = s.get(f"{API}/notices").json()
    ids = {n["id"] for n in notices}
    assert notice_id not in ids, "Auto-hidden notice should not appear in /api/notices"


# ---------------- 4. Non-admin → 403 on /api/admin/* ----------------

def test_non_admin_summary_forbidden(s, frankie):
    r = s.get(f"{API}/admin/summary", params={"admin_id": frankie["id"]})
    assert r.status_code == 403


def test_non_admin_reports_forbidden(s, frankie):
    r = s.get(f"{API}/admin/reports", params={"admin_id": frankie["id"], "status": "all"})
    assert r.status_code == 403


def test_non_admin_warn_forbidden(s, frankie, joycey):
    r = s.post(f"{API}/admin/users/warn", json={"admin_id": frankie["id"], "user_id": joycey["id"], "reason": "noop"})
    assert r.status_code == 403


# ---------------- 5. /api/admin/summary ----------------

def test_admin_summary(s, maggie):
    r = s.get(f"{API}/admin/summary", params={"admin_id": maggie["id"]})
    assert r.status_code == 200, r.text
    j = r.json()
    for top in ("reports", "support", "users"):
        assert top in j, f"Missing {top} in summary"
    for k in ("new", "reviewing", "urgent", "resolved"):
        assert k in j["reports"]
        assert isinstance(j["reports"][k], int)
    assert {"open", "resolved"}.issubset(j["support"].keys())
    assert {"total", "restricted", "banned"}.issubset(j["users"].keys())


# ---------------- 6. Admin reports list sorted urgent-first ----------------

def test_admin_reports_list_urgent_first(s, maggie):
    r = s.get(f"{API}/admin/reports", params={"admin_id": maggie["id"], "status": "all"})
    assert r.status_code == 200, r.text
    j = r.json()
    assert "reports" in j and "counts" in j
    # Sort guarantee: urgent rows come before non-urgent rows.
    seen_non_urgent = False
    for row in j["reports"]:
        if not row.get("urgent"):
            seen_non_urgent = True
        elif seen_non_urgent:
            pytest.fail("Urgent row appeared after a non-urgent row — sort broken")
    # Reports must be enriched with reporter + target_user objects.
    if j["reports"]:
        sample = next((r for r in j["reports"] if r.get("target_user_id") and r.get("reporter_id")), None)
        if sample is not None:
            assert "reporter" in sample
            assert "target_user" in sample


# ---------------- 7. Admin report detail ----------------

def test_admin_report_detail(s, maggie, frankie, joycey):
    # Create a fresh report to inspect
    r = s.post(f"{API}/reports", json={
        "reporter_id": frankie["id"], "target_user_id": joycey["id"],
        "target_type": "user", "reason": "Other", "notes": "TEST_detail",
    })
    rid = r.json()["report_id"]
    d = s.get(f"{API}/admin/reports/{rid}", params={"admin_id": maggie["id"]})
    assert d.status_code == 200, d.text
    j = d.json()
    for k in ("report", "reporter", "target_user", "target_history"):
        assert k in j
    assert j["report"]["id"] == rid
    assert j["reporter"]["id"] == frankie["id"]
    assert j["target_user"]["id"] == joycey["id"]


# ---------------- 8. Update report status ----------------

def test_admin_set_report_status_reviewing(s, maggie, frankie, joycey):
    r = s.post(f"{API}/reports", json={
        "reporter_id": frankie["id"], "target_user_id": joycey["id"], "target_type": "user", "reason": "Other",
    })
    rid = r.json()["report_id"]
    u = s.post(f"{API}/admin/reports/{rid}/status", params={"status": "reviewing"}, json={"admin_id": maggie["id"], "note": "TEST_review"})
    assert u.status_code == 200
    # Verify persisted
    d = s.get(f"{API}/admin/reports/{rid}", params={"admin_id": maggie["id"]}).json()
    assert d["report"]["status"] == "reviewing"


# ---------------- 9. Warn user ----------------

def test_admin_warn_user_sends_notification(s, maggie, joycey, frankie):
    # Create a report so we can verify report resolution side-effect.
    r = s.post(f"{API}/reports", json={
        "reporter_id": frankie["id"], "target_user_id": joycey["id"],
        "target_type": "user", "reason": "Spam", "notes": "TEST_warn",
    })
    rid = r.json()["report_id"]

    w = s.post(f"{API}/admin/users/warn", json={
        "admin_id": maggie["id"], "user_id": joycey["id"],
        "reason": "TEST_be_kind", "report_id": rid,
    })
    assert w.status_code == 200, w.text

    # Notification arrived for the target
    notifs = s.get(f"{API}/notifications/{joycey['id']}")
    assert notifs.status_code == 200
    types = [n.get("type") for n in notifs.json()]
    assert "moderation_warning" in types

    # Report marked resolved with outcome=warned
    d = s.get(f"{API}/admin/reports/{rid}", params={"admin_id": maggie["id"]}).json()
    assert d["report"]["status"] == "resolved"
    assert d["report"].get("outcome") == "warned"


# ---------------- 10. Suspend → /api/auth/login 403 + admin notified ----------------

@pytest.fixture(scope="module")
def suspendable_user(s, maggie):
    uname = f"TEST_sus_{uuid.uuid4().hex[:8]}"
    pwd = "secret123"
    r = s.post(f"{API}/auth/signup", json={"username": uname, "password": pwd, "first_name": "Sus"})
    assert r.status_code == 200, r.text
    u = r.json()["user"]
    u["_password"] = pwd
    yield u
    try:
        s.post(f"{API}/admin/users/restore", json={"admin_id": maggie["id"], "user_id": u["id"]})
    except Exception:
        pass


def test_admin_suspend_blocks_login(s, maggie, suspendable_user):
    u = suspendable_user
    # Verify login works before suspension
    ok = s.post(f"{API}/auth/login", json={"username": u["username"], "password": u["_password"]})
    assert ok.status_code == 200, f"baseline login should work: {ok.text}"

    # Suspend for 24h
    sp = s.post(f"{API}/admin/users/suspend", json={
        "admin_id": maggie["id"], "user_id": u["id"], "reason": "TEST_suspend", "duration_hours": 24,
    })
    assert sp.status_code == 200, sp.text
    assert sp.json().get("suspended_until")

    # Login should be rejected with 403
    bad = s.post(f"{API}/auth/login", json={"username": u["username"], "password": u["_password"]})
    assert bad.status_code == 403, f"expected 403, got {bad.status_code} {bad.text}"

    # Admin should have a moderation_login_attempt notification
    notifs = s.get(f"{API}/notifications/{maggie['id']}").json()
    types = [n.get("type") for n in notifs]
    assert "moderation_login_attempt" in types


# ---------------- 11. Ban + Restore ----------------

@pytest.fixture(scope="module")
def bannable_user(s, maggie):
    uname = f"TEST_ban_{uuid.uuid4().hex[:8]}"
    pwd = "secret123"
    r = s.post(f"{API}/auth/signup", json={"username": uname, "password": pwd, "first_name": "Ban"})
    assert r.status_code == 200, r.text
    u = r.json()["user"]
    u["_password"] = pwd
    yield u
    try:
        s.post(f"{API}/admin/users/restore", json={"admin_id": maggie["id"], "user_id": u["id"]})
    except Exception:
        pass


def test_admin_ban_then_restore(s, maggie, bannable_user):
    u = bannable_user
    # Ban
    b = s.post(f"{API}/admin/users/ban", json={"admin_id": maggie["id"], "user_id": u["id"], "reason": "TEST_ban"})
    assert b.status_code == 200, b.text
    # Login blocked
    bad = s.post(f"{API}/auth/login", json={"username": u["username"], "password": u["_password"]})
    assert bad.status_code == 403, f"banned login should be 403, got {bad.status_code}"
    # Restore
    rs = s.post(f"{API}/admin/users/restore", json={"admin_id": maggie["id"], "user_id": u["id"]})
    assert rs.status_code == 200
    # Login works again
    good = s.post(f"{API}/auth/login", json={"username": u["username"], "password": u["_password"]})
    assert good.status_code == 200, f"after restore login should work: {good.text}"


# ---------------- 12. Remove content (notice) ----------------

def test_admin_remove_notice(s, maggie):
    # Create a notice as maggie, then remove it via admin endpoint
    nr = s.post(f"{API}/notices", json={
        "user_id": maggie["id"], "user_name": "Margaret", "avatar": "🌸",
        "title": "TEST_remove_me", "body": "delete via admin", "category": "Announcement",
    })
    assert nr.status_code == 200, nr.text
    nid = nr.json()["id"]
    # Confirm visible
    listing = s.get(f"{API}/notices").json()
    assert nid in {n["id"] for n in listing}

    rm = s.post(f"{API}/admin/content/remove", json={
        "admin_id": maggie["id"], "target_type": "notice", "target_id": nid, "reason": "TEST_rm",
    })
    assert rm.status_code == 200, rm.text

    # No longer visible
    listing2 = s.get(f"{API}/notices").json()
    assert nid not in {n["id"] for n in listing2}, "Removed notice should be hidden from /api/notices"


# ---------------- 13. Restricted user cannot post notices ----------------

def test_restricted_user_cannot_post_notice(s, maggie):
    uname = f"TEST_restr_{uuid.uuid4().hex[:8]}"
    r = s.post(f"{API}/auth/signup", json={"username": uname, "password": "secret123", "first_name": "Restr"})
    assert r.status_code == 200
    u = r.json()["user"]
    try:
        # Pre-baseline: posting works
        ok = s.post(f"{API}/notices", json={
            "user_id": u["id"], "user_name": "Restr", "avatar": "🧪",
            "title": "TEST_pre", "body": "ok", "category": "Announcement",
        })
        assert ok.status_code == 200

        # Suspend (restricted=True is set as a side-effect)
        sp = s.post(f"{API}/admin/users/suspend", json={
            "admin_id": maggie["id"], "user_id": u["id"], "duration_hours": 1, "reason": "TEST",
        })
        assert sp.status_code == 200

        # Post should be 403
        bad = s.post(f"{API}/notices", json={
            "user_id": u["id"], "user_name": "Restr", "avatar": "🧪",
            "title": "TEST_blocked", "body": "should fail", "category": "Announcement",
        })
        assert bad.status_code == 403
    finally:
        s.post(f"{API}/admin/users/restore", json={"admin_id": maggie["id"], "user_id": u["id"]})


# ---------------- 14. Support tickets ----------------

def test_support_ticket_create_and_admin_notify(s, maggie, frankie):
    body = {
        "user_id": frankie["id"], "user_email": "frank@example.com",
        "category": "Bug / Technical issue", "subject": "TEST_subject", "message": "TEST_message",
    }
    r = s.post(f"{API}/support/tickets", json=body)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("ok") is True
    assert j.get("ticket_id")
    assert "Thank you" in j.get("message", "")

    # Admin receives a support_new notification
    notifs = s.get(f"{API}/notifications/{maggie['id']}").json()
    types = [n.get("type") for n in notifs]
    assert "support_new" in types

    # And the ticket shows up under admin listing
    listing = s.get(f"{API}/admin/support/tickets", params={"admin_id": maggie["id"], "status": "all"}).json()
    ticket_ids = [t["id"] for t in listing.get("tickets", [])]
    assert j["ticket_id"] in ticket_ids
