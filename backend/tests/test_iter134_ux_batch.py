"""Backend tests for iter134 UX batch (P0+P1+P2).

Covers:
  * /api/public/events* stubs (empty payloads, 404 on unknown slug)
  * /api/flutters/send single-active guard (409 flutter_already_active), reset via read
  * self-flutter path (200 + "a flutter to yourself" wording)
  * /api/flutters/{id}/respond happy path + validation
  * /api/dm/start with user_id == other_id (self-DM for "Notes to Myself")
  * regression: notices, groups/suggest, events for frankie
"""

import os
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")


# ---------- shared fixtures ----------
@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def frankie(client):
    r = client.post(f"{BASE_URL}/api/auth/demo-login", json={"username": "frankie"})
    assert r.status_code == 200, r.text
    d = r.json()
    return {"id": d["user"]["id"], "token": d["access_token"], "user": d["user"]}


@pytest.fixture(scope="module")
def maggie(client):
    r = client.post(f"{BASE_URL}/api/auth/demo-login", json={"username": "maggie"})
    assert r.status_code == 200, r.text
    d = r.json()
    return {"id": d["user"]["id"], "token": d["access_token"], "user": d["user"]}


@pytest.fixture(scope="module", autouse=True)
def _clear_maggie_block(frankie, maggie):
    """Stale test-data cleanup: maggie's `blocked` list contains frankie from
    an earlier test iteration, which would cause /flutters/send to return 403
    ("Cannot flutter this user"). Clear it so the review-requested
    frankie → maggie flow is testable.
    """
    import asyncio
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _clear():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = c[os.environ["DB_NAME"]]
        await db.users.update_one(
            {"id": maggie["id"]},
            {"$pull": {"blocked": frankie["id"]}},
        )
        # also clear frankie -> maggie blocks just in case
        await db.users.update_one(
            {"id": frankie["id"]},
            {"$pull": {"blocked": maggie["id"]}},
        )
        c.close()

    asyncio.run(_clear())
    yield


def _auth(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- Public events stubs (P0) ----------
class TestPublicEventsStubs:
    def test_public_events_list_empty(self, client):
        r = client.get(f"{BASE_URL}/api/public/events")
        assert r.status_code == 200, r.text
        assert r.json() == {"events": []}

    def test_public_events_mine_empty(self, client, frankie):
        r = client.get(f"{BASE_URL}/api/public/events/mine", params={"user_id": frankie["id"]})
        assert r.status_code == 200, r.text
        assert r.json() == {"items": []}

    def test_public_events_mine_any_user_id(self, client):
        r = client.get(f"{BASE_URL}/api/public/events/mine", params={"user_id": "does-not-exist"})
        assert r.status_code == 200
        assert r.json() == {"items": []}

    def test_public_events_unknown_slug_404(self, client):
        r = client.get(f"{BASE_URL}/api/public/events/foo-slug")
        assert r.status_code == 404


# ---------- Flutter send/respond (P0) ----------
class TestFlutters:
    def test_send_flutter_dedup_and_reset(self, client, frankie, maggie):
        # Clean any previous unread flutter frankie->maggie to make the
        # 409 assertion deterministic. We do this by marking existing
        # ones as read via the read endpoint after fetching maggie's list.
        r = client.get(f"{BASE_URL}/api/flutters/{maggie['id']}")
        assert r.status_code == 200
        for fl in r.json():
            if fl.get("from_id") == frankie["id"]:
                client.post(f"{BASE_URL}/api/flutters/{fl['id']}/read")

        # 1st send: 200
        r1 = client.post(
            f"{BASE_URL}/api/flutters/send",
            json={"from_id": frankie["id"], "to_id": maggie["id"]},
        )
        assert r1.status_code == 200, r1.text
        first = r1.json()
        assert first.get("id"), first
        assert first["from_id"] == frankie["id"]
        assert first["to_id"] == maggie["id"]

        # 2nd send (before read): 409 with flutter_already_active
        r2 = client.post(
            f"{BASE_URL}/api/flutters/send",
            json={"from_id": frankie["id"], "to_id": maggie["id"]},
        )
        assert r2.status_code == 409, r2.text
        body = r2.json()
        # FastAPI wraps custom dict in {"detail": ...}
        detail = body.get("detail", body)
        as_str = str(detail)
        assert "flutter_already_active" in as_str, as_str

        # Mark the 1st as read, subsequent send should succeed again
        rr = client.post(f"{BASE_URL}/api/flutters/{first['id']}/read")
        assert rr.status_code == 200
        r3 = client.post(
            f"{BASE_URL}/api/flutters/send",
            json={"from_id": frankie["id"], "to_id": maggie["id"]},
        )
        assert r3.status_code == 200, r3.text

        # Cleanup: mark the 3rd flutter as read too
        client.post(f"{BASE_URL}/api/flutters/{r3.json()['id']}/read")

    def test_self_flutter(self, client, frankie):
        r = client.post(
            f"{BASE_URL}/api/flutters/send",
            json={"from_id": frankie["id"], "to_id": frankie["id"]},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert "flutter to yourself" in (d.get("message") or "").lower(), d
        assert "🦋" in (d.get("message") or "")

    def test_respond_flutter_fluttered_back(self, client, frankie, maggie):
        # send a fresh flutter to respond to
        s = client.post(
            f"{BASE_URL}/api/flutters/send",
            json={"from_id": maggie["id"], "to_id": frankie["id"], "message": "hi"},
        )
        # In case one is already pending, mark it read then resend.
        if s.status_code == 409:
            existing = client.get(f"{BASE_URL}/api/flutters/{frankie['id']}").json()
            for fl in existing:
                if fl.get("from_id") == maggie["id"]:
                    client.post(f"{BASE_URL}/api/flutters/{fl['id']}/read")
            s = client.post(
                f"{BASE_URL}/api/flutters/send",
                json={"from_id": maggie["id"], "to_id": frankie["id"], "message": "hi"},
            )
        assert s.status_code == 200, s.text
        fid = s.json()["id"]

        r = client.post(
            f"{BASE_URL}/api/flutters/{fid}/respond",
            json={"action": "fluttered_back"},
        )
        assert r.status_code == 200, r.text
        assert r.json().get("action") == "fluttered_back"

        # GET /flutters/{user_id} still returns this flutter (read stays False)
        listing = client.get(f"{BASE_URL}/api/flutters/{frankie['id']}")
        assert listing.status_code == 200
        ids = [f.get("id") for f in listing.json()]
        assert fid in ids, f"flutter {fid} not visible in {ids}"
        # find it and check responded_action
        match = next((f for f in listing.json() if f.get("id") == fid), None)
        assert match is not None
        assert match.get("responded_action") == "fluttered_back"
        assert match.get("read") in (False, None)

        # cleanup
        client.post(f"{BASE_URL}/api/flutters/{fid}/read")

    def test_respond_flutter_invalid_action(self, client, frankie, maggie):
        # need an existing flutter id for the 400 path (validation happens first though)
        s = client.post(
            f"{BASE_URL}/api/flutters/send",
            json={"from_id": maggie["id"], "to_id": frankie["id"], "message": "hi2"},
        )
        if s.status_code == 409:
            existing = client.get(f"{BASE_URL}/api/flutters/{frankie['id']}").json()
            for fl in existing:
                if fl.get("from_id") == maggie["id"]:
                    client.post(f"{BASE_URL}/api/flutters/{fl['id']}/read")
            s = client.post(
                f"{BASE_URL}/api/flutters/send",
                json={"from_id": maggie["id"], "to_id": frankie["id"], "message": "hi2"},
            )
        assert s.status_code == 200
        fid = s.json()["id"]
        r = client.post(f"{BASE_URL}/api/flutters/{fid}/respond", json={"action": "nope"})
        assert r.status_code == 400
        client.post(f"{BASE_URL}/api/flutters/{fid}/read")

    def test_respond_flutter_unknown_id(self, client):
        r = client.post(
            f"{BASE_URL}/api/flutters/00000000-0000-0000-0000-000000000000/respond",
            json={"action": "fluttered_back"},
        )
        assert r.status_code == 404


# ---------- DM start self-conversation (Notes to Myself) ----------
class TestDmStartSelf:
    def test_dm_start_self(self, client, frankie):
        r = client.post(
            f"{BASE_URL}/api/dm/start",
            json={"user_id": frankie["id"], "other_id": frankie["id"]},
            headers=_auth(frankie["token"]),
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("participants") == [frankie["id"], frankie["id"]], d
        assert d.get("id"), d


# ---------- Regression: notices / groups suggest / events ----------
class TestRegression:
    def test_notices_create(self, client, frankie):
        payload = {
            "user_id": frankie["id"],
            "title": "TEST_notice",
            "body": "test body from iter134",
            "category": "Announcement",
        }
        r = client.post(f"{BASE_URL}/api/notices", json=payload, headers=_auth(frankie["token"]))
        assert r.status_code in (200, 201), r.text
        assert r.json().get("id")

    def test_groups_suggest(self, client, frankie):
        import uuid
        payload = {
            "user_id": frankie["id"],
            "name": f"TEST_iter134_group_{uuid.uuid4().hex[:8]}",
            "description": "regression group suggestion",
        }
        r = client.post(f"{BASE_URL}/api/groups/suggest", json=payload, headers=_auth(frankie["token"]))
        assert r.status_code in (200, 201), r.text

    def test_events_create(self, client, frankie):
        payload = {
            "title": "TEST_iter134_event",
            "emoji": "🎉",
            "description": "regression event create",
            "location": "Test Hall",
            "date": "2026-12-25",
            "time": "10:00",
            "host_id": frankie["id"],
        }
        r = client.post(f"{BASE_URL}/api/events", json=payload, headers=_auth(frankie["token"]))
        assert r.status_code in (200, 201), r.text
        assert r.json().get("id")
