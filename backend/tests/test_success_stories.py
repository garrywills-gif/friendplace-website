"""End-to-end tests for the FriendPlace Success Stories module.

Covers the admin CRUD/reorder + the public read filter. Uses a JWT
minted directly against the existing admin row so we never touch the
admin's password.

Cleans up every story it creates in module teardown (Garry starts empty).
"""
from __future__ import annotations

import os
import sys
import time
import asyncio
import pytest
import requests

# Make backend imports work when pytest is run from /app
sys.path.insert(0, "/app/backend")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
import cms_module  # noqa: E402

BASE_URL = "https://friendplace-v1.preview.emergentagent.com".rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


# ─── Fixtures ─────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def admin_token():
    """Mint a CMS admin JWT for the pre-existing admin without touching password."""
    async def _get_admin():
        c = AsyncIOMotorClient(MONGO_URL)
        try:
            db = c[DB_NAME]
            admin = await db.cms_admins.find_one({}, {"_id": 0, "password_hash": 0})
            return admin
        finally:
            c.close()
    admin = asyncio.get_event_loop().run_until_complete(_get_admin())
    assert admin, "No CMS admin found in DB; cannot test"
    token = cms_module._make_admin_token(admin["id"], admin["email"])
    return token


@pytest.fixture(scope="module")
def client(admin_token):
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {admin_token}",
    })
    return s


@pytest.fixture(scope="module")
def anon():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# Track ids created inside this run so we clean up at the end.
_CREATED_IDS: list[str] = []


@pytest.fixture(scope="module", autouse=True)
def _cleanup(client):
    yield
    # Wipe every cms_success_stories row we created plus any leftover
    # so the user starts with an empty list, per the task instructions.
    async def _wipe():
        c = AsyncIOMotorClient(MONGO_URL)
        try:
            await c[DB_NAME].cms_success_stories.delete_many({})
        finally:
            c.close()
    asyncio.get_event_loop().run_until_complete(_wipe())


# ─── Auth / access-control ────────────────────────────────────────────────

class TestAccessControl:
    def test_list_requires_auth(self, anon):
        r = anon.get(f"{BASE_URL}/api/cms/success-stories")
        assert r.status_code in (401, 403), r.text

    def test_create_requires_auth(self, anon):
        r = anon.post(f"{BASE_URL}/api/cms/success-stories", json={})
        assert r.status_code in (401, 403), r.text

    def test_patch_requires_auth(self, anon):
        r = anon.patch(f"{BASE_URL}/api/cms/success-stories/nonexistent", json={"title": "x"})
        assert r.status_code in (401, 403), r.text

    def test_delete_requires_auth(self, anon):
        r = anon.delete(f"{BASE_URL}/api/cms/success-stories/nonexistent")
        assert r.status_code in (401, 403), r.text

    def test_reorder_requires_auth(self, anon):
        r = anon.post(f"{BASE_URL}/api/cms/success-stories/reorder", json={"ids": []})
        assert r.status_code in (401, 403), r.text


# ─── CRUD ─────────────────────────────────────────────────────────────────

class TestSuccessStoriesCRUD:
    def test_create_empty_body_autofills_title(self, client):
        r = client.post(f"{BASE_URL}/api/cms/success-stories", json={})
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["id"]
        assert doc["title"] == "Untitled story"
        assert doc["status"] == "draft"
        assert doc["hidden"] is False
        assert doc["body_html"] == ""
        assert doc["author_name"] == ""
        assert "created_at" in doc and "updated_at" in doc
        _CREATED_IDS.append(doc["id"])

    def test_list_includes_drafts(self, client):
        r = client.get(f"{BASE_URL}/api/cms/success-stories")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "items" in data and "count" in data
        assert data["count"] >= 1
        ids = [i["id"] for i in data["items"]]
        assert _CREATED_IDS[0] in ids

    def test_get_single_story(self, client):
        sid = _CREATED_IDS[0]
        r = client.get(f"{BASE_URL}/api/cms/success-stories/{sid}")
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["id"] == sid
        assert "_id" not in doc  # Mongo _id must be stripped

    def test_get_404_for_missing(self, client):
        r = client.get(f"{BASE_URL}/api/cms/success-stories/does-not-exist")
        assert r.status_code == 404, r.text

    def test_patch_partial_update_persists(self, client):
        sid = _CREATED_IDS[0]
        patch = {
            "title": "TEST_ Margaret's story",
            "body_html": "<p>Hello <strong>world</strong></p>",
            "author_name": "Margaret",
            "author_role": "Founding Member",
            "author_location": "Newcastle, NSW",
        }
        r = client.patch(f"{BASE_URL}/api/cms/success-stories/{sid}", json=patch)
        assert r.status_code == 200, r.text
        doc = r.json()
        for k, v in patch.items():
            assert doc[k] == v
        # Verify persisted via GET
        r2 = client.get(f"{BASE_URL}/api/cms/success-stories/{sid}")
        got = r2.json()
        for k, v in patch.items():
            assert got[k] == v

    def test_patch_invalid_status_rejected(self, client):
        sid = _CREATED_IDS[0]
        r = client.patch(f"{BASE_URL}/api/cms/success-stories/{sid}", json={"status": "banana"})
        assert r.status_code == 400, r.text

    def test_patch_404_for_missing(self, client):
        r = client.patch(f"{BASE_URL}/api/cms/success-stories/does-not-exist", json={"title": "x"})
        assert r.status_code == 404, r.text


# ─── Publish / draft / hidden state machine ───────────────────────────────

class TestPublishStateMachine:
    def test_publish_appears_on_public(self, client, anon):
        sid = _CREATED_IDS[0]
        r = client.patch(f"{BASE_URL}/api/cms/success-stories/{sid}",
                         json={"status": "published", "hidden": False})
        assert r.status_code == 200
        assert r.json()["status"] == "published"

        pub = anon.get(f"{BASE_URL}/api/public/stories")
        assert pub.status_code == 200
        stories = pub.json()["stories"]
        assert any(s["id"] == sid for s in stories), \
            f"Just-published story missing from public list: {stories}"

    def test_move_to_draft_removes_from_public(self, client, anon):
        sid = _CREATED_IDS[0]
        r = client.patch(f"{BASE_URL}/api/cms/success-stories/{sid}",
                         json={"status": "draft"})
        assert r.status_code == 200
        pub = anon.get(f"{BASE_URL}/api/public/stories")
        stories = pub.json()["stories"]
        assert not any(s["id"] == sid for s in stories), \
            f"Draft story still on public list: {stories}"

    def test_hidden_published_hidden_from_public(self, client, anon):
        sid = _CREATED_IDS[0]
        # Publish + hide
        r = client.patch(f"{BASE_URL}/api/cms/success-stories/{sid}",
                         json={"status": "published", "hidden": True})
        assert r.status_code == 200
        pub = anon.get(f"{BASE_URL}/api/public/stories")
        stories = pub.json()["stories"]
        assert not any(s["id"] == sid for s in stories), \
            f"Hidden+published story leaked to public: {stories}"

        # Unhide → should reappear
        r = client.patch(f"{BASE_URL}/api/cms/success-stories/{sid}",
                         json={"hidden": False})
        assert r.status_code == 200
        pub = anon.get(f"{BASE_URL}/api/public/stories")
        assert any(s["id"] == sid for s in pub.json()["stories"])


# ─── Reorder ──────────────────────────────────────────────────────────────

class TestReorder:
    def test_reorder_persists_and_public_respects_order(self, client, anon):
        # Add two more so we have 3 total for a meaningful reorder.
        r1 = client.post(f"{BASE_URL}/api/cms/success-stories", json={})
        r2 = client.post(f"{BASE_URL}/api/cms/success-stories", json={})
        assert r1.status_code == r2.status_code == 200
        id_a, id_b = r1.json()["id"], r2.json()["id"]
        _CREATED_IDS.extend([id_a, id_b])

        # Publish both so they appear on public
        for sid, name in ((id_a, "Alpha"), (id_b, "Beta")):
            r = client.patch(f"{BASE_URL}/api/cms/success-stories/{sid}",
                             json={"status": "published", "hidden": False,
                                   "title": f"TEST_{name}", "author_name": name})
            assert r.status_code == 200

        # Reorder: Beta first, Alpha second, then the first story
        first = _CREATED_IDS[0]
        desired = [id_b, id_a, first]
        r = client.post(f"{BASE_URL}/api/cms/success-stories/reorder", json={"ids": desired})
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        # order field should reflect index
        by_id = {i["id"]: i for i in items}
        assert by_id[id_b]["order"] == 0
        assert by_id[id_a]["order"] == 1
        assert by_id[first]["order"] == 2

        # Public should reflect order asc (id_b, id_a, first)
        pub = anon.get(f"{BASE_URL}/api/public/stories").json()["stories"]
        pub_ids = [s["id"] for s in pub if s["id"] in desired]
        assert pub_ids == desired, f"Public order wrong: got {pub_ids}, want {desired}"


# ─── Delete ───────────────────────────────────────────────────────────────

class TestDelete:
    def test_delete_removes_from_list_and_public(self, client, anon):
        # Create fresh, publish, then delete
        r = client.post(f"{BASE_URL}/api/cms/success-stories",
                        json={"title": "TEST_ToDelete", "author_name": "X",
                              "status": "published"})
        assert r.status_code == 200
        sid = r.json()["id"]
        _CREATED_IDS.append(sid)

        # Confirm visible publicly
        pub = anon.get(f"{BASE_URL}/api/public/stories").json()["stories"]
        assert any(s["id"] == sid for s in pub)

        # Delete
        r = client.delete(f"{BASE_URL}/api/cms/success-stories/{sid}")
        assert r.status_code == 200 and r.json().get("ok") is True

        # Not in admin list
        admin_list = client.get(f"{BASE_URL}/api/cms/success-stories").json()["items"]
        assert not any(s["id"] == sid for s in admin_list)
        # Not on public list
        pub2 = anon.get(f"{BASE_URL}/api/public/stories").json()["stories"]
        assert not any(s["id"] == sid for s in pub2)
        # GET returns 404
        assert client.get(f"{BASE_URL}/api/cms/success-stories/{sid}").status_code == 404
        # DELETE again → 404
        assert client.delete(f"{BASE_URL}/api/cms/success-stories/{sid}").status_code == 404


# ─── Dashboard stats reflect count ────────────────────────────────────────

class TestStats:
    def test_stats_success_stories_count(self, client):
        # Snapshot current count via /cms/success-stories
        listed = client.get(f"{BASE_URL}/api/cms/success-stories").json()
        stats = client.get(f"{BASE_URL}/api/cms/stats").json()
        assert stats["success_stories_count"] == listed["count"]
