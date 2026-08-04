"""
Analytics engine configuration.

Every threshold / tunable that affects a metric is captured here as a
module-level constant so it can be overridden via env vars or unit tests
without hunting through query files. NEVER hard-code thresholds inside
query modules — pull from this file instead.
"""

from __future__ import annotations

import os

# ---------------------------------------------------------------------------
# Presence thresholds (used by ``members.active`` query)
# ---------------------------------------------------------------------------

#: A member is considered "online right now" if their heartbeat is newer
#: than this many minutes. Configurable via ``ANALYTICS_ONLINE_MIN``.
ONLINE_WINDOW_MINUTES: int = int(os.getenv("ANALYTICS_ONLINE_MIN", "5"))

#: A member is considered "active today" if their heartbeat is newer than
#: this many hours. Configurable via ``ANALYTICS_ACTIVE_TODAY_HOURS``.
ACTIVE_TODAY_HOURS: int = int(os.getenv("ANALYTICS_ACTIVE_TODAY_HOURS", "24"))

#: A member is considered "active this week" if their heartbeat is newer
#: than this many days. Configurable via ``ANALYTICS_ACTIVE_WEEK_DAYS``.
ACTIVE_WEEK_DAYS: int = int(os.getenv("ANALYTICS_ACTIVE_WEEK_DAYS", "7"))

# ---------------------------------------------------------------------------
# Data-cutoff dates (used to communicate honest coverage)
# ---------------------------------------------------------------------------

#: ISO date (YYYY-MM-DD) from which per-flyer/per-QR acquisition attribution
#: began flowing into ``interest_registrations.acquisition``. Any query that
#: relies on this data will emit a coverage note for registrations older
#: than this date. Set by the Commit-2 schema addition; keep as ``None``
#: until it lands.
ATTRIBUTION_TRACKING_START: str | None = os.getenv(
    "ANALYTICS_ATTRIBUTION_START", None
)

#: ISO date (YYYY-MM-DD) from which bridge_events (QR-scan telemetry) began
#: being recorded. Same rules as above.
BRIDGE_EVENTS_START: str | None = os.getenv(
    "ANALYTICS_BRIDGE_EVENTS_START", None
)


# ---------------------------------------------------------------------------
# Drill-down limits
# ---------------------------------------------------------------------------

#: Maximum number of underlying documents a single drill-down call will
#: return in one page. Prevents accidental full-collection scans.
DRILLDOWN_MAX_PAGE_SIZE: int = int(os.getenv("ANALYTICS_DRILLDOWN_PAGE", "50"))


# ---------------------------------------------------------------------------
# Filters — canonical "real member" predicate
# ---------------------------------------------------------------------------

def real_members_filter() -> dict:
    """Return the Mongo filter that excludes demo/system accounts.

    Kept as a function so future flags (e.g. ``banned``, ``deleted_at``)
    can be added in one place.
    """
    return {"is_demo": {"$ne": True}}
