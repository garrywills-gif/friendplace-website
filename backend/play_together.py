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
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel

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


class InviteBody(BaseModel):
    game: str
    friend_id: str


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
        await push_notification(
            to_id, n_type, title, body,
            {"session_id": sess["id"], "game": sess["game"]},
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
        if len(word) < 2 or not word[0].isalpha() or not word.replace(" ", "").isalpha():
            raise HTTPException(400, "Please enter a real word")
        req = content.get("required_letter", "").lower()
        if req and word[0].lower() != req:
            raise HTTPException(400, f"Your word must start with '{req.upper()}'")
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
        old = await _load(session_id, me["id"])
        if old["status"] != "finished":
            raise HTTPException(400, "Finish this game first")
        new = {
            "id": nid()[:8],
            "game": old["game"],
            "status": "active",  # both already agreed to play
            "host_id": me["id"],
            "guest_id": old["guest_id"] if me["id"] == old["host_id"] else old["host_id"],
            "players": [
                {"id": p["id"], "name": p["name"], "avatar": p["avatar"], "score": 0, "done": False}
                for p in sorted(old["players"], key=lambda p: 0 if p["id"] == me["id"] else 1)
            ],
            "content": _new_content(old["game"]),
            "turn": me["id"],
            "winner_id": None,
            "awarded": {},
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }
        await db.play_sessions.insert_one(new)
        other_id = new["guest_id"]
        await _notify(new, other_id, "game_start",
                      f"{new['players'][0]['name']} wants a rematch — {GAME_LABELS[new['game']]}!")
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
