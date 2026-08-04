"""
Typed response models for the analytics engine.

Everything an ``AnalyticsQuery`` returns flows through these Pydantic
models so downstream consumers (George's tool-calling layer, Mission
Control dashboards, future report exports) share exactly one schema.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Time ranges
# ---------------------------------------------------------------------------


class TimeRange(BaseModel):
    """A resolved (concrete) time window."""

    key: str = Field(
        description="Named identifier, e.g. 'this_week', 'today', or 'custom'.",
    )
    label: str = Field(description="Human-readable label, e.g. 'This week'.")
    start: datetime = Field(description="Inclusive lower bound (UTC).")
    end: datetime = Field(description="Exclusive upper bound (UTC).")

    def contains(self, dt: datetime) -> bool:
        return self.start <= dt < self.end

    def as_iso_range(self) -> tuple[str, str]:
        """Return (start_iso, end_iso) suitable for querying ISO-string
        date fields (which is what most FriendPlace collections use)."""
        return self.start.isoformat(), self.end.isoformat()


# ---------------------------------------------------------------------------
# Comparison
# ---------------------------------------------------------------------------


class Direction(str, Enum):
    UP = "up"
    DOWN = "down"
    FLAT = "flat"


class PeriodComparison(BaseModel):
    """Period-over-period comparison payload."""

    previous_time_range: TimeRange
    previous_value: float
    delta_absolute: float
    delta_pct: Optional[float] = Field(
        None,
        description=(
            "Percent change vs previous period. Null when the previous "
            "value is zero and a % is meaningless."
        ),
    )
    direction: Direction

    def humanize(self) -> str:
        """One-liner suitable for embedding in George's reply."""
        prev_label = self.previous_time_range.label.lower()
        if self.delta_pct is None:
            # Previous period had zero — a percentage is meaningless, and
            # a raw absolute delta lacks unit context here, so be honest.
            if self.direction == Direction.FLAT:
                return f"same as {prev_label} (none either period)"
            return f"new activity — no {prev_label} baseline to compare"
        if self.direction == Direction.FLAT:
            return f"flat vs {prev_label}"
        pct = f"{abs(self.delta_pct):.1f}%"
        verb = "up" if self.direction == Direction.UP else "down"
        return f"{verb} {pct} vs {prev_label}"


# ---------------------------------------------------------------------------
# Breakdown (for top-N style queries)
# ---------------------------------------------------------------------------


class BreakdownRow(BaseModel):
    """A single row in a top-N / grouped breakdown."""

    key: str = Field(description="Group key (e.g. campaign_id, flyer_id).")
    label: str = Field(description="Human-readable label for the group.")
    value: float = Field(description="Metric value for this group.")
    secondary_values: dict[str, float] = Field(
        default_factory=dict,
        description=(
            "Optional additional metrics per row, e.g. "
            "{'open_rate': 42.5, 'click_rate': 12.1}."
        ),
    )
    drilldown_filter: Optional[dict[str, Any]] = Field(
        None,
        description="Mongo filter to enumerate underlying docs for this row.",
    )


# ---------------------------------------------------------------------------
# Drill-down (forward-compat)
# ---------------------------------------------------------------------------


class DrilldownSpec(BaseModel):
    """
    Enough information for a future call to enumerate the underlying
    documents that produced this metric.

    Not consumed today, but every query is required to emit it so that a
    later "show me those 42 members" flow drops in without rework.
    """

    entity: str = Field(
        description=(
            "The Mongo collection to enumerate, e.g. 'users', 'events', "
            "'campaigns', 'interest_registrations'."
        )
    )
    filter: dict[str, Any] = Field(
        description="Mongo find filter that reproduces the underlying set.",
    )
    count: int = Field(description="Total number of documents in the set.")
    default_projection: Optional[dict[str, int]] = Field(
        None,
        description=(
            "Suggested projection for the drill-down list view "
            "(names, IDs, avatars, etc.)."
        ),
    )
    default_sort: Optional[list[tuple[str, int]]] = Field(
        None,
        description="Suggested sort spec, e.g. [('created_at', -1)].",
    )


# ---------------------------------------------------------------------------
# Coverage
# ---------------------------------------------------------------------------


Coverage = Literal["full", "partial", "unavailable"]


# ---------------------------------------------------------------------------
# Top-level result
# ---------------------------------------------------------------------------


class AnalyticsResult(BaseModel):
    """The canonical envelope every query returns."""

    query_id: str = Field(description="Stable identifier, e.g. 'members.joined'.")
    metric_label: str = Field(description="Human-readable metric name.")
    value: float
    unit: str = Field(
        description="Unit of the primary value, e.g. 'members', 'events', '%'.",
    )
    time_range: TimeRange
    comparison: Optional[PeriodComparison] = None
    breakdown: Optional[list[BreakdownRow]] = None
    drilldown: Optional[DrilldownSpec] = None
    coverage: Coverage = "full"
    notes: list[str] = Field(
        default_factory=list,
        description=(
            "Honest-coverage notes George should always surface to users, "
            "e.g. 'Attribution tracking started 4 Aug 2026.'"
        ),
    )
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    def to_george_summary(self) -> str:
        """One-sentence summary George can speak/print unchanged."""
        head = f"{self.metric_label}: {_fmt_value(self.value, self.unit)}"
        if self.comparison is not None:
            head += f" ({self.comparison.humanize()})"
        if self.coverage != "full" and self.notes:
            head += f" — {self.notes[0]}"
        return head


def _fmt_value(v: float, unit: str) -> str:
    """Pretty-print numeric values respecting the unit."""
    if unit == "%":
        return f"{v:.1f}%"
    if isinstance(v, float) and not v.is_integer():
        return f"{v:.2f} {unit}"
    return f"{int(v):,} {unit}".rstrip()
