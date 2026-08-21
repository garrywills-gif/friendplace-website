"""Iter161 — production bug fixes for George chat output.

Tests the module-level scrubbers in services.george.chat:

1. `<tool_call>...</tool_call>` XML markup must never reach the UI.
2. "let me try that again"-style future-promise phrases (banned by
   OPERATING_RULES §8/§9/§12) get rewritten out of the reply.
3. `has_unclosed_tool_call` correctly detects partial tags so the
   streaming buffer knows to hold back deltas.
"""

from __future__ import annotations

from services.george.chat import (
    has_unclosed_tool_call,
    scrub_reply,
)


# ---------------------------------------------------------------------------
# 1. <tool_call> XML never reaches the UI
# ---------------------------------------------------------------------------


def test_tool_call_xml_is_stripped():
    reply = (
        "I couldn't retrieve the contacted organisations just now.\n\n"
        '<tool_call>\n'
        '{"name":"list_outreach_organisations","status":null,"limit":50}\n'
        '</tool_call>\n\n'
        "Would you like me to check again?"
    )
    cleaned = scrub_reply(reply)
    assert "<tool_call>" not in cleaned
    assert "</tool_call>" not in cleaned
    assert "list_outreach_organisations" not in cleaned
    # The legitimate prose survives.
    assert "I couldn't retrieve" in cleaned or "couldn't retrieve" in cleaned


def test_tool_call_variants_all_stripped():
    for opener, closer in (
        ("<tool_call>", "</tool_call>"),
        ("<tool-call>", "</tool-call>"),
        ("<tool_use>", "</tool_use>"),
        ("<tool_invocation>", "</tool_invocation>"),
        ("<tool_result>", "</tool_result>"),
        ("<tool_response>", "</tool_response>"),
    ):
        payload = f'{opener}{{"name":"foo"}}{closer}'
        cleaned = scrub_reply(f"before {payload} after").strip()
        assert opener not in cleaned
        assert closer not in cleaned
        assert '"name":"foo"' not in cleaned
        assert "before" in cleaned and "after" in cleaned


def test_stray_tool_call_open_tag_stripped():
    # Sometimes the LLM emits just an opener and the stream cuts off.
    reply = "Working on it… <tool_call> {\"name\":\"count\"}"
    cleaned = scrub_reply(reply)
    assert "<tool_call>" not in cleaned
    assert "Working on it" in cleaned


# ---------------------------------------------------------------------------
# 2. Banned "try that again" style future-promises are removed
# ---------------------------------------------------------------------------


def test_banned_try_again_phrases_removed():
    banned_examples = [
        "I couldn't retrieve the contacted organisations just now — let me try that again.",
        "One moment.",
        "Hang on a sec.",
        "Give me a moment.",
        "Let me refresh that.",
        "Let me check again.",
    ]
    for txt in banned_examples:
        cleaned = scrub_reply(txt).strip().lower()
        assert "let me try" not in cleaned, f"still contains banned phrase: {cleaned!r}"
        assert "one moment" not in cleaned, f"still contains banned phrase: {cleaned!r}"
        assert "give me a moment" not in cleaned, f"still contains banned phrase: {cleaned!r}"
        assert "hang on" not in cleaned, f"still contains banned phrase: {cleaned!r}"
        assert "let me refresh" not in cleaned, f"still contains banned phrase: {cleaned!r}"
        assert "let me check" not in cleaned, f"still contains banned phrase: {cleaned!r}"


def test_legitimate_content_not_over_scrubbed():
    kept = (
        "Two Founding Members joined this week. "
        "Would you like me to open the Founding Members CRM?"
    )
    cleaned = scrub_reply(kept).strip()
    assert "Two Founding Members" in cleaned
    assert "Founding Members CRM" in cleaned
    # The proper "Would you like me to try again?" pattern is a
    # question, not a promise, and MUST survive.
    proper = "I couldn't retrieve the latest count just now — want me to try again?"
    kept2 = scrub_reply(proper).strip()
    assert "want me to try again" in kept2.lower(), (
        f"the correct fallback question was scrubbed: {kept2!r}"
    )


# ---------------------------------------------------------------------------
# 3. Streaming-buffer helper: detect an unclosed tool_call
# ---------------------------------------------------------------------------


def test_has_unclosed_tool_call_detection():
    assert has_unclosed_tool_call("Some prose. <tool_call>") is True
    assert has_unclosed_tool_call("Some prose. <tool_call>\n{\"n\":1}") is True
    assert has_unclosed_tool_call(
        "Some prose. <tool_call>\n{\"n\":1}\n</tool_call> More prose."
    ) is False
    assert has_unclosed_tool_call("No tags at all.") is False
    # Multiple pairs — balanced ⇒ closed.
    assert has_unclosed_tool_call(
        "<tool_call>a</tool_call> mid <tool_call>b</tool_call>"
    ) is False
    # One extra opener ⇒ still open.
    assert has_unclosed_tool_call(
        "<tool_call>a</tool_call> mid <tool_call>b"
    ) is True
