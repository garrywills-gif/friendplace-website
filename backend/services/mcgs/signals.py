"""MCGS Signals + Cases service.

Signals are the atom of MCGS: any moment where a human needs to look,
decide, or feel proud. Signals never fire alone for the same incident;
they group into Cases via deterministic ``case_key`` deduplication.

This module owns:

* Creating Signals and attaching them to (or opening) a Case.
* The Signal / Case state machine and its audit trail.
* Assignment.
* Read helpers used by the API layer (list / get / counts).

George triage is intentionally a *pluggable* hook (``triage_fn``). The
stub is deterministic so the whole Signals pipeline is testable in
Milestone A without any LLM calls. The real Haiku triage lands in
Milestone B.

Design refs:
- ``/app/memory/mcgs-architecture.md`` (v3)
- ``/app/memory/mcgs-phase1-plan.md``
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional

from .audit import log_activity
from .events import signal_events

log = logging.getLogger("friendplace.mcgs.signals")


# ---------------------------------------------------------------------------
# Enums & constants
# ---------------------------------------------------------------------------

# Priorities ordered low weight = high priority (P0 sorts first).
PRIORITY_ORDER = {"P0": 0, "P1": 1, "P2": 2, "P3": 3, "P4": 4}

# Human-facing labels George uses when speaking to admins. Never surface
# raw "P0"/"P1" shorthand in conversation — always use these. See the
# George system prompt (services/george/prompt.py) for the guidance rule.
PRIORITY_LABELS = {
    "P0": "critical",
    "P1": "high-priority",
    "P2": "normal-priority",
    "P3": "low-priority",
    "P4": "informational",
}


def priority_label(code: str | None) -> str:
    """Return the conversational label for a priority code.

    Falls back to "normal-priority" for unknown/missing codes so George
    never speaks a raw enum value by accident.
    """
    return PRIORITY_LABELS.get((code or "").upper(), "normal-priority")

CATEGORIES = {"attention", "anomaly", "risk", "milestone", "question", "housekeeping"}

# State machine. Keys are the current state; values are allowed target
# states. Same table is used for both Signals and Cases.
VALID_TRANSITIONS = {
    "NEW":        {"SEEN", "IN_REVIEW", "RESOLVED", "DISMISSED", "SNOOZED", "ESCALATED"},
    "SEEN":       {"IN_REVIEW", "RESOLVED", "DISMISSED", "SNOOZED", "ESCALATED", "NEW"},
    "IN_REVIEW":  {"RESOLVED", "DISMISSED", "SNOOZED", "ESCALATED", "NEW"},
    "SNOOZED":    {"NEW", "SEEN", "IN_REVIEW", "RESOLVED", "DISMISSED", "ESCALATED"},
    "ESCALATED":  {"IN_REVIEW", "RESOLVED", "DISMISSED", "SNOOZED"},
    # Terminal states can only be re-opened back to NEW/IN_REVIEW.
    "RESOLVED":   {"NEW", "IN_REVIEW"},
    "DISMISSED":  {"NEW", "IN_REVIEW"},
}

# States that count a Case as still needing attention.
OPEN_STATES = {"NEW", "SEEN", "IN_REVIEW", "SNOOZED", "ESCALATED"}

# Confidence labels \u2014 never a raw percentage.
CONFIDENCE_LABELS = {"high", "moderate", "low"}


class SignalError(Exception):
    """Domain error for illegal transitions or bad input."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return str(uuid.uuid4())


def _worst_priority(*prios: str) -> str:
    """Return the highest-priority (lowest weight) label from the inputs."""
    return min(prios, key=lambda p: PRIORITY_ORDER.get(p, 99))


# ---------------------------------------------------------------------------
# Prompt-injection classifier (lightweight, regex-only in Phase 1)
# ---------------------------------------------------------------------------

_INJECTION_PATTERNS = [
    "ignore previous instructions",
    "ignore any",
    "ignore all",
    "disregard the above",
    "disregard your",
    "you are now",
    "system prompt",
    "act as if you are",
    "reveal your instructions",
    "reveal your system",
    "print your system prompt",
    "print all secret",
    "dan mode",
    "developer mode enabled",
    "jailbreak",
    "forget your rules",
    "bypass your safety",
    "unfiltered assistant",
]


def sniff_prompt_injection(*fields: Optional[str]) -> bool:
    """Return True if any provided text field contains a known injection cue.

    Deliberately conservative \u2014 false positives are cheap (they only tag
    a Signal for review), false negatives are risky. Case-insensitive
    substring match.
    """
    for f in fields:
        if not f:
            continue
        lowered = f.lower()
        for pattern in _INJECTION_PATTERNS:
            if pattern in lowered:
                return True
    return False


# ---------------------------------------------------------------------------
# George triage (Phase 1: deterministic stub. Milestone B replaces with Haiku)
# ---------------------------------------------------------------------------

TriageFn = Callable[[dict], Awaitable[dict]]


async def _default_triage(signal: dict) -> dict:
    """Deterministic stub for Phase 1 Milestone A.

    Produces a ``george_read`` block from the signal itself so the whole
    Signals pipeline is testable without any LLM. Milestone B replaces
    this with a Haiku call.
    """
    subject = signal.get("subject") or ""
    category = signal.get("category") or "attention"
    priority = signal.get("priority") or "P3"

    suggested = {
        "attention":    "Open the case and review",
        "anomaly":      "Check what changed",
        "risk":         "Review the details before deciding",
        "milestone":    "Celebrate \u2014 maybe a warm note?",
        "question":     "Answer or route the question",
        "housekeeping": "Tidy this up when you have a moment",
    }.get(category, "Have a look")

    confidence = "moderate" if priority in {"P0", "P1"} else "low"

    return {
        "tldr": subject[:240] or f"A new {category} signal.",
        "suggested_action": suggested,
        "confidence": confidence,
        "reasoning": "Automated stub triage until George is wired.",\
        "model": "stub-v1",
        "generated_at": _now_iso(),\
    }


# ---------------------------------------------------------------------------
# Case + Signal creation
# ---------------------------------------------------------------------------

async def create_signal(
    db: Any,
    *,\
    producer: str,\
    entity_ref: dict,\
    subject: str,\
    body: str,\
    category: str,\
    priority: str,\
    case_key: str,\
    source: str = "system",\
    region: Optional[str] = None,\
    triage_fn: TriageFn = _default_triage,\
    injection_check_fields: Optional[list[str]] = None,\
    origin: str = "production",\
) -> dict:
    """Create a Signal, attaching to an existing open Case or opening one.

    ``origin`` marks whether this is production traffic, seed/demo content,
    an automated test fixture or a diagnostic. Bridge queries filter by
    ``origin='production'`` explicitly so nothing else leaks into the live
    operational count. Allowed values: ``production``, ``seed``, ``test``,
    ``diagnostic``.

    Idempotency: if an open Signal with the same ``(producer, entity_ref)``
    already exists on the target Case, the existing Signal is returned
    unchanged. This lets producer callers be safely re-run (e.g. after a
    webhook retry) without spamming the Feed.
    """
    if category not in CATEGORIES:
        raise SignalError(f"unknown category: {category}")
    if priority not in PRIORITY_ORDER:
        raise SignalError(f"unknown priority: {priority}")
    if origin not in {"production", "seed", "test", "diagnostic"}:
        raise SignalError(f"unknown origin: {origin}")

    now = _now_iso()
    prompt_injection_suspected = sniff_prompt_injection(*(injection_check_fields or [body]))

    # Look up an existing OPEN Case with this key.
    case = await db.mcgs_cases.find_one(
        {"case_key": case_key, "status": {"$in": list(OPEN_STATES)}},
        {"_id": 0},
    )

    if case is None:
        # New Case.
        case_id = _new_id()
        case = {
            "id": case_id,
            "case_key": case_key,
            "subject": subject,
            "category": category,
            "priority": priority,
            "status": "NEW",
            "signal_ids": [],
            "assignee_id": None,
            "first_signal_at": now,
            "last_signal_at": now,
            "resolved_at": None,
            "resolved_by": None,
            "resolved_action": None,
            "george_read": None,
            "created_at": now,
            "updated_at": now,
            "region": region,
            "origin": origin,
        }
        await db.mcgs_cases.insert_one(dict(case))
        await log_activity(
            db,
            actor_id=None,
            actor_kind="system",
            action="case.create",
            entity_ref={"kind": "case", "id": case_id},
            after={"case_key": case_key, "priority": priority, "category": category},
            case_id=case_id,
            channel="api",
        )
    else:
        case_id = case["id"]
        # Idempotency: same producer+entity already open on this Case?
        existing = await db.mcgs_signals.find_one(
            {
                "case_id": case_id,
                "producer": producer,
                "entity_ref.kind": entity_ref.get("kind"),
                "entity_ref.id": entity_ref.get("id"),
                "status": {"$in": list(OPEN_STATES)},
            },
            {"_id": 0},
        )
        if existing:
            return existing

    # Create the Signal itself.
    signal_id = _new_id()
    signal = {
        "id": signal_id,
        "case_id": case_id,
        "category": category,
        "priority": priority,
        "subject": subject,
        "body": body,
        "source": source,
        "producer": producer,
        "entity_ref": dict(entity_ref),
        "george_read": None,       # populated below
        "status": "NEW",
        "assignee_id": None,
        "snoozed_until": None,
        "resolved_action": None,
        "channels_fired": [],
        "channels_available": ["toast", "push", "email", "sms"],
        "state_transitions": [{
            "from": None, "to": "NEW", "at": now,
            "actor_id": None, "actor_kind": "system",
            "via_channel": "api", "notes": "signal created",
        }],
        "prompt_injection_suspected": prompt_injection_suspected,
        "region": region,
        "origin": origin,
        "created_at": now,
        "updated_at": now,
    }
    # Triage \u2014 pluggable so Milestone B can swap in Haiku without touching callers.
    try:
        signal["george_read"] = await triage_fn(signal)
    except Exception:
        log.exception("triage_fn failed for signal %s (producer=%s)", signal_id, producer)
        signal["george_read"] = None

    await db.mcgs_signals.insert_one(dict(signal))

    # Attach to the Case and recompute Case priority (max = worst).
    new_case_priority = _worst_priority(case["priority"], priority)
    updates = {
        "$push": {"signal_ids": signal_id},
        "$set": {
            "last_signal_at": now,
            "updated_at": now,
            "priority": new_case_priority,
            "george_read": signal["george_read"],   # freshest triage represents the Case
            # Subject: prefer the earliest one so it stays stable, but update category if empty.
        },
    }
    await db.mcgs_cases.update_one({"id": case_id}, updates)

    await log_activity(
        db,
        actor_id=None,
        actor_kind="system",
        action="signal.create",
        entity_ref={"kind": "signal", "id": signal_id},
        after={
            "case_id": case_id, "priority": priority,
            "category": category, "producer": producer,
        },
        case_id=case_id,
        channel="api",
    )

    # Publish to the channel-agnostic Signal event bus. Any subscriber
    # (SSE, push worker, email worker, mobile bridge...) sees this.
    try:
        await signal_events.publish(
            "signal.created", signal=signal, case_id=case_id,
        )
    except Exception:
        log.exception("event bus publish failed for signal %s", signal_id)

    return signal


# ---------------------------------------------------------------------------
# State transitions
# ---------------------------------------------------------------------------

async def transition_signal(
    db: Any,
    *,
    signal_id: str,
    to_state: str,
    actor_id: Optional[str],
    actor_kind: str = "human",
    notes: Optional[str] = None,
    via_channel: str = "bridge",
    snoozed_until: Optional[str] = None,
    resolved_action: Optional[str] = None,
) -> dict:
    """Move a Signal to a new state. Enforces the state machine + writes audit."""
    signal = await db.mcgs_signals.find_one({"id": signal_id}, {"_id": 0})
    if not signal:
        raise SignalError(f"signal not found: {signal_id}")

    from_state = signal["status"]
    if to_state not in VALID_TRANSITIONS.get(from_state, set()):
        raise SignalError(f"illegal transition {from_state} -> {to_state}")

    now = _now_iso()
    transition = {
        "from": from_state, "to": to_state, "at": now,
        "actor_id": actor_id, "actor_kind": actor_kind,
        "via_channel": via_channel, "notes": notes,
    }
    updates: dict = {
        "$set": {"status": to_state, "updated_at": now},
        "$push": {"state_transitions": transition},
    }
    if to_state == "SNOOZED" and snoozed_until:
        updates["$set"]["snoozed_until"] = snoozed_until
    if to_state in {"RESOLVED", "DISMISSED"} and resolved_action:
        updates["$set"]["resolved_action"] = resolved_action

    await db.mcgs_signals.update_one({"id": signal_id}, updates)

    await log_activity(
        db,
        actor_id=actor_id,
        actor_kind=actor_kind,
        action=f"signal.{to_state.lower()}",
        entity_ref={"kind": "signal", "id": signal_id},
        before={"status": from_state},
        after={"status": to_state, "resolved_action": resolved_action},
        case_id=signal.get("case_id"),
        channel=via_channel,
        notes=notes,
    )

    updated = {**signal, **updates["$set"], "state_transitions": signal["state_transitions"] + [transition]}
    try:
        await signal_events.publish(
            "signal.updated", signal=updated, case_id=signal.get("case_id"),
        )
    except Exception:
        log.exception("event bus publish failed for signal %s", signal_id)
    return updated


async def transition_case(
    db: Any,
    *,
    case_id: str,
    to_state: str,
    actor_id: Optional[str],
    actor_kind: str = "human",
    notes: Optional[str] = None,
    via_channel: str = "bridge",
    resolved_action: Optional[str] = None,
    cascade_to_signals: bool = True,
) -> dict:
    """Move a Case (and optionally its attached Signals) to a new state."""
    case = await db.mcgs_cases.find_one({"id": case_id}, {"_id": 0})
    if not case:
        raise SignalError(f"case not found: {case_id}")

    from_state = case["status"]
    if to_state not in VALID_TRANSITIONS.get(from_state, set()):
        raise SignalError(f"illegal transition {from_state} -> {to_state}")

    now = _now_iso()
    case_updates = {
        "$set": {
            "status": to_state,
            "updated_at": now,
        }
    }
    if to_state == "RESOLVED":
        case_updates["$set"]["resolved_at"] = now
        case_updates["$set"]["resolved_by"] = actor_id
        case_updates["$set"]["resolved_action"] = resolved_action

    await db.mcgs_cases.update_one({"id": case_id}, case_updates)

    await log_activity(
        db,
        actor_id=actor_id,
        actor_kind=actor_kind,
        action=f"case.{to_state.lower()}",
        entity_ref={"kind": "case", "id": case_id},
        before={"status": from_state},
        after={"status": to_state, "resolved_action": resolved_action},
        case_id=case_id,
        channel=via_channel,
        notes=notes,
    )

    if cascade_to_signals and to_state in {"RESOLVED", "DISMISSED"}:
        # Move any still-open Signals in this Case to the same terminal state.
        open_sigs = await db.mcgs_signals.find(
            {"case_id": case_id, "status": {"$in": list(OPEN_STATES)}},
            {"_id": 0, "id": 1, "status": 1},
        ).to_list(500)
        for s in open_sigs:
            try:
                await transition_signal(
                    db,
                    signal_id=s["id"],
                    to_state=to_state,
                    actor_id=actor_id,
                    actor_kind=actor_kind,
                    via_channel=via_channel,
                    notes=f"cascade from case.{to_state.lower()}",
                    resolved_action=resolved_action,
                )
            except SignalError:
                # Illegal cascade (rare) shouldn't block Case closure.
                log.warning("cascade skipped for signal %s", s["id"])

    updated = {**case, **case_updates["$set"]}
    try:
        await signal_events.publish("case.updated", case=updated)
    except Exception:
        log.exception("event bus publish failed for case %s", case_id)
    return updated


async def assign_case(
    db: Any,
    *,
    case_id: str,
    assignee_id: Optional[str],
    actor_id: Optional[str],
    actor_kind: str = "human",
    via_channel: str = "bridge",
) -> dict:
    """Set (or clear) the assignee on a Case."""
    case = await db.mcgs_cases.find_one({"id": case_id}, {"_id": 0})
    if not case:
        raise SignalError(f"case not found: {case_id}")

    now = _now_iso()
    await db.mcgs_cases.update_one(
        {"id": case_id},
        {"$set": {"assignee_id": assignee_id, "updated_at": now}},
    )
    await log_activity(
        db,
        actor_id=actor_id,
        actor_kind=actor_kind,
        action="case.assign",
        entity_ref={"kind": "case", "id": case_id},
        before={"assignee_id": case.get("assignee_id")},
        after={"assignee_id": assignee_id},
        case_id=case_id,
        channel=via_channel,
    )
    updated = {**case, "assignee_id": assignee_id, "updated_at": now}
    try:
        await signal_events.publish("case.assigned", case=updated)
    except Exception:
        log.exception("event bus publish failed for case %s", case_id)
    return updated


# ---------------------------------------------------------------------------
# Read helpers (used by API layer in step 5)
# ---------------------------------------------------------------------------

async def get_signal(db: Any, signal_id: str) -> Optional[dict]:
    return await db.mcgs_signals.find_one({"id": signal_id}, {"_id": 0})


async def get_case(db: Any, case_id: str) -> Optional[dict]:
    case = await db.mcgs_cases.find_one({"id": case_id}, {"_id": 0})
    if not case:
        return None
    # Hydrate attached signals for detail view.
    signals = await db.mcgs_signals.find(
        {"case_id": case_id}, {"_id": 0},
    ).sort("created_at", -1).to_list(200)
    case["signals"] = signals
    return case


async def list_signals(
    db: Any,
    *,
    status: Optional[list[str]] = None,
    priority: Optional[list[str]] = None,
    category: Optional[list[str]] = None,
    assignee_id: Optional[str] = None,
    origin: Optional[list[str]] = None,
    producer: Optional[list[str]] = None,
    limit: int = 50,
) -> list[dict]:
    q: dict = {}
    if status:
        q["status"] = {"$in": status}
    else:
        # Default: exclude terminal states.
        q["status"] = {"$in": list(OPEN_STATES)}
    if priority:
        q["priority"] = {"$in": priority}
    if category:
        q["category"] = {"$in": category}
    if assignee_id is not None:
        q["assignee_id"] = assignee_id
    if producer:
        q["producer"] = {"$in": producer}
    # Origin filter defaults to production-only. Callers wanting to include
    # seed/test/diagnostic rows must pass origin=["production","test",...]
    # or origin=["*"] explicitly. This is *strict* by design so no
    # unlabelled test row can leak back into live operational counts.
    if origin is None:
        q["origin"] = "production"
    elif origin and "*" not in origin:
        q["origin"] = {"$in": origin}
    # Priority ASC (P0 first via numeric field), then recency DESC.
    cur = db.mcgs_signals.find(q, {"_id": 0}).sort([("priority", 1), ("created_at", -1)])
    return await cur.to_list(max(1, min(200, limit)))


async def list_cases(
    db: Any,
    *,
    status: Optional[list[str]] = None,
    priority: Optional[list[str]] = None,
    category: Optional[list[str]] = None,
    assignee_id: Optional[str] = None,
    origin: Optional[list[str]] = None,
    producer: Optional[list[str]] = None,
    limit: int = 50,
) -> list[dict]:
    q: dict = {}
    if status:
        q["status"] = {"$in": status}
    else:
        q["status"] = {"$in": list(OPEN_STATES)}
    if priority:
        q["priority"] = {"$in": priority}
    if category:
        q["category"] = {"$in": category}
    if assignee_id is not None:
        q["assignee_id"] = assignee_id
    if origin is None:
        q["origin"] = "production"
    elif origin and "*" not in origin:
        q["origin"] = {"$in": origin}
    if producer:
        # Cases don't carry producer directly. Derive the set of case_ids
        # from signals matching the producer filter, then constrain the
        # case query. Case_key prefix is a shorthand fallback for stable
        # 1:1 producer→prefix mapping but we prefer the signal join.
        sig_ids = await db.mcgs_signals.distinct(
            "case_id", {"producer": {"$in": producer}},
        )
        q["id"] = {"$in": sig_ids}
    cur = db.mcgs_cases.find(q, {"_id": 0}).sort([("priority", 1), ("updated_at", -1)])
    return await cur.to_list(max(1, min(200, limit)))


async def compute_counts(db: Any) -> dict:
    """Compute the single-doc hot counts cache.

    Called on demand + writes ``mcgs_counts`` for the Bridge sidebar badges.
    All counts are ``origin='production'`` only — seed/test/diagnostic
    rows are archived elsewhere and never contaminate the live queue.
    """
    prod_filter = {"origin": "production"}
    signals_open = await db.mcgs_signals.count_documents({
        "status": {"$in": list(OPEN_STATES)}, **prod_filter,
    })
    signals_new = await db.mcgs_signals.count_documents({
        "status": "NEW", **prod_filter,
    })
    signals_in_review = await db.mcgs_signals.count_documents({
        "status": "IN_REVIEW", **prod_filter,
    })
    cases_open = await db.mcgs_cases.count_documents({
        "status": {"$in": list(OPEN_STATES)}, **prod_filter,
    })
    # Actionable open signals: exclude milestone signals (informational).
    signals_actionable = await db.mcgs_signals.count_documents({
        "status": {"$in": list(OPEN_STATES)},
        "producer": {"$ne": "milestones"},
        **prod_filter,
    })
    milestones_open = await db.mcgs_signals.count_documents({
        "status": {"$in": list(OPEN_STATES)},
        "producer": "milestones",
        **prod_filter,
    })

    # Per-producer open cases (for sidebar badges) — production only.
    per_producer: dict[str, int] = {}
    async for row in db.mcgs_signals.aggregate([
        {"$match": {"status": {"$in": list(OPEN_STATES)}, **prod_filter}},
        {"$group": {"_id": "$producer", "n": {"$sum": 1}}},
    ]):
        if row.get("_id"):
            per_producer[row["_id"]] = int(row.get("n") or 0)

    doc = {
        "id": "mcgs_counts",
        "signals": {
            "open": signals_open,
            "new": signals_new,
            "in_review": signals_in_review,
            "actionable": signals_actionable,
            "milestones": milestones_open,
        },
        "cases": {"open": cases_open},
        "per_producer": per_producer,
        "computed_at": _now_iso(),
    }
    await db.mcgs_counts.update_one({"id": "mcgs_counts"}, {"$set": doc}, upsert=True)
    return doc


# ---------------------------------------------------------------------------
# Index setup
# ---------------------------------------------------------------------------

async def ensure_indexes(db: Any) -> None:
    """Create/refresh indexes for `mcgs_signals` and `mcgs_cases`. Idempotent."""
    from .audit import ensure_indexes as _audit_indexes
    await _audit_indexes(db)

    sig = db.mcgs_signals
    await sig.create_index([("status", 1), ("priority", 1), ("created_at", -1)])
    await sig.create_index([("case_id", 1)])
    await sig.create_index([("assignee_id", 1), ("status", 1)])
    await sig.create_index([("producer", 1), ("entity_ref.kind", 1), ("entity_ref.id", 1)])
    await sig.create_index([("prompt_injection_suspected", 1)])

    cases = db.mcgs_cases
    await cases.create_index([("case_key", 1), ("status", 1)])
    await cases.create_index([("status", 1), ("priority", 1), ("updated_at", -1)])
    await cases.create_index([("assignee_id", 1), ("status", 1)])
