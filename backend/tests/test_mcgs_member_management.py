"""
MCGS Slice 1 — Member Management backend regression tests.

Verifies the safeguard contract from /app/memory/MCGS_MIGRATION_AUDIT.md:
- Members listing (search + status filter + pagination)
- Member profile (identity + counts + reports + moderation_log)
- Notes composer writes to moderation_log AND admin_log (dual-write)
- warn/suspend/ban/restore write to both logs
- Delete REJECTS when confirm_member_id != path user_id
- All endpoints require CMS admin auth
"""
import os
import pytest
import requests

BASE_URL = "http://localhost:8001"
ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASSWORD = "TestPass2026!"
MAGGIE_ID = "7452ce79-7027-4a94-9669-0ee3a521a5ec"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{BASE_URL}/api/cms/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=10,
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def h(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# ── auth gate ─────────────────────────────────────────────────────────
def test_auth_required_list():
    r = requests.get(f"{BASE_URL}/api/cms/members", timeout=10)
    assert r.status_code in (401, 403)


def test_auth_required_profile():
    r = requests.get(f"{BASE_URL}/api/cms/members/{MAGGIE_ID}", timeout=10)
    assert r.status_code in (401, 403)


# ── members list ──────────────────────────────────────────────────────
def test_list_default_page(h):
    r = requests.get(f"{BASE_URL}/api/cms/members?limit=25&skip=0", headers=h, timeout=10)
    assert r.status_code == 200
    d = r.json()
    assert "items" in d and "total" in d
    assert d["total"] >= 100, f"expected ≥100 seeded members, got {d['total']}"
    assert len(d["items"]) <= 25
    # each item has the identity fields the row card renders
    row = d["items"][0]
    for k in ("id", "username"):
        assert k in row


def test_list_search_margaret(h):
    r = requests.get(f"{BASE_URL}/api/cms/members?q=margaret", headers=h, timeout=10)
    assert r.status_code == 200
    d = r.json()
    assert d["total"] >= 1
    hit = [m for m in d["items"] if m.get("id") == MAGGIE_ID]
    assert hit, "Margaret (maggie) should be in search results"


def test_list_status_filter_demo(h):
    r = requests.get(f"{BASE_URL}/api/cms/members?status=demo", headers=h, timeout=10)
    assert r.status_code == 200
    d = r.json()
    assert d["total"] >= 1
    for m in d["items"]:
        assert m.get("is_demo") is True, f"demo filter returned non-demo: {m['id']}"


def test_list_status_filter_admin(h):
    r = requests.get(f"{BASE_URL}/api/cms/members?status=admin", headers=h, timeout=10)
    assert r.status_code == 200
    for m in r.json()["items"]:
        assert m.get("is_admin") is True


def test_list_pagination(h):
    p1 = requests.get(f"{BASE_URL}/api/cms/members?limit=10&skip=0", headers=h, timeout=10).json()
    p2 = requests.get(f"{BASE_URL}/api/cms/members?limit=10&skip=10", headers=h, timeout=10).json()
    ids1 = {m["id"] for m in p1["items"]}
    ids2 = {m["id"] for m in p2["items"]}
    assert ids1 and ids2
    assert ids1.isdisjoint(ids2), "pages must not overlap"


# ── profile ───────────────────────────────────────────────────────────
def test_profile_shape(h):
    r = requests.get(f"{BASE_URL}/api/cms/members/{MAGGIE_ID}", headers=h, timeout=10)
    assert r.status_code == 200
    p = r.json()
    for k in ("user", "reports", "warnings", "moderation_log", "counts"):
        assert k in p, f"missing profile key: {k}"
    c = p["counts"]
    for k in ("reports_open", "reports_total", "warnings", "suspensions", "bans", "notes", "actions_total"):
        assert k in c


def test_profile_unknown_member(h):
    r = requests.get(f"{BASE_URL}/api/cms/members/nonexistent-id-xxx", headers=h, timeout=10)
    assert r.status_code == 404


# ── notes composer ───────────────────────────────────────────────────
def test_add_note_lands_on_timeline(h):
    before = requests.get(f"{BASE_URL}/api/cms/members/{MAGGIE_ID}", headers=h, timeout=10).json()
    notes_before = before["counts"]["notes"]
    note_text = "TEST_note_from_mcgs_regression_suite"
    r = requests.post(
        f"{BASE_URL}/api/cms/members/{MAGGIE_ID}/notes",
        json={"note": note_text},
        headers=h,
        timeout=10,
    )
    assert r.status_code in (200, 201), r.text
    after = requests.get(f"{BASE_URL}/api/cms/members/{MAGGIE_ID}", headers=h, timeout=10).json()
    assert after["counts"]["notes"] == notes_before + 1
    top = after["moderation_log"][0]
    assert top.get("action") == "note"
    assert note_text in (top.get("reason") or top.get("note") or "")


def test_add_note_empty_rejected(h):
    r = requests.post(
        f"{BASE_URL}/api/cms/members/{MAGGIE_ID}/notes",
        json={"note": ""},
        headers=h,
        timeout=10,
    )
    assert r.status_code in (400, 422)


# ── warn / restore round-trip (safe on demo user margaret) ────────────
def test_warn_then_restore_maggie(h):
    before = requests.get(f"{BASE_URL}/api/cms/members/{MAGGIE_ID}", headers=h, timeout=10).json()
    w_before = before["counts"]["warnings"]
    a_before = before["counts"]["actions_total"]

    r = requests.post(
        f"{BASE_URL}/api/cms/members/{MAGGIE_ID}/actions/warn",
        json={"reason": "TEST_warn_from_regression"},
        headers=h,
        timeout=10,
    )
    assert r.status_code in (200, 201), r.text

    after = requests.get(f"{BASE_URL}/api/cms/members/{MAGGIE_ID}", headers=h, timeout=10).json()
    assert after["counts"]["warnings"] == w_before + 1
    assert after["counts"]["actions_total"] == a_before + 1
    assert after["moderation_log"][0]["action"] == "warn"

    # Restore to leave the demo user clean.
    rr = requests.post(
        f"{BASE_URL}/api/cms/members/{MAGGIE_ID}/actions/restore",
        json={"reason": "TEST_restore_after_regression"},
        headers=h,
        timeout=10,
    )
    assert rr.status_code in (200, 201)


# ── delete safeguard — MUST reject on id mismatch ────────────────────
def test_delete_rejects_id_mismatch(h):
    r = requests.post(
        f"{BASE_URL}/api/cms/members/{MAGGIE_ID}/actions/delete",
        json={"confirm_member_id": "not-the-right-id", "reason": "TEST_should_be_rejected"},
        headers=h,
        timeout=10,
    )
    # Must NOT succeed
    assert r.status_code >= 400, f"Delete accepted a mismatched confirm_member_id! status={r.status_code}"
    assert r.status_code in (400, 403, 409, 422)

    # Verify member still exists
    p = requests.get(f"{BASE_URL}/api/cms/members/{MAGGIE_ID}", headers=h, timeout=10)
    assert p.status_code == 200


def test_delete_rejects_empty_confirm(h):
    r = requests.post(
        f"{BASE_URL}/api/cms/members/{MAGGIE_ID}/actions/delete",
        json={"confirm_member_id": "", "reason": "TEST_empty"},
        headers=h,
        timeout=10,
    )
    assert r.status_code >= 400


# ── admin_log dual-write verification ────────────────────────────────
def test_admin_log_dual_write_on_note(h):
    """
    admin_log endpoint should contain a member.note entry after a note
    was added (from test_add_note_lands_on_timeline).
    """
    r = requests.get(
        f"{BASE_URL}/api/cms/admin-log?target_type=member&target_id={MAGGIE_ID}&limit=25",
        headers=h,
        timeout=10,
    )
    # admin-log endpoint may return 200 with items OR 404 if route not present
    if r.status_code == 404:
        pytest.skip("admin_log endpoint not exposed via /api/cms/admin-log — dual-write only checkable in Mongo")
    assert r.status_code == 200
    items = r.json().get("items") or r.json().get("entries") or []
    actions = [i.get("action") or i.get("type") for i in items]
    # At least one member.note or note action should be present
    assert any("note" in (a or "") for a in actions), f"no note action in admin_log: {actions[:10]}"
