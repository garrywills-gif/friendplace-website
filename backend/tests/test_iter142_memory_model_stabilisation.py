"""Iteration 142 — George memory-model regressions (A1 launch stabilisation).

Garry, 8 Aug 2026 — TestFlight round-2 findings:
- Completed members were being re-routed into onboarding whenever a
  stale `onboarding_sessions` doc lingered (bug: has_active_onboarding
  returning true for a user with profile_complete already true).
- Completed members' butterfly-taps auto-resumed a paused event
  draft, producing "we were planning a get-together" — the phrase
  Garry read as "George inventing conversations".

The A1 fix (this iteration) is a minimum-risk stabilisation:
- `active_onboarding_session` returns None if `users.profile_complete`
  is true, and opportunistically cancels the stale session so it
  doesn't linger.
- The mobile butterfly no longer treats `has_active_onboarding` as a
  reason to re-open onboarding, and no longer silently resumes
  paused event drafts.
- Onboarding + event composer prompts now include a hard rule against
  inventing conversation history.

Full architectural realignment ("one George" restoration) is tracked
in /app/memory/unified-george-engine-post-launch.md for post-launch.
"""
from __future__ import annotations

import asyncio
import os
import re
import uuid
from datetime import datetime, timezone

import pytest
from motor.motor_asyncio import AsyncIOMotorClient


# ---------------------------------------------------------------------------
# Prompt-level static checks — cheap, deterministic, no DB required.
# ---------------------------------------------------------------------------

_ONBOARDING_PROMPT = "/app/backend/services/george/onboarding/service.py"
_EVENT_PROMPT = "/app/backend/services/george/event_creation/service.py"


def test_onboarding_prompt_forbids_inventing_history() -> None:
    """The onboarding COMPOSER_SYSTEM must include the hard rule about
    never referencing past conversations that don't appear verbatim in
    the visible turns.
    """
    with open(_ONBOARDING_PROMPT, "r", encoding="utf-8") as fh:
        src = fh.read()
    assert "NEVER INVENT CONVERSATION HISTORY" in src, (
        "onboarding/service.py::COMPOSER_SYSTEM is missing the "
        "'NEVER INVENT CONVERSATION HISTORY' rule. See iteration 142 "
        "TestFlight fix — this rule is what prevents George from "
        "referencing conversations that never happened."
    )
    # Belt-and-braces: the specific banned phrasing that Garry called
    # out must be listed as an example of what's banned.
    assert "planning a get-together" in src.lower() or "get-together" in src, (
        "The onboarding prompt should include the specific 'get-"
        "together' phrasing Garry flagged, so the model has a "
        "concrete example of the pattern to avoid."
    )


def test_event_creation_prompt_has_principle_19() -> None:
    """The event-creation COMPOSER_SYSTEM must include Principle #19
    (never invent conversation history), which is the primary rule
    against the 'we were planning a get-together' regression.
    """
    with open(_EVENT_PROMPT, "r", encoding="utf-8") as fh:
        src = fh.read()
    assert "PRINCIPLE #19" in src, (
        "event_creation/service.py::COMPOSER_SYSTEM is missing "
        "PRINCIPLE #19 — the hard rule against inventing conversation "
        "history. See iteration 142 TestFlight fix."
    )
    assert "NEVER INVENT CONVERSATION HISTORY" in src


# ---------------------------------------------------------------------------
# Live-DB check — stale onboarding sessions must not resurface for
# completed members.
# ---------------------------------------------------------------------------

def test_active_onboarding_session_null_for_completed_member() -> None:
    """`active_onboarding_session` must return None when the actor has
    already completed their profile — regardless of whether a stale
    `in_progress` session doc still exists. This is the invariant that
    keeps the mobile butterfly from re-routing completed members back
    into the onboarding chat.
    """
    mongo_url = os.environ.get("MONGO_URL")
    if not mongo_url:
        pytest.skip("MONGO_URL not set — cannot run live invariant check")

    async def _run() -> tuple[object | None, dict | None]:
        client = AsyncIOMotorClient(mongo_url)
        try:
            db = client["test_database"]
            from services.george.onboarding.service import (
                active_onboarding_session,
                COLL_ONBOARDING,
            )

            # Seed: a user with profile_complete=True who ALSO has a
            # stale in_progress onboarding session hanging around.
            actor_id = f"test-actor-{uuid.uuid4().hex[:8]}"
            session_id = f"test-session-{uuid.uuid4().hex[:8]}"
            now = datetime.now(timezone.utc).isoformat()
            await db.users.insert_one({
                "id": actor_id,
                "email": f"{actor_id}@example.com",
                "profile_complete": True,
                "onboarding_completed": True,
                "created_at": now,
            })
            await db[COLL_ONBOARDING].insert_one({
                "id": session_id,
                "session_id": session_id,
                "actor_id": actor_id,
                "status": "in_progress",
                "turns": [],
                "known": {},
                "skipped": [],
                "created_at": now,
                "updated_at": now,
            })
            try:
                result = await active_onboarding_session(db, actor_id=actor_id)
                # Immediately re-fetch the session doc to confirm the
                # opportunistic cleanup fired.
                cleaned = await db[COLL_ONBOARDING].find_one(
                    {"session_id": session_id}, {"_id": 0, "status": 1, "cancel_reason": 1}
                )
                return result, cleaned
            finally:
                # Test-scope cleanup so we don't pollute the DB.
                await db.users.delete_one({"id": actor_id})
                await db[COLL_ONBOARDING].delete_one({"session_id": session_id})
        finally:
            client.close()

    result, cleaned = asyncio.run(_run())
    assert result is None, (
        f"active_onboarding_session returned {result!r} for a member "
        "whose profile_complete flag is True. Completed members must "
        "never be re-routed into onboarding. See iteration 142 fix in "
        "services/george/onboarding/service.py."
    )
    assert cleaned is not None, "session doc should still exist for the assertion"
    assert cleaned.get("status") == "cancelled", (
        "The stale session should have been opportunistically cancelled "
        f"but its status is {cleaned.get('status')!r}."
    )
    assert cleaned.get("cancel_reason") == "stale_after_profile_complete", (
        "The cancel_reason should specifically call out the stale-after-"
        "profile-complete cleanup path for future forensics."
    )


def test_butterfly_router_no_longer_auto_resumes_events() -> None:
    """The mobile butterfly's `flutterAndOpenChat` handler must no
    longer silently resume `paused_event_session`. Otherwise a week-
    old draft resurfaces as "we were planning a get-together" — the
    exact regression Garry called out.
    """
    path = "/app/frontend/src/components/george/GeorgeButterfly.tsx"
    with open(path, "r", encoding="utf-8") as fh:
        src = fh.read()
    # Positive check — the file must reference the iter142 fix so a
    # future refactor can't remove the guard without noticing.
    assert "iter142" in src.lower() or "8 Aug 2026" in src, (
        "GeorgeButterfly.tsx should reference the iter142 fix in a "
        "comment so future refactors don't accidentally re-introduce "
        "the auto-resume behaviour."
    )
    # Negative check — the exact old wiring pattern must be gone.
    # Old code assigned `paused.session_id` to `resumeSessionId`.
    assert not re.search(
        r"setResumeSessionId\(\s*paused\s*\?\s*paused\.session_id",
        src,
    ), (
        "The old paused_event_session auto-resume wiring is still "
        "present in GeorgeButterfly.tsx — this is the regression that "
        "produces 'we were planning a get-together'. See iter142 fix."
    )
    # Positive check — the router must now use `!fresh.onboarding_complete`
    # ALONE (no OR with has_active_onboarding).
    assert re.search(
        r"needsOnboarding\s*=\s*fresh\.actor_type\s*===\s*['\"]member['\"]\s*&&\s*!fresh\.onboarding_complete\s*;",
        src,
    ), (
        "GeorgeButterfly.tsx should compute `needsOnboarding` from "
        "`onboarding_complete` ALONE. Including has_active_onboarding "
        "here is what re-routed completed members back into onboarding."
    )
