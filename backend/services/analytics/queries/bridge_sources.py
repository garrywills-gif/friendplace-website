"""
Top QR / bridge sources.

Aggregates ``bridge_events`` (recorded by ``POST /api/public/bridge/hit``)
grouped by channel and by (flyer_id / qr_code_id / campaign_id).

Coverage
--------
The ``bridge_events`` collection was introduced with the acquisition
rollout. Any traffic that arrived BEFORE that rollout is invisible to
this query — surfaced honestly via a coverage note.
"""

from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorDatabase

from ..config import BRIDGE_EVENTS_START
from ..engine import AnalyticsQuery, QueryOutcome
from ..types import BreakdownRow, DrilldownSpec, TimeRange


class TopBridgeSourcesQuery(AnalyticsQuery):
    query_id = "bridge.top_sources"
    metric_label = "Top QR / bridge sources"
    unit = "hits"
    description = (
        "Ranked list of QR / bridge sources by hit count in the requested "
        "period. Groups by (channel, flyer_id, qr_code_id, campaign_id) "
        "and returns the winning source as the primary value."
    )

    async def run(
        self, db: AsyncIOMotorDatabase, time_range: TimeRange
    ) -> QueryOutcome:
        start_iso, end_iso = time_range.as_iso_range()
        match = {"at": {"$gte": start_iso, "$lt": end_iso}}
        pipeline = [
            {"$match": match},
            {
                "$group": {
                    "_id": {
                        "channel": "$channel",
                        "flyer_id": "$flyer_id",
                        "qr_code_id": "$qr_code_id",
                        "campaign_id": "$campaign_id",
                    },
                    "hits": {"$sum": 1},
                    "conversions": {
                        "$sum": {
                            "$cond": [
                                {"$ne": ["$converted_to_registration_id", None]},
                                1,
                                0,
                            ]
                        }
                    },
                }
            },
            {"$sort": {"hits": -1}},
            {"$limit": 20},
        ]
        rows_raw = await db.bridge_events.aggregate(pipeline).to_list(None)

        rows: list[BreakdownRow] = []
        for r in rows_raw:
            grp = r["_id"]
            parts = [grp.get("channel") or "organic"]
            for k in ("flyer_id", "qr_code_id", "campaign_id"):
                if grp.get(k):
                    parts.append(f"{k}={grp[k]}")
            label = " · ".join(parts)
            hits = float(r["hits"])
            conv = float(r.get("conversions", 0))
            conv_rate = (conv / hits * 100.0) if hits > 0 else 0.0
            rows.append(
                BreakdownRow(
                    key=label,
                    label=label,
                    value=hits,
                    secondary_values={
                        "hits": hits,
                        "conversions": conv,
                        "conversion_rate": conv_rate,
                    },
                    drilldown_filter={
                        "channel": grp.get("channel"),
                        "flyer_id": grp.get("flyer_id"),
                        "qr_code_id": grp.get("qr_code_id"),
                        "campaign_id": grp.get("campaign_id"),
                        **match,
                    },
                )
            )
        top = rows[0] if rows else None

        notes: list[str] = []
        coverage = "full"
        if BRIDGE_EVENTS_START:
            notes.append(
                f"QR / bridge tracking has been recorded since "
                f"{BRIDGE_EVENTS_START}. Earlier visits are not "
                "included."
            )
            coverage = "partial"
        if not rows:
            notes.append(
                "No bridge events recorded in this period. Newly printed "
                "flyer QRs will start populating this metric as visitors "
                "scan them."
            )

        return QueryOutcome(
            value=(top.value if top else 0.0),
            breakdown=rows,
            drilldown=(
                DrilldownSpec(
                    entity="bridge_events",
                    filter=top.drilldown_filter or match,
                    count=int(top.value) if top else 0,
                    default_projection={
                        "id": 1,
                        "at": 1,
                        "channel": 1,
                        "flyer_id": 1,
                        "qr_code_id": 1,
                        "campaign_id": 1,
                        "ref_source": 1,
                        "converted_to_registration_id": 1,
                    },
                    default_sort=[("at", -1)],
                )
                if top
                else None
            ),
            coverage=coverage,  # type: ignore[arg-type]
            notes=notes,
        )


__all__ = ["TopBridgeSourcesQuery"]
