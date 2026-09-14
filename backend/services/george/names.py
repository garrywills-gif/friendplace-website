"""Shared member-name validation for George / Georgia.

Only a clearly real name may ever be shown to a member or stored as their
name. Ordinary conversational words (No, Yes, My, Me, Us, Hi, Hey, …) must
never be inferred or saved as a member's name — if there is no confirmed
name we use none at all. Used by BOTH the onboarding ("Get to Know You")
flow and the companion so the two paths can never disagree.
"""
from __future__ import annotations

from typing import Any, Optional

# Tokens that are never a real preferred name — guards against the
# onboarding extractor inferring junk like "No"/"My"/"Me"/"Us" from a
# conversational reply and it then being used to address the member.
BANNED_NAME_TOKENS = {
    "my", "me", "us", "mine", "myself", "i", "you", "your", "yours", "we",
    "they", "them", "someone", "somebody", "anybody", "friend", "mate",
    "buddy", "pal", "there", "hi", "hello", "hey", "hiya", "ok", "okay",
    "yeah", "yes", "no", "nah", "nope", "yep", "yup", "name", "unknown",
    "none", "null", "n/a", "na", "nobody", "person", "member", "user",
    "sure", "not", "dunno", "maybe", "thanks", "thank", "please", "cheers",
    "nothing", "everyone", "everybody",
}


def clean_name(raw: Optional[str]) -> Optional[str]:
    """Return a usable member name, or None if the value isn't clearly a
    real name. Rejects pronouns / filler / obvious non-names — we would
    rather use NO name than invent or mangle one."""
    if not raw or not isinstance(raw, str):
        return None
    n = raw.strip().strip(".,!?\"'").strip()
    if not n or len(n) < 2 or len(n) > 40:
        return None
    words = n.lower().split()
    if any(w in BANNED_NAME_TOKENS for w in words):
        return None
    if not any(ch.isalpha() for ch in n):
        return None
    return n


def name_field_value(field: Any) -> Optional[str]:
    """Extract the name string from a george_profile field that may be a
    ``{"value": ..., "source": ...}`` dict or a bare string."""
    if isinstance(field, dict):
        v = field.get("value")
        return v if isinstance(v, str) else None
    if isinstance(field, str):
        return field
    return None


async def scrub_invalid_member_names(db: Any) -> int:
    """One-pass cleanup: unset any stored member name that fails
    ``clean_name`` (e.g. an inferred "No" written by an older build).
    Idempotent and safe to re-run. Only touches ``preferred_name``
    (top-level and under ``george_profile``) — the field that could be
    inferred. Returns the number of user docs cleaned."""
    cleaned = 0
    try:
        cursor = db.users.find(
            {"$or": [
                {"george_profile.preferred_name": {"$exists": True}},
                {"preferred_name": {"$exists": True}},
            ]},
            {"_id": 0, "id": 1, "george_profile": 1, "preferred_name": 1},
        )
        async for u in cursor:
            unset: dict = {}
            prof = u.get("george_profile") or {}
            if "preferred_name" in prof and clean_name(name_field_value(prof.get("preferred_name"))) is None:
                unset["george_profile.preferred_name"] = ""
            if "preferred_name" in u and clean_name(u.get("preferred_name")) is None:
                unset["preferred_name"] = ""
            if unset and u.get("id"):
                await db.users.update_one({"id": u["id"]}, {"$unset": unset})
                cleaned += 1
    except Exception:  # pragma: no cover - cleanup must never crash startup
        pass
    return cleaned
