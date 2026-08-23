"""iter164e re-verification — Bug 2 B1 gap fix.

Seeds two `interest_registrations` rows via Mongo, asks George
"Any new registrations overnight?" via SSE and asserts:

1. Includes headline count (2 or "two")
2. Includes latest first name (Mateo — the more recent)
3. Includes SOME time reference
4. Ends with a contextual Founding Members nav offer
5. Reply is not a bloated template (no "Number:\nLatest:\n" style)
6. Reply is single-turn (no "let me check" preamble)

Plus spot-check B2 (casual) and B3 (empty state).

Cleans up seeded rows afterwards.
"""

from __future__ import annotations

import json
import os
import re
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "http://localhost:8001").rstrip("/")
ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASS = "TestPass2026!"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

SEED_MARKER = "iter164e-b1-retest"


# ---------------------------------------------------------------- helpers

def _login_token() -> str:
    r = requests.post(
        f"{BASE_URL}/api/cms/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:300]}"
    body = r.json()
    tok = body.get("token") or body.get("access_token")
    assert tok, f"no token in login response: {body}"
    return tok


def _chat(token: str, message: str) -> dict:
    """POST to /api/george/chat and return {reply, tools, navigate_paths}."""
    payload = {"message": message, "chat_id": None, "scope": "mcgs"}
    reply_parts: list[str] = []
    navigate_paths: list[str] = []
    tools: list[dict] = []
    events: list[str] = []
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
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
        current_event = None
        for raw in r.iter_lines(decode_unicode=True):
            if raw is None:
                continue
            if not raw:
                current_event = None
                continue
            if raw.startswith("event:"):
                current_event = raw.split(":", 1)[1].strip()
                events.append(current_event)
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
    return {
        "reply": "".join(reply_parts),
        "navigate_paths": navigate_paths,
        "tools": tools,
        "events": events,
    }


# ---------------------------------------------------------------- seeding

@pytest.fixture(scope="module")
def mongo():
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    # cleanup any leftover from a previous crashed run
    db.interest_registrations.delete_many({"seed_marker": SEED_MARKER})
    yield db
    db.interest_registrations.delete_many({"seed_marker": SEED_MARKER})
    client.close()


def _seed_two(db) -> tuple[str, str]:
    """Seed Priya (earlier) then Mateo (later). Returns their created_at ISOs."""
    now_utc = datetime.now(timezone.utc)
    # Both within the last 12 hours so they land inside the Sydney calendar day
    priya_at = (now_utc - timedelta(hours=6)).isoformat()
    mateo_at = (now_utc - timedelta(hours=2)).isoformat()

    db.interest_registrations.insert_many([
        {
            "id": f"seed-{uuid.uuid4()}",
            "first_name": "Priya",
            "email": f"priya-{uuid.uuid4().hex[:6]}@example.com",
            "state_country": "Sydney, NSW",
            "heard_from": "test",
            "companion_choice": "ash",
            "is_test": False,
            "is_reserved": False,
            "status": "registered",
            "created_at": priya_at,
            "seed_marker": SEED_MARKER,
        },
        {
            "id": f"seed-{uuid.uuid4()}",
            "first_name": "Mateo",
            "email": f"mateo-{uuid.uuid4().hex[:6]}@example.com",
            "state_country": "Melbourne, VIC",
            "heard_from": "test",
            "companion_choice": "nova",
            "is_test": False,
            "is_reserved": False,
            "status": "registered",
            "created_at": mateo_at,
            "seed_marker": SEED_MARKER,
        },
    ])
    return priya_at, mateo_at


# ---------------------------------------------------------------- tests

@pytest.fixture(scope="module")
def token():
    return _login_token()


class TestB1RetestSeeded:
    _reply: str = ""
    _tools: list = []

    def test_b1_seeded_reply_all_assertions(self, token, mongo):
        # 1) Seed two rows: Priya (earlier), Mateo (later)
        priya_at, mateo_at = _seed_two(mongo)
        # tiny delay so any downstream caches (if any) don't race
        time.sleep(0.3)

        try:
            out = _chat(token, "Any new registrations overnight?")
        finally:
            # Cleanup happens in fixture teardown too, but also here defensively
            pass

        reply = out["reply"]
        tools = out["tools"]
        TestB1RetestSeeded._reply = reply
        TestB1RetestSeeded._tools = tools

        print("\n[B1 SEEDED] full reply:\n" + reply)
        print("\n[B1 SEEDED] tools invoked:", [t.get("name") for t in tools])

        assert reply.strip(), "empty reply from George"

        low = reply.lower()

        # --- Assertion 1: headline count "2" or "two"
        a1_pass = bool(re.search(r"\b(2|two)\b", low))
        assert a1_pass, f"[Assertion 1] missing headline count '2' or 'two': {reply}"

        # --- Assertion 2: latest first name = Mateo
        a2_pass = "Mateo" in reply or "mateo" in low
        assert a2_pass, f"[Assertion 2] missing latest person 'Mateo': {reply}"

        # --- Assertion 3: SOME time reference
        time_rx = re.compile(
            r"(overnight|ago|yesterday|last night|this morning|earlier|"
            r"just after|about \d|around \d|\d+\s*(minute|hour|hr|min)s?\s*ago|"
            r"\d{1,2}(:\d{2})?\s*(am|pm)|evening|afternoon|morning|today|"
            r"a few hours|couple of hours|recent|past few)",
            re.IGNORECASE,
        )
        a3_pass = bool(time_rx.search(low))
        assert a3_pass, f"[Assertion 3] missing time reference: {reply}"

        # --- Assertion 4: contextual nav offer for Founding Members
        offer_rx = re.compile(
            r"(would you like|want me to|shall i|should i)\b.*?(open|jump|take you|show|bring up|pull up)",
            re.IGNORECASE | re.DOTALL,
        )
        founding_mentioned = "founding member" in low or "founding-member" in low
        offer_present = bool(offer_rx.search(reply))
        a4_pass = offer_present and founding_mentioned
        assert a4_pass, f"[Assertion 4] missing contextual Founding Members nav offer: {reply}"

        # --- Assertion 5: no bloated template ("Number: 2\nLatest: Mateo\n" style)
        # Detect obvious label-value templating.
        template_labels = [
            r"^\s*number\s*:\s*",
            r"^\s*latest\s*:\s*",
            r"^\s*count\s*:\s*",
            r"^\s*total\s*:\s*",
            r"^\s*newest\s*:\s*",
            r"^\s*confidence\s*:",
            r"^\s*sources\s*:",
            r"^\s*what\s*:\s*",
            r"^\s*why\s*:\s*",
        ]
        template_hit = None
        for rx in template_labels:
            m = re.search(rx, reply, re.IGNORECASE | re.MULTILINE)
            if m:
                template_hit = rx
                break
        a5_pass = template_hit is None
        assert a5_pass, f"[Assertion 5] reply looks like a bloated template ({template_hit!r}): {reply}"

        # --- Assertion 6: single-turn — no "let me check" / "one moment" preamble
        preamble_rx = re.compile(
            r"\b(let me check|one moment|hold on|give me a sec|checking now|"
            r"i'll (check|look|pull|grab)|let me (look|pull|grab)|"
            r"give me a moment)\b",
            re.IGNORECASE,
        )
        preamble_match = preamble_rx.search(reply)
        a6_pass = preamble_match is None
        assert a6_pass, f"[Assertion 6] reply contains a forced preamble: {preamble_match!r} — {reply}"

    def test_b1_founding_summary_tool_called(self):
        """The whole fix hinges on routing to founding_members_summary.

        This is a diagnostic, not a hard requirement — the reply-content
        assertions above are what determines PASS/FAIL. We just log the
        tool trace for the report.
        """
        names = [t.get("name") for t in TestB1RetestSeeded._tools]
        print("[diag] tools =", names)
        # NOT strictly asserted — leave it as diagnostic info


class TestB2CasualUnchanged:
    def test_casual_morning_george_short_no_nav(self, token):
        out = _chat(token, "Morning George")
        reply = out["reply"]
        print("\n[B2 casual] reply:\n" + reply)
        assert reply.strip(), "empty casual reply"
        assert len(reply) < 500, f"casual reply too long ({len(reply)}): {reply}"
        low = reply.lower()
        # No Mission Control surface offers for casual chat
        forbidden = ["founding member", "the bridge", "campaigns page",
                     "system health", "flyer publishing"]
        for s in forbidden:
            assert s not in low, f"casual reply mentions surface '{s}': {reply}"


class TestB3EmptyState:
    def test_no_rows_graceful_reply(self, token, mongo):
        # Ensure no seeded rows exist
        mongo.interest_registrations.delete_many({"seed_marker": SEED_MARKER})
        # Also nuke any accidental very-recent non-test rows created by other tests
        # (we only touch rows we can identify — leave real data alone)

        out = _chat(token, "Any new registrations overnight?")
        reply = out["reply"]
        print("\n[B3 empty] reply:\n" + reply)
        low = reply.lower()

        # If real data exists we might still get a non-zero count; that's fine.
        # But the more common scenario in test DB is 0 recent. In either case:
        # - reply must not crash
        # - if it's a "nothing new" answer, the phrasing should be graceful
        assert reply.strip(), "empty reply for empty-state question"

        # Look for graceful empty-state phrasing OR a normal count reply.
        graceful = bool(re.search(
            r"(nothing new|no new|no one|nobody|no registrations|none overnight|"
            r"zero new|haven't had any|hasn't been|quiet overnight|all quiet)",
            low,
        ))
        headline_num = bool(re.search(r"\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b", low))
        assert graceful or headline_num, (
            f"empty-state reply neither graceful nor has a count: {reply}"
        )
