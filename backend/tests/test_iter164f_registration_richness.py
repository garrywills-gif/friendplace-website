"""iter164f — verify plain 'how many registered?' style questions get
upgraded to the founding_members_summary tool so George can name the
latest registrant + time and offer to open the Founding Members page.

This closes the regression Garry flagged: George gave a bare count for
"how many registered?" instead of the count + latest + time + nav offer.
"""

from __future__ import annotations

import json
import os
import re
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

SEED_MARKER = "iter164f-richness"


def _login_token() -> str:
    r = requests.post(
        f"{BASE_URL}/api/cms/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:300]}"
    body = r.json()
    tok = body.get("token") or body.get("access_token")
    assert tok
    return tok


def _chat(token: str, message: str) -> dict:
    payload = {"message": message, "chat_id": None, "scope": "mcgs"}
    reply_parts: list[str] = []
    tools: list[dict] = []
    with requests.post(
        f"{BASE_URL}/api/george/chat",
        json=payload,
        headers={"Authorization": f"Bearer {token}", "Accept": "text/event-stream"},
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
            elif raw.startswith("data:"):
                data_str = raw.split(":", 1)[1].strip()
                try:
                    data = json.loads(data_str)
                except Exception:
                    continue
                if current_event == "delta":
                    reply_parts.append(data.get("text") or "")
                elif current_event == "tools":
                    tools.extend(data.get("results") or [])
    return {"reply": "".join(reply_parts), "tools": tools}


@pytest.fixture(scope="module")
def mongo():
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    db.interest_registrations.delete_many({"seed_marker": SEED_MARKER})
    now_utc = datetime.now(timezone.utc)
    db.interest_registrations.insert_many([
        {
            "id": f"seed-{uuid.uuid4()}",
            "first_name": "Aisha",
            "email": f"aisha-{uuid.uuid4().hex[:6]}@example.com",
            "state_country": "Sydney, NSW",
            "heard_from": "test",
            "companion_choice": "ash",
            "is_test": False,
            "is_reserved": False,
            "status": "registered",
            "created_at": (now_utc - timedelta(hours=5)).isoformat(),
            "seed_marker": SEED_MARKER,
        },
        {
            "id": f"seed-{uuid.uuid4()}",
            "first_name": "Kai",
            "email": f"kai-{uuid.uuid4().hex[:6]}@example.com",
            "state_country": "Brisbane, QLD",
            "heard_from": "test",
            "companion_choice": "nova",
            "is_test": False,
            "is_reserved": False,
            "status": "registered",
            "created_at": (now_utc - timedelta(hours=1)).isoformat(),
            "seed_marker": SEED_MARKER,
        },
    ])
    yield db
    db.interest_registrations.delete_many({"seed_marker": SEED_MARKER})
    client.close()


@pytest.fixture(scope="module")
def token():
    return _login_token()


# The bare-count questions we want richness on.
QUERIES = [
    "How many registered so far?",
    "How many people have registered?",
    "How many registrations do we have?",
    "How's registrations going?",
    "How are the founding members going?",
]


@pytest.mark.parametrize("q", QUERIES)
def test_bare_count_upgrades_to_summary(token, mongo, q):
    out = _chat(token, q)
    reply = out["reply"]
    tools = [t.get("name") for t in out["tools"]]
    print(f"\n[Q] {q}\n[REPLY] {reply}\n[TOOLS] {tools}")

    assert reply.strip(), f"empty reply for: {q}"

    # Routing check: must call founding_members_summary, NOT the bare count.
    assert "founding_members_summary" in tools, (
        f"expected founding_members_summary in tools for {q!r}, got {tools}"
    )

    low = reply.lower()

    # Assertion: reply names the latest person (Kai).
    assert "kai" in low, f"latest person 'Kai' missing from reply: {reply}"

    # Assertion: reply contains a time reference.
    time_rx = re.compile(
        r"(overnight|ago|yesterday|last night|this morning|earlier|"
        r"just after|about \d|around \d|\d+\s*(minute|hour|hr|min)s?\s*ago|"
        r"\d{1,2}(:\d{2})?\s*(am|pm)|evening|afternoon|morning|today|"
        r"a few hours|couple of hours|recent|past few|hour ago|hours ago)",
        re.IGNORECASE,
    )
    assert time_rx.search(low), f"no time reference in reply: {reply}"

    # Assertion: contextual nav offer for Founding Members.
    offer_rx = re.compile(
        r"(would you like|want me to|shall i|should i|happy to)\b.*?"
        r"(open|jump|take you|show|bring up|pull up)",
        re.IGNORECASE | re.DOTALL,
    )
    founding_mentioned = "founding member" in low
    assert founding_mentioned and offer_rx.search(reply), (
        f"missing contextual Founding Members nav offer: {reply}"
    )
