"""
Base class for analytics queries + the query registry / orchestration.

Every query subclass declares:

  - ``query_id``     — stable identifier (e.g. ``members.joined``)
  - ``metric_label`` — human-readable name
  - ``unit``         — 'members', 'events', '%', etc.
  - ``description``  — natural-language description George shows the LLM
  - ``coverage_note()`` — an optional "how honest is this metric?" line
  - ``async run(db, time_range)`` — returns ``QueryOutcome``

The engine wraps each ``run()`` call, handles period-over-period
comparison automatically (when ``supports_comparison`` is true), and
packages everything into an ``AnalyticsResult``.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Optional

from motor.motor_asyncio import AsyncIOMotorDatabase

from .comparison import build_comparison
from .time_ranges import NamedRange, previous_range_for, range_for
from .types import (
    AnalyticsResult,
    BreakdownRow,
    Coverage,
    DrilldownSpec,
    TimeRange,
)


# ---------------------------------------------------------------------------
# Value-level DTO returned by a single ``AnalyticsQuery.run()``
# ---------------------------------------------------------------------------


@dataclass
class QueryOutcome:
    """A single-period execution result."""

    value: float
    drilldown: Optional[DrilldownSpec] = None
    breakdown: Optional[list[BreakdownRow]] = None
    coverage: Coverage = "full"
    notes: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Base class
# ---------------------------------------------------------------------------


class AnalyticsQuery(ABC):
    """Abstract base for every analytics query."""

    #: Stable, dot-namespaced identifier (e.g. ``members.joined``).
    query_id: str = ""

    #: Human-readable metric name.
    metric_label: str = ""

    #: Unit for the primary value.
    unit: str = "count"

    #: Short natural-language description shown to George's LLM so it can
    #: select the right query for a user question.
    description: str = ""

    #: Whether this query supports period-over-period comparison.
    supports_comparison: bool = True

    #: Whether calling ``previous_range_for()`` produces a meaningful
    #: previous period (some queries — e.g. "all founding members ever" —
    #: are inherently non-periodic).
    is_periodic: bool = True

    @abstractmethod
    async def run(
        self, db: AsyncIOMotorDatabase, time_range: TimeRange
    ) -> QueryOutcome:
        """Compute the metric for ``time_range``."""


# ---------------------------------------------------------------------------
# Registry + engine
# ---------------------------------------------------------------------------


class AnalyticsEngine:
    """Public entry-point for running any registered analytics query."""

    def __init__(self) -> None:
        self._queries: dict[str, AnalyticsQuery] = {}

    # --- registration ------------------------------------------------------

    def register(self, query: AnalyticsQuery) -> None:
        if not query.query_id:
            raise ValueError("Query missing query_id")
        self._queries[query.query_id] = query

    def register_many(self, queries: list[AnalyticsQuery]) -> None:
        for q in queries:
            self.register(q)

    def get(self, query_id: str) -> AnalyticsQuery:
        try:
            return self._queries[query_id]
        except KeyError as exc:  # pragma: no cover - defensive
            raise KeyError(f"Unknown analytics query: {query_id}") from exc

    def catalogue(self) -> list[dict[str, Any]]:
        """Machine-readable list of every registered query.

        Used by the ``/analytics/catalogue`` endpoint and, in Commit 2,
        by George's tool-calling layer so the LLM can pick the right
        query_id for a given user question.
        """
        return [
            {
                "query_id": q.query_id,
                "metric_label": q.metric_label,
                "unit": q.unit,
                "description": q.description,
                "supports_comparison": q.supports_comparison,
                "is_periodic": q.is_periodic,
            }
            for q in self._queries.values()
        ]

    # --- execution ---------------------------------------------------------

    async def run(
        self,
        query_id: str,
        *,
        db: AsyncIOMotorDatabase,
        range_kind: NamedRange = NamedRange.THIS_WEEK,
        compare: bool = True,
    ) -> AnalyticsResult:
        """Execute a registered query and wrap in an ``AnalyticsResult``."""
        query = self.get(query_id)
        time_range = range_for(range_kind)
        outcome = await query.run(db, time_range)

        comparison = None
        if compare and query.supports_comparison and query.is_periodic:
            prev_range = previous_range_for(range_kind)
            if prev_range is not None:
                prev_outcome = await query.run(db, prev_range)
                comparison = build_comparison(
                    current_value=outcome.value,
                    previous_value=prev_outcome.value,
                    previous_time_range=prev_range,
                )

        return AnalyticsResult(
            query_id=query.query_id,
            metric_label=query.metric_label,
            value=outcome.value,
            unit=query.unit,
            time_range=time_range,
            comparison=comparison,
            breakdown=outcome.breakdown,
            drilldown=outcome.drilldown,
            coverage=outcome.coverage,
            notes=outcome.notes,
        )


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_singleton: AnalyticsEngine | None = None


def get_engine() -> AnalyticsEngine:
    """Return (creating if needed) the process-wide analytics engine."""
    global _singleton
    if _singleton is None:
        _singleton = AnalyticsEngine()
        # Lazy-import so this file has no import-time deps on the queries
        # package (which itself imports from ``engine`` — avoids cycles).
        from .queries import register_all_queries

        register_all_queries(_singleton)
    return _singleton


__all__ = ["AnalyticsQuery", "AnalyticsEngine", "QueryOutcome", "get_engine"]
