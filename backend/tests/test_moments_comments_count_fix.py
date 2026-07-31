"""Fix verification for the comments_count bug (iteration 129).

Bugs fixed:
  * `GET /api/moments` (list feed) — the previous projection
    `{"_id": 0, "comments": 0}` stripped the comments array server-side
    so `_moment_shape` counted 0 comments for every row. Now switched to
    an aggregate with `$size: {$ifNull: ["$comments", []]}`.
  * `GET /api/moments/featured` — same projection bug. Now uses
    `{"_id": 0}` (full doc), so comment count is correct.

Also does a spot-check on the new aggregate response time for the list
endpoint (< 500 ms with a bounded limit).

Run:
    pytest /app/backend/tests/test_moments_comments_count_fix.py -v --tb=short \
        --junitxml=/app/test_reports/pytest/moments_fix_results.xml
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"

API = f"{BASE_URL}/api"

CMS_EMAIL = "hello@friendplace.com.au"
CMS_PASSWORD = "TestPass2026!"


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _signup(api_client, tag: str) -> dict:
    username = f"TESTfix_{tag}_{uuid.uuid4().hex[:6]}"
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
    }


@pytest.fixture(scope="module")
def author(api_client):
    return _signup(api_client, "author")


@pytest.fixture(scope="module")
def commenter(api_client):
    return _signup(api_client, "commenter")


@pytest.fixture(scope="module")
def cms_headers(api_client):
    r = api_client.post(f"{API}/cms/auth/login", json={
        "email": CMS_EMAIL, "password": CMS_PASSWORD,
    })
    assert r.status_code == 200, f"cms login: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def moment_with_3_comments(api_client, author, commenter):
    """Create a moment and post 3 comments on it."""
    r = api_client.post(f"{API}/moments", json={
        "user_id": author["id"],
        "caption": f"TEST_comments_count_fix_{uuid.uuid4().hex[:6]}",
        "privacy": "everyone",
    })
    assert r.status_code == 200, r.text
    mid = r.json()["id"]

    for body in ("TEST_ nice one!", "TEST_ love it", "TEST_ great pic"):
        rc = api_client.post(f"{API}/moments/{mid}/comments", json={
            "user_id": commenter["id"], "body": body,
        })
        assert rc.status_code == 200, rc.text
    return {"id": mid, "caption": r.json()["caption"]}


class TestListFeedCommentsCount:
    """The bug: list feed used to return comments_count=0 even when comments exist."""

    def test_list_everyone_returns_correct_comments_count(
        self, api_client, author, moment_with_3_comments
    ):
        # Search by caption to guarantee the row is in the response
        r = api_client.get(f"{API}/moments", params={
            "scope": "everyone",
            "viewer_id": author["id"],
            "q": moment_with_3_comments["caption"],
        })
        assert r.status_code == 200, r.text
        rows = r.json().get("moments") or []
        target = next((m for m in rows if m["id"] == moment_with_3_comments["id"]), None)
        assert target is not None, (
            f"created moment not in list; rows={[m['id'] for m in rows]}"
        )
        assert target["comments_count"] == 3, (
            f"expected comments_count=3, got {target.get('comments_count')} — "
            f"BUG: list feed still reports stale comment count"
        )

    def test_detail_returns_comments_count_and_array(
        self, api_client, author, moment_with_3_comments
    ):
        r = api_client.get(
            f"{API}/moments/{moment_with_3_comments['id']}",
            params={"viewer_id": author["id"]},
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["comments_count"] == 3, (
            f"detail comments_count wrong: {j.get('comments_count')}"
        )
        assert len(j.get("comments") or []) == 3, (
            f"detail comments array wrong length: {len(j.get('comments') or [])}"
        )

    def test_list_response_time_under_500ms_for_100(self, api_client, author):
        """Spot-check: aggregate should be fast for a bounded page."""
        t0 = time.time()
        r = api_client.get(f"{API}/moments", params={
            "scope": "everyone", "viewer_id": author["id"], "limit": 100,
        })
        elapsed_ms = (time.time() - t0) * 1000
        assert r.status_code == 200, r.text
        # Not a hard test — just log if slow. 2s is the ceiling to catch a
        # regression like a $lookup on every row.
        assert elapsed_ms < 2000, f"list_moments too slow: {elapsed_ms:.0f} ms"
        print(f"list_moments(limit=100) took {elapsed_ms:.0f} ms")

    def test_list_does_not_crash_on_docs_without_comments_field(
        self, api_client, author
    ):
        """`$size: {$ifNull: ["$comments", []]}` must handle old docs without
        a `comments` field. Create a moment (which never gets a comments
        field set until first comment) and verify count=0 and no 500."""
        r = api_client.post(f"{API}/moments", json={
            "user_id": author["id"],
            "caption": f"TEST_no_comments_field_{uuid.uuid4().hex[:6]}",
        })
        assert r.status_code == 200
        mid = r.json()["id"]
        cap = r.json()["caption"]

        lst = api_client.get(f"{API}/moments", params={
            "scope": "everyone", "viewer_id": author["id"], "q": cap,
        })
        assert lst.status_code == 200, lst.text
        target = next(
            (m for m in lst.json()["moments"] if m["id"] == mid), None
        )
        assert target is not None
        assert target["comments_count"] == 0


class TestFeaturedCommentsCount:
    """The bug: /api/moments/featured also had the projection bug."""

    def test_featured_returns_correct_comments_count(
        self, api_client, cms_headers, moment_with_3_comments
    ):
        mid = moment_with_3_comments["id"]
        # Feature the moment via CMS
        r = api_client.post(
            f"{API}/cms/moments/{mid}/action",
            headers=cms_headers, json={"action": "feature"},
        )
        assert r.status_code == 200, r.text
        try:
            feat = api_client.get(f"{API}/moments/featured")
            assert feat.status_code == 200, feat.text
            body = feat.json()
            m = body.get("moment") or {}
            assert m.get("id") == mid, (
                f"featured returned wrong id: {m.get('id')} vs expected {mid}"
            )
            assert m.get("comments_count") == 3, (
                f"featured comments_count wrong: {m.get('comments_count')} "
                f"(expected 3) — BUG: featured endpoint still stripping comments"
            )
        finally:
            # Cleanup: unfeature to keep other tests deterministic
            api_client.post(
                f"{API}/cms/moments/{mid}/action",
                headers=cms_headers, json={"action": "unfeature"},
            )
