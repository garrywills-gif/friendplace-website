"""Iter34 — In-app Account Deletion (DELETE /api/users/me) + Legal pages.

Covers:
  * Fresh signup → create content (notice, group post, flutter, RSVP) → self-delete.
  * Confirms cascade: user gone, notice gone, group_post anonymised
    (user_name="Former member", user_id="[deleted]"), flutter gone from
    recipient's unread list, event RSVP arrays purged, Founders Lounge
    group.members + table.seated purged.
  * Re-using the deleted bearer token → 401.
  * Admin (maggie) self-delete attempt → 400.
  * Public legal pages (/legal/privacy and /legal/terms) reachable
    without auth from the SPA — sanity HTTP check on the SPA HTML
    bundle being served (not strictly required by spec but cheap).
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def fresh_user(api_client):
    """Sign up a unique fresh account. Returns dict with access_token, user, id."""
    suffix = uuid.uuid4().hex[:10]
    username = f"TEST_iter34_{suffix}"
    payload = {
        "username": username,
        "password": "Test1234!",
        "email": f"{username}@example.com",
        "first_name": "DeleteMe",
        "suburb": "Bondi",
    }
    r = api_client.post(f"{API}/auth/signup", json=payload)
    assert r.status_code == 200, f"signup failed: {r.status_code} {r.text}"
    data = r.json()
    assert "access_token" in data and "user" in data
    return {
        "access_token": data["access_token"],
        "user": data["user"],
        "id": data["user"]["id"],
        "username": username,
    }


class TestSignupSideEffects:
    """Step 1: signup must populate user, founders-lounge membership, and notifications."""

    def test_user_exists_in_get(self, api_client, fresh_user):
        r = api_client.get(f"{API}/users/{fresh_user['id']}")
        assert r.status_code == 200
        assert r.json()["id"] == fresh_user["id"]

    def test_user_in_founders_lounge_group(self, api_client, fresh_user):
        # Find the Founders Lounge group via /groups and assert membership.
        r = api_client.get(f"{API}/groups")
        assert r.status_code == 200
        groups = r.json()
        fl = next((g for g in groups if g.get("name") == "Founders Lounge"), None)
        assert fl is not None, "Founders Lounge group missing"
        assert fresh_user["id"] in (fl.get("members") or []), (
            f"fresh user not auto-enrolled in Founders Lounge "
            f"(members has {len(fl.get('members') or [])} entries)"
        )
        # Save for later assertions
        pytest.fl_group_id = fl["id"]

    def test_user_has_welcome_notification(self, api_client, fresh_user):
        r = api_client.get(f"{API}/notifications/{fresh_user['id']}")
        assert r.status_code == 200
        notifs = r.json()
        assert isinstance(notifs, list) and len(notifs) >= 1, (
            f"expected at least one welcome notification, got {len(notifs)}"
        )


class TestContentCreationThenSelfDelete:
    """Steps 2 + 3: create content, then DELETE /api/users/me, then verify cascade."""

    def test_full_flow(self, api_client, fresh_user):
        token = fresh_user["access_token"]
        uid = fresh_user["id"]
        auth_headers = {"Authorization": f"Bearer {token}"}

        # --- 2a. Create a notice ---
        notice_payload = {
            "user_id": uid,
            "user_name": fresh_user["user"].get("first_name", "DeleteMe"),
            "title": "TEST_iter34 notice",
            "body": "this should disappear on delete",
            "category": "Announcement",
        }
        r = api_client.post(f"{API}/notices", json=notice_payload)
        assert r.status_code == 200, f"create notice: {r.status_code} {r.text}"
        notice_id = r.json()["id"]

        # --- 2b. Create a group post in Founders Lounge ---
        fl_group_id = getattr(pytest, "fl_group_id", None)
        assert fl_group_id, "Founders Lounge group_id not captured by earlier test"
        gp_payload = {
            "group_id": fl_group_id,
            "user_id": uid,
            "user_name": fresh_user["user"].get("first_name", "DeleteMe"),
            "avatar": fresh_user["user"].get("avatar", "🙂"),
            "text": "TEST_iter34 group post — should anonymise on delete",
        }
        r = api_client.post(f"{API}/groups/{fl_group_id}/posts", json=gp_payload)
        assert r.status_code == 200, f"create group post: {r.status_code} {r.text}"
        gp_id = r.json()["id"]

        # --- 2c. Send a flutter to maggie ---
        # Look up maggie's id via demo-login (no password required).
        r = api_client.post(f"{API}/auth/demo-login", json={"username": "maggie"})
        assert r.status_code == 200
        maggie_id = r.json()["user"]["id"]
        flutter_payload = {"from_id": uid, "to_id": maggie_id, "message": "TEST_iter34 flutter"}
        r = api_client.post(f"{API}/flutters/send", json=flutter_payload)
        assert r.status_code == 200, f"send flutter: {r.status_code} {r.text}"
        flutter_id = r.json()["id"]

        # --- 2d. RSVP "going" to an upcoming event ---
        r = api_client.get(f"{API}/events")
        assert r.status_code == 200
        events = r.json()
        # Pick first event with no capacity OR capacity not full.
        target_event = None
        for ev in events:
            cap = ev.get("capacity")
            going_n = len(ev.get("rsvps") or [])
            if cap is None or going_n < int(cap):
                target_event = ev
                break
        assert target_event, "no event with free capacity found"
        ev_id = target_event["id"]
        r = api_client.post(
            f"{API}/events/{ev_id}/rsvp/{uid}", json={"response": "going"}
        )
        assert r.status_code == 200, f"rsvp: {r.status_code} {r.text}"
        # Confirm RSVP landed (either going or waitlist if cap juuuust filled).
        r = api_client.get(f"{API}/events")
        ev_after = next(e for e in r.json() if e["id"] == ev_id)
        in_any = (
            uid in (ev_after.get("rsvps") or [])
            or uid in (ev_after.get("waitlist") or [])
        )
        assert in_any, "RSVP did not persist before delete"

        # Snapshot founders lounge table seated array (sanity)
        r = api_client.get(f"{API}/tables")
        assert r.status_code == 200
        tables = r.json()
        fl_table = next((t for t in tables if t.get("name") == "Founders Lounge"), None)
        assert fl_table, "Founders Lounge table missing"
        fl_table_id = fl_table["id"]
        # New founders are auto-seated per server.py:592 — assert this is true.
        assert uid in (fl_table.get("seated") or []), (
            "fresh founder should be auto-seated at Founders Lounge table"
        )

        # --- 3. DELETE /api/users/me ---
        r = api_client.delete(
            f"{API}/users/me", json={"reason": "QA test"}, headers=auth_headers
        )
        assert r.status_code == 200, f"self-delete: {r.status_code} {r.text}"
        body = r.json()
        assert body.get("ok") is True

        # --- 3a. User gone (404) ---
        r = api_client.get(f"{API}/users/{uid}")
        assert r.status_code == 404, f"user should be 404, got {r.status_code}"

        # --- 3b. Notice gone from /api/notices ---
        r = api_client.get(f"{API}/notices")
        assert r.status_code == 200
        assert not any(n.get("id") == notice_id for n in r.json()), (
            "deleted user's notice still present"
        )
        assert not any(n.get("user_id") == uid for n in r.json()), (
            "notices still attributed to deleted user_id"
        )

        # --- 3c. Group post anonymised, not deleted ---
        r = api_client.get(f"{API}/groups/{fl_group_id}/posts")
        assert r.status_code == 200
        posts = r.json()
        gp_after = next((p for p in posts if p.get("id") == gp_id), None)
        assert gp_after is not None, "group post was deleted instead of anonymised"
        assert gp_after.get("user_name") == "Former member", (
            f"user_name not anonymised, got {gp_after.get('user_name')!r}"
        )
        assert gp_after.get("user_id") == "[deleted]", (
            f"user_id not anonymised, got {gp_after.get('user_id')!r}"
        )

        # --- 3d. Flutter gone from recipient's unread list ---
        r = api_client.get(f"{API}/flutters/{maggie_id}")
        assert r.status_code == 200
        assert not any(f.get("id") == flutter_id for f in r.json()), (
            "deleted user's flutter still in recipient list"
        )
        assert not any(f.get("from_id") == uid for f in r.json()), (
            "flutter still attributed to deleted user"
        )

        # --- 3e. Event RSVP arrays cleaned ---
        r = api_client.get(f"{API}/events")
        ev_clean = next(e for e in r.json() if e["id"] == ev_id)
        for k in ("rsvps", "rsvps_maybe", "rsvps_cant", "waitlist"):
            assert uid not in (ev_clean.get(k) or []), (
                f"deleted user still in event.{k}"
            )

        # --- 3f. Founders Lounge group.members cleaned ---
        r = api_client.get(f"{API}/groups")
        fl_clean = next(g for g in r.json() if g["id"] == fl_group_id)
        assert uid not in (fl_clean.get("members") or []), (
            "deleted user still in Founders Lounge members"
        )

        # --- 3g. Founders Lounge table.seated cleaned ---
        r = api_client.get(f"{API}/tables")
        fl_table_clean = next(t for t in r.json() if t["id"] == fl_table_id)
        assert uid not in (fl_table_clean.get("seated") or []), (
            "deleted user still seated at Founders Lounge table"
        )

        # Store the deleted token for the next test class
        pytest.deleted_token = token


class TestStaleTokenReuse:
    """Step 4: reusing the now-invalid bearer token must be rejected with 401."""

    def test_stale_token_returns_401(self, api_client):
        token = getattr(pytest, "deleted_token", None)
        assert token, "previous test class did not stash deleted_token"
        r = api_client.delete(
            f"{API}/users/me",
            json={"reason": "second attempt"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 401, (
            f"stale token should be 401, got {r.status_code} body={r.text}"
        )


class TestAdminSelfDeleteBlocked:
    """Step 5: an admin (maggie is_admin=True per env) cannot self-delete."""

    def test_admin_self_delete_400(self, api_client):
        r = api_client.post(f"{API}/auth/demo-login", json={"username": "maggie"})
        assert r.status_code == 200
        data = r.json()
        assert data["user"].get("is_admin") is True, (
            "maggie expected to be admin in this env — sub-test cannot run otherwise"
        )
        token = data["access_token"]
        r = api_client.delete(
            f"{API}/users/me",
            json={"reason": "should be blocked"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 400, (
            f"admin self-delete should be 400, got {r.status_code} body={r.text}"
        )
        body = r.json()
        # Server raises HTTPException(400, "Admin accounts cannot delete...")
        detail = (body.get("detail") or "").lower()
        assert "admin" in detail, f"unexpected 400 detail: {body!r}"


class TestPublicLegalPagesReachable:
    """Step 6/7 (cheap sanity): SPA serves the routes without 5xx. Visual
    content is verified by Playwright UI tests, not here."""

    @pytest.mark.parametrize("path", ["/legal/privacy", "/legal/terms"])
    def test_spa_route_serves_html(self, api_client, path):
        # Use a fresh session w/o JSON content-type for HTML.
        r = requests.get(f"{BASE_URL}{path}", timeout=15)
        assert r.status_code == 200, f"{path} returned {r.status_code}"
        # Expo SPA returns html — looking for any <html or react root.
        assert "<html" in r.text.lower() or "expo" in r.text.lower(), (
            f"{path} did not serve SPA html"
        )
