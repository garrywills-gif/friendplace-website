"""George's institutional knowledge base — hybrid retrieval over
`knowledge_base` MongoDB collection.

Six entry types: story · principle · decision · feature · roadmap · philosophy.

MVP retrieval = BM25 keyword (Mongo text index) + cosine over
OpenAI text-embedding-3-small (via Emergent LLM key), fused with
Reciprocal Rank Fusion. Related entries and supersede chains are
followed so George can *connect* rather than just *quote*.

Every function tolerates partial failure — if the embedding API is
unreachable, we fall back to keyword-only. If the KB is empty, retrieve
returns []. George's chat always handles an empty result gracefully.
"""
from __future__ import annotations

import os
import re
import uuid
import logging
import asyncio
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

logger = logging.getLogger("friendplace.knowledge")

COLLECTION = "knowledge_base"
EMBED_MODEL = "text-embedding-3-small"
EMBED_DIM = 1536

ALLOWED_TYPES = ("story", "principle", "decision", "feature", "roadmap", "philosophy")


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ─── indexes (idempotent) ─────────────────────────────────────────────
async def ensure_indexes(db: Any) -> None:
    try:
        # Text index over title + body + tags for BM25-style search.
        await db[COLLECTION].create_index(
            [("title", "text"), ("body_md", "text"), ("tags", "text")],
            name="kb_text_idx",
            weights={"title": 8, "tags": 4, "body_md": 1},
        )
        await db[COLLECTION].create_index("type")
        await db[COLLECTION].create_index("status")
        await db[COLLECTION].create_index("superseded_by")
        await db[COLLECTION].create_index("updated_at")
    except Exception as e:
        logger.warning("KB ensure_indexes: %s", e)


# ─── embeddings via Emergent LLM key ──────────────────────────────────
async def _embed(text: str) -> Optional[list[float]]:
    """Return a 1536-dim embedding, or None on failure. Cached in-process."""
    text = (text or "").strip()
    if not text:
        return None
    key = os.environ.get("EMERGENT_LLM_KEY") or os.environ.get("OPENAI_API_KEY")
    if not key:
        return None
    try:
        # emergentintegrations exposes an OpenAI-compatible client through the
        # universal key. Fall back to the openai SDK directly if that path
        # isn't wired for embeddings on this version.
        try:
            from openai import AsyncOpenAI
            base = os.environ.get("EMERGENT_LLM_BASE_URL") or None
            client = AsyncOpenAI(
                api_key=key,
                base_url=base or "https://api.emergent-integrations.com/v1",
            )
            r = await client.embeddings.create(model=EMBED_MODEL, input=text[:8000])
            return list(r.data[0].embedding)
        except Exception:
            # Direct-to-OpenAI fallback (real OpenAI key).
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=key)
            r = await client.embeddings.create(model=EMBED_MODEL, input=text[:8000])
            return list(r.data[0].embedding)
    except Exception as e:
        logger.warning("KB embedding failed: %s", e)
        return None


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    return dot / (na * nb) if na and nb else 0.0


# ─── retrieval ────────────────────────────────────────────────────────
_NEEDS_KB_HINTS = re.compile(
    r"\b(why|how|when did|what('?s| is)|explain|current state|remind me|"
    r"outstanding|philosophy|decision|reason|purpose|origin|history|story)\b",
    re.IGNORECASE,
)


def needs_kb(user_message: str) -> bool:
    """Cheap classifier — trigger KB retrieval when the question is
    likely to benefit. Errs on the side of retrieving; George falls
    back to 'unknown' if no entries match."""
    if not user_message or len(user_message.strip()) < 4:
        return False
    return bool(_NEEDS_KB_HINTS.search(user_message))


async def retrieve(
    db: Any, query: str, *, k: int = 5,
    types: Optional[list[str]] = None,
) -> list[dict]:
    """Hybrid BM25 + cosine, RRF-fused, top k. Each hit includes its
    supersede-chain latest and 1-line summaries of related entries."""
    q = (query or "").strip()
    if not q:
        return []

    base_filter: dict = {"status": {"$in": ["active", "superseded"]}}
    if types:
        base_filter["type"] = {"$in": [t for t in types if t in ALLOWED_TYPES]}

    # BM25-ish via Mongo text index.
    keyword_hits: list[dict] = []
    try:
        cur = db[COLLECTION].find(
            {**base_filter, "$text": {"$search": q}},
            {"_id": 0, "embedding": 0, "score": {"$meta": "textScore"}},
        ).sort([("score", {"$meta": "textScore"})]).limit(20)
        keyword_hits = [d async for d in cur]
    except Exception:
        keyword_hits = []

    # Cosine — pull all active/superseded rows with an embedding. This
    # is fine at MVP scale (<10k entries); swap for pgvector / atlas
    # vector-search when the collection grows.
    vector_hits: list[dict] = []
    q_vec = await _embed(q)
    if q_vec:
        try:
            cur2 = db[COLLECTION].find(base_filter, {"_id": 0})
            candidates = [d async for d in cur2]
            scored = []
            for c in candidates:
                emb = c.get("embedding")
                if emb:
                    scored.append((c, _cosine(q_vec, emb)))
            scored.sort(key=lambda t: t[1], reverse=True)
            vector_hits = [c for c, s in scored[:20] if s > 0.15]
        except Exception:
            vector_hits = []

    # RRF fusion.
    rrf_k = 60
    scores: dict[str, float] = {}
    lookup: dict[str, dict] = {}
    for rank, hit in enumerate(keyword_hits):
        i = hit["id"]
        scores[i] = scores.get(i, 0) + 1.0 / (rrf_k + rank + 1)
        lookup[i] = hit
    for rank, hit in enumerate(vector_hits):
        i = hit["id"]
        scores[i] = scores.get(i, 0) + 1.0 / (rrf_k + rank + 1)
        lookup[i] = hit
    fused = [lookup[i] for i, _ in sorted(scores.items(), key=lambda t: t[1], reverse=True)]

    # Prefer active entries; if the top hit is superseded, also surface
    # its live replacement so George can explain the shift.
    out: list[dict] = []
    seen: set[str] = set()
    for h in fused[: k * 2]:
        if h["id"] in seen:
            continue
        seen.add(h["id"])
        # Follow supersede chain forward.
        latest = h
        try:
            visited: set[str] = {latest["id"]}
            while latest.get("superseded_by") and latest["superseded_by"] not in visited:
                nxt = await db[COLLECTION].find_one(
                    {"id": latest["superseded_by"]}, {"_id": 0, "embedding": 0},
                )
                if not nxt:
                    break
                visited.add(nxt["id"])
                latest = nxt
        except Exception:
            pass
        h["latest_version"] = latest if latest["id"] != h["id"] else None

        # Enrich related titles (one-line context for the LLM).
        related = h.get("related_ids") or []
        if related:
            rt: list[dict] = []
            try:
                async for r in db[COLLECTION].find(
                    {"id": {"$in": related}},
                    {"_id": 0, "id": 1, "title": 1, "type": 1},
                ):
                    rt.append(r)
            except Exception:
                pass
            h["related"] = rt
        else:
            h["related"] = []

        out.append(h)
        if len(out) >= k:
            break
    return out


def format_for_prompt(hits: list[dict]) -> str:
    """Turn retrieved hits into a prompt block. Kept concise so the
    LLM budget stays healthy even with 5 hits."""
    if not hits:
        return ""
    parts = ["\n\n## Institutional knowledge from FriendPlace's own memory"]
    for h in hits:
        supersede_note = ""
        if h.get("latest_version"):
            lv = h["latest_version"]
            supersede_note = (
                f"\n(NOTE: this entry was superseded by [{lv['id']}] "
                f"'{lv.get('title', '')}' — mention both if relevant.)"
            )
        related_line = ""
        if h.get("related"):
            titles = ", ".join(f"[{r['id']}] {r.get('title', '')}" for r in h["related"])
            related_line = f"\nRelated: {titles}"
        parts.append(
            f"\n### [{h['id']}] {h.get('title', '')} · type: {h.get('type')}"
            f"\nUpdated: {h.get('updated_at')}"
            f"{related_line}"
            f"{supersede_note}"
            f"\n---\n{h.get('body_md', '')}\n---"
        )
    parts.append(
        "\n\nRules when answering from these entries:\n"
        "- Ground every substantive claim in one of the entries above.\n"
        "- Cite entries using the form [KB-XXXX] where KB-XXXX is the id shown.\n"
        "- If NONE of the entries answer the question, say so explicitly: "
        "  'I don't have a documented decision on that yet — do you want to record one?'\n"
        "- When multiple entries relate, connect them naturally: 'this stems from…', "
        "  'this reinforces…', 'this superseded…'. Never invent connections that aren't there.\n"
        "- If a retrieved entry is older than 90 days and might be stale, note that.\n"
    )
    return "\n".join(parts)


# ─── ingestion helpers (used by seed script) ──────────────────────────
async def upsert_entry(db: Any, entry: dict) -> dict:
    """Idempotent upsert by id; refreshes embedding when body changes."""
    now = _now()
    entry_id = entry.get("id") or f"KB-{uuid.uuid4().hex[:8]}"
    entry["id"] = entry_id
    entry.setdefault("status", "active")
    entry.setdefault("confidence", "canonical")
    entry.setdefault("tags", [])
    entry.setdefault("sources", [])
    entry.setdefault("related_ids", [])
    entry.setdefault("superseded_by", None)
    entry["updated_at"] = now
    # Embed the concatenated title + body for retrieval quality.
    embed_text = f"{entry.get('title','')}\n\n{entry.get('body_md','')}"
    old = await db[COLLECTION].find_one({"id": entry_id}, {"body_md": 1, "title": 1})
    needs_embed = True
    if old and old.get("body_md") == entry.get("body_md") and old.get("title") == entry.get("title"):
        needs_embed = False
    if needs_embed:
        emb = await _embed(embed_text)
        if emb:
            entry["embedding"] = emb
    entry.setdefault("created_at", now)
    await db[COLLECTION].update_one(
        {"id": entry_id}, {"$set": entry}, upsert=True,
    )
    return entry


async def count_entries(db: Any) -> int:
    try:
        return await db[COLLECTION].count_documents({})
    except Exception:
        return 0


# ─── CRUD helpers (used by MCGS Knowledge admin routes) ───────────────
def _new_kb_id(prefix: str = "KB") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8].upper()}"


async def create_entry(db: Any, *, entry: dict, authored_by: str | None = None) -> dict:
    """Create a new KB entry. Assigns an id if missing. Embeds title+body
    when possible. Status defaults to `active`; George's chat-proposed
    entries pass `status="draft"` so an admin must confirm them first.
    """
    now = _now()
    entry = dict(entry)
    entry_id = entry.get("id") or _new_kb_id()
    entry["id"] = entry_id
    entry.setdefault("type", "decision")
    if entry["type"] not in ALLOWED_TYPES:
        entry["type"] = "decision"
    entry.setdefault("status", "active")
    entry.setdefault("confidence", "canonical")
    entry.setdefault("tags", [])
    entry.setdefault("sources", [])
    entry.setdefault("related_ids", [])
    entry.setdefault("superseded_by", None)
    entry["title"] = (entry.get("title") or "").strip() or "Untitled"
    entry["body_md"] = (entry.get("body_md") or "").strip()
    entry["created_at"] = now
    entry["updated_at"] = now
    if authored_by:
        entry.setdefault("authored_by", authored_by)
        entry["updated_by"] = authored_by
    # Embed on create (best effort).
    emb = await _embed(f"{entry['title']}\n\n{entry['body_md']}")
    if emb:
        entry["embedding"] = emb
    await db[COLLECTION].insert_one(dict(entry))
    return entry


async def update_entry(
    db: Any, entry_id: str, *, patch: dict, updated_by: str | None = None,
) -> Optional[dict]:
    """Patch an entry. Re-embeds if title or body_md changed."""
    existing = await db[COLLECTION].find_one({"id": entry_id})
    if not existing:
        return None
    allowed = {
        "type", "title", "body_md", "tags", "sources", "related_ids",
        "confidence", "status", "effective_from", "effective_to",
    }
    update = {k: v for k, v in (patch or {}).items() if k in allowed}
    if "type" in update and update["type"] not in ALLOWED_TYPES:
        update.pop("type")
    if "title" in update:
        update["title"] = (update["title"] or "").strip() or existing.get("title", "Untitled")
    if "body_md" in update:
        update["body_md"] = (update["body_md"] or "").strip()
    update["updated_at"] = _now()
    if updated_by:
        update["updated_by"] = updated_by

    title_changed = "title" in update and update["title"] != existing.get("title")
    body_changed = "body_md" in update and update["body_md"] != existing.get("body_md")
    if title_changed or body_changed:
        title = update.get("title", existing.get("title", ""))
        body = update.get("body_md", existing.get("body_md", ""))
        emb = await _embed(f"{title}\n\n{body}")
        if emb:
            update["embedding"] = emb

    await db[COLLECTION].update_one({"id": entry_id}, {"$set": update})
    return await db[COLLECTION].find_one(
        {"id": entry_id}, {"_id": 0, "embedding": 0},
    )


async def confirm_draft(db: Any, entry_id: str, *, confirmed_by: str | None = None) -> Optional[dict]:
    """Promote a `draft` entry to `active` (canonical)."""
    existing = await db[COLLECTION].find_one({"id": entry_id})
    if not existing:
        return None
    update = {
        "status": "active",
        "updated_at": _now(),
        "confirmed_at": _now(),
    }
    if confirmed_by:
        update["confirmed_by"] = confirmed_by
        update["updated_by"] = confirmed_by
    await db[COLLECTION].update_one({"id": entry_id}, {"$set": update})
    return await db[COLLECTION].find_one(
        {"id": entry_id}, {"_id": 0, "embedding": 0},
    )


async def discard_entry(db: Any, entry_id: str, *, hard: bool = False) -> bool:
    """Discard a draft.
    - For `draft` entries, we hard-delete (they never influenced answers).
    - For active/superseded entries, we mark `status="discarded"` to
      preserve the history trail (superseded semantics stay intact).
    Pass ``hard=True`` to force delete regardless of status.
    """
    existing = await db[COLLECTION].find_one({"id": entry_id})
    if not existing:
        return False
    if hard or existing.get("status") == "draft":
        await db[COLLECTION].delete_one({"id": entry_id})
        return True
    await db[COLLECTION].update_one(
        {"id": entry_id},
        {"$set": {"status": "discarded", "updated_at": _now()}},
    )
    return True


async def supersede_entry(
    db: Any,
    old_id: str,
    *,
    new_entry: dict,
    updated_by: str | None = None,
) -> Optional[dict]:
    """Create a new active entry that supersedes ``old_id``. The old
    entry is marked ``status='superseded'`` and points to the new id.
    Related-ids link forward so retrieval always surfaces the newer one.
    """
    old = await db[COLLECTION].find_one({"id": old_id})
    if not old:
        return None
    now = _now()
    new_entry = dict(new_entry)
    new_entry.setdefault("type", old.get("type", "decision"))
    new_entry.setdefault("tags", old.get("tags") or [])
    new_entry.setdefault("sources", old.get("sources") or [])
    # Related links: keep the old entry's related_ids plus a back-link to itself
    related = list(new_entry.get("related_ids") or old.get("related_ids") or [])
    if old_id not in related:
        related.append(old_id)
    new_entry["related_ids"] = related
    new_entry["status"] = "active"
    created = await create_entry(db, entry=new_entry, authored_by=updated_by)
    await db[COLLECTION].update_one(
        {"id": old_id},
        {"$set": {
            "status": "superseded",
            "superseded_by": created["id"],
            "superseded_at": now,
            "updated_at": now,
            "updated_by": updated_by,
        }},
    )
    return created


async def list_drafts(db: Any, limit: int = 100) -> list[dict]:
    cur = db[COLLECTION].find(
        {"status": "draft"}, {"_id": 0, "embedding": 0}
    ).sort("created_at", -1).limit(max(1, min(int(limit), 500)))
    rows = []
    async for r in cur:
        for k in ("created_at", "updated_at", "effective_from", "effective_to"):
            v = r.get(k)
            if hasattr(v, "isoformat"):
                r[k] = v.isoformat()
        rows.append(r)
    return rows


async def backfill_embeddings(db: Any, *, limit: int | None = None) -> dict:
    """Attempt to embed every row missing an embedding. Returns counts."""
    q = {"embedding": {"$exists": False}}
    cur = db[COLLECTION].find(q, {"id": 1, "title": 1, "body_md": 1})
    if limit:
        cur = cur.limit(int(limit))
    ok = failed = 0
    async for r in cur:
        text = f"{r.get('title','')}\n\n{r.get('body_md','')}"
        emb = await _embed(text)
        if emb:
            await db[COLLECTION].update_one(
                {"id": r["id"]},
                {"$set": {"embedding": emb, "updated_at": _now()}},
            )
            ok += 1
        else:
            failed += 1
    return {"embedded": ok, "failed": failed}
