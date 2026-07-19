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
]
