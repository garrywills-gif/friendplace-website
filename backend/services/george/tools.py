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
    # iter155 Bridge cleanup: authoritative ``origin`` field. Anything
    # explicitly marked seed / test / diagnostic is out. Rows without an
    # ``origin`` are treated as production (backfill guarantees every
    # existing row has one).
    conditions.append({"origin": {"$nin": ["test", "seed", "diagnostic"]}})

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
        elif typ == "dict":
            if not isinstance(val, dict):
                raise ToolError(f"{name}: arg '{key}' must be dict")
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
    "Count support tickets by status. Sourced from the Bridge (mcgs_cases with case_key prefix `support_ticket:`) so the number always matches what admins see on /admin/bridge. Test-flagged rows are excluded by default; pass include_test_data=true to include them.",
    args={
        "status": {"type": "str", "required": False,
                   "enum": {"open", "in_progress", "resolved", "closed"}},
        "include_test_data": {"type": "bool", "required": False},
    },
)
async def _count_support_tickets(db: Any, args: dict) -> int:
    """Return the count of support-ticket cases on the Bridge.

    Launch-readiness fix (Garry, 8 Aug 2026 iter141 — "I need to be
    able to trust what George says is correct"): this tool used to
    count the raw `support_tickets` collection, which drifted from
    the Bridge whenever the signal-producer failed silently. The
    briefing said "six tickets" while the Bridge showed "5 cases".
    Now every ticket-count answer George gives — briefings, tool
    calls, milestones — comes from a single source (mcgs_cases with
    case_key prefix `support_ticket:`).

    Status mapping:
      open / in_progress → OPEN_STATES on the case
      resolved / closed  → RESOLVED status on the case

    The two ticket sub-statuses (open vs in_progress) both collapse
    to "open on the Bridge" because the Bridge doesn't distinguish
    them; George's briefings already treated them as the same
    ("needs eyes"), so this is behaviourally equivalent.
    """
    status_arg = str(args.get("status", "open")).lower()
    if status_arg in {"open", "in_progress"}:
        case_status: dict = {
            "$in": ["NEW", "SEEN", "IN_REVIEW", "SNOOZED", "ESCALATED"],
        }
    elif status_arg in {"resolved", "closed"}:
        case_status = "RESOLVED"
    else:
        # Unknown status: match nothing rather than lie.
        return 0

    q: dict = {
        "case_key": {"$regex": "^support_ticket:"},
        "status": case_status,
    }
    if not _should_include_test_data(args):
        # Test-data exclusion still uses the Case's `subject` field —
        # signal producers copy the ticket subject into the case's
        # subject (see `services/mcgs/signals.py::create_signal`), so
        # the test-marker regex works identically on either source.
        exclude_test_data(q, subject_field="subject")
    return await db.mcgs_cases.count_documents(q)


# ---------------------------------------------------------------------------
# Bridge workload summary (iter155 Phase 3)
# ---------------------------------------------------------------------------
#
# Single source of truth for George's "what needs my attention?" answer.
# Uses the same six-category mapping as the Bridge tiles so his numbers
# always match what the admin sees on screen.

@register(
    "bridge_summary",
    "Get the six-category Bridge workload summary — the exact numbers behind The Bridge's tiles. Categories: event_approvals, notice_approvals, member_complaints, safety_reviews, app_feedback, support_tickets. Milestone signals are reported separately (informational only, not actionable). Use this to answer 'what needs my attention?' — always call this rather than the raw count_signals/count_cases tools when the admin asks for a workload overview.",
    args={},
)
async def _bridge_summary(db: Any, args: dict) -> dict:
    from services.mcgs import compute_bridge_summary
    return await compute_bridge_summary(db)


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
    "state_country (case-insensitive substring, e.g. 'Sydney', 'NSW', 'Melbourne'), "
    "since_days for a rolling window (e.g. since_days=7 for a rolling week), or "
    "today=true for the *Sydney calendar-day* boundary (matches the dashboard's "
    "'New today' card exactly — use this when the admin asks 'how many registered "
    "today?'; never use since_days=1 for that, it's a rolling 24-hour window and "
    "will drift from the card). Test-flagged rows and reserved slots (#0001 Garry, "
    "#0002 George) are excluded from public-facing counts.",
    args={
        "status": {"type": "str", "required": False,
                   "enum": {"registered", "invited", "joined", "opted_out"}},
        "companion_choice": {"type": "str", "required": False,
                             "enum": {"george", "georgia"}},
        "state_country": {"type": "str", "required": False},
        "since_days": {"type": "int", "required": False},
        "today": {"type": "bool", "required": False},
        "include_test_data": {"type": "bool", "required": False},
    },
)
async def _count_interest_registrations(db: Any, args: dict) -> int:
    q: dict = {}
    # iter163: `today=true` matches the dashboard's "New today" — Sydney
    # calendar boundary, reserved slots excluded. `joined` intentionally
    # keeps reserved rows because Garry & George count as joined founders
    # in the card, so mirror that.
    if args.get("today") is True:
        from ..time_boundaries import sydney_today_start_iso
        q["created_at"] = {"$gte": sydney_today_start_iso()}
        # Only exclude reserved for public statuses (matches card).
        if args.get("status") != "joined":
            q["is_reserved"] = {"$ne": True}
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
    if "since_days" in args and args.get("today") is not True:
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
    "awaiting invitation (people who registered and already received the automatic "
    "registration email but are still waiting for the personal invitation), invited, "
    "joined, opted out, plus the most-recent registration. "
    "IMPORTANT: `awaiting_contact` in the response is a legacy field name — it means "
    "'awaiting personal invitation'. These members HAVE received the auto-registration "
    "email at signup. Never say they have not been emailed. Use this when the admin asks "
    "for a general overview (e.g. 'how are Founding Members doing?') rather than a "
    "specific slice. Test-flagged rows are excluded.",
    args={},
)
async def _founding_members_summary(db: Any, args: dict) -> dict:
    # iter163: delegate to the shared canonical stats function so this
    # tool can never drift from the dashboard's counting rules.
    # "Today" is Sydney-calendar-day, reserved slots are excluded from
    # every headline metric except total/joined — same as the card.
    from ..crm.founding_stats import compute_founding_members_stats
    return await compute_founding_members_stats(db)


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
    "get_system_health",
    "Return the live System Health Dashboard payload — infrastructure probes for Backend API, "
    "Database, George AI, Email service, Push notifications, Storage, and the Website, plus a "
    "top-level `overall` status ('ok' | 'degraded' | 'unknown') and basic DB counts. Cached for "
    "60s by default; pass fresh=true to force a live re-probe. This is the INFRA dashboard at "
    "/admin/system-health — NOT the Phase 4 community Health Pulse rings.",
    args={"fresh": {"type": "bool", "required": False}},
)
async def _get_system_health(db: Any, args: dict) -> dict:
    from services import system_health as _sh
    return await _sh.collect_health(db, fresh=bool(args.get("fresh") or False))


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
    "Return the four COMMUNITY Health Pulse rings (Belonging, Kindness, Safety, Growth). "
    "Ships in Phase 4 \u2014 returns not_yet_built for now. NOTE: this is separate from the "
    "live System Health Dashboard (infra probes) — use get_system_health for that.",
    args={},
)
async def _get_health_pulse(db: Any, args: dict) -> dict:
    return {"not_yet_built": True, "phase": "Phase 4 \u2014 Community Health Pulse rings"}


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
# Flyer authoring tools (Garry, iter158 launch polish)
# ---------------------------------------------------------------------------
# Two tools so George can help Garry set up a flyer conversationally:
#
#   list_flyer_templates  \u2014 read-only browse of the published catalogue.
#                            George uses this to suggest a starting
#                            template that fits the admin's request
#                            (e.g. "I need a poster for the Kellyville
#                            Library"). Returns the compact metadata
#                            the LLM needs to reason about fit:
#                            key, name, description, category, engine,
#                            supported layouts, default layout, and the
#                            template's own `george_hint` field.
#
#   draft_flyer           \u2014 write-proposal tool. Given a template key,
#                            an optional layout, and an optional
#                            field_values dict, it composes an
#                            ``action_preview`` payload the admin can
#                            review and \u2014 by pressing "Open in Flyer
#                            Publishing Centre" \u2014 open on the flyer
#                            detail page with the print modal
#                            pre-populated. It NEVER prints, downloads,
#                            or publishes on its own \u2014 the admin's
#                            manual click in the modal remains the only
#                            way to ship a flyer.

@register(
    "list_flyer_templates",
    "Browse the Flyer Publishing Centre catalogue. Returns published "
    "templates with their category, description, supported layouts, "
    "default layout, editable fields and the template's own george_hint "
    "so you can suggest the best starting point. Use this whenever Garry "
    "asks for help creating a flyer, a poster, a noticeboard invite, or "
    "wants to see what templates are available. Read-only.",
    args={},
)
async def _list_flyer_templates(db: Any, args: dict) -> list[dict]:
    from services import flyers as _flyers
    rows = await _flyers.list_templates(db, status="published")
    out: list[dict] = []
    for r in rows:
        out.append({
            "key":               r.get("key"),
            "name":              r.get("name"),
            "description":       r.get("description"),
            "category":          r.get("category"),
            "engine":            r.get("engine"),
            "supported_layouts": r.get("supported_layouts") or [],
            "default_layout":    r.get("default_layout"),
            "fields": [
                {
                    "key":      f.get("key"),
                    "label":    f.get("label"),
                    "type":     f.get("type"),
                    "required": bool(f.get("required")),
                    "help":     f.get("help"),
                }
                for f in (r.get("fields") or [])
                if f.get("type") != "hidden"
            ],
            "george_hint":  r.get("george_hint"),
        })
    return out


# Human-readable labels for layout keys. Kept in lock-step with
# ``services/flyers/registry.LAYOUTS`` \u2014 imported lazily inside the
# tool so registry import failures don't break the whole module load.
def _flyer_layout_label(layout_key: str) -> str:
    try:
        from services.flyers import layout as _layout_lookup
        spec = _layout_lookup(layout_key)
        if spec is not None:
            return getattr(spec, "label", None) or layout_key
    except Exception:
        pass
    return layout_key


@register(
    "draft_flyer",
    "Set up a flyer draft (template + layout + optional field values) "
    "and hand Garry an Action Preview he can open in the Flyer "
    "Publishing Centre. Use this after `list_flyer_templates` when Garry "
    "asks you to create / draft / prepare / set up a flyer. Requires "
    "template_key. Optional: layout (must be one the template supports "
    "\u2014 defaults to the template's default_layout), field_values "
    "(dict of field_key -> string). This NEVER prints, downloads or "
    "publishes on its own \u2014 the admin taps Print in the Publishing "
    "Centre to actually ship a flyer.",
    args={
        "template_key":  {"type": "str",  "required": True},
        "layout":        {"type": "str",  "required": False},
        "field_values":  {"type": "dict", "required": False},
        "notes":         {"type": "str",  "required": False},
    },
    min_role="moderator",
)
async def _draft_flyer(db: Any, args: dict) -> dict:
    import json as _json
    import base64 as _b64
    from services import flyers as _flyers

    tpl_key = str(args.get("template_key") or "").strip()
    tpl = await _flyers.get_template(db, tpl_key)
    if not tpl:
        return {
            "kind": "action_preview",
            "action_type": "flyer_draft",
            "error": f"I couldn't find a flyer template named '{tpl_key}'. "
                     "Would you like me to list what's available?",
            "target": {"kind": "flyer_template", "id": tpl_key},
            "what": "Draft flyer",
            "why": "Template not found.",
            "sources": [],
            "confidence": "low",
            "draft": "",
        }

    if str(tpl.get("status")) != "published":
        return {
            "kind": "action_preview",
            "action_type": "flyer_draft",
            "error": (
                f"The '{tpl.get('name') or tpl_key}' template isn't published, "
                "so it can't be drafted from chat. Publish it first from the "
                "Flyer Publishing Centre."
            ),
            "target": {"kind": "flyer_template", "id": tpl_key},
            "what": "Draft flyer",
            "why": "Template not published.",
            "sources": [],
            "confidence": "low",
            "draft": "",
        }

    supported = list(tpl.get("supported_layouts") or [])
    default_layout = tpl.get("default_layout") or (supported[0] if supported else None)
    layout_key = str(args.get("layout") or "").strip() or default_layout
    if not layout_key:
        return {
            "kind": "action_preview",
            "action_type": "flyer_draft",
            "error": f"The '{tpl.get('name')}' template has no supported layouts configured.",
            "target": {"kind": "flyer_template", "id": tpl_key},
            "what": "Draft flyer",
            "why": "No layout available.",
            "sources": [],
            "confidence": "low",
            "draft": "",
        }
    if supported and layout_key not in supported:
        return {
            "kind": "action_preview",
            "action_type": "flyer_draft",
            "error": (
                f"'{layout_key}' isn't one of the '{tpl.get('name')}' template's "
                f"supported layouts. Try one of: {', '.join(supported)}."
            ),
            "target": {"kind": "flyer_template", "id": tpl_key},
            "what": "Draft flyer",
            "why": "Requested layout is not supported by this template.",
            "sources": [],
            "confidence": "low",
            "draft": "",
        }

    # Filter field_values to KNOWN field keys the template declares, so
    # George can't smuggle unknown params through the URL. Values are
    # coerced to strings (the flyer render endpoint expects strings).
    template_field_keys = {
        f.get("key") for f in (tpl.get("fields") or []) if f.get("key")
    }
    incoming = args.get("field_values") or {}
    field_values: dict[str, str] = {}
    for k, v in incoming.items():
        if k in template_field_keys and v is not None:
            field_values[str(k)] = str(v)

    # Build the deep-link URL that opens the Flyer Publishing Centre's
    # print modal with the layout + fields pre-populated. Query params
    # keep the state fully client-visible so the admin can see exactly
    # what George set up before doing anything with it.
    fields_b64 = ""
    if field_values:
        try:
            fields_b64 = _b64.urlsafe_b64encode(
                _json.dumps(field_values, ensure_ascii=False, sort_keys=True).encode("utf-8"),
            ).decode("ascii").rstrip("=")
        except Exception:
            fields_b64 = ""

    from urllib.parse import urlencode
    qs_parts: list[tuple[str, str]] = [
        ("open", "preview"),
        ("layout", layout_key),
    ]
    if fields_b64:
        qs_parts.append(("fields", fields_b64))
    edit_url = f"/admin/flyers/{tpl_key}?{urlencode(qs_parts)}"

    layout_label = _flyer_layout_label(layout_key)

    # Human-readable summary for the draft body \u2014 shown in the
    # ActionPreview card so the admin can eyeball what George set up.
    summary_lines: list[str] = [
        f"Template: {tpl.get('name')} ({tpl_key})",
        f"Layout:   {layout_label}",
    ]
    if field_values:
        summary_lines.append("Fields:")
        for k in sorted(field_values.keys()):
            summary_lines.append(f"  \u2022 {k}: {field_values[k]}")
    else:
        summary_lines.append("Fields:   (none pre-filled \u2014 use the defaults)")
    if args.get("notes"):
        summary_lines += ["", f"Note: {args['notes']}"]

    return {
        "kind": "action_preview",
        "action_type": "flyer_draft",
        "target": {"kind": "flyer_template", "id": tpl_key},
        "what": f"Draft a \u201c{tpl.get('name')}\u201d flyer ({layout_label})",
        "why": (
            args.get("notes")
            or tpl.get("george_hint")
            or "Set up the flyer with your chosen layout and fields ready for preview."
        ),
        "sources": [
            {"label": tpl.get("name") or tpl_key,
             "kind": "flyer_template", "id": tpl_key},
        ],
        "confidence": "high",
        "confidence_reason": (
            "This preview only sets up the flyer state \u2014 nothing prints "
            "or publishes until you tap Print in the Publishing Centre."
        ),
        "draft": "\n".join(summary_lines),
        "flyer": {
            "template_key":   tpl_key,
            "template_name":  tpl.get("name"),
            "layout":         layout_key,
            "layout_label":   layout_label,
            "field_values":   field_values,
            "edit_url":       edit_url,
        },
    }


# ---------------------------------------------------------------------------
# Campaign tools \u2014 CRM Phase 2B (Delivery & Engagement)
# ---------------------------------------------------------------------------
# Teaching George to reason over Resend webhook data. Locked with Garry
# 1 Aug 2026: "George should be able to answer campaign questions from
# the same numbers I see on the dashboard \u2014 they're one shared truth."
#
# All three tools compute rates on the fly from the campaign's stats
# rollup, which is kept live by services/campaign_webhooks.py. The
# raw event log (resend_webhook_events) is authoritative and can
# rebuild rollups if they ever drift.

def _campaign_rate(num: int, den: int) -> float:
    if not den:
        return 0.0
    return round(num / den, 4)


def _summarise_campaign(row: dict) -> dict:
    """Turn a campaigns doc into the compact shape George's synthesizer
    likes to reason over. Adds computed rates so the LLM doesn't have to."""
    stats = row.get("stats") or {}
    accepted   = int(stats.get("accepted")   or 0)
    delivered  = int(stats.get("delivered")  or 0)
    bounced    = int(stats.get("bounced")    or 0)
    unique_op  = int(stats.get("unique_opens")  or 0)
    unique_cl  = int(stats.get("unique_clicks") or 0)
    return {
        "id":            row.get("id"),
        "title":         row.get("name") or row.get("title") or row.get("subject") or "(untitled)",
        "template":      row.get("template"),
        "status":        row.get("status"),
        "sent_at":       row.get("sent_at") or row.get("scheduled_at"),
        "accepted":      accepted,
        "delivered":     delivered,
        "bounced":       bounced,
        "complained":    int(stats.get("complained") or 0),
        "unique_opens":  unique_op,
        "unique_clicks": unique_cl,
        "delivery_rate": _campaign_rate(delivered, accepted),
        "open_rate":     _campaign_rate(unique_op, accepted),
        "click_rate":    _campaign_rate(unique_cl, accepted),
        "bounce_rate":   _campaign_rate(bounced, accepted),
    }


@register(
    "list_campaigns",
    "List recent email campaigns with delivery + engagement stats "
    "(delivered / opened / clicked / bounced counts + rates). Answers "
    "questions like \u201chow did yesterday\u2019s campaign perform?\u201d or "
    "\u201cwhich campaign had the best open rate?\u201d Test-flagged rows are "
    "excluded by default.",
    args={
        "limit":  {"type": "int", "required": False},
        "status": {"type": "str", "required": False,
                   "enum": {"draft", "scheduled", "sending", "sent", "failed"}},
        "sort_by": {"type": "str", "required": False,
                    "enum": {"recent", "open_rate", "click_rate", "bounce_rate"}},
        "include_test_data": {"type": "bool", "required": False},
    },
    min_role="admin",
)
async def _list_campaigns(db: Any, args: dict) -> list[dict]:
    q: dict = {}
    if "status" in args:
        q["status"] = args["status"]
    if not _should_include_test_data(args):
        exclude_test_data(q, subject_field="title")
    limit = max(1, min(int(args.get("limit") or 10), 25))
    rows = await db.campaigns.find(q, {"_id": 0}).sort(
        [("sent_at", -1), ("created_at", -1)]
    ).to_list(limit * 3)  # oversample so post-sort has enough candidates
    summarised = [_summarise_campaign(r) for r in rows]
    sort_by = args.get("sort_by") or "recent"
    if sort_by == "open_rate":
        summarised.sort(key=lambda r: r["open_rate"], reverse=True)
    elif sort_by == "click_rate":
        summarised.sort(key=lambda r: r["click_rate"], reverse=True)
    elif sort_by == "bounce_rate":
        summarised.sort(key=lambda r: r["bounce_rate"], reverse=True)
    return summarised[:limit]


@register(
    "get_campaign_performance",
    "Return the full engagement rollup for a single campaign: counts, "
    "rates, and the most recent Resend event. Use this to answer "
    "\u201chow did the invitation campaign perform?\u201d after list_campaigns "
    "identifies the id.",
    args={"campaign_id": {"type": "str", "required": True}},
    min_role="admin",
)
async def _get_campaign_performance(db: Any, args: dict) -> dict:
    row = await db.campaigns.find_one({"id": args["campaign_id"]}, {"_id": 0})
    if not row:
        return {"not_found": True, "campaign_id": args["campaign_id"]}
    out = _summarise_campaign(row)
    out["last_event_at"] = (row.get("stats") or {}).get("last_event_at")
    return out


@register(
    "list_campaign_non_openers",
    "List Founding Members on a campaign who received the email but "
    "haven\u2019t opened it yet. Use to answer \u201cwho hasn\u2019t opened the "
    "invitation?\u201d Returns compact rows (founder_number, first_name, "
    "email, delivered_at). Default limit 25, max 100.",
    args={
        "campaign_id": {"type": "str", "required": True},
        "limit":       {"type": "int", "required": False},
    },
    min_role="admin",
)
async def _list_campaign_non_openers(db: Any, args: dict) -> list[dict]:
    limit = max(1, min(int(args.get("limit") or 25), 100))
    q = {
        "campaign_id": args["campaign_id"],
        "delivered_at": {"$exists": True, "$ne": None},
        "first_opened_at": {"$in": [None, ""]},
        "status": {"$nin": ["bounced", "complained", "failed"]},
    }
    proj = {"_id": 0, "id": 1, "founder_id": 1, "founder_number": 1,
            "first_name": 1, "email": 1, "delivered_at": 1}
    # `first_opened_at` may also just be missing (never set) \u2014 handle
    # via a second $or so we include both "field absent" and "field null".
    q2 = dict(q)
    q2.pop("first_opened_at", None)
    q2["$or"] = [
        {"first_opened_at": {"$exists": False}},
        {"first_opened_at": None},
        {"first_opened_at": ""},
    ]
    rows = await db.campaign_recipients.find(q2, proj).sort(
        [("delivered_at", 1)]
    ).to_list(limit)
    return rows


# ---------------------------------------------------------------------------
# Segment tools \u2014 CRM Phase 2C (Segments)
# ---------------------------------------------------------------------------
# Teach George to reason about saved segments. Locked with Garry, 1 Aug 2026:
# "George, how many people are in the Gardening segment?"
# "Which segment has grown the most this month?"
# "Who should receive this campaign?"

@register(
    "list_segments",
    "List saved audience segments (with cached member counts). Answers "
    "\u201cwhat segments do we have?\u201d and \u201cwhich segment has the most "
    "members?\u201d Returns compact rows: id, name, emoji, count, description.",
    args={
        "sort_by": {"type": "str", "required": False,
                    "enum": {"name", "count_desc", "count_asc", "recent"}},
        "limit":   {"type": "int", "required": False},
    },
    min_role="admin",
)
async def _list_segments(db: Any, args: dict) -> list[dict]:
    from services import segments as _segments
    rows = await _segments.list_segments(db, include_archived=False)
    sort_by = args.get("sort_by") or "name"
    if sort_by == "count_desc":
        rows.sort(key=lambda r: (r.get("last_count") or 0), reverse=True)
    elif sort_by == "count_asc":
        rows.sort(key=lambda r: (r.get("last_count") or 0))
    elif sort_by == "recent":
        rows.sort(key=lambda r: r.get("updated_at") or "", reverse=True)
    else:
        rows.sort(key=lambda r: (r.get("name") or "").lower())
    limit = max(1, min(int(args.get("limit") or 20), 50))
    return [
        {
            "id":          r.get("id"),
            "name":        r.get("name"),
            "emoji":       r.get("emoji"),
            "count":       r.get("last_count"),
            "description": r.get("description"),
            "summary":     r.get("predicate_summary"),
            "updated_at":  r.get("updated_at"),
        }
        for r in rows[:limit]
    ]


@register(
    "get_segment",
    "Get one saved segment by name or id, including its filter definition "
    "and the current member count. Use to answer questions about a specific "
    "segment like \u201chow many gardeners do we have?\u201d",
    args={"name_or_id": {"type": "str", "required": True}},
    min_role="admin",
)
async def _get_segment(db: Any, args: dict) -> dict:
    from services import segments as _segments
    key = (args.get("name_or_id") or "").strip()
    # Try id first, then case-insensitive name match.
    seg = await _segments.get_segment(db, key)
    if not seg:
        # Match by name (case-insensitive).
        rows = await _segments.list_segments(db, include_archived=False)
        for r in rows:
            if (r.get("name") or "").strip().lower() == key.lower():
                seg = r
                break
    if not seg:
        return {"not_found": True, "query": key}
    return {
        "id":          seg.get("id"),
        "name":        seg.get("name"),
        "emoji":       seg.get("emoji"),
        "description": seg.get("description"),
        "count":       seg.get("last_count"),
        "summary":     seg.get("predicate_summary"),
        "updated_at":  seg.get("updated_at"),
        "predicate":   seg.get("predicate"),
    }


@register(
    "preview_segment",
    "Preview an ad-hoc audience segment (before saving it). Accepts a "
    "predicate JSON tree; returns count + sample. Use when the admin "
    "describes a group like \u201cmembers who joined this month but haven\u2019t "
    "shared a Moment\u201d \u2014 you compose the predicate from the filter "
    "catalog (see the KB entry \u201cSegment predicate DSL\u201d) and preview it.",
    args={"predicate": {"type": "dict", "required": True}},
    min_role="admin",
)
async def _preview_segment(db: Any, args: dict) -> dict:
    from services import segments as _segments
    try:
        result = await _segments.run_predicate(db, args["predicate"], limit=6)
    except _segments.SegmentError as e:
        return {"error": str(e)}
    return {
        "count":   result.get("count"),
        "summary": result.get("summary"),
        "sample":  [
            {
                "first_name": r.get("first_name"),
                "suburb":     r.get("suburb"),
                "state":      r.get("suburb_state"),
                "interests":  r.get("interests"),
            }
            for r in result.get("sample") or []
        ],
    }


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


# ---------------------------------------------------------------------------
# Analytics tool (Commit 2 — see services/analytics)
# ---------------------------------------------------------------------------
#
# One consolidated tool that gives George typed access to the full
# analytics catalogue. The planner picks a ``query_id`` from the fixed
# enum (populated at import time from the registered queries) plus a
# ``range_kind`` from ``NamedRange``. The engine handles period
# comparison + drill-down under the hood.
#
# Conversational formatting note: the returned dict includes both the
# raw ``value`` AND a pre-formatted ``george_summary`` that George is
# instructed to lightly rewrite in the natural voice of the app rather
# than reading numbers verbatim. Any ``coverage_notes`` MUST be surfaced
# so George stays honest when historical attribution is unavailable.


def _build_analytics_enums():
    """Populate the analytics tool's enum values lazily.

    Runs inside ``register`` at import time — must not hit MongoDB.
    """
    from services.analytics.time_ranges import NamedRange
    from services.analytics.queries import _ALL_QUERIES

    query_ids = {q.query_id for q in _ALL_QUERIES}
    range_kinds = {r.value for r in NamedRange}
    return query_ids, range_kinds


try:
    _ANALYTICS_QUERY_IDS, _ANALYTICS_RANGES = _build_analytics_enums()
except Exception:  # pragma: no cover - defensive; keeps import resilient.
    log.exception("Failed to load analytics enums for George tool schema")
    _ANALYTICS_QUERY_IDS, _ANALYTICS_RANGES = set(), set()


@register(
    "run_analytics_query",
    (
        "Answer data questions about FriendPlace by running a registered "
        "analytics query. Use this for questions about how many members "
        "joined, active users, campaign performance, events created, "
        "open support cases, best-performing flyers, or top QR/bridge "
        "sources. Returns a typed result with an optional period-over-"
        "period comparison AND coverage_notes George MUST surface "
        "verbatim when historical attribution is limited. Reword the "
        "raw numbers into natural conversational language — never read "
        "'Metric: value' verbatim."
    ),
    args={
        "query_id": {
            "type": "str",
            "required": True,
            "enum": _ANALYTICS_QUERY_IDS,
        },
        "range_kind": {
            "type": "str",
            "required": False,
            "enum": _ANALYTICS_RANGES,
        },
        "compare": {"type": "bool", "required": False},
    },
)
async def _run_analytics_query(db: Any, args: dict) -> dict:
    """Execute an analytics query and return a compact result envelope."""
    from services.analytics import get_engine
    from services.analytics.time_ranges import NamedRange

    engine = get_engine()
    range_kind_raw = args.get("range_kind") or "this_week"
    try:
        range_kind = NamedRange(range_kind_raw)
    except ValueError as exc:
        raise ToolError(
            f"run_analytics_query: unknown range_kind '{range_kind_raw}'"
        ) from exc

    result = await engine.run(
        args["query_id"],
        db=db,
        range_kind=range_kind,
        compare=bool(args.get("compare", True)),
    )
    # Compact envelope for the synthesizer — everything George needs
    # to compose a natural sentence, nothing it doesn't.
    envelope: dict[str, Any] = {
        "query_id": result.query_id,
        "metric_label": result.metric_label,
        "value": result.value,
        "unit": result.unit,
        "time_range_label": result.time_range.label,
        "coverage": result.coverage,
        "coverage_notes": result.notes,
        "george_summary": result.to_george_summary(),
    }
    if result.comparison is not None:
        envelope["comparison"] = {
            "previous_label": result.comparison.previous_time_range.label,
            "previous_value": result.comparison.previous_value,
            "delta_absolute": result.comparison.delta_absolute,
            "delta_pct": result.comparison.delta_pct,
            "direction": result.comparison.direction.value,
            "humanized": result.comparison.humanize(),
        }
    if result.breakdown:
        envelope["breakdown"] = [
            {
                "key": row.key,
                "label": row.label,
                "value": row.value,
                "secondary_values": row.secondary_values,
            }
            for row in result.breakdown[:10]  # cap for token efficiency
        ]
    return envelope



# ---------------------------------------------------------------------------
# iter160c — Unified CRM tools (Outreach + Replies + Awaiting)
# ---------------------------------------------------------------------------
#
# These tools give George the ability to see the WHOLE contact-status
# picture in one glance — Founding Members, Enquiries, Outreach
# organisations, and manually-logged Replies — so that when Garry asks
# *"who's waiting on us?"* George prioritises OUTSTANDING INBOUND
# REPLIES first (people who wrote in and haven't heard back), then
# outreach organisations we've contacted but not heard from.
#
# All three tools are read-only. They cite the unified status service
# in `services/crm/status.py` and the outreach store in
# `services/outreach/store.py`.

@register(
    "list_awaiting_reply",
    "The single source of truth for 'who's waiting on us'. Returns EVERY "
    "contact we owe a response to across the CRM: outreach organisations "
    "explicitly in 'awaiting_reply' state PLUS unresolved inbound replies "
    "from the Replies inbox. Ordered oldest-first so genuinely stale "
    "threads surface at the top. USE THIS FIRST whenever Garry asks "
    "'who's waiting on me?', 'who owes a reply?', 'any outstanding "
    "responses?', 'who should I contact next?', or similar. Empty list "
    "means everyone we've heard from has been answered.",
    args={"limit": {"type": "int", "required": False}},
)
async def _list_awaiting_reply(db: Any, args: dict) -> list[dict]:
    from services.crm.status import list_awaiting_reply
    limit = int(args.get("limit") or 20)
    rows = await list_awaiting_reply(db, limit=min(limit, 200))
    # Compact the rows for the LLM — drop empty fields, keep the
    # oldest inbound at the top so George naturally leads with them.
    out: list[dict] = []
    for r in rows:
        item = {
            "email":            r.get("email"),
            "name":             r.get("name"),
            "organisation":     r.get("organisation"),
            "source":           r.get("source"),        # "outreach_organisation" | "inbound_reply"
            "last_inbound_at":  r.get("last_inbound_at"),
            "last_outbound_at": r.get("last_outbound_at"),
        }
        if r.get("subject"):     item["subject"] = r["subject"]
        if r.get("campaign_id"): item["campaign_id"] = r["campaign_id"]
        out.append({k: v for k, v in item.items() if v is not None})
    return out


@register(
    "count_replies",
    "Count inbound replies in the Replies inbox. Returns "
    "{unread, awaiting_our_reply, total}. Use when Garry asks how many "
    "replies are outstanding, how many are unread, or how big the "
    "inbox is right now.",
    args={},
)
async def _count_replies(db: Any, args: dict) -> dict:  # noqa: ARG001
    from services.replies.store import unread_count, awaiting_count
    total = await db.inbound_replies.count_documents({})
    return {
        "unread":              await unread_count(db),
        "awaiting_our_reply":  await awaiting_count(db),
        "total":               int(total),
    }


@register(
    "list_stale_replies",
    "List inbound replies that are unresolved AND older than `days` days "
    "(default 7). Returns {days, count, replies:[{id, from_email, from_name, "
    "subject, channel, campaign_name, received_at, read}]}. Use this when "
    "Garry asks about stale replies, the reply backlog, replies sitting for "
    "a week, unanswered replies, or 'anything I'm dropping the ball on?'. "
    "Oldest first so the most urgent are at the top. Nothing is auto-sent; "
    "this is a read-only nudge. Cite the Mission Control Replies page as "
    "the place to open them.",
    args={
        "days":  {"type": "int", "required": False},
        "limit": {"type": "int", "required": False},
    },
)
async def _list_stale_replies(db: Any, args: dict) -> dict:
    from services.replies.store import (
        stale_reply_count as _srcount,
        list_stale_replies as _lsr,
    )
    days = int(args.get("days") or 7)
    limit = int(args.get("limit") or 20)
    days = max(1, min(days, 90))
    limit = max(1, min(limit, 200))
    return {
        "days":    days,
        "count":   await _srcount(db, days=days),
        "replies": await _lsr(db, days=days, limit=limit),
    }


@register(
    "list_outreach_organisations",
    "List external outreach organisations (retirement villages, "
    "community centres, libraries, clubs, councils, etc.) from the "
    "Outreach CRM. Filter by status (not_contacted | contacted | "
    "awaiting_reply | replied | joined | declined | bounced | "
    "unsubscribed), by category, or by free-text query. Ordered "
    "most-recently-updated first.",
    args={
        "status":   {"type": "str", "required": False,
                     "enum": {"not_contacted", "contacted", "awaiting_reply",
                              "replied", "joined", "declined", "bounced",
                              "unsubscribed"}},
        "category": {"type": "str", "required": False},
        "q":        {"type": "str", "required": False},
        "limit":    {"type": "int", "required": False},
    },
)
async def _list_outreach_organisations(db: Any, args: dict) -> list[dict]:
    from services.outreach.store import list_orgs
    limit = int(args.get("limit") or 25)
    rows = await list_orgs(
        db, status=args.get("status"), category=args.get("category"),
        q=args.get("q"), limit=min(limit, 200),
    )
    return [{
        "id":                r.get("id"),
        "organisation_name": r.get("organisation_name"),
        "contact_name":      r.get("contact_name"),
        "email":             r.get("email"),
        "status":            r.get("status"),
        "category":          r.get("category"),
        "suburb":            r.get("suburb"),
        "state":             r.get("state"),
        "last_contact_at":   r.get("last_contact_at"),
        "last_reply_at":     r.get("last_reply_at"),
    } for r in rows]


@register(
    "count_outreach_organisations",
    "Count outreach organisations in the CRM. Optional status/category "
    "filter. Handy for questions like 'how many retirement villages "
    "have we contacted?' or 'how many outreach orgs are awaiting our "
    "reply?'.",
    args={
        "status":   {"type": "str", "required": False,
                     "enum": {"not_contacted", "contacted", "awaiting_reply",
                              "replied", "joined", "declined", "bounced",
                              "unsubscribed"}},
        "category": {"type": "str", "required": False},
    },
)
async def _count_outreach_organisations(db: Any, args: dict) -> int:
    q: dict[str, Any] = {"is_test": {"$ne": True}}
    if args.get("status"):   q["status"] = args["status"]
    if args.get("category"): q["category"] = args["category"]
    return await db.outreach_organisations.count_documents(q)


@register(
    "list_needs_follow_up",
    "Outreach organisations we contacted N or more days ago and have "
    "NOT heard back from. Different from list_awaiting_reply — those "
    "are people we OWE a reply. This is the reverse: people who owe US "
    "a reply and are going cold. Ordered oldest-first.",
    args={
        "days":  {"type": "int", "required": False},
        "limit": {"type": "int", "required": False},
    },
)
async def _list_needs_follow_up(db: Any, args: dict) -> list[dict]:
    from services.crm.status import list_needs_follow_up
    days = int(args.get("days") or 7)
    limit = int(args.get("limit") or 20)
    rows = await list_needs_follow_up(
        db, days_since_last_contact=days, limit=min(limit, 200),
    )
    return [{
        "email":            r.get("email"),
        "name":             r.get("name"),
        "organisation":     r.get("organisation"),
        "last_outbound_at": r.get("last_outbound_at"),
        "source":           r.get("source"),
    } for r in rows]


@register(
    "get_contact_status",
    "Return the unified CRM status for a single email — checks "
    "founding_members, outreach_organisations, marketing sends, and "
    "inbound replies simultaneously. Returns {status, reason, "
    "last_outbound_at, last_inbound_at, sources}. Use this when Garry "
    "asks about ONE specific person ('what's the story with jane@…?', "
    "'where are we with Elizabeth?').",
    args={"email": {"type": "str", "required": True}},
)
async def _get_contact_status(db: Any, args: dict) -> dict:
    from services.crm.status import status_for_email
    return await status_for_email(db, args["email"])



# ---------------------------------------------------------------------------
# iter162 — Mission Control Reminders (V1, launch-safe)
# ---------------------------------------------------------------------------
# Guardrails:
#  - Reminders NEVER send emails, publish content, or trigger any
#    moderation/action. They are DB rows only.
#  - Only call `create_reminder` after an EXPLICIT admin request such
#    as "remind me to X on Y". Never speculatively create one.
#  - Never claim a reminder exists until the tool returns a stored
#    document with an `id` — that's the save-succeeded signal. If the
#    tool raises or returns nothing, admit it in this turn.

@register(
    "create_reminder",
    "Save a single reminder to Mission Control. Only call this after "
    "Garry has explicitly asked for a reminder ('remind me to X on Y', "
    "'set a weekly reminder for Z'). Do NOT create reminders "
    "speculatively. Reminders never send emails or trigger any "
    "moderation — they are notes in Mission Control. Returns the "
    "persisted document (with `id`) only after the Mongo write "
    "succeeds. If this tool errors or the returned doc is missing, "
    "tell Garry the reminder was not saved — never pretend it exists.",
    args={
        "title":      {"type": "str", "required": True},
        "due_at":     {"type": "str", "required": True,
                       "description": "ISO 8601 UTC (e.g. '2026-03-01T09:00:00Z')"},
        "recurrence": {"type": "str", "required": False,
                       "description": "one of none, daily, weekly, monthly"},
        "note":       {"type": "str", "required": False},
    },
)
async def _create_reminder(db: Any, args: dict) -> dict:
    from services.reminders.store import create_reminder
    return await create_reminder(
        db,
        title=args.get("title", ""),
        due_at=args.get("due_at"),
        recurrence=args.get("recurrence") or "none",
        note=args.get("note") or "",
        created_by="george",
    )


@register(
    "list_reminders",
    "List reminders in Mission Control, oldest-due first. Optional "
    "status filter (pending / completed / cancelled). Use when Garry "
    "asks 'what reminders do I have?' or similar.",
    args={
        "status": {"type": "str", "required": False},
        "limit":  {"type": "int", "required": False},
    },
)
async def _list_reminders(db: Any, args: dict) -> list[dict]:
    from services.reminders.store import list_reminders
    status = args.get("status")
    limit = int(args.get("limit") or 50)
    return await list_reminders(db, status=status, limit=min(limit, 200))


@register(
    "complete_reminder",
    "Mark a reminder as completed. For one-off reminders this closes "
    "them. For recurring reminders (daily/weekly/monthly) the due_at "
    "rolls forward by one period so the next occurrence is queued. "
    "Requires the reminder's `id`.",
    args={"id": {"type": "str", "required": True}},
)
async def _complete_reminder(db: Any, args: dict) -> dict:
    from services.reminders.store import complete_reminder
    doc = await complete_reminder(db, args["id"])
    if not doc:
        return {"error": "not_found", "id": args.get("id")}
    return doc


@register(
    "delete_reminder",
    "Delete a reminder from Mission Control. Irreversible. Requires "
    "the reminder's `id`.",
    args={"id": {"type": "str", "required": True}},
)
async def _delete_reminder(db: Any, args: dict) -> dict:
    from services.reminders.store import delete_reminder
    ok = await delete_reminder(db, args["id"])
    return {"deleted": bool(ok), "id": args.get("id")}

