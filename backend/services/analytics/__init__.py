"""
FriendPlace Analytics Engine
============================

A shared, typed analytics engine that powers George's insight queries AND
future Mission Control dashboards. Every query returns a strictly-typed
``AnalyticsResult`` with optional period-over-period comparison and
drill-down filters, so a single implementation feeds both the LLM
tool-calling path and any UI that wants to consume the same numbers.

Design principles
-----------------

1. **Honest coverage**: every query declares whether its data is
   ``full`` / ``partial`` / ``unavailable`` and returns explanatory
   notes (e.g. "attribution tracking started 4 Aug 2026").
2. **Period comparison**: results include a ``comparison`` block so
   George can say "42 members joined this week, up 12% vs last week".
3. **Drill-down forward-compat**: every result includes a
   ``drilldown.filter`` (a Mongo query) so a future "show me those
   42 members" call can just ``db.<entity>.find(filter)``.
4. **Reusable time ranges**: named ranges (today, this_week, this_month,
   this_quarter) with automatic previous-period pairing.
"""

from .types import (
    AnalyticsResult,
    BreakdownRow,
    DrilldownSpec,
    PeriodComparison,
    TimeRange,
)
from .engine import AnalyticsEngine, get_engine
from .time_ranges import (
    NamedRange,
    range_for,
    previous_range_for,
)

__all__ = [
    "AnalyticsResult",
    "BreakdownRow",
    "DrilldownSpec",
    "PeriodComparison",
    "TimeRange",
    "AnalyticsEngine",
    "get_engine",
    "NamedRange",
    "range_for",
    "previous_range_for",
]
