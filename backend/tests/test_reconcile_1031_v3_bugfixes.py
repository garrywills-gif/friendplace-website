"""FriendPlace 1031 real-device bug fixes — backend verification.

Covers:
  - Issue 3+8: George/Georgia companion identity + name + memory
  - Issue 4: Event creation with locality + venue (geocoded)
  - Issue 2 support: /api/suburbs/search returns matches with lat/lng
"""
import os
import re
import time
import uuid
import requests
import pytest

# conftest sets a stale default; force to the current preview URL
BASE_URL = "https://outreach-campaigns.preview.emergentagent.com"
API = f"{BASE_URL}/api"

MEMBER_EMAIL = "member@friendplace.com.au"
MEMBER_PWD = "TestPass2026!"


@pytest.fixture(scope="module")
def member_token():
    r = requests.post(f"{API}/auth/login", json={"username": MEMBER_EMAIL, "password": MEMBER_PWD}, timeout=15)
    assert r.status_code == 200, f"member login failed: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def member_id(member_token):
    r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {member_token}"}, timeout=10)
    assert r.status_code == 200
    return r.json().get("id") or r.json().get("_id")


# ---------------- Issue 2 support: suburb search returns lat/lng ----------------

class TestSuburbSearch:
    def test_search_melb_returns_matches_with_coords(self):
        r = requests.get(f"{API}/suburbs/search", params={"q": "Melb"}, timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        results = data.get("results") or []
        assert len(results) > 0, "expected some results for 'Melb'"
        first = results[0]
        assert "name" in first and "postcode" in first and "state" in first
        # lat/lng should be present so SuburbField can seed radius searches
        assert "lat" in first and "lng" in first, f"missing lat/lng: {first}"


# ---------------- Issue 3+8: George/Georgia companion identity ----------------

class TestCompanionPersonas:
    def _headers(self, tok):
        return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}

    def test_companion_get_george(self, member_token):
        r = requests.get(f"{API}/mcgs/george/companion", params={"persona": "george"},
                         headers=self._headers(member_token), timeout=15)
        assert r.status_code == 200, r.text

    def test_companion_get_georgia(self, member_token):
        r = requests.get(f"{API}/mcgs/george/companion", params={"persona": "georgia"},
                         headers=self._headers(member_token), timeout=15)
        assert r.status_code == 200, r.text

    def test_reset_then_turn_george_says_george(self, member_token):
        # Reset first
        r = requests.post(f"{API}/mcgs/george/companion/reset",
                          json={"persona": "george"},
                          headers=self._headers(member_token), timeout=20)
        assert r.status_code == 200
        # Ask who are you
        r = requests.post(
            f"{API}/mcgs/george/companion/turn",
            json={"text": "What is your name?", "persona": "george"},
            headers=self._headers(member_token), timeout=45,
        )
        assert r.status_code == 200, r.text
        msg = (r.json().get("message") or "").lower()
        assert "george" in msg, f"George didn't identify as George: {msg!r}"
        assert "georgia" not in msg, f"George leaked Georgia identity: {msg!r}"

    def test_reset_then_turn_georgia_says_georgia(self, member_token):
        r = requests.post(f"{API}/mcgs/george/companion/reset",
                          json={"persona": "georgia"},
                          headers=self._headers(member_token), timeout=20)
        assert r.status_code == 200
        r = requests.post(
            f"{API}/mcgs/george/companion/turn",
            json={"text": "What is your name?", "persona": "georgia"},
            headers=self._headers(member_token), timeout=45,
        )
        assert r.status_code == 200, r.text
        msg = (r.json().get("message") or "").lower()
        assert "georgia" in msg, f"Georgia didn't identify as Georgia: {msg!r}"
        # ensure it's not saying "I'm George" (word-boundary check — "georgia" contains "george")
        assert not re.search(r"\bi'?m george\b", msg), f"Georgia leaked George identity: {msg!r}"
        assert not re.search(r"\bi am george\b", msg), f"Georgia leaked George identity: {msg!r}"

    def test_sessions_are_per_persona(self, member_token):
        """George session and Georgia session are independent."""
        g1 = requests.get(f"{API}/mcgs/george/companion", params={"persona": "george"},
                          headers=self._headers(member_token), timeout=15).json()
        g2 = requests.get(f"{API}/mcgs/george/companion", params={"persona": "georgia"},
                          headers=self._headers(member_token), timeout=15).json()
        # Whatever the exact shape, the two personas must give distinct payloads or per-persona ids
        sid1 = g1.get("session_id") or g1.get("id") or g1.get("persona")
        sid2 = g2.get("session_id") or g2.get("id") or g2.get("persona")
        # If both have identical session ids that's a bug; personas differ.
        assert (g1 != g2) or (sid1 != sid2), "george and georgia return identical session payload — sessions should be per-persona"


# ---------------- Issue 4: Event create with locality + venue ----------------

class TestEventLocalityVenue:
    _created_ids: list = []

    def test_create_event_with_locality_and_venue(self, member_token, member_id):
        headers = {"Authorization": f"Bearer {member_token}", "Content-Type": "application/json"}
        payload = {
            "title": f"TEST_evt_{uuid.uuid4().hex[:6]} community walk",
            "emoji": "🚶",
            "description": "Testing locality/venue capture",
            "location": "Cafe Belong, level 1",  # venue text
            "locality": "Melbourne",
            "locality_state": "VIC",
            "locality_postcode": "3000",
            "locality_lat": -37.8136,
            "locality_lng": 144.9631,
            "date": "2026-12-31",
            "time": "10:30",
            "host_id": member_id,
        }
        r = requests.post(f"{API}/events", json=payload, headers=headers, timeout=15)
        assert r.status_code in (200, 201), f"create event failed: {r.status_code} {r.text[:400]}"
        body = r.json()
        eid = body.get("id") or body.get("_id") or body.get("event_id")
        assert eid, f"no id in create response: {body}"
        self.__class__._created_ids.append(eid)

        # locality coords stamped
        assert body.get("locality_lat") is not None, f"missing locality_lat in created event: {body}"
        assert body.get("locality_lng") is not None, f"missing locality_lng in created event: {body}"
        # venue stored (server may use location or venue field)
        v = body.get("location") or body.get("venue")
        assert v and "Cafe Belong" in v, f"venue not persisted: {body}"

    def test_create_event_missing_title_backend_permissive(self, member_token, member_id):
        """Informational — backend currently accepts empty title (frontend
        must validate per Issue 5). Documents this behaviour so future
        contract-tightening can find it."""
        headers = {"Authorization": f"Bearer {member_token}", "Content-Type": "application/json"}
        payload = {"title": "", "date": "2026-12-31", "time": "10:30", "host_id": member_id}
        r = requests.post(f"{API}/events", json=payload, headers=headers, timeout=10)
        # Currently permissive — frontend enforces required title (Issue 5).
        # If backend later rejects it (400/422) the assertion just needs an update.
        assert r.status_code in (200, 201, 400, 422), r.status_code

    @classmethod
    def teardown_class(cls):
        # best-effort cleanup — API may not expose delete; ignore failures
        for eid in cls._created_ids:
            try:
                requests.delete(f"{API}/events/{eid}", timeout=5)
            except Exception:
                pass
