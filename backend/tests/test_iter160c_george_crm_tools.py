"""iter160c — George's unified CRM tools tests.

Six new tools + prompt updates. Backend-only. Uses direct tool
execution via services.george.tools.execute_tool + Motor client
to seed data. Cleanup uses is_test=True + explicit id lists.
"""
from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

# Ensure backend importable
import sys
sys.path.insert(0, "/app/backend")

from services.george.tools import (  # noqa: E402
    TOOL_REGISTRY, tool_schema_for_planner, execute_tool, ToolError,
)
from services.george.prompt import build_system_prompt, MCGS_CAPABILITY_MAP  # noqa: E402
from services.replies.store import create_reply  # noqa: E402
from services.outreach.store import upsert_org  # noqa: E402


BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://george-mcgs-cms.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL") or "mongodb://localhost:27017"
DB_NAME = os.environ.get("DB_NAME") or "test_database"

ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASSWORD = "TestPass2026!"

NEW_TOOLS = [
    "list_awaiting_reply",
    "count_replies",
    "list_outreach_organisations",
    "count_outreach_organisations",
    "list_needs_follow_up",
    "get_contact_status",
]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="module")
def db(event_loop):
    client = AsyncIOMotorClient(MONGO_URL)
    d = client[DB_NAME]
    yield d
    client.close()


@pytest.fixture(scope="module")
def admin_token() -> str:
    r = requests.post(
        f"{BASE_URL}/api/cms/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth_headers(admin_token: str) -> dict:
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture
def seeded_ids(event_loop, db):
    """Track ids per-test so cleanup is guaranteed."""
    ids = {"orgs": [], "replies": []}
    yield ids

    async def _cleanup():
        for oid in ids["orgs"]:
            try:
                await db.outreach_organisations.delete_one({"id": oid})
            except Exception:
                pass
        for rid in ids["replies"]:
            try:
                await db.inbound_replies.delete_one({"id": rid})
            except Exception:
                pass
    event_loop.run_until_complete(_cleanup())


def _uniq_email(tag: str = "iter160c") -> str:
    return f"{tag}_{uuid.uuid4().hex[:10]}@example.test"


# ---------------------------------------------------------------------------
# 1. Tool registration
# ---------------------------------------------------------------------------

class TestToolRegistration:
    def test_all_six_tools_in_registry(self):
        missing = [t for t in NEW_TOOLS if t not in TOOL_REGISTRY]
        assert not missing, f"Missing tools in TOOL_REGISTRY: {missing}"

    def test_planner_schema_contains_all_six(self):
        schema = tool_schema_for_planner()
        names = {s["name"] for s in schema}
        missing = [t for t in NEW_TOOLS if t not in names]
        assert not missing, f"Missing tools in planner schema: {missing}"
        # descriptions must be non-empty
        for s in schema:
            if s["name"] in NEW_TOOLS:
                assert s.get("description"), f"{s['name']} has empty description"


# ---------------------------------------------------------------------------
# 2. list_awaiting_reply — ordering + empty
# ---------------------------------------------------------------------------

class TestListAwaitingReply:
    def test_ordering_oldest_first_and_org_before_newer_reply(
        self, event_loop, db, seeded_ids,
    ):
        async def _run():
            # Two inbound replies, backdated to Aug 13 and Aug 19 (2025)
            email_a = _uniq_email("aug13")
            email_b = _uniq_email("aug19")
            aug13 = "2025-08-13T09:00:00+00:00"
            aug19 = "2025-08-19T09:00:00+00:00"

            reply_a = await create_reply(
                db, from_email=email_a, subject="Aug 13 reply",
                received_at=aug13, created_by="test_iter160c",
            )
            reply_b = await create_reply(
                db, from_email=email_b, subject="Aug 19 reply",
                received_at=aug19, created_by="test_iter160c",
            )
            seeded_ids["replies"].extend([reply_a["id"], reply_b["id"]])

            # Outreach org in awaiting_reply with a VERY old last_reply_at
            aug01 = "2025-08-01T09:00:00+00:00"
            org_email = _uniq_email("orgaug01")
            org = await upsert_org(
                db,
                {
                    "organisation_name": f"iter160c Ordering Org {uuid.uuid4().hex[:6]}",
                    "email": org_email,
                    "is_test": False,  # list_awaiting_reply excludes is_test=True
                },
                created_by="test_iter160c",
            )
            seeded_ids["orgs"].append(org["id"])
            # Force status + backdated last_reply_at
            await db.outreach_organisations.update_one(
                {"id": org["id"]},
                {"$set": {"status": "awaiting_reply", "last_reply_at": aug01}},
            )

            result = await execute_tool(db, "list_awaiting_reply", {"limit": 100})
            assert isinstance(result, list)

            # Find our seeded items in the result
            emails_in_result = [r.get("email") for r in result]
            for e in (org_email, email_a, email_b):
                assert e in emails_in_result, f"Missing {e} in {emails_in_result[:20]}"

            # Confirm strict ordering across our three: org(Aug01) < replyA(Aug13) < replyB(Aug19)
            pos_org = emails_in_result.index(org_email)
            pos_a = emails_in_result.index(email_a)
            pos_b = emails_in_result.index(email_b)
            assert pos_org < pos_a, f"Aug01 org should come before Aug13 reply. positions org={pos_org} a={pos_a}"
            assert pos_a < pos_b, f"Aug13 reply should come before Aug19 reply. positions a={pos_a} b={pos_b}"

        event_loop.run_until_complete(_run())

    def test_returns_list_type_even_when_none_seeded(self, event_loop, db):
        async def _run():
            result = await execute_tool(db, "list_awaiting_reply", {"limit": 1})
            assert isinstance(result, list)
        event_loop.run_until_complete(_run())


# ---------------------------------------------------------------------------
# 3. count_replies — unread + awaiting_our_reply + total
# ---------------------------------------------------------------------------

class TestCountReplies:
    def test_counts_shape_and_values(self, event_loop, db, seeded_ids):
        async def _run():
            # Baseline
            base = await execute_tool(db, "count_replies", {})
            assert set(base.keys()) >= {"unread", "awaiting_our_reply", "total"}
            base_unread = base["unread"]
            base_awaiting = base["awaiting_our_reply"]
            base_total = base["total"]

            # Insert 3 replies with a mix
            r1 = await create_reply(db, from_email=_uniq_email(), subject="unread+unresolved")
            r2 = await create_reply(db, from_email=_uniq_email(), subject="read+unresolved")
            r3 = await create_reply(db, from_email=_uniq_email(), subject="read+resolved")
            for r in (r1, r2, r3):
                seeded_ids["replies"].append(r["id"])

            # r2 -> read=True
            await db.inbound_replies.update_one({"id": r2["id"]}, {"$set": {"read": True}})
            # r3 -> read=True, resolved=True
            await db.inbound_replies.update_one(
                {"id": r3["id"]},
                {"$set": {"read": True, "resolved": True,
                          "resolved_at": datetime.now(timezone.utc).isoformat(),
                          "resolved_by": "test_iter160c"}},
            )

            after = await execute_tool(db, "count_replies", {})
            # Total +3
            assert after["total"] == base_total + 3, f"total delta wrong: {base_total} -> {after['total']}"
            # Unread: r1 only (base + 1)
            assert after["unread"] == base_unread + 1, f"unread delta wrong: {base_unread} -> {after['unread']}"
            # Awaiting (not resolved): r1 + r2 (base + 2)
            assert after["awaiting_our_reply"] == base_awaiting + 2, (
                f"awaiting delta wrong: {base_awaiting} -> {after['awaiting_our_reply']}"
            )
        event_loop.run_until_complete(_run())


# ---------------------------------------------------------------------------
# 4. list_outreach_organisations — fields + filters + enum guard
# ---------------------------------------------------------------------------

class TestListOutreachOrgs:
    def test_fields_and_status_filter(self, event_loop, db, seeded_ids):
        async def _run():
            email = _uniq_email("listorg")
            org = await upsert_org(
                db,
                {
                    "organisation_name": f"iter160c ListOrg {uuid.uuid4().hex[:6]}",
                    "email": email,
                    "contact_name": "Test Contact",
                    "category": "library",
                    "suburb": "Kellyville",
                    "state": "NSW",
                    "status": "contacted",
                    "is_test": False,  # want to see it in list_orgs (which excludes is_test=True)
                },
                created_by="test_iter160c",
            )
            seeded_ids["orgs"].append(org["id"])

            rows = await execute_tool(db, "list_outreach_organisations", {"status": "contacted", "limit": 200})
            assert isinstance(rows, list)
            match = next((r for r in rows if r.get("id") == org["id"]), None)
            assert match, "Seeded org missing from status=contacted list"
            expected_fields = {"id", "organisation_name", "contact_name", "email", "status",
                               "category", "suburb", "state", "last_contact_at", "last_reply_at"}
            missing = expected_fields - set(match.keys())
            assert not missing, f"Missing fields on row: {missing}"
            assert match["status"] == "contacted"
            assert match["category"] == "library"
            assert match["suburb"] == "Kellyville"
            assert match["state"] == "NSW"

            # Category filter
            rows2 = await execute_tool(
                db, "list_outreach_organisations",
                {"category": "library", "q": "iter160c ListOrg", "limit": 50},
            )
            assert any(r["id"] == org["id"] for r in rows2)
        event_loop.run_until_complete(_run())

    def test_unknown_status_raises_toolerror(self, event_loop, db):
        async def _run():
            with pytest.raises(ToolError):
                await execute_tool(
                    db, "list_outreach_organisations",
                    {"status": "totally_bogus_status"},
                )
        event_loop.run_until_complete(_run())


# ---------------------------------------------------------------------------
# 5. count_outreach_organisations — excludes is_test
# ---------------------------------------------------------------------------

class TestCountOutreachOrgs:
    def test_excludes_test_rows_and_respects_filters(self, event_loop, db, seeded_ids):
        async def _run():
            base = await execute_tool(db, "count_outreach_organisations", {})
            assert isinstance(base, int)

            # Add one is_test=True row — should NOT increment count
            test_org = await upsert_org(
                db,
                {
                    "organisation_name": f"iter160c CountTestOrg {uuid.uuid4().hex[:6]}",
                    "email": _uniq_email("counttest"),
                    "is_test": True,
                    "status": "not_contacted",
                },
                created_by="test_iter160c",
            )
            seeded_ids["orgs"].append(test_org["id"])
            after_test = await execute_tool(db, "count_outreach_organisations", {})
            assert after_test == base, f"is_test row leaked: base={base} after={after_test}"

            # Add one real row — should increment
            real_org = await upsert_org(
                db,
                {
                    "organisation_name": f"iter160c CountRealOrg {uuid.uuid4().hex[:6]}",
                    "email": _uniq_email("countreal"),
                    "is_test": False,
                    "category": "club",
                    "status": "awaiting_reply",
                },
                created_by="test_iter160c",
            )
            seeded_ids["orgs"].append(real_org["id"])
            after_real = await execute_tool(db, "count_outreach_organisations", {})
            assert after_real == base + 1, f"real row not counted: base={base} after={after_real}"

            # Status filter
            c_awaiting = await execute_tool(
                db, "count_outreach_organisations", {"status": "awaiting_reply"},
            )
            assert c_awaiting >= 1
            # Category filter
            c_club = await execute_tool(
                db, "count_outreach_organisations", {"category": "club"},
            )
            assert c_club >= 1
        event_loop.run_until_complete(_run())


# ---------------------------------------------------------------------------
# 6. list_needs_follow_up
# ---------------------------------------------------------------------------

class TestListNeedsFollowUp:
    def test_days_window(self, event_loop, db, seeded_ids):
        async def _run():
            # Seed an org contacted 10 days ago with status='contacted' and no reply
            ten_days_ago = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
            email = _uniq_email("followup")
            org = await upsert_org(
                db,
                {
                    "organisation_name": f"iter160c FollowUp {uuid.uuid4().hex[:6]}",
                    "email": email,
                    "status": "contacted",
                    "is_test": False,
                },
                created_by="test_iter160c",
            )
            seeded_ids["orgs"].append(org["id"])
            await db.outreach_organisations.update_one(
                {"id": org["id"]},
                {"$set": {"status": "contacted", "last_contact_at": ten_days_ago, "last_reply_at": None}},
            )

            # days=7 — should include
            rows_7 = await execute_tool(db, "list_needs_follow_up", {"days": 7, "limit": 200})
            emails_7 = [r.get("email") for r in rows_7]
            assert email in emails_7, f"Expected {email} in 7-day follow-ups"

            # days=30 — should NOT include (10 < 30)
            rows_30 = await execute_tool(db, "list_needs_follow_up", {"days": 30, "limit": 200})
            emails_30 = [r.get("email") for r in rows_30]
            assert email not in emails_30, f"{email} should not appear at days=30"

            # Ordering: oldest last_contact_at first — verify monotonic
            contact_times = [r.get("last_outbound_at") for r in rows_7 if r.get("last_outbound_at")]
            assert contact_times == sorted(contact_times), "list_needs_follow_up not oldest-first"
        event_loop.run_until_complete(_run())


# ---------------------------------------------------------------------------
# 7. get_contact_status
# ---------------------------------------------------------------------------

class TestGetContactStatus:
    def test_known_outreach_email(self, event_loop, db, seeded_ids):
        async def _run():
            email = _uniq_email("contactstatus")
            org = await upsert_org(
                db,
                {
                    "organisation_name": f"iter160c ContactStatus {uuid.uuid4().hex[:6]}",
                    "email": email,
                    "status": "contacted",
                    "is_test": False,
                },
                created_by="test_iter160c",
            )
            seeded_ids["orgs"].append(org["id"])
            # Force last_contact_at
            now_iso = datetime.now(timezone.utc).isoformat()
            await db.outreach_organisations.update_one(
                {"id": org["id"]},
                {"$set": {"last_contact_at": now_iso}},
            )

            result = await execute_tool(db, "get_contact_status", {"email": email})
            assert isinstance(result, dict)
            for k in ("status", "reason", "last_outbound_at", "last_inbound_at", "sources"):
                assert k in result, f"missing key {k} in {result}"
            assert result["sources"].get("outreach_org") is True

        event_loop.run_until_complete(_run())

    def test_unknown_email_returns_not_contacted(self, event_loop, db):
        async def _run():
            result = await execute_tool(
                db, "get_contact_status", {"email": f"nobody_{uuid.uuid4().hex}@example.test"},
            )
            assert result.get("status") == "not_contacted"
        event_loop.run_until_complete(_run())


# ---------------------------------------------------------------------------
# 8. Backdating fix — create_reply(received_at=past) must set org.last_reply_at
#    to that past ISO, not now.
# ---------------------------------------------------------------------------

class TestBackdatingFix:
    def test_backdated_received_at_propagates_to_org(
        self, event_loop, db, seeded_ids, auth_headers,
    ):
        async def _run():
            # Create outreach org via API so it has full shape (and use is_test to keep clean)
            email = _uniq_email("backdate")
            r = requests.post(
                f"{BASE_URL}/api/cms/outreach/organisations",
                headers=auth_headers,
                json={
                    "organisation_name": f"iter160c Backdate {uuid.uuid4().hex[:6]}",
                    "email": email,
                    "is_test": True,
                },
                timeout=15,
            )
            assert r.status_code == 200, r.text
            org_id = r.json()["id"]
            seeded_ids["orgs"].append(org_id)

            # Create reply via the store with backdated received_at
            past_iso = "2025-08-13T09:00:00+00:00"
            reply = await create_reply(
                db, from_email=email, subject="Backdated reply",
                received_at=past_iso, created_by="test_iter160c",
            )
            seeded_ids["replies"].append(reply["id"])
            assert reply["received_at"] == past_iso

            # Fetch org via API and confirm status + last_reply_at
            g = requests.get(
                f"{BASE_URL}/api/cms/outreach/organisations/{org_id}",
                headers=auth_headers, timeout=10,
            )
            assert g.status_code == 200, g.text
            org = g.json()
            assert org["status"] == "awaiting_reply", f"status wrong: {org.get('status')}"
            assert org.get("last_reply_at") == past_iso, (
                f"last_reply_at expected {past_iso}, got {org.get('last_reply_at')}"
            )
        event_loop.run_until_complete(_run())


# ---------------------------------------------------------------------------
# 9. Prompt — MCGS capability map + CRM section
# ---------------------------------------------------------------------------

class TestPromptContents:
    def test_capability_map_mentions_outreach_and_replies(self):
        assert "outreach" in MCGS_CAPABILITY_MAP.lower()
        assert "replies" in MCGS_CAPABILITY_MAP.lower()

    def test_system_prompt_mentions_outreach_replies(self):
        p = build_system_prompt(
            admin_name="Test Admin", admin_email=ADMIN_EMAIL,
            roles=["admin"], tz_name="Australia/Melbourne",
        )
        low = p.lower()
        assert "outreach" in low
        assert "replies" in low

    def test_system_prompt_mentions_new_tools_teaching(self):
        p = build_system_prompt(
            admin_name="Test Admin", admin_email=ADMIN_EMAIL,
            roles=["admin"], tz_name="Australia/Melbourne",
        )
        # Should have list_awaiting_reply reference OR "who's waiting on us" teaching block
        has_awaiting = ("list_awaiting_reply" in p) or ("waiting on us" in p.lower())
        assert has_awaiting, "System prompt missing list_awaiting_reply / 'waiting on us' teaching"
        assert "get_contact_status" in p, "System prompt missing get_contact_status mention"
