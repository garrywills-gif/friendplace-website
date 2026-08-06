"""Shared business-content heuristic + prolific-poster gate.

This module is the SINGLE SOURCE OF TRUTH for the business /
promotional-post detection that runs across FriendPlace posting
surfaces:

    * Host an Event   (POST /api/events/preflight)
    * Notice Board    (POST /api/notices)
    * Future surfaces (flyers, groups, …) — call this same code.

The heuristic runs in two parts, matching the events preflight logic
that has been in production since iter35:

    1. TEXT SCORER  — `check_business_content(title, body, location=None)`
       Scores across four buckets (clubs, business nouns, pricing
       language, phone/URLs). Score ≥ 2 flags. Reasons are surfaced
       so admins can see WHY something was held.

    2. PROLIFIC POSTER GATE  — `count_prior_content(db, user_id, kind)`
       Counts how many prior events/notices this user has posted.
       If ≥ PROLIFIC_HOST_THRESHOLD (default 3, env-configurable),
       flag regardless of text.

`moderation_verdict(...)` combines both signals into a single
`{ should_hold, score, reasons, prolific_flag, prior_count }`
result any endpoint can use.

Locked with Garry (iter153, June 2026): thresholds are the SAME for
events and notices. Do not loosen for notices — the whole point of
Notice-Board parity is to close a loophole a business could otherwise
walk straight through.
"""

from __future__ import annotations

import os
import re
from typing import Any, Literal, Optional

# ── Public constants ──────────────────────────────────────────────────

# The two user-facing hold messages. Deliberately calm and generic —
# they must NOT tell the poster they've been "detected as a business"
# or "flagged as spam". Locked with Garry (iter153): a routine safety
# check, not an accusation.

HOLD_MESSAGE_EVENT = (
    "We're just checking this event fits our community guidelines. "
    "We'll let you know as soon as it's been reviewed."
)

HOLD_MESSAGE_NOTICE = (
    "We're just checking this notice fits our community guidelines. "
    "We'll let you know as soon as it's been reviewed."
)

ContentKind = Literal["event", "notice"]

# Score at or above which the text scorer flags a post. Kept as a
# module constant so the tests and CI can reference the same number
# the runtime uses.
BUSINESS_SCORE_THRESHOLD = 2


# ── Text heuristic ────────────────────────────────────────────────────

def check_business_content(
    title: str,
    body: str = "",
    location: str = "",
) -> dict:
    """Score the given text fields for business/promotional content.

    Returns::

        {
            "looks_business": bool,   # score >= BUSINESS_SCORE_THRESHOLD
            "score":          int,    # 0+
            "reasons":        list[str],   # human-readable, capped at 4
        }

    Ported verbatim from the events preflight scorer that has been in
    production since iter35. Any change here changes ALL posting
    surfaces at once — that's the point.

    Notes on notice-board fit:
      * `location` is optional. Notices don't have a location field,
        so callers pass "" (which just means that column contributes
        nothing to the score — no scoring re-tuning needed).
      * The scorer already normalises the way body text length
        affects results — money/booking/phone patterns are one-shot
        boolean triggers, so a short notice doesn't score less than
        a long event just because it's short. Business detection
        remains equivalent.
    """
    haystack = " ".join([title or "", body or "", location or ""]).lower()
    reasons: list[str] = []
    score = 0

    # ── Bucket 1 — clubs & community-business venues (Aussie focus).
    # These places ARE community spaces, but they're also commercial
    # and we want them to share the listing fee. Catches RSLs,
    # bowling/surf/golf clubs etc. trying to fill mid-week tables via
    # the app or promote their events on the Notice Board.
    CLUBS = [
        "rsl", "returned and services league", "bowls club", "bowling club",
        "bowlo", "surf club", "surf life saving", "leagues club", "workers club",
        "country club", "golf club", "yacht club", "sailing club", "tennis club",
        "lawn bowls", "sports club", "football club", "cricket club", "polo club",
        "rotary club", "lions club", "men's shed", "mens shed",
    ]
    for c in CLUBS:
        if c in haystack:
            reasons.append(f'mentions a club / venue ("{c}")')
            score += 2  # strong signal — clubs almost always = paid promotion
            break

    # ── Bucket 2 — overt business types.
    BIZ_NOUNS = [
        "café", "cafe", "restaurant", "bistro", "pub", "brewery", "winery",
        "bakery", "patisserie", "salon", "studio", "boutique", "clinic",
        "dentist", "gym", "fitness centre", "yoga studio", "pilates studio",
        "academy", "school of", "spa", "massage", "shop", "store",
        "retailer", "showroom", "dealership", "gallery", "theatre",
    ]
    for n in BIZ_NOUNS:
        if n in haystack:
            reasons.append(f'business noun ("{n}")')
            score += 1
            break

    # ── Bucket 3 — explicit pricing / ticketing language.
    money_re = re.compile(r"\$\s?\d|\baud?\b|\bgst\b|\bper person\b|\bper head\b", re.I)
    if money_re.search(haystack):
        reasons.append("explicit pricing / dollar amount")
        score += 1
    BOOK_WORDS = [
        "book now", "buy tickets", "tickets available", "register at",
        "rsvp by phone", "limited spots", "limited tickets", "early bird",
        "discount code", "% off", " off!", "deal", "sale", "special offer",
        "promo code", "promotion code", "trybooking", "eventbrite",
        "humanitix", "moshtix", "ticketek", "stickytickets",
    ]
    for w in BOOK_WORDS:
        if w in haystack:
            reasons.append(f'ticketing / promo language ("{w.strip()}")')
            score += 1
            break

    # ── Bucket 4 — links + phone numbers.
    if re.search(r"https?://|www\.", haystack):
        reasons.append("external website link")
        score += 1
    if re.search(r"\b0[2-578]\s?\d{4}\s?\d{4}\b|\b1300\s?\d{3}\s?\d{3}\b|\b1800\s?\d{3}\s?\d{3}\b", haystack):
        reasons.append("business phone number (1300 / 1800 / landline)")
        score += 1

    return {
        "looks_business": score >= BUSINESS_SCORE_THRESHOLD,
        "score": score,
        "reasons": reasons[:4],  # cap so any modal / signal stays scannable
    }


# ── Prolific-poster gate ──────────────────────────────────────────────

def _prolific_threshold() -> int:
    """Read the shared prolific-poster threshold from env.

    Same env var as the events preflight has always used
    (`PROLIFIC_HOST_THRESHOLD`, default 3) so tuning stays in ONE
    place across surfaces. Renaming this env var would be a
    breaking change for existing deployments.
    """
    try:
        return int(os.getenv("PROLIFIC_HOST_THRESHOLD", "3"))
    except Exception:
        return 3


async def count_prior_content(
    db: Any,
    user_id: str,
    kind: ContentKind,
) -> int:
    """Count this user's prior content on the given surface.

    * kind="event"   → counts prior `events` where host_id == user_id
    * kind="notice"  → counts prior `notices` where user_id == user_id

    Failures are swallowed and treated as 0 so a DB hiccup can never
    take a poster over the threshold accidentally.
    """
    if not user_id:
        return 0
    try:
        if kind == "event":
            return await db.events.count_documents({"host_id": user_id})
        if kind == "notice":
            return await db.notices.count_documents({"user_id": user_id})
    except Exception:
        return 0
    return 0


# ── Combined verdict ──────────────────────────────────────────────────

async def moderation_verdict(
    db: Any,
    *,
    title: str,
    body: str = "",
    location: str = "",
    user_id: Optional[str] = None,
    kind: ContentKind = "notice",
) -> dict:
    """Combined moderation verdict for a post about to be created.

    Returns::

        {
            "should_hold":     bool,   # true if either signal fired
            "score":           int,    # text-scorer score
            "reasons":         list[str],
            "prolific_flag":   bool,   # true if prior-count ≥ threshold
            "prior_count":     int,
            "threshold":       int,
            "text_flag":       bool,   # true if text score ≥ threshold
        }

    Callers use `should_hold` to decide whether to route the post
    into the shared MCGS moderation queue. `reasons` should be
    attached to the moderation record for admin review — never
    shown to the poster.
    """
    text = check_business_content(title=title, body=body, location=location)
    prior_count = 0
    prolific_flag = False
    threshold = _prolific_threshold()
    if user_id:
        prior_count = await count_prior_content(db, user_id, kind)
        if prior_count >= threshold:
            prolific_flag = True

    reasons = list(text.get("reasons") or [])
    if prolific_flag:
        reasons.append(f"prolific_poster:{prior_count}_prior_{kind}s")

    return {
        "should_hold":   bool(text.get("looks_business")) or prolific_flag,
        "score":         int(text.get("score") or 0),
        "reasons":       reasons,
        "prolific_flag": prolific_flag,
        "prior_count":   prior_count,
        "threshold":     threshold,
        "text_flag":     bool(text.get("looks_business")),
    }
