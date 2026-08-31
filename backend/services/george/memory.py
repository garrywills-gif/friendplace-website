"""George Member Memory — trusted read-side helpers.

Batch A fix (Garry, TestFlight 1027 feedback — Aug 2026):
member memory retention wasn't reliable across sessions. Two root
causes were located during trace:

  1. The onboarding extractor occasionally stored a pronoun or article
     ("My", "us", "You", "The") as `preferred_name`, because a Claude
     Haiku prompt has no strict validator on structured output. The
     bad value then flowed straight to the composer, and George
     addressed the member as "My" or "us". Same-shape hallucinations
     ("Margaret") arose when the composer prompt had no explicit
     rule against inventing member facts.

  2. `users.george_profile` was written on approve but NEVER read by
     any member-facing surface again. Daily welcome, remembers and
     follow-up compositions all fell back to raw `first_name`,
     so George never naturally referenced gardening or cooking on
     a later day.

This module is the trusted read-side. Every member-facing surface
should call ``resolve_preferred_name(user)`` (never `.get(...)` a
name directly), so name corruption is contained here and can never
reach a prompt or a rendered template.

  - `is_plausible_preferred_name(v)` — the single validator. Also
     used at write-time inside the onboarding extractor.
  - `resolve_preferred_name(user_doc)` — returns a trusted string
     or None. Never substitutes another field.
  - `pick_recall_thought(user_doc)` — deterministic-ish picker of
     a warm recall line based on `interests` (e.g. "How's the
     garden going, {name}?"). Returns None if nothing eligible.

Locked with Garry, 31 Aug 2026.
"""
from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from typing import Any, Optional

# --------------------------------------------------------------------------
# 1. Trusted preferred-name validation.
# --------------------------------------------------------------------------
#
# Rules for what counts as a plausible person's name — deliberately
# permissive on real people (multi-word, apostrophes, hyphens, unicode
# letters) but strict on pronouns, articles, and other noise the LLM
# extractor sometimes surfaces.
#
# Anything that fails validation is dropped. We NEVER substitute a
# fallback field. A missing name is a valid state — George just
# addresses the member without a name.

# Pronouns, articles, common single-word noise, and phrases the
# extractor has actually returned during live testing. Case-insensitive.
_NAME_STOPWORDS: frozenset[str] = frozenset({
    # Pronouns
    "i", "me", "my", "mine", "myself",
    "we", "us", "our", "ours", "ourselves",
    "you", "your", "yours", "yourself", "yourselves",
    "he", "him", "his", "himself",
    "she", "her", "hers", "herself",
    "it", "its", "itself",
    "they", "them", "their", "theirs", "themselves",
    # Articles / determiners
    "the", "a", "an", "this", "that", "these", "those",
    # Question openers the extractor sometimes captures whole-cloth
    "what", "who", "when", "where", "why", "how", "which",
    "whats", "whos",
    # Common noise the extractor has surfaced from ambiguous phrases
    "name", "call", "friend", "friends", "member", "mate", "hi", "hey",
    "hello", "yes", "no", "ok", "okay", "sure", "thanks", "please",
    "nothing", "someone", "anyone", "nobody", "everybody", "somebody",
    "person", "people", "guy", "guys", "girl", "girls", "boy", "boys",
    "unsure", "maybe", "dunno", "up", "down",
})

# Additional patterns we reject outright — assistant echoes, self-refs,
# and question-like values (LLM sometimes returns "What did you say?"
# as the extracted field value).
_NAME_REJECT_PATTERNS: tuple[re.Pattern, ...] = (
    re.compile(r"^george\b", re.IGNORECASE),      # self-reference
    re.compile(r"^friendplace\b", re.IGNORECASE),
    re.compile(r"[?!]"),                          # punctuation implying dialog
    re.compile(r"\bcall\b", re.IGNORECASE),       # e.g. "call me testie" left un-parsed
    re.compile(r"\bname\b", re.IGNORECASE),
)

# Length: 2 to 40 characters. Long enough for "Bo" or "Jo"; short
# enough to rule out sentence fragments.
_NAME_MIN_LEN, _NAME_MAX_LEN = 2, 40

# Allowed chars: letters (any Unicode), spaces, apostrophes, hyphens,
# and periods (for initials like "A.J."). No digits, no @, no /.
_NAME_ALLOWED = re.compile(r"^[^\W\d_][\w\s'.\-]{0,}$", re.UNICODE)


def is_plausible_preferred_name(value: Any) -> bool:
    """True iff `value` looks like a real preferred name.

    Deliberately conservative — better to address the member without
    a name than to greet them as "My" or "us".
    """
    if not isinstance(value, str):
        return False
    v = value.strip()
    if not v:
        return False
    if len(v) < _NAME_MIN_LEN or len(v) > _NAME_MAX_LEN:
        return False
    if v.lower() in _NAME_STOPWORDS:
        return False
    for pat in _NAME_REJECT_PATTERNS:
        if pat.search(v):
            return False
    if not _NAME_ALLOWED.match(v):
        return False
    # Every word (split on whitespace) must not be a stopword. This
    # catches phrases like "The Mrs" where individual tokens are all
    # stopwords / titles the LLM tried to smuggle in as a name.
    # Strip apostrophes when checking so "What's" hits "whats".
    def _norm_token(t: str) -> str:
        return re.sub(r"['\u2019]", "", t.lower())
    tokens = [t for t in re.split(r"\s+", v) if t]
    if all(_norm_token(t) in _NAME_STOPWORDS for t in tokens):
        return False
    return True


def sanitise_preferred_name(value: Any) -> Optional[str]:
    """Return the cleaned name if plausible, else None. Never returns a
    replacement — a missing / unclean name is a valid absence."""
    if not is_plausible_preferred_name(value):
        return None
    v = str(value).strip()
    # Collapse internal whitespace.
    v = re.sub(r"\s+", " ", v)
    return v


# --------------------------------------------------------------------------
# 2. Read the member's trusted display name.
# --------------------------------------------------------------------------

def resolve_preferred_name(user_doc: Optional[dict]) -> Optional[str]:
    """Return the trusted preferred name to address the member by.

    Read order:
      1. `users.george_profile.preferred_name.value` (source of truth
         after George onboarding is approved).
      2. `users.first_name` / `firstName` / `given_name` — the account
         name from signup. Validated with the SAME rules so a garbage
         `first_name` (e.g. "user_38493") never leaks into a greeting.

    If neither is trusted, return None. Templates should render an
    empty name slot ("Good morning." rather than "Good morning, My.").
    NEVER substitute another field.
    """
    if not user_doc:
        return None
    profile = user_doc.get("george_profile") or {}
    pn = profile.get("preferred_name")
    # `preferred_name` can be stored as {"value": "...", "source": "..."}
    # (session shape) or a plain string (older shape / edits).
    candidate: Any = None
    if isinstance(pn, dict):
        candidate = pn.get("value")
    elif isinstance(pn, str):
        candidate = pn
    cleaned = sanitise_preferred_name(candidate)
    if cleaned:
        return cleaned
    # Fall back to the account name — same strict validation.
    for key in ("first_name", "firstName", "given_name"):
        v = user_doc.get(key)
        cleaned = sanitise_preferred_name(v)
        if cleaned:
            return cleaned
    return None


def comma_name(name: Optional[str]) -> str:
    """", Sarah" or "" — never ", My". Callers concatenate this into
    template strings to get natural spacing without a special case."""
    return f", {name}" if name else ""


# --------------------------------------------------------------------------
# 3. Recall context — what does George know he could naturally reference?
# --------------------------------------------------------------------------

def member_recall_context(user_doc: Optional[dict]) -> dict:
    """Return a slim, LLM-safe view of what George reliably knows
    about this member. Every field is either present and trusted, or
    absent. The composer/greeting layer can inject this straight into
    a prompt or use `pick_recall_thought` for a template."""
    profile = (user_doc or {}).get("george_profile") or {}

    def _unwrap(field: str) -> Any:
        raw = profile.get(field)
        if isinstance(raw, dict):
            return raw.get("value")
        return raw

    def _as_list(v: Any) -> list[str]:
        if isinstance(v, list):
            return [str(x).strip() for x in v if isinstance(x, str) and x.strip()]
        if isinstance(v, str) and v.strip():
            return [v.strip()]
        return []

    return {
        "preferred_name":     resolve_preferred_name(user_doc),
        "area":               (_unwrap("area") if isinstance(_unwrap("area"), str) else None),
        "interests":          _as_list(_unwrap("interests")),
        "wants_more_of":      (_unwrap("wants_more_of")
                               if isinstance(_unwrap("wants_more_of"), str) else None),
        "connection_scope":   (_unwrap("connection_scope")
                               if isinstance(_unwrap("connection_scope"), str) else None),
    }


# --------------------------------------------------------------------------
# 4. Warm recall thoughts — "how's the garden going, Sarah?"
# --------------------------------------------------------------------------
#
# Curated pool of natural follow-ups keyed to interest fragments.
# Each entry:
#   {"match": [tokens], "line": "How's the garden going{name}?"}
# `line` may include `{name}` — replaced with `comma_name(...)` shape
# so an unknown name is silently dropped.
#
# Deliberately hand-picked (not LLM-generated) so the wording is safe
# and low-cost. Extend when Garry approves new lines.
_RECALL_TEMPLATES: tuple[dict[str, Any], ...] = (
    {
        "match": ("garden", "gardening", "veggie patch", "veggies", "roses", "vegetable"),
        "line":  "How's the garden going{name}?",
    },
    {
        "match": ("cook", "cooking", "baking", "recipe", "recipes"),
        "line":  "Cooked anything nice lately{name}?",
    },
    {
        "match": ("walk", "walking", "bushwalk", "bushwalking", "hiking", "walks", "trails"),
        "line":  "Been on any lovely walks{name}?",
    },
    {
        "match": ("dog", "dogs", "puppy", "pup", "pups"),
        "line":  "How's your pup keeping{name}?",
    },
    {
        "match": ("cat", "cats", "kitten"),
        "line":  "How's your cat keeping{name}?",
    },
    {
        "match": ("book", "books", "reading", "novel", "novels"),
        "line":  "Reading anything good at the moment{name}?",
    },
    {
        "match": ("classic car", "classic cars", "car meets", "cars", "motorbikes"),
        "line":  "Been to any nice car meets lately{name}?",
    },
    {
        "match": ("coffee", "cafe", "café", "coffee catch"),
        "line":  "Had a good coffee this week{name}?",
    },
    {
        "match": ("golf", "bowls", "lawn bowls", "tennis"),
        "line":  "Managed a hit or two lately{name}?",
    },
    {
        "match": ("knit", "knitting", "crochet", "sewing", "craft", "crafting"),
        "line":  "How's the knitting coming along{name}?",
    },
    {
        "match": ("fish", "fishing"),
        "line":  "Any luck out on the water{name}?",
    },
    {
        "match": ("grand", "grandkids", "grandchildren", "grandson", "granddaughter"),
        "line":  "How are the grandkids keeping{name}?",
    },
    {
        "match": ("music", "guitar", "piano", "choir", "singing", "sing"),
        "line":  "Made any lovely music this week{name}?",
    },
    {
        "match": ("volunteer", "volunteering"),
        "line":  "How's the volunteering going{name}?",
    },
)


def _canon(s: str) -> str:
    return re.sub(r"[^a-z\s]", " ", (s or "").lower())


def pick_recall_thought(user_doc: Optional[dict], *, seed: Optional[str] = None) -> Optional[str]:
    """Choose one warm follow-up line based on the member's interests.

    Returns a fully-formatted string (name substituted) or None if no
    template matched. Choice is stable-per-day-per-member — same day
    + same interests → same thought — so a returning member doesn't
    get a different recall line each time they reopen the app inside
    one day. `seed` overrides the daily key (used by tests).
    """
    ctx = member_recall_context(user_doc)
    interests = ctx.get("interests") or []
    if not interests:
        return None
    # Try each template; keep the ones that match on the member's
    # interests (canonicalised). Order preserved from the pool.
    haystack = " ".join(_canon(i) for i in interests)
    hits: list[dict[str, Any]] = []
    for tpl in _RECALL_TEMPLATES:
        if any(token in haystack for token in tpl["match"]):
            hits.append(tpl)
    if not hits:
        return None
    # Deterministic pick — same member+day → same line.
    key_material = (
        seed
        or f"{(user_doc or {}).get('id','')}-{datetime.now(timezone.utc).date().isoformat()}"
    )
    idx = int(hashlib.sha1(key_material.encode("utf-8")).hexdigest(), 16) % len(hits)
    tpl = hits[idx]
    return tpl["line"].format(name=comma_name(ctx.get("preferred_name")))


__all__ = [
    "is_plausible_preferred_name",
    "sanitise_preferred_name",
    "resolve_preferred_name",
    "comma_name",
    "member_recall_context",
    "pick_recall_thought",
]
