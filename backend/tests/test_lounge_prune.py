"""Coffee Lounge — prune, persistence, and sort-by-activity tests.

Covers backend changes in this iteration:
- Table model adds `last_activity_at` and `persistent` fields
- GET /api/tables runs migration + 24h idle prune
- GET /api/tables returns sorted by last_activity_at desc
- POST /tables/{id}/join/{user_id} bumps last_activity_at
- Seed tables are marked persistent=True and survive prune
- TEST_Table rows are removed by migration
"""
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
    or "https://george-mcgs-cms.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

SEED_NAMES = {
    "Morning Coffee", "Gardening Chat", "Men's Shed", "Book Club",
    "Pet Lovers", "New Friends", "Sydney Locals",
}


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def db():
    client = MongoClient(MONGO_URL)
    return client[DB_NAME]


@pytest.fixture(scope="module")
def maggie(s):
    r = s.post(f"{API}/auth/demo-login", json={"username": "maggie"})
    assert r.status_code == 200, r.text
    return r.json()["user"]


# ---- Migration: seed tables persistent, TEST_Table removed ----
class TestMigration:
    def test_get_tables_returns_200_and_strips_objectid(self, s):
        r = s.get(f"{API}/tables")
        assert r.status_code == 200, r.text
        tables = r.json()
        assert isinstance(tables, list)
        assert all("_id" not in t for t in tables)

    def test_seed_tables_present_and_persistent(self, s):
        tables = s.get(f"{API}/tables").json()
        by_name = {t["name"]: t for t in tables}
        for name in SEED_NAMES:
            assert name in by_name, f"missing seed table {name}"
            t = by_name[name]
            assert t.get("persistent") is True, f"{name} not marked persistent: {t}"
            assert t.get("last_activity_at"), f"{name} missing last_activity_at"

    def test_no_test_table_rows_remain(self, s, db):
        # Ensure none exist before GET
        tables = s.get(f"{API}/tables").json()
        names = [t["name"] for t in tables]
        assert "TEST_Table" not in names
        # Direct DB check too
        assert db.tables.count_documents({"name": "TEST_Table"}) == 0


# ---- Sort: most recent activity first ----
class TestSortOrder:
    def test_tables_sorted_by_last_activity_desc(self, s):
        tables = s.get(f"{API}/tables").json()
        activities = [t.get("last_activity_at") or "" for t in tables]
        assert activities == sorted(activities, reverse=True), \
            "tables not sorted by last_activity_at desc"

    def test_new_table_appears_at_top(self, s, maggie):
        unique = f"TEST_Sort_{uuid.uuid4().hex[:8]}"
        r = s.post(f"{API}/tables", json={
            "name": unique, "emoji": "🧪", "description": "sort test",
            "host_id": maggie["id"],
        })
        assert r.status_code == 200, r.text
        created = r.json()
        try:
            tables = s.get(f"{API}/tables").json()
            assert len(tables) > 0
            assert tables[0]["id"] == created["id"], \
                f"newly created table not on top; first={tables[0]['name']}"
        finally:
            # cleanup — direct DB delete (no DELETE endpoint exists)
            from pymongo import MongoClient
            MongoClient(MONGO_URL)[DB_NAME].tables.delete_one({"id": created["id"]})


# ---- Join bumps last_activity_at ----
class TestJoinBumpsActivity:
    def test_join_updates_last_activity(self, s, maggie, db):
        # Create a table whose host is maggie (so seated has just maggie).
        unique = f"TEST_Join_{uuid.uuid4().hex[:8]}"
        r = s.post(f"{API}/tables", json={
            "name": unique, "host_id": maggie["id"],
        })
        assert r.status_code == 200
        tid = r.json()["id"]
        try:
            before = db.tables.find_one({"id": tid}, {"_id": 0, "last_activity_at": 1})["last_activity_at"]
            # Bring in another demo user to join (frankie)
            r2 = s.post(f"{API}/auth/demo-login", json={"username": "frankie"})
            assert r2.status_code == 200
            frankie_id = r2.json()["user"]["id"]
            time.sleep(1.1)  # ensure timestamp difference
            r3 = s.post(f"{API}/tables/{tid}/join/{frankie_id}")
            assert r3.status_code == 200, r3.text
            after = db.tables.find_one({"id": tid}, {"_id": 0, "last_activity_at": 1, "seated": 1})
            assert after["last_activity_at"] > before, \
                f"last_activity_at not bumped: before={before} after={after['last_activity_at']}"
            assert frankie_id in after["seated"]
        finally:
            db.tables.delete_one({"id": tid})


# ---- Prune: 25h old non-persistent rows deleted; persistent rows survive ----
class TestPrune:
    def test_stale_nonpersistent_table_is_pruned(self, s, db):
        old_ts = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()
        stale_id = f"prune-stale-{uuid.uuid4().hex[:8]}"
        db.tables.insert_one({
            "id": stale_id, "name": "TEST_Stale", "emoji": "💤",
            "description": "old", "visibility": "public",
            "host_id": "", "seated": [],
            "created_at": old_ts, "last_activity_at": old_ts,
            "persistent": False,
        })
        # Insert a few messages too — they should also be pruned
        db.messages.insert_one({
            "id": f"msg-{uuid.uuid4().hex[:8]}", "table_id": stale_id,
            "user_id": "x", "text": "old", "created_at": old_ts,
        })
        try:
            r = s.get(f"{API}/tables")
            assert r.status_code == 200
            names = [t["name"] for t in r.json()]
            assert "TEST_Stale" not in names, "stale non-persistent table not pruned"
            assert db.tables.count_documents({"id": stale_id}) == 0, "stale row still in DB"
            assert db.messages.count_documents({"table_id": stale_id}) == 0, "stale messages not pruned"
        finally:
            db.tables.delete_one({"id": stale_id})
            db.messages.delete_many({"table_id": stale_id})

    def test_stale_persistent_table_survives(self, s, db):
        old_ts = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
        keep_id = f"prune-keep-{uuid.uuid4().hex[:8]}"
        keep_name = f"TEST_KeepPersistent_{uuid.uuid4().hex[:6]}"
        db.tables.insert_one({
            "id": keep_id, "name": keep_name, "emoji": "🌟",
            "description": "stays", "visibility": "public",
            "host_id": "", "seated": [],
            "created_at": old_ts, "last_activity_at": old_ts,
            "persistent": True,
        })
        try:
            r = s.get(f"{API}/tables")
            assert r.status_code == 200
            names = [t["name"] for t in r.json()]
            assert keep_name in names, "persistent table was wrongly pruned"
        finally:
            db.tables.delete_one({"id": keep_id})

    def test_recent_nonpersistent_table_survives(self, s, db):
        recent = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        rid = f"prune-recent-{uuid.uuid4().hex[:8]}"
        rname = f"TEST_Recent_{uuid.uuid4().hex[:6]}"
        db.tables.insert_one({
            "id": rid, "name": rname, "emoji": "🆕",
            "description": "fresh", "visibility": "public",
            "host_id": "", "seated": [],
            "created_at": recent, "last_activity_at": recent,
            "persistent": False,
        })
        try:
            r = s.get(f"{API}/tables")
            assert r.status_code == 200
            names = [t["name"] for t in r.json()]
            assert rname in names, "recent non-persistent table was wrongly pruned"
        finally:
            db.tables.delete_one({"id": rid})


# ---- New table created via POST has the new fields ----
class TestTableModelFields:
    def test_created_table_has_last_activity_and_persistent_false(self, s, maggie, db):
        unique = f"TEST_Model_{uuid.uuid4().hex[:8]}"
        r = s.post(f"{API}/tables", json={
            "name": unique, "host_id": maggie["id"],
        })
        assert r.status_code == 200
        t = r.json()
        try:
            assert "last_activity_at" in t and t["last_activity_at"]
            assert t.get("persistent") is False
            # Verify persistence in DB
            stored = db.tables.find_one({"id": t["id"]}, {"_id": 0})
            assert stored is not None
            assert stored.get("persistent") is False
            assert stored.get("last_activity_at")
        finally:
            db.tables.delete_one({"id": t["id"]})
