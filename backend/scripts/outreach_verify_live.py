"""End-to-end verification of the Outreach admin surface against the
running backend (``http://localhost:8001``).

Runs the exact HTTP calls the deployed Vercel frontend makes:

    1.  GET  /api/cms/outreach/meta
    2.  GET  /api/cms/outreach/organisations                      (active)
    3.  GET  /api/cms/outreach/organisations?archived=true        (archived)
    4.  POST /api/cms/outreach/organisations                      (manual form)
    5.  POST /api/cms/outreach/organisations   x3                 (spreadsheet import)
    6.  POST /api/cms/outreach/organisations   (dup email)        (idempotency)
    7.  GET  /api/cms/outreach/organisations/{id}                 (detail)
    8.  PATCH /api/cms/outreach/organisations/{id}                (inline edit)
    9.  POST /api/cms/outreach/organisations/{id}/log             (add note)
    10. POST /api/cms/outreach/organisations/{id}/mark-replied    (record reply)
    11. POST /api/cms/outreach/organisations/{id}/archive         (archive)
    12. GET  ...?archived=true                                    (visible archived)
    13. POST /api/cms/outreach/organisations/{id}/unarchive       (restore)
    14. DELETE /api/cms/outreach/organisations/{id}               (soft-delete)
    15. POST /api/cms/outreach/organisations/{id}/restore         (restore alias)
    16. Cleanup: hard-delete every row we created (Mongo, marker-prefixed).

Every test row is prefixed with ``VERIFY-LIVE-<ts>`` in the notes and
uses ``verify-live-...@no-email.reconciled.local`` as the email so the
cleanup pass can wipe them with a single Mongo query.

Exit codes:
    0  every step passed
    1  something failed — inspect stdout for the first ✗

Run:
    python /app/backend/scripts/outreach_verify_live.py
"""
from __future__ import annotations

import json
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv  # noqa: E402
load_dotenv(BACKEND_DIR / ".env")

import requests  # noqa: E402
from pymongo import MongoClient  # noqa: E402


BASE = "http://localhost:8001/api"
CMS_EMAIL = "hello@friendplace.com.au"
CMS_PASS  = "TestPass2026!"
MARKER    = f"verify-live-{int(time.time())}"

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME   = os.environ["DB_NAME"]


class Fail(Exception):
    pass


def _ok(msg: str) -> None:
    print(f"  ✓ {msg}")


def _step(msg: str) -> None:
    print(f"\n▶ {msg}")


def _assert(cond: bool, msg: str) -> None:
    if not cond:
        raise Fail(msg)


def _login() -> str:
    r = requests.post(f"{BASE}/cms/auth/login",
                      json={"email": CMS_EMAIL, "password": CMS_PASS}, timeout=10)
    _assert(r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}")
    return r.json()["token"]


def _hdrs(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def main() -> int:
    created_ids: List[str] = []
    try:
        token = _login()
        _ok(f"logged in as {CMS_EMAIL}")

        # 1) meta
        _step("meta")
        r = requests.get(f"{BASE}/cms/outreach/meta", headers=_hdrs(token), timeout=10)
        _assert(r.status_code == 200, f"meta {r.status_code}")
        meta = r.json()
        _assert("statuses" in meta and "categories" in meta,
                f"meta missing keys: {meta}")
        _ok(f"meta returned {len(meta['statuses'])} statuses, "
            f"{len(meta['categories'])} categories")

        # 2) active list
        _step("list — active")
        r = requests.get(f"{BASE}/cms/outreach/organisations",
                         headers=_hdrs(token), timeout=10)
        _assert(r.status_code == 200, f"active list {r.status_code}")
        active = r.json()
        _assert("rows" in active and "organisations" in active,
                f"missing dual aliases: {list(active.keys())}")
        _ok(f"active list ok — {active['count']} rows, both `rows` "
            f"and `organisations` aliases present")

        # 3) archived list
        _step("list — archived")
        r = requests.get(f"{BASE}/cms/outreach/organisations?archived=true",
                         headers=_hdrs(token), timeout=10)
        _assert(r.status_code == 200, f"archived list {r.status_code}")
        _ok(f"archived list ok — {r.json()['count']} rows")

        # 4) create (manual form shape)
        _step("create — manual form")
        payload_manual = {
            "organisation_name": f"{MARKER}-manual",
            "email":            f"{MARKER}-manual@no-email.reconciled.local",
            "phone":            "02 9999 0000",
            "contact_name":     "Manual Test",
            "category":         "verify-live",
            "suburb":           "Sydney",
            "state":            "NSW",
            "notes":            "created by outreach_verify_live",
            "tags":             ["verify", "live"],
        }
        r = requests.post(f"{BASE}/cms/outreach/organisations",
                          headers=_hdrs(token), json=payload_manual, timeout=10)
        _assert(r.status_code in (200, 201), f"create manual {r.status_code} {r.text}")
        body = r.json()
        _assert(body["existing"] is False, "manual create should be new")
        manual_id = body["id"]
        created_ids.append(manual_id)
        row = body["organisation"]
        _assert(row["organisation_name"] == payload_manual["organisation_name"],
                "organisation_name mismatch")
        _assert(row["email"]             == payload_manual["email"],
                "email mismatch")
        _assert(row["phone"]             == payload_manual["phone"],
                "phone mismatch")
        _assert(row["status"] == "not_contacted",
                f"unexpected default status {row['status']}")
        _ok(f"manual create ok — id={manual_id}")

        # 5) create x3 (spreadsheet import shape)
        _step("create — spreadsheet import x3")
        sheet_rows = [
            {"organisation_name": f"{MARKER}-sheet-1",
             "email": f"{MARKER}-sheet-1@no-email.reconciled.local",
             "category": "retirement-village", "state": "NSW"},
            {"organisation_name": f"{MARKER}-sheet-2",
             "email": f"{MARKER}-sheet-2@no-email.reconciled.local",
             "category": "rsl", "state": "VIC"},
            {"organisation_name": f"{MARKER}-sheet-3",
             "email": f"{MARKER}-sheet-3@no-email.reconciled.local",
             "category": "library", "state": "QLD"},
        ]
        for p in sheet_rows:
            r = requests.post(f"{BASE}/cms/outreach/organisations",
                              headers=_hdrs(token), json=p, timeout=10)
            _assert(r.status_code in (200, 201),
                    f"sheet row create {r.status_code} {r.text}")
            _assert(r.json()["existing"] is False, "sheet row should be new")
            created_ids.append(r.json()["id"])
        _ok(f"spreadsheet-shape imported {len(sheet_rows)} rows")

        # 6) duplicate protection
        _step("create — duplicate email is idempotent")
        r = requests.post(f"{BASE}/cms/outreach/organisations",
                          headers=_hdrs(token), json=sheet_rows[0], timeout=10)
        _assert(r.status_code == 200, f"dup create {r.status_code}")
        _assert(r.json()["existing"] is True, "duplicate must return existing:true")
        _ok("duplicate returns existing:true — no double-insert")

        # 7) detail
        _step("detail")
        r = requests.get(f"{BASE}/cms/outreach/organisations/{manual_id}",
                         headers=_hdrs(token), timeout=10)
        _assert(r.status_code == 200, f"detail {r.status_code}")
        detail = r.json()
        _assert(detail["id"] == manual_id, "detail id mismatch")
        _assert(detail["communications"] == [], "fresh row must have empty history")
        _ok("detail ok")

        # 8) patch (inline edit)
        _step("patch — inline edit")
        r = requests.patch(f"{BASE}/cms/outreach/organisations/{manual_id}",
                           headers=_hdrs(token),
                           json={"notes": "edited by verify-live",
                                 "status": "awaiting_reply"},
                           timeout=10)
        _assert(r.status_code == 200, f"patch {r.status_code}")
        _assert(r.json()["notes"] == "edited by verify-live", "note not saved")
        _assert(r.json()["status"] == "awaiting_reply", "status not saved")
        _ok("patch ok")

        # 9) log
        _step("log — add contact-history entry")
        r = requests.post(f"{BASE}/cms/outreach/organisations/{manual_id}/log",
                          headers=_hdrs(token),
                          json={"kind": "phone_call",
                                "body": "Called; left voicemail."},
                          timeout=10)
        _assert(r.status_code == 200, f"log {r.status_code}")
        history = r.json()["communications"]
        _assert(len(history) == 1 and history[0]["kind"] == "phone_call",
                f"log did not append: {history}")
        _ok("log appended")

        # 10) mark-replied
        _step("mark-replied")
        r = requests.post(f"{BASE}/cms/outreach/organisations/{manual_id}/mark-replied",
                          headers=_hdrs(token),
                          json={"subject": "Yes we're keen",
                                "body": "Great — call me anytime."},
                          timeout=10)
        _assert(r.status_code == 200, f"mark-replied {r.status_code}")
        _assert(r.json()["status"] == "replied", "status should be replied")
        _assert(r.json()["last_reply_at"], "last_reply_at missing")
        _assert(len(r.json()["communications"]) == 2, "reply not appended")
        _ok("mark-replied ok")

        # 11) archive
        _step("archive")
        r = requests.post(f"{BASE}/cms/outreach/organisations/{manual_id}/archive",
                          headers=_hdrs(token), timeout=10)
        _assert(r.status_code == 200, f"archive {r.status_code}")
        _assert(r.json()["archived"] is True, "archive did not flip flag")
        _ok("archive ok")

        # 12) archived list now includes our row
        _step("archived list contains our row")
        r = requests.get(f"{BASE}/cms/outreach/organisations?archived=true",
                         headers=_hdrs(token), timeout=10)
        arch_ids = [r_["id"] for r_ in r.json()["rows"]]
        _assert(manual_id in arch_ids, "archived row not surfaced")
        _ok("archived row visible via ?archived=true")

        # 13) unarchive
        _step("unarchive")
        r = requests.post(f"{BASE}/cms/outreach/organisations/{manual_id}/unarchive",
                          headers=_hdrs(token), timeout=10)
        _assert(r.status_code == 200 and r.json()["archived"] is False,
                f"unarchive {r.status_code} {r.text}")
        _ok("unarchive ok")

        # 14) DELETE → soft-archive
        _step("DELETE → soft-archive (never hard-delete)")
        r = requests.delete(f"{BASE}/cms/outreach/organisations/{manual_id}",
                            headers=_hdrs(token), timeout=10)
        _assert(r.status_code == 200, f"delete {r.status_code}")
        body = r.json()
        _assert(body["deleted"] is False and body["archived"] is True,
                f"DELETE must soft-archive, got {body}")
        # Confirm row still in Mongo
        cli = MongoClient(MONGO_URL)
        try:
            doc = cli[DB_NAME].outreach_organisations.find_one({"id": manual_id})
            _assert(doc is not None, "row was hard-deleted — policy violation")
            _assert(doc.get("archived") is True, "row not archived")
        finally:
            cli.close()
        _ok("DELETE soft-archived (row still present, archived=true)")

        # 15) restore alias
        _step("restore alias")
        r = requests.post(f"{BASE}/cms/outreach/organisations/{manual_id}/restore",
                          headers=_hdrs(token), timeout=10)
        _assert(r.status_code == 200 and r.json()["archived"] is False,
                f"restore {r.status_code}")
        _ok("restore alias ok")

        print("\n═══════════════════════════════════════════════════════════")
        print(f"  ALL {14} OUTREACH FLOWS VERIFIED END-TO-END ✓")
        print("═══════════════════════════════════════════════════════════")
        return 0
    except Fail as exc:
        print(f"\n✗ FAILED: {exc}")
        return 1
    except Exception as exc:  # pragma: no cover — infra failure
        print(f"\n✗ UNEXPECTED: {exc!r}")
        return 1
    finally:
        # Cleanup — wipe every row we created regardless of pass/fail.
        cli = MongoClient(MONGO_URL)
        try:
            if created_ids:
                res = cli[DB_NAME].outreach_organisations.delete_many({"id": {"$in": created_ids}})
                # Also nuke anything with our marker in case of partial ids
                res2 = cli[DB_NAME].outreach_organisations.delete_many(
                    {"contact_email": {"$regex": f"^{MARKER}"}})
                print(f"\ncleanup: removed {res.deleted_count + res2.deleted_count} verify-live rows")
        finally:
            cli.close()


if __name__ == "__main__":
    sys.exit(main())
