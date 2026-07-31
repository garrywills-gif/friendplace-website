"""Backend tests for the Share a Moment feature.

Covers:
  1. Public / member endpoints  (POST/GET/PATCH/DELETE /api/moments/*)
  2. Admin (mobile-admin gate)  (GET/POST /api/admin/moments*)
  3. CMS admin endpoints        (GET/POST/DELETE /api/cms/moments*)
  4. George navigate whitelist  (moments in, recipes out, alias resolves)
  5. Regression                 (recipes routes still respond)

Run:
    pytest /app/backend/tests/test_moments.py -v --tb=short \
        --junitxml=/app/test_reports/pytest/moments_results.xml
"""
import os
import uuid
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set (see /app/frontend/.env)"

API = f"{BASE_URL}/api"

CMS_EMAIL = "hello@friendplace.com.au"
CMS_PASSWORD = "TestPass2026!"

# 1x1 transparent PNG (base64 data URI) — small enough to keep the
# moment doc under Mongo's 16 MB limit even with 6 copies.
TINY_PNG = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _signup(api_client, tag: str) -> dict:
    """Create a fresh member and return {id, token, username}."""
    username = f"TESTmom_{tag}_{uuid.uuid4().hex[:6]}"
    r = api_client.post(f"{API}/auth/signup", json={
        "username": username,
        "password": "TestPass2026!",
        "email": f"{username}@example.com",
        "first_name": tag.capitalize(),
    })
    assert r.status_code == 200, f"signup failed: {r.status_code} {r.text}"
    j = r.json()
    return {
        "id": j["user"]["id"],
        "token": j["access_token"],
        "username": username,
        "first_name": j["user"].get("first_name") or tag.capitalize(),
    }


@pytest.fixture(scope="module")
def author(api_client):
    return _signup(api_client, "author")


@pytest.fixture(scope="module")
def friend(api_client):
    return _signup(api_client, "friend")


@pytest.fixture(scope="module")
def stranger(api_client):
    return _signup(api_client, "stranger")


@pytest.fixture(scope="module")
def friendship(api_client, author, friend):
    """Make author + friend mutual friends via the friend-request flow."""
    r1 = api_client.post(
        f"{API}/friends/request",
        json={"from_id": author["id"], "to_id": friend["id"]},
    )
    assert r1.status_code in (200, 201), f"friend req: {r1.status_code} {r1.text}"
    req_id = r1.json().get("id")
    if req_id:
        r2 = api_client.post(f"{API}/friends/accept/{req_id}")
        assert r2.status_code == 200, f"accept: {r2.status_code} {r2.text}"
    return True


@pytest.fixture(scope="module")
def cms_admin_token(api_client):
    r = api_client.post(f"{API}/cms/auth/login", json={
        "email": CMS_EMAIL, "password": CMS_PASSWORD,
    })
    assert r.status_code == 200, f"cms login: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok, f"no token in cms login response: {r.text}"
    return tok


@pytest.fixture(scope="module")
def cms_admin_headers(cms_admin_token):
    return {"Authorization": f"Bearer {cms_admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_user_id(cms_admin_headers, api_client):
    """
    /api/admin/moments requires an is_admin=true user_id in Mongo.
    We look one up from /api/cms/... side or fall back to querying users
    admin flag via a direct helper endpoint. Simpler: use the seeded
    demo admin `maggie` (per /app/memory/test_credentials.md).
    """
    # Demo accounts listing doesn't expose IDs; log in as maggie (admin
    # per /app/memory/test_credentials.md) to resolve her user_id.
    r = api_client.post(f"{API}/auth/demo-login", json={"username": "maggie"})
    if r.status_code != 200:
        pytest.skip(f"demo-login for maggie failed: {r.status_code} {r.text}")
    data = r.json()
    uid = (data.get("user") or {}).get("id") or data.get("id")
    if not uid:
        pytest.skip(f"No user id in demo-login response: {data}")
    return uid


# ---------------------------------------------------------------------------
# 1. Public / member endpoints
# ---------------------------------------------------------------------------

class TestMomentCreate:
    def test_create_with_caption_only(self, api_client, author):
        r = api_client.post(f"{API}/moments", json={
            "user_id": author["id"],
            "caption": "TEST_moment caption only",
            "privacy": "everyone",
        })
        assert r.status_code == 200, r.text
        m = r.json()
        assert m["caption"] == "TEST_moment caption only"
        assert m["privacy"] == "everyone"
        assert m["author_id"] == author["id"]
        assert m["likes_count"] == 0 and m["comments_count"] == 0
        # persistence check
        got = api_client.get(f"{API}/moments/{m['id']}", params={"viewer_id": author["id"]})
        assert got.status_code == 200
        assert got.json()["id"] == m["id"]

    def test_reject_empty_caption_and_photos(self, api_client, author):
        r = api_client.post(f"{API}/moments", json={
            "user_id": author["id"], "caption": "   ", "photos": [], "privacy": "everyone",
        })
        assert r.status_code == 400, r.text

    def test_reject_caption_over_500_chars(self, api_client, author):
        r = api_client.post(f"{API}/moments", json={
            "user_id": author["id"], "caption": "x" * 501, "privacy": "everyone",
        })
        assert r.status_code == 400, r.text

    def test_truncate_photos_to_six(self, api_client, author):
        r = api_client.post(f"{API}/moments", json={
            "user_id": author["id"],
            "caption": "TEST_ eight photos",
            "photos": [TINY_PNG] * 8,
            "privacy": "everyone",
        })
        assert r.status_code == 200, r.text
        m = r.json()
        assert len(m["photos"]) == 6, f"expected 6, got {len(m['photos'])}"

    def test_award_points_on_create(self, api_client):
        # Use a freshly-created user so their point balance is deterministic (0 → 8).
        me = _signup(api_client, "points")
        headers = {"Authorization": f"Bearer {me['token']}"}
        before = api_client.get(f"{API}/auth/me", headers=headers)
        assert before.status_code == 200, before.text
        user_before = before.json().get("user") or before.json()
        pts_before = int(
            user_before.get("points")
            or user_before.get("butterfly_points")
            or 0
        )
        r = api_client.post(f"{API}/moments", json={
            "user_id": me["id"], "caption": "TEST_ point award moment",
        })
        assert r.status_code == 200, r.text
        after = api_client.get(f"{API}/auth/me", headers=headers)
        assert after.status_code == 200, after.text
        user_after = after.json().get("user") or after.json()
        pts_after = int(
            user_after.get("points")
            or user_after.get("butterfly_points")
            or 0
        )
        assert pts_after - pts_before == 8, (
            f"expected +8 butterfly points, got {pts_after - pts_before} "
            f"(before={pts_before}, after={pts_after})"
        )

    def test_reject_unknown_user(self, api_client):
        r = api_client.post(f"{API}/moments", json={
            "user_id": "does-not-exist", "caption": "x",
        })
        assert r.status_code == 404, r.text


class TestMomentList:
    def test_everyone_scope_excludes_friends_only(
        self, api_client, author, friend, stranger, friendship
    ):
        # author posts a friends-only moment
        r = api_client.post(f"{API}/moments", json={
            "user_id": author["id"],
            "caption": "TEST_friends only secret",
            "privacy": "friends",
        })
        assert r.status_code == 200
        mid = r.json()["id"]

        # stranger scope=everyone must NOT see the friends-only post
        listed = api_client.get(f"{API}/moments", params={
            "scope": "everyone", "viewer_id": stranger["id"], "q": "TEST_friends only secret",
        })
        assert listed.status_code == 200
        ids = [m["id"] for m in listed.json()["moments"]]
        assert mid not in ids

        # friend can see it via scope=friends
        listed2 = api_client.get(f"{API}/moments", params={
            "scope": "friends", "viewer_id": friend["id"],
        })
        assert listed2.status_code == 200
        ids2 = [m["id"] for m in listed2.json()["moments"]]
        assert mid in ids2

    def test_friends_scope_excludes_strangers(self, api_client, author, stranger):
        r = api_client.get(f"{API}/moments", params={
            "scope": "friends", "viewer_id": stranger["id"],
        })
        assert r.status_code == 200
        # stranger has no friends; feed should not contain any moment
        # authored by `author` (they're not friends).
        for m in r.json()["moments"]:
            assert m["author_id"] != author["id"], (
                "stranger should not see author's moments via scope=friends"
            )


class TestMomentDetail:
    def test_404_when_missing(self, api_client, author):
        r = api_client.get(f"{API}/moments/does-not-exist", params={"viewer_id": author["id"]})
        assert r.status_code == 404

    def test_403_for_stranger_on_friends_only(self, api_client, author, stranger):
        c = api_client.post(f"{API}/moments", json={
            "user_id": author["id"], "caption": "TEST_ private hi",
            "privacy": "friends",
        })
        mid = c.json()["id"]
        r = api_client.get(f"{API}/moments/{mid}", params={"viewer_id": stranger["id"]})
        assert r.status_code == 403


class TestMomentLikeComment:
    @pytest.fixture(scope="class")
    def moment_id(self, api_client, author):
        r = api_client.post(f"{API}/moments", json={
            "user_id": author["id"], "caption": "TEST_ like me",
        })
        return r.json()["id"]

    def test_like_toggle(self, api_client, friend, moment_id):
        r1 = api_client.post(f"{API}/moments/{moment_id}/like", json={"user_id": friend["id"]})
        assert r1.status_code == 200, r1.text
        assert r1.json() == {"liked": True, "count": 1}
        r2 = api_client.post(f"{API}/moments/{moment_id}/like", json={"user_id": friend["id"]})
        assert r2.status_code == 200
        assert r2.json() == {"liked": False, "count": 0}

    def test_comment_and_notify(self, api_client, friend, author, moment_id):
        r = api_client.post(f"{API}/moments/{moment_id}/comments", json={
            "user_id": friend["id"], "body": "TEST_ lovely!",
        })
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["body"] == "TEST_ lovely!"

        # verify comment shows up in detail
        d = api_client.get(f"{API}/moments/{moment_id}", params={"viewer_id": author["id"]})
        assert d.status_code == 200
        ids = [x["id"] for x in d.json().get("comments", [])]
        assert c["id"] in ids

        # verify a notification was created for the author
        # (the /notifications endpoint takes user_id as a query or path param)
        n = api_client.get(f"{API}/notifications", params={"user_id": author["id"]})
        if n.status_code == 200:
            payload = n.json()
            items = payload if isinstance(payload, list) else payload.get("notifications", [])
            assert any(
                x.get("type") == "moment_comment" and x.get("ref_id") == moment_id
                for x in items
            ), f"moment_comment notification missing for author"

    def test_delete_comment_by_author(self, api_client, author, friend, moment_id):
        r = api_client.post(f"{API}/moments/{moment_id}/comments", json={
            "user_id": friend["id"], "body": "TEST_ deletable",
        })
        cid = r.json()["id"]
        # random stranger cannot delete
        stranger = _signup(api_client, "cdel")
        no = api_client.delete(
            f"{API}/moments/{moment_id}/comments/{cid}",
            params={"user_id": stranger["id"]},
        )
        assert no.status_code == 403, no.text
        # author of the moment can delete
        ok = api_client.delete(
            f"{API}/moments/{moment_id}/comments/{cid}",
            params={"user_id": author["id"]},
        )
        assert ok.status_code == 200, ok.text


class TestMomentReport:
    @pytest.fixture(scope="class")
    def moment_id(self, api_client, author):
        r = api_client.post(f"{API}/moments", json={
            "user_id": author["id"], "caption": "TEST_ report me",
        })
        return r.json()["id"]

    def test_valid_reason(self, api_client, friend, moment_id):
        r = api_client.post(f"{API}/moments/{moment_id}/report", json={
            "user_id": friend["id"], "reason": "spam",
        })
        assert r.status_code == 200, r.text
        assert r.json().get("already_reported") is False

    def test_dedup(self, api_client, friend, moment_id):
        r = api_client.post(f"{API}/moments/{moment_id}/report", json={
            "user_id": friend["id"], "reason": "inappropriate",
        })
        assert r.status_code == 200
        assert r.json().get("already_reported") is True

    def test_invalid_reason(self, api_client, friend, moment_id):
        r = api_client.post(f"{API}/moments/{moment_id}/report", json={
            "user_id": friend["id"], "reason": "nonsense",
        })
        assert r.status_code == 400, r.text


class TestMomentPatchDelete:
    def test_patch_caption(self, api_client, author):
        c = api_client.post(f"{API}/moments", json={
            "user_id": author["id"], "caption": "TEST_ before edit",
        })
        mid = c.json()["id"]
        r = api_client.patch(f"{API}/moments/{mid}", json={
            "user_id": author["id"], "caption": "TEST_ after edit",
        })
        assert r.status_code == 200, r.text
        got = api_client.get(f"{API}/moments/{mid}", params={"viewer_id": author["id"]})
        assert got.json()["caption"] == "TEST_ after edit"

    def test_patch_rejects_non_author(self, api_client, author, stranger):
        c = api_client.post(f"{API}/moments", json={
            "user_id": author["id"], "caption": "TEST_ mine",
        })
        mid = c.json()["id"]
        r = api_client.patch(f"{API}/moments/{mid}", json={
            "user_id": stranger["id"], "caption": "hijack",
        })
        assert r.status_code == 403

    def test_patch_invalid_privacy(self, api_client, author):
        c = api_client.post(f"{API}/moments", json={
            "user_id": author["id"], "caption": "TEST_ p",
        })
        mid = c.json()["id"]
        r = api_client.patch(f"{API}/moments/{mid}", json={
            "user_id": author["id"], "privacy": "public",
        })
        assert r.status_code == 400

    def test_delete_by_author(self, api_client, author):
        c = api_client.post(f"{API}/moments", json={
            "user_id": author["id"], "caption": "TEST_ delete me",
        })
        mid = c.json()["id"]
        r = api_client.delete(f"{API}/moments/{mid}", params={"user_id": author["id"]})
        assert r.status_code == 200
        r2 = api_client.get(f"{API}/moments/{mid}", params={"viewer_id": author["id"]})
        assert r2.status_code == 404


# ---------------------------------------------------------------------------
# 3. CMS admin endpoints
# ---------------------------------------------------------------------------

class TestCmsMomentsAdmin:
    @pytest.fixture(scope="class")
    def seeded_moments(self, api_client, author, friend):
        # A public moment and a reported one.
        m1 = api_client.post(f"{API}/moments", json={
            "user_id": author["id"], "caption": "TEST_ cms A",
        }).json()
        m2 = api_client.post(f"{API}/moments", json={
            "user_id": author["id"], "caption": "TEST_ cms B",
        }).json()
        # Add a report to m2
        api_client.post(f"{API}/moments/{m2['id']}/report", json={
            "user_id": friend["id"], "reason": "spam",
        })
        return {"public": m1["id"], "reported": m2["id"]}

    def test_list_requires_auth(self, api_client):
        r = api_client.get(f"{API}/cms/moments")
        assert r.status_code in (401, 403)

    def test_list_summary(self, api_client, cms_admin_headers, seeded_moments):
        r = api_client.get(f"{API}/cms/moments", headers=cms_admin_headers)
        assert r.status_code == 200, r.text
        j = r.json()
        for key in ("count", "total", "reported", "hidden", "featured_id", "rows"):
            assert key in j, f"missing key {key} in cms moments list"
        assert isinstance(j["rows"], list)

    def test_filter_reported(self, api_client, cms_admin_headers, seeded_moments):
        r = api_client.get(
            f"{API}/cms/moments",
            params={"filter": "reported"},
            headers=cms_admin_headers,
        )
        assert r.status_code == 200
        ids = [row["id"] for row in r.json()["rows"]]
        assert seeded_moments["reported"] in ids

    def test_get_detail(self, api_client, cms_admin_headers, seeded_moments):
        mid = seeded_moments["public"]
        r = api_client.get(f"{API}/cms/moments/{mid}", headers=cms_admin_headers)
        assert r.status_code == 200
        j = r.json()
        assert j["id"] == mid
        assert "comments" in j and "reports" in j

    def test_feature_only_one_at_a_time(
        self, api_client, cms_admin_headers, seeded_moments
    ):
        a = seeded_moments["public"]
        b = seeded_moments["reported"]
        # feature A
        r1 = api_client.post(
            f"{API}/cms/moments/{a}/action",
            headers=cms_admin_headers, json={"action": "feature"},
        )
        assert r1.status_code == 200, r1.text
        # feature B → A should auto-unfeature
        r2 = api_client.post(
            f"{API}/cms/moments/{b}/action",
            headers=cms_admin_headers, json={"action": "feature"},
        )
        assert r2.status_code == 200
        # verify A is no longer featured
        det_a = api_client.get(f"{API}/cms/moments/{a}", headers=cms_admin_headers).json()
        det_b = api_client.get(f"{API}/cms/moments/{b}", headers=cms_admin_headers).json()
        assert det_a["featured"] is False
        assert det_b["featured"] is True

        # /moments/featured should return B (public gate)
        feat = api_client.get(f"{API}/moments/featured")
        assert feat.status_code == 200
        assert (feat.json().get("moment") or {}).get("id") == b

    def test_hide_and_restore(self, api_client, cms_admin_headers, seeded_moments):
        mid = seeded_moments["public"]
        r = api_client.post(
            f"{API}/cms/moments/{mid}/action",
            headers=cms_admin_headers, json={"action": "hide"},
        )
        assert r.status_code == 200
        det = api_client.get(f"{API}/cms/moments/{mid}", headers=cms_admin_headers).json()
        assert det["hidden"] is True
        assert det["featured"] is False  # auto-unfeatured

        r2 = api_client.post(
            f"{API}/cms/moments/{mid}/action",
            headers=cms_admin_headers, json={"action": "restore"},
        )
        assert r2.status_code == 200
        det2 = api_client.get(f"{API}/cms/moments/{mid}", headers=cms_admin_headers).json()
        assert det2["hidden"] is False

    def test_clear_reports(self, api_client, cms_admin_headers, seeded_moments):
        mid = seeded_moments["reported"]
        r = api_client.post(
            f"{API}/cms/moments/{mid}/action",
            headers=cms_admin_headers, json={"action": "clear_reports"},
        )
        assert r.status_code == 200
        det = api_client.get(f"{API}/cms/moments/{mid}", headers=cms_admin_headers).json()
        assert det["reports_count"] == 0

    def test_unknown_action(self, api_client, cms_admin_headers, seeded_moments):
        r = api_client.post(
            f"{API}/cms/moments/{seeded_moments['public']}/action",
            headers=cms_admin_headers, json={"action": "explode"},
        )
        assert r.status_code == 400

    def test_delete(self, api_client, cms_admin_headers, author):
        c = api_client.post(f"{API}/moments", json={
            "user_id": author["id"], "caption": "TEST_ cms deleteme",
        })
        mid = c.json()["id"]
        r = api_client.delete(f"{API}/cms/moments/{mid}", headers=cms_admin_headers)
        assert r.status_code == 200
        r2 = api_client.get(f"{API}/cms/moments/{mid}", headers=cms_admin_headers)
        assert r2.status_code == 404


# ---------------------------------------------------------------------------
# 2. Admin (mobile) /api/admin/moments endpoints
# ---------------------------------------------------------------------------

class TestMobileAdminMoments:
    def test_requires_admin(self, api_client, stranger):
        r = api_client.get(f"{API}/admin/moments", params={"user_id": stranger["id"]})
        assert r.status_code == 403

    def test_list_ok_for_admin(self, api_client, admin_user_id):
        r = api_client.get(f"{API}/admin/moments", params={"user_id": admin_user_id})
        assert r.status_code == 200, r.text
        assert "moments" in r.json()

    def test_action_gate(self, api_client, author, stranger):
        c = api_client.post(f"{API}/moments", json={
            "user_id": author["id"], "caption": "TEST_ admin action",
        })
        mid = c.json()["id"]
        # non-admin can't act
        r = api_client.post(f"{API}/admin/moments/{mid}/action", json={
            "user_id": stranger["id"], "action": "feature",
        })
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# 4. George navigate whitelist
# ---------------------------------------------------------------------------

class TestGeorgeNavigateMap:
    def test_moments_in_whitelist_recipes_out(self):
        from services.george.event_creation.service import (
            _NAVIGATE_KEYS, _clean_navigate_to,
        )
        assert "moments" in _NAVIGATE_KEYS
        assert "recipes" not in _NAVIGATE_KEYS

    def test_recipes_alias_redirects_to_moments(self):
        from services.george.event_creation.service import _clean_navigate_to
        # recipes should be aliased to moments and pass the whitelist gate
        out = _clean_navigate_to({"key": "recipes", "label": "Open recipes"})
        assert out is not None, "recipes alias returned None"
        assert out.get("key") == "moments"

    def test_moments_passes_through(self):
        from services.george.event_creation.service import _clean_navigate_to
        out = _clean_navigate_to({"key": "moments", "label": "Open Share a Moment"})
        assert out is not None
        assert out["key"] == "moments"


class TestGeorgeChatOnMomentsScreen:
    """Smoke test: starting a George session with current_screen='moments' must not crash.
    We use a fresh member and hit /mcgs/george/event/start with a member JWT."""

    def test_start_session_on_moments_screen(self, api_client, author):
        headers = {
            "Authorization": f"Bearer {author['token']}",
            "Content-Type": "application/json",
        }
        r = api_client.post(
            f"{API}/mcgs/george/event/start",
            headers=headers,
            json={"text": "", "current_screen": "moments"},
            timeout=45,
        )
        # Accept 200 or 201; anything 5xx is a crash and MUST fail.
        assert r.status_code < 500, f"George crashed on moments screen: {r.status_code} {r.text[:400]}"
        # If it succeeded, the session should be a dict
        if r.status_code < 400:
            assert isinstance(r.json(), dict)


# ---------------------------------------------------------------------------
# 5. Regression — recipes endpoints
# ---------------------------------------------------------------------------

class TestRecipesRegression:
    def test_recipes_list_still_responds(self, api_client):
        r = api_client.get(f"{API}/recipes")
        # Data may be empty but must not 500.
        assert r.status_code < 500, f"/api/recipes crashed: {r.status_code} {r.text}"

    def test_moments_featured_does_not_collide_with_id_route(self, api_client):
        r = api_client.get(f"{API}/moments/featured")
        assert r.status_code == 200
        assert "moment" in r.json()
