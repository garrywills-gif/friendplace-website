"""iter164bi — George general-purpose analytics (analyze_data) + routing.

Deterministic, read-only, no LLM/network. Seeds registrations with known
Sydney-local times and asserts hour/day/weekday-weekend bucketing, counts +
percentages, strongest window, missing-dimension handling, filters, and the
planner routing for analytical + affirmation follow-through.
"""

from __future__ import annotations

import asyncio
import os
import uuid

import pytest
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/backend/.env")

_LOOP = asyncio.new_event_loop()
asyncio.set_event_loop(_LOOP)

from services.george.tools import execute_tool  # noqa: E402
from services.george.chat import (  # noqa: E402
    _forced_tool_hint, _looks_like_state_question,
)


@pytest.fixture(scope="module")
def db():
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    yield c[os.environ.get("DB_NAME", "test_database")]
    c.close()


@pytest.fixture(scope="module")
def loop():
    yield _LOOP
    _LOOP.close()


def _seed(db, loop, tag):
    # AEST (UTC+10) in September (pre-DST). 07:00Z -> 17:00 Sydney (Fri 4 Sep 26),
    # 02:00Z Sat 5 Sep -> 12:00 Sydney Saturday (weekend).
    docs = [
        {"id": str(uuid.uuid4()), "email": f"a-{tag}@x.com", "is_test": False,
         "state_country": "Sydney, NSW", "source": "web", "status": "invited",
         "created_at": "2026-09-04T07:00:00Z"},
        {"id": str(uuid.uuid4()), "email": f"b-{tag}@x.com", "is_test": False,
         "state_country": "Melbourne, VIC", "source": "web", "status": "invited",
         "created_at": "2026-09-05T02:00:00Z"},
        # a test row that MUST be excluded by the base filter
        {"id": str(uuid.uuid4()), "email": f"t-{tag}@x.com", "is_test": True,
         "state_country": "QA", "source": "web", "status": "invited",
         "created_at": "2026-09-04T07:00:00Z"},
    ]
    loop.run_until_complete(db.interest_registrations.insert_many(docs))
    return [d["id"] for d in docs]


def test_analyze_hour_day_state_and_filters(db, loop):
    tag = uuid.uuid4().hex[:8]
    ids = _seed(db, loop, tag)
    try:
        run = lambda a: loop.run_until_complete(execute_tool(db, "analyze_data", a))
        # Restrict to our two seeded rows via a source filter is not unique enough;
        # assert on the buckets we know must be present instead.
        h = run({"dataset": "registrations", "group_by": "hour_of_day"})
        assert h["timezone"] == "Australia/Sydney"
        by = {b["key"]: b["count"] for b in h["buckets"]}
        assert by.get("17:00", 0) >= 1 and by.get("12:00", 0) >= 1  # Sydney-local
        # percentages present and sum ~100
        assert abs(sum(b["pct"] for b in h["buckets"]) - 100.0) < 1.5
        assert "strongest_window" in h and "weekday_vs_weekend" in h

        d = run({"dataset": "registrations", "group_by": "day_of_week"})
        dby = {b["key"]: b["count"] for b in d["buckets"]}
        assert dby.get("Friday", 0) >= 1 and dby.get("Saturday", 0) >= 1

        ww = run({"dataset": "registrations", "group_by": "weekday_weekend"})
        wby = {b["key"]: b["count"] for b in ww["buckets"]}
        assert wby.get("Weekday", 0) >= 1 and wby.get("Weekend", 0) >= 1

        st = run({"dataset": "registrations", "group_by": "state"})
        sby = {b["key"]: b["count"] for b in st["buckets"]}
        assert sby.get("Sydney, NSW", 0) >= 1 and sby.get("Melbourne, VIC", 0) >= 1
        assert "QA" not in sby  # is_test row excluded by base filter

        # field filter applies (only VIC row), and unknown filter is reported.
        f = run({"dataset": "registrations", "group_by": "day_of_week",
                 "filters": {"state": "Melbourne, VIC", "nope": "x"}})
        assert f["applied_filters"] == {"state": "Melbourne, VIC"}
        assert "nope" in f["ignored_filters"]
        assert {b["key"] for b in f["buckets"]} == {"Saturday"}
    finally:
        loop.run_until_complete(db.interest_registrations.delete_many({"id": {"$in": ids}}))


def test_missing_dataset_and_dimension_report_whats_available(db, loop):
    run = lambda a: loop.run_until_complete(execute_tool(db, "analyze_data", a))
    bad_ds = run({"dataset": "unicorns", "group_by": "hour_of_day"})
    assert "error" in bad_ds and "registrations" in bad_ds["available_datasets"]
    bad_dim = run({"dataset": "registrations", "group_by": "phase_of_moon"})
    assert "error" in bad_dim
    assert "hour_of_day" in bad_dim["available_dimensions"]
    assert "state" in bad_dim["available_dimensions"]


def test_routing_analytical_and_affirmation():
    # Analytical questions route to analyze_data (registration timing example).
    for q in ["What time do people register?", "which hour is busiest?",
              "break registrations down by state", "which day of the week?"]:
        assert _looks_like_state_question(q, None) is True, q
    h = _forced_tool_hint("When are people registering the most? What time?", None)
    assert h and h["name"] == "analyze_data"
    assert h["args"]["group_by"] == "hour_of_day"
    hs = _forced_tool_hint("break registrations down by state", None)
    assert hs and hs["name"] == "analyze_data" and hs["args"]["group_by"] == "state"
    # Affirmations are recognised as actionable state questions.
    for a in ["Yes, do that", "yes please", "go ahead", "do it"]:
        assert _looks_like_state_question(a, None) is True, a
