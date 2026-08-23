"""iter164e — George Bug 2 behavior tests (operational richness + contextual nav).

Prompts hit `/api/george/chat` (SSE) with the CMS admin JWT.
"""

import json
import os
import re
import requests
import pytest

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "http://localhost:8001").rstrip("/")
ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASS = "TestPass2026!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/cms/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _chat(token, message, chat_id=None, surface_context=None):
    payload = {"message": message, "scope": "mcgs"}
    if chat_id:
        payload["chat_id"] = chat_id
    if surface_context is not None:
        payload["surface_context"] = surface_context
    reply_parts = []
    navigate_paths = []
    got_chat_id = chat_id
    tools = []
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
                if current_event == "session":
                    got_chat_id = data.get("chat_id") or got_chat_id
                elif current_event == "delta":
                    reply_parts.append(data.get("text") or "")
                elif current_event == "navigate":
                    if data.get("path"):
                        navigate_paths.append(data["path"])
                elif current_event == "tools":
                    tools.extend(data.get("results") or [])
    return {
        "reply": "".join(reply_parts),
        "chat_id": got_chat_id,
        "navigate_paths": navigate_paths,
        "tools": tools,
    }


NAV_OFFER_RX = re.compile(
    r"(would you like|want me to|shall i|should i)\s+"
    r"(me to\s+)?(open|jump to|take you|show you|bring up|pull up)",
    re.IGNORECASE,
)


class TestBug2GeorgeBehavior:
    _b1_reply = None

    def test_b1_registrations_overnight_has_headline_and_detail(self, token):
        out = _chat(token, "Any new registrations overnight?")
        reply = out["reply"]
        print("\n[B1] reply:\n", reply)
        assert reply, "no reply"
        TestBug2GeorgeBehavior._b1_reply = reply
        low = reply.lower()
        # headline count present (either a digit, a spelled number, or "nothing new" style)
        has_headline = bool(
            re.search(
                r"\b(\d+|no one|nobody|no new|nothing new|none|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b",
                low,
            )
        )
        assert has_headline, f"missing headline count/nothing-new phrasing: {reply}"

        # If there ARE registrations (>0), we expect the latest name AND a time reference
        # Time-hint tokens (relative or absolute) — 'overnight' counts.
        time_hint = bool(
            re.search(
                r"(overnight|ago|yesterday|last night|this morning|earlier|"
                r"just after|about \d|around \d|\d+\s*(minute|hour|hr|min)s?\s*ago|"
                r"\d{1,2}(:\d{2})?\s*(am|pm)|evening|afternoon|morning)",
                low,
            )
        )
        # Only seeded first names count as "latest name" — Garry is
        # George's addressee, not a registration.
        has_name = bool(re.search(r"\b(Priya|Mateo)\b", reply))

        says_none = bool(re.search(r"(no one|nobody|nothing new|no new|none registered|none overnight|zero)", low))
        if not says_none:
            # Time hint must be present (soft — we merely warn if name missing)
            assert time_hint, f"expected a time reference in reply: {reply}"
            if not has_name:
                pytest.fail(
                    "B1: reply includes a count and time reference but NO latest "
                    "person name (seeded 'Priya' / 'Mateo' expected). Reply: "
                    + repr(reply)
                )

    def test_b2_registrations_nav_offer_present(self, token):
        """iter164e spec: B1's reply MAY already carry the nav offer.
        Check B1's captured reply first; if absent, ask a follow-up."""
        reply = TestBug2GeorgeBehavior._b1_reply or ""
        if not (NAV_OFFER_RX.search(reply) and "founding member" in reply.lower()):
            # Fall back to a fresh, phrased-differently registrations Q.
            out = _chat(token, "Give me a rundown on Founding Member registrations.")
            reply = out["reply"]
        print("\n[B2] reply:\n", reply)
        low = reply.lower()
        offer_match = NAV_OFFER_RX.search(reply)
        surface_named = "founding member" in low or "founding-member" in low
        opens_now = bool(
            re.search(r"(opening|taking you|jumping to|bringing up)\s+the\s+founding", low)
        )
        assert (offer_match and surface_named) or opens_now, (
            f"expected contextual Founding Members nav offer, got: {reply}"
        )

    def test_b3_casual_chat_short_no_nav(self, token):
        out = _chat(token, "Morning George")
        reply = out["reply"]
        print("\n[B3] reply:\n", reply)
        # Casual chat should be short-ish (fewer than 400 chars typical)
        assert 0 < len(reply) < 500, f"casual reply too long: {len(reply)} chars — {reply}"
        # And NO nav offer to a Mission Control surface
        low = reply.lower()
        forbidden_surfaces = [
            "founding member",
            "bridge",
            "campaigns page",
            "system health dashboard",
            "flyer publishing centre",
        ]
        for s in forbidden_surfaces:
            assert s not in low, f"casual reply mentions surface '{s}': {reply}"

    def test_b4_no_matching_surface_no_nav(self, token):
        out = _chat(token, "Is Garry the founder of FriendPlace?")
        reply = out["reply"]
        print("\n[B4] reply:\n", reply)
        low = reply.lower()
        # No offer to open a page for a philosophical/factual question
        assert not NAV_OFFER_RX.search(reply), f"unexpected nav offer for factual q: {reply}"
        # Sanity — offers with 'open the X page' phrasing also absent
        assert not re.search(r"open the .+? page", low), f"unexpected open-page offer: {reply}"

    def test_b5_grounded_numbers_weaved(self, token):
        # Same as B1 but check number weaving stays sentence-like.
        out = _chat(token, "How many registrations came in yesterday?")
        reply = out["reply"]
        print("\n[B5] reply:\n", reply)
        # No template-y bulleted number cards
        assert "\n- " not in reply or reply.count("\n- ") <= 2, (
            f"looks bloated / template-style: {reply}"
        )
        # No formal 'Confidence: high' / 'Sources:' labels
        low = reply.lower()
        for tag in ["confidence: high", "confidence: moderate", "sources:", "what:", "why:"]:
            assert tag not in low, f"template-style label '{tag}' present: {reply}"
