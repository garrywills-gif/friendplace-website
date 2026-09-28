"""Iter205 independent sweep — Notice Board radius fix verification.

Independent re-verification of the fix in _apply_radius(include_uncoded=True)
for list_notices. Uses a different poster (art) to avoid clashing with the
committed regression's use of `dot` and to prove the behaviour is not
account-specific. Also tests SEC-002 override and unauthenticated 401.
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


async def test_uncoded_notice_survives_radius_across_reentry_and_category():
    """Different poster (art) with cleared suburb → notice must appear
    on viewer's default 25km feed, again on re-entry, and under matching
    category filter."""
    db = _db()
    async with httpx.AsyncClient(timeout=25) as client:
        _, viewer_id = await _demo(client, "billdo")
        ptok, poster_id = await _demo(client, "art")

        vbefore = await db.users.find_one({"id": viewer_id},
            {"_id": 0, "suburb": 1, "suburb_lat": 1, "suburb_lng": 1})
        await db.users.update_one({"id": viewer_id}, {"$set": {
            "suburb": "Bondi", "suburb_lat": -33.8908, "suburb_lng": 151.2743}})

        pbefore = await db.users.find_one({"id": poster_id},
            {"_id": 0, "suburb": 1, "suburb_lat": 1, "suburb_lng": 1,
             "suburb_postcode": 1, "suburb_state": 1})
        await db.users.update_one({"id": poster_id}, {"$unset": {
            "suburb": "", "suburb_lat": "", "suburb_lng": "",
            "suburb_postcode": "", "suburb_state": ""}})

        nid = None
        try:
            r = await client.post(f"{BASE}/notices",
                headers={"Authorization": f"Bearer {ptok}"},
                json={"user_id": poster_id,
                      "title": f"QA205_NOLOC_{uuid.uuid4().hex[:6]}",
                      "body": "iter205 no location",
                      "category": "Announcement",
                      "active_from": "2026-09-01T00:00:00+00:00"})
            assert r.status_code == 200, r.text
            nid = r.json()["id"]
            assert r.json().get("locality_lat") is None
            assert r.json().get("locality_lng") is None

            # First open under default 25km radius
            r1 = await client.get(
                f"{BASE}/notices?user_id={viewer_id}&radius_km=25",
                headers={"Authorization": f"Bearer {ptok}"})
            assert r1.status_code == 200
            assert nid in _ids(r1), "location-less notice dropped on first open"

            # Re-entry (identical fetch)
            r2 = await client.get(
                f"{BASE}/notices?user_id={viewer_id}&radius_km=25",
                headers={"Authorization": f"Bearer {ptok}"})
            assert nid in _ids(r2), "location-less notice dropped on re-entry"

            # Under matching category + radius still present
            r3 = await client.get(
                f"{BASE}/notices?user_id={viewer_id}&radius_km=25&category=Announcement",
                headers={"Authorization": f"Bearer {ptok}"})
            assert nid in _ids(r3), "location-less notice dropped w/ category+radius"

            # Sanity: notice must carry no distance_km (uncoded)
            for n in (r1.json() if isinstance(r1.json(), list) else r1.json().get("notices", [])):
                if n.get("id") == nid:
                    assert n.get("distance_km") in (None,)  # not attached
                    break
        finally:
            if nid:
                await db.notices.delete_one({"id": nid})
            # restore viewer
            unset, setb = {}, {}
            for k in ("suburb", "suburb_lat", "suburb_lng"):
                if vbefore and k in vbefore:
                    setb[k] = vbefore[k]
                else:
                    unset[k] = ""
            op = {}
            if setb: op["$set"] = setb
            if unset: op["$unset"] = unset
            if op: await db.users.update_one({"id": viewer_id}, op)
            # restore poster
            if pbefore:
                await db.users.update_one({"id": poster_id}, {"$set": pbefore})


async def test_far_coded_notice_still_filtered_by_radius():
    """Guardrail: radius filter still excludes a coded notice far away."""
    db = _db()
    async with httpx.AsyncClient(timeout=25) as client:
        _, viewer_id = await _demo(client, "billdo")
        ptok, poster_id = await _demo(client, "joycey")
        vbefore = await db.users.find_one({"id": viewer_id},
            {"_id": 0, "suburb": 1, "suburb_lat": 1, "suburb_lng": 1})
        await db.users.update_one({"id": viewer_id}, {"$set": {
            "suburb": "Bondi", "suburb_lat": -33.8908, "suburb_lng": 151.2743}})
        nid = None
        try:
            r = await client.post(f"{BASE}/notices",
                headers={"Authorization": f"Bearer {ptok}"},
                json={"user_id": poster_id,
                      "title": f"QA205_FAR_{uuid.uuid4().hex[:6]}",
                      "body": "iter205 far away",
                      "category": "Announcement",
                      "active_from": "2026-09-01T00:00:00+00:00",
                      "locality": "Perth", "locality_lat": -31.9523,
                      "locality_lng": 115.8613})
            assert r.status_code == 200, r.text
            nid = r.json()["id"]
            r1 = await client.get(
                f"{BASE}/notices?user_id={viewer_id}&radius_km=25",
                headers={"Authorization": f"Bearer {ptok}"})
            assert nid not in _ids(r1), "far coded notice should be radius-filtered"
            # And with a very large radius, should appear
            r2 = await client.get(
                f"{BASE}/notices?user_id={viewer_id}&radius_km=5000",
                headers={"Authorization": f"Bearer {ptok}"})
            assert nid in _ids(r2), "far coded notice should appear w/ wide radius"
        finally:
            if nid:
                await db.notices.delete_one({"id": nid})
            unset, setb = {}, {}
            for k in ("suburb", "suburb_lat", "suburb_lng"):
                if vbefore and k in vbefore:
                    setb[k] = vbefore[k]
                else:
                    unset[k] = ""
            op = {}
            if setb: op["$set"] = setb
            if unset: op["$unset"] = unset
            if op: await db.users.update_one({"id": viewer_id}, op)


async def test_default_feed_returns_notices():
    """Regression: default feed (no radius) still returns notices."""
    async with httpx.AsyncClient(timeout=25) as client:
        tok, viewer_id = await _demo(client, "billdo")
        r = await client.get(f"{BASE}/notices?user_id={viewer_id}",
                             headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200
        d = r.json()
        ns = d if isinstance(d, list) else d.get("notices", d)
        assert isinstance(ns, list)
        # should not be empty in seeded environment
        assert len(ns) > 0, "default feed unexpectedly empty"


async def test_unauth_post_notices_returns_401():
    """SEC-002 regression: unauthenticated POST /notices → 401."""
    async with httpx.AsyncClient(timeout=25) as client:
        r = await client.post(f"{BASE}/notices",
            json={"user_id": "anybody", "title": "unauth", "body": "x",
                  "category": "Announcement",
                  "active_from": "2026-09-01T00:00:00+00:00"})
        assert r.status_code == 401, f"expected 401 got {r.status_code} {r.text}"


async def test_sec002_forces_authenticated_author():
    """SEC-002 regression: authenticated POST with a foreign user_id gets
    silently overridden to the authenticated caller's user id (or 403)."""
    db = _db()
    async with httpx.AsyncClient(timeout=25) as client:
        atok, aid = await _demo(client, "eil")
        _, bid = await _demo(client, "roy")
        assert aid != bid
        nid = None
        try:
            r = await client.post(f"{BASE}/notices",
                headers={"Authorization": f"Bearer {atok}"},
                json={"user_id": bid,  # try to impersonate roy
                      "title": f"QA205_SEC_{uuid.uuid4().hex[:6]}",
                      "body": "sec-002 override check",
                      "category": "Announcement",
                      "active_from": "2026-09-01T00:00:00+00:00"})
            # server may either 403 or override — either is acceptable so long
            # as the notice, if created, is authored by the caller (eil).
            if r.status_code == 200:
                nid = r.json()["id"]
                assert r.json().get("user_id") == aid, (
                    f"SEC-002 broken: notice authored by {r.json().get('user_id')} not {aid}")
            else:
                assert r.status_code in (401, 403), r.text
        finally:
            if nid:
                await db.notices.delete_one({"id": nid})
