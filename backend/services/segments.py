"""Segments — CRM Phase 2C (Delivery & Engagement).

A *segment* is a named, saved group of members. Not a filter — a group
of people we care about. Locked with Garry, 1 Aug 2026:

    "Mission Control should feel less like a CRM and more like someone
    helping me look after a community. Segments should feel like
    communities of people, not database queries."

## Architecture — a filter predicate DSL

Every filter is described as a small declarative JSON node. Nodes
compose with boolean operators (`and`, `or`, `not`) so combinations
like "gardeners in Sydney active in the last 30 days" fall out of the
same evaluator that renders "all founders".

Example predicate:

    {"op": "and", "children": [
      {"op": "filter", "id": "interest_any",    "value": ["Gardening"]},
      {"op": "filter", "id": "location_suburb", "value": "Bondi"},
      {"op": "filter", "id": "active_within",   "value": 30}
    ]}

The predicate is evaluated by compiling each `filter` node into a
Mongo query fragment via its registered handler in `FILTER_REGISTRY`,
then folding fragments together with `$and` / `$or` / `$nor`.

## Adding a new filter (a promise to future us)

    1. Add an entry to `FILTER_REGISTRY` with `to_query` + `describe`
    2. Optionally add a KB entry teaching George about it
    3. That's it — the segment engine, preview endpoint, campaign
       integration, and George tools all pick it up automatically.

No engine rewrites, no schema migrations, no UI redesigns.

## Data model

    segments (collection)
      { id, name, emoji, description,
        predicate: {...},
        created_at, updated_at, created_by,
        archived: false,
        last_count: 143, last_counted_at: iso,
        tags: [] }
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

log = logging.getLogger("friendplace.segments")

# ── Collection + registry ─────────────────────────────────────────
COLLECTION = "segments"
TARGET_COLLECTION = "users"  # segments query users; campaign join done later

# Filter type hints for the frontend. Adding a new one only requires
# a matching UI control — the backend registry is authoritative.
FILTER_VALUE_TYPES = {"none", "text", "number", "boolean", "enum", "multi_enum", "days"}


class SegmentError(Exception):
    """Validation or evaluation failure."""


# ── Filter registry ────────────────────────────────────────────────
#
# Each entry describes ONE filter primitive that the predicate DSL
# can invoke. Runs against the `users` collection unless noted.
#
#   id           : machine name used in the predicate JSON
#   label        : human-friendly name
#   emoji        : icon for the UI
#   value_type   : FILTER_VALUE_TYPES member — drives the form control
#   value_hint   : optional metadata for the UI (options, min/max)
#   to_query(v)  : function returning a Mongo query fragment
#   describe(v)  : function returning a plain-English sentence
FILTER_REGISTRY: dict[str, dict[str, Any]] = {}


def register_filter(
    id: str,
    *,
    label: str,
    emoji: str,
    value_type: str,
    value_hint: Optional[dict] = None,
    to_query: Callable[[Any], dict],
    describe: Callable[[Any], str],
    description: str = "",
) -> None:
    """Register a filter primitive. Called at module import time."""
    if value_type not in FILTER_VALUE_TYPES:
        raise SegmentError(f"unknown value_type for filter {id}: {value_type}")
    FILTER_REGISTRY[id] = {
        "id":          id,
        "label":       label,
        "emoji":       emoji,
        "value_type":  value_type,
        "value_hint":  value_hint or {},
        "to_query":    to_query,
        "describe":    describe,
        "description": description,
    }


def filter_catalog() -> list[dict]:
    """Return every registered filter's metadata (no functions).
    Consumed by the UI to render the filter picker."""
    out: list[dict] = []
    for f in FILTER_REGISTRY.values():
        out.append({
            "id":          f["id"],
            "label":       f["label"],
            "emoji":       f["emoji"],
            "value_type":  f["value_type"],
            "value_hint":  f["value_hint"],
            "description": f["description"],
        })
    out.sort(key=lambda x: (x["label"] or "").lower())
    return out


# ── Predicate → Mongo compiler ─────────────────────────────────────
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _iso_days_ago(days: int) -> str:
    """Threshold ISO for `field >= days_ago(days)` semantics.

    Members' `last_seen_at` is stored as an ISO string, so we compare
    strings — safe because ISO 8601 sorts lexicographically."""
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def compile_predicate(predicate: Optional[dict]) -> dict:
    """Turn a predicate JSON tree into a Mongo query.

    Empty / None predicate → `{}` (matches everyone).
    """
    if not predicate:
        return {}
    op = (predicate.get("op") or "").lower()

    if op == "filter":
        fid = predicate.get("id")
        val = predicate.get("value")
        f = FILTER_REGISTRY.get(fid)
        if not f:
            raise SegmentError(f"unknown filter id: {fid}")
        try:
            frag = f["to_query"](val)
        except Exception as e:
            raise SegmentError(f"filter '{fid}' rejected value {val!r}: {e}")
        return frag or {}

    if op in ("and", "or", "nor"):
        parts = [compile_predicate(c) for c in (predicate.get("children") or [])]
        parts = [p for p in parts if p]
        if not parts:
            return {}
        if len(parts) == 1 and op == "and":
            return parts[0]
        return {f"${op}": parts}

    if op == "not":
        inner = compile_predicate(predicate.get("child") or {})
        if not inner:
            return {}
        return {"$nor": [inner]}

    raise SegmentError(f"unknown predicate op: {op}")


def describe_predicate(predicate: Optional[dict]) -> str:
    """Render a predicate as a plain-English sentence.

    Not a translation of the Mongo query — a translation of the
    intent. E.g. `{op:'and', children:[interest=Coffee, suburb=Sydney]}`
    → *"has Coffee as an interest AND lives in Sydney"*.
    """
    if not predicate:
        return "everyone"
    op = (predicate.get("op") or "").lower()
    if op == "filter":
        f = FILTER_REGISTRY.get(predicate.get("id"))
        if not f:
            return f"(unknown filter {predicate.get('id')})"
        try:
            return f["describe"](predicate.get("value"))
        except Exception:
            return f["label"]
    if op in ("and", "or"):
        parts = [describe_predicate(c) for c in (predicate.get("children") or [])]
        joiner = " AND " if op == "and" else " OR "
        return joiner.join(f"({p})" if " AND " in p or " OR " in p else p for p in parts if p)
    if op == "not":
        inner = describe_predicate(predicate.get("child") or {})
        return f"NOT ({inner})"
    if op == "nor":
        parts = [describe_predicate(c) for c in (predicate.get("children") or [])]
        return "NEITHER " + " NOR ".join(parts)
    return ""


# ── Concrete filter registrations ──────────────────────────────────
# Every filter below is a first-class citizen. Adding a new one is a
# ~10 line block — no engine rewrite required.

# 1. Interest — multi-select against `users.interests` (case-insensitive).
def _q_interest_any(value) -> dict:
    tags = [str(v).strip() for v in (value or []) if str(v).strip()]
    if not tags:
        return {}
    # Case-insensitive OR across each interest tag. `users.interests`
    # is an array of strings; Mongo's array-match semantics let a
    # regex on the field name match "any element matches".
    return {"$or": [
        {"interests": {"$regex": f"^{_escape_regex(t)}$", "$options": "i"}}
        for t in tags
    ]}

def _q_interest_desc(value) -> str:
    tags = [str(v) for v in (value or [])]
    if not tags:
        return "any interest"
    if len(tags) == 1:
        return f"has {tags[0]} as an interest"
    return f"has any of these interests: {', '.join(tags)}"

# 2. Location — suburb (case-insensitive text match).
def _q_suburb(value) -> dict:
    s = (value or "").strip()
    if not s:
        return {}
    return {"suburb": {"$regex": f"^{_escape_regex(s)}$", "$options": "i"}}

def _q_suburb_desc(value) -> str:
    return f"lives in {value}" if value else "any suburb"

# 3. State — enum
_STATES = {"NSW","VIC","QLD","WA","SA","TAS","ACT","NT"}
def _q_state(value) -> dict:
    s = (value or "").upper()
    if s not in _STATES:
        return {}
    return {"suburb_state": s}

def _q_state_desc(value) -> str:
    return f"lives in {value}" if value else "any state"

# 4. Active within N days.
def _q_active_within(value) -> dict:
    days = int(value or 0)
    if days <= 0:
        return {}
    return {"last_seen_at": {"$gte": _iso_days_ago(days)}}

def _q_active_within_desc(value) -> str:
    return f"active in the last {int(value or 0)} days"

# 5. Inactive over N days (or never active).
def _q_inactive_over(value) -> dict:
    days = int(value or 0)
    if days <= 0:
        return {}
    threshold = _iso_days_ago(days)
    return {"$or": [
        {"last_seen_at": {"$lt": threshold}},
        {"last_seen_at": {"$exists": False}},
        {"last_seen_at": None},
    ]}

def _q_inactive_over_desc(value) -> str:
    return f"hasn't visited in over {int(value or 0)} days"

# 6. Joined within N days.
def _q_joined_within(value) -> dict:
    days = int(value or 0)
    if days <= 0:
        return {}
    return {"created_at": {"$gte": _iso_days_ago(days)}}

def _q_joined_within_desc(value) -> str:
    return f"joined in the last {int(value or 0)} days"

# 7. Founder only — join to interest_registrations by email. Handled
# specially in run_predicate() so the segment engine can populate the
# founder-email set once per evaluation instead of per-filter.
def _q_founder_only(value) -> dict:
    if not value:
        return {}
    return {"__founder_only": True}  # sentinel handled by run_predicate

def _q_founder_only_desc(value) -> str:
    return "is a Founding Member" if value else ""

# 8. Founder status (registered / invited / joined / opted_out).
_FOUNDER_STATUSES = {"registered","invited","joined","opted_out","new"}
def _q_founder_status(value) -> dict:
    statuses = [str(s).lower() for s in (value or []) if str(s).lower() in _FOUNDER_STATUSES]
    if not statuses:
        return {}
    return {"__founder_status": statuses}  # sentinel

def _q_founder_status_desc(value) -> str:
    statuses = [str(s) for s in (value or [])]
    if not statuses:
        return "any founder status"
    return f"Founding Member status is {' or '.join(statuses)}"

# 9. Shared at least one Moment.
def _q_shared_moment(value) -> dict:
    return {"__shared_moment": bool(value)}  # sentinel

def _q_shared_moment_desc(value) -> str:
    return "has shared at least one Moment" if value else "hasn't shared a Moment"

# 10. Email invalid (bounced or complained).
def _q_email_invalid(value) -> dict:
    return {"__email_invalid": bool(value)}  # sentinel

def _q_email_invalid_desc(value) -> str:
    return "has an invalid email address" if value else "has a valid email address"

# 11. Restricted / banned members — excluded by default, opt-in via filter.
def _q_restricted(value) -> dict:
    if value is True:
        return {"$or": [{"restricted": True}, {"banned": True}]}
    if value is False:
        return {"restricted": {"$ne": True}, "banned": {"$ne": True}}
    return {}

def _q_restricted_desc(value) -> str:
    if value is True:  return "is currently restricted or banned"
    if value is False: return "is in good standing"
    return ""


def _escape_regex(s: str) -> str:
    import re
    return re.escape(s)


# Register every filter — keep the order the UI will show them in.
register_filter("interest_any",    label="Interest",              emoji="✨",
    value_type="multi_enum",
    value_hint={"options_source": "distinct:users.interests"},
    to_query=_q_interest_any, describe=_q_interest_desc,
    description="Match members with any of the selected interests. Case-insensitive.")

register_filter("location_suburb", label="Suburb",                emoji="📍",
    value_type="text",
    to_query=_q_suburb, describe=_q_suburb_desc,
    description="Exact suburb match (case-insensitive).")

register_filter("location_state",  label="State",                 emoji="🗺️",
    value_type="enum",
    value_hint={"options": sorted(_STATES)},
    to_query=_q_state, describe=_q_state_desc,
    description="Australian state / territory.")

register_filter("active_within",   label="Active within days",    emoji="💙",
    value_type="days",
    value_hint={"min": 1, "max": 365, "default": 30},
    to_query=_q_active_within, describe=_q_active_within_desc,
    description="Member has opened the app in the last N days.")

register_filter("inactive_over",   label="Inactive for over days", emoji="😴",
    value_type="days",
    value_hint={"min": 1, "max": 365, "default": 30},
    to_query=_q_inactive_over, describe=_q_inactive_over_desc,
    description="Member hasn't opened the app for more than N days.")

register_filter("joined_within",   label="Joined within days",    emoji="🆕",
    value_type="days",
    value_hint={"min": 1, "max": 365, "default": 7},
    to_query=_q_joined_within, describe=_q_joined_within_desc,
    description="Member's account was created in the last N days.")

register_filter("founder_only",    label="Founding Members only", emoji="🦋",
    value_type="boolean",
    to_query=_q_founder_only, describe=_q_founder_only_desc,
    description="Only count members whose email appears in the Founding Members CRM.")

register_filter("founder_status",  label="Founder status",        emoji="⭐",
    value_type="multi_enum",
    value_hint={"options": sorted(_FOUNDER_STATUSES)},
    to_query=_q_founder_status, describe=_q_founder_status_desc,
    description="Founding Member status on the CRM (registered / invited / joined / opted_out).")

register_filter("shared_moment",   label="Has shared a Moment",   emoji="✨",
    value_type="boolean",
    to_query=_q_shared_moment, describe=_q_shared_moment_desc,
    description="At least one moment posted (or the negation for 'hasn't shared').")

register_filter("email_invalid",   label="Email invalid / bounced", emoji="⚠️",
    value_type="boolean",
    to_query=_q_email_invalid, describe=_q_email_invalid_desc,
    description="Email marked invalid (hard bounce or spam complaint via Resend webhooks).")

register_filter("restricted",      label="Restricted or banned",  emoji="🚫",
    value_type="boolean",
    to_query=_q_restricted, describe=_q_restricted_desc,
    description="Currently restricted or banned members. Excluded by default in most segments.")


# ── Predicate execution ────────────────────────────────────────────
async def _resolve_founder_email_set(
    db: Any, *, statuses: Optional[list[str]] = None,
) -> set[str]:
    """Return the set of emails (lowercased) currently in the founder
    CRM. Cheap lookup — 500-cap founder list."""
    q: dict = {"is_test": {"$ne": True}}
    if statuses:
        q["status"] = {"$in": statuses}
    emails: set[str] = set()
    async for r in db.interest_registrations.find(q, {"_id": 0, "email": 1}):
        e = (r.get("email") or "").strip().lower()
        if e:
            emails.add(e)
    return emails


async def _resolve_moments_email_set(db: Any) -> set[str]:
    """Emails of users who have posted at least one moment (visible or hidden).
    We pull user_id from moments, then look up the corresponding user email."""
    ids: set[str] = set()
    async for m in db.moments.find({}, {"_id": 0, "user_id": 1, "author_id": 1}):
        uid = m.get("user_id") or m.get("author_id")
        if uid:
            ids.add(str(uid))
    if not ids:
        return set()
    emails: set[str] = set()
    async for u in db.users.find({"id": {"$in": list(ids)}}, {"_id": 0, "email": 1, "username": 1}):
        e = (u.get("email") or "").strip().lower()
        if e:
            emails.add(e)
    return emails


async def _resolve_invalid_email_set(db: Any) -> set[str]:
    """Emails flagged as bounced / complained via Resend webhooks.

    Sources:
    - `interest_registrations.email_invalid: true`
    - `interest_registrations.status: opted_out` where reason == spam_complaint
    """
    emails: set[str] = set()
    async for r in db.interest_registrations.find(
        {"$or": [
            {"email_invalid": True},
            {"opted_out_reason": "spam_complaint"},
        ]},
        {"_id": 0, "email": 1},
    ):
        e = (r.get("email") or "").strip().lower()
        if e:
            emails.add(e)
    return emails


def _extract_sentinels(query: dict) -> tuple[dict, dict]:
    """Split a compiled query into (mongo_query, sentinels).

    Sentinels are the `__founder_only`, `__founder_status`, `__shared_moment`,
    `__email_invalid` markers that resolve to email-set intersections rather
    than direct Mongo predicates.
    """
    sentinels: dict = {}

    def _visit(node):
        if not isinstance(node, dict):
            return node
        # Sentinel node — extract and remove.
        for key in ("__founder_only", "__founder_status", "__shared_moment", "__email_invalid"):
            if key in node:
                sentinels[key] = node[key]
                # Remove; replace with a truism so surrounding $and/$or is intact.
                return {}
        # Recurse into boolean children.
        out = {}
        for k, v in node.items():
            if k in ("$and", "$or", "$nor") and isinstance(v, list):
                cleaned = [_visit(c) for c in v]
                cleaned = [c for c in cleaned if c]
                if cleaned:
                    out[k] = cleaned
            else:
                out[k] = v
        return out

    cleaned = _visit(query) or {}
    return cleaned, sentinels


async def run_predicate(
    db: Any, predicate: Optional[dict], *, limit: Optional[int] = None,
) -> dict:
    """Evaluate a predicate against `users` and return {count, sample}.

    Returns:
        {
          count:   int,
          sample:  [ up to `limit` (default 6) recipient rows ],
          summary: "gardeners in Sydney active in the last 30 days",
        }
    """
    query = compile_predicate(predicate)
    mongo_q, sentinels = _extract_sentinels(query)

    # Base filter: exclude demo / test / banned unless the predicate
    # explicitly opts them in. Prevents "everyone" from including the
    # 8 demo accounts and admin fixtures.
    base = {
        "is_demo": {"$ne": True},
        # If the predicate doesn't already speak about restricted/banned,
        # exclude those too. Cheap defence — a restricted-only segment
        # can still opt in via the filter (it emits its own $or clause).
    }
    if not (isinstance(mongo_q, dict) and (
        "$or" in mongo_q or "restricted" in mongo_q or "banned" in mongo_q
    )):
        base["restricted"] = {"$ne": True}
        base["banned"] = {"$ne": True}

    if mongo_q:
        # AND base with predicate.
        parts = [base]
        if "$and" in mongo_q:
            parts.extend(mongo_q["$and"])
            mongo_q = {k: v for k, v in mongo_q.items() if k != "$and"}
        if mongo_q:
            parts.append(mongo_q)
        final_q = {"$and": parts}
    else:
        final_q = base

    # Sentinel post-filters — apply as email-set intersections.
    email_filters: list[set[str]] = []
    if sentinels.get("__founder_only") or sentinels.get("__founder_status"):
        founder_emails = await _resolve_founder_email_set(
            db, statuses=sentinels.get("__founder_status") or None,
        )
        email_filters.append(founder_emails)
    email_intersect: Optional[set[str]] = None
    if email_filters:
        email_intersect = set.intersection(*email_filters)
        # If empty intersection, count is 0 immediately.
        if not email_intersect:
            return {"count": 0, "sample": [], "summary": describe_predicate(predicate)}

    shared_moment = sentinels.get("__shared_moment")
    invalid_email = sentinels.get("__email_invalid")

    proj = {
        "_id": 0, "id": 1, "first_name": 1, "username": 1, "email": 1,
        "suburb": 1, "suburb_state": 1, "interests": 1, "last_seen_at": 1,
        "avatar": 1,
    }

    # For sentinel-heavy filters we stream the base query, then apply
    # membership post-filters in Python. This is O(matching users) which
    # for FriendPlace (<50k members even at scale) is fine.
    if email_intersect is not None or shared_moment is not None or invalid_email is not None:
        moment_emails = await _resolve_moments_email_set(db) if shared_moment is not None else None
        invalid_emails = await _resolve_invalid_email_set(db) if invalid_email is not None else None

        rows: list[dict] = []
        async for u in db.users.find(final_q, proj):
            email = (u.get("email") or u.get("username") or "").strip().lower()
            if email_intersect is not None and email not in email_intersect:
                continue
            if shared_moment is True and email not in (moment_emails or set()):
                continue
            if shared_moment is False and email in (moment_emails or set()):
                continue
            if invalid_email is True and email not in (invalid_emails or set()):
                continue
            if invalid_email is False and email in (invalid_emails or set()):
                continue
            rows.append(u)
        count = len(rows)
        sample = rows[: (limit or 6)]
        return {"count": count, "sample": sample, "summary": describe_predicate(predicate)}

    # Fast path — no sentinels, just count + sample.
    count = await db.users.count_documents(final_q)
    sample_rows = await db.users.find(final_q, proj).limit(limit or 6).to_list(limit or 6)
    return {"count": count, "sample": sample_rows, "summary": describe_predicate(predicate)}


# ── Segments CRUD ─────────────────────────────────────────────────
async def ensure_indexes(db: Any) -> None:
    try:
        await db[COLLECTION].create_index("id", unique=True, name="segment_id_unique")
        await db[COLLECTION].create_index("archived", name="segment_archived")
        await db[COLLECTION].create_index("name", name="segment_name")
    except Exception as e:
        log.warning("segments ensure_indexes: %s", e)


async def list_segments(db: Any, *, include_archived: bool = False) -> list[dict]:
    q: dict = {} if include_archived else {"archived": {"$ne": True}}
    rows: list[dict] = []
    async for r in db[COLLECTION].find(q, {"_id": 0}).sort([("name", 1)]):
        rows.append(r)
    return rows


async def get_segment(db: Any, sid: str) -> Optional[dict]:
    return await db[COLLECTION].find_one({"id": sid}, {"_id": 0})


async def upsert_segment(db: Any, patch: dict, *, actor_email: Optional[str] = None) -> dict:
    """Create or update a saved segment. Recomputes cached count."""
    now = _now_iso()
    sid = patch.get("id") or str(uuid.uuid4())
    name = (patch.get("name") or "").strip()
    if not name:
        raise SegmentError("Segment name is required")
    predicate = patch.get("predicate") or {}
    # Validate predicate compiles cleanly before saving.
    compile_predicate(predicate)

    # Recompute cached count on save.
    result = await run_predicate(db, predicate, limit=0)

    doc = {
        "id":               sid,
        "name":             name,
        "emoji":            (patch.get("emoji") or "").strip() or None,
        "description":      (patch.get("description") or "").strip() or None,
        "predicate":        predicate,
        "predicate_summary": result["summary"],
        "last_count":       result["count"],
        "last_counted_at":  now,
        "updated_at":       now,
        "archived":         bool(patch.get("archived", False)),
        "tags":             [str(t) for t in (patch.get("tags") or []) if str(t).strip()],
    }
    await db[COLLECTION].update_one(
        {"id": sid},
        {"$set": doc, "$setOnInsert": {
            "created_at": now,
            "created_by": actor_email or "admin",
        }},
        upsert=True,
    )
    return await get_segment(db, sid) or doc


async def delete_segment(db: Any, sid: str, *, archive: bool = True) -> bool:
    """Archive by default (reversible). `archive=False` deletes hard."""
    if archive:
        r = await db[COLLECTION].update_one(
            {"id": sid}, {"$set": {"archived": True, "updated_at": _now_iso()}},
        )
        return r.matched_count > 0
    r = await db[COLLECTION].delete_one({"id": sid})
    return r.deleted_count > 0


async def refresh_count(db: Any, sid: str) -> Optional[dict]:
    """Recompute the cached count for a segment. Returns the updated doc."""
    seg = await get_segment(db, sid)
    if not seg:
        return None
    result = await run_predicate(db, seg.get("predicate") or {}, limit=0)
    now = _now_iso()
    await db[COLLECTION].update_one(
        {"id": sid},
        {"$set": {
            "last_count":       result["count"],
            "last_counted_at":  now,
            "predicate_summary": result["summary"],
            "updated_at":       now,
        }},
    )
    return await get_segment(db, sid)


async def resolve_segment_emails(db: Any, sid: str) -> list[str]:
    """Return the deduped list of email addresses in a segment.

    Used by campaign send-time targeting to convert a saved segment
    into the concrete audience.
    """
    seg = await get_segment(db, sid)
    if not seg or seg.get("archived"):
        return []
    result = await run_predicate(db, seg.get("predicate") or {}, limit=100000)
    emails: list[str] = []
    seen: set[str] = set()
    for r in result.get("sample") or []:
        e = (r.get("email") or "").strip().lower()
        if e and e not in seen:
            seen.add(e)
            emails.append(e)
    return emails
