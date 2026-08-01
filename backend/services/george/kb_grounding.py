"""Shared KB grounding for every George surface.

One entry point (`ground_for_george`) that:
  1. Runs the same `kb.needs_kb()` gate so trivial messages don't
     trigger retrieval.
  2. Fetches semantic + BM25 hits via `kb.retrieve()`.
  3. Formats the hits as a system-prompt block via `kb.format_for_prompt()`.
  4. Writes a telemetry row into `george_kb_hits` so admins can later
     answer "which KB entries did George see for that conversation?".

This is the single hook that gives every George — MCGS, mobile app,
website /meet — access to the same institutional memory. Personality
lives in each caller's system prompt; memory lives here.

Locked with Garry, 1 Aug 2026: "One source of truth. Different
personalities depending on where George appears."
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

log = logging.getLogger("friendplace.george.kb_grounding")

# Where the telemetry rows live. Keep the payload small so a busy
# George doesn't bloat the collection — we can trim old rows in a
# scheduled task later.
TELEMETRY_COLLECTION = "george_kb_hits"


async def ensure_telemetry_indexes(db: Any) -> None:
    """Create the query-supporting indexes for the telemetry collection."""
    try:
        await db[TELEMETRY_COLLECTION].create_index("at")
        await db[TELEMETRY_COLLECTION].create_index("surface")
        await db[TELEMETRY_COLLECTION].create_index("session_id")
        await db[TELEMETRY_COLLECTION].create_index("user_id")
        await db[TELEMETRY_COLLECTION].create_index("admin_id")
    except Exception as e:
        log.warning("george_kb_hits ensure_indexes: %s", e)


async def ground_for_george(
    *,
    db: Any,
    user_message: str,
    surface: str,                # "mcgs" | "member" | "public"
    session_id: Optional[str] = None,
    user_id: Optional[str] = None,
    admin_id: Optional[str] = None,
    k: int = 5,
    types: Optional[list[str]] = None,
    force: bool = False,
) -> tuple[str, list[str]]:
    """Retrieve KB hits for `user_message` and return a formatted
    system-prompt block + the hit IDs (for the caller to attach to
    turn metadata / chat logs).

    Args:
        surface: which George is asking — governs the visibility gate.
            "mcgs" gets public + admin knowledge; every other surface
            is restricted to public entries.
        force: skip the `needs_kb()` gate. Useful when the caller has
            already decided this turn needs grounding.

    Returns:
        (kb_block, hit_ids)
        - `kb_block` is either an empty string (no retrieval, or no
          hits) or a ready-to-append system-prompt suffix.
        - `hit_ids` is the list of KB entry IDs that grounded this
          reply, in RRF-fused order.
    """
    if not user_message or not user_message.strip():
        return "", []

    # Delay the import so this module stays importable even in tools /
    # scripts that don't need knowledge (avoids fastembed pulling in
    # onnxruntime at module load time for unrelated code paths).
    from services import knowledge as _kb

    if not force and not _kb.needs_kb(user_message):
        return "", []

    is_admin = surface == "mcgs"
    hits: list[dict] = []
    try:
        hits = await _kb.retrieve(
            db, user_message, k=k, types=types, is_admin=is_admin,
        )
    except Exception as e:
        log.warning("kb.retrieve failed for surface=%s: %s", surface, e)
        return "", []

    kb_block = _kb.format_for_prompt(hits, is_admin=is_admin) if hits else ""
    hit_ids = [str(h.get("id")) for h in hits if h.get("id")]

    # Telemetry — record even the "gate passed, zero hits" case so we
    # can spot topics the KB doesn't yet cover. Small doc: no bodies,
    # just IDs + fused scores.
    try:
        await db[TELEMETRY_COLLECTION].insert_one({
            "id": str(uuid.uuid4()),
            "at": datetime.now(timezone.utc),
            "surface": surface,
            "session_id": session_id,
            "user_id": user_id,
            "admin_id": admin_id,
            # Trim the query text so a chatty member's essay doesn't
            # bloat the collection — 400 chars is plenty for
            # diagnostics. We do NOT log the reply.
            "query": (user_message or "")[:400],
            "hit_ids": hit_ids,
            "hit_scores": [
                round(float(h.get("_score", 0.0) or 0.0), 4) for h in hits
            ],
            "hit_count": len(hits),
            "is_admin": is_admin,
        })
    except Exception as e:
        log.warning("kb_hits telemetry write failed: %s", e)

    log.info(
        "george.kb surface=%s hits=%d ids=%s",
        surface, len(hits), ",".join(hit_ids) or "-",
    )
    return kb_block, hit_ids


# ── Telemetry read helpers (used by Mission Control) ──────────────────
async def recent_hits(
    db: Any, *, limit: int = 50, surface: Optional[str] = None,
) -> list[dict]:
    """Return the most recent retrieval rows for the Mission Control
    diagnostics view. Small projection so we don't ship the whole
    embedding to the browser."""
    q: dict = {}
    if surface:
        q["surface"] = surface
    proj = {
        "_id": 0, "id": 1, "at": 1, "surface": 1,
        "session_id": 1, "user_id": 1, "admin_id": 1,
        "query": 1, "hit_ids": 1, "hit_scores": 1, "hit_count": 1,
        "is_admin": 1,
    }
    cur = (
        db[TELEMETRY_COLLECTION]
        .find(q, proj)
        .sort([("at", -1)])
        .limit(int(limit))
    )
    rows: list[dict] = []
    async for r in cur:
        # ISO-format the timestamp so the browser doesn't have to
        # unwrap BSON.
        at = r.get("at")
        if hasattr(at, "isoformat"):
            r["at"] = at.isoformat()
        rows.append(r)
    return rows


async def coverage_summary(db: Any, *, days: int = 7) -> dict:
    """Quick roll-up for the Knowledge Health card: how many times was
    the KB consulted in the last N days, split by surface, and how
    many of those returned at least one hit."""
    since = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    from datetime import timedelta as _td
    since = since - _td(days=max(0, days - 1))
    pipeline = [
        {"$match": {"at": {"$gte": since}}},
        {"$group": {
            "_id": "$surface",
            "queries": {"$sum": 1},
            "grounded": {"$sum": {"$cond": [{"$gt": ["$hit_count", 0]}, 1, 0]}},
        }},
    ]
    out: dict = {"since": since.isoformat(), "days": days, "by_surface": {}}
    try:
        async for row in db[TELEMETRY_COLLECTION].aggregate(pipeline):
            out["by_surface"][row["_id"] or "unknown"] = {
                "queries": int(row.get("queries", 0)),
                "grounded": int(row.get("grounded", 0)),
            }
    except Exception as e:
        log.warning("coverage_summary aggregate failed: %s", e)
    return out
