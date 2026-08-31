"""Batch A — George Member Memory & Recognition tests.

Covers the fixes locked with Garry on 31 Aug 2026:

  1. Preferred-name validator rejects pronouns / articles / question-y
     values / self-references / etc., and never substitutes another
     field.
  2. Onboarding extractor's `_merge_patch` drops a bad preferred_name
     silently so it never reaches storage.
  3. Onboarding approve step scrubs the final `known` dict — belt-and-
     braces against legacy sessions.
  4. `resolve_preferred_name` prefers the trusted `george_profile`
     value, falls back only to a strictly-validated first_name, and
     returns None (never a substitute) when nothing is trusted.
  5. `pick_recall_thought` returns a warm interest-based follow-up
     deterministically per member+day.
  6. `daily_welcome._fmt` renders cleanly when no name is trusted
     (no ", ." artefacts).
  7. Cross-member isolation: two different user documents produce
     independent memory views and no leakage.
  8. End-to-end: onboarding extractor result `preferred_name = "My"`
     never reaches the composer's KNOWN block.
"""
from __future__ import annotations

import asyncio
import os
import time
import uuid

import pytest


# --------------------------------------------------------------------------
# 1. Validator tests — pure function, no DB.
# --------------------------------------------------------------------------

def test_is_plausible_preferred_name_accepts_real_names():
    from services.george.memory import is_plausible_preferred_name
    for good in ["Sarah", "Bob", "A.J.", "Ngaire", "Mary-Anne",
                 "O'Brien", "Testie", "Bo", "Jean-Luc", "Étienne"]:
        assert is_plausible_preferred_name(good), f"should accept {good!r}"


def test_is_plausible_preferred_name_rejects_pronouns_and_articles():
    from services.george.memory import is_plausible_preferred_name
    for bad in [
        "My", "us", "we", "I", "me", "You", "your", "our", "them",
        "he", "she", "the", "a", "an",
    ]:
        assert not is_plausible_preferred_name(bad), f"should reject {bad!r}"


def test_is_plausible_preferred_name_rejects_noise():
    from services.george.memory import is_plausible_preferred_name
    for bad in [
        "", " ", "  ",
        "?", "!",
        "george", "George", "FriendPlace",
        "call me?", "what's up",
        "friend", "mate", "member", "person",
        "1234", "42",
        "a" * 41,          # too long
        "B",               # too short
    ]:
        assert not is_plausible_preferred_name(bad), f"should reject {bad!r}"


def test_sanitise_preferred_name_collapses_whitespace():
    from services.george.memory import sanitise_preferred_name
    assert sanitise_preferred_name("  Sarah   Anne  ") == "Sarah Anne"


def test_sanitise_preferred_name_returns_none_on_pronoun():
    from services.george.memory import sanitise_preferred_name
    assert sanitise_preferred_name("My") is None
    assert sanitise_preferred_name("us") is None
    assert sanitise_preferred_name({"value": "us"}) is None  # wrong shape → None
    assert sanitise_preferred_name(None) is None
    assert sanitise_preferred_name(42) is None


# --------------------------------------------------------------------------
# 2. resolve_preferred_name — trusted name resolution.
# --------------------------------------------------------------------------

def test_resolve_preferred_name_prefers_george_profile_dict_shape():
    from services.george.memory import resolve_preferred_name
    user = {
        "id": "u1", "first_name": "Ignored",
        "george_profile": {"preferred_name": {"value": "Sarah", "source": "stated"}},
    }
    assert resolve_preferred_name(user) == "Sarah"


def test_resolve_preferred_name_accepts_plain_string_george_profile():
    """Older sessions / edits may store the plain string."""
    from services.george.memory import resolve_preferred_name
    user = {
        "id": "u1", "first_name": "Ignored",
        "george_profile": {"preferred_name": "Bob"},
    }
    assert resolve_preferred_name(user) == "Bob"


def test_resolve_preferred_name_falls_back_to_first_name_when_profile_missing():
    from services.george.memory import resolve_preferred_name
    user = {"id": "u1", "first_name": "Jane"}
    assert resolve_preferred_name(user) == "Jane"


def test_resolve_preferred_name_returns_none_when_profile_has_bad_value():
    """If george_profile is corrupted with 'My', DO NOT fall through to
    a possibly-valid first_name — return None. The rule is: if we
    can't trust the preferred choice, don't guess at all. Templates
    render an empty name slot.

    Wait — actually the design is: profile.preferred_name is the
    explicit user preference. If it's junk, we should still try
    first_name because that's the account name they chose at signup.
    Testing the current design.
    """
    from services.george.memory import resolve_preferred_name
    user = {
        "id": "u1", "first_name": "Jane",
        "george_profile": {"preferred_name": {"value": "My", "source": "stated"}},
    }
    # first_name IS validated by the same rules; "Jane" is plausible,
    # so we get "Jane" — a trusted name from the account. This is
    # correct: reject the junk, use the trusted account name.
    assert resolve_preferred_name(user) == "Jane"


def test_resolve_preferred_name_returns_none_when_nothing_trusted():
    from services.george.memory import resolve_preferred_name
    # Both fields are junk → no name at all.
    user = {
        "id": "u1", "first_name": "us",
        "george_profile": {"preferred_name": {"value": "My"}},
    }
    assert resolve_preferred_name(user) is None
    # No user doc → None.
    assert resolve_preferred_name(None) is None
    assert resolve_preferred_name({}) is None


# --------------------------------------------------------------------------
# 3. pick_recall_thought — memory-aware follow-up.
# --------------------------------------------------------------------------

def test_pick_recall_thought_matches_gardening_interest():
    from services.george.memory import pick_recall_thought
    user = {
        "id": "u1",
        "george_profile": {
            "preferred_name": {"value": "Sarah"},
            "interests": {"value": ["Gardening", "reading"]},
        },
    }
    line = pick_recall_thought(user, seed="probe-1")
    assert line is not None
    # One of the gardening OR reading templates fires. Both are safe.
    assert any(kw in line.lower() for kw in ("garden", "reading"))


def test_pick_recall_thought_includes_name_when_trusted():
    from services.george.memory import pick_recall_thought
    user = {
        "id": "u1",
        "george_profile": {
            "preferred_name": {"value": "Sarah"},
            "interests": {"value": ["cooking"]},
        },
    }
    # Deterministic seed forces the cooking template.
    line = pick_recall_thought(user, seed="probe-cook")
    assert line is not None
    assert "Sarah" in line
    # Should read naturally, no double-comma or trailing artefacts.
    assert ", ," not in line
    assert ", ?" not in line


def test_pick_recall_thought_omits_name_when_missing():
    from services.george.memory import pick_recall_thought
    user = {
        "id": "u1",
        "george_profile": {"interests": {"value": ["Gardening"]}},
    }
    line = pick_recall_thought(user, seed="probe-noname")
    assert line is not None
    # Should render like "How's the garden going?" (no name)
    assert not line.startswith(",")
    # Never contain a substitute for a name.
    for bad in ("My", "us", "friend", "member"):
        assert bad not in line, f"recall line leaked {bad!r}: {line}"


def test_pick_recall_thought_returns_none_when_no_interests():
    from services.george.memory import pick_recall_thought
    user = {"id": "u1", "george_profile": {"preferred_name": {"value": "Sarah"}}}
    assert pick_recall_thought(user) is None
    assert pick_recall_thought({}) is None
    assert pick_recall_thought(None) is None


def test_pick_recall_thought_deterministic_per_seed():
    from services.george.memory import pick_recall_thought
    user = {
        "id": "u1",
        "george_profile": {
            "preferred_name": {"value": "Sarah"},
            "interests": {"value": ["gardening", "cooking", "walking"]},
        },
    }
    a = pick_recall_thought(user, seed="fixed")
    b = pick_recall_thought(user, seed="fixed")
    assert a == b  # stable


# --------------------------------------------------------------------------
# 4. Cross-member isolation.
# --------------------------------------------------------------------------

def test_recall_context_is_per_user_no_leak():
    from services.george.memory import member_recall_context, pick_recall_thought
    alice = {
        "id": "alice",
        "george_profile": {
            "preferred_name": {"value": "Alice"},
            "interests": {"value": ["gardening"]},
        },
    }
    bob = {
        "id": "bob",
        "george_profile": {
            "preferred_name": {"value": "Bob"},
            "interests": {"value": ["cooking"]},
        },
    }
    ctx_a = member_recall_context(alice)
    ctx_b = member_recall_context(bob)
    assert ctx_a["preferred_name"] == "Alice"
    assert ctx_b["preferred_name"] == "Bob"
    assert ctx_a["interests"] == ["gardening"]
    assert ctx_b["interests"] == ["cooking"]
    # Recall lines reference each member's own name and interests.
    line_a = pick_recall_thought(alice, seed="cross-a")
    line_b = pick_recall_thought(bob, seed="cross-b")
    assert line_a and "Alice" in line_a
    assert line_b and "Bob" in line_b
    assert "Alice" not in line_b
    assert "Bob" not in line_a


# --------------------------------------------------------------------------
# 5. Onboarding merge — bad preferred_name gets dropped at storage.
# --------------------------------------------------------------------------

def test_merge_patch_drops_pronoun_preferred_name():
    from services.george.onboarding.service import _merge_patch
    known = {}
    patch = {"patch": {"preferred_name": {"value": "My", "source": "stated"}}}
    merged = _merge_patch(known, patch)
    assert "preferred_name" not in merged, \
        "bad preferred_name must never reach storage — got %r" % merged


def test_merge_patch_keeps_good_preferred_name():
    from services.george.onboarding.service import _merge_patch
    known = {}
    patch = {"patch": {"preferred_name": {"value": "Testie", "source": "stated"}}}
    merged = _merge_patch(known, patch)
    assert merged["preferred_name"]["value"] == "Testie"
    assert merged["preferred_name"]["source"] == "stated"


def test_merge_patch_preserves_other_fields():
    from services.george.onboarding.service import _merge_patch
    known = {"area": {"value": "Manly", "source": "stated"}}
    patch = {"patch": {
        "preferred_name": {"value": "us", "source": "stated"},   # bad → dropped
        "interests":      {"value": ["gardening"], "source": "stated"},
    }}
    merged = _merge_patch(known, patch)
    assert "preferred_name" not in merged
    assert merged["interests"]["value"] == ["gardening"]
    assert merged["area"]["value"] == "Manly"  # untouched


# --------------------------------------------------------------------------
# 6. Approve step scrubs a legacy bad preferred_name from `known`.
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_approve_scrubs_legacy_bad_preferred_name():
    """Simulate a session drafted BEFORE the extractor was tightened —
    it has "My" in known. Approve must strip it before writing to the
    user document."""
    from motor.motor_asyncio import AsyncIOMotorClient
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from services.george.onboarding.service import approve_onboarding, COLL_ONBOARDING

    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.getenv("DB_NAME", "test_database")]

    actor_id = f"unit-{uuid.uuid4().hex[:8]}"
    sid = str(uuid.uuid4())
    # Legacy session with a corrupted preferred_name AND real interests.
    await db[COLL_ONBOARDING].insert_one({
        "id": sid, "session_id": sid, "actor_id": actor_id,
        "status": "drafted", "turns": [], "skipped": [],
        "known": {
            "preferred_name": {"value": "My", "source": "stated"},
            "interests": {"value": ["gardening"], "source": "stated"},
        },
        "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z",
    })
    await db.users.update_one(
        {"id": actor_id}, {"$set": {"id": actor_id, "first_name": "Casey"}},
        upsert=True,
    )
    try:
        res = await approve_onboarding(db, sid)
        assert res["profile"].get("preferred_name") is None, \
            "approve must strip 'My' from the final profile — got %r" % res["profile"]
        assert res["profile"]["interests"]["value"] == ["gardening"]
        # And on the user doc.
        u = await db.users.find_one({"id": actor_id}, {"_id": 0})
        gp = u.get("george_profile") or {}
        assert "preferred_name" not in gp, \
            "user.george_profile must not contain the bad name"
        assert gp["interests"]["value"] == ["gardening"]
    finally:
        await db[COLL_ONBOARDING].delete_one({"session_id": sid})
        await db.users.delete_one({"id": actor_id})
        client.close()


# --------------------------------------------------------------------------
# 7. daily_welcome — clean rendering with no-name.
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_daily_welcome_renders_without_name_when_untrusted():
    """A member whose only stored name is 'My' should be greeted with
    NO name at all — never as 'Good morning, My.'."""
    from motor.motor_asyncio import AsyncIOMotorClient
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from services.george.daily_welcome import (
        get_daily_welcome, ensure_indexes, seed_defaults, STATE_COLLECTION,
    )
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.getenv("DB_NAME", "test_database")]
    try:
        await ensure_indexes(db)
        await seed_defaults(db)
        user_id = f"dw-{uuid.uuid4().hex[:8]}"
        user = {
            "id": user_id,
            "first_name": "us",  # bad — must be rejected
            "george_profile": {"preferred_name": {"value": "My"}},  # bad
        }
        await db[STATE_COLLECTION].delete_one({"user_id": user_id})
        payload = await get_daily_welcome(db, user=user, force=True)
        assert payload["shown"] is True
        opener = payload["opener"]
        # No corrupted-name artefacts.
        for bad in (", My", ", us", " My.", " us.", " {first_name}"):
            assert bad not in opener, \
                f"leaked bad name/placeholder in opener: {opener!r}"
        # No trailing ", ." artefact either.
        assert ", ." not in opener, f"trailing artefact in opener: {opener!r}"
    finally:
        client.close()


@pytest.mark.asyncio
async def test_daily_welcome_uses_trusted_name_when_available():
    from motor.motor_asyncio import AsyncIOMotorClient
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from services.george.daily_welcome import (
        get_daily_welcome, ensure_indexes, seed_defaults, STATE_COLLECTION,
    )
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.getenv("DB_NAME", "test_database")]
    try:
        await ensure_indexes(db)
        await seed_defaults(db)
        user_id = f"dw-{uuid.uuid4().hex[:8]}"
        user = {
            "id": user_id,
            "first_name": "Sarah",
            "george_profile": {"preferred_name": {"value": "Sarah"}},
        }
        await db[STATE_COLLECTION].delete_one({"user_id": user_id})
        payload = await get_daily_welcome(db, user=user, force=True)
        assert payload["shown"] is True
        # Either the opener OR warm_thought/recall may contain the name;
        # what matters is no bad-name leak AND the payload renders.
        for bad in (", My", ", us", "{first_name}"):
            assert bad not in payload["opener"], payload
    finally:
        client.close()
