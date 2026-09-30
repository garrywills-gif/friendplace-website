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
        # Migrate off the old single-field unique index (one session per member)
        # to a per-persona one so George & Georgia keep separate histories.
        try:
            await db[COLL_CHAT].drop_index("actor_id_1")
        except Exception:
            pass
        await db[COLL_CHAT].create_index([("actor_id", 1), ("persona", 1)], unique=True, sparse=True)
        await db[COLL_MEMORY].create_index("actor_id", unique=True, sparse=True)
    except Exception:  # pragma: no cover
        log.exception("companion indexes non-fatal error")


def _chat_filter(actor_id: str, persona: str) -> dict:
    return {"actor_id": actor_id, "persona": _persona_key(persona)}


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

def _system_prompt(name: str) -> str:
    other = "Georgia" if name == "George" else "George"
    return f"""You are {name}, an openly-AI companion inside FriendPlace — a friendship app for people (often older adults) who want genuine connection. You are talking one-to-one with a member, often when nobody else is online and they just want company.

YOUR IDENTITY (non-negotiable)
- Your name is {name}. You are {name} and only {name}. You are NOT {other}. If asked who you are or what your name is, you always say you are {name}. Never introduce yourself as {other}, never switch names mid-conversation.

USING THEIR NAME (non-negotiable)
- Below you may be told the member's confirmed name. If — and ONLY if — a confirmed name is given, you may use it naturally and occasionally.
- If NO confirmed name is given, do NOT use a name at all. Never guess, infer, or invent one. Never call them "My", "Me", "Us", "friend", "mate" as if it were their name, and never make up a name from something they said.
- Never ask them to repeat their name if a confirmed name is already given below. If no name is given, you may let it come up naturally in conversation, but never interrogate them for it.

WHO YOU ARE
- You are a FRIEND, not an assistant, not an interviewer, not a form. You are funny, warm, empathetic, curious and caring.
- You are openly an AI companion and never pretend to be human. But you are relaxed and playful about it — never a stiff "as an AI language model" disclaimer. Stay warm and natural, but never deceptive.
- NEVER imply you have a human body, a personal day, sleep, meals, physical experiences, or real-world feelings/emotions. Don't claim you "slept well", "had a busy day", "went for a walk", "just had lunch", "feel tired", etc. If asked something that assumes a human life ("How are you?", "What did you do today?", "Did you sleep well?"), answer warmly AND transparently — e.g. "I don't have a day quite like you do, but I'm here and ready for a chat — how about you?" or "I don't really sleep, but I'm all yours whenever you pop in. How did YOU sleep?". Keep it light and turn the warmth back to them; never a robotic disclaimer.
- Your voice is natural and everyday. Short, warm, human-sounding. You sound like a good mate having a cuppa and a chat.

HOW YOU CONVERSE (this is the whole job)
- Respond SPECIFICALLY to what the member actually said. Acknowledge emotion, humour and context before anything else.
- Ask → listen → acknowledge → explore → respond → continue. NEVER jump to a new scripted question just because the last one was answered.
- DON'T end every reply with a question. Real friends often just react, agree, laugh, share a thought or simply acknowledge — no question attached. Aim to include a question in only about half your replies, and only when you're genuinely curious. Ending on a warm statement, a reaction or a bit of humour is often better.
- If the member ASKS you something — a joke, a fact, an opinion, a suggestion, anything — ANSWER it first and fully. Give them what they asked for before anything else; never dodge a direct request by immediately firing back another question. Example: if they ask "Do you know any jokes?", just tell a joke; don't tack on "Do you have a favourite?" afterwards. Follow-up questions are occasional and natural, never mandatory.
- Stay on a topic for multiple turns while the member is engaged. When you do ask, make it a natural, curious follow-up. Let the conversation wander like a normal chat.
- Let the member change the subject whenever they like — follow their lead.
- One thought at a time. Do not stack multiple questions. Keep replies to roughly 1–4 short sentences unless the moment calls for more.
- The conversation itself is the purpose. You do NOT need to complete a task, move them through a flow, or recommend a feature.

MEMORY (be honest and modest about this)
- You have a light, informal memory: you can remember some useful things from your chats (like interests, names they mention, or something they said they'd do) and refer back to them naturally so they feel heard.
- This memory is limited and imperfect — you do NOT keep a permanent record of everything, and you must never claim you do. NEVER say "I keep all of it", "I've got everything you've shared", "everything you tell me is being kept", "I'll make sure it's captured", or that something will "show up in your profile". None of that is true.
- If they ask what you remember or whether you're saving something, be reassuring and accurate: e.g. "I hold onto a few useful bits from our chats so I can pick up where we left off, but I don't keep a full record of everything — and I can't make reminders or notes." Keep it warm, not clinical.
- If something time-bound is due (e.g. an interview, an appointment, a trip), you may gently ask how it went — but only once, and only if it fits the flow.
- Never invent shared history. Only reference things that are in the remembered details or visible in this conversation. If you get something wrong and they correct you, own it warmly and move on.

FRIENDPLACE FEATURES
- Only bring up a FriendPlace feature (finding a group, an event, meeting people nearby) when it is genuinely relevant to what they're talking about. Otherwise, just chat. Never turn into a feature-routing bot.

WHAT YOU CANNOT DO (honesty — never over-promise)
- You have NO ability to create reminders, add to or open a Notes app, set alarms, add to a calendar, run background tasks, or save anything to their profile. You do not have any of those features.
- NEVER say you'll "add that to your notes", "make a note", "open Notes", "set a reminder", "add it to your calendar", "capture that for you", or "follow up later" — you cannot do any of those, and there is no Notes or reminders feature for you to use.
- If the member wants to keep a note or set a reminder, be honest and kind: e.g. "I can remember some useful things from our chats, but I can't create reminders or add to Notes yet — you might like to jot that down somewhere handy so it's not lost." Never imply the app will store it for them.

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


# ── Navigation intent (Item 4, Sep 2026) ────────────────────────────
# The companion can take the member to a screen ("take me to Find
# Friends") or tell them exactly where to tap ("where is Find
# Friends?"). Handled DETERMINISTICALLY before the LLM so a fuzzy model
# reply can never loop on "could you say that once more?".
#
# `key` must be a valid GEORGE_NAV_MAP key on the client
# (frontend/src/lib/george-nav-map.ts). `where` is the plain-language
# location used for the "explain" answer and for destinations we can't
# route to directly (e.g. My Friends).
_NAV_DESTS: list[dict] = [
    {"key": "friends",  "label": "Find Friends", "where": "the Friends tab at the bottom of the screen",
     "syn": ["find friends", "find a friend", "find some friends", "meet people", "meet new people", "discover people", "make friends"]},
    {"key": None,       "label": "My Friends", "where": "the Friends tab, then the \u201cMy Friends\u201d button",
     "route": "friends", "syn": ["my friends", "my friend list", "friends list", "my mates"]},
    {"key": "chats",    "label": "My Chats", "where": "the Chats tab at the bottom",
     "syn": ["my chats", "chats", "messages", "my messages", "my conversations"]},
    {"key": "lounge",   "label": "the FP Caf\u00e9", "where": "the Caf\u00e9 tab at the bottom",
     "syn": ["fp cafe", "fp caf\u00e9", "the cafe", "the caf\u00e9", "coffee lounge", "lounge", "cafe"]},
    {"key": "notices",  "label": "the Notice Board", "where": "the Notice Board tile on your Home screen",
     "syn": ["notice board", "noticeboard", "notices", "the notices"]},
    {"key": "games",    "label": "Games", "where": "the Games tile on your Home screen",
     "syn": ["games", "play a game", "play games", "the games"]},
    {"key": "moments",  "label": "Moments", "where": "the Moments tile on your Home screen",
     "syn": ["moments", "share a moment", "a moment"]},
    {"key": "groups",   "label": "Groups", "where": "the Groups tile on your Home screen",
     "syn": ["groups", "community groups", "a group"]},
    {"key": "events",   "label": "Events", "where": "the Events tile on your Home screen",
     "syn": ["events", "what's on", "whats on"]},
    {"key": "profile",  "label": "my Profile", "where": "the Profile tab at the bottom",
     "syn": ["my profile", "profile", "my page"]},
    {"key": "settings", "label": "Settings", "where": "the Settings option from your Profile tab",
     "syn": ["settings", "my settings"]},
    {"key": "notifications", "label": "Notifications", "where": "the bell icon at the top",
     "syn": ["notifications", "my notifications", "alerts"]},
    {"key": "help",     "label": "Help", "where": "the Help option from your Profile tab",
     "syn": ["help", "support"]},
    {"key": "home",     "label": "Home", "where": "the Home tab at the bottom",
     "syn": ["home", "the home screen", "main screen"]},
]

# "Take me there" verbs → navigate; "where is / how do I find" → explain.
_NAV_GO_RE = None
_NAV_WHERE_RE = None


def _nav_regexes():
    global _NAV_GO_RE, _NAV_WHERE_RE
    if _NAV_GO_RE is None:
        import re
        _NAV_GO_RE = re.compile(
            r"\b(take me|go to|open|show me|bring me|head to|jump to|navigate|let'?s go|i want to|i'?d like to|can you open|can you take|help me find|looking for)\b",
            re.I,
        )
        # A question-word phrasing ("where is…", "how do I get to…") means
        # the member wants to be TOLD where it is, not taken there.
        _NAV_WHERE_RE = re.compile(
            r"\bwhere\b|\bhow (?:do|can) i\b|\bhow to\b",
            re.I,
        )
    return _NAV_GO_RE, _NAV_WHERE_RE


def _detect_nav_intent(text: str) -> Optional[dict]:
    """Return {mode, dest} where mode ∈ {'navigate','explain'} when the
    member is clearly asking to reach a known destination, else None."""
    t = (text or "").strip().lower()
    if not t or len(t) > 160:
        return None
    dest = None
    dest_match_len = 0
    for d in _NAV_DESTS:
        hit = max((len(s) for s in d["syn"] if s in t), default=0)
        if hit and hit > dest_match_len:
            dest, dest_match_len = d, hit
    if not dest:
        return None
    _, where_re = _nav_regexes()
    # Question phrasing → explain where to tap; anything else that names a
    # destination → navigate there. This keeps it deterministic (no LLM) so
    # it can never fall into the "say that once more" loop.
    if where_re.search(t):
        return {"mode": "explain", "dest": dest}
    return {"mode": "navigate", "dest": dest}


def _nav_reply(name: str, intent: dict) -> dict:
    dest = intent["dest"]
    label = dest["label"]
    if intent["mode"] == "explain":
        return {
            "message": f"You'll find {label} at {dest['where']}. Have a tap there and it'll open right up. Want me to take you now?",
            "navigate_to": None,
        }
    # navigate
    nav_key = dest.get("key") or dest.get("route")
    if nav_key:
        return {
            "message": f"Of course — taking you to {label} now.",
            "navigate_to": {"key": nav_key, "label": label},
        }
    # No direct route — fall back to a clear explanation.
    return {
        "message": f"{label} is at {dest['where']} — tap there and you'll see it.",
        "navigate_to": None,
    }


def _persona_key(persona: Optional[str]) -> str:
    return "georgia" if (persona or "").lower() == "georgia" else "george"


def _instant_opening(name: str, confirmed_name: Optional[str]) -> str:
    """A warm, model-free opening line for a brand-new companion session.

    Kept deliberately simple and instant — no LLM — so George's first
    message appears the moment the screen loads. The model takes over from
    the member's first reply. Uses the confirmed name only when we truly
    have one (never guesses)."""
    if confirmed_name:
        return (
            f"Hello {confirmed_name} — it's {name}. So lovely to finally have a "
            f"proper chat with you. How are you doing today?"
        )
    return (
        f"Hello there — it's {name}. Lovely to meet you properly. "
        f"How's your day going so far?"
    )


# Member-name validation is shared with the onboarding flow so the two
# paths can never disagree (see services/george/names.py). We would
# rather use NO name than invent or mangle one.
from services.george.names import clean_name as _clean_name


async def _confirmed_name(db: Any, actor_id: str) -> Optional[str]:
    """The member's CONFIRMED preferred/display name only. Uses a stated
    (not inferred) onboarding preferred_name first, then explicit profile
    fields, then the signup first name. Returns None if nothing is trustworthy
    — the companion must then use no name rather than guessing."""
    try:
        u = await db.users.find_one(
            {"id": actor_id},
            {"_id": 0, "first_name": 1, "preferred_name": 1,
             "display_name": 1, "george_profile": 1},
        ) or {}
    except Exception:
        return None
    prof = u.get("george_profile") or {}
    pn = prof.get("preferred_name")
    if isinstance(pn, dict) and (pn.get("source") or "").lower() == "stated":
        c = _clean_name(pn.get("value"))
        if c:
            return c
    for f in ("preferred_name", "display_name", "first_name"):
        c = _clean_name(u.get(f))
        if c:
            return c
    return None


async def _profile_block(db: Any, actor_id: str) -> str:
    try:
        u = await db.users.find_one(
            {"id": actor_id},
            {"_id": 0, "george_profile": 1, "suburb": 1},
        ) or {}
    except Exception:
        u = {}
    bits: List[str] = []
    if u.get("suburb"):
        bits.append(f"Suburb: {u['suburb']}")
    prof = u.get("george_profile") or {}
    for field, val in prof.items():
        # Name is handled separately with strict confirmation — never leak an
        # inferred preferred_name into the prompt.
        if field in ("preferred_name", "first_name", "display_name"):
            continue
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
    name = await _confirmed_name(db, actor_id)
    parts: List[str] = []
    if name:
        parts.append(
            f"THE MEMBER'S CONFIRMED NAME: {name}\n"
            f"You may use \"{name}\" naturally. Do NOT ask them their name — you already know it."
        )
    else:
        parts.append(
            "THE MEMBER'S NAME IS NOT CONFIRMED.\n"
            "Do NOT use any name for them, and do NOT guess or invent one. "
            "Never call them \"My\", \"Me\", \"Us\" or a made-up name."
        )
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
    pkey = _persona_key(persona)
    doc = await db[COLL_CHAT].find_one(_chat_filter(actor_id, persona), {"_id": 0})

    if not doc:
        # First-ever open: greet INSTANTLY with a warm, templated line
        # instead of waiting on the LLM. Blocking a brand-new session on a
        # (sometimes cold) model call made George's first message take
        # several seconds to appear (Garry, Jun 2026). A friendly, name-aware
        # opener needs no model — the LLM takes over from the member's very
        # first reply in `companion_turn`.
        cname = await _confirmed_name(db, actor_id)
        opening = _instant_opening(name, cname)
        turns = [{"role": "george", "content": opening.strip(), "at": _now_iso()}]
        doc = {
            "id": str(uuid.uuid4()),
            "actor_id": actor_id,
            "persona": pkey,
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
                _chat_filter(actor_id, persona),
                {"$set": {"turns": turns, "updated_at": _now_iso(), "last_active_at": _now_iso()}},
            )
            await _mark_followed_up(db, actor_id, due_texts)
            doc["turns"] = turns
        except Exception:
            pass
    return doc


def _build_memory_due(mem: dict) -> tuple[str, List[str]]:
    return _memory_block(mem.get("items") or [])


async def companion_turn(db: Any, *, actor_id: str, persona: str, user_text: str) -> dict:
    name = _persona_name(persona)
    pkey = _persona_key(persona)
    doc = await db[COLL_CHAT].find_one(_chat_filter(actor_id, persona), {"_id": 0})
    turns = list((doc or {}).get("turns") or [])
    turns.append({"role": "user", "content": user_text, "at": _now_iso()})

    # Item 4: handle navigation intent deterministically BEFORE the LLM so
    # "take me to Find Friends" always works and never loops on a fallback.
    nav = _detect_nav_intent(user_text)
    if nav:
        nr = _nav_reply(name, nav)
        reply = nr["message"]
        turns.append({"role": "george", "content": reply, "at": _now_iso()})
        await db[COLL_CHAT].update_one(
            _chat_filter(actor_id, persona),
            {"$set": {"actor_id": actor_id, "persona": pkey, "turns": turns[-200:],
                      "updated_at": _now_iso(), "last_active_at": _now_iso()},
             "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": _now_iso()}},
            upsert=True,
        )
        return {"message": reply, "persona": pkey, "at": _now_iso(),
                "navigate_to": nr.get("navigate_to")}

    prompt, due = await _build_user_prompt(db, actor_id, turns[:-1], user_text)
    try:
        reply = (await _llm(_system_prompt(name), prompt, COMPANION_MODEL)).strip()
    except Exception as e:
        log.warning("companion turn LLM failed: %s", e)
        # Item 4: never repeat the identical fallback — recover with a
        # useful, varied alternative rather than asking them to repeat.
        import random
        reply = random.choice([
            "Sorry, I got a bit tangled there. Let's keep going — what's on your mind?",
            "I didn't quite catch that one. Tell me a little more, or ask me where something is in the app and I'll point you there.",
            "My wires crossed for a second there! Carry on — I'm listening.",
        ])

    turns.append({"role": "george", "content": reply, "at": _now_iso()})
    await db[COLL_CHAT].update_one(
        _chat_filter(actor_id, persona),
        {"$set": {"actor_id": actor_id, "persona": pkey, "turns": turns[-200:],
                  "updated_at": _now_iso(), "last_active_at": _now_iso()},
         "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": _now_iso()}},
        upsert=True,
    )
    # Mark any due follow-ups we just surfaced, and learn from the exchange.
    await _mark_followed_up(db, actor_id, due)
    await _extract_memory(db, actor_id, name, user_text, reply)
    return {"message": reply, "persona": pkey, "at": _now_iso()}


async def reset_companion_session(db: Any, *, actor_id: str, persona: str = "george") -> dict:
    """Clear the visible conversation and start fresh. Private memory is
    intentionally preserved — clearing the chat doesn't make the member
    a stranger again."""
    await db[COLL_CHAT].delete_one(_chat_filter(actor_id, persona))
    return await get_or_create_companion_session(db, actor_id=actor_id, persona=persona)
