"""Iter161c — Founding Members "Awaiting Contact" → "Awaiting Invitation".

Tests the semantic distinction:
  - Members with status="registered" HAVE received the auto-registration
    acknowledgement email. They're awaiting the *personal* invitation.
  - George must never tell Garry these people "haven't been emailed".

We verify the *data layer* carries this semantic (so George reads it
from tool_results, not from prompt wording alone).
"""

from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_founding_members_summary_carries_semantic_note(monkeypatch):
    """founding_members_summary must return a `_semantics` block that
    disambiguates awaiting_contact from 'never emailed', plus an
    `awaiting_invitation` field mirroring the legacy `awaiting_contact`
    count for API back-compat."""
    from services.george import tools as tools_mod

    class _FakeColl:
        async def count_documents(self, q):
            # 7 members "awaiting" (registered), 3 invited, 2 joined, 0 opted, and 12 total.
            statuses = q.get("status")
            if statuses == "invited":   return 3
            if statuses == "joined":    return 2
            if statuses == "opted_out": return 0
            # awaiting: has $or with registered/new
            if "$or" in q:              return 7
            # `since_days` filter for new_today: created_at gte
            if "created_at" in q:       return 1
            return 12  # total base

        async def find_one(self, *a, **kw):
            return {
                "first_name":    "Jane",
                "email":         "jane@example.com",
                "state_country": "NSW",
                "created_at":    "2026-02-25T09:00:00Z",
            }

    class _FakeDB:
        interest_registrations = _FakeColl()

    fn = tools_mod.TOOL_REGISTRY["founding_members_summary"]["run"]
    result = await fn(_FakeDB(), {})

    # Back-compat: field name preserved.
    assert result["awaiting_contact"] == 7
    # New first-class semantic field.
    assert result["awaiting_invitation"] == 7
    # Numeric fields all present.
    for k in ("total", "new_today", "invited", "joined", "opted_out"):
        assert k in result

    # Semantic note is present and captures the disambiguation.
    sem = result.get("_semantics")
    assert isinstance(sem, dict)
    assert sem.get("auto_registration_email_sent") is True
    assert sem.get("personal_invitation_sent") is False
    assert sem.get("preferred_label") == "awaiting invitation"
    meaning = sem.get("awaiting_contact_meaning", "")
    assert "registration" in meaning.lower()
    assert "invitation" in meaning.lower()
    # The meaning should explicitly instruct George NOT to say the
    # members haven't been emailed (that's exactly the confusion the
    # semantic block exists to prevent).
    assert "do not say" in meaning.lower() or "do not tell" in meaning.lower()


def test_tool_description_flags_semantic_meaning():
    """Even before the LLM sees tool_results, the tool's description
    (registered on _REGISTRY) must warn George about the semantic
    distinction so he doesn't say 'no email sent' when reasoning."""
    from services.george import tools as tools_mod

    entry = tools_mod.TOOL_REGISTRY["founding_members_summary"]
    desc = entry["description"].lower()
    assert "awaiting invitation" in desc
    assert "registration email" in desc
    # Direct instruction to George.
    assert "never say they have not been emailed" in desc


def test_prompt_answer_style_encodes_awaiting_invitation_rule():
    """ANSWER_STYLE must carry the awaiting-invitation semantics as a
    grounded-honesty rule so George treats `_semantics` block from
    tool_results as authoritative."""
    from services.george.prompt import ANSWER_STYLE

    body = ANSWER_STYLE.lower()
    assert "awaiting invitation" in body
    assert "auto-registration" in body or "automatic registration" in body
    assert "personal" in body and "invitation" in body


def test_chat_topic_routes_awaiting_invitation_to_count_tool():
    """Chat's fast-path topic detector must route 'awaiting invitation'
    to the same count_interest_registrations tool as 'awaiting contact'."""
    from services.george.chat import _TOPIC_TO_TOOL

    lookup = {phrase: tool for phrase, tool in _TOPIC_TO_TOOL}
    assert "awaiting invitation" in lookup
    tool = lookup["awaiting invitation"]
    assert tool["name"] == "count_interest_registrations"
    assert tool["args"].get("status") == "registered"


def test_chat_replan_regex_matches_awaiting_invitation():
    """The safety-net replan regex must trigger on 'awaiting invitation'."""
    from services.george.chat import _STATE_QUESTION_RE

    assert _STATE_QUESTION_RE.search("How many are awaiting invitation right now?")
    assert _STATE_QUESTION_RE.search("Are there any founders who haven't been invited?")
    # Legacy phrasing still works.
    assert _STATE_QUESTION_RE.search("how many are awaiting contact")
