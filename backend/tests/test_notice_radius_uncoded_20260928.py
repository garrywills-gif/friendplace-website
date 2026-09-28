"""Regression test — Notice Board radius filter must NOT drop location-less
notices (Emergent Support root cause, 28 Sep 2026).

Scenario (as specified):
  • viewer has a location/suburb set (coords present -> radius filter ACTIVE)
  • another member posts a notice with NO location (no locality coords)
  • viewer opens the Notice Board (GET /notices?user_id=<viewer>&radius_km=25)
  • viewer leaves completely and re-enters (a second identical GET)
  • the location-less notice remains visible both times

Runs against the live local backend. Uses demo accounts 'billdo' (viewer) and
'dot' (poster). The viewer's suburb coords are snapshotted and restored.
"""
import os
import uuid
import httpx
import pytest

BASE = "http://localhost:8001/api"
pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _db():
    from motor.motor_asyncio import AsyncIOMotorClient
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    return c[os.environ.get("DB_NAME", "test_database")]


async def _demo(client, username):
    r = await client.post(f"{BASE}/auth/demo-login", json={"username": username})
    r.raise_for_status()
    d = r.json()
    return d["access_token"], d["user"]["id"]


def _ids(resp):
    d = resp.json()
    ns = d if isinstance(d, list) else d.get("notices", d)
    return [n.get("id") for n in ns]


async def test_locationless_notice_survives_radius_and_reentry():
    db = _db()
    async with httpx.AsyncClient(timeout=25) as client:
        _, viewer_id = await _demo(client, "billdo")
        dtok, poster_id = await _demo(client, "dot")

        # Arrange: give the VIEWER real suburb coords so the radius filter is
        # actually active (snapshot to restore afterwards).
        before = await db.users.find_one({"id": viewer_id},
                                         {"_id": 0, "suburb": 1, "suburb_lat": 1, "suburb_lng": 1})
        await db.users.update_one({"id": viewer_id}, {"$set": {
            "suburb": "Bondi", "suburb_lat": -33.8908, "suburb_lng": 151.2743}})

        # The POSTER must be genuinely location-less, otherwise create_notice
        # auto-geocodes their default suburb onto the notice. Snapshot + clear.
        poster_before = await db.users.find_one(
            {"id": poster_id}, {"_id": 0, "suburb": 1, "suburb_lat": 1, "suburb_lng": 1,
                                "suburb_postcode": 1, "suburb_state": 1})
        await db.users.update_one({"id": poster_id}, {"$unset": {
            "suburb": "", "suburb_lat": "", "suburb_lng": "",
            "suburb_postcode": "", "suburb_state": ""}})

        nid = None
        try:
            # Another member posts a notice with NO location at all.
            r = await client.post(f"{BASE}/notices",
                                  headers={"Authorization": f"Bearer {dtok}"},
                                  json={"user_id": poster_id,
                                        "title": f"QA_NOLOC_{uuid.uuid4().hex[:6]}",
                                        "body": "no location on this notice",
                                        "category": "Announcement",
                                        "active_from": "2026-09-01T00:00:00+00:00"})
            assert r.status_code == 200, r.text
            nid = r.json()["id"]
            assert r.json().get("locality_lat") is None  # truly location-less

            # Viewer opens the board under the default 25km radius.
            r1 = await client.get(f"{BASE}/notices?user_id={viewer_id}&radius_km=25",
                                  headers={"Authorization": f"Bearer {dtok}"})
            assert r1.status_code == 200
            assert nid in _ids(r1), "location-less notice dropped on first open"

            # Viewer leaves completely and re-enters (identical fetch).
            r2 = await client.get(f"{BASE}/notices?user_id={viewer_id}&radius_km=25",
                                  headers={"Authorization": f"Bearer {dtok}"})
            assert r2.status_code == 200
            assert nid in _ids(r2), "location-less notice dropped on re-entry"

            # And under a mismatched category it is still not dropped by radius
            # (category filter would exclude it, which is expected — so we only
            # assert the radius path here with the matching category).
            r3 = await client.get(
                f"{BASE}/notices?user_id={viewer_id}&radius_km=25&category=Announcement",
                headers={"Authorization": f"Bearer {dtok}"})
            assert nid in _ids(r3), "location-less notice dropped under category+radius"
        finally:
            if nid:
                await db.notices.delete_one({"id": nid})
            # restore viewer's original suburb fields
            unset = {}
            setb = {}
            for k in ("suburb", "suburb_lat", "suburb_lng"):
                if before and k in before:
                    setb[k] = before[k]
                else:
                    unset[k] = ""
            op = {}
            if setb:
                op["$set"] = setb
            if unset:
                op["$unset"] = unset
            if op:
                await db.users.update_one({"id": viewer_id}, op)
            # restore poster's original suburb fields
            if poster_before:
                await db.users.update_one({"id": poster_id}, {"$set": poster_before})


async def test_coded_notice_outside_radius_still_filtered():
    """Guardrail: a notice WITH coords far outside the radius is still hidden,
    so the include_uncoded change didn't disable radius filtering itself."""
    db = _db()
    async with httpx.AsyncClient(timeout=25) as client:
        _, viewer_id = await _demo(client, "billdo")
        dtok, poster_id = await _demo(client, "dot")
        before = await db.users.find_one({"id": viewer_id},
                                         {"_id": 0, "suburb": 1, "suburb_lat": 1, "suburb_lng": 1})
        await db.users.update_one({"id": viewer_id}, {"$set": {
            "suburb": "Bondi", "suburb_lat": -33.8908, "suburb_lng": 151.2743}})
        nid = None
        try:
            r = await client.post(f"{BASE}/notices",
                                  headers={"Authorization": f"Bearer {dtok}"},
                                  json={"user_id": poster_id,
                                        "title": f"QA_FAR_{uuid.uuid4().hex[:6]}",
                                        "body": "far away notice",
                                        "category": "Announcement",
                                        "active_from": "2026-09-01T00:00:00+00:00",
                                        "locality": "Perth", "locality_lat": -31.9523,
                                        "locality_lng": 115.8613})
            assert r.status_code == 200, r.text
            nid = r.json()["id"]
            r1 = await client.get(f"{BASE}/notices?user_id={viewer_id}&radius_km=25",
                                  headers={"Authorization": f"Bearer {dtok}"})
            assert nid not in _ids(r1), "far coded notice should be filtered by radius"
        finally:
            if nid:
                await db.notices.delete_one({"id": nid})
            unset, setb = {}, {}
            for k in ("suburb", "suburb_lat", "suburb_lng"):
                (setb if (before and k in before) else unset).__setitem__(k, before[k] if (before and k in before) else "")
            op = {}
            if setb: op["$set"] = setb
            if unset: op["$unset"] = unset
            if op: await db.users.update_one({"id": viewer_id}, op)
