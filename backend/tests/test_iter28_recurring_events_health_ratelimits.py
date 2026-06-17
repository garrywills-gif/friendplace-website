"""Iter 28 — Recurring Events + /api/health + sliding-window rate limits.

Covers:
  * Recurring event creation (weekly / fortnightly / monthly with end-of-month
    clamp) — confirms master + N children share series_id, master has
    series_master=True, children False, and series_event_ids length matches.
  * One-off event regression — recurrence omitted → exactly 1 stored event,
    null recurrence/series_id/series_master False.
  * recurrence_count cap (>25 → clamped to 25, total ≤ 26).
  * GET /api/events surfaces recurrence field on children.
  * GET /api/health returns ok / db up.
  * Rate limits — notices 6/hr, flutters 20/hr, reports 10/hr, events 8/hr —
    each verified at the boundary (N pass, N+1 returns 429 with Retry-After).
    Rate-limit buckets are in-process, so we either use unique identifiers
    per test (notices/reports) or restart the backend immediately before the
    test (events/flutters which need a real existing user).
  * Existing RSVP + PATCH host-edit flows still work for one-off + recurring
    child events.

All test data is prefixed `TEST_iter28_` for easy cleanup.
"""
import os
import subprocess
import time
import uuid

import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

# Real demo user ids (from /api/auth/demo-accounts → demo-login).
MAGGIE_ID = "7452ce79-7027-4a94-9669-0ee3a521a5ec"   # admin
FRANKIE_ID = "6a965700-998c-4f54-9838-83a33ed155ea"
JOYCEY_ID = "85b9280f-b0d9-43d6-9e27-3181df0b2b6c"
BILLDO_ID = "97945bfb-6ca1-4432-a3e5-eb75cdd6e0e7"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


def _restart_backend_for_rate_limit_isolation():
    """Rate-limit buckets are in-process. Restart the backend before any
    rate-limit boundary test so we always start from an empty bucket."""
    subprocess.run(
        ["sudo", "supervisorctl", "restart", "backend"],
        check=True, capture_output=True, timeout=30,
    )
    # Wait until /api/health responds
    deadline = time.time() + 30
    while time.time() < deadline:
        try:
            r = requests.get(f"{API}/health", timeout=3)
            if r.status_code == 200:
                return
        except Exception:
            pass
        time.sleep(0.5)
    raise RuntimeError("backend did not come back after restart")


# ---------------------------------------------------------------------------
# /api/health
# ---------------------------------------------------------------------------

class TestHealth:
    def test_health_ok(self, s):
        r = s.get(f"{API}/health", timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("status") == "ok"
        assert body.get("db") == "up"

    def test_indexes_log_line_present(self):
        """`Indexes verified: 14 / 14 targets` must appear in backend.err.log."""
        try:
            out = subprocess.check_output(
                ["grep", "-c", "Indexes verified: 14 / 14 targets",
                 "/var/log/supervisor/backend.err.log"],
                text=True,
            ).strip()
        except subprocess.CalledProcessError as e:
            out = (e.output or "").strip() or "0"
        assert int(out) >= 1, f"expected log line at least once, got count={out}"


# ---------------------------------------------------------------------------
# Recurring events
# ---------------------------------------------------------------------------

def _mk_event_body(**overrides):
    body = {
        "title": f"TEST_iter28_{uuid.uuid4().hex[:6]}",
        "emoji": "🎉",
        "description": "iter28 recurring test event",
        "location": "Sydney",
        "date": "2026-03-04",
        "time": "10:00",
        "host_id": MAGGIE_ID,
    }
    body.update(overrides)
    return body


class TestRecurringEvents:
    def test_weekly_3_extras_makes_4_events(self, s):
        body = _mk_event_body(date="2026-03-04", recurrence="weekly", recurrence_count=3)
        r = s.post(f"{API}/events", json=body, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("recurrence") == "weekly"
        assert d.get("series_master") is True
        sid = d.get("series_id")
        assert sid and isinstance(sid, str)
        ids = d.get("series_event_ids") or []
        assert len(ids) == 4, f"expected 4 ids, got {len(ids)}: {ids}"

        # Pull all 4 from GET /api/events and confirm dates are 7 days apart
        list_r = s.get(f"{API}/events", timeout=15)
        assert list_r.status_code == 200
        all_events = list_r.json()
        series = [e for e in all_events if e.get("series_id") == sid]
        assert len(series) == 4, f"expected 4 in series, got {len(series)}"
        dates = sorted(e["date"] for e in series)
        assert dates == ["2026-03-04", "2026-03-11", "2026-03-18", "2026-03-25"], dates
        # Master flagging
        masters = [e for e in series if e.get("series_master")]
        children = [e for e in series if not e.get("series_master")]
        assert len(masters) == 1 and len(children) == 3
        # Every child carries the recurrence label
        assert all(c.get("recurrence") == "weekly" for c in children)

    def test_monthly_jan31_clamps_to_feb28_and_mar31(self, s):
        body = _mk_event_body(date="2026-01-31", recurrence="monthly", recurrence_count=2)
        r = s.post(f"{API}/events", json=body, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        sid = d["series_id"]
        list_r = s.get(f"{API}/events", timeout=15)
        series = sorted([e for e in list_r.json() if e.get("series_id") == sid], key=lambda x: x["date"])
        dates = [e["date"] for e in series]
        # Master Jan 31 + 1 month = Feb 28 2026; + 2 months = Mar 31 2026
        assert dates == ["2026-01-31", "2026-02-28", "2026-03-31"], dates

    def test_fortnightly_2_extras_makes_3_events_14d_apart(self, s):
        body = _mk_event_body(date="2026-04-01", recurrence="fortnightly", recurrence_count=2)
        r = s.post(f"{API}/events", json=body, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        sid = d["series_id"]
        list_r = s.get(f"{API}/events", timeout=15)
        series = sorted([e for e in list_r.json() if e.get("series_id") == sid], key=lambda x: x["date"])
        dates = [e["date"] for e in series]
        assert dates == ["2026-04-01", "2026-04-15", "2026-04-29"], dates
        assert all(e.get("recurrence") == "fortnightly" for e in series)

    def test_no_recurrence_creates_single_event(self, s):
        body = _mk_event_body(date="2026-05-05")  # no recurrence field at all
        r = s.post(f"{API}/events", json=body, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("recurrence") in (None, "")
        assert d.get("series_id") is None
        assert d.get("series_master") is False
        assert d.get("series_event_ids") == [d["id"]]

    def test_recurrence_count_cap_at_25(self, s):
        body = _mk_event_body(date="2026-06-01", recurrence="weekly", recurrence_count=99)
        r = s.post(f"{API}/events", json=body, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        ids = d.get("series_event_ids") or []
        # Master + 25 extras = 26 total max
        assert len(ids) == 26, f"expected 26 (1 master + 25 children), got {len(ids)}"

    def test_list_events_includes_recurrence_field(self, s):
        # Already covered indirectly above; assert at least one child carries recurrence
        list_r = s.get(f"{API}/events", timeout=15)
        events = list_r.json()
        kids = [e for e in events if e.get("series_id") and not e.get("series_master")]
        assert kids, "expected at least one recurring child event in list"
        assert all(e.get("recurrence") in ("weekly", "fortnightly", "monthly") for e in kids)


# ---------------------------------------------------------------------------
# Existing RSVP + PATCH still work (recurring child + one-off)
# ---------------------------------------------------------------------------

class TestExistingEventFlowsStillWork:
    def test_rsvp_on_oneoff_event(self, s):
        body = _mk_event_body(date="2026-07-07", title=f"TEST_iter28_oneoff_{uuid.uuid4().hex[:6]}")
        r = s.post(f"{API}/events", json=body, timeout=15)
        assert r.status_code == 200, r.text
        eid = r.json()["id"]
        rsvp = s.post(f"{API}/events/{eid}/rsvp/{FRANKIE_ID}", json={"response": "going"}, timeout=10)
        assert rsvp.status_code == 200, rsvp.text
        # GET and confirm user in `rsvps`
        ev = next((e for e in s.get(f"{API}/events").json() if e["id"] == eid), None)
        assert ev is not None
        assert FRANKIE_ID in (ev.get("rsvps") or [])

    def test_rsvp_and_patch_on_recurring_child(self, s):
        body = _mk_event_body(
            date="2026-08-03", recurrence="weekly", recurrence_count=2,
            title=f"TEST_iter28_series_{uuid.uuid4().hex[:6]}",
        )
        r = s.post(f"{API}/events", json=body, timeout=15)
        assert r.status_code == 200
        d = r.json()
        # Grab a non-master child id
        sid = d["series_id"]
        all_events = s.get(f"{API}/events").json()
        children = [e for e in all_events if e.get("series_id") == sid and not e.get("series_master")]
        assert children, "no children to test against"
        child_id = children[0]["id"]
        # RSVP on child
        rsvp = s.post(f"{API}/events/{child_id}/rsvp/{JOYCEY_ID}", json={"response": "maybe"}, timeout=10)
        assert rsvp.status_code == 200, rsvp.text
        ev = next((e for e in s.get(f"{API}/events").json() if e["id"] == child_id), None)
        assert ev is not None
        assert JOYCEY_ID in (ev.get("rsvps_maybe") or [])
        # PATCH child (host edit) — change time
        patch = s.patch(
            f"{API}/events/{child_id}",
            json={"actor_id": MAGGIE_ID, "time": "14:30", "notify_changes": False},
            timeout=10,
        )
        assert patch.status_code == 200, patch.text
        # confirm persisted
        ev2 = next((e for e in s.get(f"{API}/events").json() if e["id"] == child_id), None)
        assert ev2 and ev2.get("time") == "14:30"


# ---------------------------------------------------------------------------
# Rate limit boundaries
#
# Each test below restarts the backend first so the in-process buckets are
# empty. Then it hits the endpoint exactly N times (all should succeed) and
# expects N+1 to return 429 with a Retry-After header.
# ---------------------------------------------------------------------------

class TestRateLimits:
    def test_notice_rate_limit_6_per_hour(self, s):
        _restart_backend_for_rate_limit_isolation()
        uid = str(uuid.uuid4())  # unique key so this test owns its bucket
        for i in range(6):
            r = s.post(f"{API}/notices", json={
                "user_id": uid,
                "user_name": "TEST_iter28_user",
                "title": f"TEST_iter28_n{i}",
                "body": "rate limit probe",
                "category": "general",
            }, timeout=10)
            assert r.status_code == 200, f"call {i+1}/6 unexpectedly failed: {r.status_code} {r.text}"
        r7 = s.post(f"{API}/notices", json={
            "user_id": uid,
            "user_name": "TEST_iter28_user",
            "title": "TEST_iter28_n7",
            "body": "should 429",
            "category": "general",
        }, timeout=10)
        assert r7.status_code == 429, f"7th call expected 429, got {r7.status_code}: {r7.text}"
        assert r7.headers.get("Retry-After"), "missing Retry-After header"

    def test_flutter_rate_limit_20_per_hour(self, s):
        _restart_backend_for_rate_limit_isolation()
        # Need an existing sender — use Billdo so it doesn't clash with other tests
        for i in range(20):
            r = s.post(f"{API}/flutters/send", json={
                "from_id": BILLDO_ID,
                "to_id": MAGGIE_ID,
                "message": f"TEST_iter28 flutter {i}",
            }, timeout=10)
            assert r.status_code == 200, f"call {i+1}/20 unexpectedly failed: {r.status_code} {r.text}"
        r21 = s.post(f"{API}/flutters/send", json={
            "from_id": BILLDO_ID,
            "to_id": MAGGIE_ID,
            "message": "TEST_iter28 flutter 21",
        }, timeout=10)
        assert r21.status_code == 429, f"21st call expected 429, got {r21.status_code}: {r21.text}"
        assert r21.headers.get("Retry-After")

    def test_report_rate_limit_10_per_hour(self, s):
        _restart_backend_for_rate_limit_isolation()
        rid = str(uuid.uuid4())
        for i in range(10):
            r = s.post(f"{API}/reports", json={
                "reporter_id": rid,
                "target_user_id": MAGGIE_ID,
                "target_type": "user",
                "reason": "Other",
                "notes": f"TEST_iter28 report {i}",
            }, timeout=10)
            assert r.status_code == 200, f"call {i+1}/10 unexpectedly failed: {r.status_code} {r.text}"
        r11 = s.post(f"{API}/reports", json={
            "reporter_id": rid,
            "target_user_id": MAGGIE_ID,
            "target_type": "user",
            "reason": "Other",
            "notes": "TEST_iter28 report 11",
        }, timeout=10)
        assert r11.status_code == 429, f"11th call expected 429, got {r11.status_code}: {r11.text}"
        assert r11.headers.get("Retry-After")

    def test_event_rate_limit_8_per_hour_per_host(self, s):
        _restart_backend_for_rate_limit_isolation()
        # Use Frankie as host so we don't collide with Maggie's recurring tests
        # (test ordering aside, the restart wipes the bucket anyway).
        for i in range(8):
            body = {
                "title": f"TEST_iter28_rl_e{i}",
                "emoji": "🍰",
                "description": "rate limit probe",
                "location": "Sydney",
                "date": "2026-09-01",
                "time": "10:00",
                "host_id": FRANKIE_ID,
            }
            r = s.post(f"{API}/events", json=body, timeout=10)
            assert r.status_code == 200, f"call {i+1}/8 unexpectedly failed: {r.status_code} {r.text}"
        body9 = {
            "title": "TEST_iter28_rl_e9",
            "emoji": "🍰",
            "description": "should 429",
            "location": "Sydney",
            "date": "2026-09-01",
            "time": "10:00",
            "host_id": FRANKIE_ID,
        }
        r9 = s.post(f"{API}/events", json=body9, timeout=10)
        assert r9.status_code == 429, f"9th call expected 429, got {r9.status_code}: {r9.text}"
        assert r9.headers.get("Retry-After")
