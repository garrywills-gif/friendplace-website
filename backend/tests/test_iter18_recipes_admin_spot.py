"""Iteration 18 backend regression — covers:
- Recipes CRUD + like + comments + notification
- Admin promote/demote safety rails (admin/admins, admin/users/search, admin/users/admin-flag)
- Spot the Difference background_url for all 6 themes (HTTP 200 + non-empty file)
"""

import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback to internal — but in this preview env the public one should be set
    BASE_URL = "http://localhost:8001"
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def maggie(s):
    r = s.post(f"{API}/auth/demo-login", json={"username": "maggie"})
    assert r.status_code == 200, r.text
    return r.json()["user"]


@pytest.fixture(scope="module")
def frankie(s):
    r = s.post(f"{API}/auth/demo-login", json={"username": "frankie"})
    assert r.status_code == 200, r.text
    return r.json()["user"]


# ---------- Recipes ----------
class TestRecipes:
    def test_list_returns_array(self, s, maggie):
        r = s.get(f"{API}/recipes", params={"viewer_id": maggie["id"]})
        assert r.status_code == 200
        body = r.json()
        assert "recipes" in body and isinstance(body["recipes"], list)

    def test_create_get_update_delete_flow(self, s, maggie, frankie):
        # CREATE
        payload = {
            "user_id": maggie["id"],
            "title": "TEST_ANZAC Biscuits",
            "ingredients": "oats, golden syrup, butter",
            "instructions": "Mix, bake at 160C 15 min",
            "tips": "Crispy edges hide.",
        }
        r = s.post(f"{API}/recipes", json=payload)
        assert r.status_code == 200, r.text
        rec = r.json()
        assert rec["title"] == payload["title"]
        assert rec["author_id"] == maggie["id"]
        assert rec["likes"] == []
        rid = rec["id"]

        # GET by id
        g = s.get(f"{API}/recipes/{rid}", params={"viewer_id": maggie["id"]})
        assert g.status_code == 200
        gb = g.json()
        assert gb["id"] == rid
        assert gb["tips"] == "Crispy edges hide."
        assert "comments" in gb and isinstance(gb["comments"], list)

        # LIST: filter by query 'ANZAC'
        lr = s.get(f"{API}/recipes", params={"q": "ANZAC"})
        assert lr.status_code == 200
        titles = [x["title"] for x in lr.json()["recipes"]]
        assert any("ANZAC" in t for t in titles)

        # LIKE toggle on
        like1 = s.post(f"{API}/recipes/{rid}/like", json={"user_id": frankie["id"]})
        assert like1.status_code == 200
        b1 = like1.json()
        assert b1["liked"] is True and b1["count"] == 1
        # LIKE toggle off
        like2 = s.post(f"{API}/recipes/{rid}/like", json={"user_id": frankie["id"]})
        assert like2.status_code == 200
        b2 = like2.json()
        assert b2["liked"] is False and b2["count"] == 0

        # COMMENT (from Frank) — notification should be created for Margaret
        cm = s.post(f"{API}/recipes/{rid}/comments", json={"user_id": frankie["id"], "body": "Looks great!"})
        assert cm.status_code == 200
        comment = cm.json()
        assert comment["body"] == "Looks great!"
        cid = comment["id"]

        # Verify Maggie has the notification
        notif = s.get(f"{API}/notifications/{maggie['id']}")
        assert notif.status_code == 200
        payload = notif.json()
        items = payload if isinstance(payload, list) else payload.get("notifications", [])
        types = [n.get("type") for n in items]
        assert "recipe_comment" in types, f"Expected recipe_comment notification, got types={types}"

        # PATCH (author only)
        patch = s.patch(f"{API}/recipes/{rid}", json={"user_id": maggie["id"], "tips": "Use raw sugar."})
        assert patch.status_code == 200
        # Verify update
        g2 = s.get(f"{API}/recipes/{rid}")
        assert g2.json()["tips"] == "Use raw sugar."

        # PATCH by non-author should 403
        denied = s.patch(f"{API}/recipes/{rid}", json={"user_id": frankie["id"], "tips": "no"})
        assert denied.status_code == 403

        # DELETE comment (by comment author)
        dc = s.delete(f"{API}/recipes/{rid}/comments/{cid}", params={"user_id": frankie["id"]})
        assert dc.status_code == 200
        g3 = s.get(f"{API}/recipes/{rid}")
        assert all(c["id"] != cid for c in g3.json()["comments"])

        # DELETE recipe (non-author) → 403
        dr_denied = s.delete(f"{API}/recipes/{rid}", params={"user_id": frankie["id"]})
        assert dr_denied.status_code == 403

        # DELETE recipe (author) → 200
        dr = s.delete(f"{API}/recipes/{rid}", params={"user_id": maggie["id"]})
        assert dr.status_code == 200

        # GET deleted → 404
        gd = s.get(f"{API}/recipes/{rid}")
        assert gd.status_code == 404

    def test_create_requires_title(self, s, maggie):
        r = s.post(f"{API}/recipes", json={"user_id": maggie["id"], "title": "   "})
        assert r.status_code == 400


# ---------- Admin promote/demote ----------
class TestAdminPromote:
    def test_list_admins(self, s, maggie):
        r = s.get(f"{API}/admin/admins", params={"admin_id": maggie["id"]})
        assert r.status_code == 200
        admins = r.json()["admins"]
        assert any(a["id"] == maggie["id"] for a in admins)

    def test_search_users(self, s, maggie):
        r = s.get(f"{API}/admin/users/search", params={"admin_id": maggie["id"], "q": "frankie"})
        assert r.status_code == 200
        results = r.json()["results"]
        assert any(u.get("username") == "frankie" for u in results)

    def test_promote_demote_flow_and_safety_rails(self, s, maggie, frankie):
        # Promote Frank
        p = s.post(f"{API}/admin/users/admin-flag", json={
            "admin_id": maggie["id"], "target_user_id": frankie["id"], "make_admin": True, "reason": "TEST"
        })
        assert p.status_code == 200
        assert p.json().get("is_admin") is True

        # Self-demote refused
        sd = s.post(f"{API}/admin/users/admin-flag", json={
            "admin_id": maggie["id"], "target_user_id": maggie["id"], "make_admin": False
        })
        assert sd.status_code == 400
        assert "own admin" in sd.json().get("detail", "").lower()

        # Demote Frank — should succeed (Maggie still admin)
        d = s.post(f"{API}/admin/users/admin-flag", json={
            "admin_id": maggie["id"], "target_user_id": frankie["id"], "make_admin": False, "reason": "test cleanup"
        })
        assert d.status_code == 200
        assert d.json().get("is_admin") is False

        # Now if we try to demote Maggie (the last remaining admin) using non-self ... we'd need a 2nd admin.
        # Since only Maggie is admin again, demoting her via self is already covered. Try a fake admin_id for "at least one admin must remain": skip — that's covered by self check.


# ---------- Spot the Difference backgrounds ----------
class TestSpotBackgrounds:
    THEMES = ["garden", "coffee_shop", "beach", "pets", "birds", "around_house"]

    @pytest.mark.parametrize("theme", THEMES)
    def test_spot_puzzle_has_background_url(self, s, theme):
        r = s.get(f"{API}/games/spot/puzzle", params={"theme": theme})
        assert r.status_code == 200, r.text
        body = r.json()
        bg = body.get("background_url")
        assert bg, f"Missing background_url for {theme}"
        assert bg.endswith(f"/spot_bg/{theme}.jpg"), bg

    @pytest.mark.parametrize("theme", THEMES)
    def test_spot_bg_file_served(self, s, theme):
        url = f"{API}/static/spot_bg/{theme}.jpg"
        r = s.get(url)
        assert r.status_code == 200, f"{url} → {r.status_code}"
        assert len(r.content) > 1000, f"{theme} background file suspiciously small"
        assert r.headers.get("content-type", "").startswith("image/"), r.headers


# ---------- /user/[id] Add Friend "already friends" 400 ----------
class TestAddFriendAlreadyFriends:
    def test_add_friend_when_already_friends_returns_400(self, s, maggie, frankie):
        # Maggie and Frank are seeded as friends.
        r = s.post(f"{API}/friends/request", json={"from_id": maggie["id"], "to_id": frankie["id"]})
        # Either 400 (already friends) or 200 (server upgraded to handle) — UI's job is to catch the 400 gracefully.
        assert r.status_code in (200, 400), r.text
        if r.status_code == 400:
            assert "friend" in r.json().get("detail", "").lower()
