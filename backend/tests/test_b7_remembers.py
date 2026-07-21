"""B7 — George Remembers backend tests (sweep + inbox HTTP flow)."""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

sys.path.insert(0, "/app/backend")
from services.george import remembers  # noqa: E402

BASE = "http://127.0.0.1:8001/api"
MONGO = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")
EMAIL = "member@friendplace.com.au"
PW = "TestPass2026!"
TZ = ZoneInfo("Australia/Sydney")


# ----- helpers -----
def _login(email=EMAIL, password=PW):
    r = requests.post(f"{BASE}/auth/login", json={"username": email, "password": password})
    r.raise_for_status()
    d = r.json()
    return d["access_token"], d["user"]["id"]


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


async def _get_alex(db):
    return await db.users.find_one({"username": "member_first"}, {"_id": 0})


async def _clean(db, alex_id):
    await db.events.delete_many({"host_id": alex_id, "title": {"$regex": "^B7_"}})
    await db.george_remembers.delete_many({"recipient_id": alex_id})


def _make_event(alex_id, title, start_utc):
    start_local = start_utc.astimezone(TZ)
    return {
        "id": str(uuid.uuid4()),
        "title": title,
        "host_id": alex_id,
        "date": start_local.date().isoformat(),
        "time": start_local.strftime("%H:%M"),
        "cancelled": False,
        "rsvps": [], "rsvps_maybe": [], "rsvps_cant": [], "waitlist": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@pytest.fixture(scope="module")
def db():
    client = AsyncIOMotorClient(MONGO)
    _run(remembers.ensure_indexes(client[DB_NAME]))
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="module")
def alex(db):
    a = _run(_get_alex(db))
    assert a, "seed member_first missing"
    return a


@pytest.fixture(autouse=True)
def _cleanup(db, alex):
    _run(_clean(db, alex["id"]))
    yield
    _run(_clean(db, alex["id"]))


# ----- Sweep tests -----
class TestSweep:
    def test_1_sweep_creates_rows_future_event(self, db, alex):
        start = datetime.now(timezone.utc) + timedelta(hours=17)
        ev = _make_event(alex["id"], "B7_Book_Club", start)
        _run(db.events.insert_one(ev))
        _run(remembers.sweep_once(db))
        rows = _run(db.george_remembers.find(
            {"event_id": ev["id"]}, {"_id": 0}).to_list(10))
        assert len(rows) == 2
        by_kind = {r["kind"]: r for r in rows}
        assert by_kind["pre_event"]["status"] == "scheduled"
        assert by_kind["post_event"]["status"] == "scheduled"
        # Time check: pre = start - 18h
        pre_sched = datetime.fromisoformat(by_kind["pre_event"]["scheduled_for"])
        post_sched = datetime.fromisoformat(by_kind["post_event"]["scheduled_for"])
        assert abs((pre_sched - (start - timedelta(hours=18))).total_seconds()) < 120
        assert abs((post_sched - (start + timedelta(hours=4))).total_seconds()) < 120
        # Content check
        assert "B7_Book_Club is tomorrow, Alex" in by_kind["pre_event"]["content"]
        assert "How did B7_Book_Club go, Alex" in by_kind["post_event"]["content"]

    def test_2_idempotent(self, db, alex):
        start = datetime.now(timezone.utc) + timedelta(hours=17)
        ev = _make_event(alex["id"], "B7_Idem", start)
        _run(db.events.insert_one(ev))
        _run(remembers.sweep_once(db))
        s2 = _run(remembers.sweep_once(db))
        assert s2["created"] == 0, f"second sweep should create 0: {s2}"
        n = _run(db.george_remembers.count_documents({"event_id": ev["id"]}))
        assert n == 2

    def test_3_reschedule_supersedes(self, db, alex):
        start = datetime.now(timezone.utc) + timedelta(hours=17)
        ev = _make_event(alex["id"], "B7_Reschedule", start)
        _run(db.events.insert_one(ev))
        _run(remembers.sweep_once(db))
        # shift +2h (was +1h in prompt; use 2h to exceed grace)
        new_start = start + timedelta(hours=2)
        new_local = new_start.astimezone(TZ)
        _run(db.events.update_one({"id": ev["id"]},
             {"$set": {"date": new_local.date().isoformat(),
                       "time": new_local.strftime("%H:%M")}}))
        s = _run(remembers.sweep_once(db))
        assert s["superseded"] >= 1
        superseded = _run(db.george_remembers.count_documents(
            {"event_id": ev["id"], "status": "superseded"}))
        scheduled = _run(db.george_remembers.count_documents(
            {"event_id": ev["id"], "status": "scheduled"}))
        assert superseded >= 1
        assert scheduled >= 1

    def test_4_cancellation_cancels_scheduled(self, db, alex):
        start = datetime.now(timezone.utc) + timedelta(hours=17)
        ev = _make_event(alex["id"], "B7_Cancel", start)
        _run(db.events.insert_one(ev))
        _run(remembers.sweep_once(db))
        _run(db.events.update_one({"id": ev["id"]}, {"$set": {"cancelled": True}}))
        _run(remembers.sweep_once(db))
        rows = _run(db.george_remembers.find({"event_id": ev["id"]}).to_list(10))
        cancelled = [r for r in rows if r.get("status") == "cancelled"]
        assert len(cancelled) >= 1
        assert cancelled[0].get("cancelled_reason") == "event_removed"

    def test_5_inactive_organiser_skipped(self, db, alex):
        # Create a temporary inactive user
        uid = str(uuid.uuid4())
        _run(db.users.insert_one({
            "id": uid, "username": f"B7_inactive_{uid[:6]}",
            "first_name": "Bob", "is_active": False,
        }))
        try:
            start = datetime.now(timezone.utc) + timedelta(hours=17)
            ev = _make_event(uid, "B7_InactiveHost", start)
            _run(db.events.insert_one(ev))
            _run(remembers.sweep_once(db))
            n = _run(db.george_remembers.count_documents({"event_id": ev["id"]}))
            assert n == 0
        finally:
            _run(db.users.delete_one({"id": uid}))
            _run(db.events.delete_many({"host_id": uid}))

    def test_6_tz_correctness(self, db, alex):
        # Event at 14:00 Sydney local, 3 days from now
        local = (datetime.now(TZ) + timedelta(days=3)).replace(hour=14, minute=0, second=0, microsecond=0)
        start_utc = local.astimezone(timezone.utc)
        ev = _make_event(alex["id"], "B7_TZ", start_utc)
        # Override date/time explicitly
        ev["date"] = local.date().isoformat()
        ev["time"] = "14:00"
        _run(db.events.insert_one(ev))
        _run(remembers.sweep_once(db))
        pre = _run(db.george_remembers.find_one(
            {"event_id": ev["id"], "kind": "pre_event"}, {"_id": 0}))
        assert pre is not None
        sched = datetime.fromisoformat(pre["scheduled_for"])
        expected = start_utc - timedelta(hours=18)
        assert abs((sched - expected).total_seconds()) < 120


# ----- HTTP inbox tests -----
class TestInboxHTTP:
    def _due_event(self, db, alex):
        # start = now +17h, pre_event is due (-1h from now)
        start = datetime.now(timezone.utc) + timedelta(hours=17)
        ev = _make_event(alex["id"], "B7_HTTP_Due", start)
        _run(db.events.insert_one(ev))
        _run(remembers.sweep_once(db))
        return ev

    def test_7_due_row_delivered_on_read(self, db, alex):
        ev = self._due_event(db, alex)
        tok, _ = _login()
        r = requests.get(f"{BASE}/mcgs/george/remembers/inbox",
                         headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        matching = [i for i in items if i["event_id"] == ev["id"]]
        assert len(matching) >= 1
        # DB should show delivered
        row = _run(db.george_remembers.find_one(
            {"event_id": ev["id"], "kind": "pre_event"}, {"_id": 0}))
        assert row["status"] == "delivered"

    def test_8_persistence_across_restart(self, db, alex):
        ev = self._due_event(db, alex)
        tok, _ = _login()
        # First fetch to mark delivered
        requests.get(f"{BASE}/mcgs/george/remembers/inbox",
                     headers={"Authorization": f"Bearer {tok}"})
        # Restart
        import subprocess, time
        subprocess.run(["sudo", "supervisorctl", "restart", "backend"],
                       capture_output=True, timeout=30)
        time.sleep(6)
        tok2, _ = _login()
        r = requests.get(f"{BASE}/mcgs/george/remembers/inbox",
                         headers={"Authorization": f"Bearer {tok2}"})
        assert r.status_code == 200
        matching = [i for i in r.json()["items"] if i["event_id"] == ev["id"]]
        assert len(matching) >= 1

    def test_9_dismiss(self, db, alex):
        ev = self._due_event(db, alex)
        tok, _ = _login()
        # Fetch to deliver
        r = requests.get(f"{BASE}/mcgs/george/remembers/inbox",
                         headers={"Authorization": f"Bearer {tok}"})
        msg_id = [i for i in r.json()["items"] if i["event_id"] == ev["id"]][0]["id"]
        d = requests.post(f"{BASE}/mcgs/george/remembers/{msg_id}/dismiss",
                          headers={"Authorization": f"Bearer {tok}"})
        assert d.status_code == 200
        assert d.json()["status"] == "dismissed"
        # Not in inbox anymore
        r2 = requests.get(f"{BASE}/mcgs/george/remembers/inbox",
                          headers={"Authorization": f"Bearer {tok}"})
        ids = [i["id"] for i in r2.json()["items"]]
        assert msg_id not in ids

    def test_10_cancelled_event_filters_delivered(self, db, alex):
        ev = self._due_event(db, alex)
        tok, _ = _login()
        r = requests.get(f"{BASE}/mcgs/george/remembers/inbox",
                         headers={"Authorization": f"Bearer {tok}"})
        msg_id = [i for i in r.json()["items"] if i["event_id"] == ev["id"]][0]["id"]
        # Cancel event
        _run(db.events.update_one({"id": ev["id"]}, {"$set": {"cancelled": True}}))
        r2 = requests.get(f"{BASE}/mcgs/george/remembers/inbox",
                          headers={"Authorization": f"Bearer {tok}"})
        ids = [i["id"] for i in r2.json()["items"]]
        assert msg_id not in ids
        row = _run(db.george_remembers.find_one({"id": msg_id}, {"_id": 0}))
        assert row["status"] == "cancelled"

    def test_11_wrong_user_cannot_dismiss(self, db, alex):
        ev = self._due_event(db, alex)
        tok, _ = _login()
        r = requests.get(f"{BASE}/mcgs/george/remembers/inbox",
                         headers={"Authorization": f"Bearer {tok}"})
        msg_id = [i for i in r.json()["items"] if i["event_id"] == ev["id"]][0]["id"]
        # Log in as different user - use realtest1 or create one
        second_email = None
        for cand in [("realtest1", "secret123")]:
            r_login = requests.post(f"{BASE}/auth/login",
                                    json={"username": cand[0], "password": cand[1]})
            if r_login.status_code == 200:
                second_email = cand
                break
        if not second_email:
            # Create ephemeral user
            uname = f"b7test_{uuid.uuid4().hex[:8]}"
            r_signup = requests.post(f"{BASE}/auth/signup",
                                     json={"username": uname, "password": "TestPass2026!"})
            assert r_signup.status_code == 200, r_signup.text
            other_tok = r_signup.json()["access_token"]
        else:
            r_login = requests.post(f"{BASE}/auth/login",
                                    json={"username": second_email[0], "password": second_email[1]})
            other_tok = r_login.json()["access_token"]
        d = requests.post(f"{BASE}/mcgs/george/remembers/{msg_id}/dismiss",
                          headers={"Authorization": f"Bearer {other_tok}"})
        assert d.status_code == 404

    def test_12_seen_idempotent(self, db, alex):
        ev = self._due_event(db, alex)
        tok, _ = _login()
        r = requests.get(f"{BASE}/mcgs/george/remembers/inbox",
                         headers={"Authorization": f"Bearer {tok}"})
        msg_id = [i for i in r.json()["items"] if i["event_id"] == ev["id"]][0]["id"]
        for _ in range(2):
            s = requests.post(f"{BASE}/mcgs/george/remembers/{msg_id}/seen",
                              headers={"Authorization": f"Bearer {tok}"})
            assert s.status_code == 200
            assert s.json().get("ok") is True
