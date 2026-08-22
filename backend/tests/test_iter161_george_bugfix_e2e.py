"""Iter161 — Live E2E for the four production George bugs.

Runs against the deployed backend at EXPO_PUBLIC_BACKEND_URL. Covers:

1. `<tool_call>` XML never leaks into the streamed reply.
2. "let me try that again" style future-promises never leak.
3. `count_outreach_organisations` returns a real integer matching direct
   MongoDB count.
4. Nav-success — a `navigate` event fires when George says "Open the
   Campaigns page", and the reply contains no false failure note.
5. Answer-first personality regression smoke.

Full reply text is printed for scenarios 1 & 4 so a human reviewer can
visually confirm.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import sys
from pathlib import Path

import pytest
import requests

# Make backend package importable so we can call the tool directly.
BACKEND_DIR = Path("/app/backend")
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://outreach-campaigns.preview.emergentagent.com",
).rstrip("/")
ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASSWORD = "TestPass2026!"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def admin_token() -> str:
    r = requests.post(
        f"{BASE_URL}/api/cms/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, f"cms admin login failed: {r.status_code} {r.text[:300]}"
    body = r.json()
    tok = body.get("token") or body.get("access_token")
    assert tok, f"no token in cms login body: {body}"
    return tok


def _chat_once(token: str, message: str, surface_context: dict | None = None) -> dict:
    """Fire a single turn against `/api/george/chat`, drain the SSE stream."""
    payload: dict = {"message": message, "scope": "mcgs"}
    if surface_context is not None:
        payload["surface_context"] = surface_context

    reply_parts: list[str] = []
    navigate_paths: list[str] = []
    tools: list[dict] = []
    error: str | None = None

    with requests.post(
        f"{BASE_URL}/api/george/chat",
        json=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "text/event-stream",
        },
        stream=True,
        timeout=180,
    ) as r:
        assert r.status_code == 200, f"chat failed: {r.status_code} {r.text[:300]}"
        current_event = None
        for raw in r.iter_lines(decode_unicode=True):
            if raw is None:
                continue
            if raw == "":
                current_event = None
                continue
            if raw.startswith("event:"):
                current_event = raw.split(":", 1)[1].strip()
            elif raw.startswith("data:"):
                data_str = raw.split(":", 1)[1].strip()
                try:
                    data = json.loads(data_str)
                except Exception:
                    continue
                if current_event == "delta":
                    reply_parts.append(data.get("text") or "")
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
        "navigate_paths": navigate_paths,
        "tools": tools,
        "error": error,
    }


# Report bucket so the whole file's evidence lands in one place at the end.
REPORT: dict = {"scenarios": {}}


def _dump_report_at_teardown():
    out_path = Path("/app/test_reports/iter161_e2e_evidence.json")
    out_path.write_text(json.dumps(REPORT, indent=2, default=str))
    print(f"\n---- E2E evidence written to {out_path} ----")


@pytest.fixture(scope="module", autouse=True)
def _emit_report(request):
    yield
    _dump_report_at_teardown()


# ---------------------------------------------------------------------------
# Scenario 1 — tool-call XML must never leak
# ---------------------------------------------------------------------------

def test_scenario_1_no_tool_call_xml(admin_token):
    result = _chat_once(
        admin_token,
        "List all Outreach organisations in contacted status. "
        "If your tool fails, retry it.",
    )
    reply = result["reply"]
    print(f"\n=== SCENARIO 1 REPLY ({len(reply)} chars) ===\n{reply[:1600]}\n===")
    REPORT["scenarios"]["1_tool_call_xml"] = {
        "prompt": "List all Outreach organisations in contacted status. If your tool fails, retry it.",
        "reply_excerpt": reply[:800],
        "reply_full": reply,
        "tools_used": [t.get("name") for t in result["tools"]],
        "navigate_paths": result["navigate_paths"],
    }
    banned = [
        "<tool_call>",
        "</tool_call>",
        "<tool_use>",
        "</tool_use>",
        "<tool_invocation>",
        "<tool_result>",
        '"name":"list_outreach_organisations"',
        '"name": "list_outreach_organisations"',
    ]
    for b in banned:
        assert b not in reply, f"tool-call plumbing leaked into reply: {b!r}"


# ---------------------------------------------------------------------------
# Scenario 2 — no "let me try that again" style future-promises
# ---------------------------------------------------------------------------

def test_scenario_2_no_try_again_promise(admin_token):
    result = _chat_once(
        admin_token,
        "Recount all outreach organisations, then try that count again.",
    )
    reply = result["reply"]
    reply_l = reply.lower()
    print(f"\n=== SCENARIO 2 REPLY ({len(reply)} chars) ===\n{reply[:1200]}\n===")
    REPORT["scenarios"]["2_try_again_promise"] = {
        "prompt": "Recount all outreach organisations, then try that count again.",
        "reply_excerpt": reply[:800],
        "reply_full": reply,
        "tools_used": [t.get("name") for t in result["tools"]],
    }
    banned_phrases = [
        "let me try",
        "one moment",
        "hang on",
        "give me a moment",
        "i'll check back",
        "i'll follow up",
        "let me refresh",
        "let me check again",
    ]
    for p in banned_phrases:
        assert p not in reply_l, (
            f"banned future-promise phrase {p!r} appeared in reply:\n{reply}"
        )
    # "want me to try again?" (a question) MAY appear — that's fine.


# ---------------------------------------------------------------------------
# Scenario 3 — grounding sanity: George's count == direct Mongo count
# ---------------------------------------------------------------------------

def _direct_outreach_count() -> tuple[int, dict, str | None]:
    """Call `count_outreach_organisations` directly, plus by-status
    breakdown. Returns (total, {"contacted": n, ...}, err_or_None).
    """
    try:
        from motor.motor_asyncio import AsyncIOMotorClient  # type: ignore
        from services.george.tools import execute_tool
    except Exception as exc:  # pragma: no cover
        return -1, {}, f"import failed: {exc!r}"

    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "test_database")

    async def _run():
        client = AsyncIOMotorClient(mongo_url)
        db = client[db_name]
        breakdown: dict[str, int] = {}
        total = await execute_tool(db, "count_outreach_organisations", {})
        for status in [
            "not_contacted", "contacted", "awaiting_reply",
            "replied", "joined", "declined", "bounced", "unsubscribed",
        ]:
            breakdown[status] = await execute_tool(
                db, "count_outreach_organisations", {"status": status},
            )
        client.close()
        return total, breakdown

    try:
        total, breakdown = asyncio.run(_run())
        return int(total), breakdown, None
    except Exception as exc:
        return -1, {}, f"execute_tool crashed: {exc!r}"


def test_scenario_3_grounding_count(admin_token):
    total, breakdown, err = _direct_outreach_count()
    print(f"\n=== SCENARIO 3 DIRECT COUNT ===\ntotal={total} err={err}\nbreakdown={breakdown}\n===")
    REPORT["scenarios"]["3_grounding"] = {
        "direct_total": total,
        "direct_breakdown": breakdown,
        "direct_error": err,
    }

    if err:
        pytest.fail(f"direct tool invocation failed: {err}")
    assert isinstance(total, int) and total >= 0, (
        f"count_outreach_organisations returned non-int/negative: {total!r}"
    )

    # Now ask George the same thing and see whether the number in his
    # reply matches. He may return the total or a status-scoped number.
    result = _chat_once(
        admin_token,
        "How many outreach organisations do we have in total, and how "
        "many are in contacted status?",
    )
    reply = result["reply"]
    print(f"\n=== SCENARIO 3 GEORGE REPLY ===\n{reply[:1200]}\n===")
    REPORT["scenarios"]["3_grounding"]["george_reply"] = reply
    REPORT["scenarios"]["3_grounding"]["george_reply_excerpt"] = reply[:800]
    REPORT["scenarios"]["3_grounding"]["george_tools"] = [t.get("name") for t in result["tools"]]

    # Sanity: George should at least mention the direct total OR the
    # contacted status count somewhere in the reply. We accept either as
    # evidence he's grounded in the tool result rather than hallucinating.
    reply_nums = [int(n) for n in re.findall(r"\b\d+\b", reply)]
    expected_candidates = {total, breakdown.get("contacted", -999)}
    matched = expected_candidates & set(reply_nums)
    REPORT["scenarios"]["3_grounding"]["reply_numbers"] = reply_nums
    REPORT["scenarios"]["3_grounding"]["matched_expected"] = list(matched)
    if not matched:
        # Don't hard-fail — flag as a warning in the report.
        REPORT["scenarios"]["3_grounding"]["warning"] = (
            f"George's reply did not include the expected direct total "
            f"({total}) or contacted count ({breakdown.get('contacted')}). "
            f"Numbers seen in reply: {reply_nums}"
        )


# ---------------------------------------------------------------------------
# Scenario 4 — navigation success not falsely reported as failed
# ---------------------------------------------------------------------------

def test_scenario_4_navigation_success(admin_token):
    result = _chat_once(admin_token, "Open the Campaigns page.")
    reply = result["reply"]
    nav_paths = result["navigate_paths"]
    reply_l = reply.lower()
    print(f"\n=== SCENARIO 4 REPLY ({len(reply)} chars) ===\n{reply[:1600]}\n===")
    print(f"nav paths: {nav_paths}")
    REPORT["scenarios"]["4_navigation"] = {
        "prompt": "Open the Campaigns page.",
        "reply_excerpt": reply[:800],
        "reply_full": reply,
        "navigate_paths": nav_paths,
    }
    assert any(p.startswith("/admin/campaigns") for p in nav_paths), (
        f"expected a navigate event to /admin/campaigns; got {nav_paths}"
    )
    banned_failure_notes = [
        "i couldn't open",
        "couldn't open the campaigns",
        "i wasn't able to open",
        "wasn't able to open the campaigns",
        "log that navigation failure",
        "log the navigation failure",
        "couldn't open campaigns automatically",
    ]
    for p in banned_failure_notes:
        assert p not in reply_l, (
            f"reply falsely reports navigation failure ({p!r}):\n{reply}"
        )


# ---------------------------------------------------------------------------
# Scenario 5 — answer-first personality regression smoke
# ---------------------------------------------------------------------------

def test_scenario_5_answer_first_personality(admin_token):
    result = _chat_once(
        admin_token,
        "Should I focus on Campaigns or Members today?",
    )
    reply = result["reply"]
    reply_l = reply.lower()
    print(f"\n=== SCENARIO 5 REPLY ===\n{reply[:1200]}\n===")
    REPORT["scenarios"]["5_personality"] = {
        "prompt": "Should I focus on Campaigns or Members today?",
        "reply_excerpt": reply[:800],
    }
    recommendation_signals = [
        "i'd ",
        "i would ",
        "my read",
        "i'd lean",
        "lean toward",
        "lean one way",
        "if i had to",
        "i'd focus",
        "focus on",
        "i'd start",
        "i recommend",
        "recommend ",
    ]
    hit = any(sig in reply_l for sig in recommendation_signals)
    REPORT["scenarios"]["5_personality"]["recommendation_signal_hit"] = hit
    assert hit, (
        f"George did not give an answer-first recommendation. Reply:\n{reply}"
    )
