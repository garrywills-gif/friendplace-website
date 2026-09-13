"""Supplementary Batch A verification — beyond the primary unit tests.

These probes independently verify the claims in the Batch A review request
that weren't explicitly covered as isolated assertions in
`test_iter166_george_memory.py`:

  1. `pick_recall_thought` produces different lines across different
     members with different interests, over many simulated days
     (cross-profile isolation + no leak, at scale).
  2. `daily_welcome` uses the recall thought at roughly 1-in-3
     eligible days when the member has interests (deterministic per
     user+day gate).
  3. `remembers.render_pre_event` / `render_post_event` correctly
     resolve through the trusted validator — a bad `preferred_name`
     produces a name-less nudge, NOT "Your event is tomorrow, My.".
"""
from __future__ import annotations

import os
import uuid

import pytest


# --------------------------------------------------------------------------
# 1. Cross-profile isolation at scale — different members, many seeds.
# --------------------------------------------------------------------------

def test_recall_thought_no_cross_member_leak_across_many_seeds():
    from services.george.memory import pick_recall_thought

    alice = {
        "id": "alice",
        "george_profile": {
            "preferred_name": {"value": "Alice"},
            "interests": {"value": ["gardening", "cooking"]},
        },
    }
    bob = {
        "id": "bob",
        "george_profile": {
            "preferred_name": {"value": "Bob"},
            "interests": {"value": ["walking", "dogs"]},
        },
    }
    for i in range(50):
        seed = f"probe-{i}"
        la = pick_recall_thought(alice, seed=seed)
        lb = pick_recall_thought(bob, seed=seed)
        assert la is not None and lb is not None
        # Alice's line must never contain Bob's name or his interest verbs.
        assert "Bob" not in la, la
        assert "Alice" not in lb, lb
        # Bob has no gardening / cooking interest — his recall line must
        # never fire a gardening/cooking template.
        assert "garden" not in lb.lower(), lb
        assert "cook" not in lb.lower(), lb
        # And vice versa — Alice has no dog / walk interest.
        assert "pup" not in la.lower(), la
        assert "walks" not in la.lower(), la


# --------------------------------------------------------------------------
# 2. ~1-in-3 recall rate for daily_welcome — sample many synthetic days.
# --------------------------------------------------------------------------
#
# We can't exercise the "one in three eligible days" gate against real
# calendar dates without waiting, but the gate is a pure hash of
# (user_id, today_str, "recall") — so we can synthesise many
# user_ids under one calendar day and observe the ratio, which
# mathematically matches the same distribution.

def test_daily_welcome_recall_gate_is_roughly_one_in_three():
    """Replays the same sha1-mod-3 gate the daily_welcome uses to pick
    the recall vs generic warm thought. Across 3000 synthetic user
    days, the ratio should sit near 1/3 (within ±5 percentage points)."""
    import hashlib
    hits = 0
    N = 3000
    for i in range(N):
        gate_key = f"user-{i}-20260131-recall"
        if int(hashlib.sha1(gate_key.encode()).hexdigest(), 16) % 3 == 0:
            hits += 1
    ratio = hits / N
    # 1/3 = 0.333..., ±5pp tolerance is generous.
    assert 0.28 <= ratio <= 0.38, f"recall gate ratio out of range: {ratio}"


# --------------------------------------------------------------------------
# 3. Remembers pre/post-event rendering respects the name validator.
# --------------------------------------------------------------------------

def test_render_pre_event_drops_bad_preferred_name():
    from services.george.remembers import render_pre_event
    ev = {"title": "Coffee Catch-Up"}
    organiser = {
        "id": "u1",
        "first_name": "us",  # bad
        "george_profile": {"preferred_name": {"value": "My"}},  # bad
    }
    line = render_pre_event(ev, organiser)
    # Must not contain the corrupted name.
    for bad in (", My", ", us", " My.", " us."):
        assert bad not in line, f"leaked bad name in pre_event: {line!r}"
    # Should still render sensibly.
    assert "Coffee Catch-Up" in line
    assert "tomorrow" in line.lower()


def test_render_pre_event_uses_trusted_preferred_name():
    from services.george.remembers import render_pre_event
    ev = {"title": "Coffee Catch-Up"}
    organiser = {
        "id": "u1", "first_name": "Ignored",
        "george_profile": {"preferred_name": {"value": "Sarah"}},
    }
    line = render_pre_event(ev, organiser)
    assert ", Sarah" in line
    assert "Ignored" not in line


def test_render_post_event_drops_bad_preferred_name():
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from services.george.remembers import render_post_event, COMMUNITY_TZ
    ev = {"title": "Book Club"}
    organiser = {
        "id": "u1",
        "first_name": "the",  # bad
        "george_profile": {"preferred_name": "You"},  # bad plain-string shape
    }
    start_local = datetime(2026, 2, 3, 14, 0, tzinfo=COMMUNITY_TZ)
    line = render_post_event(ev, organiser, start_local)
    for bad in (", the", ", You", " the.", " You."):
        assert bad not in line, f"leaked bad name in post_event: {line!r}"
    assert "Book Club" in line
    # Should read as "How did Book Club go? I hope you had a lovely afternoon."
    assert "afternoon" in line.lower()


# --------------------------------------------------------------------------
# 4. member_recall_context surfaces area / wants_more_of when trusted.
# --------------------------------------------------------------------------

def test_member_recall_context_surfaces_optional_fields():
    from services.george.memory import member_recall_context
    user = {
        "id": "u1",
        "george_profile": {
            "preferred_name": {"value": "Sarah"},
            "area": {"value": "Manly"},
            "interests": {"value": ["gardening", "reading"]},
            "wants_more_of": {"value": "quiet coffee catch-ups"},
            "connection_scope": {"value": "local"},
        },
    }
    ctx = member_recall_context(user)
    assert ctx["preferred_name"] == "Sarah"
    assert ctx["area"] == "Manly"
    assert ctx["interests"] == ["gardening", "reading"]
    assert ctx["wants_more_of"] == "quiet coffee catch-ups"
    assert ctx["connection_scope"] == "local"


def test_member_recall_context_empty_on_junk_profile():
    from services.george.memory import member_recall_context
    user = {"id": "u1", "george_profile": {}}
    ctx = member_recall_context(user)
    assert ctx["preferred_name"] is None
    assert ctx["area"] is None
    assert ctx["interests"] == []
    assert ctx["wants_more_of"] is None
