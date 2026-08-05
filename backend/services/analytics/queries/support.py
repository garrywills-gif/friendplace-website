"""
Support-desk analytics.
"""

from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorDatabase

from ..engine import AnalyticsQuery, QueryOutcome
from ..types import DrilldownSpec, TimeRange


#: Status values on the Bridge case that mean "still open".
_OPEN_CASE_STATUSES: list[str] = ["NEW", "SEEN", "IN_REVIEW", "SNOOZED", "ESCALATED"]


class OpenSupportTicketsQuery(AnalyticsQuery):
    query_id = "support.open_tickets"
    metric_label = "Open support cases"
    unit = "cases"
    description = (
        "Support tickets that still have an open case on the MCGS "
        "Bridge. The count matches exactly what admins see on "
        "/admin/bridge — same source of truth as the Morning Briefing, "
        "EOD wrap-up, and George's in-conversation count tools."
    )
    supports_comparison = False
    is_periodic = False

    async def run(
        self, db: AsyncIOMotorDatabase, time_range: TimeRange
    ) -> QueryOutcome:
        # Source-of-truth: the Bridge. Any support-ticket case that is
        # still in an OPEN state is counted (and drilled-down to). The
        # raw `support_tickets` collection can drift from the Bridge
        # when the signal-producer step fails silently (see server.py
        # around `producer="support_ticket"`); George's numbers must
        # always mirror the on-screen truth.
        #
        # Launch-readiness fix (Garry, 8 Aug 2026 iter141 — "I need to
        # be able to trust what George says is correct").
        case_filter = {
            "case_key": {"$regex": "^support_ticket:"},
            "status": {"$in": _OPEN_CASE_STATUSES},
        }
        open_ticket_ids: list[str] = []
        async for c in db.mcgs_cases.find(case_filter, {"_id": 0, "case_key": 1}):
            key = c.get("case_key", "")
            if key.startswith("support_ticket:"):
                open_ticket_ids.append(key.split(":", 1)[1])
        count = len(open_ticket_ids)

        # The drilldown is filtered by the SAME set of ticket ids so
        # the "these are the N tickets" list agrees with the metric.
        # Empty $in returns empty — safe when there are zero open cases.
        drilldown_filter = {"id": {"$in": open_ticket_ids}}
        return QueryOutcome(
            value=float(count),
            drilldown=DrilldownSpec(
                entity="support_tickets",
                filter=drilldown_filter,
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
