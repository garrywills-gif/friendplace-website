"""Mission Control George System (MCGS) services.

See `/app/memory/mcgs-architecture.md` (v3) and
`/app/memory/mcgs-phase1-plan.md` for the design and scope of this module.

Everything MCGS runs on four primitives — Signals, George, Studios,
Rhythms. This package is the Signals + audit half; George lives in
`services.george`.
"""

from .signals import (
    PRIORITY_ORDER,
    VALID_TRANSITIONS,
    SignalError,
    create_signal,
    transition_signal,
    transition_case,
    assign_case,
    list_signals,
    list_cases,
    get_signal,
    get_case,
    compute_counts,
)
from .bridge_categories import (
    BRIDGE_CATEGORIES,
    INFORMATIONAL_PRODUCERS,
    PRODUCER_TO_CATEGORY,
    category_for_producer,
    compute_bridge_summary,
    default_origin_for,
    looks_like_test_submission,
    raise_member_complaint,
    raise_safety_review,
    raise_app_feedback,
)
from .audit import log_activity

__all__ = [
    "PRIORITY_ORDER",
    "VALID_TRANSITIONS",
    "SignalError",
    "create_signal",
    "transition_signal",
    "transition_case",
    "assign_case",
    "list_signals",
    "list_cases",
    "get_signal",
    "get_case",
    "compute_counts",
    "log_activity",
    "BRIDGE_CATEGORIES",
    "INFORMATIONAL_PRODUCERS",
    "PRODUCER_TO_CATEGORY",
    "category_for_producer",
    "compute_bridge_summary",
    "default_origin_for",
    "looks_like_test_submission",
    "raise_member_complaint",
    "raise_safety_review",
    "raise_app_feedback",
]
