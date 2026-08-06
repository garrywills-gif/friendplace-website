"""Cross-surface moderation helpers.

Shared, single-source-of-truth heuristics that gate BOTH the Host an
Event flow and the Notice Board post flow. Ports the exact
`_looks_like_business_event` scorer that used to live in server.py
into a place where any surface (events, notices, future flyers…) can
call the same checker so a business or spammer can't defeat the
system by switching channels.

Public API:
    * check_business_content(...)       — text-only heuristic scorer
    * count_prior_content(...)          — prolific-poster counter
    * moderation_verdict(...)           — combined checker, ready to
                                          drop into any POST handler
    * HOLD_MESSAGE_EVENT                — user-facing hold copy
    * HOLD_MESSAGE_NOTICE               — user-facing hold copy (notices)

Locked with Garry (iter153, June 2026): same rules, same thresholds
across all posting surfaces. Do not fork this checker.
"""

from .business_content import (
    HOLD_MESSAGE_EVENT,
    HOLD_MESSAGE_NOTICE,
    ContentKind,
    check_business_content,
    count_prior_content,
    moderation_verdict,
)

__all__ = [
    "HOLD_MESSAGE_EVENT",
    "HOLD_MESSAGE_NOTICE",
    "ContentKind",
    "check_business_content",
    "count_prior_content",
    "moderation_verdict",
]
