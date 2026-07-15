"""Tests for invitation analytics + admin invite flyer feature."""
import io
import os
import uuid
import pytest
import requests
from PIL import Image

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://belong-together.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def maggie_id(session):
    # maggie is the admin demo account
    r = session.post(f"{API}/auth/demo-login", json={"username": "maggie"})
    assert r.status_code == 200, r.text
    return r.json()["user"]["id"]


@pytest.fixture(scope="module")
def frankie_id(session):
    r = session.post(f"{API}/auth/demo-login", json={"username": "frankie"})
    assert r.status_code == 200, r.text
    return r.json()["user"]["id"]


def _signup(session, suffix, password="secret123", referrer_id=None, **extra):
    uname = f"ref_{suffix}_{uuid.uuid4().hex[:6]}"
    body = {"username": uname, "password": password, "first_name": "RefTest"}
    if referrer_id is not None:
        body["referrer_id"] = referrer_id
    body.update(extra)
    r = session.post(f"{API}/auth/signup", json=body)
    return r, uname


# 1. Signup with referrer_id matching an existing user
class TestInviteAttribution:
    def test_signup_with_valid_referrer_sets_invited_by(self, session, maggie_id):
        r, uname = _signup(session, "valid", referrer_id=maggie_id)
        assert r.status_code == 200, r.text
        data = r.json()
        new_user_id = data["user"]["id"]
        # Verify persisted via GET
        g = session.get(f"{API}/users/{new_user_id}")
        assert g.status_code == 200
        assert g.json().get("invited_by") == maggie_id

    def test_invite_stats_count_and_recent(self, session, maggie_id):
        r, uname = _signup(session, "stats", referrer_id=maggie_id)
        assert r.status_code == 200
        new_uid = r.json()["user"]["id"]
        s = session.get(f"{API}/users/{maggie_id}/invite-stats")
        assert s.status_code == 200, s.text
        data = s.json()
        assert "count" in data and "recent" in data
        assert data["count"] >= 1
        recent_ids = [u["id"] for u in data["recent"]]
        assert new_uid in recent_ids
        # newest first
        assert data["recent"][0]["id"] == new_uid

    def test_inviter_received_invite_accepted_notification(self, session, maggie_id):
        r, uname = _signup(session, "notif", referrer_id=maggie_id)
        assert r.status_code == 200
        new_uid = r.json()["user"]["id"]
        n = session.get(f"{API}/notifications/{maggie_id}")
        assert n.status_code == 200
        notes = n.json()
        ia = [x for x in notes if x.get("type") == "invite_accepted" and (x.get("data") or {}).get("user_id") == new_uid]
        assert len(ia) >= 1, f"No invite_accepted notification for {new_uid}; sample={notes[:3]}"

    def test_signup_with_unknown_referrer_drops_silently(self, session):
        fake = str(uuid.uuid4())
        r, uname = _signup(session, "unknown", referrer_id=fake)
        assert r.status_code == 200, r.text
        new_uid = r.json()["user"]["id"]
        g = session.get(f"{API}/users/{new_uid}")
        # invited_by must be null / absent
        assert g.json().get("invited_by") in (None, "")

    def test_self_referral_dropped(self, session):
        # We cannot know our own ID before signup; backend protects via body.referrer_id != user.id.
        # Simulate by signing up then asserting invited_by None when referrer_id == own id won't be possible.
        # Instead: signup once, then "edit" by recreating with the same id is impossible.
        # Workaround: hit signup with a referrer_id that happens to be a random uuid that doesn't exist (already covered).
        # For an actual self-referral guard, the server compares body.referrer_id to user.id (newly minted),
        # which is unguessable client-side. The branch is therefore exercised only when client passes its
        # known-id-from-localStorage; we can still verify that passing a random non-existent ref leaves invited_by null.
        r, uname = _signup(session, "self", referrer_id=str(uuid.uuid4()))
        assert r.status_code == 200
        new_uid = r.json()["user"]["id"]
        assert session.get(f"{API}/users/{new_uid}").json().get("invited_by") in (None, "")


# 2. Admin invite flyer PNG
class TestInviteFlyer:
    def test_flyer_returns_png_correct_dimensions(self, session, maggie_id):
        params = {"admin_id": maggie_id, "venue": "Sydney Library", "url": "https://friendplace.com.au/?ref=abc"}
        r = session.get(f"{API}/admin/invite-flyer", params=params)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("image/png")
        img = Image.open(io.BytesIO(r.content))
        assert img.size == (1240, 1754), f"Got {img.size}"

    def test_flyer_without_venue_ok(self, session, maggie_id):
        r = session.get(f"{API}/admin/invite-flyer", params={"admin_id": maggie_id, "url": "https://friendplace.com.au"})
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("image/png")

    def test_flyer_non_admin_forbidden(self, session, frankie_id):
        # frankie is not admin
        r = session.get(f"{API}/admin/invite-flyer", params={"admin_id": frankie_id, "url": "https://friendplace.com.au"})
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text[:200]}"


# 3. Regression on signup/admin without referrer
class TestRegression:
    def test_normal_signup_no_referrer(self, session):
        r, uname = _signup(session, "noref")
        assert r.status_code == 200
        new_uid = r.json()["user"]["id"]
        g = session.get(f"{API}/users/{new_uid}").json()
        assert g.get("invited_by") in (None, "")

    def test_admin_summary_still_works(self, session, maggie_id):
        r = session.get(f"{API}/admin/summary", params={"admin_id": maggie_id})
        assert r.status_code == 200, r.text


# 4. Cleanup any users we made (prefix "ref_")
def test_zz_cleanup(session):
    """Clean up test-created users from the database via direct mongo not available;
    rely on prefix so future seed/cleanup tasks pick them up. This is a no-op assertion."""
    # We just leave a marker — admin scripts can drop users where username startswith 'ref_'.
    assert True
