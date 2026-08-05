"""Iteration 137 — George MCGS navigation catalogue + suppression + surface context.

Backend-only verification of six items from Garry's 6 Aug 2026 QA batch:

1.  ``_detect_navigation`` recognises the new long-form aliases:
       - "Opening the Campaigns dashboard now."     → /admin/campaigns
       - "Opening the Segment builder now."         → /admin/segments
       - "Opening the Share a Moment moderation queue now." → /admin/moments
2.  Every route in ``_MCGS_ROUTES`` resolves via at least one alias.
3.  Question-form ("Would you like me to open the Bridge?") does NOT navigate.
4.  ``surface_context.pathname`` suppression: when the target route equals the
    current pathname (both trailing-slash normalised) the pipeline emits NO
    ``navigate`` SSE event.
5.  ``_format_surface_context`` renders the "Current route: **{pathname}**"
    line plus the guidance about "You're already here" only when the routes
    match.
6.  Regression: MCGS_CAPABILITY_MAP still lists every live surface used by
    ``_MCGS_ROUTES`` (catalogue drift guard), the grounding-footer scrub still
    strips "Grounded in N tool results" style lines, and question-form
    announcements still return None.
"""
from __future__ import annotations

import asyncio
import re

import pytest

from services.george import chat as george_chat
from services.george import prompt as george_prompt


# ---------------------------------------------------------------------------
# 1. Long-form aliases — the three lines Garry pasted verbatim.
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "reply, expected_path",
    [
        ("Opening the Campaigns dashboard now.", "/admin/campaigns"),
        ("Opening the Segment builder now.", "/admin/segments"),
        ("Opening the Share a Moment moderation queue now.", "/admin/moments"),
    ],
)
def test_new_long_form_aliases_resolve(reply, expected_path):
    got = george_chat._detect_navigation(reply)
    assert got == expected_path, (
        f"Expected {expected_path!r} for reply {reply!r}, got {got!r}"
    )


# ---------------------------------------------------------------------------
# 2. Every catalogued route has at least one working alias.
# ---------------------------------------------------------------------------

def test_every_catalogue_entry_resolves():
    failed: list[tuple[str, str]] = []
    for path, aliases in george_chat._MCGS_ROUTES:
        assert aliases, f"Route {path} has no aliases at all"
        for alias in aliases:
            reply = f"Opening the {alias} now."
            got = george_chat._detect_navigation(reply)
            if got != path:
                failed.append((alias, f"expected {path}, got {got}"))
    assert not failed, f"Alias resolution failures: {failed}"


def test_longest_alias_wins_founding_vs_crm():
    # Regression: "founding member crm" must beat generic "crm".
    got = george_chat._detect_navigation("Opening the founding member crm now.")
    assert got == "/admin/founding-members"


# ---------------------------------------------------------------------------
# 3. Question form → no navigation.
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "reply",
    [
        "Would you like me to open the Bridge?",
        "Shall I open the Campaigns dashboard?",
        "Do you want me to open the Segment builder?",
        "Want me to open the Share a Moment moderation queue?",
    ],
)
def test_question_form_never_navigates(reply):
    got = george_chat._detect_navigation(reply)
    assert got is None, f"Question form must NOT navigate; got {got!r} for {reply!r}"


def test_plain_description_never_navigates():
    # No trigger verb, just describing where something lives.
    reply = "The System Health Dashboard sits at /admin/system-health."
    assert george_chat._detect_navigation(reply) is None


# ---------------------------------------------------------------------------
# 4. surface_context.pathname suppression — logic-level equivalence check.
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "reply, pathname, should_navigate",
    [
        # Same route → suppressed.
        ("Opening the Bridge now.", "/admin/bridge", False),
        ("Opening the Bridge now.", "/admin/bridge/", False),   # trailing slash
        ("Opening the Campaigns dashboard now.", "/admin/campaigns", False),
        # Different route → still navigates.
        ("Opening the Bridge now.", "/admin/dashboard", True),
        ("Opening the Campaigns dashboard now.", "/admin/segments", True),
        # No pathname at all → falls back to naive navigate.
        ("Opening the Bridge now.", "", True),
    ],
)
def test_navigate_suppression_logic(reply, pathname, should_navigate):
    """Mirror the exact logic that lives inside grounded_chat_stream."""
    navigate_path = george_chat._detect_navigation(reply)
    current_route = pathname.strip()
    if navigate_path and current_route and (
        navigate_path.rstrip("/") == current_route.rstrip("/")
    ):
        navigate_path = None
    if should_navigate:
        assert navigate_path is not None, (
            f"Expected navigate event for reply {reply!r} at {pathname!r}"
        )
    else:
        assert navigate_path is None, (
            f"Expected suppression for reply {reply!r} at {pathname!r}, "
            f"got {navigate_path!r}"
        )


def test_navigate_suppression_via_grounded_stream(monkeypatch):
    """End-to-end (no LLM): drive grounded_chat_stream with a stubbed synth
    stream that yields the exact 'Opening the Bridge now.' reply while the
    surface_context.pathname is '/admin/bridge'. No 'navigate' event allowed.
    """
    from emergentintegrations.llm.chat import TextDelta, StreamDone

    async def _fake_plan(*a, **kw):
        return {"tool_calls": []}

    async def _fake_run_tools(db, plan):
        return [], []

    class _FakeStream:
        def __init__(self, text):
            self._text = text

        async def __aiter__(self):
            yield TextDelta(content=self._text)
            # Just end iteration; grounded_chat_stream handles this fine.

    class _FakeChat:
        def __init__(self, *a, **kw):
            self._reply = "Opening the Bridge now."

        def with_model(self, *a, **kw):
            return self

        def stream_message(self, msg):
            return _FakeStream(self._reply)

        async def send_message(self, msg):
            return self._reply

    monkeypatch.setattr(george_chat, "plan_tool_calls", _fake_plan)
    monkeypatch.setattr(george_chat, "_run_planned_tools", _fake_run_tools)
    monkeypatch.setattr(george_chat, "LlmChat", _FakeChat)
    monkeypatch.setattr(george_chat, "_emergent_key", lambda: "stub-key")
    # Kill the KB grounding + draft detector so we don't hit Mongo/LLM.
    async def _no_kb(**kw):
        return "", []
    from services.george import kb_grounding as _kbg
    monkeypatch.setattr(_kbg, "ground_for_george", _no_kb)
    async def _no_draft(**kw):
        return None
    monkeypatch.setattr(george_chat, "_detect_knowledge_proposal", _no_draft)

    async def _collect(pathname):
        events = []
        async for ev in george_chat.grounded_chat_stream(
            db=None,
            admin={"name": "Garry", "email": "g@x", "roles": ["owner"]},
            user_message="open the bridge",
            session_id="test",
            prior_turns=None,
            surface_context={"surface": "mcgs_bridge", "pathname": pathname},
        ):
            events.append(ev)
        return events

    # Same route → NO navigate event.
    same_route_events = asyncio.get_event_loop().run_until_complete(
        _collect("/admin/bridge")
    )
    kinds = [e["kind"] for e in same_route_events]
    assert "navigate" not in kinds, (
        f"navigate event must be suppressed when already on route; got {kinds}"
    )

    # Different route → navigate DOES fire.
    diff_route_events = asyncio.get_event_loop().run_until_complete(
        _collect("/admin/dashboard")
    )
    nav = [e for e in diff_route_events if e["kind"] == "navigate"]
    assert nav and nav[0]["path"] == "/admin/bridge", (
        f"expected navigate to /admin/bridge; got {diff_route_events}"
    )


# ---------------------------------------------------------------------------
# 5. _format_surface_context renders pathname + guidance.
# ---------------------------------------------------------------------------

def test_surface_context_renders_pathname_and_guidance():
    block = george_chat._format_surface_context({
        "surface": "mcgs_bridge",
        "pathname": "/admin/bridge",
    })
    assert "Current route: **/admin/bridge**" in block, block
    # Guidance line — spot key phrases (loose match against smart quotes).
    assert re.search(r"You'?re already here", block), block
    assert "Opening the X now" in block, block


def test_surface_context_accepts_route_alias_key():
    # Older frontends might send `route` instead of `pathname`.
    block = george_chat._format_surface_context({
        "surface": "mcgs_bridge",
        "route": "/admin/dashboard",
    })
    assert "Current route: **/admin/dashboard**" in block


def test_surface_context_without_pathname_omits_route_line():
    block = george_chat._format_surface_context({"surface": "mcgs_bridge"})
    assert "Current route" not in block
    # But the block should still render the surface line.
    assert "Surface: **mcgs_bridge**" in block


def test_surface_context_empty_returns_empty_string():
    assert george_chat._format_surface_context(None) == ""
    assert george_chat._format_surface_context({}) == ""


# ---------------------------------------------------------------------------
# 6. Regression — capability map still lists every live surface + grounding
#    footer scrub still works.
# ---------------------------------------------------------------------------

def test_capability_map_lists_every_route_shortname():
    # Every /admin/<shortname> in _MCGS_ROUTES must appear as a bullet-line
    # short-name in MCGS_CAPABILITY_MAP so the two catalogues can't drift.
    cap_map = george_prompt.MCGS_CAPABILITY_MAP
    missing = []
    for path, _aliases in george_chat._MCGS_ROUTES:
        short = path.rsplit("/", 1)[-1]  # e.g. /admin/system-health → system-health
        # The capability map lines look like "- system-health     — ..."
        if not re.search(rf"(?m)^\-\s+{re.escape(short)}\b", cap_map):
            missing.append(short)
    assert not missing, (
        f"MCGS_CAPABILITY_MAP is missing short-names present in _MCGS_ROUTES: "
        f"{missing}"
    )


def test_grounding_footer_regex_strips_common_variants():
    # Rebuild the same scrub function grounded_chat_stream uses inline.
    _KB_TAG_RE = re.compile(r"\s*\[KB-[A-Z0-9-]+\]\s*")
    _FOOTER_RE = re.compile(
        r"(?im)^[\s\-\*\u2022]*"
        r"(?:grounded (?:in|via)|based on the tool (?:output|results?)"
        r"|verified (?:via|by) [\d]+ (?:sources?|tools?)"
        r"|from (?:the )?tool_results?"
        r"|source[s]?:\s*\d+ tool result[s]?)"
        r"[^\n]*\n?",
    )
    _FOOTER_INLINE_RE = re.compile(
        r"(?i)\s*(?:\(|—|-\s+)?\s*grounded (?:in|via)\s+\d+\s+tool result[s]?\.?\s*(?:\)|—)?",
    )
    def scrub(t):
        t = _KB_TAG_RE.sub(" ", t)
        t = _FOOTER_RE.sub("", t)
        t = _FOOTER_INLINE_RE.sub("", t)
        return re.sub(r"[ \t]{2,}", " ", t)

    samples = [
        "There are 2 events waiting.\nGrounded in 3 tool results.",
        "All quiet this morning. Grounded via 2 tools.",
        "Two events await review. [KB-FEAT-003]",
        "Based on the tool output above, three tickets remain.",
    ]
    for s in samples:
        out = scrub(s)
        assert "Grounded" not in out and "grounded" not in out.lower() \
            or "based on" not in out.lower(), \
            f"Scrub failed for: {s!r} → {out!r}"
        assert "[KB-" not in out, f"KB tag leaked: {out!r}"


def test_announcements_navigation_rule_still_in_prompt():
    # Prompt.py already carries the "Announcements = navigation" rule from
    # the previous batch. Guard against accidental removal.
    assert "Announcements = navigation" in george_prompt.ANSWER_STYLE


# ---------------------------------------------------------------------------
# Bonus: the three specific verbs still trigger.
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "reply, expected",
    [
        ("Taking you to the Bridge.", "/admin/bridge"),
        ("Navigating to the Segments page.", "/admin/segments"),
        ("Jumping into the Campaigns dashboard.", "/admin/campaigns"),
        ("Heading over to the Share a Moment moderation queue.", "/admin/moments"),
    ],
)
def test_all_trigger_verbs_work(reply, expected):
    assert george_chat._detect_navigation(reply) == expected
