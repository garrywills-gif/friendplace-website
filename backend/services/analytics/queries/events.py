"""
Event-related analytics queries.
"""

from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorDatabase

from ..engine import AnalyticsQuery, QueryOutcome
from ..types import DrilldownSpec, TimeRange


class EventsCreatedQuery(AnalyticsQuery):
    query_id = "events.created"
    metric_label = "Events created"
    unit = "events"
    description = (
        "Count of events created within the requested period. Uses "
        "``events.created_at`` (ISO string)."
    )

    async def run(
        self, db: AsyncIOMotorDatabase, time_range: TimeRange
    ) -> QueryOutcome:
        start_iso, end_iso = time_range.as_iso_range()
        filter_ = {"created_at": {"$gte": start_iso, "$lt": end_iso}}
        count = await db.events.count_documents(filter_)
        return QueryOutcome(
            value=float(count),
            drilldown=DrilldownSpec(
                entity="events",
                filter=filter_,
                count=count,
                default_projection={
                    "id": 1,
                    "title": 1,
                    "date": 1,
                    "location": 1,
                    "emoji": 1,
                    "sponsor": 1,
                    "created_at": 1,
                },
                default_sort=[("created_at", -1)],
            ),
        )


__all__ = ["EventsCreatedQuery"]
