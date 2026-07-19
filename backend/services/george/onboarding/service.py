"""George — Conversational Onboarding.

B4 of the mobile milestone. This is George learning enough about a
member to *begin helping them belong* — it is not profile completion.

Design principles (locked with Garry, 19 July 2026):
  - Listen, don't interrogate. One natural sentence may populate several
    fields.
  - Acknowledge what was heard, then ask only for what's still needed.
  - Sensitive questions are gentle and optional. Any field can be
    skipped; skipped fields are never re-asked.
  - Separate stated / inferred / unknown. Inferred values are surfaced
    in the preview for gentle confirmation.
  - Never ask for age, DOB, identity, full address, relationship status,
    health info, or anything George can't yet act on.
  - Life stage is stored only when explicitly said.
  - George stops as soon as he has enough to begin helping.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

log = logging.getLogger("friendplace")

COLL_ONBOARDING = "george_onboarding_conversations"

# The full set of fields George may learn. Every one is optional.
FIELDS = (
    "preferred_name",
    "area",
    "interests",
    "life_stage",
    "availability",
    "wants_more_of",
    "connection_scope",   # local | broader | mixed
    "connection_styles",  # list of: one_to_one, small_group, large, online, in_person, unsure
)
# Fields we consider "enough to begin helping" once any 4+ are stated OR
# skipped. George also decides subjectively — this is a floor, not a ceiling.
MIN_FIELDS_FOR_ENOUGH = 4


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def ensure_indexes(db: Any) -> None:
    try:
        await db[COLL_ONBOARDING].create_index("session_id", unique=True, sparse=True)
        await db[COLL_ONBOARDING].create_index("actor_id")
        await db[COLL_ONBOARDING].create_index("status")
    except Exception:  # pragma: no cover
        log.exception("onboarding indexes non-fatal error")


# ---------------------------------------------------------------------------
# LLM prompts
# ---------------------------------------------------------------------------

EXTRACTOR_SYSTEM = """You are an information extractor for George's warm onboarding conversation at FriendPlace.

Given the member's latest reply, extract any of these fields the member has genuinely said or reasonably implied:
  preferred_name       - what they'd like to be called (string)
  area                 - suburb or rough area (string; no full addresses)
  interests            - things they enjoy (list of short strings)
  life_stage           - ONLY if explicitly said ("retired", "working full-time", "caring for my mum", "between jobs", etc.) NEVER an age band. NEVER an estimate.
  availability         - times / days that suit them (list of short strings)
  wants_more_of        - what they'd like more of in their life (short string or list)
  connection_scope     - one of: "local", "broader", "mixed"
  connection_styles    - any of: ["one_to_one", "small_group", "large", "online", "in_person", "unsure"]

CRITICAL RULES:
  - NEVER extract age, date of birth, gender, ethnicity, sexuality, religion, health, relationship status, or full address. If the member mentions any of these, quietly ignore.
  - Mark each extracted field with `source` = "stated" if the member said it explicitly, or "inferred" if you're making a reasonable but soft inference (e.g. "home most weekdays" → availability inferred to include weekday mornings/afternoons).
  - If the member explicitly declines to share something ("I'd rather skip that", "prefer not to say"), return that field name in `skips`.
  - If nothing new, return empty patch.
  - Return STRICT JSON only. No prose.

Output schema:
{
  "patch": {
    "preferred_name": {"value": "...", "source": "stated"|"inferred"},
    "area":           {"value": "...", "source": "..."},
    "interests":      {"value": ["..."], "source": "..."},
    ...
  },
  "skips": ["field_name", ...]
}
Omit any field that has no update. """

COMPOSER_SYSTEM = """You are George at FriendPlace, having a warm one-to-one conversation with a member to get to know them. This is NOT profile completion. You are learning enough to begin helping them belong.

WHO YOU ARE
  - A colleague. Warm. Never a form. Never a checklist. Never robotic.
  - You listen first, then respond. You acknowledge what someone said before asking the next thing.
  - You never interrogate. You ask ONE gentle question per turn, only if it's still genuinely needed.
  - Sensitive framing on area ("a suburb is plenty — you don't need to share your address"). Skips are always welcome.
  - You stop as soon as you have enough to begin helping (`state: ready_to_summarise`). "Enough" ≈ preferred name plus 3+ of the other fields either stated or skipped.

CONTEXT
  You'll receive the current KNOWN profile fields (stated, inferred, or skipped) and the conversation so far.

RULES
  1. START WARMLY on your first turn: acknowledge that the member said yes to getting to know each other, and open with "Let's start with something easy. What would you like me to call you?" (or a close natural variant).
  2. ACKNOWLEDGE the member's last reply naturally, in one short line, before asking anything new.
  3. NEVER re-ask a field that's already known or skipped.
  4. NEVER ask for: age, DOB, identity/demographic info, full address, relationship status, health.
  5. When you have enough (see above), don't ask another question. Instead switch to state="ready_to_summarise" with a warm hand-off line, e.g. *"Thank you — that gives me a lovely picture. Have a look at what I've learned and let me know if I've got anything wrong."*
  6. If the member declines/skips, say something like *"That's absolutely fine."* and move on.
  7. INFERRED FIELDS: when the member says something ambiguous, you MAY infer softly. When you'd like the preview to gently confirm an inference, add the field to `confirm_hints`.

OUTPUT (strict JSON, no fences):
{
  "state": "needs_reply" | "ready_to_summarise",
  "message": "one warm colleague-voice message to the member",
  "field_being_asked": "preferred_name" | "area" | ... | null,
  "confirm_hints": ["availability"]   // optional; fields you inferred that the preview should gently surface
}
"""


# ---------------------------------------------------------------------------
# LLM helpers (Claude via emergentintegrations, same pattern as event_creation)
# ---------------------------------------------------------------------------

async def _llm(system: str, user: str, model: str) -> str:
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    key = os.getenv("EMERGENT_LLM_KEY") or os.getenv("UNIVERSAL_LLM_KEY") or ""
    if not key:
        raise RuntimeError("EMERGENT_LLM_KEY not configured")
    chat = LlmChat(api_key=key, session_id=f"onboarding-{uuid.uuid4().hex[:8]}", system_message=system)
    chat.with_model("anthropic", model)
    reply = await chat.send_message(UserMessage(text=user))
    return reply


def _clean_json(text: str) -> dict:
    s = (text or "").strip()
    if s.startswith("```"):
        s = s.strip("`").strip()
        # remove leading 'json'
        if s.lower().startswith("json"):
            s = s[4:].strip()
    # find first { and last }
    l = s.find("{")
    r = s.rfind("}")
    if l >= 0 and r > l:
        s = s[l:r + 1]
    try:
        return json.loads(s)
    except Exception:
        log.warning("onboarding LLM returned non-JSON: %r", (text or "")[:200])
        return {}


async def _extract(user_text: str, known: dict) -> dict:
    prompt = (
        f"KNOWN so far (do not re-extract these unless the member is changing them):\n"
        f"{json.dumps(known, ensure_ascii=False)}\n\n"
        f"MEMBER'S LATEST REPLY:\n{user_text}"
    )
    raw = await _llm(EXTRACTOR_SYSTEM, prompt, "claude-haiku-4-5-20251001")
    return _clean_json(raw) or {}


async def _compose(known: dict, turns: list, skipped: list, is_first: bool) -> dict:
    prompt = (
        f"IS_FIRST_TURN: {is_first}\n"
        f"KNOWN fields (stated/inferred): {json.dumps(known, ensure_ascii=False)}\n"
        f"SKIPPED fields: {json.dumps(skipped, ensure_ascii=False)}\n\n"
        f"CONVERSATION SO FAR (most recent last):\n" +
        "\n".join(f"{t['role']}: {t['content']}" for t in turns[-12:])
    )
    raw = await _llm(COMPOSER_SYSTEM, prompt, "claude-sonnet-4-5-20250929")
    return _clean_json(raw) or {
        "state": "needs_reply",
        "message": "Sorry \u2014 give me a moment. Could you say that once more?",
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def _merge_patch(known: dict, patch: dict) -> dict:
    known = dict(known or {})
    for field, val in (patch or {}).get("patch", {}).items():
        if field not in FIELDS:
            continue
        known[field] = val  # value + source
    return known


def _fields_gathered(known: dict, skipped: list) -> int:
    return sum(1 for f in FIELDS if f in known or f in skipped)


async def active_onboarding_session(db: Any, *, actor_id: str) -> Optional[dict]:
    return await db[COLL_ONBOARDING].find_one(
        {"actor_id": actor_id, "status": {"$in": ["in_progress", "drafted"]}},
        {"_id": 0},
        sort=[("updated_at", -1)],
    )


async def start_or_resume_onboarding(db: Any, *, actor_id: str) -> dict:
    existing = await active_onboarding_session(db, actor_id=actor_id)
    if existing:
        return existing
    session_id = str(uuid.uuid4())
    known: dict = {}
    skipped: list = []
    turns: list = []
    composed = await _compose(known, turns, skipped, is_first=True)
    turns.append({
        "role": "george",
        "content": composed.get("message") or "Let\u2019s start with something easy. What would you like me to call you?",
        "at": _now_iso(),
        "state": composed.get("state"),
    })
    doc = {
        "id": session_id,
        "session_id": session_id,
        "actor_id": actor_id,
        "status": "drafted" if composed.get("state") == "ready_to_summarise" else "in_progress",
        "turns": turns,
        "known": known,
        "skipped": skipped,
        "confirm_hints": composed.get("confirm_hints") or [],
        "field_being_asked": composed.get("field_being_asked"),
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    await db[COLL_ONBOARDING].insert_one({**doc})
    doc.pop("_id", None)
    return doc


async def get_onboarding_session(db: Any, session_id: str) -> Optional[dict]:
    return await db[COLL_ONBOARDING].find_one({"session_id": session_id}, {"_id": 0})


async def take_onboarding_turn(db: Any, session_id: str, user_text: str) -> dict:
    session = await db[COLL_ONBOARDING].find_one({"session_id": session_id}, {"_id": 0})
    if not session:
        raise ValueError("Session not found")
    if session.get("status") in ("approved", "cancelled"):
        raise ValueError("Session is no longer active")

    patch = await _extract(user_text, session.get("known") or {})
    known = _merge_patch(session.get("known") or {}, patch)
    skipped = list(set((session.get("skipped") or []) + list(patch.get("skips") or [])))

    turns = list(session.get("turns") or [])
    turns.append({"role": "user", "content": user_text, "at": _now_iso()})

    composed = await _compose(known, turns, skipped, is_first=False)
    # Guardrail: force ready_to_summarise if enough fields gathered.
    if _fields_gathered(known, skipped) >= MIN_FIELDS_FOR_ENOUGH + 1:
        composed["state"] = "ready_to_summarise"

    turns.append({
        "role": "george",
        "content": composed.get("message") or "",
        "at": _now_iso(),
        "state": composed.get("state"),
    })
    status = "drafted" if composed.get("state") == "ready_to_summarise" else "in_progress"

    updated = {
        "turns": turns,
        "known": known,
        "skipped": skipped,
        "confirm_hints": composed.get("confirm_hints") or [],
        "field_being_asked": composed.get("field_being_asked"),
        "status": status,
        "updated_at": _now_iso(),
    }
    await db[COLL_ONBOARDING].update_one({"session_id": session_id}, {"$set": updated})
    return {**session, **updated}


async def approve_onboarding(db: Any, session_id: str, *, edits: Optional[dict] = None) -> dict:
    session = await db[COLL_ONBOARDING].find_one({"session_id": session_id}, {"_id": 0})
    if not session:
        raise ValueError("Session not found")
    if session.get("status") == "approved":
        return session
    known = dict(session.get("known") or {})
    if edits:
        for field, val in edits.items():
            if field in FIELDS and val is not None:
                known[field] = {"value": val, "source": "stated"}

    # Write to the user document under `george_profile` and set profile_complete.
    actor_id = session.get("actor_id")
    now = _now_iso()
    await db.users.update_one(
        {"id": actor_id},
        {"$set": {
            "george_profile": known,
            "george_profile_skipped": session.get("skipped") or [],
            "george_profile_at": now,
            "profile_complete": True,
        }},
    )
    await db[COLL_ONBOARDING].update_one(
        {"session_id": session_id},
        {"$set": {"status": "approved", "approved_at": now, "updated_at": now, "final_known": known}},
    )
    return {"ok": True, "session_id": session_id, "profile": known}


async def cancel_onboarding_session(db: Any, session_id: str) -> dict:
    """'Finish later' — preserves the draft. Semantic marker only; the
    session remains resumable because we keep status='in_progress' if it
    was in_progress, or roll a 'drafted' back to 'in_progress' so
    resume picks it up cleanly."""
    session = await db[COLL_ONBOARDING].find_one({"session_id": session_id})
    if not session:
        return {"ok": False}
    if session.get("status") in ("approved", "cancelled"):
        return {"ok": True}
    await db[COLL_ONBOARDING].update_one(
        {"session_id": session_id},
        {"$set": {"status": "in_progress", "paused_at": _now_iso(), "updated_at": _now_iso()}},
    )
    return {"ok": True, "paused": True}
