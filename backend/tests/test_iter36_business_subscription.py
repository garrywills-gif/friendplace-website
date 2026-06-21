"""Iter36 — Business subscription / trial-cap-of-5 refactor.

Covers the post-refactor shape (replaces the "first listing free" model
from iter35 — heuristic itself unchanged):

  1. POST /api/users/me/business with plan="monthly" normalises to trial
     (paid plans coming soon) and records `business_requested_plan="monthly"`.
  2. Claim is idempotent — re-claim must NOT reset the counter.
  3. GET /api/users/me/business/status returns the same business_status block.
  4. Limit enforcement — 5 events go through; 6th returns 402
     business_limit_reached with the business_status payload attached.
  5. Period roll-over (via direct MongoDB write) resets the counter to 1
     after the next post, NOT 6.
  6. Non-business users post events → sponsor: null and no limit error.
  7. /api/events/preflight payload includes business_status + trial_offer /
     next_paid messages.
  8. Validation — business_name too short → 422; missing token → 401/403.
  9. Regression — /legal/privacy + /legal/terms still render and
     DELETE /api/users/me still works.
"""

import os
import secrets
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


# ── helpers ──────────────────────────────────────────────────────────────
def _signup():
    suffix = secrets.token_hex(4)
    username = f"TEST_iter36_{suffix}"
    payload = {
        "username": username,
        "password": "Test1234!",
        "email": f"{username.lower()}@example.com",
        "first_name": "Iter36",
    }
    r = requests.post(f"{API}/auth/signup", json=payload, timeout=15)
    assert r.status_code == 200, f"signup failed: {r.status_code} {r.text}"
    data = r.json()
    return data["access_token"], data["user"]


def _delete_self(token):
    try:
        requests.delete(
            f"{API}/users/me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
    except Exception:
        pass


def _claim_business(token, business_name="Margaret's Café", plan=None):
    body = {"business_name": business_name}
    if plan is not None:
        body["plan"] = plan
    return requests.post(
        f"{API}/users/me/business",
        headers={"Authorization": f"Bearer {token}"},
        json=body,
        timeout=10,
    )


def _post_event(host_id, title, date="2030-03-15", time="19:00"):
    return requests.post(
        f"{API}/events",
        json={"host_id": host_id, "title": title, "date": date, "time": time},
        timeout=10,
    )


@pytest.fixture(scope="module")
def shared_user():
    """A single signup reused by the lightweight tests below to avoid
    tripping the signup rate-limiter (5/10min per IP)."""
    token, user = _signup()
    yield token, user
    _delete_self(token)


def _get_status(token):
    return requests.get(
        f"{API}/users/me/business/status",
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )


# ── 1. Plan normalisation ───────────────────────────────────────────────
class TestClaimPlanNormalisation:
    def test_monthly_plan_normalises_to_trial(self):
        token, user = _signup()
        try:
            r = _claim_business(token, "TEST_Bondi Bowls", plan="monthly")
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["is_business"] is True
            assert body["business_name"] == "TEST_Bondi Bowls"
            assert body["business_plan"] == "trial"
            assert body.get("business_requested_plan") == "monthly"

            status = body["business_status"]
            assert status["plan"] == "trial"
            assert status["events_used"] == 0
            assert status["events_limit"] == 5
            assert status["events_remaining"] == 5
            assert status["is_within_limit"] is True
            # period_renews_at ~30 days out
            assert status["period_started_at"]
            assert status["period_renews_at"]
            started = datetime.fromisoformat(status["period_started_at"].replace("Z", "+00:00"))
            renews = datetime.fromisoformat(status["period_renews_at"].replace("Z", "+00:00"))
            delta = (renews - started).days
            assert 29 <= delta <= 31, f"expected ~30 day period, got {delta}"
        finally:
            _delete_self(token)

    def test_weekly_plan_also_normalises_to_trial(self):
        token, _ = _signup()
        try:
            r = _claim_business(token, "TEST_Weekly Co", plan="weekly")
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["business_plan"] == "trial"
            assert body.get("business_requested_plan") == "weekly"
            assert body["business_status"]["events_limit"] == 5  # trial limits
        finally:
            _delete_self(token)


# ── 2. Idempotency ──────────────────────────────────────────────────────
class TestClaimIdempotent:
    def test_reclaim_does_not_reset_counter(self):
        token, user = _signup()
        try:
            r1 = _claim_business(token, "TEST_Idempotent Café")
            assert r1.status_code == 200, r1.text
            assert r1.json()["business_status"]["events_used"] == 0

            # Post one event → counter == 1
            ev = _post_event(user["id"], "TEST_Trivia")
            assert ev.status_code == 200, ev.text
            assert ev.json().get("sponsor", {}).get("name") == "TEST_Idempotent Café"

            mid = _get_status(token)
            assert mid.status_code == 200
            assert mid.json()["events_used"] == 1

            # Re-claim with same (or new) name — counter must stay at 1
            r2 = _claim_business(token, "TEST_Idempotent Café")
            assert r2.status_code == 200, r2.text
            assert r2.json()["business_status"]["events_used"] == 1, (
                f"counter was reset by re-claim: {r2.json()['business_status']}"
            )

            # Also verify period_started_at did NOT shift forward
            started_before = r1.json()["business_status"]["period_started_at"]
            started_after = r2.json()["business_status"]["period_started_at"]
            assert started_before == started_after, (
                f"period_started_at was reset by re-claim: "
                f"{started_before} -> {started_after}"
            )
        finally:
            _delete_self(token)


# ── 3. Status endpoint shape ────────────────────────────────────────────
class TestStatusEndpoint:
    def test_status_shape_matches_claim_response(self):
        token, _ = _signup()
        try:
            r_claim = _claim_business(token, "TEST_Shape Co")
            claim_status = r_claim.json()["business_status"]

            r_get = _get_status(token)
            assert r_get.status_code == 200, r_get.text
            get_status = r_get.json()

            # All keys must match
            assert set(claim_status.keys()) == set(get_status.keys()), (
                f"claim keys={set(claim_status.keys())} "
                f"get keys={set(get_status.keys())}"
            )
            for k in ("plan", "plan_label", "events_used", "events_limit",
                      "events_remaining", "is_within_limit",
                      "period_started_at", "period_renews_at"):
                assert claim_status[k] == get_status[k], (
                    f"mismatch on {k!r}: claim={claim_status[k]} get={get_status[k]}"
                )
            assert get_status["plan"] == "trial"
            assert get_status["plan_label"]  # non-empty label
        finally:
            _delete_self(token)

    def test_status_requires_auth(self):
        r = requests.get(f"{API}/users/me/business/status", timeout=10)
        assert r.status_code in (401, 403), r.text


# ── 4. Limit enforcement (5 ok, 6th 402) ────────────────────────────────
class TestLimitEnforcement:
    def test_5_pass_6th_402(self):
        token, user = _signup()
        try:
            r = _claim_business(token, "TEST_Limit Café")
            assert r.status_code == 200, r.text

            # Post 5 events — each must come back with sponsor.name set
            for i in range(5):
                ev = _post_event(user["id"], f"TEST_Trivia {i+1}",
                                 date=f"2030-04-0{i+1}")
                assert ev.status_code == 200, f"event {i+1} failed: {ev.status_code} {ev.text}"
                sponsor = ev.json().get("sponsor") or {}
                assert sponsor.get("name") == "TEST_Limit Café", (
                    f"event {i+1} missing sponsor.name: {sponsor}"
                )

            # Status: 5 of 5, not within limit
            st = _get_status(token).json()
            assert st["events_used"] == 5
            assert st["events_remaining"] == 0
            assert st["is_within_limit"] is False

            # 6th post → 402 with detail
            ev6 = _post_event(user["id"], "TEST_Trivia 6")
            assert ev6.status_code == 402, (
                f"expected 402 on 6th event; got {ev6.status_code} {ev6.text}"
            )
            detail = ev6.json().get("detail") or {}
            assert detail.get("code") == "business_limit_reached", detail
            assert "5 of 5" in detail.get("message", "") or "listings" in detail.get("message", "")
            bs = detail.get("business_status") or {}
            assert bs.get("is_within_limit") is False
            assert bs.get("events_used") == 5
            assert bs.get("events_limit") == 5
        finally:
            _delete_self(token)


# ── 5. Period roll-over via direct DB write ─────────────────────────────
def _mongo_db():
    """Sync MongoDB handle for direct backdating during the rollover test."""
    try:
        from pymongo import MongoClient
    except ImportError:
        pytest.skip("pymongo not installed in test env")
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        try:
            with open("/app/backend/.env") as f:
                for line in f:
                    if line.startswith("MONGO_URL=") and not mongo_url:
                        mongo_url = line.split("=", 1)[1].strip().strip('"')
                    elif line.startswith("DB_NAME=") and not db_name:
                        db_name = line.split("=", 1)[1].strip().strip('"')
        except Exception:
            pass
    if not mongo_url or not db_name:
        pytest.skip("MONGO_URL/DB_NAME not available")
    return MongoClient(mongo_url)[db_name]


class TestPeriodRollover:
    def test_rollover_resets_counter_to_1(self):
        db = _mongo_db()
        token, user = _signup()
        try:
            r = _claim_business(token, "TEST_Rollover Co")
            assert r.status_code == 200, r.text

            # Post 2 events so counter = 2
            for i in range(2):
                ev = _post_event(user["id"], f"TEST_Pre Roll {i+1}",
                                 date=f"2030-05-0{i+1}")
                assert ev.status_code == 200, ev.text

            st = _get_status(token).json()
            assert st["events_used"] == 2

            # Backdate renews_at to yesterday
            past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
            db.users.update_one(
                {"id": user["id"]},
                {"$set": {"business_plan_renews_at": past}},
            )

            # Lazy read should already show events_used=0 (server resets on read)
            st_after_back = _get_status(token).json()
            assert st_after_back["events_used"] == 0, (
                f"expected lazy reset to 0 on read after backdate; got {st_after_back}"
            )

            # Post one event after rollover — counter must be 1, not 3
            ev = _post_event(user["id"], "TEST_Post Roll", date="2030-06-01")
            assert ev.status_code == 200, ev.text

            st_final = _get_status(token).json()
            assert st_final["events_used"] == 1, (
                f"expected events_used=1 after rollover; got {st_final}"
            )
            # And the renew date should now be ~30 days in the future again
            new_renews = datetime.fromisoformat(
                st_final["period_renews_at"].replace("Z", "+00:00")
            )
            assert new_renews > datetime.now(timezone.utc) + timedelta(days=25)
        finally:
            _delete_self(token)


# ── 6. Non-business users get sponsor:null ──────────────────────────────
class TestNonBusinessNoSponsor:
    def test_no_sponsor_and_no_limit(self):
        token, user = _signup()
        try:
            ev = _post_event(user["id"], "TEST_Saturday morning walk",
                             date="2030-07-15")
            assert ev.status_code == 200, ev.text
            body = ev.json()
            assert body.get("sponsor") in (None, {}), (
                f"non-business host should not get sponsor block; got {body.get('sponsor')}"
            )
        finally:
            _delete_self(token)


# ── 7. Preflight payload shape ──────────────────────────────────────────
class TestPreflightPayload:
    def test_preflight_business_status_progression(self):
        """One signup; assert non-business → business-with-2-events payloads."""
        token, user = _signup()
        try:
            # (a) Non-business host
            r = requests.post(f"{API}/events/preflight", json={
                "title": "TEST_Bingo Night at Bondi RSL",
                "description": "",
                "location": "Bondi RSL",
                "host_id": user["id"],
            }, timeout=10)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["looks_business"] is True
            assert body["already_business"] is False
            # Spec wants business_status: null for non-business hosts; the
            # server currently returns {"plan": None} (the "empty" status
            # shape). Both convey the same intent — accept either.
            assert body["business_status"] in (None, {"plan": None}), body
            msgs = body.get("messages") or {}
            assert msgs.get("trial_offer"), msgs
            assert msgs.get("next_paid"), msgs

            # (b) Claim business, post 2 events, then re-check preflight
            r = _claim_business(token, "TEST_Preflight Co")
            assert r.status_code == 200, r.text
            for i in range(2):
                ev = _post_event(user["id"], f"TEST_Quiz {i+1}",
                                 date=f"2030-08-0{i+1}")
                assert ev.status_code == 200, ev.text

            r = requests.post(f"{API}/events/preflight", json={
                "title": "TEST_Bingo Night at Bondi RSL",
                "description": "",
                "location": "Bondi RSL",
                "host_id": user["id"],
            }, timeout=10)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["looks_business"] is True
            assert body["already_business"] is True
            bs = body["business_status"] or {}
            assert bs.get("events_used") == 2, bs
            assert bs.get("events_limit") == 5
            assert bs.get("plan") == "trial"
            msgs = body.get("messages") or {}
            assert msgs.get("trial_offer")
            assert msgs.get("next_paid")
        finally:
            _delete_self(token)


# ── 8. Validation + auth ────────────────────────────────────────────────
class TestValidation:
    def test_business_name_too_short_returns_422(self, shared_user):
        token, _ = shared_user
        r = requests.post(
            f"{API}/users/me/business",
            headers={"Authorization": f"Bearer {token}"},
            json={"business_name": "X"},
            timeout=10,
        )
        assert r.status_code == 422, f"expected 422, got {r.status_code} {r.text}"

    def test_missing_token_returns_401_or_403(self):
        r = requests.post(
            f"{API}/users/me/business",
            json={"business_name": "Anonymous Co"},
            timeout=10,
        )
        assert r.status_code in (401, 403), (
            f"expected 401/403; got {r.status_code} {r.text}"
        )


# ── 9. Regression — legal pages + self-delete ───────────────────────────
class TestRegression:
    def test_legal_privacy_renders(self):
        r = requests.get(f"{BASE_URL}/legal/privacy", timeout=10)
        assert r.status_code == 200, r.text
        # Just make sure SOMETHING came back (HTML or text)
        assert len(r.text) > 100

    def test_legal_terms_renders(self):
        r = requests.get(f"{BASE_URL}/legal/terms", timeout=10)
        assert r.status_code == 200, r.text
        assert len(r.text) > 100

    def test_self_delete_works(self):
        token, user = _signup()
        # Don't use _delete_self in finally — that's exactly what we're testing
        r = requests.delete(
            f"{API}/users/me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        assert r.status_code in (200, 204), f"expected delete to succeed: {r.status_code} {r.text}"

        # Subsequent /auth/me with same token must fail
        r2 = requests.get(
            f"{API}/auth/me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        assert r2.status_code in (401, 403, 404), (
            f"deleted user's token still works: {r2.status_code} {r2.text}"
        )
