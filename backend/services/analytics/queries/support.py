"""
Support-desk analytics.
"""

from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorDatabase

from ..engine import AnalyticsQuery, QueryOutcome
from ..types import DrilldownSpec, TimeRange


#: Status values considered "still open" for the operations team.
OPEN_TICKET_STATUSES: list[str] = ["open", "in_progress", "pending", "new", "reopened"]


class OpenSupportTicketsQuery(AnalyticsQuery):
    query_id = "support.open_tickets"
    metric_label = "Open support cases"
    unit = "cases"
    description = (
        "Support tickets whose status is not 'resolved'/'closed'. "
        "This is a live-inventory count (not filtered by period)."
    )
    supports_comparison = False
    is_periodic = False

    async def run(
        self, db: AsyncIOMotorDatabase, time_range: TimeRange
    ) -> QueryOutcome:
        filter_ = {"status": {"$in": OPEN_TICKET_STATUSES}}
        count = await db.support_tickets.count_documents(filter_)
        return QueryOutcome(
            value=float(count),
            drilldown=DrilldownSpec(
                entity="support_tickets",
                filter=filter_,
                count=count,
                default_projection={
                    "id": 1,
                    "subject": 1,
                    "category": 1,
                    "status": 1,
                    "user_email": 1,
                    "created_at": 1,
                    "updated_at": 1,
                },
                default_sort=[("created_at", -1)],
            ),
        )


__all__ = ["OpenSupportTicketsQuery"]
