"""Iter153 — Notice Board moderation parity (P0 launch blocker).

Verifies the shared moderation heuristic (business-content + prolific-poster
gate) runs against the Notice Board just like it does for the events
preflight, and that held notices land in the shared MCGS moderation queue
with an admin approve / reject flow.

Reference doc: services/moderation/business_content.py + server.py
(POST /api/notices, admin_notice_approve, admin_notice_reject,
admin_notices_moderation_queue).
"""

from __future__ import annotations

import asyncio
import os
import secrets
import subprocess
import sys
import time
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv as _load_dotenv

_load_dotenv(Path(__file__).resolve().parent.parent / ".env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


# ── shared helpers ────────────────────────────────────────────────────

def _signup():
    """Create a fresh real user. Returns (token, user)."""
    suffix = secrets.token_hex(4)
    username = f"TEST_MOD_{suffix}"
    r = requests.post(f"{API}/auth/signup", json={
        "username": username,
        "password": "Test1234!",
        "email": f"{username.lower()}@example.com",
        "first_name": "Mod",
    }, timeout=15)
    assert r.status_code == 200, f"signup failed: {r.status_code} {r.text}"
    d = r.json()
    return d["access_token"], d["user"]


def _delete_self(token):
    try:
        requests.delete(f"{API}/users/me",
                        headers={"Authorization": f"Bearer {token}"}, timeout=10)
    except Exception:
        pass


def _admin_login():
    """Return an admin JWT + user dict via demo-login as maggie (is_admin=True)."""
    r = requests.post(f"{API}/auth/demo-login", json={"username": "maggie"}, timeout=15)
    assert r.status_code == 200, f"demo-login failed: {r.status_code} {r.text}"
    d = r.json()
    assert d["user"].get("is_admin"), "maggie is not admin — fix seed"
    return d["access_token"], d["user"]


def _admin_headers():
    tok, _ = _admin_login()
    return {"Authorization": f"Bearer {tok}"}


def _post_notice(user, title: str, body: str = ""):
    return requests.post(f"{API}/notices", json={
        "user_id": user["id"],
        "user_name": user.get("username", ""),
        "avatar":    user.get("avatar", "🙂"),
        "title":     title,
        "body":      body,
        "category":  "Announcement",
    }, timeout=15)


def _mongo():
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    return client, client[os.environ.get("DB_NAME") or "friendplace"]


def _run(coro):
    """Small helper to run an async block inside a sync test."""
    return asyncio.get_event_loop().run_until_complete(coro) if False else asyncio.run(coro)


# ── 1. Pure-function check_business_content ───────────────────────────
class TestPureCheckBusinessContent:
    def test_empty_inputs_return_zero(self):
        from services.moderation import check_business_content
        v = check_business_content("", "", "")
        assert v == {"looks_business": False, "score": 0, "reasons": []}

    def test_score_ge_2_flags_true(self):
        from services.moderation import check_business_content
        v = check_business_content("Grand opening Cafe Botanica", "Book now — 20% off")
        assert v["score"] >= 2
        assert v["looks_business"] is True

    def test_benign_score_below_2(self):
        from services.moderation import check_business_content
        v = check_business_content("Looking for a walking companion", "Bondi at 7am")
        assert v["score"] < 2
        assert v["looks_business"] is False

    def test_reasons_capped_at_4(self):
        from services.moderation import check_business_content
        v = check_business_content(
            "Cafe grand opening — book now 20% off",
            "Call 1300 555 001 or visit www.example.com — $25 per person",
            "The RSL club",
        )
        assert v["looks_business"] is True
        assert isinstance(v["reasons"], list)
        assert len(v["reasons"]) <= 4


# ── 2. Preflight regression — events heuristic must still work ────────
class TestEventsPreflightUnchanged:
    def test_positive_rsl(self):
        r = requests.post(f"{API}/events/preflight", json={
            "title": "Friday Trivia at the Bondi RSL",
            "description": "",
            "location": "Bondi RSL",
        }, timeout=10)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["looks_business"] is True
        assert b["score"] >= 2
        assert isinstance(b["reasons"], list) and b["reasons"]

    def test_negative_walk(self):
        r = requests.post(f"{API}/events/preflight", json={
            "title": "Saturday morning walk",
            "description": "",
            "location": "Centennial Park",
        }, timeout=10)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["looks_business"] is False


# ── 3. POST /api/notices — benign, held, RSL, prolific ────────────────
class TestNoticeCreateHeuristic:
    def test_benign_notice_not_held(self):
        tok, u = _signup()
        try:
            r = _post_notice(u, "TEST_MOD_ Looking for a walking companion",
                             "Sunday mornings around the park would be lovely.")
            assert r.status_code == 200, r.text
            d = r.json()
            assert d.get("held_for_review") is False
            assert "moderation_message" not in d
            # Persisted doc should NOT carry pending_review/auto_hidden.
            _, mdb = _mongo()

            async def _check():
                doc = await mdb.notices.find_one({"id": d["id"]}, {"_id": 0})
                assert doc is not None
                assert not doc.get("pending_review")
                assert not doc.get("auto_hidden")
            _run(_check())
        finally:
            _delete_self(tok)

    def test_business_notice_is_held(self):
        tok, u = _signup()
        try:
            r = _post_notice(u,
                "TEST_MOD_ Grand opening at Cafe Botanica!",
                "Book now — 20% off dinner. Ph: 1300 555 001",
            )
            assert r.status_code == 200, r.text
            d = r.json()
            assert d.get("held_for_review") is True, d
            msg = d.get("moderation_message", "")
            assert msg, "moderation_message missing"
            # Wording MUST NOT accuse the poster
            low = msg.lower()
            assert "business" not in low and "spam" not in low
            # Reasons: business noun / ticketing / phone
            _, mdb = _mongo()

            async def _check():
                doc = await mdb.notices.find_one({"id": d["id"]}, {"_id": 0})
                assert doc is not None, "notice not persisted"
                assert doc.get("pending_review") is True
                assert doc.get("auto_hidden") is True
                reasons_joined = " | ".join(doc.get("moderation_reasons") or []).lower()
                # Look for at least two of the expected buckets
                hits = 0
                if "cafe" in reasons_joined or "café" in reasons_joined or "business noun" in reasons_joined:
                    hits += 1
                if "ticket" in reasons_joined or "promo" in reasons_joined or "% off" in reasons_joined or " off" in reasons_joined or "book now" in reasons_joined:
                    hits += 1
                if "phone" in reasons_joined or "1300" in reasons_joined or "1800" in reasons_joined:
                    hits += 1
                assert hits >= 2, f"expected ≥2 reason buckets, got {doc.get('moderation_reasons')}"

                # MCGS case + signal exist (case carries case_key,
                # signal carries producer).
                case = await mdb.mcgs_cases.find_one(
                    {"case_key": f"notice_moderation:{doc['id']}"}, {"_id": 0}
                )
                assert case is not None, "no MCGS case created"
                assert case.get("producer") == "notice_moderation" or \
                       case.get("case_key", "").startswith("notice_moderation:")
                sig = await mdb.mcgs_signals.find_one(
                    {"case_id": case["id"]}, {"_id": 0}
                )
                assert sig is not None, "no MCGS signal filed on the case"
                assert sig.get("producer") == "notice_moderation"

            _run(_check())
        finally:
            _delete_self(tok)

    def test_rsl_club_held(self):
        tok, u = _signup()
        try:
            r = _post_notice(u,
                "TEST_MOD_ Bingo night at the RSL Club",
                "Every Thursday.")
            assert r.status_code == 200, r.text
            d = r.json()
            assert d.get("held_for_review") is True, d
            _, mdb = _mongo()

            async def _check():
                doc = await mdb.notices.find_one({"id": d["id"]}, {"_id": 0})
                assert doc.get("moderation_score", 0) >= 2
                reasons_joined = " | ".join(doc.get("moderation_reasons") or []).lower()
                assert "rsl" in reasons_joined or "club" in reasons_joined, doc.get("moderation_reasons")
            _run(_check())
        finally:
            _delete_self(tok)

    def test_prolific_poster_held_even_for_benign_text(self):
        tok, u = _signup()
        try:
            # Post 3 benign notices — the 4th (which would put prior_count=3)
            # should trip the prolific gate.
            for i in range(3):
                r = _post_notice(u,
                    f"TEST_MOD_ Small chat idea #{i}",
                    "Just a friendly community thought.")
                assert r.status_code == 200, r.text
                assert r.json().get("held_for_review") is False

            # 4th benign post — should be held due to prolific gate
            r4 = _post_notice(u,
                "TEST_MOD_ Fourth friendly note",
                "Another gentle community thought.")
            assert r4.status_code == 200, r4.text
            d = r4.json()
            assert d.get("held_for_review") is True, d
            _, mdb = _mongo()

            async def _check():
                doc = await mdb.notices.find_one({"id": d["id"]}, {"_id": 0})
                reasons = doc.get("moderation_reasons") or []
                joined = " | ".join(reasons)
                assert "prolific_poster" in joined, reasons
            _run(_check())
        finally:
            _delete_self(tok)


# ── 4. Public listing excludes held notices ───────────────────────────
class TestListingExcludesHeld:
    def test_held_notice_not_in_public_listing(self):
        tok, u = _signup()
        try:
            r = _post_notice(u,
                "TEST_MOD_ Grand opening at Cafe Botanica!",
                "Book now — 20% off dinner. Ph: 1300 555 001")
            assert r.status_code == 200
            d = r.json()
            assert d["held_for_review"] is True
            listing = requests.get(f"{API}/notices", timeout=10)
            assert listing.status_code == 200
            ids = [n.get("id") for n in listing.json()]
            assert d["id"] not in ids, "held notice leaked into public listing"
        finally:
            _delete_self(tok)


# ── 5. Admin moderation queue + approve + reject ──────────────────────
class TestAdminModerationFlow:
    def test_queue_returns_pending_notices(self):
        # Seed a held notice
        tok, u = _signup()
        try:
            r = _post_notice(u,
                "TEST_MOD_ Bingo night at the RSL Club",
                "Every Thursday. Ph 1300 555 002")
            assert r.status_code == 200 and r.json()["held_for_review"] is True
            notice_id = r.json()["id"]

            atok, adm = _admin_login()
            q = requests.get(
                f"{API}/admin/notices/moderation-queue",
                params={"admin_id": adm["id"], "limit": 200},
                headers={"Authorization": f"Bearer {atok}"},
                timeout=15,
            )
            assert q.status_code == 200, q.text
            body = q.json()
            assert "items" in body and isinstance(body["items"], list)
            item = next((it for it in body["items"] if it["id"] == notice_id), None)
            assert item is not None, "held notice missing from queue"
            assert item.get("pending_review") is True
            assert "recent_notice_count" in item
            assert "prior_moderation_actions" in item
        finally:
            _delete_self(tok)

    def test_approve_flow(self):
        tok, u = _signup()
        try:
            r = _post_notice(u,
                "TEST_MOD_ Grand opening at Cafe Botanica!",
                "Book now — 20% off dinner. Ph: 1300 555 001")
            notice_id = r.json()["id"]
            assert r.json()["held_for_review"] is True

            atok, adm = _admin_login()

            async def _pts_before():
                _, mdb0 = _mongo()
                doc = await mdb0.users.find_one({"id": u["id"]}, {"_id": 0, "points": 1})
                return int((doc or {}).get("points") or 0)
            pts_before = _run(_pts_before())

            ar = requests.post(
                f"{API}/admin/notices/{notice_id}/approve",
                headers={"Authorization": f"Bearer {atok}"},
                json={"admin_id": adm["id"], "reason": "looks fine on review"},
                timeout=15,
            )
            assert ar.status_code == 200, ar.text
            assert ar.json().get("status") == "approved"

            _, mdb = _mongo()

            async def _check():
                doc = await mdb.notices.find_one({"id": notice_id}, {"_id": 0})
                assert doc.get("pending_review") is False
                assert doc.get("auto_hidden") is False
                log = await mdb.moderation_log.find_one(
                    {"target_id": notice_id, "action": "notice_approved"}, {"_id": 0}
                )
                assert log is not None, "moderation_log entry missing on approve"
                case = await mdb.mcgs_cases.find_one(
                    {"case_key": f"notice_moderation:{notice_id}"}, {"_id": 0}
                )
                if case:
                    assert case.get("status") in ("RESOLVED", "DISMISSED"), case.get("status")
            _run(_check())

            after = None

            async def _pts_after():
                _, mdb1 = _mongo()
                doc = await mdb1.users.find_one({"id": u["id"]}, {"_id": 0, "points": 1})
                return int((doc or {}).get("points") or 0)
            pts_after = _run(_pts_after())
            assert pts_after >= pts_before + 4, f"expected +4 pts, before={pts_before} after={pts_after}"
        finally:
            _delete_self(tok)

    def test_reject_flow(self):
        tok, u = _signup()
        try:
            r = _post_notice(u,
                "TEST_MOD_ Grand opening at Cafe Botanica two",
                "Book now — 20% off. Ph: 1800 555 003")
            notice_id = r.json()["id"]
            assert r.json()["held_for_review"] is True

            atok, adm = _admin_login()
            rr = requests.post(
                f"{API}/admin/notices/{notice_id}/reject",
                headers={"Authorization": f"Bearer {atok}"},
                json={"admin_id": adm["id"], "reason": "clear business promo"},
                timeout=15,
            )
            assert rr.status_code == 200, rr.text
            assert rr.json().get("status") == "rejected"

            _, mdb = _mongo()

            async def _check():
                doc = await mdb.notices.find_one({"id": notice_id}, {"_id": 0})
                assert doc.get("pending_review") is False
                assert doc.get("auto_hidden") is True
                assert doc.get("removed") is True
                assert (doc.get("moderation_rejection_reason") or "").strip() != ""
                log = await mdb.moderation_log.find_one(
                    {"target_id": notice_id, "action": "notice_rejected"}, {"_id": 0}
                )
                assert log is not None, "moderation_log entry missing on reject"
            _run(_check())
        finally:
            _delete_self(tok)


# ── 6. Retroactive scan script ────────────────────────────────────────
class TestRetroactiveScan:
    def _run_script(self, *extra):
        cmd = [sys.executable, "-m", "scripts.scan_existing_notices", *extra]
        return subprocess.run(cmd, cwd=str(BACKEND_DIR),
                              capture_output=True, text=True, timeout=60)

    def test_dry_run_does_not_write(self):
        # Seed a notice that pre-existed and was NOT flagged (simulate legacy row).
        tok, u = _signup()
        try:
            # Insert a plain document straight into Mongo bypassing the live
            # gate so we have a "legacy" business-y notice to catch.

            nid_holder = {"id": None}

            async def _seed():
                from datetime import datetime, timezone
                _, mdb = _mongo()
                doc = {
                    "id": f"TEST_MOD_legacy_{secrets.token_hex(3)}",
                    "user_id": u["id"],
                    "user_name": u.get("username", ""),
                    "title": "TEST_MOD_ Grand opening Cafe Legacy",
                    "body": "Book now — 20% off. Ph 1300 555 999",
                    "category": "Announcement",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "pending_review": False,
                    "auto_hidden": False,
                    "is_test": True,
                }
                await mdb.notices.insert_one(doc)
                nid_holder["id"] = doc["id"]
            _run(_seed())
            nid = nid_holder["id"]

            # Dry-run
            r = self._run_script("--limit", "50")
            assert r.returncode == 0, r.stderr
            assert "Scanned" in r.stdout
            assert "would be flagged" in r.stdout or "Dry run" in r.stdout

            async def _verify_unchanged():
                _, mdb = _mongo()
                doc = await mdb.notices.find_one({"id": nid}, {"_id": 0})
                assert doc is not None
                assert doc.get("pending_review") in (False, None)
                assert doc.get("auto_hidden") in (False, None)
            _run(_verify_unchanged())

            # Snapshot auto_hidden before --apply
            async def _snapshot():
                _, mdb = _mongo()
                doc = await mdb.notices.find_one({"id": nid}, {"_id": 0})
                return bool(doc.get("auto_hidden"))
            before_ah = _run(_snapshot())

            r2 = self._run_script("--apply", "--limit", "50")
            assert r2.returncode == 0, r2.stderr

            async def _verify_applied():
                _, mdb = _mongo()
                doc = await mdb.notices.find_one({"id": nid}, {"_id": 0})
                assert doc.get("pending_review") is True, "expected pending_review=True after --apply"
                assert bool(doc.get("auto_hidden")) == before_ah, (
                    "retro scan MUST NOT toggle auto_hidden"
                )
                assert doc.get("moderation_reasons"), "expected moderation_reasons written"
            _run(_verify_applied())

            # Cleanup seeded legacy row so subsequent runs stay quiet.
            async def _cleanup():
                _, mdb = _mongo()
                await mdb.notices.delete_one({"id": nid})
            _run(_cleanup())
        finally:
            _delete_self(tok)
