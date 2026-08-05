"""Iteration 144 — Welcome Back rendering is unified into one component.

Garry, 8 Aug 2026 — TestFlight regression: Eileen (first meeting)
saw the full Welcome Back card with [Chat to George] + [Dismiss]
buttons, but Frank (returning member) saw only a plain speech
bubble with no actions. The two variants lived in the same file
(`GeorgeButterfly.tsx`) as forked JSX branches.

The fix (iter144) consolidates them into a single reusable
component `GeorgeWelcomeBubble.tsx`. Both first-meeting and
returning-member paths now render the SAME UI — greeting + [Chat
to George] + [Dismiss]. The parent decides what those actions
mean in context (first-meeting `onDismiss` retires the intro
flag server-side; returning-member `onDismiss` is a client-only
fade).

Rendering paths BEFORE:
  1. GeorgeButterfly.tsx first-meeting branch (full card)
  2. GeorgeButterfly.tsx returning-member branch (plain bubble)

Rendering paths AFTER:
  1. GeorgeWelcomeBubble.tsx (used for every case)

This test pins the invariant so a future well-meaning refactor
can't re-introduce a forked branch.
"""
from __future__ import annotations

import re


_BUTTERFLY_PATH = "/app/frontend/src/components/george/GeorgeButterfly.tsx"
_BUBBLE_PATH = "/app/frontend/src/components/george/GeorgeWelcomeBubble.tsx"


def test_extracted_bubble_component_exists() -> None:
    """`GeorgeWelcomeBubble` must be a standalone component so it can
    be the single source of truth."""
    with open(_BUBBLE_PATH, "r", encoding="utf-8") as fh:
        src = fh.read()
    assert "export function GeorgeWelcomeBubble" in src, (
        "GeorgeWelcomeBubble.tsx must export the component as a named "
        "function. See iter144 fix — this is the single source of "
        "truth for the Welcome Back UI."
    )
    # Both buttons must be present with the app-wide testIDs so the
    # component can be tested and located by automation.
    assert 'testID="george-welcome-chat"' in src
    assert 'testID="george-welcome-dismiss"' in src


def test_butterfly_imports_extracted_bubble() -> None:
    """`GeorgeButterfly.tsx` must consume the extracted component."""
    with open(_BUTTERFLY_PATH, "r", encoding="utf-8") as fh:
        src = fh.read()
    assert re.search(
        r"import\s*\{\s*GeorgeWelcomeBubble\s*\}\s*from\s*['\"]\./GeorgeWelcomeBubble['\"]",
        src,
    ), (
        "GeorgeButterfly.tsx must import GeorgeWelcomeBubble from the "
        "extracted component. Without the import the file has forked "
        "back into its own inline JSX — the iter144 regression."
    )
    assert "<GeorgeWelcomeBubble" in src, (
        "GeorgeButterfly.tsx must render <GeorgeWelcomeBubble> — the "
        "consolidated Welcome Back UI. If this fails a well-meaning "
        "refactor has probably re-inlined the JSX."
    )


def test_butterfly_no_longer_forks_on_first_meeting_for_the_bubble() -> None:
    """The old ternary that produced two different Welcome Back cards
    (`isFirstMeetingRef.current ? full-card : plain-bubble`) must no
    longer wrap the bubble render. It's fine for `isFirstMeetingRef`
    to still gate other behaviour (server-side intro flag retirement,
    session gating) — the invariant here is specifically about the
    Welcome Back UI itself.
    """
    with open(_BUTTERFLY_PATH, "r", encoding="utf-8") as fh:
        src = fh.read()
    # The specific old JSX marker — "returning-user bubble" comment —
    # must be gone.
    assert "Returning-user bubble" not in src, (
        "The 'Returning-user bubble' comment marker is still present, "
        "which suggests the plain-bubble variant has been reintroduced. "
        "See iter144 fix — use <GeorgeWelcomeBubble/> for every case."
    )
    # And the numberOfLines={4} plain bubble path is gone.
    assert "numberOfLines={4}" not in src, (
        "The `numberOfLines={4}` heuristic used only by the plain "
        "returning-member bubble is present — that variant should no "
        "longer exist. See iter144 fix."
    )


def test_butterfly_uses_shared_bubble_for_both_meeting_states() -> None:
    """The renders-a-bubble block must NOT contain an isFirstMeetingRef
    ternary that switches between two different JSX subtrees. It may
    reference `isFirstMeetingRef.current` in the shared component's
    onDismiss handler (to retire the intro flag) — that's fine and
    intentional.
    """
    with open(_BUTTERFLY_PATH, "r", encoding="utf-8") as fh:
        src = fh.read()
    # Find the showBubble render block and inspect it.
    start = src.find("{showBubble && greeting && (")
    assert start >= 0, (
        "Could not locate the `{showBubble && greeting && (…)}` "
        "render block in GeorgeButterfly.tsx. The file may have been "
        "restructured — please update this test to match."
    )
    # Window: the render block should be quite short now (single
    # GeorgeWelcomeBubble). We look at the next 2500 chars.
    block = src[start:start + 2500]
    # It must reference the shared component.
    assert "<GeorgeWelcomeBubble" in block, (
        "The Welcome Back render block does not render <GeorgeWelcomeBubble/>. "
        "See iter144 fix — this block must delegate to the shared component."
    )
    # It must NOT contain both branches of the old ternary.
    # (The old code had `isFirstMeetingRef.current ? (...) : (...)`.)
    forbidden = re.compile(
        r"isFirstMeetingRef\.current\s*\?\s*\(?[\s\n]*//\s*First-meeting",
    )
    assert not forbidden.search(block), (
        "The Welcome Back render block still contains the old "
        "isFirstMeetingRef ternary that forked into two different "
        "JSX subtrees. See iter144 fix — every member should see the "
        "same Welcome Back UI."
    )
