"""Play Together — small, launch-safe 2-player social games for FriendPlace.

Purpose: give two members who've just connected something easy to do
together (icebreaking, not gaming complexity). Three tiny games:

  • this_or_that  — 5 quick either/or prompts, then compare answers.
  • quick_trivia  — 5 short shared questions, simple score + winner.
  • word_chain    — turn-based; say a word starting with the last letter.

Realtime is reused from the existing inbox socket: every state change
pushes a `push_notification` to the other player so their open room
refetches immediately. A light client poll reconciles anything missed.

Butterfly Points (modest, anti-farm):
  • invite that is ACCEPTED  → +3 to the host
  • accept / start a game     → +3 to the guest
  • complete a game together  → +5 each
  • win                       → +2 to the winner
Points are gated so only the FIRST 3 point-earning games per person per
day pay out — rematches beyond that still play, they just stop farming.

This module registers its routes on the shared `/api` router via
`register(api, ctx)` so server.py stays untouched beyond one call.
"""
from __future__ import annotations

import random
import os
import asyncio
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel

try:
    from suburbs import haversine_km as _haversine_km
except Exception:  # pragma: no cover - suburbs module always present in app
    _haversine_km = None

# ---- points config -------------------------------------------------------
PTS_INVITE = 3
PTS_ACCEPT = 3
PTS_COMPLETE = 5
PTS_WIN = 2
DAILY_GAME_CAP = 3  # distinct point-earning games per person per day

GAMES = {"this_or_that", "quick_trivia", "word_chain"}
GAME_LABELS = {
    "this_or_that": "This or That",
    "quick_trivia": "Quick Trivia",
    "word_chain": "Word Chain",
}

# ---- content banks -------------------------------------------------------
THIS_OR_THAT_BANK: List[Dict[str, str]] = [
    {"a": "Tea", "b": "Coffee"},
    {"a": "Beach", "b": "Mountains"},
    {"a": "Early bird", "b": "Night owl"},
    {"a": "Cats", "b": "Dogs"},
    {"a": "Sweet", "b": "Savoury"},
    {"a": "Summer", "b": "Winter"},
    {"a": "Books", "b": "Movies"},
    {"a": "Cook at home", "b": "Eat out"},
    {"a": "City", "b": "Country"},
    {"a": "Call", "b": "Text"},
    {"a": "Planner", "b": "Spontaneous"},
    {"a": "Sunrise", "b": "Sunset"},
    {"a": "Garden", "b": "Balcony"},
    {"a": "Cards", "b": "Board games"},
    {"a": "Quiet night in", "b": "Night out"},
    {"a": "Sing", "b": "Dance"},
    {"a": "Chocolate", "b": "Vanilla"},
    {"a": "Walk", "b": "Swim"},
]

WORD_CHAIN_CATEGORIES: List[str] = [
    "Animals", "Foods", "Countries", "Movies", "Aussie towns",
    "Fruit & veg", "Things in a kitchen", "Sports", "Boys' names",
    "Girls' names", "Something in the garden", "Musical instruments",
]

WORD_CHAIN_TARGET = 12  # chain length that "completes" the game together

# Curated, deliberately-generous word banks for the "closed" categories so
# Word Chain can reject obvious wrong answers (e.g. "ok" for Boys' names)
# while staying forgiving. Open-ended categories (Movies, Aussie towns) are
# intentionally omitted — those only enforce the starting letter + no repeats.
# All entries are lower-case; matching is case-insensitive.
WORD_CHAIN_DICT: Dict[str, set] = {
    "Animals": {
        "ant","bat","bear","bee","bird","buffalo","camel","cat","cheetah","chicken",
        "cow","crab","crocodile","deer","dingo","dog","dolphin","donkey","duck","eagle",
        "elephant","emu","ferret","fish","fox","frog","giraffe","goat","goose","gorilla",
        "hen","hippo","horse","kangaroo","koala","lion","lizard","llama","lobster","monkey",
        "moose","mouse","octopus","owl","panda","parrot","penguin","pig","platypus","possum",
        "rabbit","rat","seal","shark","sheep","snail","snake","spider","squid","swan",
        "tiger","turtle","wallaby","whale","wolf","wombat","zebra",
    },
    "Foods": {
        "apple","bacon","banana","beans","bread","burger","butter","cake","carrot","cheese",
        "chicken","chips","chocolate","cream","curry","egg","fish","garlic","honey","jam",
        "lamb","lasagna","lettuce","mango","meat","milk","mushroom","noodles","olive","onion",
        "pasta","pie","pizza","pork","potato","rice","salad","salmon","sandwich","sausage",
        "soup","steak","stew","sugar","toast","tomato","tuna","yoghurt",
    },
    "Fruit & veg": {
        "apple","apricot","avocado","banana","beans","beetroot","broccoli","cabbage","capsicum","carrot",
        "cauliflower","celery","cherry","corn","cucumber","fig","grape","kiwi","leek","lemon",
        "lettuce","lime","mango","melon","mushroom","onion","orange","pea","peach","pear",
        "pineapple","plum","potato","pumpkin","radish","raspberry","spinach","strawberry","tomato","turnip",
        "watermelon","zucchini",
    },
    "Things in a kitchen": {
        "apron","blender","bowl","cup","cupboard","dishwasher","fork","freezer","fridge","grater",
        "jug","kettle","knife","ladle","microwave","mixer","mug","oven","pan","plate",
        "pot","saucepan","sieve","sink","spatula","spoon","stove","tap","teapot","toaster",
        "tongs","tray","whisk",
    },
    "Sports": {
        "archery","athletics","badminton","baseball","basketball","bmx","bowling","boxing","canoeing","cricket","curling","cycling","darts",
        "diving","equestrian","fencing","football","golf","gymnastics","handball","hockey","hurling","judo","karate","kayaking",
        "lacrosse","motocross","netball","polo","rowing","rugby","running","sailing","shooting","skating","skiing","snooker",
        "snowboarding","soccer","softball","squash","surfing","swimming","tennis","triathlon","volleyball","walking","waterpolo",
        "weightlifting","wrestling",
    },
    "Boys' names": {
        "aaron","adam","alan","albert","alex","andrew","anthony","arthur","ben","benjamin",
        "bill","bob","brian","charlie","chris","daniel","dave","david","dennis","edward",
        "eric","frank","fred","gary","george","harry","henry","jack","james","jason",
        "jim","joe","john","jordan","joseph","kevin","liam","luke","mark","martin",
        "matthew","michael","nathan","nick","noah","oliver","paul","peter","philip",
        "richard","robert","ryan","sam","scott","simon","steve","thomas","tim","tom",
        "tony","william",
    },
    "Girls' names": {
        "abigail","alice","amanda","amy","anna","anne","barbara","betty","carol","charlotte",
        "chloe","claire","donna","dora","elizabeth","ella","emily","emma","eve","fiona",
        "grace","hannah","helen","isla","jane","janet","jenny","jessica","joan","judy",
        "julia","karen","kate","kerry","laura","linda","lisa","lucy","margaret","maria",
        "mary","mia","michelle","nancy","olivia","patricia","rachel","rose","ruby","sally",
        "sarah","sharon","sophie","susan","tina","wendy","zoe",
    },
    "Something in the garden": {
        "bench","bird","bush","daisy","fence","fern","flower","fountain","frog","garden",
        "gate","grass","hedge","hose","insect","lawn","leaf","mower","path","plant",
        "pond","pot","rake","rose","seed","shed","shovel","shrub","snail","soil",
        "spade","tree","trowel","tulip","vine","weed","wheelbarrow","worm",
    },
    "Musical instruments": {
        "accordion","banjo","bass","bassoon","bongo","cello","clarinet","cymbal","drum","flute",
        "guitar","harmonica","harp","horn","keyboard","mandolin","oboe","organ","piano","piccolo",
        "recorder","saxophone","tambourine","triangle","trombone","trumpet","tuba","ukulele","viola","violin",
        "xylophone",
    },
    "Countries": {
        "argentina","australia","austria","belgium","brazil","canada","chile","china","denmark","egypt",
        "england","fiji","finland","france","germany","greece","india","indonesia","ireland","italy",
        "japan","kenya","malaysia","mexico","nepal","netherlands","norway","pakistan","peru","poland",
        "portugal","russia","scotland","singapore","spain","sweden","switzerland","thailand","turkey","uganda",
        "ukraine","vietnam","wales","zimbabwe",
    },
}


def _word_chain_reject(category: str, word: str, chain: List[Dict[str, Any]], required: str,
                       skip_category_check: bool = False) -> Optional[str]:
    """Return a gentle retry message if the word is invalid, else None.

    Enforces: real-ish word, correct starting letter, no duplicate, and —
    for the curated categories — that the word actually fits the category.
    Open-ended categories skip the membership check (forgiving by design).

    When `skip_category_check` is True we run ONLY the deterministic rules
    (validity / starting letter / no repeat) and leave the category-fit
    decision to the async AI check in the caller. This lets synonyms that
    aren't in the curated bank (e.g. "dirt" for "Something in the garden")
    still be accepted.
    """
    raw = (word or "").strip()
    w = raw.lower()
    if len(raw) < 2 or not raw[0].isalpha() or not raw.replace(" ", "").replace("-", "").isalpha():
        return "Please enter a real word."
    if required and w[0] != required.lower():
        return f"Your word needs to start with “{required.upper()}”."
    used = {(it.get("word") or "").strip().lower() for it in chain}
    if w in used:
        return f"“{raw}” has already been used — try a different word."
    if skip_category_check:
        return None
    valid = WORD_CHAIN_DICT.get(category)
    if valid is not None and w not in valid:
        return f"Hmm, “{raw}” doesn't look like it fits {category}. Try another!"
    return None


async def _word_chain_category_fits(category: str, word: str) -> bool:
    """AI category-fit check for curated Word Chain categories.

    Called ONLY when the word passed the deterministic rules but isn't in
    the curated bank. Returns True if the AI clearly confirms the word
    fits the category — synonyms like "dirt" for "Something in the
    garden" are accepted that way.

    iter210 (Garry, Oct 2026 — RED #1): previously we accepted the word
    on any AI uncertainty (missing key / timeout / exception). That let
    obvious nonsense like "povkey" or "yenta" slip into Sports because
    the LLM call timed out at 2s and we silently said "sure, accept".
    New behaviour:
      • Clear YES → accept.
      • Clear NO → reject.
      • Anything else (missing key, timeout, model error, blank
        response) → REJECT, because the deterministic check already
        failed and we can't verify the fit. Members get a gentle "try
        another" prompt and can pick a different word.
    """
    try:
        api_key = os.getenv("EMERGENT_LLM_KEY")
        if not api_key:
            return False
        from emergentintegrations.llm.chat import LlmChat, UserMessage  # noqa: E402
        chat = LlmChat(
            api_key=api_key,
            session_id=f"wordchain-{uuid.uuid4().hex[:8]}",
            system_message=(
                "You judge a friendly word game for older adults. Given a CATEGORY and a "
                "WORD, decide if the word plausibly belongs to that category in everyday "
                "Australian English. Be fair, not pedantic: accept clear synonyms and "
                "closely related items (for example 'dirt' fits 'Something in the garden'). "
                "If the WORD is not a real English word, or if it clearly does not belong "
                "to the CATEGORY, answer NO. Reply with only YES or NO."
            ),
        ).with_model("gemini", "gemini-3-flash-preview")
        msg = UserMessage(text=f"CATEGORY: {category}\nWORD: {word}")
        # Give the AI a reasonable window (first call can be cold).
        resp = await asyncio.wait_for(chat.send_message(msg), timeout=3.5)
        answer = str(resp or "").strip().upper()
        # Strict: only accept on an explicit YES. Anything else (NO,
        # blank, "I think so", etc.) is treated as a rejection.
        return answer.startswith("YES")
    except Exception as e:
        logging.warning("word_chain AI fit check failed (rejecting): %s", e)
        return False


class InviteBody(BaseModel):
    game: str
    friend_id: str


class FindMatchBody(BaseModel):
    game: str


class MoveBody(BaseModel):
    # this_or_that / quick_trivia: full set of answers in one submission.
    answers: Optional[List[int]] = None
    # word_chain: one word, or a pass.
    word: Optional[str] = None
    give_up: Optional[bool] = None


def register(api, ctx: Dict[str, Any]) -> None:
    db = ctx["db"]
    current_user = ctx["current_user"]
    award_points = ctx["award_points"]
    push_notification = ctx["push_notification"]
    nid = ctx["nid"]
    now_iso = ctx["now_iso"]
    QUESTIONS = ctx["trivia_questions"]

    # -- helpers -----------------------------------------------------------
    def _today() -> str:
        return now_iso()[:10]

    async def _try_earn(user_id: str, session_id: str) -> bool:
        """Return True if `user_id` may earn points for `session_id` today,
        recording the game against their daily allowance. A game already
        counted returns True without consuming a new slot (so complete/win
        in a session that already paid an accept/invite still pay out)."""
        key = f"{user_id}:{_today()}"
        doc = await db.play_daily_points.find_one({"id": key})
        games = list((doc or {}).get("games", []))
        if session_id in games:
            return True
        if len(games) >= DAILY_GAME_CAP:
            return False
        games.append(session_id)
        await db.play_daily_points.update_one(
            {"id": key},
            {"$set": {"id": key, "user_id": user_id, "date": _today(), "games": games}},
            upsert=True,
        )
        return True

    async def _user_slim(uid: str) -> Dict[str, Any]:
        u = await db.users.find_one({"id": uid}, {"_id": 0, "first_name": 1, "avatar": 1}) or {}
        return {"id": uid, "name": u.get("first_name") or "Friend", "avatar": u.get("avatar") or ""}

    def _new_content(game: str) -> Dict[str, Any]:
        if game == "this_or_that":
            prompts = random.sample(THIS_OR_THAT_BANK, 5)
            return {"prompts": [{"id": f"p{i}", **p} for i, p in enumerate(prompts)]}
        if game == "quick_trivia":
            pool = [q for q in QUESTIONS if q.get("difficulty") in ("easy", "moderate")]
            picked = random.sample(pool, 5)
            return {"questions": [
                {"id": q["id"], "q": q["q"], "choices": q["choices"], "answer": q["answer"]}
                for q in picked
            ]}
        # word_chain
        cat = random.choice(WORD_CHAIN_CATEGORIES)
        letter = random.choice("BCDFGHLMNPRSTW")
        return {"category": cat, "required_letter": letter, "chain": []}

    def _public(sess: Dict[str, Any], me: str) -> Dict[str, Any]:
        """Serialise a session for a participant — never leak trivia answers
        before the round is finished."""
        s = dict(sess)
        s.pop("_id", None)
        content = dict(s.get("content", {}))
        if s.get("game") == "quick_trivia" and s.get("status") != "finished":
            content["questions"] = [
                {k: v for k, v in q.items() if k != "answer"} for q in content.get("questions", [])
            ]
        s["content"] = content
        s["me"] = me
        return s

    async def _load(session_id: str, me: str) -> Dict[str, Any]:
        sess = await db.play_sessions.find_one({"id": session_id})
        if not sess:
            raise HTTPException(404, "Game not found")
        if me not in (sess.get("host_id"), sess.get("guest_id")):
            raise HTTPException(403, "Not your game")
        return sess

    async def _notify(sess: Dict[str, Any], to_id: str, n_type: str, title: str, body: str = "") -> None:
        # Only the game INVITE belongs in the recipient's Notifications list
        # (and as a device push). Every other game event — start, each move /
        # turn update, and the finish/win/loss result — is a live signal used
        # only to refetch an open game screen, so it is sent EPHEMERALLY: it
        # fans out over the socket but is never persisted or pushed. (Garry,
        # Jun 2026 — "game notifications are too noisy".)
        ephemeral = n_type != "game_invite"
        await push_notification(
            to_id, n_type, title, body,
            {"session_id": sess["id"], "game": sess["game"]},
            ephemeral=ephemeral,
        )

    async def _finish_and_award(sess: Dict[str, Any]) -> None:
        """Mark finished, compute winner, and award complete/win points."""
        players = sess["players"]
        game = sess["game"]
        winner_id: Optional[str] = None
        if game == "quick_trivia":
            hi = max(p["score"] for p in players)
            leaders = [p for p in players if p["score"] == hi]
            if len(leaders) == 1:
                winner_id = leaders[0]["id"]
        elif game == "word_chain":
            # give_up sets winner explicitly; otherwise (reached target) it's
            # a shared completion — no single winner.
            winner_id = sess.get("winner_id")
        sess["status"] = "finished"
        sess["winner_id"] = winner_id
        sess["updated_at"] = now_iso()
        awarded = sess.setdefault("awarded", {})
        # complete — both players
        for p in players:
            if not awarded.get(f"complete:{p['id']}") and await _try_earn(p["id"], sess["id"]):
                await award_points(p["id"], PTS_COMPLETE, "play_together_complete")
                awarded[f"complete:{p['id']}"] = True
        # win — the winner only
        if winner_id and not awarded.get(f"win:{winner_id}") and await _try_earn(winner_id, sess["id"]):
            await award_points(winner_id, PTS_WIN, "play_together_win")
            awarded[f"win:{winner_id}"] = True

    # -- routes ------------------------------------------------------------
    @api.post("/play/invite")
    async def play_invite(body: InviteBody, me: dict = Depends(current_user)):
        if body.game not in GAMES:
            raise HTTPException(400, "Unknown game")
        if body.friend_id == me["id"]:
            raise HTTPException(400, "Pick a friend to play with")
        my = await db.users.find_one({"id": me["id"]}, {"_id": 0, "friends": 1, "first_name": 1})
        if body.friend_id not in (my.get("friends") or []):
            raise HTTPException(400, "You can only play with your friends")
        host = await _user_slim(me["id"])
        guest = await _user_slim(body.friend_id)
        sess = {
            "id": nid()[:8],
            "game": body.game,
            "status": "invited",
            "host_id": host["id"],
            "guest_id": guest["id"],
            "players": [
                {**host, "score": 0, "done": False},
                {**guest, "score": 0, "done": False},
            ],
            "content": _new_content(body.game),
            "turn": host["id"],  # word_chain: host starts
            "winner_id": None,
            "awarded": {},
            "origin": "friend",
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }
        await db.play_sessions.insert_one(sess)
        await _notify(
            sess, guest["id"], "game_invite",
            f"{host['name']} invited you to play {GAME_LABELS[body.game]}",
            "Tap to accept and play together.",
        )
        return _public(sess, me["id"])

    @api.post("/play/find-match")
    async def play_find_match(body: FindMatchBody, me: dict = Depends(current_user)):
        """iter181 item 1 — Find someone to play.

        Matches the caller with an ELIGIBLE, currently-online member they are
        NOT already friends with. Searches the local area first and widens the
        radius progressively before falling back to anywhere in the country.
        Respects blocks (both directions), privacy/invisible, profile-hidden,
        location opt-out, and a 24h decline cooldown. Never auto-friends — the
        post-game screen offers a normal friend request for non-friends.
        """
        if body.game not in GAMES:
            raise HTTPException(400, "Unknown game")
        my = await db.users.find_one({"id": me["id"]}, {"_id": 0}) or {}
        my_friends = set(my.get("friends") or [])
        my_blocked = set(my.get("blocked") or [])
        lat, lng = my.get("suburb_lat"), my.get("suburb_lng")

        # Pairs this member declined (either direction) in the last 24h.
        cutoff_24h = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        declined_ids: set = set()
        async for d in db.play_declines.find({"members": me["id"], "declined_at": {"$gte": cutoff_24h}}):
            for m in d.get("members", []):
                if m != me["id"]:
                    declined_ids.add(m)

        # "Currently online" = active within the last 2 minutes (same window
        # the presence chip uses for "Online now"), and not invisible/offline.
        online_since = (datetime.now(timezone.utc) - timedelta(seconds=120)).isoformat()
        exclude = list(my_friends | my_blocked | declined_ids | {me["id"]})
        query = {
            "id": {"$nin": exclude},
            "banned": {"$ne": True},
            "profile_hidden": {"$ne": True},
            "blocked": {"$ne": me["id"]},        # they haven't blocked me
            "privacy": {"$ne": "invisible"},
            "status": {"$ne": "offline"},        # honour an explicit "offline"
            "last_seen_at": {"$gte": online_since},
        }
        eligible = await db.users.find(query, {"_id": 0}).to_list(500)

        chosen: Optional[Dict[str, Any]] = None
        # Local-first progressive widening when both sides have coordinates.
        if lat is not None and lng is not None and _haversine_km is not None:
            located = [
                u for u in eligible
                if u.get("suburb_lat") is not None and u.get("suburb_lng") is not None
                and u.get("location_visibility") != "private"
            ]
            for radius in (25, 50, 100, 250):
                near = []
                for u in located:
                    dist = _haversine_km(float(lat), float(lng), float(u["suburb_lat"]), float(u["suburb_lng"]))
                    if dist <= radius:
                        near.append((dist, u))
                if near:
                    near.sort(key=lambda x: x[0])
                    # Randomise among the closest handful so the same nearest
                    # neighbour isn't matched every single time.
                    chosen = random.choice([u for _, u in near[:5]])
                    break

        # Widen to anywhere if nobody local (or no coordinates on either side).
        if chosen is None and eligible:
            chosen = random.choice(eligible)

        if not chosen:
            raise HTTPException(404, "No one's free to play right now — try again in a little while!")

        host = await _user_slim(me["id"])
        guest = await _user_slim(chosen["id"])
        sess = {
            "id": nid()[:8],
            "game": body.game,
            "status": "invited",
            "host_id": host["id"],
            "guest_id": guest["id"],
            "players": [
                {**host, "score": 0, "done": False},
                {**guest, "score": 0, "done": False},
            ],
            "content": _new_content(body.game),
            "turn": host["id"],
            "winner_id": None,
            "awarded": {},
            "origin": "matchmaking",
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }
        await db.play_sessions.insert_one(sess)
        await _notify(
            sess, guest["id"], "game_invite",
            f"{host['name']} would like to play {GAME_LABELS[body.game]} with you",
            "Tap to accept and meet someone new.",
        )
        return _public(sess, me["id"])

    @api.post("/play/{session_id}/accept")
    async def play_accept(session_id: str, me: dict = Depends(current_user)):
        sess = await _load(session_id, me["id"])
        if sess["guest_id"] != me["id"]:
            raise HTTPException(403, "Only the invited friend can accept")
        if sess["status"] not in ("invited", "active"):
            raise HTTPException(400, "This game can no longer be joined")
        if sess["status"] == "invited":
            sess["status"] = "active"
            sess["updated_at"] = now_iso()
            awarded = sess.setdefault("awarded", {})
            if not awarded.get("accept") and await _try_earn(sess["guest_id"], sess["id"]):
                await award_points(sess["guest_id"], PTS_ACCEPT, "play_together_accept")
                awarded["accept"] = True
            if not awarded.get("invite") and await _try_earn(sess["host_id"], sess["id"]):
                await award_points(sess["host_id"], PTS_INVITE, "play_together_invite")
                awarded["invite"] = True
            await db.play_sessions.replace_one({"id": session_id}, sess)
            host_name = sess["players"][1]["name"]
            await _notify(sess, sess["host_id"], "game_start",
                          f"{host_name} is ready — {GAME_LABELS[sess['game']]} has started!")
        return _public(sess, me["id"])

    @api.post("/play/{session_id}/decline")
    async def play_decline(session_id: str, me: dict = Depends(current_user)):
        sess = await _load(session_id, me["id"])
        if sess["status"] == "invited":
            sess["status"] = "declined"
            sess["updated_at"] = now_iso()
            await db.play_sessions.replace_one({"id": session_id}, sess)
            await _notify(sess, sess["host_id"], "game_end",
                          f"{sess['players'][1]['name']} can't play right now")
            # iter181 item 1: remember this decline so matchmaking won't pair
            # these two members again for 24h. Keyed on the sorted pair.
            pair = sorted([sess["host_id"], sess["guest_id"]])
            await db.play_declines.update_one(
                {"pair": ":".join(pair)},
                {"$set": {"pair": ":".join(pair), "members": pair, "declined_at": now_iso()}},
                upsert=True,
            )
        return _public(sess, me["id"])

    @api.post("/play/{session_id}/snooze")
    async def play_snooze(session_id: str, me: dict = Depends(current_user)):
        """iter210 (Garry, Oct 2026 — RED #8): recipient taps Snooze on a game
        invite popup. The sender was previously left on 'Waiting for X to
        accept' with no feedback. Now we close the invite and send the host a
        clear 'X isn't ready to play right now' notification so they can move
        on. Same semantics as Decline (session becomes 'declined'), but the
        host-facing wording is specifically about the recipient being
        unavailable rather than refusing to play."""
        sess = await _load(session_id, me["id"])
        if sess["guest_id"] != me["id"]:
            raise HTTPException(403, "Only the invited friend can snooze")
        if sess["status"] == "invited":
            sess["status"] = "declined"
            sess["updated_at"] = now_iso()
            await db.play_sessions.replace_one({"id": session_id}, sess)
            await _notify(sess, sess["host_id"], "game_end",
                          f"{sess['players'][1]['name']} isn't ready to play right now")
            pair = sorted([sess["host_id"], sess["guest_id"]])
            await db.play_declines.update_one(
                {"pair": ":".join(pair)},
                {"$set": {"pair": ":".join(pair), "members": pair, "declined_at": now_iso()}},
                upsert=True,
            )
        return _public(sess, me["id"])

    @api.post("/play/{session_id}/cancel")
    async def play_cancel(session_id: str, me: dict = Depends(current_user)):
        """Host withdraws a pending invite. Only valid while still 'invited'.
        No points change hands; the session leaves all active surfaces and
        can never be accepted afterwards."""
        sess = await _load(session_id, me["id"])
        if sess["host_id"] != me["id"]:
            raise HTTPException(403, "Only the person who sent the invite can cancel it")
        if sess["status"] != "invited":
            raise HTTPException(400, "This invite can no longer be cancelled")
        sess["status"] = "cancelled"
        sess["updated_at"] = now_iso()
        await db.play_sessions.replace_one({"id": session_id}, sess)
        await _notify(sess, sess["guest_id"], "game_end",
                      f"{sess['players'][0]['name']} cancelled the game invite")
        return _public(sess, me["id"])

    @api.post("/play/{session_id}/move")
    async def play_move(session_id: str, body: MoveBody, me: dict = Depends(current_user)):
        sess = await _load(session_id, me["id"])
        if sess["status"] != "active":
            raise HTTPException(400, "This game isn't active")
        game = sess["game"]
        players = {p["id"]: p for p in sess["players"]}
        other_id = sess["guest_id"] if me["id"] == sess["host_id"] else sess["host_id"]
        content = sess["content"]

        if game in ("this_or_that", "quick_trivia"):
            answers = body.answers or []
            expected = len(content["prompts"]) if game == "this_or_that" else len(content["questions"])
            if len(answers) != expected:
                raise HTTPException(400, "Please answer every question")
            if players[me["id"]]["done"]:
                raise HTTPException(400, "You've already submitted")
            content.setdefault("answers", {})[me["id"]] = answers
            players[me["id"]]["done"] = True
            if game == "quick_trivia":
                correct = sum(
                    1 for i, q in enumerate(content["questions"]) if answers[i] == q["answer"]
                )
                players[me["id"]]["score"] = correct
            sess["players"] = list(players.values())
            sess["updated_at"] = now_iso()
            if all(p["done"] for p in sess["players"]):
                if game == "this_or_that":
                    a = content["answers"][sess["host_id"]]
                    b = content["answers"][sess["guest_id"]]
                    content["matches"] = sum(1 for i in range(len(a)) if a[i] == b[i])
                await _finish_and_award(sess)
            await db.play_sessions.replace_one({"id": session_id}, sess)
            if sess["status"] == "finished":
                await _notify(sess, other_id, "game_end",
                              f"{players[me['id']]['name']} finished — see how you did!")
            else:
                await _notify(sess, other_id, "game_move",
                              f"{players[me['id']]['name']} has answered — your turn!")
            return _public(sess, me["id"])

        # word_chain --------------------------------------------------------
        if sess["turn"] != me["id"]:
            raise HTTPException(400, "It's not your turn yet")
        if body.give_up:
            sess["winner_id"] = other_id
            await _finish_and_award(sess)
            await db.play_sessions.replace_one({"id": session_id}, sess)
            await _notify(sess, other_id, "game_end",
                          f"{players[me['id']]['name']} passed — you win!")
            return _public(sess, me["id"])
        word = (body.word or "").strip()
        # Deterministic rules first (validity / starting letter / no repeat).
        reject = _word_chain_reject(
            content.get("category", ""), word, content.get("chain", []),
            content.get("required_letter", ""), skip_category_check=True,
        )
        if reject:
            raise HTTPException(400, reject)
        # Category-fit: accept curated-bank words instantly; otherwise ask the
        # AI judge (with graceful fallback to accept). Open-ended categories
        # (no curated bank) are always accepted.
        cat = content.get("category", "")
        valid = WORD_CHAIN_DICT.get(cat)
        if valid is not None and word.lower() not in valid:
            if not await _word_chain_category_fits(cat, word):
                raise HTTPException(400, f"Hmm, “{word}” doesn't look like it fits {cat}. Try another!")
        content["chain"].append({"player_id": me["id"], "word": word})
        content["required_letter"] = word.strip()[-1].upper()
        players[me["id"]]["score"] = players[me["id"]].get("score", 0) + 1
        sess["players"] = list(players.values())
        sess["turn"] = other_id
        sess["updated_at"] = now_iso()
        if len(content["chain"]) >= WORD_CHAIN_TARGET:
            sess["winner_id"] = None  # reached the target together
            await _finish_and_award(sess)
            await db.play_sessions.replace_one({"id": session_id}, sess)
            await _notify(sess, other_id, "game_end",
                          f"You both reached {WORD_CHAIN_TARGET} words — nice teamwork!")
            return _public(sess, me["id"])
        await db.play_sessions.replace_one({"id": session_id}, sess)
        await _notify(sess, other_id, "game_move",
                      f"{players[me['id']]['name']} said “{word}” — your turn ({content['required_letter']})")
        return _public(sess, me["id"])

    @api.post("/play/{session_id}/rematch")
    async def play_rematch(session_id: str, me: dict = Depends(current_user)):
        """"Play again" — sends the same friend a FRESH invite they must
        accept (mirrors /play/invite), rather than starting immediately. The
        sender lands on the new session in a "waiting" state and can cancel."""
        old = await _load(session_id, me["id"])
        if old["status"] != "finished":
            raise HTTPException(400, "Finish this game first")
        guest_id = old["guest_id"] if me["id"] == old["host_id"] else old["host_id"]
        host = await _user_slim(me["id"])
        guest = await _user_slim(guest_id)
        new = {
            "id": nid()[:8],
            "game": old["game"],
            "status": "invited",  # recipient must accept/decline
            "host_id": host["id"],
            "guest_id": guest["id"],
            "players": [
                {**host, "score": 0, "done": False},
                {**guest, "score": 0, "done": False},
            ],
            "content": _new_content(old["game"]),
            "turn": host["id"],
            "winner_id": None,
            "awarded": {},
            "origin": old.get("origin", "friend"),
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }
        await db.play_sessions.insert_one(new)
        await _notify(
            new, guest["id"], "game_invite",
            f"{host['name']} invited you to play {GAME_LABELS[new['game']]} again",
            "Tap to accept and play together.",
        )
        return _public(new, me["id"])

    @api.get("/play/{session_id}")
    async def play_get(session_id: str, me: dict = Depends(current_user)):
        sess = await _load(session_id, me["id"])
        return _public(sess, me["id"])

    @api.get("/play/mine/list")
    async def play_mine(me: dict = Depends(current_user)):
        cur = db.play_sessions.find(
            {"$or": [{"host_id": me["id"]}, {"guest_id": me["id"]}],
             "status": {"$in": ["invited", "active"]}},
        ).sort("updated_at", -1).limit(20)
        out = []
        async for s in cur:
            out.append(_public(s, me["id"]))
        return {"sessions": out}
