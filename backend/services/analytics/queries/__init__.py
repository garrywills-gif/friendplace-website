"""
Query registry.

Import every query module here so the engine can register them all in one
call. Adding a new query is a two-step process:

  1. Create ``queries/<topic>.py`` with one or more ``AnalyticsQuery``
     subclasses at module scope.
  2. Import them below and append to ``_ALL_QUERIES``.
"""

from __future__ import annotations

from ..engine import AnalyticsEngine, AnalyticsQuery
from .members import (
    MembersJoinedQuery,
    FoundingMemberNumbersQuery,
    PublishedFounderProfilesQuery,
    MembersOnlineQuery,
    MembersActiveTodayQuery,
    MembersActiveThisWeekQuery,
)
from .events import EventsCreatedQuery
from .support import OpenSupportTicketsQuery
from .campaigns import BestCampaignByOpenRateQuery, BestCampaignByClickRateQuery


_ALL_QUERIES: list[AnalyticsQuery] = [
    MembersJoinedQuery(),
    FoundingMemberNumbersQuery(),
    PublishedFounderProfilesQuery(),
    MembersOnlineQuery(),
    MembersActiveTodayQuery(),
    MembersActiveThisWeekQuery(),
    EventsCreatedQuery(),
    OpenSupportTicketsQuery(),
    BestCampaignByOpenRateQuery(),
    BestCampaignByClickRateQuery(),
]


def register_all_queries(engine: AnalyticsEngine) -> None:
    engine.register_many(_ALL_QUERIES)


__all__ = ["register_all_queries"]
