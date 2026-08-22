"""iter162 — Reminders V1 backend regression tests.

Covers creation, recurrence roll-forward on complete, listing,
deletion, validation, and George capability honesty (tools do NOT
mock success; failures surface as errors so George can admit them).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import os
import pytest
import requests

BASE_URL = os.environ.get("BACKEND_URL", "http://localhost:8001").rstrip("/")


@pytest.fixture(scope="module")
def api():
    return requests.Session()


@pytest.fixture(scope="module")
def auth(api):
    r = api.post(f"{BASE_URL}/api/cms/auth/login",
                 json={"email": "hello@friendplace.com.au", "password": "TestPass2026!"},
                 timeout=15)
    assert r.status_code == 200, r.text[:400]
    tok = r.json().get("token") or r.json().get("access_token")
    return {"Authorization": f"Bearer {tok}"}


def _future_iso(hours: int = 24) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat().replace("+00:00", "Z")


def test_create_list_delete_one_off(api, auth):
    body = {"title": f"iter162-oneoff-{uuid.uuid4().hex[:6]}",
            "note": "test", "due_at": _future_iso(), "recurrence": "none"}
    r = api.post(f"{BASE_URL}/api/cms/reminders", json=body, headers=auth, timeout=15)
    assert r.status_code in (200, 201), r.text[:400]
    doc = r.json()
    assert doc["id"] and doc["title"] == body["title"]
    assert doc["status"] == "pending" and doc["recurrence"] == "none"
    rid = doc["id"]

    # Appears in list.
    r2 = api.get(f"{BASE_URL}/api/cms/reminders?status=pending", headers=auth, timeout=15)
    assert any(x["id"] == rid for x in r2.json()["items"])

    # Delete.
    r3 = api.delete(f"{BASE_URL}/api/cms/reminders/{rid}", headers=auth, timeout=15)
    assert r3.status_code == 200 and r3.json()["ok"] is True

    # Gone.
    r4 = api.get(f"{BASE_URL}/api/cms/reminders/{rid}", headers=auth, timeout=15)
    assert r4.status_code == 404


def test_complete_one_off_marks_completed(api, auth):
    r = api.post(f"{BASE_URL}/api/cms/reminders",
                 json={"title": f"iter162-c-{uuid.uuid4().hex[:6]}", "due_at": _future_iso(1), "recurrence": "none"},
                 headers=auth, timeout=15)
    rid = r.json()["id"]
    try:
        rc = api.post(f"{BASE_URL}/api/cms/reminders/{rid}/complete", headers=auth, timeout=15)
        assert rc.status_code == 200
        doc = rc.json()
        assert doc["status"] == "completed" and doc["completed_at"]
    finally:
        api.delete(f"{BASE_URL}/api/cms/reminders/{rid}", headers=auth, timeout=15)


def test_complete_recurring_rolls_due_forward(api, auth):
    due_now = _future_iso(1)
    r = api.post(f"{BASE_URL}/api/cms/reminders",
                 json={"title": f"iter162-r-{uuid.uuid4().hex[:6]}", "due_at": due_now, "recurrence": "weekly"},
                 headers=auth, timeout=15)
    rid = r.json()["id"]
    try:
        rc = api.post(f"{BASE_URL}/api/cms/reminders/{rid}/complete", headers=auth, timeout=15)
        doc = rc.json()
        # Recurring reminders stay pending, but due_at moves forward.
        assert doc["status"] == "pending", f"recurring reminders should stay pending, got {doc['status']}"
        assert doc["completed_at"], "completed_at should be stamped for audit"
        d0 = datetime.fromisoformat(due_now.replace("Z", "+00:00"))
        d1 = datetime.fromisoformat(doc["due_at"].replace("Z", "+00:00"))
        # Weekly = +7 days (allow a few seconds of tolerance).
        assert 6.5 <= (d1 - d0).days <= 7.5, f"weekly recurrence should be ~7 days, got {(d1 - d0).days}"
    finally:
        api.delete(f"{BASE_URL}/api/cms/reminders/{rid}", headers=auth, timeout=15)


def test_validation_rejects_bad_recurrence_and_missing_title(api, auth):
    r = api.post(f"{BASE_URL}/api/cms/reminders",
                 json={"title": "x", "due_at": _future_iso(), "recurrence": "hourly"},
                 headers=auth, timeout=15)
    assert r.status_code == 400 and "recurrence" in r.text.lower()

    r2 = api.post(f"{BASE_URL}/api/cms/reminders",
                  json={"title": "", "due_at": _future_iso()},
                  headers=auth, timeout=15)
    assert r2.status_code in (400, 422)


def test_george_tool_never_pretends_success_on_failure():
    """Capability honesty: complete_reminder against a missing id
    returns an explicit error dict — never a fake success. George's
    prompt tells him to read this and admit the save didn't land."""
    import asyncio
    from services.george import tools as tools_mod

    class _FakeColl:
        async def find_one(self, *a, **kw): return None
        async def delete_one(self, *a, **kw):
            class R: deleted_count = 0
            return R()

    class _DB:
        def __getitem__(self, name): return _FakeColl()
        reminders = _FakeColl()

    complete = tools_mod.TOOL_REGISTRY["complete_reminder"]["run"]
    delete   = tools_mod.TOOL_REGISTRY["delete_reminder"]["run"]

    res = asyncio.run(complete(_DB(), {"id": "does-not-exist"}))
    assert isinstance(res, dict) and res.get("error") == "not_found"

    res2 = asyncio.run(delete(_DB(), {"id": "does-not-exist"}))
    assert res2.get("deleted") is False


def test_george_tool_descriptions_encode_no_side_effects():
    """Reminders tools must be explicitly labelled as no-email,
    no-publish, no-moderation. This is what George reads before
    deciding what a reminder actually does."""
    from services.george import tools as tools_mod

    create = tools_mod.TOOL_REGISTRY["create_reminder"]
    desc = create["description"].lower()
    assert "never send emails" in desc or "reminders never send emails" in desc
    assert "explicit" in desc  # only after explicit user request
    assert "moderation" in desc or "publish" in desc
    # Save-succeeded honesty rule is present.
    assert "never claim a reminder exists" in desc or "never pretend it exists" in desc


def test_store_recurrence_helpers_unit():
    """Direct helpers: unknown recurrence rejected, ISO parsing works."""
    from services.reminders.store import (
        _validate_recurrence, _validate_due_at, _validate_title, _validate_note,
    )
    assert _validate_recurrence("Weekly") == "weekly"
    assert _validate_recurrence(None) == "none"
    with pytest.raises(ValueError):
        _validate_recurrence("yearly")

    iso = _validate_due_at("2026-03-01T09:00:00Z")
    assert iso.endswith("Z") or "+00:00" in iso
    with pytest.raises(ValueError):
        _validate_due_at("")
    with pytest.raises(ValueError):
        _validate_due_at("not-a-date")

    assert _validate_title(" hello ") == "hello"
    with pytest.raises(ValueError):
        _validate_title("")
    with pytest.raises(ValueError):
        _validate_title("x" * 201)

    assert _validate_note(None) == ""
    with pytest.raises(ValueError):
        _validate_note("x" * 1001)
