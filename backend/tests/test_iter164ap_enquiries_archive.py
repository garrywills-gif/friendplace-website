"""iter164ap — Unified Enquiries archive / restore / delete + unread-count.

Backend contract (Mission Control):
  GET    /api/cms/enquiries?kind=&archived=&limit=
  POST   /api/cms/enquiries/{kind}/{id}/archive
  POST   /api/cms/enquiries/{kind}/{id}/restore
  DELETE /api/cms/enquiries/{kind}/{id}

Kinds: contact | interest | support | report | waitlist
  contact  -> contact_submissions   (id)
  interest -> interest_registrations (id)
  support  -> support_tickets        (id OR ref)
  report   -> reports                (id)
  waitlist -> waitlist               (id)

Soft-archive: archived_at (nullable ISO) + archived_by. Missing/null =
active, so legacy records stay active automatically.

Tests run against the live backend over HTTP with a real CMS admin JWT
so route wiring, kind validation and the archived filter are all
exercised end-to-end.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

BASE = "http://localhost:8001/api/cms"
ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASSWORD = "TestPass2026!"


@pytest.fixture(scope="module")
def db():
    load_dotenv("/app/backend/.env")
    client = MongoClient(os.environ["MONGO_URL"])
    yield client[os.environ.get("DB_NAME", "test_database")]
    client.close()


@pytest.fixture(scope="module")
def auth():
    r = requests.post(f"{BASE}/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _list_ids(auth, kind, archived):
    r = requests.get(f"{BASE}/enquiries",
                     params={"kind": kind, "archived": str(archived).lower(), "limit": 500},
                     headers=auth)
    r.raise_for_status()
    return {row["id"] for row in r.json()["rows"]}, r.json()


# ---------------------------------------------------------------------------
# 1. Active list excludes archived; archived view includes archived; restore.
# ---------------------------------------------------------------------------

def test_archive_restore_active_and_archived_views(db, auth):
    tag = f"iter164ap-{uuid.uuid4().hex[:8]}"
    cid = f"contact-{tag}"
    db.contact_submissions.insert_one({
        "id": cid, "name": "Archive Me", "email": f"{tag}@example.com",
        "subject": "Hi", "message": "hello", "status": "new",
        "is_test": False, "created_at": _now(),
    })
    try:
        # Starts active.
        active_ids, _ = _list_ids(auth, "contact", False)
        assert cid in active_ids

        # Archive -> leaves active list, appears in archived view.
        r = requests.post(f"{BASE}/enquiries/contact/{cid}/archive", headers=auth)
        assert r.status_code == 200, r.text
        assert r.json()["archived_at"]

        active_ids, _ = _list_ids(auth, "contact", False)
        archived_ids, _ = _list_ids(auth, "contact", True)
        assert cid not in active_ids, "archived contact must leave the active list"
        assert cid in archived_ids, "archived contact must appear in archived view"

        # Restore -> back in active, gone from archived.
        r = requests.post(f"{BASE}/enquiries/contact/{cid}/restore", headers=auth)
        assert r.status_code == 200, r.text
        active_ids, _ = _list_ids(auth, "contact", False)
        archived_ids, _ = _list_ids(auth, "contact", True)
        assert cid in active_ids, "restored contact must return to the active list"
        assert cid not in archived_ids
    finally:
        db.contact_submissions.delete_one({"id": cid})


# ---------------------------------------------------------------------------
# 2. Archive preserves the full record / history.
# ---------------------------------------------------------------------------

def test_archive_preserves_content(db, auth):
    tag = f"iter164ap-pres-{uuid.uuid4().hex[:8]}"
    cid = f"contact-{tag}"
    original = {
        "id": cid, "name": "History Keeper", "email": f"{tag}@example.com",
        "subject": "Important", "message": "Long detailed message here",
        "status": "replied", "is_test": False, "created_at": _now(),
        "history": [{"at": _now(), "note": "actioned"}],
    }
    db.contact_submissions.insert_one(dict(original))
    try:
        r = requests.post(f"{BASE}/enquiries/contact/{cid}/archive", headers=auth)
        assert r.status_code == 200, r.text
        doc = db.contact_submissions.find_one({"id": cid}, {"_id": 0})
        # Everything preserved; only archive metadata added.
        assert doc["name"] == original["name"]
        assert doc["subject"] == original["subject"]
        assert doc["message"] == original["message"]
        assert doc["status"] == original["status"]
        assert doc["created_at"] == original["created_at"]
        assert doc["history"] == original["history"]
        assert doc["archived_at"]
        assert doc["archived_by"] == ADMIN_EMAIL
    finally:
        db.contact_submissions.delete_one({"id": cid})


# ---------------------------------------------------------------------------
# 3. Permanent delete removes ONLY the intended source record.
# ---------------------------------------------------------------------------

def test_delete_removes_only_target(db, auth):
    tag = f"iter164ap-del-{uuid.uuid4().hex[:8]}"
    target = f"report-{tag}-A"
    bystander = f"report-{tag}-B"
    other_kind = f"contact-{tag}"
    db.reports.insert_many([
        {"id": target, "reason": "Spam", "status": "new", "is_test": False, "created_at": _now()},
        {"id": bystander, "reason": "Spam", "status": "new", "is_test": False, "created_at": _now()},
    ])
    db.contact_submissions.insert_one(
        {"id": other_kind, "name": "Keep", "email": f"{tag}@x.com",
         "status": "new", "is_test": False, "created_at": _now()})
    try:
        r = requests.delete(f"{BASE}/enquiries/report/{target}", headers=auth)
        assert r.status_code == 200, r.text
        assert r.json()["deleted"] == 1
        # Only the target report is gone.
        assert db.reports.find_one({"id": target}) is None
        assert db.reports.find_one({"id": bystander}) is not None
        # A same-id-suffix record in another collection is untouched.
        assert db.contact_submissions.find_one({"id": other_kind}) is not None
    finally:
        db.reports.delete_many({"id": {"$in": [target, bystander]}})
        db.contact_submissions.delete_one({"id": other_kind})


# ---------------------------------------------------------------------------
# 4. Support tickets addressable by ref (unified list exposes ref as id).
# ---------------------------------------------------------------------------

def test_support_archive_by_ref(db, auth):
    tag = f"iter164ap-sup-{uuid.uuid4().hex[:8]}"
    internal_id = f"sup-internal-{tag}"
    ref = f"FP-{tag.upper()}"
    db.support_tickets.insert_one({
        "id": internal_id, "ref": ref, "subject": "Help", "message": "please",
        "status": "open", "is_test": False, "created_at": _now(),
    })
    try:
        # The unified list exposes ref as the row id; archive by ref works.
        r = requests.post(f"{BASE}/enquiries/support/{ref}/archive", headers=auth)
        assert r.status_code == 200, r.text
        doc = db.support_tickets.find_one({"id": internal_id}, {"_id": 0})
        assert doc["archived_at"]
        archived_ids, _ = _list_ids(auth, "support", True)
        assert ref in archived_ids
    finally:
        db.support_tickets.delete_one({"id": internal_id})


# ---------------------------------------------------------------------------
# 5. Unknown kind rejected (400) on every verb.
# ---------------------------------------------------------------------------

def test_unknown_kind_rejected(auth):
    for method, url in [
        ("post",   f"{BASE}/enquiries/banana/xyz/archive"),
        ("post",   f"{BASE}/enquiries/banana/xyz/restore"),
        ("delete", f"{BASE}/enquiries/banana/xyz"),
    ]:
        r = getattr(requests, method)(url, headers=auth)
        assert r.status_code == 400, f"{method} {url} -> {r.status_code}"


# ---------------------------------------------------------------------------
# 6. 404 for missing record.
# ---------------------------------------------------------------------------

def test_missing_record_404(auth):
    r = requests.post(f"{BASE}/enquiries/contact/does-not-exist/archive", headers=auth)
    assert r.status_code == 404
    r = requests.delete(f"{BASE}/enquiries/contact/does-not-exist", headers=auth)
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# 7. unread-count excludes archived contacts; interest never affects it.
# ---------------------------------------------------------------------------

def test_unread_count_excludes_archived_and_interest(db, auth):
    tag = f"iter164ap-uc-{uuid.uuid4().hex[:8]}"
    cid = f"contact-{tag}"
    iid = f"interest-{tag}"

    def _count():
        r = requests.get(f"{BASE}/enquiries/unread-count", headers=auth)
        r.raise_for_status()
        return r.json()["count"]

    try:
        before = _count()

        # New Register Interest -> must NOT change the count.
        db.interest_registrations.insert_one({
            "id": iid, "first_name": "Pat", "email": f"{tag}@x.com",
            "status": "new", "is_test": False, "created_at": _now()})
        assert _count() == before, "interest must not affect unread-count"

        # New contact -> +1.
        db.contact_submissions.insert_one({
            "id": cid, "name": "Realist", "email": f"{tag}@x.com",
            "subject": "Hi", "message": "genuine", "status": "new",
            "is_test": False, "created_at": _now()})
        assert _count() == before + 1

        # Archive the contact -> back to baseline (archived excluded).
        r = requests.post(f"{BASE}/enquiries/contact/{cid}/archive", headers=auth)
        assert r.status_code == 200, r.text
        assert _count() == before, "archived contact must be excluded from unread-count"

        # Restore -> counted again.
        requests.post(f"{BASE}/enquiries/contact/{cid}/restore", headers=auth)
        assert _count() == before + 1
    finally:
        db.contact_submissions.delete_one({"id": cid})
        db.interest_registrations.delete_one({"id": iid})


# ---------------------------------------------------------------------------
# 8. Blank-name submissions are valid, active, and counted (not test data).
# ---------------------------------------------------------------------------

def test_blank_name_submission_is_active_and_counted(db, auth):
    tag = f"iter164ap-blank-{uuid.uuid4().hex[:8]}"
    cid = f"contact-{tag}"

    def _count():
        r = requests.get(f"{BASE}/enquiries/unread-count", headers=auth)
        r.raise_for_status()
        return r.json()["count"]

    db.contact_submissions.insert_one({
        "id": cid, "name": "", "email": f"{tag}@example.com",
        "subject": "No name here", "message": "still a real enquiry",
        "status": "new", "is_test": False, "created_at": _now(),
    })
    try:
        before_active, _ = _list_ids(auth, "contact", False)
        assert cid in before_active, "blank-name contact must remain active"
        # It is counted as a real unread contact (not auto-treated as test).
        cnt_with = _count()
        db.contact_submissions.update_one({"id": cid}, {"$set": {"status": "replied"}})
        assert _count() == cnt_with - 1, "blank-name contact was a genuine unread record"
    finally:
        db.contact_submissions.delete_one({"id": cid})
