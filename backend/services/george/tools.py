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
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from services.mcgs.signals import OPEN_STATES, PRIORITY_ORDER

log = logging.getLogger("friendplace.george.tools")


class ToolError(Exception):
    """Validation error for a tool call."""


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
    "Count Signals filtered by producer/status/priority/category. Returns a single integer.",
    args={
        "producer": {"type": "str", "required": False},
        "status":   {"type": "list[str]", "required": False, "enum": _ALLOWED_STATUSES},
        "priority": {"type": "list[str]", "required": False, "enum": _ALLOWED_PRIORITIES},
        "category": {"type": "list[str]", "required": False,
                     "enum": {"attention", "anomaly", "risk", "milestone", "question", "housekeeping"}},
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
    return await db.mcgs_signals.count_documents(q)


@register(
    "list_signals",
    "List Signals (compact rows). Sorted priority then recency. Default limit 10.",
    args={
        "producer": {"type": "str", "required": False},
        "status":   {"type": "list[str]", "required": False, "enum": _ALLOWED_STATUSES},
        "priority": {"type": "list[str]", "required": False, "enum": _ALLOWED_PRIORITIES},
        "limit":    {"type": "int", "required": False},
    },
)
async def _list_signals(db: Any, args: dict) -> list[dict]:
    q: dict = {}
    if "producer" in args:
        q["producer"] = args["producer"]
    q["status"] = {"$in": args["status"]} if "status" in args else {"$in": list(OPEN_STATES)}
    if "priority" in args:
        q["priority"] = {"$in": args["priority"]}
    limit = max(1, min(int(args.get("limit") or 10), 25))
    rows = await db.mcgs_signals.find(
        q,
        {"_id": 0, "id": 1, "priority": 1, "status": 1, "subject": 1,
         "producer": 1, "created_at": 1, "case_id": 1},
    ).sort([("priority", 1), ("created_at", -1)]).to_list(limit)
    return rows


@register(
    "count_cases",
    "Count Cases (grouped Signals) filtered by producer/status/priority.",
    args={
        "producer": {"type": "str", "required": False},
        "status":   {"type": "list[str]", "required": False, "enum": _ALLOWED_STATUSES},
        "priority": {"type": "list[str]", "required": False, "enum": _ALLOWED_PRIORITIES},
    },
)
async def _count_cases(db: Any, args: dict) -> int:
    q: dict = {}
    if "producer" in args:
        # Cases don't carry producer directly, use a lookup via signals.
        signal_ids = await db.mcgs_signals.distinct(
            "case_id", {"producer": args["producer"]},
        )
        q["id"] = {"$in": signal_ids}
    q["status"] = {"$in": args["status"]} if "status" in args else {"$in": list(OPEN_STATES)}
    if "priority" in args:
        q["priority"] = {"$in": args["priority"]}
    return await db.mcgs_cases.count_documents(q)


# ---------------------------------------------------------------------------
# Events tools
# ---------------------------------------------------------------------------

@register(
    "count_event_submissions",
    "Count community event submissions by status.",
    args={
        "status": {"type": "str", "required": False,
                   "enum": {"pending", "approved", "rejected", "changes_requested"}},
    },
)
async def _count_event_submissions(db: Any, args: dict) -> int:
    q = {"status": args.get("status", "pending")}
    return await db.cms_event_submissions.count_documents(q)


@register(
    "count_published_events",
    "Count published CMS events, optionally within a date range (YYYY-MM-DD).",
    args={
        "from_date": {"type": "iso_date", "required": False},
        "to_date":   {"type": "iso_date", "required": False},
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
    return await db.cms_events.count_documents(q)


@register(
    "list_upcoming_events",
    "List the next N published events (default 5). Compact rows.",
    args={"limit": {"type": "int", "required": False}},
)
async def _list_upcoming_events(db: Any, args: dict) -> list[dict]:
    limit = max(1, min(int(args.get("limit") or 5), 20))
    today = datetime.now(timezone.utc).date().isoformat()
    rows = await db.cms_events.find(
        {"status": "published", "start_date": {"$gte": today}},
        {"_id": 0, "id": 1, "title": 1, "start_date": 1, "start_time": 1,
         "location_name": 1, "rsvp_count": 1, "capacity": 1},
    ).sort([("start_date", 1)]).to_list(limit)
    return rows


# ---------------------------------------------------------------------------
# Support tickets
# ---------------------------------------------------------------------------

@register(
    "count_support_tickets",
    "Count support tickets by status.",
    args={
        "status": {"type": "str", "required": False,
                   "enum": {"open", "in_progress", "resolved", "closed"}},
    },
)
async def _count_support_tickets(db: Any, args: dict) -> int:
    q = {"status": args.get("status", "open")}
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
