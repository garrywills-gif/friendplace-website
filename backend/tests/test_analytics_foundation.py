"""
Unit tests for the analytics engine foundation.

These tests exercise:
    - Time range builders (today/week/month/quarter/all_time)
    - Previous-period pairing
    - Comparison arithmetic (positive, negative, zero-baseline)
    - Registry: all queries load without import errors
    - Every registered query executes against the live DB without crashing

Run with:  pytest -xvs backend/tests/test_analytics_foundation.py
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

from services.analytics import get_engine
from services.analytics.comparison import build_comparison
from services.analytics.time_ranges import (
    NamedRange,
    previous_range_for,
    range_for,
)
from services.analytics.types import Direction


# ---------------------------------------------------------------------------
# Time-range builders
# ---------------------------------------------------------------------------


class TestTimeRanges:
    def test_today_covers_24h(self):
        r = range_for(NamedRange.TODAY)
        assert (r.end - r.start) == timedelta(days=1)
        assert r.start.hour == 0 and r.start.minute == 0
        assert r.key == "today"

    def test_this_week_starts_monday(self):
        r = range_for(NamedRange.THIS_WEEK)
        assert r.start.weekday() == 0  # Monday
        assert (r.end - r.start) == timedelta(days=7)

    def test_last_week_is_seven_days_before_this_week(self):
        this_wk = range_for(NamedRange.THIS_WEEK)
        last_wk = range_for(NamedRange.LAST_WEEK)
        assert last_wk.end == this_wk.start
        assert (this_wk.start - last_wk.start) == timedelta(days=7)

    def test_this_month_starts_on_day_one(self):
        r = range_for(NamedRange.THIS_MONTH)
        assert r.start.day == 1

    def test_all_time_extends_to_tomorrow(self):
        r = range_for(NamedRange.ALL_TIME)
        assert r.end > datetime.now(timezone.utc)

    def test_windows_tile(self):
        """Adjacent windows must not overlap and must not leave gaps."""
        y = range_for(NamedRange.YESTERDAY)
        t = range_for(NamedRange.TODAY)
        assert y.end == t.start

    def test_previous_pairing_for_this_week_is_last_week(self):
        prev = previous_range_for(NamedRange.THIS_WEEK)
        assert prev is not None
        assert prev.key == "last_week"

    def test_previous_pairing_for_all_time_is_none(self):
        assert previous_range_for(NamedRange.ALL_TIME) is None

    def test_previous_pairing_for_yesterday_shifts_by_duration(self):
        """"Yesterday's previous" should be the day before yesterday."""
        prev = previous_range_for(NamedRange.YESTERDAY)
        assert prev is not None
        assert (prev.end - prev.start) == timedelta(days=1)


# ---------------------------------------------------------------------------
# Comparison arithmetic
# ---------------------------------------------------------------------------


class TestComparison:
    def test_positive_delta_reports_up(self):
        prev_range = range_for(NamedRange.LAST_WEEK)
        c = build_comparison(
            current_value=12, previous_value=10, previous_time_range=prev_range
        )
        assert c.direction == Direction.UP
        assert c.delta_absolute == 2
        assert c.delta_pct == pytest.approx(20.0)

    def test_negative_delta_reports_down(self):
        prev_range = range_for(NamedRange.LAST_WEEK)
        c = build_comparison(
            current_value=8, previous_value=10, previous_time_range=prev_range
        )
        assert c.direction == Direction.DOWN
        assert c.delta_pct == pytest.approx(-20.0)

    def test_zero_baseline_returns_null_percent(self):
        """Previous value of 0 → % is meaningless; delta_pct must be None."""
        prev_range = range_for(NamedRange.LAST_WEEK)
        c = build_comparison(
            current_value=5, previous_value=0, previous_time_range=prev_range
        )
        assert c.delta_pct is None
        assert c.direction == Direction.UP
        # Humanize output must not invent a percent when there is no baseline.
        assert "%" not in c.humanize()
        assert "no" in c.humanize().lower()

    def test_flat_when_no_change(self):
        prev_range = range_for(NamedRange.LAST_WEEK)
        c = build_comparison(
            current_value=10, previous_value=10, previous_time_range=prev_range
        )
        assert c.direction == Direction.FLAT
        assert "flat" in c.humanize()


# ---------------------------------------------------------------------------
# Engine + registry
# ---------------------------------------------------------------------------


class TestEngineRegistry:
    def test_catalogue_includes_all_expected_queries(self):
        engine = get_engine()
        ids = {q["query_id"] for q in engine.catalogue()}
        for expected in {
            "members.joined",
            "members.founding_numbers",
            "members.founding_profiles",
            "members.online",
            "members.active_today",
            "members.active_this_week",
            "events.created",
            "support.open_tickets",
            "campaigns.best_by_open_rate",
            "campaigns.best_by_click_rate",
        }:
            assert expected in ids, f"missing query: {expected}"

    def test_unknown_query_raises(self):
        engine = get_engine()
        with pytest.raises(KeyError):
            engine.get("does.not.exist")


# ---------------------------------------------------------------------------
# Live execution smoke-test (integration)
# ---------------------------------------------------------------------------


def _make_db():
    from dotenv import load_dotenv
    load_dotenv()
    client = AsyncIOMotorClient(os.getenv("MONGO_URL"))
    return client, client[os.getenv("DB_NAME")]


class TestLiveExecution:
    def test_every_query_executes_without_error(self):
        import asyncio

        async def _go():
            client, db = _make_db()
            try:
                engine = get_engine()
                for entry in engine.catalogue():
                    r = await engine.run(
                        entry["query_id"], db=db, range_kind=NamedRange.THIS_WEEK
                    )
                    assert r.query_id == entry["query_id"]
                    assert r.metric_label == entry["metric_label"]
                    assert isinstance(r.value, (int, float))
                    assert r.time_range.start < r.time_range.end
                    if entry["query_id"] not in {
                        "campaigns.best_by_open_rate",
                        "campaigns.best_by_click_rate",
                    }:
                        assert r.drilldown is not None, (
                            f"{entry['query_id']} missing drilldown"
                        )
            finally:
                client.close()

        asyncio.run(_go())

    def test_periodic_queries_include_comparison(self):
        import asyncio

        async def _go():
            client, db = _make_db()
            try:
                engine = get_engine()
                r = await engine.run(
                    "members.joined", db=db, range_kind=NamedRange.THIS_WEEK
                )
                assert r.comparison is not None
                assert r.comparison.previous_time_range.key == "last_week"
            finally:
                client.close()

        asyncio.run(_go())

    def test_non_periodic_queries_omit_comparison(self):
        import asyncio

        async def _go():
            client, db = _make_db()
            try:
                engine = get_engine()
                r = await engine.run(
                    "members.founding_numbers",
                    db=db,
                    range_kind=NamedRange.ALL_TIME,
                )
                assert r.comparison is None
            finally:
                client.close()

        asyncio.run(_go())

    def test_online_query_returns_non_negative(self):
        import asyncio

        async def _go():
            client, db = _make_db()
            try:
                engine = get_engine()
                r = await engine.run(
                    "members.online", db=db, range_kind=NamedRange.TODAY
                )
                assert r.value >= 0
            finally:
                client.close()

        asyncio.run(_go())
