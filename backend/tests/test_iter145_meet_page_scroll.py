"""Iteration 145 — Marketing website hero must not restart Georgia on scroll.

Garry, 8 Aug 2026 — launch blocker on iPhone Safari:
  • Attempting to scroll `/meet` caused Georgia's introduction to
    restart from `phase='noticing'` / `textStage=0`.
  • The hero was taller than the viewport and the George/Georgia
    ChoiceCards fell below the fold on iPhone widths.

Root cause: the `resize` listener at `app/meet/page.tsx` re-ran
`measure()` on every viewport-size change. iOS Safari fires a
`resize` event when it collapses/expands the URL bar during
scrolling — even though only the *height* changes. That reset
`origin`/`geom`, which retriggered the choreography timeline.

Additionally, `pageBg.overflow: 'hidden'` was clipping vertical
scroll on some iOS versions.

This test pins the fix so a well-meaning refactor can't re-
introduce the regression.
"""
from __future__ import annotations

import re


_MEET_PAGE_PATH = "/app/website/app/meet/page.tsx"
_GLOBALS_CSS_PATH = "/app/website/app/globals.css"


def test_meet_resize_handler_ignores_height_only_changes() -> None:
    """The resize handler must compare `window.innerWidth` before
    calling measure(). Otherwise Safari's URL-bar collapse restarts
    the choreography (Garry, iter145 launch blocker).
    """
    with open(_MEET_PAGE_PATH, "r", encoding="utf-8") as fh:
        src = fh.read()

    # The width-only guard must be present.
    assert re.search(r"lastWidth\s*=\s*window\.innerWidth", src), (
        "The `resize` handler in app/meet/page.tsx must remember the "
        "previous width and skip when width hasn't changed. Without "
        "this, iOS Safari's URL-bar animations restart Georgia's "
        "choreography every time the visitor scrolls. See iter145 fix."
    )
    assert re.search(r"if\s*\(\s*w\s*===\s*lastWidth\s*\)\s*return", src), (
        "The width-equality guard is missing — height-only resize "
        "events must be skipped. See iter145 fix."
    )


def test_meet_resize_handler_freezes_mid_choreography() -> None:
    """Once the butterfly is in flight or has landed, the measure
    handler must NOT restart the choreography even if a genuine
    width change occurs. Restarting mid-arrival is jarring."""
    with open(_MEET_PAGE_PATH, "r", encoding="utf-8") as fh:
        src = fh.read()
    assert "FROZEN_PHASES" in src, (
        "app/meet/page.tsx should define a FROZEN_PHASES set of "
        "phases at or after which resize handlers skip re-measuring. "
        "See iter145 fix."
    )
    # All the phases that come after the flight commits must be
    # frozen. If a future author adds a new post-flight phase they'll
    # need to add it to the set.
    for phase_name in ("flying", "landed", "greeting", "complete"):
        assert phase_name in src, (
            f"Expected phase '{phase_name}' to be referenced in the "
            "FROZEN_PHASES list of app/meet/page.tsx."
        )


def test_meet_pagebg_allows_vertical_scroll() -> None:
    """The `pageBg` style must NOT set `overflow: 'hidden'` — that
    was trapping vertical pan on iPhone Safari. It should use
    `overflowX: 'hidden'` only, and explicitly opt into vertical
    panning via `touchAction: 'pan-y'`.
    """
    with open(_MEET_PAGE_PATH, "r", encoding="utf-8") as fh:
        src = fh.read()

    # Locate the pageBg block and inspect its content.
    m = re.search(r"const pageBg:\s*React\.CSSProperties\s*=\s*\{(.+?)\};", src, re.S)
    assert m, "Could not locate `pageBg` style block in app/meet/page.tsx."
    block = m.group(1)

    # Strip comment lines from the block so we only inspect actual
    # CSS properties (the historical comment mentions the old
    # `overflow: 'hidden'` value explicitly and would confuse us).
    code_lines = [
        line for line in block.splitlines()
        if not line.strip().startswith("//")
    ]
    code_block = "\n".join(code_lines)

    assert "overflow: 'hidden'" not in code_block, (
        "`pageBg` still sets `overflow: 'hidden'` — that traps "
        "vertical scroll on iPhone Safari and was the launch blocker "
        "Garry flagged in iter145. Use `overflowX: 'hidden'` instead."
    )
    assert "overflowX: 'hidden'" in code_block, (
        "`pageBg` should set `overflowX: 'hidden'` (horizontal only) "
        "so the ambient glow doesn't create horizontal scroll while "
        "vertical scroll remains free. See iter145 fix."
    )
    assert "touchAction: 'pan-y'" in code_block, (
        "`pageBg` should set `touchAction: 'pan-y'` to explicitly "
        "permit vertical panning on iOS — belt-and-braces against "
        "the browser guessing wrong. See iter145 fix."
    )


def test_meet_page_media_query_restores_desktop_padding() -> None:
    """Mobile padding on the `.meet-choice-outer` / `.meet-choice-plate`
    is tightened so ChoiceCards stay above the fold. The desktop
    padding must be restored via a `min-width: 720px` media query
    in globals.css so the ≥tablet experience is unchanged.
    """
    with open(_GLOBALS_CSS_PATH, "r", encoding="utf-8") as fh:
        css = fh.read()

    assert re.search(r"@media\s*\(\s*min-width:\s*720px\s*\)\s*\{[^}]*\.meet-choice-outer", css, re.S), (
        "globals.css must contain a `@media (min-width: 720px)` "
        "block that restores `.meet-choice-outer` padding to the "
        "desktop-friendly 72/24/24 values. See iter145 fix."
    )
    assert re.search(r"\.meet-choice-plate\s*\{\s*padding:\s*56px\s+40px\s+48px", css), (
        "globals.css should restore `.meet-choice-plate` padding to "
        "56px 40px 48px on ≥720px viewports. See iter145 fix."
    )
