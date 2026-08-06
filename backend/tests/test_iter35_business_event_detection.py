"""Iter35 — Business event detection + first listing free.

Coverage:
  • /api/events/preflight heuristic (positive + negative cases)
  • /api/users/me/business auth + validation + idempotency
  • create_event auto-attaches sponsor block for business hosts
  • business_free_listing_used flips to True on the first sponsored event
  • Non-business hosts do NOT get a sponsor block
"""

import os
import secrets
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


# ── helpers ──────────────────────────────────────────────────────────────
def _signup():
    """Create a fresh real user. Returns (token, user dict)."""
    suffix = secrets.token_hex(4)
    username = f"TEST_iter35_{suffix}"
    payload = {
        "username": username,
        "password": "Test1234!",
        "email": f"{username.lower()}@example.com",
        "first_name": "Iter35",
    }
    r = requests.post(f"{API}/auth/signup", json=payload, timeout=15)
    assert r.status_code == 200, f"signup failed: {r.status_code} {r.text}"
    data = r.json()
    return data["access_token"], data["user"]


def _delete_self(token):
    """Best-effort cleanup."""
    try:
        requests.delete(
            f"{API}/users/me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
    except Exception:
        pass


# ── 1. Heuristic positive cases ──────────────────────────────────────────
class TestPreflightPositive:
    @pytest.mark.parametrize("payload,expected_substrings", [
        (
            {"title": "Friday Trivia at the Bondi RSL", "description": "",
             "location": "Bondi RSL"},
            ["rsl"],
        ),
        (
            {"title": "Bowling Club Wednesday Bingo", "description": "",
             "location": "Manly Bowls Club"},
            ["bowls club"],  # or "bowling club"
        ),
        (
            {"title": "Yoga class — $15 per person",
             "description": "Limited spots — book at www.example.com",
             "location": "Yoga Studio"},
            None,  # checked separately — we want multiple reasons
        ),
        (
            {"title": "Sunday roast deal — $25",
             "description": "Book on 1300 555 666 — limited tickets",
             "location": ""},
            None,
        ),
    ])
    def test_positive_detection(self, payload, expected_substrings):
        r = requests.post(f"{API}/events/preflight", json=payload, timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["looks_business"] is True, (
            f"expected looks_business=True for {payload}; got {body}"
        )
        assert body["score"] >= 2, body
        assert isinstance(body["reasons"], list) and body["reasons"]
        if expected_substrings:
            joined = " | ".join(body["reasons"]).lower()
            for sub in expected_substrings:
                assert sub in joined, (
                    f"expected reason to mention {sub!r}; reasons={body['reasons']}"
                )

    def test_yoga_studio_multiple_reasons(self):
        """The yoga case should trip multiple buckets."""
        r = requests.post(f"{API}/events/preflight", json={
            "title": "Yoga class — $15 per person",
            "description": "Limited spots — book at www.example.com",
            "location": "Yoga Studio",
        }, timeout=10)
        body = r.json()
        # business noun (yoga studio) + pricing ($15) + booking lang (limited spots)
        # + link (www.example.com) => score should be ≥ 4 (no club bucket)
        assert body["score"] >= 3, body
        assert len(body["reasons"]) >= 3, body["reasons"]

    def test_sunday_roast_phone_and_pricing(self):
        r = requests.post(f"{API}/events/preflight", json={
            "title": "Sunday roast deal — $25",
            "description": "Book on 1300 555 666 — limited tickets",
            "location": "",
        }, timeout=10)
        body = r.json()
        joined = " | ".join(body["reasons"]).lower()
        assert "pricing" in joined or "$" in joined or "dollar" in joined, body
        assert "1300" in joined or "phone" in joined, body


# ── 2. Heuristic negative cases ──────────────────────────────────────────
class TestPreflightNegative:
    @pytest.mark.parametrize("payload", [
        {"title": "Saturday morning walk", "description": "",
         "location": "Centennial Park"},
        {"title": "Birthday morning tea",
         "description": "Bring a plate to share", "location": ""},
        {"title": "Friday Coffee Morning", "description": "", "location": ""},
    ])
    def test_negative_detection(self, payload):
        r = requests.post(f"{API}/events/preflight", json=payload, timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["looks_business"] is False, (
            f"expected looks_business=False for {payload}; got {body}"
        )
        assert body["score"] < 2, body


# ── 3. Claim-business + already-business preflight path ──────────────────
class TestClaimBusiness:
    def test_claim_business_and_preflight_already_business(self):
        token, user = _signup()
        try:
            # baseline preflight (host_id passed) should show already_business=false
            r0 = requests.post(f"{API}/events/preflight", json={
                "title": "Friday Trivia at the Bondi RSL",
                "description": "",
                "location": "Bondi RSL",
                "host_id": user["id"],
            }, timeout=10)
            assert r0.status_code == 200
            assert r0.json()["already_business"] is False
            # Note: iter35 originally exposed a flat `free_listing_used`
            # boolean on the preflight response. That was folded into the
            # richer `business_status` object in a later iteration
            # (business_plan / period counts sit there now). The
            # equivalent iter35 assertion is "the user is not on a
            # business plan yet", which is implied by
            # already_business=False on a brand-new signup.

            # claim business — first-time claim now requires a contact
            # name + email so ops can reach a human (added post-iter35).
            r = requests.post(
                f"{API}/users/me/business",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "business_name": "Margaret's Café",
                    "contact_name": "Margaret Test",
                    "contact_email": "margaret+iter35@friendplace-tests.com",
                },
                timeout=10,
            )
            assert r.status_code == 200, r.text
            updated = r.json()
            assert updated["is_business"] is True
            assert updated["business_name"] == "Margaret's Café"
            assert updated.get("business_free_listing_used", False) is False

            # idempotent — call again with same name (contact_* omitted
            # is fine for repeat claims; the endpoint only enforces
            # first-claim capture)
            r2 = requests.post(
                f"{API}/users/me/business",
                headers={"Authorization": f"Bearer {token}"},
                json={"business_name": "Margaret's Café"},
                timeout=10,
            )
            assert r2.status_code == 200
            assert r2.json()["is_business"] is True

            # preflight on the same business-y title now flips already_business
            r3 = requests.post(f"{API}/events/preflight", json={
                "title": "Friday Trivia at the Bondi RSL",
                "description": "",
                "location": "Bondi RSL",
                "host_id": user["id"],
            }, timeout=10)
            assert r3.status_code == 200
            body = r3.json()
            assert body["looks_business"] is True
            assert body["already_business"] is True
            # (free_listing_used field replaced by business_status object —
            # see the note in test_claim_business_and_preflight_already_business.)
        finally:
            _delete_self(token)

    def test_claim_business_too_short_returns_422(self):
        token, _ = _signup()
        try:
            r = requests.post(
                f"{API}/users/me/business",
                headers={"Authorization": f"Bearer {token}"},
                json={"business_name": "A"},
                timeout=10,
            )
            assert r.status_code == 422, f"expected 422, got {r.status_code} {r.text}"
        finally:
            _delete_self(token)

    def test_claim_business_requires_auth(self):
        r = requests.post(
            f"{API}/users/me/business",
            json={"business_name": "Anonymous Co."},
            timeout=10,
        )
        assert r.status_code in (401, 403), (
            f"expected 401/403 for unauthenticated claim; got {r.status_code} {r.text}"
        )


# ── 4 + 5. Sponsor block auto-attach (first + second event) ──────────────
class TestSponsorAutoAttach:
    def test_first_and_second_sponsored_events(self):
        token, user = _signup()
        try:
            # claim business — first-time claim now requires a contact
            # name + email so ops can reach a human (added post-iter35).
            r = requests.post(
                f"{API}/users/me/business",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "business_name": "Margaret's Café",
                    "contact_name": "Margaret Test",
                    "contact_email": "margaret+sponsor@friendplace-tests.com",
                },
                timeout=10,
            )
            assert r.status_code == 200, r.text

            # confirm free_listing_used is still False before any event.
            # `GET /users/{id}` now requires auth (SEC-002); as the
            # owner we get the full safe projection including
            # business_free_listing_used.
            hdr = {"Authorization": f"Bearer {token}"}
            r_pre = requests.get(f"{API}/users/{user['id']}", headers=hdr, timeout=10)
            assert r_pre.status_code == 200
            assert r_pre.json().get("business_free_listing_used", False) is False

            # FIRST event
            ev1 = requests.post(f"{API}/events", json={
                "host_id": user["id"],
                "title": "Trivia Night",
                "date": "2030-01-15",
                "time": "19:00",
            }, timeout=10)
            assert ev1.status_code == 200, ev1.text
            ev1_body = ev1.json()
            assert isinstance(ev1_body.get("sponsor"), dict), (
                f"expected sponsor dict on first event; got {ev1_body.get('sponsor')}"
            )
            assert ev1_body["sponsor"]["name"] == "Margaret's Café"
            assert ev1_body["sponsor"]["message"] == ""
            assert ev1_body["sponsor"]["discount_code"] == ""

            # verify the sponsored-event counter advanced. iter35
            # tracked this via a `business_free_listing_used` boolean;
            # post-iter35 the API records a numeric
            # `business_events_this_period` counter instead (per-period,
            # not one-shot), so we assert on the current field.
            r_post = requests.get(f"{API}/users/{user['id']}", headers=hdr, timeout=10)
            assert r_post.status_code == 200
            assert int(r_post.json().get("business_events_this_period") or 0) >= 1, r_post.json()

            # SECOND event — sponsor still attached
            ev2 = requests.post(f"{API}/events", json={
                "host_id": user["id"],
                "title": "Saturday Open Mic",
                "date": "2030-01-22",
                "time": "20:00",
            }, timeout=10)
            assert ev2.status_code == 200, ev2.text
            ev2_body = ev2.json()
            assert isinstance(ev2_body.get("sponsor"), dict), ev2_body
            assert ev2_body["sponsor"]["name"] == "Margaret's Café"
        finally:
            _delete_self(token)


# ── 6. Non-business users don't get a sponsor block ──────────────────────
class TestNonBusinessNoSponsor:
    def test_no_sponsor_for_normal_user(self):
        token, user = _signup()
        try:
            ev = requests.post(f"{API}/events", json={
                "host_id": user["id"],
                "title": "Saturday morning walk",
                "date": "2030-02-01",
                "time": "09:00",
            }, timeout=10)
            assert ev.status_code == 200, ev.text
            body = ev.json()
            assert body.get("sponsor") in (None, {}), (
                f"non-business host should not get a sponsor block; got {body.get('sponsor')}"
            )
        finally:
            _delete_self(token)
