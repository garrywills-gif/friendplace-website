"""
Member-focused analytics queries:
    - members.joined           (new registrations in period)
    - members.founding_numbers (reserved founding numbers)
    - members.founding_profiles(published founding-member profiles)
    - members.online           (heartbeat in last N minutes)
    - members.active_today     (heartbeat in last N hours)
    - members.active_this_week (heartbeat in last N days)
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase

from ..config import (
    ACTIVE_TODAY_HOURS,
    ACTIVE_WEEK_DAYS,
    ONLINE_WINDOW_MINUTES,
    real_members_filter,
)
from ..engine import AnalyticsQuery, QueryOutcome
from ..types import DrilldownSpec, TimeRange


# ---------------------------------------------------------------------------
# members.joined
# ---------------------------------------------------------------------------


class MembersJoinedQuery(AnalyticsQuery):
    query_id = "members.joined"
    metric_label = "New members joined"
    unit = "members"
    description = (
        "Count of newly-registered real members (excluding demo accounts) "
        "whose account was created within the requested period."
    )

    async def run(
        self, db: AsyncIOMotorDatabase, time_range: TimeRange
    ) -> QueryOutcome:
        start_iso, end_iso = time_range.as_iso_range()
        base = real_members_filter()
        filter_ = {
            **base,
            "created_at": {"$gte": start_iso, "$lt": end_iso},
        }
        count = await db.users.count_documents(filter_)
        return QueryOutcome(
            value=float(count),
            drilldown=DrilldownSpec(
                entity="users",
                filter=filter_,
                count=count,
                default_projection={
                    "id": 1,
                    "username": 1,
                    "first_name": 1,
                    "avatar": 1,
                    "suburb": 1,
                    "created_at": 1,
                },
                default_sort=[("created_at", -1)],
            ),
        )


# ---------------------------------------------------------------------------
# members.founding_numbers  (reserved waitlist founding member numbers)
# ---------------------------------------------------------------------------


class FoundingMemberNumbersQuery(AnalyticsQuery):
    query_id = "members.founding_numbers"
    metric_label = "Reserved Founding Member Numbers"
    unit = "numbers"
    description = (
        "Total distinct Founding Member numbers that have been locked/reserved "
        "via the public interest-registration flow. This is the 'how many "
        "founders exist' number (waitlist-canonical)."
    )
    #: This metric is inherently a running total, not a per-period figure —
    #: George should not offer WoW comparisons on it.
    supports_comparison = False
    is_periodic = False

    async def run(
        self, db: AsyncIOMotorDatabase, time_range: TimeRange
    ) -> QueryOutcome:
        filter_ = {
            "founder_number_locked": True,
            "founder_number": {"$exists": True, "$ne": None},
            "is_test": {"$ne": True},
        }
        count = await db.interest_registrations.count_documents(filter_)
        return QueryOutcome(
            value=float(count),
            drilldown=DrilldownSpec(
                entity="interest_registrations",
                filter=filter_,
                count=count,
                default_projection={
                    "id": 1,
                    "first_name": 1,
                    "email": 1,
                    "founder_number": 1,
                    "state_country": 1,
                    "created_at": 1,
                },
                default_sort=[("founder_number", 1)],
            ),
        )


# ---------------------------------------------------------------------------
# members.founding_profiles (published curated founding-member profiles)
# ---------------------------------------------------------------------------


class PublishedFounderProfilesQuery(AnalyticsQuery):
    query_id = "members.founding_profiles"
    metric_label = "Published Founding Member Profiles"
    unit = "profiles"
    description = (
        "Count of curated Founding Member profiles that are currently "
        "published (visible on the public site). Distinct from reserved "
        "founding numbers — this counts editorial profiles, not waitlist "
        "reservations."
    )
    supports_comparison = False
    is_periodic = False

    async def run(
        self, db: AsyncIOMotorDatabase, time_range: TimeRange
    ) -> QueryOutcome:
        filter_ = {
            "status": "published",
            "hidden": {"$ne": True},
        }
        count = await db.cms_founding_members.count_documents(filter_)
        return QueryOutcome(
            value=float(count),
            drilldown=DrilldownSpec(
                entity="cms_founding_members",
                filter=filter_,
                count=count,
                default_projection={
                    "id": 1,
                    "name": 1,
                    "number": 1,
                    "location": 1,
                    "role": 1,
                },
                default_sort=[("number", 1)],
            ),
        )


# ---------------------------------------------------------------------------
# Presence queries (online / active today / active this week)
# ---------------------------------------------------------------------------


class _PresenceQueryBase(AnalyticsQuery):
    """Shared machinery for last-seen threshold queries."""

    supports_comparison = False  # snapshot, not periodic
    is_periodic = False
    _delta: timedelta = timedelta(0)  # subclass overrides

    async def run(
        self, db: AsyncIOMotorDatabase, time_range: TimeRange
    ) -> QueryOutcome:
        # ``member_status.last_seen_at`` is stored as a real datetime
        # (verified via schema audit) so we compare with a datetime.
        cutoff = datetime.now(timezone.utc) - self._delta
        filter_ = {"last_seen_at": {"$gte": cutoff}}
        count = await db.member_status.count_documents(filter_)
        return QueryOutcome(
            value=float(count),
            drilldown=DrilldownSpec(
                entity="member_status",
                filter=filter_,
                count=count,
                default_projection={
                    "user_id": 1,
                    "last_seen_at": 1,
                    "in_cafe_since": 1,
                    "in_cafe_table_id": 1,
                    "manual_status": 1,
                },
                default_sort=[("last_seen_at", -1)],
            ),
        )


class MembersOnlineQuery(_PresenceQueryBase):
    query_id = "members.online"
    metric_label = "Members online right now"
    unit = "members"
    description = (
        f"Members with a heartbeat in the last {ONLINE_WINDOW_MINUTES} minutes "
        "(configurable via ANALYTICS_ONLINE_MIN)."
    )
    _delta = timedelta(minutes=ONLINE_WINDOW_MINUTES)


class MembersActiveTodayQuery(_PresenceQueryBase):
    query_id = "members.active_today"
    metric_label = "Members active today"
    unit = "members"
    description = (
        f"Members with a heartbeat in the last {ACTIVE_TODAY_HOURS} hours "
        "(configurable via ANALYTICS_ACTIVE_TODAY_HOURS)."
    )
    _delta = timedelta(hours=ACTIVE_TODAY_HOURS)


class MembersActiveThisWeekQuery(_PresenceQueryBase):
    query_id = "members.active_this_week"
    metric_label = "Members active this week"
    unit = "members"
    description = (
        f"Members with a heartbeat in the last {ACTIVE_WEEK_DAYS} days "
        "(configurable via ANALYTICS_ACTIVE_WEEK_DAYS)."
    )
    _delta = timedelta(days=ACTIVE_WEEK_DAYS)


__all__ = [
    "MembersJoinedQuery",
    "FoundingMemberNumbersQuery",
    "PublishedFounderProfilesQuery",
    "MembersOnlineQuery",
    "MembersActiveTodayQuery",
    "MembersActiveThisWeekQuery",
]
