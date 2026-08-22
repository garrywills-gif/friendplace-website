"""iter163 — Founding Members counts must align between the dashboard
card and George's ``founding_members_summary`` tool, using Sydney
calendar-day boundaries.

The bug (before iter163):
  • Dashboard card excluded reserved slots (#0001 Garry, #0002 George)
    from ``new_today``/``awaiting``/``invited``/``opted_out``, but
    George's tool did NOT — so George double-counted them.
  • Both used UTC midnight instead of Australia/Sydney midnight, so
    the "today" window drifted from the community timezone.

These tests lock in the fix by:
  1. Asserting the shared stats function returns exactly what the
     dashboard used to return (single source of truth).
  2. Verifying George's tool now delegates to that same function.
  3. Verifying Sydney calendar boundary is used (not UTC).
  4. Verifying reserved slots are excluded from public headline metrics.
  5. The specific scenario from the bug report: New Today = 1 →
     George's tool answers 1 (not 2).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

SYDNEY = ZoneInfo("Australia/Sydney")


# ─────────────────────────────────────────────────────────────────────
#  In-memory fake collection that mirrors the Mongo filter surface
#  we actually use (equality, $ne, $exists, $in, $or, $gte on strings).
# ─────────────────────────────────────────────────────────────────────
class _FakeColl:
    def __init__(self, rows):
        self.rows = list(rows)

    async def count_documents(self, q):
        return sum(1 for r in self.rows if _match(r, q))

    async def find_one(self, q, projection=None, sort=None):
        matches = [r for r in self.rows if _match(r, q)]
        if sort:
            key, direction = sort[0]
            matches.sort(key=lambda r: r.get(key, ""), reverse=(direction == -1))
        return matches[0] if matches else None

    def find(self, q, projection=None):
        rows = [r for r in self.rows if _match(r, q)]
        class _Cursor:
            def __init__(self, rows): self.rows = rows
            def sort(self, key, direction):
                self.rows = sorted(self.rows, key=lambda r: r.get(key, ""), reverse=(direction == -1))
                return self
            async def to_list(self, limit): return self.rows[:limit]
        return _Cursor(rows)


class _FakeDB:
    def __init__(self, rows):
        self.interest_registrations = _FakeColl(rows)


def _match(row, q):
    for key, cond in q.items():
        if key == "$or":
            if not any(_match(row, sub) for sub in cond):
                return False
            continue
        val = row.get(key)
        if isinstance(cond, dict):
            for op, target in cond.items():
                if op == "$ne":
                    if val == target: return False
                elif op == "$gte":
                    if val is None or val < target: return False
                elif op == "$exists":
                    if (val is not None) != target: return False
                elif op == "$in":
                    if val not in target: return False
                else:
                    return False
        else:
            if val != cond: return False
    return True


def _now_sydney():
    return datetime.now(SYDNEY)


def _iso_at(dt_syd):
    """UTC ISO for a Sydney-local datetime."""
    return dt_syd.astimezone(timezone.utc).isoformat()


# ─────────────────────────────────────────────────────────────────────
#  Test scenarios
# ─────────────────────────────────────────────────────────────────────

def _seed_scenario_new_today_is_one():
    """Deterministic reproduction of Garry's bug report:

    Dashboard "New today" = 1.
    Before iter163, George's tool would answer 2 because reserved
    Garry (#0001) had ``created_at`` inside the current UTC day.
    """
    now = _now_sydney()
    today_syd_9am = now.replace(hour=9, minute=0, second=0, microsecond=0)
    yesterday_syd_11pm = today_syd_9am - timedelta(hours=10)  # 23:00 Sydney yesterday
    week_ago = now - timedelta(days=7)

    return [
        # #0001 Garry — reserved, joined. Must NOT count towards new_today.
        # We give him a created_at that IS inside today's Sydney window,
        # to reproduce the exact drift the bug reported.
        {"id": "res-1", "founder_number": 1, "is_reserved": True,
         "first_name": "Garry", "email": "garry@friendplace.com.au",
         "status": "joined", "created_at": _iso_at(today_syd_9am)},

        # #0002 George — reserved, joined. Same story.
        {"id": "res-2", "founder_number": 2, "is_reserved": True,
         "first_name": "George", "email": "george@friendplace.com.au",
         "status": "joined", "created_at": _iso_at(today_syd_9am)},

        # One real registration today (Sydney) — the number the card shows.
        {"id": "real-1", "founder_number": 3, "first_name": "Jane",
         "email": "jane@example.com", "state_country": "NSW",
         "status": "registered", "created_at": _iso_at(today_syd_9am + timedelta(minutes=30))},

        # Yesterday's late-night registration (Sydney) — must NOT count today.
        {"id": "real-2", "founder_number": 4, "first_name": "Kai",
         "email": "kai@example.com", "state_country": "VIC",
         "status": "invited", "created_at": _iso_at(yesterday_syd_11pm)},

        # A registered-but-old row — awaiting invitation.
        {"id": "real-3", "founder_number": 5, "first_name": "Mia",
         "email": "mia@example.com",
         "status": "registered", "created_at": _iso_at(week_ago)},

        # An opted-out row.
        {"id": "real-4", "founder_number": 6, "first_name": "Sam",
         "email": "sam@example.com",
         "status": "opted_out", "created_at": _iso_at(week_ago)},

        # A joined non-reserved member.
        {"id": "real-5", "founder_number": 7, "first_name": "Alex",
         "email": "alex@example.com",
         "status": "joined", "created_at": _iso_at(week_ago)},

        # A test-flagged row that should be excluded entirely.
        {"id": "test-1", "is_test": True, "first_name": "QA",
         "status": "registered", "created_at": _iso_at(now)},
    ]


@pytest.mark.asyncio
async def test_new_today_matches_dashboard_exactly():
    """Bug repro: with the scenario above, both dashboard and George
    must answer New Today = 1 (not 2 or 3)."""
    from services.crm.founding_stats import compute_founding_members_stats

    db = _FakeDB(_seed_scenario_new_today_is_one())
    stats = await compute_founding_members_stats(db)
    assert stats["new_today"] == 1, (
        f"Expected New Today = 1 (Jane only), got {stats['new_today']}. "
        f"Reserved slots (Garry, George) must not be counted."
    )


@pytest.mark.asyncio
async def test_george_tool_uses_shared_function_and_matches_dashboard():
    """George's ``founding_members_summary`` tool must return identical
    headline numbers to the dashboard endpoint. If someone re-adds a
    parallel implementation, this test will fail."""
    from services.george import tools as tools_mod
    from services.crm.founding_stats import compute_founding_members_stats

    db = _FakeDB(_seed_scenario_new_today_is_one())
    dashboard = await compute_founding_members_stats(db)
    george = await tools_mod.TOOL_REGISTRY["founding_members_summary"]["run"](db, {})

    for field in ("total", "new_today", "awaiting_contact",
                  "awaiting_invitation", "invited", "joined", "opted_out"):
        assert dashboard[field] == george[field], (
            f"Field {field!r} drifted: dashboard={dashboard[field]}, "
            f"george={george[field]}"
        )


@pytest.mark.asyncio
async def test_all_headline_counts_are_correct():
    """Nail down every headline metric for the seeded scenario so a
    future regression on any single one is caught."""
    from services.crm.founding_stats import compute_founding_members_stats

    db = _FakeDB(_seed_scenario_new_today_is_one())
    s = await compute_founding_members_stats(db)

    # Total: all non-test rows (7)
    assert s["total"] == 7
    # New today (Sydney): Jane only.
    assert s["new_today"] == 1
    # Awaiting invitation: Mia (registered old). Reserved excluded.
    assert s["awaiting_invitation"] == 2  # Jane (today, registered) + Mia
    assert s["awaiting_contact"] == s["awaiting_invitation"]
    # Invited: Kai only.
    assert s["invited"] == 1
    # Joined: Garry (#0001), George (#0002), Alex — reserved kept.
    assert s["joined"] == 3
    # Opted out: Sam only. Reserved excluded.
    assert s["opted_out"] == 1


@pytest.mark.asyncio
async def test_sydney_boundary_not_utc():
    """Registration at 08:00 Sydney (before UTC midnight in AEDT/AEST)
    must count towards TODAY, not yesterday. The old UTC boundary
    would have missed this row."""
    from services.crm.founding_stats import compute_founding_members_stats

    now = _now_sydney()
    early_syd = now.replace(hour=1, minute=0, second=0, microsecond=0)
    # 01:00 Sydney = 15:00 UTC yesterday (AEDT) or 14:00 UTC (AEST).
    # Under old UTC-midnight logic this would land in "yesterday"
    # (created_at < today's UTC midnight).
    rows = [
        {"id": "a", "first_name": "Ada", "status": "registered",
         "created_at": _iso_at(early_syd)},
    ]
    db = _FakeDB(rows)
    stats = await compute_founding_members_stats(db)
    assert stats["new_today"] == 1, (
        "01:00 Sydney registration must be counted as 'today' — "
        "found %s" % stats["new_today"]
    )


@pytest.mark.asyncio
async def test_count_tool_today_flag_matches_dashboard():
    """count_interest_registrations with today=true must equal
    compute_founding_members_stats.new_today for the same DB."""
    from services.george import tools as tools_mod
    from services.crm.founding_stats import compute_founding_members_stats

    db = _FakeDB(_seed_scenario_new_today_is_one())
    dashboard = await compute_founding_members_stats(db)

    # Anyone (registered/invited) today.
    fn = tools_mod.TOOL_REGISTRY["count_interest_registrations"]["run"]
    count_today = await fn(db, {"today": True})
    assert count_today == dashboard["new_today"]


def test_topic_router_routes_registered_today_to_summary():
    """'registered today', 'signed up today', 'new today' must all
    route to founding_members_summary (which reads the aligned
    new_today), NOT to count_interest_registrations with since_days=1
    (which is a rolling 24h window that drifts from the card)."""
    from services.george.chat import _TOPIC_TO_TOOL

    lookup = {phrase: tool for phrase, tool in _TOPIC_TO_TOOL}
    for phrase in ("registered today", "signed up today", "new today", "signups today"):
        assert phrase in lookup, f"missing router entry for {phrase!r}"
        assert lookup[phrase]["name"] == "founding_members_summary", (
            f"{phrase!r} must route to founding_members_summary, "
            f"got {lookup[phrase]['name']}"
        )


def test_count_tool_description_warns_against_since_days_for_today():
    """The count_interest_registrations tool description must warn the
    LLM that since_days=1 is a rolling 24h window (not calendar day)
    and to use today=true instead. This prevents the LLM tool-calling
    path from re-introducing the drift."""
    from services.george import tools as tools_mod

    entry = tools_mod.TOOL_REGISTRY["count_interest_registrations"]
    desc = entry["description"].lower()
    assert "today=true" in desc or "today = true" in desc
    assert "sydney" in desc
    assert "calendar" in desc


@pytest.mark.asyncio
async def test_semantic_note_still_present_for_iter161c():
    """iter161c 'Awaiting Invitation' semantic must be preserved by
    the shared stats function — check the fields the prompt/tool
    tests rely on."""
    from services.crm.founding_stats import compute_founding_members_stats

    db = _FakeDB(_seed_scenario_new_today_is_one())
    stats = await compute_founding_members_stats(db)

    sem = stats.get("_semantics")
    assert isinstance(sem, dict)
    assert sem.get("preferred_label") == "awaiting invitation"
    assert sem.get("auto_registration_email_sent") is True
    assert sem.get("personal_invitation_sent") is False
    meaning = sem.get("awaiting_contact_meaning", "").lower()
    assert "registration" in meaning and "invitation" in meaning
    assert "do not" in meaning  # honesty rail


def test_time_boundaries_helper_returns_sydney_midnight():
    """sydney_today_start_iso must be strictly less than 'now' and
    strictly greater than 'now - 25h' — i.e. it's *today's* midnight
    in Sydney, not last week."""
    from services.time_boundaries import sydney_today_start_utc

    now_utc = datetime.now(timezone.utc)
    start = sydney_today_start_utc()
    assert start < now_utc
    assert (now_utc - start) < timedelta(hours=25)
    # And the local wall clock at that instant is exactly midnight.
    local = start.astimezone(SYDNEY)
    assert (local.hour, local.minute, local.second, local.microsecond) == (0, 0, 0, 0)
