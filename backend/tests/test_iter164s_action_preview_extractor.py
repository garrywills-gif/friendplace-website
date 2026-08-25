"""iter164s — Inline action_preview interceptor tests.

Bug (Garry, 24 Aug 2026): George occasionally prints an
`action_preview` JSON payload directly in his prose (usually inside a
```json fence) instead of invoking the corresponding tool. That left
admins staring at raw JSON rather than the interactive card.

The extractor in `services.george.chat.extract_action_previews` scans
arbitrary text for embedded action_preview payloads, returns the
cleaned prose (with the payload removed) and the parsed preview
objects. The streaming loop yields those as proper `action_preview`
SSE events so the card renders even when Claude slips.

These tests exercise the extractor directly. The end-to-end SSE
behaviour is covered by `test_iter158_george_flyer_authoring.py`.
"""

from services.george.chat import (
    extract_action_previews,
    has_unclosed_code_fence,
)


class TestExtractActionPreviews:
    def test_returns_empty_for_plain_text(self):
        cleaned, previews = extract_action_previews("Just a chat reply.")
        assert cleaned == "Just a chat reply."
        assert previews == []

    def test_extracts_from_json_fence(self):
        text = (
            "Here is your flyer.\n\n"
            "```json\n"
            '{"kind": "action_preview", "action_type": "flyer_draft", '
            '"what": "Draft flyer", "draft": "x"}\n'
            "```\n\n"
            "Nothing prints until you tap Print."
        )
        cleaned, previews = extract_action_previews(text)
        assert len(previews) == 1
        assert previews[0]["kind"] == "action_preview"
        assert previews[0]["action_type"] == "flyer_draft"
        # Both the fence and the JSON body are gone from the prose.
        assert "action_preview" not in cleaned
        assert "```" not in cleaned
        assert "Here is your flyer." in cleaned
        assert "Nothing prints until you tap Print." in cleaned

    def test_extracts_bare_json(self):
        text = (
            'Preview payload: '
            '{"kind": "action_preview", "what": "x"} '
            "— all set."
        )
        cleaned, previews = extract_action_previews(text)
        assert len(previews) == 1
        assert previews[0]["what"] == "x"
        assert "action_preview" not in cleaned
        assert "— all set." in cleaned

    def test_leaves_unrelated_code_blocks_alone(self):
        text = (
            "Here's the query I ran:\n"
            "```python\n"
            "print('hello')\n"
            "```\n"
            "Straightforward."
        )
        cleaned, previews = extract_action_previews(text)
        assert previews == []
        # Bit-for-bit unchanged — no false-positive stripping.
        assert cleaned == text

    def test_leaves_json_without_kind_alone(self):
        text = (
            "Config sample:\n"
            "```json\n"
            '{"foo": "bar"}\n'
            "```\n"
            "Done."
        )
        cleaned, previews = extract_action_previews(text)
        assert previews == []
        assert cleaned == text

    def test_extracts_multiple_previews(self):
        text = (
            "Two flyers ready:\n"
            "```json\n"
            '{"kind": "action_preview", "what": "First"}\n'
            "```\n"
            "and\n"
            "```json\n"
            '{"kind": "action_preview", "what": "Second"}\n'
            "```\n"
            "That's both."
        )
        cleaned, previews = extract_action_previews(text)
        assert len(previews) == 2
        assert [p["what"] for p in previews] == ["First", "Second"]
        assert "action_preview" not in cleaned
        assert "```" not in cleaned
        assert cleaned.startswith("Two flyers ready:")
        assert cleaned.endswith("That's both.")

    def test_survives_malformed_json_after_marker(self):
        # A stray truncated payload should NOT be extracted (no valid parse).
        text = 'Whoops: {"kind": "action_preview", "what": "trunc'
        cleaned, previews = extract_action_previews(text)
        assert previews == []
        # And the extractor never chops the original text on a failed parse.
        assert cleaned == text


class TestHasUnclosedCodeFence:
    def test_empty(self):
        assert has_unclosed_code_fence("") is False

    def test_balanced(self):
        assert has_unclosed_code_fence("prose ```code``` more") is False

    def test_odd_fence_count(self):
        # One opening fence, still streaming — buffer must hold back.
        assert has_unclosed_code_fence("prose ```json\n{") is True

    def test_two_pairs(self):
        assert has_unclosed_code_fence("```a``` and ```b```") is False
