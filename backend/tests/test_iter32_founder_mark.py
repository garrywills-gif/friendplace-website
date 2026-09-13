"""Iteration 32 — Founder Mark (butterfly) enrichment tests.

Validates that author-cached documents and the table list projection now
carry founder flags so the frontend can render the 🦋 button next to
founder names everywhere without an extra round-trip per row.

Endpoints verified:
  - GET /api/groups/{id}/posts        → user_is_founder + user_founder_number
  - GET /api/notices                  → user_is_founder + user_founder_number
  - GET /api/tables/{id}/messages     → user_is_founder + user_founder_number
  - GET /api/dm/{conv_id}/messages    → user_is_founder + user_founder_number
  - GET /api/tables                   → host_display + friends_seated carry
                                        is_founder + founder_number for
                                        founders, NOT for non-founders.
"""
import os
import uuid
import time
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://iphone-retest-batch.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def mongo():
    return MongoClient(MONGO_URL)[DB_NAME]


@pytest.fixture(scope="module")
def founder_user(api, mongo):
    """Sign up a fresh real account that auto-promotes to founder."""
    suffix = uuid.uuid4().hex[:8]
    payload = {
        "username": f"TEST_iter32_{suffix}",
        "password": "Test1234!",
        "email": f"test_iter32_{suffix}@example.com",
        "first_name": "Iter32Founder",
    }
    r = api.post(f"{BASE_URL}/api/auth/signup", json=payload)
    assert r.status_code == 200, f"signup failed: {r.status_code} {r.text}"
    data = r.json()
    user = data["user"]
    assert user.get("is_founder") is True, f"new signup should be founder: {user}"
    assert isinstance(user.get("founder_number"), int) and user["founder_number"] >= 1
    yield user
    # Cleanup — remove the user + any docs we may have authored.
    uid = user["id"]
    mongo.users.delete_one({"id": uid})
    mongo.notifications.delete_many({"user_id": uid})
    mongo.notices.delete_many({"user_id": uid})
    mongo.group_posts.delete_many({"user_id": uid})
    mongo.messages.delete_many({"user_id": uid})
    mongo.groups.update_many({}, {"$pull": {"members": uid}})
    mongo.tables.update_many({}, {"$pull": {"seated": uid}})


@pytest.fixture(scope="module")
def demo_user(api):
    """Pick maggie as a known non-founder demo user."""
    r = api.post(f"{BASE_URL}/api/auth/demo-login", json={"username": "maggie"})
    assert r.status_code == 200, r.text
    user = r.json()["user"]
    assert not user.get("is_founder"), f"maggie should NOT be a founder: {user}"
    return user


# ---------------- 1. Group posts enrichment ----------------

class TestGroupPostsFounderEnrichment:
    """POST a group post from a founder vs a non-founder; the founder's
    post must carry user_is_founder + user_founder_number, the non-founder
    must not have those fields set."""

    def test_group_posts_carry_founder_flags(self, api, founder_user, demo_user, mongo):
        # Pick the first group with at least one member (Coffee Lounge Crew etc).
        r = api.get(f"{BASE_URL}/api/groups")
        assert r.status_code == 200
        groups = r.json()
        # Use a non-founder-only group so demo_user can post too.
        target = next(
            (g for g in groups if not g.get("is_founder_only")),
            None,
        )
        assert target is not None, "no non-founder group available"
        group_id = target["id"]

        # Founder posts.
        founder_post_body = {
            "id": str(uuid.uuid4()),
            "group_id": group_id,
            "user_id": founder_user["id"],
            "user_name": founder_user.get("first_name", "Founder"),
            "avatar": founder_user.get("avatar", ""),
            "text": "TEST_iter32 founder post",
        }
        r1 = api.post(f"{BASE_URL}/api/groups/{group_id}/posts", json=founder_post_body)
        assert r1.status_code == 200, r1.text
        founder_post_id = r1.json()["id"]

        # Non-founder posts.
        demo_post_body = {
            "id": str(uuid.uuid4()),
            "group_id": group_id,
            "user_id": demo_user["id"],
            "user_name": demo_user.get("first_name", "Margaret"),
            "avatar": demo_user.get("avatar", ""),
            "text": "TEST_iter32 demo post",
        }
        r2 = api.post(f"{BASE_URL}/api/groups/{group_id}/posts", json=demo_post_body)
        assert r2.status_code == 200, r2.text
        demo_post_id = r2.json()["id"]

        try:
            # Now GET the posts and verify enrichment.
            r3 = api.get(f"{BASE_URL}/api/groups/{group_id}/posts")
            assert r3.status_code == 200
            docs = r3.json()
            by_id = {d["id"]: d for d in docs}

            fp = by_id.get(founder_post_id)
            assert fp is not None, "founder post missing from list"
            assert fp.get("user_is_founder") is True, f"founder post missing user_is_founder: {fp}"
            assert isinstance(fp.get("user_founder_number"), int)
            assert fp["user_founder_number"] == founder_user["founder_number"]

            dp = by_id.get(demo_post_id)
            assert dp is not None, "demo post missing from list"
            # Non-founders MUST NOT carry the flag.
            assert dp.get("user_is_founder") in (None, False), f"non-founder post should not carry flag: {dp}"
            assert dp.get("user_founder_number") is None
        finally:
            mongo.group_posts.delete_many({"id": {"$in": [founder_post_id, demo_post_id]}})


# ---------------- 2. Notices enrichment ----------------

class TestNoticesFounderEnrichment:
    def test_notices_carry_founder_flags(self, api, founder_user, demo_user, mongo):
        # Founder notice.
        founder_notice = {
            "id": str(uuid.uuid4()),
            "user_id": founder_user["id"],
            "user_name": founder_user.get("first_name", "Founder"),
            "avatar": founder_user.get("avatar", ""),
            "title": "TEST_iter32 founder notice",
            "body": "Hello",
            "category": "General",
        }
        r1 = api.post(f"{BASE_URL}/api/notices", json=founder_notice)
        assert r1.status_code == 200, r1.text
        fn_id = r1.json()["id"]

        # Demo (non-founder) notice.
        demo_notice = {
            "id": str(uuid.uuid4()),
            "user_id": demo_user["id"],
            "user_name": demo_user.get("first_name", "Margaret"),
            "avatar": demo_user.get("avatar", ""),
            "title": "TEST_iter32 demo notice",
            "body": "Hello",
            "category": "General",
        }
        r2 = api.post(f"{BASE_URL}/api/notices", json=demo_notice)
        assert r2.status_code == 200, r2.text
        dn_id = r2.json()["id"]

        try:
            r3 = api.get(f"{BASE_URL}/api/notices")
            assert r3.status_code == 200
            docs = r3.json()
            by_id = {d["id"]: d for d in docs}

            fn = by_id.get(fn_id)
            assert fn is not None, "founder notice missing"
            assert fn.get("user_is_founder") is True
            assert fn.get("user_founder_number") == founder_user["founder_number"]

            dn = by_id.get(dn_id)
            assert dn is not None, "demo notice missing"
            assert dn.get("user_is_founder") in (None, False)
            assert dn.get("user_founder_number") is None
        finally:
            mongo.notices.delete_many({"id": {"$in": [fn_id, dn_id]}})


# ---------------- 3. Table chat messages enrichment ----------------

class TestTableMessagesFounderEnrichment:
    def test_table_messages_carry_founder_flags(self, api, founder_user, demo_user, mongo):
        # Seed messages directly into the messages collection (WS path is
        # not testable from requests). We use a fresh dummy table_id.
        table_id = f"TEST_iter32_{uuid.uuid4().hex[:8]}"
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()

        founder_msg = {
            "id": str(uuid.uuid4()),
            "table_id": table_id,
            "user_id": founder_user["id"],
            "user_name": founder_user.get("first_name", "Founder"),
            "avatar": founder_user.get("avatar", ""),
            "text": "founder hello",
            "created_at": now,
        }
        demo_msg = {
            "id": str(uuid.uuid4()),
            "table_id": table_id,
            "user_id": demo_user["id"],
            "user_name": demo_user.get("first_name", "Margaret"),
            "avatar": demo_user.get("avatar", ""),
            "text": "demo hello",
            "created_at": now,
        }
        mongo.messages.insert_many([founder_msg, demo_msg])

        try:
            r = api.get(f"{BASE_URL}/api/tables/{table_id}/messages")
            assert r.status_code == 200
            docs = r.json()
            by_id = {d["id"]: d for d in docs}
            assert founder_msg["id"] in by_id and demo_msg["id"] in by_id

            fm = by_id[founder_msg["id"]]
            assert fm.get("user_is_founder") is True
            assert fm.get("user_founder_number") == founder_user["founder_number"]

            dm = by_id[demo_msg["id"]]
            assert dm.get("user_is_founder") in (None, False)
            assert dm.get("user_founder_number") is None
        finally:
            mongo.messages.delete_many({"table_id": table_id})


# ---------------- 4. DM messages enrichment ----------------

class TestDMMessagesFounderEnrichment:
    def test_dm_messages_carry_founder_flags(self, api, founder_user, demo_user, mongo):
        # Open a real DM conversation via /api/dm/start so the conv_id is
        # legit; then seed messages directly via Mongo (WS only path).
        r = api.post(
            f"{BASE_URL}/api/dm/start",
            json={"user_id": founder_user["id"], "other_id": demo_user["id"]},
        )
        assert r.status_code == 200, r.text
        conv = r.json()
        conv_id = conv["id"]

        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()

        founder_msg = {
            "id": str(uuid.uuid4()),
            "dm_id": conv_id,
            "user_id": founder_user["id"],
            "user_name": founder_user.get("first_name", "Founder"),
            "avatar": founder_user.get("avatar", ""),
            "text": "hi from founder",
            "created_at": now,
        }
        demo_msg = {
            "id": str(uuid.uuid4()),
            "dm_id": conv_id,
            "user_id": demo_user["id"],
            "user_name": demo_user.get("first_name", "Margaret"),
            "avatar": demo_user.get("avatar", ""),
            "text": "hi from demo",
            "created_at": now,
        }
        mongo.messages.insert_many([founder_msg, demo_msg])

        try:
            r2 = api.get(f"{BASE_URL}/api/dm/{conv_id}/messages")
            assert r2.status_code == 200
            docs = r2.json()
            by_id = {d["id"]: d for d in docs}
            assert founder_msg["id"] in by_id and demo_msg["id"] in by_id

            fm = by_id[founder_msg["id"]]
            assert fm.get("user_is_founder") is True
            assert fm.get("user_founder_number") == founder_user["founder_number"]

            dm = by_id[demo_msg["id"]]
            assert dm.get("user_is_founder") in (None, False)
            assert dm.get("user_founder_number") is None
        finally:
            mongo.messages.delete_many({"dm_id": conv_id, "id": {"$in": [founder_msg["id"], demo_msg["id"]]}})


# ---------------- 5. Tables list — host_display + friends_seated ----------------

class TestTablesFounderProjection:
    """The /api/tables projection should attach is_founder + founder_number
    to host_display + friends_seated for founders, and omit those fields
    for non-founders."""

    def test_founders_lounge_table_host_display(self, api, founder_user, demo_user, mongo):
        # Add founder_user (founder) and demo_user (non-founder) as friends
        # of one another so friends_seated populates when we query as demo.
        mongo.users.update_one({"id": demo_user["id"]}, {"$addToSet": {"friends": founder_user["id"]}})
        mongo.users.update_one({"id": founder_user["id"]}, {"$addToSet": {"friends": demo_user["id"]}})

        # Locate the Founders Lounge table (founder_only=true).
        r = api.get(f"{BASE_URL}/api/tables", params={"user_id": demo_user["id"]})
        assert r.status_code == 200
        tables = r.json()
        fl = next((t for t in tables if t.get("founder_only")), None)
        assert fl is not None, "Founders Lounge table missing"

        host_display = fl.get("host_display")
        assert host_display is not None, f"host_display missing on FL table: {fl}"
        assert "first_name" in host_display
        assert "avatar" in host_display
        assert host_display.get("is_founder") is True, f"FL host should be founder: {host_display}"
        assert isinstance(host_display.get("founder_number"), int)

        # friends_seated: founder_user IS a founder seated at the FL table
        # (auto-seated at signup) and we just friended demo↔founder, so it
        # should show up with is_founder=true.
        fs = fl.get("friends_seated") or []
        # The signup fixture seats new founder at FL table.
        seated_founder = next((s for s in fs if s.get("id") == founder_user["id"]), None)
        assert seated_founder is not None, f"founder_user not in friends_seated: {fs}"
        assert seated_founder.get("is_founder") is True
        assert seated_founder.get("founder_number") == founder_user["founder_number"]

    def test_non_founder_host_no_founder_fields(self, api, demo_user, mongo):
        """Any non-founder-only table whose host is a non-founder should
        NOT have is_founder/founder_number on host_display."""
        # Create a quick test table hosted by demo_user (non-founder).
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        table_id = f"TEST_iter32_nf_{uuid.uuid4().hex[:8]}"
        mongo.tables.insert_one({
            "id": table_id,
            "name": "TEST_iter32 non-founder table",
            "emoji": "☕",
            "host_id": demo_user["id"],
            "seated": [demo_user["id"]],
            "created_at": now,
            "last_activity_at": now,
            "persistent": False,
            "founder_only": False,
        })
        try:
            r = api.get(f"{BASE_URL}/api/tables", params={"user_id": demo_user["id"]})
            assert r.status_code == 200
            tables = r.json()
            t = next((x for x in tables if x.get("id") == table_id), None)
            assert t is not None
            hd = t.get("host_display") or {}
            # non-founder host should not carry founder fields
            assert hd.get("is_founder") in (None, False), f"non-founder host_display leaked founder: {hd}"
            assert "founder_number" not in hd
        finally:
            mongo.tables.delete_one({"id": table_id})
