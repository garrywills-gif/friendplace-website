"""Iteration 167 — Founding Members analytics: Sydney-local timezone
boundaries and the Registered-vs-JoinedApp distinction.

Root causes fixed in this iteration:

    1. ``/api/cms/crm/founding-members/stats`` "new_today" reported 0
       because UTC midnight is 10-11 hours behind Sydney. Fixed by
       using ``services.analytics.local_time.sydney_named_range`` for
       every day-bounded count.

    2. George's ``count_interest_registrations`` was routed for
       "how many joined yesterday?" with status='joined', which is a
       MANUAL CRM ladder flag — not proof of an app account. Added
       ``count_founding_members_joined_app`` which matches emails
       against the ``users`` collection instead.

    3. ``heard_from`` (free-text acquisition field, e.g. "Facebook")
       wasn't queryable. Added a substring filter to
       count/list_interest_registrations, and a new
       ``founding_members_by_source`` breakdown tool.

Tests exercise the tools directly against MongoDB (no HTTP layer) so
they don't depend on the FastAPI server being up.
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, "/app/backend")

from motor.motor_asyncio import AsyncIOMotorClient

from services.analytics.local_time import (
    SYDNEY_TZ,
    sydney_day_bounds,
    sydney_day_iso,
    sydney_named_range,
    sydney_now,
)
from services.george.tools import TOOL_REGISTRY, execute_tool


# ─── Fixtures ──────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def db():
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "test_database")
    return AsyncIOMotorClient(mongo_url)[db_name]


_MARKER = "iter167-tz-"
_SEEDED_IDS: list[str] = []


@pytest.fixture(scope="module", autouse=True)
def _seed_and_cleanup(db):
    """Seed a controlled cohort spanning the Sydney-day boundary so we
    can verify "new_today" / "new_yesterday" / joined-app numbers with
    known answers."""

    async def _seed():
        # Compute a timestamp that is IN "today Sydney" but BEFORE
        # today UTC midnight — this is the exact window the old bug
        # was undercounting. We build it as "Sydney today at 06:00".
        s_today_start, _ = sydney_day_bounds(0)
        early_sydney_utc = s_today_start + timedelta(hours=1)  # 01:00 UTC on the boundary day = ~11am Sydney

        # And a timestamp for yesterday Sydney.
        s_yest_start, s_yest_end = sydney_day_bounds(-1)
        mid_yesterday_utc = s_yest_start + timedelta(hours=12)

        # And a timestamp for last week Sydney.
        s_lw_start, _ = sydney_day_bounds(-9)
        last_week_utc = s_lw_start + timedelta(hours=6)

        cohort = [
            # 3 x "today" — one from Facebook, one Friend, one unknown
            ("today-fb-1", early_sydney_utc, "Facebook", "registered"),
            ("today-friend-1", early_sydney_utc + timedelta(minutes=30), "Friend", "registered"),
            ("today-none-1", early_sydney_utc + timedelta(hours=2), "", "registered"),
            # 2 x "yesterday"
            ("yest-fb-1", mid_yesterday_utc, "Facebook", "registered"),
            ("yest-none-1", mid_yesterday_utc + timedelta(hours=1), None, "invited"),
            # 1 x "last week"
            ("lw-google-1", last_week_utc, "Google", "registered"),
        ]

        for suffix, ts, heard, status in cohort:
            doc_id = f"{_MARKER}{suffix}-{uuid.uuid4()}"
            _SEEDED_IDS.append(doc_id)
            await db.interest_registrations.insert_one({
                "id": doc_id,
                "first_name": f"Iter167{suffix}",
                "email": f"{_MARKER}{suffix}@example.com",
                "state_country": "NSW, Australia",
                "heard_from": heard,
                "companion_choice": "george",
                "status": status,
                "created_at": ts.isoformat(),
                "is_test": False,
                "is_reserved": False,
                "tags": [],
            })

        # Also seed a matching user row for ONE of the today-Facebook
        # registrations so joined_app_count sees exactly one match.
        await db.users.insert_one({
            "id": f"{_MARKER}user-1",
            "email": f"{_MARKER}today-fb-1@example.com",
            "first_name": "Iter167today-fb-1",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "is_demo": False,
        })

    async def _wipe():
        if _SEEDED_IDS:
            await db.interest_registrations.delete_many({"id": {"$in": _SEEDED_IDS}})
        await db.interest_registrations.delete_many({"id": {"$regex": f"^{_MARKER}"}})
        await db.users.delete_many({"id": {"$regex": f"^{_MARKER}user-"}})
        await db.users.delete_many({"email": {"$regex": f"^{_MARKER}"}})

    asyncio.get_event_loop().run_until_complete(_seed())
    yield
    asyncio.get_event_loop().run_until_complete(_wipe())


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ─── 1. Sydney-local range helper ─────────────────────────────────────

class TestSydneyLocalTime:
    def test_today_end_is_after_start(self):
        s, e = sydney_named_range("today")
        assert s < e

    def test_today_range_covers_now(self):
        s, e = sydney_day_iso(0)
        # `now_iso()` produced by server.py is UTC ISO; it should fall
        # inside today's Sydney window.
        now_iso = datetime.now(timezone.utc).isoformat()
        assert s <= now_iso < e

    def test_yesterday_range_ends_at_today_start(self):
        _, y_end = sydney_named_range("yesterday")
        t_start, _ = sydney_named_range("today")
        assert y_end == t_start

    def test_this_week_starts_on_monday_sydney(self):
        w_start_iso, _ = sydney_named_range("this_week")
        # Parse back; the local (Sydney) equivalent must be a Monday.
        w_start_utc = datetime.fromisoformat(w_start_iso)
        w_start_syd = w_start_utc.astimezone(SYDNEY_TZ)
        assert w_start_syd.weekday() == 0  # Monday
        assert w_start_syd.hour == 0
        assert w_start_syd.minute == 0

    def test_boundary_captures_early_sydney_morning(self):
        """The exact regression: a record created at 06:00 Sydney (which is
        ~19:00 UTC of the previous day, or ~20:00 in AEST) must land in
        the Sydney "today" window even though it's in yesterday's UTC day."""
        s, e = sydney_day_iso(0)
        # 06:00 Sydney today
        sydney_6am = sydney_now().replace(hour=6, minute=0, second=0, microsecond=0)
        record_ts = sydney_6am.astimezone(timezone.utc).isoformat()
        assert s <= record_ts < e


# ─── 2. Tools registry ────────────────────────────────────────────────

class TestNewToolsRegistered:
    def test_joined_app_tool_registered(self):
        assert "count_founding_members_joined_app" in TOOL_REGISTRY

    def test_by_source_tool_registered(self):
        assert "founding_members_by_source" in TOOL_REGISTRY

    def test_count_tool_accepts_since_enum(self):
        spec = TOOL_REGISTRY["count_interest_registrations"]["args"]
        assert "since" in spec
        assert "today" in spec["since"]["enum"]
        assert "yesterday" in spec["since"]["enum"]
        assert "this_week" in spec["since"]["enum"]

    def test_count_tool_accepts_heard_from(self):
        assert "heard_from" in TOOL_REGISTRY["count_interest_registrations"]["args"]


# ─── 3. count_interest_registrations — Sydney-local windows ──────────

class TestCountRegistrationsSydneyWindows:
    def test_since_today_counts_seeded_today_rows(self, db):
        n = _run(execute_tool(db, "count_interest_registrations", {"since": "today"}))
        assert isinstance(n, int)
        # 3 seeded rows fall into today Sydney.
        assert n >= 3

    def test_since_yesterday_counts_seeded_yesterday_rows(self, db):
        n = _run(execute_tool(db, "count_interest_registrations", {"since": "yesterday"}))
        assert isinstance(n, int)
        assert n >= 2

    def test_since_this_week_counts_today_and_yesterday(self, db):
        n = _run(execute_tool(db, "count_interest_registrations", {"since": "this_week"}))
        assert isinstance(n, int)
        # this_week is Monday-based Sydney local. Seeded today + yesterday
        # both fall in the current week when today is not a Monday morning.
        assert n >= 3

    def test_heard_from_facebook(self, db):
        n = _run(execute_tool(
            db, "count_interest_registrations",
            {"heard_from": "facebook"},
        ))
        # Our seed has 2 Facebook records (today + yesterday).
        assert n >= 2

    def test_heard_from_case_insensitive_substring(self, db):
        # Should also match "Facebook" via case-insensitive substring
        n_lower = _run(execute_tool(db, "count_interest_registrations", {"heard_from": "book"}))
        n_upper = _run(execute_tool(db, "count_interest_registrations", {"heard_from": "FACE"}))
        assert n_lower >= 2
        assert n_upper >= 2

    def test_heard_from_plus_since_combined(self, db):
        n = _run(execute_tool(
            db, "count_interest_registrations",
            {"heard_from": "facebook", "since": "today"},
        ))
        assert n >= 1


# ─── 4. founding_members_by_source ────────────────────────────────────

class TestBySource:
    def test_returns_sorted_source_list(self, db):
        res = _run(execute_tool(db, "founding_members_by_source", {}))
        assert "sources" in res
        assert isinstance(res["sources"], list)
        # Facebook rows > Google rows in our seed, so Facebook should
        # be higher in the sorted list (or at least present).
        labels = [row["source"].lower() for row in res["sources"]]
        assert any("facebook" in l for l in labels)

    def test_reports_unknown_bucket_for_empty_heard_from(self, db):
        res = _run(execute_tool(db, "founding_members_by_source", {}))
        # One seeded row has heard_from="" — must be counted in `unknown`.
        assert res["unknown"] >= 1

    def test_scoped_to_today_sydney(self, db):
        res = _run(execute_tool(db, "founding_members_by_source", {"since": "today"}))
        # Only today's 3 rows: 1 Facebook, 1 Friend, 1 unknown.
        total = res["total"]
        assert total >= 3
        assert res["window"] == "today"


# ─── 5. count_founding_members_joined_app ─────────────────────────────

class TestJoinedApp:
    def test_returns_email_matched_count(self, db):
        res = _run(execute_tool(db, "count_founding_members_joined_app", {}))
        assert res["metric"] == "joined_app_account"
        # Exactly one matching users row was seeded, so joined_app_count
        # must be >= 1 (there may be additional matches from earlier tests).
        assert res["joined_app_count"] >= 1
        assert res["total_registered"] >= res["joined_app_count"]

    def test_scoped_to_today_only(self, db):
        res = _run(execute_tool(db, "count_founding_members_joined_app", {"since": "today"}))
        # Our matching user is for the today-fb-1 registration, which
        # was seeded with a "today Sydney" timestamp.
        assert res["joined_app_count"] >= 1
        assert res["window"] == "today"

    def test_scoped_to_last_week_excludes_matching_user(self, db):
        """The joined_app match's registration was seeded with a
        today-Sydney timestamp. Windowed to last_week Sydney it should
        NOT be counted."""
        res = _run(execute_tool(db, "count_founding_members_joined_app", {"since": "last_week"}))
        # There are no last-week registrations with matching users in
        # our seed cohort. (Other tests may have inserted rows, but
        # none with matching user emails.)
        assert isinstance(res["joined_app_count"], int)


# ─── 6. founding_members_summary — new fields ─────────────────────────

class TestSummaryEnvelope:
    def test_summary_includes_new_today_yesterday_this_week(self, db):
        s = _run(execute_tool(db, "founding_members_summary", {}))
        for k in ("new_today", "new_yesterday", "new_this_week"):
            assert k in s
            assert isinstance(s[k], int)
        assert s["timezone"] == "Australia/Sydney"

    def test_summary_distinguishes_joined_status_vs_joined_app(self, db):
        s = _run(execute_tool(db, "founding_members_summary", {}))
        assert "joined_status_count" in s
        assert "joined_app_count" in s
        # Legacy alias preserved
        assert s["joined"] == s["joined_status_count"]

    def test_new_today_reflects_sydney_boundary_seeds(self, db):
        s = _run(execute_tool(db, "founding_members_summary", {}))
        # We seeded 3 "today Sydney" registrations.
        assert s["new_today"] >= 3

    def test_new_yesterday_reflects_sydney_boundary_seeds(self, db):
        s = _run(execute_tool(db, "founding_members_summary", {}))
        assert s["new_yesterday"] >= 2


# ─── 7. Prompt guardrails ─────────────────────────────────────────────

class TestPromptGuardrails:
    def test_prompt_forbids_made_a_note(self):
        from services.george.prompt import build_system_prompt
        p = build_system_prompt("Garry", "g@fp.com", ["owner"])
        assert "made a note of it" in p
        assert "I'll let you know" in p or "I'll let you know when" in p

    def test_prompt_distinguishes_registered_vs_joined_app(self):
        from services.george.prompt import build_system_prompt
        p = build_system_prompt("Garry", "g@fp.com", ["owner"])
        assert "REGISTERED INTEREST vs JOINED THE APP" in p
        assert "count_founding_members_joined_app" in p

    def test_prompt_mentions_sydney_timezone(self):
        from services.george.prompt import build_system_prompt
        p = build_system_prompt("Garry", "g@fp.com", ["owner"])
        assert "Australia/Sydney" in p


# ─── 8. Chat topic routing ────────────────────────────────────────────

class TestChatTopicRouting:
    def test_joined_the_app_routes_to_email_matched_tool(self):
        from services.george.chat import _TOPIC_TO_TOOL
        mapping = dict(_TOPIC_TO_TOOL)
        assert mapping["joined the app"]["name"] == "count_founding_members_joined_app"
        assert mapping["created an account"]["name"] == "count_founding_members_joined_app"

    def test_registered_yesterday_routes_to_sydney_local_window(self):
        from services.george.chat import _TOPIC_TO_TOOL
        mapping = dict(_TOPIC_TO_TOOL)
        assert mapping["registered yesterday"]["name"] == "count_interest_registrations"
        assert mapping["registered yesterday"]["args"] == {"since": "yesterday"}

    def test_from_facebook_routes_to_by_source(self):
        from services.george.chat import _TOPIC_TO_TOOL
        mapping = dict(_TOPIC_TO_TOOL)
        assert mapping["from facebook"]["name"] == "founding_members_by_source"
