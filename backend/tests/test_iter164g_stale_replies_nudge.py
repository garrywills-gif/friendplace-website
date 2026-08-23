"""iter164g — Stale-reply nudge (7-day backlog) endpoint + George tool.

Verifies:
- GET /cms/replies/stale?days=7 returns count + list of unresolved
  replies older than the cutoff, sorted oldest first.
- Resolved replies are excluded.
- George's `list_stale_replies` tool is registered and callable.
- Topic router routes "stale replies" style questions to it.
"""

from __future__ import annotations

import json
import os
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

SEED_MARKER = "iter164g-stale"


def _login() -> str:
    r = requests.post(
        f"{BASE_URL}/api/cms/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=15,
    )
    assert r.status_code == 200
    return r.json()["token"]


def _chat(token: str, message: str) -> dict:
    reply_parts: list[str] = []
    tools: list[dict] = []
    with requests.post(
        f"{BASE_URL}/api/george/chat",
        json={"message": message, "chat_id": None, "scope": "mcgs"},
        headers={"Authorization": f"Bearer {token}", "Accept": "text/event-stream"},
        stream=True,
        timeout=120,
    ) as r:
        assert r.status_code == 200, r.text[:300]
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
def token():
    return _login()


@pytest.fixture(scope="module")
def mongo_stale():
    """Seed 3 stale (11d, 9d, 8d ago) + 1 recent + 1 resolved-stale."""
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    db.inbound_replies.delete_many({"seed_marker": SEED_MARKER})
    now = datetime.now(timezone.utc)

    def _mk(name: str, days_ago: float, resolved: bool = False):
        return {
            "id": f"seed-{uuid.uuid4()}",
            "from_email": f"{name.lower()}-{uuid.uuid4().hex[:5]}@example.com",
            "from_name": name,
            "subject": f"Testing from {name}",
            "body": "",
            "channel": "email",
            "campaign_id": None,
            "campaign_name": None,
            "related_send_id": None,
            "outreach_id": None,
            "founder_id": None,
            "received_at": (now - timedelta(days=days_ago)).isoformat(),
            "created_at": now.isoformat(),
            "created_by": None,
            "read": False,
            "resolved": resolved,
            "resolved_at": now.isoformat() if resolved else None,
            "resolved_by": ADMIN_EMAIL if resolved else None,
            "resolution_kind": "no_reply_needed" if resolved else None,
            "resolution_note": "Handled" if resolved else None,
            "notes": "",
            "seed_marker": SEED_MARKER,
        }

    db.inbound_replies.insert_many([
        _mk("Priya", 11.0),  # stale
        _mk("Kai", 9.0),      # stale
        _mk("Mateo", 8.0),    # stale
        _mk("Aisha", 3.0),    # recent (< 7d)
        _mk("Ghost", 20.0, resolved=True),  # stale but resolved → excluded
    ])
    yield db
    db.inbound_replies.delete_many({"seed_marker": SEED_MARKER})
    client.close()


class TestStaleEndpoint:
    def test_stale_returns_only_unresolved_older_than_cutoff(self, token, mongo_stale):
        r = requests.get(
            f"{BASE_URL}/api/cms/replies/stale?days=7&limit=50",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        payload = r.json()
        assert payload["days"] == 7
        # Only the 3 seeded stale replies (may be higher if prod-like
        # data has other stale rows). Ensure our seeded names appear
        # AND Ghost/Aisha do NOT.
        names = [row["from_name"] for row in payload["replies"]]
        assert "Priya" in names
        assert "Kai"   in names
        assert "Mateo" in names
        assert "Aisha" not in names, "recent (<7d) reply must be excluded"
        assert "Ghost" not in names, "resolved reply must be excluded"

    def test_stale_sorted_oldest_first(self, token, mongo_stale):
        r = requests.get(
            f"{BASE_URL}/api/cms/replies/stale?days=7",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        payload = r.json()
        # Filter to our seeds so the assertion is deterministic even if
        # other stale rows sneak in.
        seeds = [x for x in payload["replies"] if x["from_name"] in ("Priya", "Kai", "Mateo")]
        assert [s["from_name"] for s in seeds] == ["Priya", "Kai", "Mateo"], (
            f"expected oldest-first order Priya→Kai→Mateo, got {[s['from_name'] for s in seeds]}"
        )

    def test_stale_days_argument_respected(self, token, mongo_stale):
        r = requests.get(
            f"{BASE_URL}/api/cms/replies/stale?days=10",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        payload = r.json()
        # Only Priya (11d) is stale at the 10-day threshold.
        seeds = [x for x in payload["replies"] if x["from_name"] in ("Priya", "Kai", "Mateo")]
        assert [s["from_name"] for s in seeds] == ["Priya"], (
            f"expected only Priya at days=10, got {[s['from_name'] for s in seeds]}"
        )


class TestGeorgeStaleTool:
    def test_george_routes_stale_replies_question(self, token, mongo_stale):
        out = _chat(token, "Any stale replies I should look at?")
        tools = [t.get("name") for t in out["tools"]]
        print("\n[stale] reply:", out["reply"])
        print("[stale] tools:", tools)
        assert "list_stale_replies" in tools, (
            f"expected list_stale_replies in tools, got {tools}"
        )
        # Must not auto-send anything — reply is a gentle nudge.
        low = out["reply"].lower()
        assert not any(k in low for k in [
            "i've sent", "i just sent", "email sent", "outbound reply sent",
        ]), f"reply implies auto-send: {out['reply']}"
        # Should offer to open the Replies inbox (matching Mission
        # Control surface).
        assert "replies" in low, f"reply should mention Replies inbox: {out['reply']}"

    def test_george_names_oldest_and_days(self, token, mongo_stale):
        out = _chat(token, "Any unanswered replies sitting for a week?")
        reply = out["reply"]
        low = reply.lower()
        print("\n[stale-names] reply:", reply)
        # Oldest is Priya — she should be named.
        assert "priya" in low, f"expected Priya in reply: {reply}"
