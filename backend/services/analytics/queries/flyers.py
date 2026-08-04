"""
Flyer performance analytics.

Attribution coverage note
-------------------------
Flyer-to-registration attribution is captured on ``interest_registrations``
via the ``acquisition.flyer_id`` sub-field, populated by the public
registration endpoint after the visitor lands via a bridge URL.

Historical registrations that pre-date the acquisition-tracking rollout
lack this field entirely, and this query is HONEST about that: the
``coverage`` is set to ``partial`` and a ``notes`` entry surfaces the
tracking-start date to George's response formatter.
"""

from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorDatabase

from ..config import ATTRIBUTION_TRACKING_START
from ..engine import AnalyticsQuery, QueryOutcome
from ..types import BreakdownRow, DrilldownSpec, TimeRange


class BestFlyerByRegistrationsQuery(AnalyticsQuery):
    query_id = "flyers.best_by_registrations"
    metric_label = "Best-performing flyer (registrations)"
    unit = "registrations"
    description = (
        "Which flyer produced the most registrations in the requested "
        "period, based on the ``acquisition.flyer_id`` field written by "
        "the public registration endpoint. Historical registrations "
        "without acquisition data are excluded — coverage note is set "
        "to make George honest about that."
    )

    async def run(
        self, db: AsyncIOMotorDatabase, time_range: TimeRange
    ) -> QueryOutcome:
        start_iso, end_iso = time_range.as_iso_range()
        match = {
            "created_at": {"$gte": start_iso, "$lt": end_iso},
            "acquisition.flyer_id": {"$ne": None},
            "is_test": {"$ne": True},
        }
        pipeline = [
            {"$match": match},
            {
                "$group": {
                    "_id": "$acquisition.flyer_id",
                    "n": {"$sum": 1},
                }
            },
            {"$sort": {"n": -1}},
        ]
        rows_raw = await db.interest_registrations.aggregate(pipeline).to_list(None)

        # Resolve flyer_id → template name for humane labels.
        if rows_raw:
            flyer_keys = [r["_id"] for r in rows_raw if r.get("_id")]
            templates = await db.flyer_templates.find(
                {"key": {"$in": flyer_keys}}, {"key": 1, "name": 1}
            ).to_list(None)
            name_by = {t["key"]: t.get("name") or t["key"] for t in templates}
        else:
            name_by = {}

        rows: list[BreakdownRow] = [
            BreakdownRow(
                key=r["_id"],
                label=name_by.get(r["_id"], r["_id"]),
                value=float(r["n"]),
                drilldown_filter={"acquisition.flyer_id": r["_id"], **match},
            )
            for r in rows_raw
            if r.get("_id")
        ]
        top = rows[0] if rows else None

        # Honest coverage note.
        notes: list[str] = []
        coverage = "full"
        if ATTRIBUTION_TRACKING_START:
            notes.append(
                f"Flyer attribution has been tracked since "
                f"{ATTRIBUTION_TRACKING_START}. Registrations that "
                "pre-date this cannot be attributed to individual flyers."
            )
            coverage = "partial"
        if not rows:
            notes.append(
                "No flyer-attributed registrations found in this period."
            )

        return QueryOutcome(
            value=(top.value if top else 0.0),
            breakdown=rows,
            drilldown=(
                DrilldownSpec(
                    entity="interest_registrations",
                    filter={**match, "acquisition.flyer_id": top.key} if top else match,
                    count=int(top.value) if top else 0,
                    default_projection={
                        "id": 1,
                        "first_name": 1,
                        "email": 1,
                        "founder_number": 1,
                        "acquisition": 1,
                        "created_at": 1,
                    },
                    default_sort=[("created_at", -1)],
                )
                if top
                else None
            ),
            coverage=coverage,  # type: ignore[arg-type]
            notes=notes,
        )


__all__ = ["BestFlyerByRegistrationsQuery"]
