"""Iteration 141 — George numbers must match the Bridge (trust invariant).

Garry, 8 Aug 2026: *"I need to be able to trust what George says is
correct."* The Bridge showed 5 open cases while George's morning
briefing said "six support tickets" — because the briefing counted
`support_tickets` documents directly while the Bridge counts
`mcgs_cases`. Any silent failure in the signal-producer step (see
`server.py::create_support_ticket` — `try/except` around the MCGS
`create_signal` call) caused permanent drift between the two.

This test pins the invariant: **every place George counts open support
tickets must source from `mcgs_cases` with case_key prefix
`support_ticket:`, never the raw `support_tickets` collection.**

Covered surfaces:
  * `services/mcgs/rhythms/facts.py::_open_tickets` (Morning Briefing)
  * `services/mcgs/rhythms/eod.py::_gather_eod_facts` (End-of-Day wrap)
  * `services/mcgs/rhythms/milestones.py::_scan_tickets_cleared`
  * `services/george/tools.py::count_support_tickets` (in-conversation)
  * `services/analytics/queries/support.py::OpenSupportTicketsQuery`

If a future change re-routes any of these back to `support_tickets`,
this test will fail with a clear pointer to the source-of-truth
rule.
"""
from __future__ import annotations

import inspect
import re

import pytest


# ---------------------------------------------------------------------------
# Static source-code checks — cheap, deterministic, no DB required.
# ---------------------------------------------------------------------------

# Any collection access to `db.support_tickets.count_documents` or
# `db.support_tickets.find(` inside these files is now a regression.
# We accept `db.support_tickets.find_one(` (used for detail lookups —
# reading a single ticket by id is fine; the trust invariant is about
# COUNTS matching the Bridge).
_FORBIDDEN_PATTERNS = [
    re.compile(r"db\.support_tickets\.count_documents"),
    re.compile(r"db\.support_tickets\.find\("),   # aggregate-list — forbidden
]

_TRUST_SOURCES = [
    "/app/backend/services/mcgs/rhythms/facts.py",
    "/app/backend/services/mcgs/rhythms/eod.py",
    "/app/backend/services/mcgs/rhythms/milestones.py",
    "/app/backend/services/george/tools.py",
    "/app/backend/services/analytics/queries/support.py",
]


@pytest.mark.parametrize("path", _TRUST_SOURCES)
def test_no_raw_support_tickets_counting(path: str) -> None:
    """No George-facing counter may source from `support_tickets` directly.

    All counts must go through `mcgs_cases` with a
    `case_key: {"$regex": "^support_ticket:"}` filter so the number
    matches what admins see on `/admin/bridge`.
    """
    with open(path, "r", encoding="utf-8") as fh:
        src = fh.read()
    for rx in _FORBIDDEN_PATTERNS:
        m = rx.search(src)
        assert not m, (
            f"{path} still counts `support_tickets` directly "
            f"(matched at offset {m.start() if m else '?'}). "
            "This breaks Garry's trust invariant — every ticket count "
            "George reports must come from `mcgs_cases` with case_key "
            "prefix `support_ticket:` so it matches the Bridge. "
            "See services/mcgs/rhythms/facts.py::_open_tickets for the "
            "canonical query pattern."
        )


def test_bridge_case_prefix_present_in_trust_sources() -> None:
    """Positive check: each trust source now filters on the Bridge case_key."""
    prefix_pattern = re.compile(r"support_ticket:")
    for path in _TRUST_SOURCES:
        with open(path, "r", encoding="utf-8") as fh:
            src = fh.read()
        assert prefix_pattern.search(src), (
            f"{path} must reference `support_ticket:` (the mcgs_cases "
            "case_key prefix) to source ticket counts from the Bridge. "
            "Missing this filter means the counter would count "
            "unrelated cases too."
        )


# ---------------------------------------------------------------------------
# Live invariant check — same query, real DB. Sync wrapper via asyncio.run
# so the test doesn't need pytest-asyncio (not installed in the CI env).
# ---------------------------------------------------------------------------

def test_briefing_open_tickets_matches_bridge_live_db() -> None:
    """`_open_tickets` and the Bridge's per-producer count must agree.

    Live-DB counterpart of the static checks above. If a future change
    accidentally re-introduces the drift, this fails against real data
    before a deploy.
    """
    import asyncio
    import os
    from motor.motor_asyncio import AsyncIOMotorClient

    mongo_url = os.environ.get("MONGO_URL")
    if not mongo_url:
        pytest.skip("MONGO_URL not set — cannot run live invariant check")

    async def _run() -> tuple[int, int]:
        client = AsyncIOMotorClient(mongo_url)
        try:
            db = client["test_database"]
            from services.mcgs.rhythms.facts import _open_tickets
            briefing_count = await _open_tickets(db)
            bridge_count = await db.mcgs_cases.count_documents({
                "case_key": {"$regex": "^support_ticket:"},
                "status": {
                    "$in": ["NEW", "SEEN", "IN_REVIEW", "SNOOZED", "ESCALATED"],
                },
            })
            return briefing_count, bridge_count
        finally:
            client.close()

    briefing_count, bridge_count = asyncio.run(_run())
    assert briefing_count == bridge_count, (
        f"George's briefing count ({briefing_count}) does not match "
        f"the Bridge's open support-ticket case count ({bridge_count}). "
        "The two must always agree — Garry needs to trust George's "
        "numbers. Investigate `services/mcgs/rhythms/facts.py`."
    )


def test_count_support_tickets_tool_matches_briefing() -> None:
    """George's in-conversation `count_support_tickets` tool must return
    the same number as the morning briefing when asked for `open`
    status. Otherwise a chat answer could contradict the briefing.
    """
    import asyncio
    import os
    from motor.motor_asyncio import AsyncIOMotorClient

    mongo_url = os.environ.get("MONGO_URL")
    if not mongo_url:
        pytest.skip("MONGO_URL not set — cannot run live invariant check")

    async def _run() -> tuple[int, int]:
        client = AsyncIOMotorClient(mongo_url)
        try:
            db = client["test_database"]
            from services.mcgs.rhythms.facts import _open_tickets
            from services.george.tools import execute_tool
            briefing_count = await _open_tickets(db)
            tool_result = await execute_tool(
                db,
                name="count_support_tickets",
                args={"status": "open", "include_test_data": True},
            )
            return briefing_count, tool_result
        finally:
            client.close()

    briefing_count, tool_result = asyncio.run(_run())
    assert tool_result == briefing_count, (
        f"count_support_tickets tool returned {tool_result} but the "
        f"morning-briefing source-of-truth returned {briefing_count}. "
        "The tool must source from the same query."
    )
