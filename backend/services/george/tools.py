"""George's read-only tool allow-list.

Every tool has a declared JSON schema (arguments validated before
execution), a required role floor, and a deterministic Python
implementation. No free-form queries. No write tools \u2014 write actions
live in an Action Preview surfaced to the admin (Phase 1 Milestone D).

The planner (Haiku) sees the ``PLANNER_SCHEMA`` list of tool names +
argument summaries; the executor runs the chosen tool against Mongo
via ``execute_tool``. Tool output is compact and fed to the synthesizer
(Sonnet) as evidence inside a ``<tool_results>`` block.

Design refs:
- ``/app/memory/mcgs-phase1-plan.md`` \u00a74.2
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from services.mcgs.signals import OPEN_STATES, PRIORITY_ORDER

log = logging.getLogger("friendplace.george.tools")


class ToolError(Exception):
    """Validation error for a tool call."""


# ---------------------------------------------------------------------------
# Test-data exclusion filter (Batch 4)
# ---------------------------------------------------------------------------
#
# Garry's rule (Batch-3 QA feedback, Jul 2026):
#   "George's operational summaries should never include obvious test
#    artefacts. Prefer a dedicated flag (is_test / environment='test')
#    over subject-name pattern matching."
#
# Every future test / seed / fixture inserts records with `is_test: True`
# (see /app/backend/tests/conftest.py -> apply_test_marker). To keep
# older-style seed rows out of George's view too, we also fall back to
# a conservative subject-pattern regex \u2014 interim measure until every
# fixture has been migrated to the explicit flag.
#
# Any tool that queries an operational collection MUST call
# ``exclude_test_data(q)`` on its query before hitting Mongo, unless the
# caller explicitly asked for `include_test_data: True`.

_LEGACY_TEST_SUBJECT_RE = re.compile(
    r"^(?:"
    r"TEST[_\-\s]|"
    r"PROP[_\-]|"
    r"Proposal test PROP[_\-]|"
    r"SSE (?:test|stream test)|"
    r"MCGS (?:phase1 e2e|smoke test)|"
    r"Test ticket[\s\-]|"
    r"Iteration \d+|"
    r"iter\d+[_\-]|"
    r"Test [AB] - |"
    r"Testing user acknowledgement|"
    r"Preview of updated ack email"
    r")",
    re.IGNORECASE,
)


def exclude_test_data(query: dict, subject_field: str | None = None) -> dict:
    """Augment a Mongo query so test-flagged / legacy-test rows are
    excluded. Returns the (mutated) query for chaining convenience.

    - Any doc with ``is_test: True`` (or a future ``environment: "test"``)
      is filtered out.
    - If ``subject_field`` is given, docs whose subject matches the
      legacy test-pattern regex are also excluded \u2014 defensive layer
      until every fixture has been migrated to the explicit flag.
    """
    # Preserve any pre-existing $and clauses.
    conditions = list(query.pop("$and", [])) if "$and" in query else []
    conditions.append({"is_test": {"$ne": True}})
    conditions.append({"environment": {"$ne": "test"}})

    if subject_field:
        # Subject either doesn't exist, or exists and doesn't match the
        # legacy pattern. `$not` with a regex is the Mongo idiom.
        conditions.append({
            "$or": [
                {subject_field: {"$exists": False}},
                {subject_field: None},
                {subject_field: {"$not": _LEGACY_TEST_SUBJECT_RE}},
            ]
        })

    query["$and"] = conditions
    return query


def _should_include_test_data(args: dict) -> bool:
    """Explicit opt-in so an admin can still ask George
    "how many test tickets are there?" without the filter."""
    return bool(args.get("include_test_data"))


# ---------------------------------------------------------------------------
# Tool registry
# ---------------------------------------------------------------------------

# Each entry: name -> {description, args, min_role, run}
# `args` is a dict of name -> {type, required, enum?}.
# `run(db, args)` is an async function returning a JSON-serialisable value.

TOOL_REGISTRY: dict[str, dict[str, Any]] = {}


def register(name: str, description: str, args: dict, min_role: str = "read_only"):
    """Decorator to add a tool to the registry."""
    def _wrap(fn):
        TOOL_REGISTRY[name] = {
            "name": name,
            "description": description,
            "args": args,
            "min_role": min_role,
            "run": fn,
        }
        return fn
    return _wrap


# ---------------------------------------------------------------------------
# Argument validation
# ---------------------------------------------------------------------------

_ALLOWED_STATUSES = {"NEW", "SEEN", "IN_REVIEW", "SNOOZED", "ESCALATED", "RESOLVED", "DISMISSED"}
_ALLOWED_PRIORITIES = set(PRIORITY_ORDER.keys())


def _validate_args(name: str, args: dict, spec: dict) -> dict:
    """Enforce type + enum + required against the tool's schema."""
    cleaned: dict[str, Any] = {}
    if not isinstance(args, dict):
        raise ToolError(f"{name}: args must be a dict")
    for key, meta in spec.items():
        val = args.get(key)
        if val is None:
            if meta.get("required"):
                raise ToolError(f"{name}: missing required arg '{key}'")
            continue
        typ = meta.get("type")
        if typ == "int":
            try:
                val = int(val)
            except Exception as exc:
                raise ToolError(f"{name}: arg '{key}' must be int") from exc
        elif typ == "str":
            if not isinstance(val, str):
                raise ToolError(f"{name}: arg '{key}' must be str")
        elif typ == "list[str]":
            if not isinstance(val, list) or not all(isinstance(x, str) for x in val):
                raise ToolError(f"{name}: arg '{key}' must be list[str]")
        elif typ == "iso_date":
            if not isinstance(val, str):
                raise ToolError(f"{name}: arg '{key}' must be an ISO date string")
        elif typ == "bool":
            if not isinstance(val, bool):
                raise ToolError(f"{name}: arg '{key}' must be bool")
        enum = meta.get("enum")
        if enum is not None:
            values = val if isinstance(val, list) else [val]
            for v in values:
                if v not in enum:
                    raise ToolError(f"{name}: '{v}' not in {sorted(enum)}")
        cleaned[key] = val
    # Reject unknown args entirely to prevent smuggling.
    unknown = set(args) - set(spec)
    if unknown:
        raise ToolError(f"{name}: unknown args {sorted(unknown)}")
    return cleaned


# ---------------------------------------------------------------------------
# Signals & Cases tools
# ---------------------------------------------------------------------------

@register(
    "count_signals",
    "Count Signals filtered by producer/status/priority/category. Returns a single integer. Test-flagged rows are excluded by default; pass include_test_data=true to opt back in.",
    args={
        "producer": {"type": "str", "required": False},
        "status":   {"type": "list[str]", "required": False, "enum": _ALLOWED_STATUSES},
        "priority": {"type": "list[str]", "required": False, "enum": _ALLOWED_PRIORITIES},
        "category": {"type": "list[str]", "required": False,
                     "enum": {"attention", "anomaly", "risk", "milestone", "question", "housekeeping"}},
        "include_test_data": {"type": "bool", "required": False},
    },
)
async def _count_signals(db: Any, args: dict) -> int:
    q: dict = {}
    if "producer" in args:
        q["producer"] = args["producer"]
    q["status"] = {"$in": args["status"]} if "status" in args else {"$in": list(OPEN_STATES)}
    if "priority" in args:
        q["priority"] = {"$in": args["priority"]}
    if "category" in args:
        q["category"] = {"$in": args["category"]}
    if not _should_include_test_data(args):
        exclude_test_data(q, subject_field="subject")
    return await db.mcgs_signals.count_documents(q)


@register(
    "list_signals",
    "List Signals (compact rows). Sorted priority then recency. Default limit 10. Test-flagged rows are excluded by default.",
    args={
        "producer": {"type": "str", "required": False},
        "status":   {"type": "list[str]", "required": False, "enum": _ALLOWED_STATUSES},
        "priority": {"type": "list[str]", "required": False, "enum": _ALLOWED_PRIORITIES},
        "limit":    {"type": "int", "required": False},
        "include_test_data": {"type": "bool", "required": False},
    },
)
async def _list_signals(db: Any, args: dict) -> list[dict]:
    q: dict = {}
    if "producer" in args:
        q["producer"] = args["producer"]
    q["status"] = {"$in": args["status"]} if "status" in args else {"$in": list(OPEN_STATES)}
    if "priority" in args:
        q["priority"] = {"$in": args["priority"]}
    if not _should_include_test_data(args):
        exclude_test_data(q, subject_field="subject")
    limit = max(1, min(int(args.get("limit") or 10), 25))
    rows = await db.mcgs_signals.find(
        q,
        {"_id": 0, "id": 1, "priority": 1, "status": 1, "subject": 1,
         "producer": 1, "created_at": 1, "case_id": 1},
    ).sort([("priority", 1), ("created_at", -1)]).to_list(limit)
    return rows


@register(
    "count_cases",
    "Count Cases (grouped Signals) filtered by producer/status/priority. Test-flagged rows are excluded by default.",
    args={
        "producer": {"type": "str", "required": False},
        "status":   {"type": "list[str]", "required": False, "enum": _ALLOWED_STATUSES},
        "priority": {"type": "list[str]", "required": False, "enum": _ALLOWED_PRIORITIES},
        "include_test_data": {"type": "bool", "required": False},
    },
)
async def _count_cases(db: Any, args: dict) -> int:
    q: dict = {}
    if "producer" in args:
        signal_q: dict = {"producer": args["producer"]}
        if not _should_include_test_data(args):
            exclude_test_data(signal_q, subject_field="subject")
        signal_ids = await db.mcgs_signals.distinct("case_id", signal_q)
        q["id"] = {"$in": signal_ids}
    q["status"] = {"$in": args["status"]} if "status" in args else {"$in": list(OPEN_STATES)}
    if "priority" in args:
        q["priority"] = {"$in": args["priority"]}
    if not _should_include_test_data(args):
        exclude_test_data(q)
    return await db.mcgs_cases.count_documents(q)


# ---------------------------------------------------------------------------
# Events tools
# ---------------------------------------------------------------------------

@register(
    "count_event_submissions",
    "Count community event submissions by status. Test-flagged rows are excluded by default.",
    args={
        "status": {"type": "str", "required": False,
                   "enum": {"pending", "approved", "rejected", "changes_requested"}},
        "include_test_data": {"type": "bool", "required": False},
    },
)
async def _count_event_submissions(db: Any, args: dict) -> int:
    q: dict = {"status": args.get("status", "pending")}
    if not _should_include_test_data(args):
        exclude_test_data(q, subject_field="title")
    return await db.cms_event_submissions.count_documents(q)


@register(
    "count_published_events",
    "Count published CMS events, optionally within a date range (YYYY-MM-DD). Test-flagged rows are excluded by default.",
    args={
        "from_date": {"type": "iso_date", "required": False},
        "to_date":   {"type": "iso_date", "required": False},
        "include_test_data": {"type": "bool", "required": False},
    },
)
async def _count_published_events(db: Any, args: dict) -> int:
    q: dict[str, Any] = {"status": "published"}
    date_q: dict[str, Any] = {}
    if "from_date" in args:
        date_q["$gte"] = args["from_date"]
    if "to_date" in args:
        date_q["$lte"] = args["to_date"]
    if date_q:
        q["start_date"] = date_q
    if not _should_include_test_data(args):
        exclude_test_data(q, subject_field="title")
    return await db.cms_events.count_documents(q)


@register(
    "list_upcoming_events",
    "List the next N published events (default 5). Compact rows. Test-flagged rows are excluded by default.",
    args={
        "limit": {"type": "int", "required": False},
        "include_test_data": {"type": "bool", "required": False},
    },
)
async def _list_upcoming_events(db: Any, args: dict) -> list[dict]:
    limit = max(1, min(int(args.get("limit") or 5), 20))
    today = datetime.now(timezone.utc).date().isoformat()
    q: dict = {"status": "published", "start_date": {"$gte": today}}
    if not _should_include_test_data(args):
        exclude_test_data(q, subject_field="title")
    rows = await db.cms_events.find(
        q,
        {"_id": 0, "id": 1, "title": 1, "start_date": 1, "start_time": 1,
         "location_name": 1, "rsvp_count": 1, "capacity": 1},
    ).sort([("start_date", 1)]).to_list(limit)
    return rows


# ---------------------------------------------------------------------------
# Support tickets
# ---------------------------------------------------------------------------

@register(
    "count_support_tickets",
    "Count support tickets by status. Test-flagged rows are excluded by default; pass include_test_data=true to include them.",
    args={
        "status": {"type": "str", "required": False,
                   "enum": {"open", "in_progress", "resolved", "closed"}},
        "include_test_data": {"type": "bool", "required": False},
    },
)
async def _count_support_tickets(db: Any, args: dict) -> int:
    q: dict = {"status": args.get("status", "open")}
    if not _should_include_test_data(args):
        exclude_test_data(q, subject_field="subject")
    return await db.support_tickets.count_documents(q)


# ---------------------------------------------------------------------------
# Members
# ---------------------------------------------------------------------------

@register(
    "count_members",
    "Count total members, or those who joined within the last N days.",
    args={"since_days": {"type": "int", "required": False}},
)
async def _count_members(db: Any, args: dict) -> int:
    if "since_days" in args:
        cutoff = datetime.now(timezone.utc) - timedelta(days=int(args["since_days"]))
        return await db.users.count_documents({"created_at": {"$gte": cutoff.isoformat()}})
    return await db.users.count_documents({})


# ---------------------------------------------------------------------------
# Organisations
# ---------------------------------------------------------------------------

@register(
    "count_organisations",
    "Count organisations. Optional 'verified' filter (True/False).",
    args={"verified": {"type": "bool", "required": False}},
)
async def _count_organisations(db: Any, args: dict) -> int:
    q = {}
    if "verified" in args:
        q["verified"] = args["verified"]
    return await db.organisations.count_documents(q)


# ---------------------------------------------------------------------------
# Interest registrations (Phase C RYI)
# ---------------------------------------------------------------------------
#
# The `interest_registrations` collection is populated by first-time
# website visitors who leave their name + email on /register-interest.
# It is NOT a marketing mailing list — it's the roll of early friends
# George and Georgia already know by name. These tools let George
# report on them: "how many people registered today?", "who chose to
# meet you?", etc.
#
# Test-flagged rows (`is_test: true`) are excluded by default so QA
# fixtures never inflate the real numbers.

@register(
    "count_interest_registrations",
    "Count website visitors who Registered their Interest (a.k.a. Founding Members). "
    "Filter by status (registered/invited/joined/opted_out — 'registered' also matches "
    "the legacy 'new' status i.e. anyone awaiting contact), companion_choice (george/georgia), "
    "state_country (case-insensitive substring, e.g. 'Sydney', 'NSW', 'Melbourne'), or "
    "since_days for a rolling window (use since_days=1 for 'today', 7 for 'this week'). "
    "Test-flagged rows are excluded by default.",
    args={
        "status": {"type": "str", "required": False,
                   "enum": {"registered", "invited", "joined", "opted_out"}},
        "companion_choice": {"type": "str", "required": False,
                             "enum": {"george", "georgia"}},
        "state_country": {"type": "str", "required": False},
        "since_days": {"type": "int", "required": False},
        "include_test_data": {"type": "bool", "required": False},
    },
)
async def _count_interest_registrations(db: Any, args: dict) -> int:
    q: dict = {}
    if "status" in args:
        if args["status"] == "registered":
            q["$or"] = [
                {"status": {"$exists": False}},
                {"status": None},
                {"status": {"$in": ["registered", "new"]}},
            ]
        else:
            q["status"] = args["status"]
    if "companion_choice" in args:
        q["companion_choice"] = args["companion_choice"]
    if "state_country" in args:
        rx = re.compile(re.escape(args["state_country"]), re.IGNORECASE)
        q["state_country"] = rx
    if "since_days" in args:
        cutoff = datetime.now(timezone.utc) - timedelta(days=int(args["since_days"]))
        q["created_at"] = {"$gte": cutoff.isoformat()}
    if not _should_include_test_data(args):
        q["is_test"] = {"$ne": True}
    return await db.interest_registrations.count_documents(q)


@register(
    "list_interest_registrations",
    "List website visitors who Registered their Interest (a.k.a. Founding Members), "
    "newest first. Returns a small list with first_name, email, state_country, heard_from, "
    "companion_choice, status and created_at. Capped at 50 rows. Same filters as "
    "count_interest_registrations. Use limit=1 to fetch just the most recent registration. "
    "Test-flagged rows are excluded by default.",
    args={
        "status": {"type": "str", "required": False,
                   "enum": {"registered", "invited", "joined", "opted_out"}},
        "companion_choice": {"type": "str", "required": False,
                             "enum": {"george", "georgia"}},
        "state_country": {"type": "str", "required": False},
        "since_days": {"type": "int", "required": False},
        "limit": {"type": "int", "required": False},
        "include_test_data": {"type": "bool", "required": False},
    },
)
async def _list_interest_registrations(db: Any, args: dict) -> list:
    q: dict = {}
    if "status" in args:
        if args["status"] == "registered":
            q["$or"] = [
                {"status": {"$exists": False}},
                {"status": None},
                {"status": {"$in": ["registered", "new"]}},
            ]
        else:
            q["status"] = args["status"]
    if "companion_choice" in args:
        q["companion_choice"] = args["companion_choice"]
    if "state_country" in args:
        rx = re.compile(re.escape(args["state_country"]), re.IGNORECASE)
        q["state_country"] = rx
    if "since_days" in args:
        cutoff = datetime.now(timezone.utc) - timedelta(days=int(args["since_days"]))
        q["created_at"] = {"$gte": cutoff.isoformat()}
    if not _should_include_test_data(args):
        q["is_test"] = {"$ne": True}
    limit = max(1, min(int(args.get("limit") or 20), 50))
    # Public projection — never leak IP or internal metadata to the LLM.
    projection = {
        "_id": 0,
        "id": 1, "first_name": 1, "email": 1,
        "state_country": 1, "heard_from": 1,
        "companion_choice": 1, "status": 1, "created_at": 1,
        "founder_number": 1, "is_reserved": 1,
    }
    rows = await db.interest_registrations.find(q, projection).sort("created_at", -1).to_list(limit)
    # Normalise legacy "new" status for clarity in George's answers.
    for r in rows:
        if r.get("status") in (None, "", "new"):
            r["status"] = "registered"
    return rows


@register(
    "founding_members_summary",
    "One-shot dashboard summary of the Founding Members CRM: total registered, new today, "
    "awaiting contact, invited, joined, opted out, plus the most-recent registration. "
    "Use this when the admin asks for a general overview (e.g. 'how are Founding Members "
    "doing?') rather than a specific slice. Test-flagged rows are excluded.",
    args={},
)
async def _founding_members_summary(db: Any, args: dict) -> dict:
    base = {"is_test": {"$ne": True}}
    total = await db.interest_registrations.count_documents(base)
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    new_today = await db.interest_registrations.count_documents({
        **base, "created_at": {"$gte": today_start.isoformat()},
    })
    awaiting = await db.interest_registrations.count_documents({
        **base,
        "$or": [
            {"status": {"$exists": False}},
            {"status": None},
            {"status": {"$in": ["registered", "new"]}},
        ],
    })
    invited = await db.interest_registrations.count_documents({**base, "status": "invited"})
    joined  = await db.interest_registrations.count_documents({**base, "status": "joined"})
    opted   = await db.interest_registrations.count_documents({**base, "status": "opted_out"})
    latest = await db.interest_registrations.find_one(
        base,
        {"_id": 0, "first_name": 1, "email": 1, "state_country": 1, "created_at": 1},
        sort=[("created_at", -1)],
    )
    return {
        "total":            total,
        "new_today":        new_today,
        "awaiting_contact": awaiting,
        "invited":          invited,
        "joined":           joined,
        "opted_out":        opted,
        "latest":           latest,
    }


@register(
    "founding_members_conversion",
    "Funnel + conversion metrics for the Founding Members CRM. Returns counts at every "
    "stage (registered, invited, joined, opted_out), plus derived rates: "
    "invite_rate (invited / (total - opted_out)), join_rate (joined / (total - opted_out)), "
    "invited_to_joined (joined / invited). Use this when the admin asks about conversion, "
    "funnel, ratios, or 'how are we tracking'. Test-flagged rows are excluded.",
    args={
        "since_days": {"type": "int", "required": False},
    },
)
async def _founding_members_conversion(db: Any, args: dict) -> dict:
    base: dict = {"is_test": {"$ne": True}}
    if "since_days" in args:
        cutoff = datetime.now(timezone.utc) - timedelta(days=int(args["since_days"]))
        base["created_at"] = {"$gte": cutoff.isoformat()}
    total = await db.interest_registrations.count_documents(base)
    awaiting = await db.interest_registrations.count_documents({
        **base,
        "$or": [
            {"status": {"$exists": False}},
            {"status": None},
            {"status": {"$in": ["registered", "new"]}},
        ],
    })
    invited   = await db.interest_registrations.count_documents({**base, "status": "invited"})
    joined    = await db.interest_registrations.count_documents({**base, "status": "joined"})
    opted_out = await db.interest_registrations.count_documents({**base, "status": "opted_out"})

    def pct(numer: int, denom: int) -> Optional[float]:
        return round((numer / denom) * 100, 1) if denom > 0 else None

    active = max(total - opted_out, 0)  # exclude opt-outs from the denominator
    # Invited count is conservative — anyone who has been invited OR later
    # joined counts as "reached invite stage".
    reached_invite = invited + joined
    return {
        "window_days":       int(args["since_days"]) if "since_days" in args else None,
        "total":             total,
        "registered":        awaiting,
        "invited":           invited,
        "joined":            joined,
        "opted_out":         opted_out,
        "active_pool":       active,
        "invite_rate_pct":   pct(reached_invite, active),
        "join_rate_pct":     pct(joined, active),
        "invited_to_joined_pct": pct(joined, reached_invite),
    }





# ---------------------------------------------------------------------------
# Placeholders that honestly say "not yet built"
# ---------------------------------------------------------------------------

@register(
    "read_briefing",
    "Return the saved Daily Briefing for a date (YYYY-MM-DD). "
    "The Briefing Rhythm ships in Phase 2 \u2014 for now this always returns not_yet_built.",
    args={"date": {"type": "iso_date", "required": False}},
)
async def _read_briefing(db: Any, args: dict) -> dict:
    return {"not_yet_built": True, "phase": "Phase 2 \u2014 Daily Briefing Rhythm"}


@register(
    "get_health_pulse",
    "Return the four Health Pulse rings (Belonging, Kindness, Safety, Growth). "
    "Ships in Phase 4 \u2014 returns not_yet_built for now.",
    args={},
)
async def _get_health_pulse(db: Any, args: dict) -> dict:
    return {"not_yet_built": True, "phase": "Phase 4 \u2014 Health Pulse"}


# ---------------------------------------------------------------------------
# Write "propose" tools \u2014 draft actions, never execute.
# The chat executor treats their output specially and streams it as
# an ``action_preview`` event instead of folding into tool_results.
# ---------------------------------------------------------------------------

@register(
    "propose_ticket_reply",
    "Draft a reply to a specific support ticket. Produces an Action Preview "
    "for the admin to review before sending. Requires the ticket_id.",
    args={"ticket_id": {"type": "str", "required": True}},
    min_role="moderator",
)
async def _propose_ticket_reply(db: Any, args: dict) -> dict:
    from services.george.proposals import propose_ticket_reply
    # admin context isn't in scope here; the drafter doesn't need it \u2014 the
    # execute endpoint that later sends the email attributes to the caller.
    return await propose_ticket_reply(db, args["ticket_id"], admin={})


@register(
    "propose_submission_decision",
    "Draft a rationale + preview for approving, rejecting, or requesting "
    "changes on a community event submission. Requires submission_id and decision "
    "(one of: approve, reject, changes_requested).",
    args={
        "submission_id": {"type": "str", "required": True},
        "decision": {"type": "str", "required": True,
                     "enum": {"approve", "reject", "changes_requested"}},
    },
    min_role="moderator",
)
async def _propose_submission_decision(db: Any, args: dict) -> dict:
    from services.george.proposals import propose_submission_decision
    return await propose_submission_decision(
        db, args["submission_id"], args["decision"], admin={},
    )


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------

async def execute_tool(db: Any, name: str, args: dict) -> Any:
    """Look up, validate, and run a registered tool."""
    tool = TOOL_REGISTRY.get(name)
    if not tool:
        raise ToolError(f"unknown tool: {name}")
    cleaned = _validate_args(name, args or {}, tool["args"])
    return await tool["run"](db, cleaned)


def tool_schema_for_planner() -> list[dict]:
    """Compact schema list handed to the planner LLM."""
    out: list[dict] = []
    for name, tool in TOOL_REGISTRY.items():
        out.append({
            "name": name,
            "description": tool["description"],
            "args": {
                k: {kk: (list(vv) if isinstance(vv, set) else vv) for kk, vv in v.items()}
                for k, v in tool["args"].items()
            },
        })
    return out
