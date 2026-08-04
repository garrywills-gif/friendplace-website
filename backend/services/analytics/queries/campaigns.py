"""
Campaign performance analytics.

We derive open-rate / click-rate directly from ``campaign_recipient_events``
(the source of truth Resend webhooks write into), rather than relying on
the pre-aggregated ``campaigns.stats`` blob — because the raw event log
is guaranteed to include every campaign that has had activity, whereas
the stats blob may lag.

Conversion attribution (campaign → registration) is deliberately NOT
implemented here. The campaign-conversion attribution schema will land
in Commit 2, at which point a ``BestCampaignByRegistrationsQuery`` will
be added.
"""

from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorDatabase

from ..engine import AnalyticsQuery, QueryOutcome
from ..types import BreakdownRow, DrilldownSpec, TimeRange


DELIVERED_EVENT = "email.delivered"
OPENED_EVENT = "email.opened"
CLICKED_EVENT = "email.clicked"


async def _campaign_perf_breakdown(
    db: AsyncIOMotorDatabase,
    time_range: TimeRange,
) -> list[BreakdownRow]:
    """Return per-campaign engagement stats within ``time_range``.

    A campaign is included if it has at least one ``email.delivered``
    event whose ``at`` timestamp falls inside the range. The engagement
    events (opens/clicks) are counted for ANY delivered email regardless
    of when the open/click happened, because that's the industry-standard
    way to attribute engagement to a send window.
    """
    start_iso, end_iso = time_range.as_iso_range()

    pipeline = [
        {"$match": {"type": DELIVERED_EVENT, "at": {"$gte": start_iso, "$lt": end_iso}}},
        {"$group": {"_id": "$campaign_id", "delivered": {"$sum": 1}}},
    ]
    delivered_rows = await db.campaign_recipient_events.aggregate(pipeline).to_list(None)
    if not delivered_rows:
        return []

    campaign_ids = [r["_id"] for r in delivered_rows if r.get("_id")]
    delivered_by = {r["_id"]: r["delivered"] for r in delivered_rows}

    # Opens / clicks — restricted to the same set of campaigns but not
    # time-bounded (open events fire after the send).
    engagement_pipeline = [
        {
            "$match": {
                "campaign_id": {"$in": campaign_ids},
                "type": {"$in": [OPENED_EVENT, CLICKED_EVENT]},
            }
        },
        {
            "$group": {
                "_id": {"campaign_id": "$campaign_id", "type": "$type"},
                "n": {"$sum": 1},
            }
        },
    ]
    engagement_rows = await db.campaign_recipient_events.aggregate(engagement_pipeline).to_list(None)

    opens_by: dict[str, int] = {}
    clicks_by: dict[str, int] = {}
    for row in engagement_rows:
        cid = row["_id"]["campaign_id"]
        t = row["_id"]["type"]
        if t == OPENED_EVENT:
            opens_by[cid] = row["n"]
        elif t == CLICKED_EVENT:
            clicks_by[cid] = row["n"]

    # Campaign titles for humane labels.
    campaigns = await db.campaigns.find(
        {"id": {"$in": campaign_ids}}, {"id": 1, "title": 1}
    ).to_list(None)
    title_by = {c["id"]: c.get("title") or c["id"] for c in campaigns}

    rows: list[BreakdownRow] = []
    for cid in campaign_ids:
        delivered = delivered_by.get(cid, 0)
        if delivered <= 0:
            continue
        opens = opens_by.get(cid, 0)
        clicks = clicks_by.get(cid, 0)
        open_rate = (opens / delivered) * 100.0
        click_rate = (clicks / delivered) * 100.0
        rows.append(
            BreakdownRow(
                key=cid,
                label=title_by.get(cid, cid),
                value=open_rate,  # primary metric — subclass may re-order
                secondary_values={
                    "delivered": float(delivered),
                    "opens": float(opens),
                    "clicks": float(clicks),
                    "open_rate": open_rate,
                    "click_rate": click_rate,
                },
                drilldown_filter={"campaign_id": cid},
            )
        )
    return rows


# ---------------------------------------------------------------------------
# Best campaign by open-rate
# ---------------------------------------------------------------------------


class BestCampaignByOpenRateQuery(AnalyticsQuery):
    query_id = "campaigns.best_by_open_rate"
    metric_label = "Best-performing campaign (open rate)"
    unit = "%"
    description = (
        "Highest email open-rate across campaigns that had deliveries in "
        "the requested period. Returns the winning campaign as the primary "
        "value and every eligible campaign in the breakdown."
    )

    async def run(
        self, db: AsyncIOMotorDatabase, time_range: TimeRange
    ) -> QueryOutcome:
        rows = await _campaign_perf_breakdown(db, time_range)
        rows.sort(key=lambda r: r.secondary_values.get("open_rate", 0), reverse=True)
        top = rows[0] if rows else None
        return QueryOutcome(
            value=(top.secondary_values["open_rate"] if top else 0.0),
            breakdown=rows,
            drilldown=(
                DrilldownSpec(
                    entity="campaign_recipients",
                    filter={"campaign_id": top.key} if top else {},
                    count=0,
                    default_projection={
                        "campaign_id": 1,
                        "email": 1,
                        "first_name": 1,
                        "status": 1,
                        "first_opened_at": 1,
                    },
                )
                if top
                else None
            ),
            notes=(
                []
                if rows
                else ["No campaigns had deliveries in this period."]
            ),
        )


# ---------------------------------------------------------------------------
# Best campaign by click-rate
# ---------------------------------------------------------------------------


class BestCampaignByClickRateQuery(AnalyticsQuery):
    query_id = "campaigns.best_by_click_rate"
    metric_label = "Best-performing campaign (click rate)"
    unit = "%"
    description = (
        "Highest email click-rate across campaigns that had deliveries in "
        "the requested period."
    )

    async def run(
        self, db: AsyncIOMotorDatabase, time_range: TimeRange
    ) -> QueryOutcome:
        rows = await _campaign_perf_breakdown(db, time_range)
        # Re-order so click-rate is the primary metric per row.
        for r in rows:
            r.value = r.secondary_values.get("click_rate", 0.0)
        rows.sort(key=lambda r: r.value, reverse=True)
        top = rows[0] if rows else None
        return QueryOutcome(
            value=(top.value if top else 0.0),
            breakdown=rows,
            drilldown=(
                DrilldownSpec(
                    entity="campaign_recipients",
                    filter={"campaign_id": top.key} if top else {},
                    count=0,
                    default_projection={
                        "campaign_id": 1,
                        "email": 1,
                        "first_name": 1,
                        "status": 1,
                    },
                )
                if top
                else None
            ),
            notes=(
                []
                if rows
                else ["No campaigns had deliveries in this period."]
            ),
        )


__all__ = ["BestCampaignByOpenRateQuery", "BestCampaignByClickRateQuery"]
