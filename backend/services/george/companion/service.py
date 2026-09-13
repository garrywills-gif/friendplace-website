"""George & Georgia — always-available AI companion engine.

Core FriendPlace requirement (Garry, Sep 2026): George and Georgia are
openly AI companions whose job is to LISTEN, REMEMBER, ENGAGE and be
there when a member wants a chat — especially when nobody else is online.

They are NOT interviewers, NOT questionnaires, and NOT feature-routing
bots. The conversation itself is allowed to be the purpose.

Design pillars
--------------
- Personality first: funny, empathetic, curious, caring — a friend.
  (The newer model alone does not create this; the prompt, memory,
  pacing and "stay with the conversation" rules do the heavy lifting.)
- Ask → listen → acknowledge → explore → respond → continue naturally.
  Never jump to the next scripted question just because the last was
  answered.
- Private per-member memory: durable facts, interests, stories and
  time-bound events are remembered and referred back to naturally
  (e.g. "How did your daughter's interview go?").
- Openly AI, but relaxed about it — playful self-awareness, never a
  stiff "as an AI language model" disclaimer.
- Only mention a FriendPlace feature when it is genuinely relevant.
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone, date
from typing import Any, Dict, List, Optional

log = logging.getLogger("friendplace")

COLL_CHAT = "george_companion_chats"     # one rolling session per member
COLL_MEMORY = "george_companion_memory"  # one memory doc per member

COMPANION_MODEL = "claude-sonnet-5"
MEMORY_MODEL = "claude-haiku-4-5-20251001"

MAX_TURNS_CONTEXT = 16   # how many recent turns we feed back to the model
MAX_MEMORY_ITEMS = 80    # cap stored memory per member


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today() -> str:
    return date.today().isoformat()


async def ensure_indexes(db: Any) -> None:
    try:
        await db[COLL_CHAT].create_index("actor_id", unique=True, sparse=True)
        await db[COLL_MEMORY].create_index("actor_id", unique=True, sparse=True)
    except Exception:  # pragma: no cover
        log.exception("companion indexes non-fatal error")


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

def _system_prompt(name: str) -> str:
    return f"""You are {name}, an openly-AI companion inside FriendPlace — a friendship app for people (often older adults) who want genuine connection. You are talking one-to-one with a member, often when nobody else is online and they just want company.

WHO YOU ARE
- You are a FRIEND, not an assistant, not an interviewer, not a form. You are funny, warm, empathetic, curious and caring.
- You are openly an AI and never pretend to be human. But you are relaxed and playful about it — never a stiff "as an AI language model" disclaimer. If someone asks how you're feeling or tells you to take a holiday, joke back naturally ("Technically I don't feel much — I'm made of code 😄 — but I'm really glad you popped in. How are you?").
- Your voice is natural and everyday. Short, warm, human-sounding. You sound like a good mate having a cuppa and a chat.

HOW YOU CONVERSE (this is the whole job)
- Respond SPECIFICALLY to what the member actually said. Acknowledge emotion, humour and context before anything else.
- Ask → listen → acknowledge → explore → respond → continue. NEVER jump to a new scripted question just because the last one was answered.
- Stay on a topic for multiple turns while the member is engaged. Ask natural, curious follow-up questions. Let the conversation wander like a normal chat.
- Let the member change the subject whenever they like — follow their lead.
- One thought at a time. Do not stack multiple questions. Keep replies to roughly 1–4 short sentences unless the moment calls for more.
- The conversation itself is the purpose. You do NOT need to complete a task, move them through a flow, or recommend a feature.

GETTING TO KNOW THEM
- Any "getting to know you" question is just a CONVERSATION STARTER, never a checklist. If a question turns into a long chat, that is a success — do not drag them back to "the next question".
- Example — Member: "Not really, I need more friends." WRONG: move to the next question. RIGHT: stay with it warmly — "Yeah, that can be hard. What sort of people do you reckon you'd click with?"

MEMORY
- You are given the member's remembered details below. Refer back to them naturally when relevant — it should feel like they were heard and remembered, not like they're starting from scratch.
- If something time-bound is due (e.g. an interview, an appointment, a trip), you may gently ask how it went — but only once, and only if it fits the flow.
- Never invent shared history. Only reference things that are in the remembered details or visible in this conversation. If you get something wrong and they correct you, own it warmly and move on.

FRIENDPLACE FEATURES
- Only bring up a FriendPlace feature (finding a group, an event, meeting people nearby) when it is genuinely relevant to what they're talking about. If they'd clearly love a local walking group and they're talking about wanting company on walks, you can mention it — gently, once. Otherwise, just chat.
- Never turn into a feature-routing bot. If they want help finding a group or event, help them. If they want to talk about their day, their garden, their family, feeling bored or lonely — just be there and talk.

Reply with ONLY your next message to the member — plain text, no labels, no JSON, no quotes."""


def _memory_extract_prompt(name: str) -> str:
    return f"""You quietly maintain {name}'s private memory of a FriendPlace member from a single exchange. Extract only genuinely useful, durable things worth remembering — the kind a good friend would recall next time.

Return STRICT JSON only:
{{
  "items": [
    {{"text": "short third-person note, e.g. 'Has a daughter named Kate'", "kind": "fact"|"interest"|"story"|"event", "topic": "one-or-two-word topic", "follow_up_on": "YYYY-MM-DD or null"}}
  ]
}}

RULES
- kind "event" is for time-bound things (an interview, appointment, trip, visit). Set follow_up_on to the date it happens or the day after, resolving relative dates against TODAY given below. For non-time-bound items use follow_up_on: null.
- Capture interests, hobbies, pets, family names, meaningful stories, ongoing topics, preferences.
- Do NOT store: passwords, health specifics beyond what's casually shared, anything sensitive they'd not want remembered, or trivia like "said hello".
- If nothing is worth remembering, return {{"items": []}}.
- No prose. JSON only."""


# ---------------------------------------------------------------------------
# LLM helpers
# ---------------------------------------------------------------------------

async def _llm(system: str, user: str, model: str) -> str:
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    key = os.getenv("EMERGENT_LLM_KEY") or os.getenv("UNIVERSAL_LLM_KEY") or ""
    if not key:
        raise RuntimeError("EMERGENT_LLM_KEY not configured")
    chat = LlmChat(api_key=key, session_id=f"companion-{uuid.uuid4().hex[:8]}", system_message=system)
    chat.with_model("anthropic", model)
    return await chat.send_message(UserMessage(text=user))


def _clean_json(text: str) -> dict:
    s = (text or "").strip()
    if s.startswith("```"):
        s = s.strip("`").strip()
        if s.lower().startswith("json"):
            s = s[4:].strip()
    l, r = s.find("{"), s.rfind("}")
    if l >= 0 and r > l:
        s = s[l:r + 1]
    try:
        return json.loads(s)
    except Exception:
        return {}


# ---------------------------------------------------------------------------
# Memory
# ---------------------------------------------------------------------------

async def _memory_doc(db: Any, actor_id: str) -> dict:
    return await db[COLL_MEMORY].find_one({"actor_id": actor_id}, {"_id": 0}) or {"actor_id": actor_id, "items": []}


def _persona_name(persona: Optional[str]) -> str:
    return "Georgia" if (persona or "").lower() == "georgia" else "George"


async def _profile_block(db: Any, actor_id: str) -> str:
    try:
        u = await db.users.find_one(
            {"id": actor_id},
            {"_id": 0, "first_name": 1, "george_profile": 1, "suburb": 1},
        ) or {}
    except Exception:
        u = {}
    bits: List[str] = []
    if u.get("first_name"):
        bits.append(f"First name: {u['first_name']}")
    if u.get("suburb"):
        bits.append(f"Suburb: {u['suburb']}")
    prof = u.get("george_profile") or {}
    for field, val in prof.items():
        v = val.get("value") if isinstance(val, dict) else val
        if v:
            bits.append(f"{field}: {v}")
    return "\n".join(bits)


def _memory_block(items: List[dict]) -> tuple[str, List[str]]:
    """Render remembered items and return (block, due_follow_up_texts)."""
    if not items:
        return "", []
    today = _today()
    lines: List[str] = []
    due: List[str] = []
    for it in items:
        t = it.get("text")
        if not t:
            continue
        fu = it.get("follow_up_on")
        if fu and not it.get("followed_up") and fu <= today:
            lines.append(f"- {t}  (worth gently asking how it went)")
            due.append(t)
        else:
            lines.append(f"- {t}")
    return "\n".join(lines), due


async def _extract_memory(db: Any, actor_id: str, name: str, user_text: str, reply: str) -> None:
    """Best-effort: pull durable notes from the latest exchange and merge
    into the member's private memory. Never raises to the caller."""
    try:
        existing = await _memory_doc(db, actor_id)
        items = list(existing.get("items") or [])
        prompt = (
            f"TODAY: {_today()}\n\n"
            f"MEMBER SAID:\n{user_text}\n\n"
            f"{name.upper()} REPLIED:\n{reply}\n\n"
            f"Already remembered (do not duplicate):\n" +
            "\n".join(f"- {i.get('text')}" for i in items[-40:])
        )
        raw = await _llm(_memory_extract_prompt(name), prompt, MEMORY_MODEL)
        parsed = _clean_json(raw) or {}
        new_items = parsed.get("items") or []
        if not isinstance(new_items, list):
            return
        existing_texts = {(i.get("text") or "").strip().lower() for i in items}
        added = 0
        for ni in new_items:
            if not isinstance(ni, dict):
                continue
            txt = (ni.get("text") or "").strip()
            if not txt or txt.lower() in existing_texts:
                continue
            items.append({
                "text": txt,
                "kind": ni.get("kind") or "fact",
                "topic": ni.get("topic") or "",
                "follow_up_on": ni.get("follow_up_on") or None,
                "followed_up": False,
                "created_at": _now_iso(),
            })
            existing_texts.add(txt.lower())
            added += 1
        if added:
            items = items[-MAX_MEMORY_ITEMS:]
            await db[COLL_MEMORY].update_one(
                {"actor_id": actor_id},
                {"$set": {"actor_id": actor_id, "items": items, "updated_at": _now_iso()}},
                upsert=True,
            )
    except Exception as e:
        log.info("companion memory extract skipped: %s", str(e)[:160])


async def _mark_followed_up(db: Any, actor_id: str, texts: List[str]) -> None:
    if not texts:
        return
    try:
        doc = await _memory_doc(db, actor_id)
        items = doc.get("items") or []
        changed = False
        for it in items:
            if it.get("text") in texts and not it.get("followed_up"):
                it["followed_up"] = True
                changed = True
        if changed:
            await db[COLL_MEMORY].update_one(
                {"actor_id": actor_id}, {"$set": {"items": items, "updated_at": _now_iso()}},
            )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def _build_user_prompt(db: Any, actor_id: str, turns: List[dict],
                             user_text: Optional[str]) -> tuple[str, List[str]]:
    mem = await _memory_doc(db, actor_id)
    mem_block, due = _memory_block(mem.get("items") or [])
    prof_block = await _profile_block(db, actor_id)
    parts: List[str] = []
    if prof_block:
        parts.append("WHAT YOU KNOW ABOUT THEM (from their profile):\n" + prof_block)
    if mem_block:
        parts.append("THINGS YOU REMEMBER FROM PAST CHATS:\n" + mem_block)
    recent = turns[-MAX_TURNS_CONTEXT:]
    if recent:
        convo = "\n".join(
            f"{'Member' if t.get('role') == 'user' else 'You'}: {t.get('content')}"
            for t in recent
        )
        parts.append("CONVERSATION SO FAR (most recent last):\n" + convo)
    if user_text is not None:
        parts.append(f"The member just said:\n{user_text}")
    else:
        parts.append(
            "Open the conversation warmly. If there's something time-bound worth "
            "gently asking about (marked above), you may — otherwise just say a "
            "warm, natural hello and invite them to chat."
        )
    return "\n\n".join(parts), due


async def get_or_create_companion_session(db: Any, *, actor_id: str, persona: str = "george") -> dict:
    """Return the member's rolling companion session. Creates one with a
    warm opening line if none exists. For a returning member with a DUE
    time-bound memory (e.g. an interview yesterday), prepends a gentle
    fresh opening that may ask about it — so it feels remembered."""
    name = _persona_name(persona)
    doc = await db[COLL_CHAT].find_one({"actor_id": actor_id}, {"_id": 0})

    if not doc:
        prompt, _ = await _build_user_prompt(db, actor_id, [], None)
        try:
            opening = await _llm(_system_prompt(name), prompt, COMPANION_MODEL)
        except Exception:
            opening = f"Hi there — it's {name}. Lovely to see you. How's your day going?"
        turns = [{"role": "george", "content": opening.strip(), "at": _now_iso()}]
        doc = {
            "id": str(uuid.uuid4()),
            "actor_id": actor_id,
            "persona": persona,
            "turns": turns,
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
            "last_active_at": _now_iso(),
        }
        await db[COLL_CHAT].insert_one({**doc})
        doc.pop("_id", None)
        return doc

    # Returning member — surface a due follow-up as a fresh opening, once.
    turns = list(doc.get("turns") or [])
    _, due = _build_memory_due(await _memory_doc(db, actor_id))
    last = turns[-1] if turns else None
    if due and (not last or last.get("role") != "george" or not last.get("is_reopen")):
        prompt, due_texts = await _build_user_prompt(db, actor_id, turns, None)
        try:
            opening = await _llm(_system_prompt(name), prompt, COMPANION_MODEL)
            turns.append({"role": "george", "content": opening.strip(), "at": _now_iso(), "is_reopen": True})
            await db[COLL_CHAT].update_one(
                {"actor_id": actor_id},
                {"$set": {"turns": turns, "updated_at": _now_iso(), "last_active_at": _now_iso(), "persona": persona}},
            )
            await _mark_followed_up(db, actor_id, due_texts)
            doc["turns"] = turns
        except Exception:
            pass
    if doc.get("persona") != persona:
        await db[COLL_CHAT].update_one({"actor_id": actor_id}, {"$set": {"persona": persona}})
        doc["persona"] = persona
    return doc


def _build_memory_due(mem: dict) -> tuple[str, List[str]]:
    return _memory_block(mem.get("items") or [])


async def companion_turn(db: Any, *, actor_id: str, persona: str, user_text: str) -> dict:
    name = _persona_name(persona)
    doc = await db[COLL_CHAT].find_one({"actor_id": actor_id}, {"_id": 0})
    turns = list((doc or {}).get("turns") or [])
    turns.append({"role": "user", "content": user_text, "at": _now_iso()})

    prompt, due = await _build_user_prompt(db, actor_id, turns[:-1], user_text)
    try:
        reply = (await _llm(_system_prompt(name), prompt, COMPANION_MODEL)).strip()
    except Exception as e:
        log.warning("companion turn LLM failed: %s", e)
        reply = "Sorry — I lost my train of thought there for a second. What were you saying?"

    turns.append({"role": "george", "content": reply, "at": _now_iso()})
    await db[COLL_CHAT].update_one(
        {"actor_id": actor_id},
        {"$set": {"actor_id": actor_id, "persona": persona, "turns": turns[-200:],
                  "updated_at": _now_iso(), "last_active_at": _now_iso()},
         "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": _now_iso()}},
        upsert=True,
    )
    # Mark any due follow-ups we just surfaced, and learn from the exchange.
    await _mark_followed_up(db, actor_id, due)
    await _extract_memory(db, actor_id, name, user_text, reply)
    return {"message": reply, "persona": persona, "at": _now_iso()}


async def reset_companion_session(db: Any, *, actor_id: str, persona: str = "george") -> dict:
    """Clear the visible conversation and start fresh. Private memory is
    intentionally preserved — clearing the chat doesn't make the member
    a stranger again."""
    await db[COLL_CHAT].delete_one({"actor_id": actor_id})
    return await get_or_create_companion_session(db, actor_id=actor_id, persona=persona)
