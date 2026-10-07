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

# Shared member-name validation (same rules as the companion) so a
# conversational reply like "No" can never be inferred, stored, or used
# to address the member. See services/george/names.py.
from services.george.names import clean_name, name_field_value, scrub_invalid_member_names

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
    # One-pass cleanup of any invalid inferred member name (e.g. "No")
    # written by an older build, so it can't be recalled next session.
    try:
        n = await scrub_invalid_member_names(db)
        if n:
            log.info("Scrubbed invalid inferred member name(s) from %d user(s)", n)
    except Exception:  # pragma: no cover
        log.exception("member-name scrub non-fatal error")


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
  1. START WARMLY on your first turn: acknowledge that the member said yes to getting to know each other. If a CONFIRMED NAME is provided in the context, greet them by it and gently confirm rather than asking from scratch — e.g. "Lovely to meet you! Would you like me to call you Brad, or something else?" If CONFIRMED NAME is empty, open with "Let's start with something easy. What would you like me to call you?" (or a close natural variant).
  2. ACKNOWLEDGE the member's last reply naturally before anything else. Respond SPECIFICALLY to what they said — acknowledge emotion, humour and context.
  3. CONVERSATION FIRST — this is the whole job. Any getting-to-know-you question is a CONVERSATION STARTER, never a checklist. If a question turns into a real chat, STAY WITH IT: ask natural follow-ups, explore the topic over multiple turns while they're engaged, and let them change the subject. NEVER jump to a new question just because the last one was answered. Example — member: "Not really, I need more friends." Do NOT move on; stay with it warmly: "Yeah, that can be hard. What sort of people do you reckon you'd click with?"
  4. NEVER re-ask a field that's already known or skipped. NEVER ask for: age, DOB, identity/demographic info, full address, relationship status, health.
  5. WINDING DOWN: only switch to state="ready_to_summarise" when the conversation reaches a genuine natural pause (the member is clearly wrapping up, or you've had a warm exchange and there's nothing pressing to ask) — NOT after a fixed number of answers. There is NO hard question limit. Before you consider winding down, if there are still getting-to-know-you topics you haven't touched (and the member hasn't skipped), GENTLY RETURN to ONE of them with a warm, natural bridge rather than closing early — e.g. "I've loved hearing about that. While we're chatting — whereabouts are you based, roughly?" Blend George's warmth with a light, unhurried steer back to the induction. Let a good conversation breathe first; only circle back once the current thread has reached its own natural lull. There is no profile summary card, so NEVER say "have a look at what I've learned" or "does this look right". Use a warm humble line that mentions no artefact, e.g. *"That's really helpful. Thank you. I think I've got a lovely picture of what you enjoy. If I ever get something wrong, just let me know — I'm always learning."* (Vary the phrasing but hold the meaning.) When in doubt, keep chatting — or gently return to an unfinished topic — rather than wrapping up.
  6. If the member declines/skips, say something like *"That's absolutely fine."* and move on.
  7. INFERRED FIELDS: when the member says something ambiguous, you MAY infer softly. When you'd like the preview to gently confirm an inference, add the field to `confirm_hints`.
  8. NEVER INVENT CONVERSATION HISTORY. This is critical (Garry, TestFlight iter142, 8 Aug 2026 — "George is inventing previous conversations"). You must never reference things you and the member "discussed", "planned", or "were working on" unless they appear *verbatim* in the visible turns of THIS session (see CONVERSATION below). Absence of memory is not permission to fabricate. If the member returns and there is no prior context, greet them warmly and ask an open question — do NOT reach for a plausible-sounding continuation. If a member challenges an invented reference, acknowledge honestly ("You're right, I'm sorry — I got that wrong") and move on with an open, present-tense question. Do NOT immediately re-introduce the same invented topic.
  9. NAMES: Address the member ONLY by the CONFIRMED NAME given in the context. If CONFIRMED NAME is empty, use NO name at all — a warm sentence with no name is always fine. NEVER guess or invent a name, and NEVER reuse a word the member just said (e.g. "No", "Yes", "My", "Me", "Us", "Hi") as if it were their name. Do not treat any KNOWN field value as a name.
  10. ANSWER DIRECT QUESTIONS FIRST. If the member asks you a direct question (about FriendPlace, how something works, about you, or anything else), ANSWER it fully and warmly BEFORE anything else. Do NOT ignore their question to push a getting-to-know-you question, and NEVER switch to state="ready_to_summarise" while a question of theirs is unanswered. Only after you've genuinely answered may you gently continue the conversation.
  11. FINDING FRIENDS — BE HONEST, NEVER FAKE IT. You may warmly OFFER to help them find friends ("Would you like me to help you find some friends?"). But you have NO ability to search for people, run matchmaking, generate suggestions, or make introductions, and you do NOT do anything "in the background". You must NEVER say things like "I was just about to find some people near <area>", "let me do that now", "I'll have some suggestions for you in a moment", "leave it with me", "I'll introduce you", or imply you're searching or will come back with results. NONE of that exists. What you CAN do is take them to the Find Friends screen, where THEY browse. If the member agrees (says yes / "help me" / "please" after you offer, or asks to find friends), reply with a short, honest, warm message that briefly names the real tools and set "navigate_to": "friends" — e.g. *"Absolutely — I'll take you to Find Friends now. You can search by name or interests, pick a suburb or town, or use Near Me to see people nearby."* Then STOP (no fake follow-up, keep state "needs_reply"). If they'd rather not be taken there, just tell them it's on the Friends tab.
  12. TAKING THEM PLACES — "Take me to X" vs "Where is X?". When the member clearly asks to be TAKEN somewhere ("take me to Games", "open the Café", "go to the Notice Board", "I want to see Events"), set "navigate_to" to the matching key below AND reply with ONE short honest line that names where they're going (e.g. *"Of course — opening Games for you now."*). Only promise to take them somewhere when you ALSO set navigate_to — never say "I'll take you there" with navigate_to null. When they instead ask WHERE something is ("where is the Notice Board?", "how do I get to Events?") OR ask ABOUT it ("tell me about the Notice Board", "what is the FP Café?", "how does Find Friends work?"), DON'T navigate (navigate_to null) — answer their question first, then you may offer "Would you like me to take you there?"; briefly EXPLAIN where to tap (the bottom bar has Home, My Chats, FP Café, Moments and More — Friends/Profile/Settings/Help live inside the More menu, and the remaining destinations like Notice Board, Games, Groups and Events are tiles on the Home screen). Valid navigate_to keys: "home", "chats", "friends", "lounge" (the FP Café), "profile", "games", "groups", "notices" (Notice Board), "events", "moments" (Share a Moment), "settings", "help", "notifications". Use "friends" for Find Friends. If you're unsure which screen they mean, ask a short clarifying question rather than guessing — do NOT navigate on a vague request.

OUTPUT (strict JSON, no fences):
{
  "state": "needs_reply" | "ready_to_summarise",
  "message": "one warm colleague-voice message to the member",
  "field_being_asked": "preferred_name" | "area" | ... | null,
  "confirm_hints": ["availability"],   // optional; fields you inferred that the preview should gently surface
  "navigate_to": "friends" | "home" | "chats" | "lounge" | "profile" | "games" | "groups" | "notices" | "events" | "moments" | "settings" | "help" | "notifications" | null   // set ONLY when actually taking them there (rules 11 & 12); otherwise null
}
"""


# ---------------------------------------------------------------------------
# LLM helpers (Claude via emergentintegrations, same pattern as event_creation)
# ---------------------------------------------------------------------------

async def _llm(system: str, user: str, model: str, *, kb_block: str = "") -> str:
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    key = os.getenv("EMERGENT_LLM_KEY") or os.getenv("UNIVERSAL_LLM_KEY") or ""
    if not key:
        raise RuntimeError("EMERGENT_LLM_KEY not configured")
    # If the caller retrieved a shared-memory block for this turn,
    # append it to the system prompt so onboarding-George can quote
    # published FriendPlace principles rather than paraphrasing them.
    system_with_kb = f"{system}{kb_block}" if kb_block else system
    chat = LlmChat(api_key=key, session_id=f"onboarding-{uuid.uuid4().hex[:8]}", system_message=system_with_kb)
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


async def _compose(known: dict, turns: list, skipped: list, is_first: bool, *, kb_block: str = "", first_name: str = "", persona: str = "george") -> dict:
    # Companion identity comes from the member's saved choice (George or
    # Georgia) — the SAME source that drives the header, avatar, voice and
    # placeholder. The composer prompt is written for "George" so we swap
    # the name when Georgia is the chosen companion; everything else in the
    # prompt is persona-neutral.
    name = "Georgia" if (persona or "").lower() == "georgia" else "George"
    system = COMPOSER_SYSTEM.replace("George", name) if name != "George" else COMPOSER_SYSTEM
    # Only ever hand the composer a CONFIRMED name — a stated preferred
    # name, else the signup first name — never an inferred/filler value.
    safe_known = dict(known or {})
    pn = safe_known.get("preferred_name")
    stated_name = (
        clean_name(name_field_value(pn))
        if isinstance(pn, dict) and (pn.get("source") or "").lower() == "stated"
        else None
    )
    if clean_name(name_field_value(pn)) is None:
        # Strip filler like "No"/"My" so it can never be echoed at the member.
        safe_known.pop("preferred_name", None)
    confirmed_name = stated_name or clean_name(first_name) or ""
    name_line = (
        f"YOUR NAME (non-negotiable): You are {name}. Always refer to yourself as {name}.\n"
        f"CONFIRMED NAME (the ONLY name you may use to address them; if empty, use no name): {confirmed_name}\n"
    )
    prompt = (
        f"IS_FIRST_TURN: {is_first}\n"
        f"{name_line}"
        f"KNOWN fields (stated/inferred): {json.dumps(safe_known, ensure_ascii=False)}\n"
        f"SKIPPED fields: {json.dumps(skipped, ensure_ascii=False)}\n\n"
        f"CONVERSATION SO FAR (most recent last):\n" +
        "\n".join(f"{t['role']}: {t['content']}" for t in turns[-12:])
    )
    raw = await _llm(system, prompt, "claude-sonnet-4-5-20250929", kb_block=kb_block)
    return _clean_json(raw) or {
        "state": "needs_reply",
        "message": f"Sorry \u2014 I didn\u2019t quite catch that. Could you tell me once more, or tap a button below and I\u2019ll point you the right way?",
    }


async def _user_first_name(db: Any, actor_id: str) -> str:
    try:
        u = await db.users.find_one({"id": actor_id}, {"_id": 0, "first_name": 1}) or {}
        return (u.get("first_name") or "").strip()
    except Exception:
        return ""


# ---------------------------------------------------------------------------
# Fast canned opener (TestFlight feedback, Neo Feb 2026)
# ---------------------------------------------------------------------------
#
# ``_compose(is_first=True, ...)`` was the only LLM call blocking the
# first-greeting render on a brand-new onboarding session. On real
# devices (TestFlight production backend) the Claude Sonnet 4.5 call
# routinely stretched to ~30 s before the typing dots cleared and
# George's/Georgia's first line appeared. Resume-after-"Finish later"
# was already fast because ``active_onboarding_session`` returns the
# persisted turns straight from Mongo without an LLM round-trip.
#
# The canned opener mirrors the FIRST-TURN contract documented in
# ``COMPOSER_SYSTEM`` rule #1 verbatim:
#   • if we have a CONFIRMED NAME → greet by name and gently confirm it
#   • if the member has already stated some fields (seeded from their
#     saved ``george_onboarding_known``), still open warmly but without
#     re-asking the stated bits
#   • otherwise → "Let's start with something easy. What would you like
#     me to call you?"
#
# From turn 2 onwards the LLM is back in the loop as normal, so the
# live conversation (including intent/navigation rules) is unchanged.
def _canned_first_opener(known: dict, first_name: str, persona: str = "george") -> dict:
    """Return a composed-shape dict for the very first George/Georgia
    message so the typing dots clear in <1 s instead of waiting on an
    LLM round-trip. Must stay in sync with COMPOSER_SYSTEM rule #1.
    """
    name = "Georgia" if (persona or "").lower() == "georgia" else "George"
    # Resolve the CONFIRMED NAME exactly the same way _compose does so
    # the opener never addresses the member by a filler/inferred value.
    safe_known = dict(known or {})
    pn = safe_known.get("preferred_name")
    stated_name = (
        clean_name(name_field_value(pn))
        if isinstance(pn, dict) and (pn.get("source") or "").lower() == "stated"
        else None
    )
    confirmed_name = stated_name or clean_name(first_name) or ""

    if confirmed_name:
        # Rule #1 — the "Lovely to meet you" branch when we already
        # have a name candidate (either stated preferred_name or the
        # signup first name).
        message = (
            f"Lovely to meet you, {confirmed_name}! I'm {name} \u2014 I'm just here to help you "
            f"get settled, no rush at all. Would you like me to call you {confirmed_name}, "
            f"or is there something else you'd prefer?"
        )
        field_being_asked = "preferred_name"
    else:
        # Rule #1 — the "something easy" branch for a truly nameless start.
        message = (
            f"Hi, I'm {name}. Lovely to meet you. Let's start with something easy \u2014 "
            f"what would you like me to call you?"
        )
        field_being_asked = "preferred_name"

    return {
        "state": "needs_reply",
        "message": message,
        "field_being_asked": field_being_asked,
        "confirm_hints": [],
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def _merge_patch(known: dict, patch: dict) -> dict:
    known = dict(known or {})
    for field, val in (patch or {}).get("patch", {}).items():
        if field not in FIELDS:
            continue
        # Name guard: never store a value that isn't clearly a real name
        # (e.g. an inferred "No"/"My"/"Yes" from a conversational reply).
        # We would rather have NO preferred name than a wrong one.
        if field == "preferred_name" and clean_name(name_field_value(val)) is None:
            known.pop("preferred_name", None)
            continue
        known[field] = val  # value + source
    # Scrub any pre-existing invalid name left by an older build so it can
    # never resurface on resume.
    if "preferred_name" in known and clean_name(name_field_value(known.get("preferred_name"))) is None:
        known.pop("preferred_name", None)
    return known


def _fields_gathered(known: dict, skipped: list) -> int:
    return sum(1 for f in FIELDS if f in known or f in skipped)


async def active_onboarding_session(db: Any, *, actor_id: str) -> Optional[dict]:
    """Return the actor's currently active onboarding session, if any.

    TestFlight iter142 fix (Garry, 8 Aug 2026 — "Onboarding restarts
    unnecessarily"): if the actor has already completed onboarding
    (`users.profile_complete == True`), any lingering `in_progress`
    or `drafted` session on this collection is by definition STALE
    — the completed profile is the source of truth. Returning it as
    "active" caused completed members to be silently re-routed back
    into the onboarding chat after tapping the butterfly. We now
    treat such sessions as garbage and return `None`; the caller
    (`presence` endpoint) will therefore see `has_active_onboarding=
    False`, and the butterfly router will open the completed-member
    surface as intended.

    We also opportunistically mark the stale session as `cancelled`
    with a `cancel_reason` so it stops appearing in future presence
    calls — a one-time cleanup that scales safely because it only
    runs when both flags disagree.

    IMPORTANT (real-device fix, Jun 2026): staleness is keyed to
    ``profile_complete`` ONLY — the flag set exclusively by
    ``approve_onboarding`` when George's get-to-know-you chat is
    finished. It is NOT keyed to ``onboarding_completed``, which is the
    unrelated *app signup* onboarding flag (set in server.py after a
    member finishes the sign-up flow). Every real member has
    ``onboarding_completed == True`` well before they ever chat with
    George, so conflating the two caused an in-progress get-to-know-you
    session (with real answers) to be wrongly discarded the moment they
    tapped "Finish later" and reopened the butterfly — George then
    greeted them as a stranger and the answers were lost.
    """
    active = await db[COLL_ONBOARDING].find_one(
        {"actor_id": actor_id, "status": {"$in": ["in_progress", "drafted"]}},
        {"_id": 0},
        sort=[("updated_at", -1)],
    )
    if not active:
        return None
    # Cross-check with George's OWN completion flag (`profile_complete`,
    # set only by approve_onboarding). If the get-to-know-you chat has
    # already been approved, this lingering session is stale — never
    # re-route them back into onboarding. Deliberately does NOT consider
    # the app-level `onboarding_completed` signup flag (see docstring).
    try:
        user_doc = await db.users.find_one(
            {"id": actor_id},
            {"_id": 0, "profile_complete": 1},
        )
    except Exception:
        user_doc = None
    if user_doc and user_doc.get("profile_complete") is True:
        # Best-effort cleanup so subsequent presence lookups are
        # cheap and the session doesn't linger indefinitely.
        try:
            await db[COLL_ONBOARDING].update_one(
                {"session_id": active.get("session_id")},
                {
                    "$set": {
                        "status": "cancelled",
                        "cancelled_at": _now_iso(),
                        "updated_at": _now_iso(),
                        "cancel_reason": "stale_after_profile_complete",
                    }
                },
            )
        except Exception:
            # Cleanup failure must never block the presence response.
            pass
        return None
    return active


async def start_or_resume_onboarding(db: Any, *, actor_id: str, persona: str = "george") -> dict:
    existing = await active_onboarding_session(db, actor_id=actor_id)
    if existing:
        # Keep the host identity aligned with the member's current choice —
        # if they switched George↔Georgia since the session began, honour it.
        if (existing.get("persona") or "george") != persona:
            try:
                await db[COLL_ONBOARDING].update_one(
                    {"session_id": existing.get("session_id")},
                    {"$set": {"persona": persona}},
                )
                existing["persona"] = persona
            except Exception:
                pass
        return existing
    session_id = str(uuid.uuid4())
    # Durable memory (item 5, Sep 2026): remembered facts are kept on the
    # USER doc, independent of the onboarding-complete flag. So if a member
    # signs out/in (or a session is lost) while onboarding is still
    # incomplete, we re-seed what they already told us and George does NOT
    # re-ask those things. Completion state and memory are separate concerns.
    known: dict = {}
    try:
        udoc = await db.users.find_one(
            {"id": actor_id},
            {"_id": 0, "george_onboarding_known": 1, "george_profile": 1},
        ) or {}
        seed = udoc.get("george_onboarding_known") or udoc.get("george_profile") or {}
        if isinstance(seed, dict):
            known = {k: v for k, v in seed.items() if v not in (None, "")}
    except Exception:
        known = {}
    skipped: list = []
    turns: list = []
    first_name = await _user_first_name(db, actor_id)
    # TestFlight fix (Neo, Feb 2026 — first-greeting delay): the Claude
    # Sonnet 4.5 round-trip for the OPENING line routinely took ~30 s
    # on the production backend, leaving members staring at empty
    # typing dots on their very first introduction. The opener is
    # heavily templated by COMPOSER_SYSTEM rule #1, so we now render
    # it from a canned template that stays in lockstep with the LLM
    # contract. All subsequent turns still go through the live LLM
    # composer, so the conversation itself (including intent routing)
    # is unchanged.
    composed = _canned_first_opener(known, first_name=first_name, persona=persona)
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
        "persona": persona,
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

    # Ground the turn in shared institutional memory (public-only for
    # onboarding, which happens before a full member account exists).
    from services.george import kb_grounding as _kbg
    _kb_block, _ = await _kbg.ground_for_george(
        db=db, user_message=user_text, surface="member",
        session_id=session_id, user_id=session.get("actor_id"),
    )

    composed = await _compose(known, turns, skipped, is_first=False, kb_block=_kb_block,
                              first_name=await _user_first_name(db, session.get("actor_id")),
                              persona=session.get("persona") or "george")
    # iter247 (TestFlight): same intent rules as the companion — a
    # question ABOUT or WHERE a destination is must never navigate, and
    # gets the companion's accurate info/directions reply (+ offer).
    from services.george.companion.service import (
        _detect_nav_intent, _info_fallback, _nav_reply, _promises_navigation, _is_affirmative,
    )
    _intent = _detect_nav_intent(user_text)
    _prev_offer = session.get("nav_offer")
    _new_offer = None
    if _intent and _intent["mode"] in ("info", "explain"):
        composed["navigate_to"] = None
        composed["message"] = (
            _info_fallback(_intent["dest"]) if _intent["mode"] == "info"
            else _nav_reply("George", _intent)["message"]
        )
        _k = _intent["dest"].get("key") or _intent["dest"].get("route")
        _new_offer = {"key": _k, "label": _intent["dest"]["label"]} if _k else None
    elif not _intent and _prev_offer and _prev_offer.get("key") and _is_affirmative(user_text):
        # Accepting the offer George just made → navigate to THAT place.
        composed["navigate_to"] = _prev_offer["key"]
        composed["message"] = f"Of course — taking you to {_prev_offer.get('label') or 'it'} now."
    # Conversation-first (Garry, Sep 2026): onboarding no longer force-
    # advances to a summary once N fields are gathered. Getting-to-know-you
    # questions are conversation starters, not a questionnaire — George
    # winds down to `ready_to_summarise` only when the chat reaches a
    # natural pause, which the composer prompt now decides on its own.

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
        "nav_offer": _new_offer,
        "updated_at": _now_iso(),
    }
    await db[COLL_ONBOARDING].update_one({"session_id": session_id}, {"$set": updated})
    # #5 (Garry, real-device Sep 2026): surface a navigation intent so the
    # induction chat can actually OPEN the destination instead of pretending
    # to search. Trust the composer's field, with a wording-based backup for
    # Find Friends. The whitelist mirrors the frontend george-nav-map.
    _NAV_KEYS = {
        "home", "chats", "friends", "lounge", "profile", "games", "groups",
        "notices", "events", "moments", "founders", "help", "notifications",
        "settings",
    }
    nav = composed.get("navigate_to")
    if not isinstance(nav, str) or nav not in _NAV_KEYS:
        nav = None
    if not nav:
        _ml = (composed.get("message") or "").lower()
        # iter247: an OFFER ("Would you like me to take you to Find
        # Friends?") is not a promise — only navigate on a real promise.
        if "find friends" in _ml and _promises_navigation(composed.get("message") or ""):
            nav = "friends"
    # Persist the merged facts durably on the user doc so they survive a
    # sign-out/in or a lost session — memory is independent of whether
    # onboarding has been completed/approved (item 5).
    try:
        if known:
            await db.users.update_one(
                {"id": session.get("actor_id")},
                {"$set": {"george_onboarding_known": known}},
            )
    except Exception:
        pass
    return {**session, **updated, "navigate_to": nav}


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
    # Final name guard before it becomes the member's durable profile:
    # never persist an inferred/filler preferred_name (e.g. "No").
    if "preferred_name" in known and clean_name(name_field_value(known.get("preferred_name"))) is None:
        known.pop("preferred_name", None)
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


async def reset_onboarding_session(db: Any, session_id: str) -> dict:
    """'Clear chat' — the member wants to start the conversation over.

    Marks the current session as ``cancelled`` (a hard stop, unlike
    ``cancel_onboarding_session`` which pauses for resume) and spins up a
    fresh session for the same actor. Deliberately does NOT touch
    ``users.george_profile`` — any answers already approved to the
    member profile stay intact. Only the transient in-progress
    conversation is wiped.
    """
    session = await db[COLL_ONBOARDING].find_one({"session_id": session_id})
    if not session:
        raise ValueError("Session not found")
    actor_id = session.get("actor_id")
    now = _now_iso()
    # Hard-stop this session so ``active_onboarding_session`` skips it
    # and ``start_or_resume_onboarding`` creates a brand new one.
    await db[COLL_ONBOARDING].update_one(
        {"session_id": session_id},
        {"$set": {"status": "cancelled", "cancelled_at": now, "updated_at": now, "cancel_reason": "cleared_by_member"}},
    )
    # Fresh session — same opening greeting as a first-time start.
    fresh = await start_or_resume_onboarding(db, actor_id=actor_id)
    return fresh


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
