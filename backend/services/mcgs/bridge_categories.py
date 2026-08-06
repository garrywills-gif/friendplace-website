"""Bridge category mapping (iter155 Phase 3).

The six operational categories admins see at the top of The Bridge — each
maps to one or more Signal ``producer`` strings. Kept in one place so
George's workload summary, the Bridge tile UI and the case-list filters
all agree.

Positive milestone signals (``producer="milestones"``) are *never*
included in these actionable counts — they are separated into their own
informational bucket by ``compute_bridge_summary``.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Optional

from .signals import OPEN_STATES


# ---------------------------------------------------------------------------
# Defensive test-marker detection (iter155 Phase 3)
# ---------------------------------------------------------------------------
#
# Any runtime submission whose subject/title matches this regex is auto-
# tagged ``origin='test'`` even if the caller forgot to set it. This is
# the forward-safety layer the user asked for on 2026-08-06: "don't
# permanently rely on 'unset means production'". Combined with the
# ``origin`` filter on Bridge queries, it means a test suite that POSTs
# through the public API (e.g. iter153 parity tests) cannot leak into
# live operational counts.
_TEST_SUBJECT_RE = re.compile(
    r"(?:"
    r"^\s*TEST_|"
    r"\bTEST_MOD_|"
    r"\bTEST_iter\d+|"
    r"\bTEST_SSE|"
    r"\bTEST_MCGS|"
    r"\bPROP_[a-f0-9]{4,}|"
    r"\bTest bug\b"
    r")",
    re.IGNORECASE,
)


def looks_like_test_submission(*fields: Optional[str]) -> bool:
    """Return True if any of the given fields is a known test marker."""
    for f in fields:
        if f and _TEST_SUBJECT_RE.search(f):
            return True
    return False


def default_origin_for(*fields: Optional[str]) -> str:
    """Convenience: pick ``test`` for known-test fields, else ``production``."""
    return "test" if looks_like_test_submission(*fields) else "production"


# Six actionable categories + producers.
#
# Key is a stable slug used in URLs (``?category=<key>``), the API and
# George's answers. ``label`` is the human-facing title on the tile.
BRIDGE_CATEGORIES: list[dict] = [
    {
        "key": "event_approvals",
        "label": "Event Approvals",
        "short": "event approvals",
        "producers": ["event_submission", "event_moderation"],
    },
    {
        "key": "notice_approvals",
        "label": "Notice Approvals",
        "short": "notice approvals",
        "producers": ["notice_moderation"],
    },
    {
        "key": "member_complaints",
        "label": "Member Complaints",
        "short": "complaints",
        "producers": ["member_complaint"],
    },
    {
        "key": "safety_reviews",
        "label": "Safety / Ban Reviews",
        "short": "safety reviews",
        "producers": ["safety_review"],
    },
    {
        "key": "app_feedback",
        "label": "App Feedback",
        "short": "app feedback items",
        "producers": ["app_feedback"],
    },
    {
        "key": "support_tickets",
        "label": "Support Tickets",
        "short": "support tickets",
        "producers": ["support_ticket"],
    },
]

# Milestone / informational producers — excluded from every actionable
# count, but reported separately.
INFORMATIONAL_PRODUCERS: set[str] = {"milestones"}

# Reverse index: producer -> category key (used by SignalFeed filter).
PRODUCER_TO_CATEGORY: dict[str, str] = {
    p: cat["key"] for cat in BRIDGE_CATEGORIES for p in cat["producers"]
}


def category_for_producer(producer: Optional[str]) -> Optional[str]:
    """Return the tile-category key for a given signal producer."""
    if not producer:
        return None
    return PRODUCER_TO_CATEGORY.get(producer)


def _parse_iso(s: str) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


async def compute_bridge_summary(db: Any) -> dict:
    """Compute the six-tile summary for The Bridge.

    Returns::

      {
        "categories": [
          {
            "key": "event_approvals",
            "label": "Event Approvals",
            "short": "event approvals",
            "producers": [...],
            "open": 0,
            "oldest_waiting_seconds": null   # or int
          },
          ...
        ],
        "milestones": {"open": 2},
        "total_actionable": 0,
        "computed_at": "..."
      }

    All counts are ``origin='production'``, open status only. Milestone
    signals are excluded from every category count.
    """
    now = datetime.now(timezone.utc)
    open_prod = {
        "status": {"$in": list(OPEN_STATES)},
        "origin": "production",
    }

    categories_out: list[dict] = []
    total_actionable = 0

    for cat in BRIDGE_CATEGORIES:
        producers = cat["producers"]
        # Count open cases whose linked signals include one of these producers.
        # In practice a Case's producer is stable (case_key prefix maps 1:1),
        # so we can count directly against signals and dedupe by case_id.
        # A single case usually has one open signal, so the numbers align.
        pipeline = [
            {"$match": {**open_prod, "producer": {"$in": producers}}},
            {"$group": {"_id": "$case_id", "oldest": {"$min": "$created_at"}}},
        ]
        rows = await db.mcgs_signals.aggregate(pipeline).to_list(2000)
        open_count = len(rows)
        oldest_iso = None
        oldest_seconds: Optional[int] = None
        if rows:
            oldest_iso = min(r.get("oldest") for r in rows if r.get("oldest"))
            dt = _parse_iso(oldest_iso) if isinstance(oldest_iso, str) else oldest_iso
            if isinstance(dt, datetime):
                oldest_seconds = max(0, int((now - dt).total_seconds()))
        categories_out.append({
            "key": cat["key"],
            "label": cat["label"],
            "short": cat["short"],
            "producers": producers,
            "open": open_count,
            "oldest_waiting_seconds": oldest_seconds,
            "oldest_waiting_at": oldest_iso if oldest_seconds is not None else None,
        })
        total_actionable += open_count

    milestones_open = await db.mcgs_signals.count_documents({
        **open_prod,
        "producer": {"$in": list(INFORMATIONAL_PRODUCERS)},
    })

    return {
        "categories": categories_out,
        "milestones": {"open": milestones_open},
        "total_actionable": total_actionable,
        "computed_at": now.isoformat(),
    }


# ---------------------------------------------------------------------------
# Convenience producers — the three new signal types added in iter155/P3.
# ---------------------------------------------------------------------------
#
# These are thin wrappers around create_signal so producer code stays
# consistent and the case_key / priority / category conventions are in
# one place.

async def raise_member_complaint(
    db: Any,
    *,
    report_id: str,
    reporter_id: Optional[str],
    target_user_id: Optional[str],
    target_type: str,
    target_id: Optional[str],
    reason: str,
    notes: str,
    reporter_name: Optional[str] = None,
    target_name: Optional[str] = None,
    priority: str = "P2",
    urgent: bool = False,
    triage_fn: Optional[Any] = None,
    origin: Optional[str] = None,
) -> None:
    """Raise a Bridge Signal for a member-on-member report.

    Called from POST /api/reports. Best-effort — never blocks report
    persistence. Dedupes on ``member_complaint:<target_user_id>`` so all
    reports against the same person collapse into one Case, which is
    exactly what admins want (one row per member under review, all
    contributing reports listed inside).
    """
    from .signals import create_signal

    p = "P1" if urgent else priority
    key_target = target_user_id or target_id or report_id
    body = (
        f"Reporter: {reporter_name or reporter_id or '(anonymous)'}\n"
        f"Target:   {target_name or target_user_id or '(unknown)'}\n"
        f"Target kind: {target_type}\n"
        f"Reason:   {reason}\n\n"
        f"{notes[:2000]}"
    )
    resolved_origin = origin or default_origin_for(reason, notes)
    await create_signal(
        db,
        producer="member_complaint",
        entity_ref={"kind": "member_complaint", "id": report_id},
        subject=f"Complaint about {target_name or target_user_id or 'a member'}: {reason}"[:120],
        body=body[:4000],
        category="attention",
        priority=p,
        case_key=f"member_complaint:{key_target}",
        source="user_report",
        origin=resolved_origin,
        injection_check_fields=[reason, notes],
        triage_fn=triage_fn,
    )


async def raise_safety_review(
    db: Any,
    *,
    target_user_id: str,
    action: str,   # 'auto_hide' | 'auto_restrict' | 'ban_appeal' | 'manual_review'
    reason: str,
    triggered_by: str = "system",
    unique_reporters: int = 0,
    priority: str = "P1",
    triage_fn: Optional[Any] = None,
) -> None:
    """Raise a Bridge Signal for an auto-triggered safety action or a
    ban-appeal / manual safety review. Dedupes on target_user_id."""
    from .signals import create_signal

    body = (
        f"Action: {action}\n"
        f"Target: {target_user_id}\n"
        f"Triggered by: {triggered_by}\n"
        f"Unique reporters: {unique_reporters}\n\n"
        f"{reason[:2000]}"
    )
    await create_signal(
        db,
        producer="safety_review",
        entity_ref={"kind": "user", "id": target_user_id},
        subject=f"Safety review needed: {action.replace('_',' ')} ({reason[:60]})"[:120],
        body=body[:4000],
        category="risk",
        priority=priority,
        case_key=f"safety_review:{target_user_id}",
        source="system" if triggered_by == "system" else "user_report",
        origin="production",
        injection_check_fields=[reason],
        triage_fn=triage_fn,
    )


async def raise_app_feedback(
    db: Any,
    *,
    feedback_id: str,
    user_id: Optional[str],
    user_name: Optional[str],
    category: str,             # 'bug' | 'idea' | 'praise' | 'other'
    subject: str,
    message: str,
    app_version: Optional[str] = None,
    platform: Optional[str] = None,
    priority: str = "P3",
    triage_fn: Optional[Any] = None,
    origin: Optional[str] = None,
) -> None:
    """Raise a Bridge Signal for user-submitted app feedback."""
    from .signals import create_signal

    body = (
        f"From: {user_name or user_id or '(anonymous)'}\n"
        f"Category: {category}\n"
        f"Platform: {platform or '-'}   Version: {app_version or '-'}\n\n"
        f"{message[:2500]}"
    )
    resolved_origin = origin or default_origin_for(subject, message)
    await create_signal(
        db,
        producer="app_feedback",
        entity_ref={"kind": "app_feedback", "id": feedback_id},
        subject=f"App feedback [{category}]: {subject[:80]}"[:120],
        body=body[:4000],
        category="housekeeping" if category in ("idea", "praise", "other") else "attention",
        priority=priority,
        case_key=f"app_feedback:{feedback_id}",
        source="user_report",
        origin=resolved_origin,
        injection_check_fields=[subject, message],
        triage_fn=triage_fn,
    )
