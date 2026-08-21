"""E2E behavioural test for the `feature/george-more-human` personality diff.

Logs in as the CMS admin (hello@friendplace.com.au) and sends the six
prompts specified in the review request through `/api/george/chat`,
capturing SSE deltas and checking tone/safety-rail assertions.

Run:  pytest tests/test_george_more_human_e2e.py -v -s
"""
from __future__ import annotations

import json
import os
import re
import uuid

import pytest
import requests


BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://outreach-campaigns.preview.emergentagent.com",
).rstrip("/")
ADMIN_IDENT = "hello@friendplace.com.au"
ADMIN_PASSWORD = "TestPass2026!"


@pytest.fixture(scope="module")
def token() -> str:
    # CMS admin login (separate from the FriendPlace member auth).
    # The MCGS current_admin dependency expects a `cms_admin` purpose token.
    r = requests.post(
        f"{BASE_URL}/api/cms/auth/login",
        json={"email": ADMIN_IDENT, "password": ADMIN_PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, f"cms admin login failed: {r.status_code} {r.text}"
    tok = r.json().get("token")
    assert tok, f"no token in cms login response: {r.text}"
    return tok


def _chat_once(
    token: str,
    message: str,
    chat_id: str | None = None,
    surface_context: dict | None = None,
) -> dict:
    """Fire a single turn against `/api/george/chat`, consume the SSE
    stream, return {reply, chat_id, action_previews[], navigate_paths[], tools[]}.
    """
    payload: dict = {"message": message, "scope": "mcgs"}
    if chat_id:
        payload["chat_id"] = chat_id
    if surface_context is not None:
        payload["surface_context"] = surface_context

    reply_parts: list[str] = []
    action_previews: list[dict] = []
    navigate_paths: list[str] = []
    tools: list[dict] = []
    got_chat_id: str | None = chat_id
    error: str | None = None

    with requests.post(
        f"{BASE_URL}/api/george/chat",
        json=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "text/event-stream",
        },
        stream=True,
        timeout=120,
    ) as r:
        assert r.status_code == 200, f"chat failed: {r.status_code} {r.text[:300]}"
        current_event = None
        for raw in r.iter_lines(decode_unicode=True):
            if raw is None:
                continue
            line = raw
            if not line:
                current_event = None
                continue
            if line.startswith("event:"):
                current_event = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                data_str = line.split(":", 1)[1].strip()
                try:
                    data = json.loads(data_str)
                except Exception:
                    continue
                if current_event == "session":
                    got_chat_id = data.get("chat_id") or got_chat_id
                elif current_event == "delta":
                    reply_parts.append(data.get("text") or "")
                elif current_event == "action_preview":
                    action_previews.append(data)
                elif current_event == "navigate":
                    if data.get("path"):
                        navigate_paths.append(data["path"])
                elif current_event == "tools":
                    tools.extend(data.get("results") or [])
                elif current_event == "done":
                    if data.get("error"):
                        error = data["error"]

    return {
        "reply": "".join(reply_parts),
        "chat_id": got_chat_id,
        "action_previews": action_previews,
        "navigate_paths": navigate_paths,
        "tools": tools,
        "error": error,
    }


# --------------------------------------------------------------------------- #
# Global collector so we can dump a per-prompt transcript in the report.
# --------------------------------------------------------------------------- #
RESULTS: dict[str, dict] = {}


def _record(key: str, prompt: str, out: dict, passed: dict) -> None:
    RESULTS[key] = {
        "prompt": prompt,
        "reply_excerpt": (out["reply"] or "")[:600],
        "reply_length": len(out["reply"] or ""),
        "navigate_paths": out["navigate_paths"],
        "action_previews": [
            {k: v for k, v in ap.items() if k in ("kind", "route", "path", "target")}
            for ap in out["action_previews"]
        ],
        "tools_called": [t.get("tool") for t in out["tools"]],
        "assertions": passed,
        "error": out["error"],
    }


# =========================================================================== #
# Part C — prompt tone / safety-rail assertions
# =========================================================================== #

class TestGeorgeMoreHumanBehaviour:

    # --- 1. Answer-first + point of view ----------------------------------- #
    def test_answer_first_point_of_view(self, token):
        prompt = "Should I do a Founding Members drive this weekend or wait two more weeks?"
        out = _chat_once(token, prompt)
        reply = out["reply"] or ""
        low = reply.lower()

        has_view = bool(re.search(
            r"\b(i'd|i would|my read is|my read's|i'd lean|i lean|i'd recommend|"
            r"i recommend|i'd say|my recommendation|i think|i'd suggest|"
            r"if i had to pick|my vote|personally,? i)\b",
            low,
        ))
        no_documented_preamble = not re.match(
            r"^\s*(this\s+isn'?t\s+documented|this\s+isn'?t\s+in\s+the\s+kb|"
            r"this\s+is\s+reasoning\s*[—-]|reasoning\s+mode\s*[:—-])",
            reply.strip(),
            re.IGNORECASE,
        )
        reasonable_length = len(reply) < 2500
        no_giant_heading_essay = reply.count("\n## ") + reply.count("\n### ") <= 1

        passed = {
            "has_recommendation_verb": has_view,
            "no_documented_preamble": no_documented_preamble,
            "reasonable_length": reasonable_length,
            "no_heading_essay": no_giant_heading_essay,
        }
        _record("1_answer_first_pov", prompt, out, passed)

        assert has_view, f"reply lacks a clear recommendation phrase. Reply: {reply[:400]}"
        assert no_documented_preamble, f"reply starts with a formal reasoning preamble. Reply: {reply[:400]}"
        assert reasonable_length, f"reply too long ({len(reply)} chars) for a single decision question"
        assert no_giant_heading_essay, "reply uses multi-heading essay format for a single decision"

    # --- 2. Continue vs restart on rapid follow-up ------------------------- #
    def test_continue_conversation_not_restart(self, token):
        turn1_prompt = "What's on the Bridge right now?"
        turn2_prompt = "Anything urgent?"
        surface = {"pathname": "/admin/bridge", "surface": "bridge"}

        out1 = _chat_once(token, turn1_prompt, surface_context=surface)
        chat_id = out1["chat_id"]
        assert chat_id, "no chat_id returned on turn 1"

        # Small internal record for turn 1 too (helps humans read the report).
        _record("2a_bridge_turn1", turn1_prompt, out1, {"note": "context for turn 2"})

        out2 = _chat_once(token, turn2_prompt, chat_id=chat_id, surface_context=surface)
        reply2 = out2["reply"] or ""
        low2 = reply2.lower()
        first_100 = reply2.strip()[:120].lower()

        no_greeting = not re.search(
            r"\b(morning|good morning|afternoon|good afternoon|evening|good evening|"
            r"hi garry|hey garry|hello garry|g'?day|nice to have you back)\b",
            first_100,
        )
        no_filler_opener = not re.match(
            r"^\s*(certainly|of course|absolutely|sure thing)\b",
            reply2.strip(),
            re.IGNORECASE,
        )
        # He shouldn't re-teach what the Bridge is on a rapid follow-up.
        # Rough heuristic: don't paste a definitional sentence.
        no_bridge_definition = not re.search(
            r"the bridge is (the|our|where|a)",
            low2,
        )

        passed = {
            "no_fresh_greeting": no_greeting,
            "no_filler_opener": no_filler_opener,
            "no_bridge_redefinition": no_bridge_definition,
        }
        _record("2b_bridge_followup", turn2_prompt, out2, passed)

        assert no_greeting, f"reply opens with a fresh greeting. First 120 chars: {first_100!r}"
        assert no_filler_opener, f"reply opens with 'Certainly'/'Of course' filler. Reply: {reply2[:200]}"
        assert no_bridge_definition, f"reply re-explains what the Bridge is. Reply: {reply2[:300]}"

    # --- 3. Draft instead of interrogating --------------------------------- #
    def test_draft_instead_of_interrogating(self, token):
        prompt = "Draft a warm follow-up to the Kellyville Library about the flyer we sent them."
        out = _chat_once(token, prompt)
        reply = out["reply"] or ""
        low = reply.lower()

        # Look for real draft indicators
        has_subject_line = bool(re.search(r"(^|\n)\s*subject\s*[:\-—]", reply, re.IGNORECASE))
        has_hi_greeting = bool(re.search(
            r"(^|\n)\s*(hi|hello|dear|kia ora|g'day)\b[^\n]{0,60}(kellyville|library|team|there|folks|,)",
            reply,
            re.IGNORECASE,
        ))
        has_signoff = bool(re.search(
            r"\b(warm regards|kind regards|regards,?|cheers,?|many thanks,?|thanks,?"
            r"|thank you,?|best,?|talk soon,?|warmly,?)\b",
            low,
        ))
        # A minimum body length rules out pure clarifying-question replies.
        long_enough_for_body = len(reply) > 250

        # Count clarifying questions posed to the user (rough heuristic).
        clarifying_questions = len(re.findall(r"\?", reply))

        # Real draft: at least two of {subject, greeting, sign-off} + a decent body length.
        draft_signals = sum([has_subject_line, has_hi_greeting, has_signoff])
        looks_like_draft = draft_signals >= 2 and long_enough_for_body

        # Fail if we got ONLY questions, no draft.
        only_questions = (
            clarifying_questions >= 2
            and not looks_like_draft
        )

        passed = {
            "has_subject_line": has_subject_line,
            "has_greeting": has_hi_greeting,
            "has_signoff": has_signoff,
            "looks_like_draft": looks_like_draft,
            "did_not_only_ask_questions": not only_questions,
            "reply_length": len(reply),
        }
        _record("3_draft_not_interrogate", prompt, out, passed)

        assert looks_like_draft, (
            f"reply doesn't contain a recognisable draft body "
            f"(subject={has_subject_line}, greeting={has_hi_greeting}, "
            f"signoff={has_signoff}, len={len(reply)}). Reply: {reply[:500]}"
        )
        assert not only_questions, (
            f"reply is mostly clarifying questions with no draft. Reply: {reply[:500]}"
        )

    # --- 4. Navigation still works (safety rail) --------------------------- #
    def test_navigation_still_works(self, token):
        prompt = "Open the Bridge."
        out = _chat_once(token, prompt)
        reply = out["reply"] or ""
        low = reply.lower()

        has_open_bridge_phrase = bool(re.search(
            r"(opening|taking you to|navigating to|jumping (in)?to|heading (over )?to)"
            r"[^.\n]*?bridge",
            low,
        ))
        # Backup: structured navigate path or action_preview pointing to /admin/bridge.
        navigated_via_payload = any(
            "/admin/bridge" in (p or "") for p in out["navigate_paths"]
        ) or any(
            "/admin/bridge" in json.dumps(ap).lower() for ap in out["action_previews"]
        )

        passed = {
            "reply_announces_navigation": has_open_bridge_phrase,
            "navigate_event_emitted": navigated_via_payload,
        }
        _record("4_navigate_bridge", prompt, out, passed)

        assert has_open_bridge_phrase or navigated_via_payload, (
            f"reply neither announces 'Opening ... Bridge' nor emits a bridge nav path. "
            f"navigate_paths={out['navigate_paths']}, reply={reply[:400]}"
        )

    # --- 5. Never refuse a listed surface (safety rail) -------------------- #
    def test_never_refuse_listed_surface(self, token):
        # Outreach is a LIVE surface (see MCGS_CAPABILITY_MAP).
        prompt = "Open the Outreach page."
        out = _chat_once(token, prompt)
        reply = out["reply"] or ""
        low = reply.lower()

        banned_phrases = [
            "not available yet",
            "coming in a future phase",
            "can't open from here",
            "cannot open from here",
            "not yet built",
            "not yet available",
        ]
        contains_banned = [p for p in banned_phrases if p in low]
        # Positive: reply announces navigation, or backend emits nav path.
        has_open_phrase = bool(re.search(
            r"(opening|taking you to|navigating to|jumping (in)?to|heading (over )?to)"
            r"[^.\n]*?outreach",
            low,
        ))
        navigated_via_payload = any(
            "/admin/outreach" in (p or "") for p in out["navigate_paths"]
        )

        passed = {
            "no_refusal_phrases": not contains_banned,
            "banned_phrases_found": contains_banned,
            "reply_announces_navigation": has_open_phrase,
            "navigate_event_emitted": navigated_via_payload,
        }
        _record("5_no_refuse_listed_surface", prompt, out, passed)

        assert not contains_banned, (
            f"safety-rail regression: reply contains {contains_banned}. Reply: {reply[:500]}"
        )
        assert has_open_phrase or navigated_via_payload, (
            f"reply doesn't navigate to Outreach. Reply: {reply[:400]}"
        )

    # --- 6. Grounding still holds (safety rail) ---------------------------- #
    def test_grounding_still_holds(self, token):
        prompt = "How many members joined this week?"
        out = _chat_once(token, prompt)
        reply = out["reply"] or ""
        low = reply.lower()

        called_a_tool = len(out["tools"]) > 0
        # Explicit admission that the data isn't available.
        admits_no_data = bool(re.search(
            r"(don'?t have|couldn'?t retrieve|not enough information|"
            r"can'?t tell you (yet|right now)|no (data|number) (available|on|for)|"
            r"i can'?t see|i haven'?t got|not sure i can tell)",
            low,
        ))
        # If neither a tool call nor a "no data" admission → the reply
        # must not fabricate a specific number.
        has_number = bool(re.search(r"\b\d+\b", reply))
        fabricated = (not called_a_tool) and (not admits_no_data) and has_number

        passed = {
            "called_a_tool": called_a_tool,
            "admits_missing_data_if_needed": admits_no_data,
            "reply_contains_number": has_number,
            "appears_fabricated": fabricated,
            "tools_called": [t.get("tool") for t in out["tools"]],
        }
        _record("6_grounding", prompt, out, passed)

        assert not fabricated, (
            f"grounding regression: reply invents a number without a tool call "
            f"or missing-data admission. Reply: {reply[:500]}"
        )


def test_write_transcript_dump(token):
    """After the six behavioural tests run, dump per-prompt transcripts
    to a JSON file that the main agent + user can read to eyeball tone.
    """
    # `token` fixture triggers login even if this test runs standalone.
    _ = token
    out_path = "/app/test_reports/george_more_human_transcripts.json"
    with open(out_path, "w") as f:
        json.dump(RESULTS, f, indent=2, default=str)
    print(f"Transcripts written to {out_path}")
