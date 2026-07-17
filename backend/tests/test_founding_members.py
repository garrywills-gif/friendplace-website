"""End-to-end tests for the FriendPlace Founding Members CMS module.

Mirrors test_success_stories.py — admin CRUD + reorder, plus the public
read filter, plus the public-payload projection audit (must NOT leak
admin fields like created_by / created_at / updated_at / status /
hidden). Cleans up all rows on teardown.
"""
from __future__ import annotations

import os
import sys
import asyncio
import pytest
import requests

sys.path.insert(0, "/app/backend")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
import cms_module  # noqa: E402

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://belong-together.preview.emergentagent.com",
).rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


# ─── Fixtures ─────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def admin_token():
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
    return cms_module._make_admin_token(admin["id"], admin["email"])


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


_CREATED_IDS: list[str] = []


@pytest.fixture(scope="module", autouse=True)
def _cleanup(client):
    # Wipe first so the empty-state / max(number)+1 logic starts clean.
    async def _wipe():
        c = AsyncIOMotorClient(MONGO_URL)
        try:
            await c[DB_NAME].cms_founding_members.delete_many({})
        finally:
            c.close()
    asyncio.get_event_loop().run_until_complete(_wipe())
    yield
    asyncio.get_event_loop().run_until_complete(_wipe())


# ─── Auth / access-control ────────────────────────────────────────────────

class TestAccessControl:
    def test_list_requires_auth(self, anon):
        r = anon.get(f"{BASE_URL}/api/cms/founding-members")
        assert r.status_code in (401, 403), r.text

    def test_create_requires_auth(self, anon):
        r = anon.post(f"{BASE_URL}/api/cms/founding-members", json={})
        assert r.status_code in (401, 403), r.text

    def test_get_requires_auth(self, anon):
        r = anon.get(f"{BASE_URL}/api/cms/founding-members/xxx")
        assert r.status_code in (401, 403), r.text

    def test_patch_requires_auth(self, anon):
        r = anon.patch(f"{BASE_URL}/api/cms/founding-members/xxx", json={"name": "x"})
        assert r.status_code in (401, 403), r.text

    def test_delete_requires_auth(self, anon):
        r = anon.delete(f"{BASE_URL}/api/cms/founding-members/xxx")
        assert r.status_code in (401, 403), r.text

    def test_reorder_requires_auth(self, anon):
        r = anon.post(f"{BASE_URL}/api/cms/founding-members/reorder", json={"ids": []})
        assert r.status_code in (401, 403), r.text


# ─── CRUD ─────────────────────────────────────────────────────────────────

class TestFoundingMembersCRUD:
    def test_create_empty_body_defaults(self, client):
        r = client.post(f"{BASE_URL}/api/cms/founding-members", json={})
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["id"]
        assert doc["name"] == ""
        assert doc["status"] == "draft"
        assert doc["hidden"] is False
        assert doc["bio_html"] == ""
        assert doc["role"] == ""
        assert doc["location"] == ""
        assert doc["avatar_url"] == ""
        # First member should get number=1 (max+1 with empty collection).
        assert doc["number"] == 1
        assert isinstance(doc["number"], int)
        assert "created_at" in doc and "updated_at" in doc
        _CREATED_IDS.append(doc["id"])

    def test_second_create_auto_increments_number(self, client):
        r = client.post(f"{BASE_URL}/api/cms/founding-members", json={})
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["number"] == 2, f"expected max+1=2, got {doc['number']}"
        _CREATED_IDS.append(doc["id"])

    def test_list_includes_drafts_sorted(self, client):
        r = client.get(f"{BASE_URL}/api/cms/founding-members")
        assert r.status_code == 200
        data = r.json()
        assert "items" in data and "count" in data
        assert data["count"] >= 2
        # Sort must be order asc then number asc
        orders = [i.get("order", 0) for i in data["items"]]
        assert orders == sorted(orders)

    def test_get_single(self, client):
        mid = _CREATED_IDS[0]
        r = client.get(f"{BASE_URL}/api/cms/founding-members/{mid}")
        assert r.status_code == 200
        doc = r.json()
        assert doc["id"] == mid
        assert "_id" not in doc

    def test_get_404(self, client):
        r = client.get(f"{BASE_URL}/api/cms/founding-members/does-not-exist")
        assert r.status_code == 404

    def test_patch_partial_update_persists(self, client):
        mid = _CREATED_IDS[0]
        patch = {
            "name": "TEST_Margaret",
            "role": "Founding Member",
            "location": "Newcastle, NSW",
            "bio_html": "<p>Loves gardening</p>",
            "avatar_url": "🌸",
            "number": 42,
        }
        r = client.patch(f"{BASE_URL}/api/cms/founding-members/{mid}", json=patch)
        assert r.status_code == 200, r.text
        doc = r.json()
        for k, v in patch.items():
            assert doc[k] == v, f"{k}: {doc[k]} != {v}"
        # Re-read persists
        got = client.get(f"{BASE_URL}/api/cms/founding-members/{mid}").json()
        for k, v in patch.items():
            assert got[k] == v

    def test_patch_invalid_status(self, client):
        mid = _CREATED_IDS[0]
        r = client.patch(f"{BASE_URL}/api/cms/founding-members/{mid}",
                         json={"status": "banana"})
        assert r.status_code == 400

    def test_patch_404(self, client):
        r = client.patch(f"{BASE_URL}/api/cms/founding-members/does-not-exist",
                         json={"name": "x"})
        assert r.status_code == 404


# ─── Publish / hidden state machine + public projection audit ─────────────

class TestPublishStateMachine:
    _ADMIN_ONLY_FIELDS = ("created_by", "created_at", "updated_at", "status", "hidden")
    _REQUIRED_PUBLIC_FIELDS = ("id", "name", "number", "role", "location",
                               "avatar_url", "bio_html", "order", "avatar")

    def test_public_envelope_shape(self, anon):
        r = anon.get(f"{BASE_URL}/api/public/founders")
        assert r.status_code == 200
        payload = r.json()
        assert set(payload.keys()) >= {"members", "count", "cap"}
        assert payload["cap"] == 250
        assert isinstance(payload["members"], list)
        assert isinstance(payload["count"], int)

    def test_draft_not_public(self, anon):
        mid = _CREATED_IDS[0]  # still draft
        pub = anon.get(f"{BASE_URL}/api/public/founders").json()
        assert not any(m["id"] == mid for m in pub["members"]), \
            "Draft member leaked to public feed"

    def test_publish_appears_on_public(self, client, anon):
        mid = _CREATED_IDS[0]
        r = client.patch(f"{BASE_URL}/api/cms/founding-members/{mid}",
                         json={"status": "published", "hidden": False,
                               "name": "TEST_Margaret", "number": 42})
        assert r.status_code == 200
        pub = anon.get(f"{BASE_URL}/api/public/founders").json()
        match = [m for m in pub["members"] if m["id"] == mid]
        assert match, "Published member missing from /api/public/founders"
        m = match[0]
        # Required fields present
        for f in self._REQUIRED_PUBLIC_FIELDS:
            assert f in m, f"public member missing '{f}': {m}"
        # avatar alias must equal avatar_url
        assert m["avatar"] == m["avatar_url"]
        # Admin-only fields MUST NOT leak
        for f in self._ADMIN_ONLY_FIELDS:
            assert f not in m, f"public member leaked admin field '{f}': {m}"

    def test_move_to_draft_removes_from_public(self, client, anon):
        mid = _CREATED_IDS[0]
        r = client.patch(f"{BASE_URL}/api/cms/founding-members/{mid}",
                         json={"status": "draft"})
        assert r.status_code == 200
        pub = anon.get(f"{BASE_URL}/api/public/founders").json()
        assert not any(m["id"] == mid for m in pub["members"])

    def test_hidden_hides_from_public(self, client, anon):
        mid = _CREATED_IDS[0]
        r = client.patch(f"{BASE_URL}/api/cms/founding-members/{mid}",
                         json={"status": "published", "hidden": True})
        assert r.status_code == 200
        pub = anon.get(f"{BASE_URL}/api/public/founders").json()
        assert not any(m["id"] == mid for m in pub["members"]), \
            "Hidden+published member leaked to public feed"
        # Unhide restores
        r = client.patch(f"{BASE_URL}/api/cms/founding-members/{mid}",
                         json={"hidden": False})
        assert r.status_code == 200
        pub = anon.get(f"{BASE_URL}/api/public/founders").json()
        assert any(m["id"] == mid for m in pub["members"])


# ─── Reorder ──────────────────────────────────────────────────────────────

class TestReorder:
    def test_reorder_persists_and_public_respects_order(self, client, anon):
        # Ensure we have 3 published members for a meaningful reorder.
        # _CREATED_IDS[0] is already published (from the state machine).
        # Add one more, publish both remaining drafts.
        r_new = client.post(f"{BASE_URL}/api/cms/founding-members", json={})
        assert r_new.status_code == 200
        new_id = r_new.json()["id"]
        _CREATED_IDS.append(new_id)

        # Publish everything remaining
        for mid, name, num in (
            (_CREATED_IDS[1], "TEST_Beta", 100),
            (new_id, "TEST_Gamma", 101),
        ):
            r = client.patch(
                f"{BASE_URL}/api/cms/founding-members/{mid}",
                json={"status": "published", "hidden": False,
                      "name": name, "number": num},
            )
            assert r.status_code == 200, r.text

        desired = [new_id, _CREATED_IDS[1], _CREATED_IDS[0]]
        r = client.post(f"{BASE_URL}/api/cms/founding-members/reorder",
                        json={"ids": desired})
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        by_id = {i["id"]: i for i in items}
        assert by_id[desired[0]]["order"] == 0
        assert by_id[desired[1]]["order"] == 1
        assert by_id[desired[2]]["order"] == 2

        # Public should reflect order asc
        pub = anon.get(f"{BASE_URL}/api/public/founders").json()["members"]
        pub_ids = [m["id"] for m in pub if m["id"] in desired]
        assert pub_ids == desired, f"Public order wrong: got {pub_ids}, want {desired}"


# ─── Delete ───────────────────────────────────────────────────────────────

class TestDelete:
    def test_delete_removes_row(self, client, anon):
        r = client.post(f"{BASE_URL}/api/cms/founding-members",
                        json={"name": "TEST_ToDelete", "number": 999,
                              "status": "published"})
        assert r.status_code == 200
        mid = r.json()["id"]
        _CREATED_IDS.append(mid)

        # Visible publicly first
        pub = anon.get(f"{BASE_URL}/api/public/founders").json()["members"]
        assert any(m["id"] == mid for m in pub)

        r = client.delete(f"{BASE_URL}/api/cms/founding-members/{mid}")
        assert r.status_code == 200 and r.json().get("ok") is True

        # Gone from admin list
        listed = client.get(f"{BASE_URL}/api/cms/founding-members").json()["items"]
        assert not any(m["id"] == mid for m in listed)
        # Gone from public
        pub2 = anon.get(f"{BASE_URL}/api/public/founders").json()["members"]
        assert not any(m["id"] == mid for m in pub2)
        # GET → 404, DELETE idempotent → 404
        assert client.get(f"{BASE_URL}/api/cms/founding-members/{mid}").status_code == 404
        assert client.delete(f"{BASE_URL}/api/cms/founding-members/{mid}").status_code == 404


# ─── Dashboard stats reflect editable count (drafts + published) ──────────

class TestStats:
    def test_stats_founding_members_editable_count(self, client):
        listed = client.get(f"{BASE_URL}/api/cms/founding-members").json()
        stats = client.get(f"{BASE_URL}/api/cms/stats").json()
        assert "founding_members_count_editable" in stats
        assert stats["founding_members_count_editable"] == listed["count"], \
            f"stats {stats['founding_members_count_editable']} != list {listed['count']}"
        # Sanity: this counter is DIFFERENT from founder_signups_count (users table)
        assert "founder_signups_count" in stats
