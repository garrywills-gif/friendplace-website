"""Outreach organisations service (iter160a).

External outreach targets - retirement villages, community centres,
libraries, councils, clubs, etc. Distinct from `marketing_contacts`
(auto-grown per-recipient address book) - these are curated
organisation records that exist BEFORE the first email is sent.
"""
from .store import (
    COLL_ORGS,
    OUTREACH_STATUSES,
    OUTREACH_CATEGORIES,
    upsert_org,
    get_org,
    list_orgs,
    delete_org,
    touch_last_contact,
    log_communication,
    mark_replied,
    ensure_indexes,
)

__all__ = [
    "COLL_ORGS", "OUTREACH_STATUSES", "OUTREACH_CATEGORIES",
    "upsert_org", "get_org", "list_orgs", "delete_org",
    "touch_last_contact", "log_communication", "mark_replied",
    "ensure_indexes",
]
