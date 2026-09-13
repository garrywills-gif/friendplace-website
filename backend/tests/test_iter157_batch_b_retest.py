"""
Batch B iter157 — iOS retest backend validation.

Covers:
  1. P0 #1 — GET /api/users?near_lat=&near_lng=&radius_km= radius filter still
     returns users within the radius, sorted by distance_km, with fewer/equal
     results at radius=5 than radius=50.

  2. P0 #3 (NEW) — Auto-friendship after two-way DM. Inside the ws_dm handler,
     when user B sends their FIRST message in a conversation AND user A already
     has ≥1 message there, both users get added to each other's friends
     bidirectionally, any pending friend_request is marked accepted, and a
     friend_accepted notification is fired for both users. Also verifies
     idempotency (a subsequent message must not duplicate the friendship or
     the notifications).
"""

# --------------------------------------------------------------------- imports
import os
import asyncio
import json
import pytest
import requests
import websockets

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"

# Bondi (roughly) — same suburb coords the review request suggests.
BONDI_LAT = -33.89
BONDI_LNG = 151.28

# Melbourne — used as the "far" suburb for the radius test.
MEL_LAT = -37.81
MEL_LNG = 144.96


# --------------------------------------------------------------------- helpers
def _demo_login(username: str) -> dict:
    r = requests.post(
        f"{BASE_URL}/api/auth/demo-login",
        json={"username": username},
        timeout=15,
    )
    assert r.status_code == 200, f"demo-login {username} failed: {r.status_code} {r.text}"
    body = r.json()
    assert "access_token" in body and "user" in body
    return body


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ============================================================ P0 #1 near-me ==

class TestNearMeRadiusFilter:
    """Regression for GET /api/users?near_lat=&near_lng=&radius_km= (P0 #1)."""

    @classmethod
    def setup_class(cls):
        cls.session = _demo_login("maggie")
        cls.token = cls.session["access_token"]
        cls.uid = cls.session["user"]["id"]

    def _fetch(self, radius_km: float, lat: float = BONDI_LAT, lng: float = BONDI_LNG):
        r = requests.get(
            f"{BASE_URL}/api/users",
            params={
                "near_lat": lat,
                "near_lng": lng,
                "radius_km": radius_km,
                "viewer_id": self.uid,
            },
            headers=_auth_headers(self.token),
            timeout=15,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        return r.json()

    def test_requires_auth(self):
        r = requests.get(
            f"{BASE_URL}/api/users",
            params={"near_lat": BONDI_LAT, "near_lng": BONDI_LNG, "radius_km": 50},
            timeout=15,
        )
        # SEC-002: /users requires Bearer token.
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}: {r.text}"

    def test_sorted_by_distance(self):
        docs = self._fetch(radius_km=500)
        assert isinstance(docs, list)
        # distance_km must be present and monotonically non-decreasing.
        dists = [u.get("distance_km") for u in docs]
        assert all(d is not None for d in dists), f"missing distance_km on some users: {dists}"
        assert dists == sorted(dists), f"distance_km not sorted ascending: {dists}"

    def test_smaller_radius_fewer_or_equal(self):
        small = self._fetch(radius_km=5)
        big = self._fetch(radius_km=50)
        assert len(small) <= len(big), (
            f"radius=5 returned {len(small)} but radius=50 returned {len(big)}; "
            "smaller radius must never exceed the larger one."
        )
        for u in small:
            assert u["distance_km"] <= 5.0, f"user {u.get('id')} distance {u['distance_km']} > 5km"
        for u in big:
            assert u["distance_km"] <= 50.0, f"user {u.get('id')} distance {u['distance_km']} > 50km"

    def test_no_lat_lng_leak(self):
        docs = self._fetch(radius_km=500)
        for u in docs:
            assert "suburb_lat" not in u, f"suburb_lat leaked in peer projection: {u}"
            assert "suburb_lng" not in u, f"suburb_lng leaked in peer projection: {u}"

    def test_far_away_center_excludes_nearby(self):
        """Querying centred on Melbourne should exclude Bondi members
        at a small radius (sanity check the haversine still works)."""
        docs = self._fetch(radius_km=5, lat=MEL_LAT, lng=MEL_LNG)
        for u in docs:
            assert u["distance_km"] <= 5.0


# ============================================== P0 #3 auto-friendship after ==
# ============================================== two-way DM (NEW, iter157)   ==

class TestAutoFriendshipAfterTwoWayDM:
    """Verifies the ws_dm auto-friendship + notification logic added at
    /app/backend/server.py:~10473."""

    @classmethod
    def setup_class(cls):
        cls.mag = _demo_login("maggie")
        cls.fra = _demo_login("frankie")
        cls.mag_id = cls.mag["user"]["id"]
        cls.fra_id = cls.fra["user"]["id"]
        cls.mag_tok = cls.mag["access_token"]
        cls.fra_tok = cls.fra["access_token"]
        # Ensure a clean starting state — remove any existing friendship
        # between maggie and frankie in either direction.
        requests.delete(
            f"{BASE_URL}/api/friends/{cls.mag_id}/{cls.fra_id}",
            timeout=15,
        )
        # Start (or resurrect) the DM to get its real conv_id from the API
        # rather than reproducing the join logic here.
        r = requests.post(
            f"{BASE_URL}/api/dm/start",
            json={"user_id": cls.mag_id, "other_id": cls.fra_id},
            headers=_auth_headers(cls.mag_tok),
            timeout=15,
        )
        r.raise_for_status()
        cls.conv_id = r.json()["id"]
        # Drop any leftover DM history so message counts start from 0 —
        # otherwise the `sender_msg_count == 1` gate that triggers auto-
        # friendship never re-fires on repeat test runs.
        try:
            import pymongo
            mongo = pymongo.MongoClient(
                os.environ.get("MONGO_URL", "mongodb://localhost:27017")
            )
            mdb = mongo[os.environ.get("DB_NAME", "test_database")]
            mdb.messages.delete_many({"dm_id": cls.conv_id})
            mdb.notifications.delete_many({
                "type": "friend_accepted",
                "user_id": {"$in": [cls.mag_id, cls.fra_id]},
            })
            mdb.friend_requests.delete_many({
                "$or": [
                    {"from_id": cls.mag_id, "to_id": cls.fra_id},
                    {"from_id": cls.fra_id, "to_id": cls.mag_id},
                ]
            })
            mongo.close()
        except Exception as e:
            print(f"[setup_class] mongo cleanup skipped: {e}")

    def _ws_url(self, conv_id: str, uid: str, token: str) -> str:
        # BASE_URL is https://...; convert to wss://
        host = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")
        return f"{host}/api/ws/dm/{conv_id}?user_id={uid}&token={token}"

    def _get_friends(self, uid: str) -> list:
        # /api/users/{id} returns peer projection which may hide friends. Use
        # /api/friends/{id} if available.
        r = requests.get(f"{BASE_URL}/api/friends/{uid}", timeout=15)
        if r.status_code == 200:
            data = r.json()
            # Expect either a list of user objects or list of ids.
            if isinstance(data, list):
                return [x.get("id") if isinstance(x, dict) else x for x in data]
        # Fallback: fetch the user document via /users/{id} with auth (self).
        r = requests.get(
            f"{BASE_URL}/api/users/{uid}",
            headers=_auth_headers(self.mag_tok if uid == self.mag_id else self.fra_tok),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        return r.json().get("friends") or []

    def _get_notifications(self, uid: str) -> list:
        r = requests.get(f"{BASE_URL}/api/notifications/{uid}", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        return data if isinstance(data, list) else data.get("notifications", [])

    @pytest.mark.asyncio
    async def test_auto_friendship_flow(self):
        conv_id = self.conv_id

        # ── Open both websockets and wait for the connect handshake ──
        mag_ws = await websockets.connect(self._ws_url(conv_id, self.mag_id, self.mag_tok))
        fra_ws = await websockets.connect(self._ws_url(conv_id, self.fra_id, self.fra_tok))

        try:
            # ── Step 1: maggie sends the first message (one-way so far) ──
            await mag_ws.send(json.dumps({"text": "hi frankie!"}))
            # Give backend a moment to persist + broadcast.
            await asyncio.sleep(1.2)

            mag_friends = self._get_friends(self.mag_id)
            fra_friends = self._get_friends(self.fra_id)
            assert self.fra_id not in mag_friends, (
                f"maggie should NOT yet have frankie as a friend after one-way DM. "
                f"friends={mag_friends}"
            )
            assert self.mag_id not in fra_friends, (
                f"frankie should NOT yet have maggie as a friend after one-way DM. "
                f"friends={fra_friends}"
            )

            # ── Step 2: frankie replies — this should trigger auto-friendship
            await fra_ws.send(json.dumps({"text": "hi maggie!"}))
            await asyncio.sleep(1.5)

            mag_friends = self._get_friends(self.mag_id)
            fra_friends = self._get_friends(self.fra_id)
            assert self.fra_id in mag_friends, (
                f"maggie.friends should contain frankie after two-way DM. "
                f"friends={mag_friends}"
            )
            assert self.mag_id in fra_friends, (
                f"frankie.friends should contain maggie after two-way DM. "
                f"friends={fra_friends}"
            )

            # ── Step 3: friend_accepted notifications exist for BOTH users ──
            mag_notifs = self._get_notifications(self.mag_id)
            fra_notifs = self._get_notifications(self.fra_id)
            mag_fa = [n for n in mag_notifs if n.get("type") == "friend_accepted"]
            fra_fa = [n for n in fra_notifs if n.get("type") == "friend_accepted"]
            assert len(mag_fa) >= 1, f"maggie missing friend_accepted notification: {mag_notifs[:3]}"
            assert len(fra_fa) >= 1, f"frankie missing friend_accepted notification: {fra_notifs[:3]}"

            mag_fa_count_before = len(mag_fa)
            fra_fa_count_before = len(fra_fa)

            # ── Step 4: idempotency — frankie sends another message. Must NOT
            #    duplicate friends entries or trigger another friend_accepted.
            await fra_ws.send(json.dumps({"text": "second message from frankie"}))
            await asyncio.sleep(1.2)

            mag_friends_after = self._get_friends(self.mag_id)
            fra_friends_after = self._get_friends(self.fra_id)
            assert mag_friends_after.count(self.fra_id) == 1, (
                f"duplicate friend entry on maggie: {mag_friends_after}"
            )
            assert fra_friends_after.count(self.mag_id) == 1, (
                f"duplicate friend entry on frankie: {fra_friends_after}"
            )

            mag_fa_after = [n for n in self._get_notifications(self.mag_id) if n.get("type") == "friend_accepted"]
            fra_fa_after = [n for n in self._get_notifications(self.fra_id) if n.get("type") == "friend_accepted"]
            assert len(mag_fa_after) == mag_fa_count_before, (
                f"extra friend_accepted notification for maggie: "
                f"before={mag_fa_count_before} after={len(mag_fa_after)}"
            )
            assert len(fra_fa_after) == fra_fa_count_before, (
                f"extra friend_accepted notification for frankie: "
                f"before={fra_fa_count_before} after={len(fra_fa_after)}"
            )
        finally:
            try:
                await mag_ws.close()
            except Exception:
                pass
            try:
                await fra_ws.close()
            except Exception:
                pass

    @classmethod
    def teardown_class(cls):
        # Clean up the friendship both ways so re-runs start clean.
        try:
            requests.delete(
                f"{BASE_URL}/api/friends/{cls.mag_id}/{cls.fra_id}",
                timeout=15,
            )
        except Exception:
            pass
