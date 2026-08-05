"""Iteration 143 — Welcome Back bubble is persistent, not a toast.

Garry, 8 Aug 2026 — TestFlight regression: *"The Welcome Back message
is now behaving like a temporary toast that disappears before the
member can read it… that Welcome Back card is George's front door.
Every single time a member returns, that's their first impression.
If it flashes up and disappears, it feels like a notification. If
it waits for them, it feels like George is genuinely there to
welcome them back."*

The bubble in `GeorgeButterfly.tsx` used to auto-fade after 3.2 seconds
for returning members (first-meeting was already persistent). That
regressed Welcome Back to feel like a toast. Fixed by removing the
auto-fade entirely so every bubble waits for an explicit action:
  • [Chat to George] — tap the butterfly or the CTA
  • [Dismiss / Not now] — tap the ✕, tap-away, or the CTA

This test pins the invariant statically so a future well-meaning
refactor can't re-introduce `BUBBLE_LIFETIME_MS` or a similar
auto-dismiss timer on the greeting bubble.
"""
from __future__ import annotations

import re


_BUTTERFLY_PATH = "/app/frontend/src/components/george/GeorgeButterfly.tsx"


def test_no_bubble_lifetime_constant() -> None:
    """The `BUBBLE_LIFETIME_MS` constant that used to schedule the
    auto-dismiss timer must not exist anywhere in this file. If a
    future refactor needs a numeric lifetime for a genuinely
    transient toast, it belongs on a separate component — not the
    greeting bubble.
    """
    with open(_BUTTERFLY_PATH, "r", encoding="utf-8") as fh:
        src = fh.read()
    assert "BUBBLE_LIFETIME_MS" not in src, (
        "BUBBLE_LIFETIME_MS is present in GeorgeButterfly.tsx — this "
        "constant used to drive the auto-fade that made Welcome Back "
        "feel like a toast. See iter143 fix — the bubble is George's "
        "front door and must wait for an explicit action."
    )


def test_bubble_effect_has_no_settimeout_scheduling_dismiss() -> None:
    """The bubble bloom `useEffect` in GeorgeButterfly.tsx must not
    schedule a `setTimeout` that flips `showBubble` to false. The
    only places that hide the bubble should be explicit user actions
    (tap butterfly, tap ✕, tap-away, tap [Chat to George] / [Dismiss]).
    """
    with open(_BUTTERFLY_PATH, "r", encoding="utf-8") as fh:
        src = fh.read()

    # Isolate the bubble-bloom effect by its stable comment marker.
    marker = "Bubble bloom (persistent"
    assert marker in src, (
        "GeorgeButterfly.tsx should carry the 'Bubble bloom (persistent"
        " — no auto-fade)' comment marker so this invariant test can "
        "target the correct block. See iter143 fix."
    )
    start = src.index(marker)
    # The effect body ends at the next `useEffect` / top-level marker.
    # Slice a generous window and search for banned patterns.
    window = src[start:start + 2000]
    # The bubble bloom effect must not queue a setTimeout that fades /
    # hides the bubble. Any surviving `setTimeout(...)` calls in this
    # window would be an unintended auto-dismiss.
    forbidden = re.compile(r"setTimeout\s*\(\s*[^,]*,\s*(BUBBLE_LIFETIME_MS|\d{3,4})")
    matches = forbidden.findall(window)
    # Filter: we allow zero delays used for setState batching, but
    # anything ≥100ms in the bubble bloom effect looks like an
    # auto-dismiss timer.
    assert not matches, (
        "The bubble bloom effect appears to schedule an auto-dismiss "
        f"timer (matched delays: {matches!r}). See iter143 fix — the "
        "greeting bubble must wait for an explicit user action, never "
        "auto-fade."
    )


def test_iter143_comment_present() -> None:
    """A comment referencing iter143 must be present so future
    readers understand why the auto-fade was removed. Prevents a
    'why did we take this out?' rollback."""
    with open(_BUTTERFLY_PATH, "r", encoding="utf-8") as fh:
        src = fh.read()
    assert "iter143" in src.lower() or "8 Aug 2026" in src, (
        "GeorgeButterfly.tsx should reference iter143 in a comment "
        "so future refactors know why the auto-fade was removed."
    )
