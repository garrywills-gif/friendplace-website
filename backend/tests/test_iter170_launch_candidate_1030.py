"""
iter170 — Launch-candidate regression sweep for TestFlight build 1030
(versionCode 126, bumped from 1029→1030 in /app/frontend/app.json).

Focus (BACKEND ONLY — frontend held for on-device TestFlight QA):

  1. Friends 404 & count-vs-list consistency (GET /api/friends/{user_id})
     * 404 only when user does not exist; 403 for a stranger reading
       someone else's list.
     * `count` MUST equal `len(friends)` in every response.
     * Bidirectional filter (server.py L3455 `"friends": user_id`) still
       discards stray one-way entries so Home tile + /friends/list stay
       in sync.

  2. Auto-friend reliability after 2-way DM (ws_dm)
     * Two demo members open a DM, exchange one message each direction.
     * After ~600ms both users.friends arrays contain the other id.
     * The one-way-stale repair path (iter161) writes BOTH sides
       idempotently.

  3. Outreach organisations backend (iter169 fix)
     * POST /api/cms/outreach/organisations does NOT 500 on happy path.
     * GET  /api/cms/outreach/organisations groups sensibly + returns
       a coherent shape.

  4. Signup / onboarding launch blockers (iter163/164 regression)
     * POST /api/auth/signup accepts the fields the mobile app sends.
     * Suburb validation accepts entries from the 17.9k Australian
       localities dataset (suburbs_extra.json).

All rows created here are prefixed `iter170-` for easy cleanup.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from typing import Any, Dict, List

import pymongo
import pytest
import requests
import websockets

# ── Config ─────────────────────────────────────────────────────────
BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set in frontend/.env"
API = f"{BASE_URL}/api"
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")

# Outreach CMS admin lives at localhost (Sydney CMS admin, same as iter169).
LOCAL_API = "http://localhost:8001/api"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

CMS_EMAIL = "hello@friendplace.com.au"
CMS_PASSWORD = "TestPass2026!"
MARKER = "iter170-"


# ── Shared helpers ─────────────────────────────────────────────────
def _mdb():
    return pymongo.MongoClient(MONGO_URL)[DB_NAME]


def _demo_login(username: str) -> dict:
    r = requests.post(f"{API}/auth/demo-login", json={"username": username}, timeout=15)
    assert r.status_code == 200, f"demo-login {username}: {r.status_code} {r.text[:300]}"
    body = r.json()
    assert "access_token" in body and "user" in body
    return body


def _auth(sess: dict) -> Dict[str, str]:
    return {"Authorization": f"Bearer {sess['access_token']}", "Content-Type": "application/json"}


def _h(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ══════════════════════════════════════════════════════════════════
# FOCUS 1 — Friends 404 & count-vs-list consistency
# ══════════════════════════════════════════════════════════════════
class TestFocus1_FriendsEndpointConsistency:
    """GET /api/friends/{user_id} — bidirectional filter, count==len, 404 vs 403."""

    @pytest.fixture(scope="class")
    def trio(self):
        maggie = _demo_login("maggie")
        frankie = _demo_login("frankie")
        joycey = _demo_login("joycey")
        return {
            "maggie": {"id": maggie["user"]["id"], "token": maggie["access_token"]},
            "frankie": {"id": frankie["user"]["id"], "token": frankie["access_token"]},
            "joycey": {"id": joycey["user"]["id"], "token": joycey["access_token"]},
        }

    def _reset(self, trio):
        mdb = _mdb()
        for k in ("maggie", "frankie", "joycey"):
            mdb.users.update_one(
                {"id": trio[k]["id"]},
                {"$set": {"friends": [], "blocked": [], "banned": False, "profile_hidden": False}},
            )
        ids = [trio["maggie"]["id"], trio["frankie"]["id"], trio["joycey"]["id"]]
        mdb.friend_requests.delete_many({"$or": [{"from_id": {"$in": ids}}, {"to_id": {"$in": ids}}]})

    def test_a_404_vs_403_for_missing_user(self, trio):
        """404 must ONLY fire when the user does not exist. Non-admin
        stranger asking for a random id → 403 first (auth check).
        Admin asking for a random id → 404 (user lookup fails).
        NOTE: maggie is the mobile-app admin (per test_credentials.md),
        so she reaches the user lookup and gets 404. Joycey (non-admin)
        gets 403."""
        self._reset(trio)
        fake_id = f"{MARKER}nonexistent-{uuid.uuid4().hex[:8]}"

        # Non-admin (joycey) asking for a fake id → 403 (auth check first)
        r_stranger = requests.get(f"{API}/friends/{fake_id}",
                                  headers=_h(trio["joycey"]["token"]), timeout=15)
        assert r_stranger.status_code == 403, (
            f"Non-admin viewing a missing user MUST 403 first, got "
            f"{r_stranger.status_code}: {r_stranger.text[:300]}"
        )

        # Admin (maggie) asking for a fake id → 404 (user lookup fails)
        r_admin = requests.get(f"{API}/friends/{fake_id}",
                               headers=_h(trio["maggie"]["token"]), timeout=15)
        assert r_admin.status_code == 404, (
            f"Admin viewing a truly-missing user MUST 404, got "
            f"{r_admin.status_code}: {r_admin.text[:300]}"
        )

    def test_b_403_for_stranger_reading_others_list(self, trio):
        self._reset(trio)
        r = requests.get(f"{API}/friends/{trio['maggie']['id']}", headers=_h(trio["joycey"]["token"]), timeout=15)
        assert r.status_code == 403, f"expected 403, got {r.status_code}"

    def test_c_count_equals_len_when_empty(self, trio):
        self._reset(trio)
        r = requests.get(f"{API}/friends/{trio['maggie']['id']}", headers=_h(trio["maggie"]["token"]), timeout=15)
        assert r.status_code == 200, r.text[:300]
        b = r.json()
        assert b["count"] == 0
        assert b["friends"] == []
        assert b["count"] == len(b["friends"])

    def test_d_count_equals_len_after_bidirectional_add(self, trio):
        self._reset(trio)
        mdb = _mdb()
        # Make maggie↔frankie fully mutual friends, direct DB write
        mdb.users.update_one({"id": trio["maggie"]["id"]}, {"$addToSet": {"friends": trio["frankie"]["id"]}})
        mdb.users.update_one({"id": trio["frankie"]["id"]}, {"$addToSet": {"friends": trio["maggie"]["id"]}})

        r = requests.get(f"{API}/friends/{trio['maggie']['id']}", headers=_h(trio["maggie"]["token"]), timeout=15)
        assert r.status_code == 200
        b = r.json()
        assert b["count"] == len(b["friends"]), f"count/len mismatch: {b}"
        assert b["count"] == 1
        assert b["friends"][0]["id"] == trio["frankie"]["id"]

    def test_e_bidirectional_filter_excludes_stale_one_way(self, trio):
        """maggie has frankie AND joycey; frankie is mutual, joycey is
        one-way. Endpoint must return count=1, only frankie."""
        self._reset(trio)
        mdb = _mdb()
        # maggie↔frankie mutual
        mdb.users.update_one({"id": trio["maggie"]["id"]}, {"$addToSet": {"friends": trio["frankie"]["id"]}})
        mdb.users.update_one({"id": trio["frankie"]["id"]}, {"$addToSet": {"friends": trio["maggie"]["id"]}})
        # maggie → joycey one-way (joycey does NOT have maggie)
        mdb.users.update_one({"id": trio["maggie"]["id"]}, {"$addToSet": {"friends": trio["joycey"]["id"]}})

        r = requests.get(f"{API}/friends/{trio['maggie']['id']}", headers=_h(trio["maggie"]["token"]), timeout=15)
        assert r.status_code == 200
        b = r.json()
        assert b["count"] == 1, f"one-way leaked: {b}"
        assert b["count"] == len(b["friends"])
        ids = [f["id"] for f in b["friends"]]
        assert trio["frankie"]["id"] in ids
        assert trio["joycey"]["id"] not in ids

    def test_f_phantom_uuid_excluded_count_matches(self, trio):
        """Phantom UUID with no user doc still filtered; count matches list."""
        self._reset(trio)
        mdb = _mdb()
        mdb.users.update_one({"id": trio["maggie"]["id"]}, {"$addToSet": {"friends": trio["frankie"]["id"]}})
        mdb.users.update_one({"id": trio["frankie"]["id"]}, {"$addToSet": {"friends": trio["maggie"]["id"]}})
        phantom = str(uuid.uuid4())
        mdb.users.update_one({"id": trio["maggie"]["id"]}, {"$addToSet": {"friends": phantom}})

        r = requests.get(f"{API}/friends/{trio['maggie']['id']}", headers=_h(trio["maggie"]["token"]), timeout=15)
        assert r.status_code == 200
        b = r.json()
        assert b["count"] == 1
        assert b["count"] == len(b["friends"])
        assert phantom not in [f["id"] for f in b["friends"]]

    @classmethod
    def teardown_class(cls):
        try:
            mdb = _mdb()
            for uname in ("maggie", "frankie", "joycey"):
                u = mdb.users.find_one({"username": uname}, {"_id": 0, "id": 1})
                if u:
                    mdb.users.update_one({"id": u["id"]}, {"$set": {"friends": [], "blocked": []}})
        except Exception as e:
            print(f"[focus1 teardown] {e}")


# ══════════════════════════════════════════════════════════════════
# FOCUS 2 — Auto-friend reliability after 2-way DM
# ══════════════════════════════════════════════════════════════════
async def _ws_send(conv_id: str, uid: str, token: str, text: str) -> None:
    url = f"{WS_BASE}/api/ws/dm/{conv_id}?user_id={uid}&token={token}"
    ws = await websockets.connect(url)
    try:
        await ws.send(json.dumps({"text": text}))
        await asyncio.sleep(1.2)
    finally:
        try:
            await ws.close()
        except Exception:
            pass


class TestFocus2_AutoFriendAfterTwoWayDM:
    """Two-way DM → both users.friends contain each other within ~600ms."""

    @pytest.fixture(scope="class")
    def pair(self):
        # Use billdo/art to avoid stomping on the maggie/frankie iter162 flow.
        a = _demo_login("billdo")
        b = _demo_login("art")
        return {
            "a": a, "b": b,
            "a_id": a["user"]["id"], "b_id": b["user"]["id"],
        }

    def _hard_reset(self, pair):
        mdb = _mdb()
        a_id, b_id = pair["a_id"], pair["b_id"]
        mdb.users.update_one({"id": a_id}, {"$pull": {"friends": b_id}})
        mdb.users.update_one({"id": b_id}, {"$pull": {"friends": a_id}})
        mdb.friend_requests.delete_many({
            "$or": [{"from_id": a_id, "to_id": b_id}, {"from_id": b_id, "to_id": a_id}],
        })
        mdb.notifications.delete_many({
            "type": "friend_accepted",
            "$or": [{"user_id": a_id, "payload.friend_id": b_id},
                    {"user_id": b_id, "payload.friend_id": a_id}],
        })

    def _dm_start(self, sess, self_id, other_id):
        r = requests.post(f"{API}/dm/start", json={"user_id": self_id, "other_id": other_id},
                          headers=_auth(sess), timeout=15)
        assert r.status_code == 200, r.text[:300]
        return r.json()["id"]

    @pytest.mark.asyncio
    async def test_a_clean_pair_two_way_dm_creates_bidirectional_friendship(self, pair):
        self._hard_reset(pair)
        a_id, b_id = pair["a_id"], pair["b_id"]
        conv_id = self._dm_start(pair["a"], a_id, b_id)
        _mdb().messages.delete_many({"dm_id": conv_id})

        await _ws_send(conv_id, a_id, pair["a"]["access_token"],
                       f"[iter170] hi from A {int(time.time())}")
        await _ws_send(conv_id, b_id, pair["b"]["access_token"],
                       f"[iter170] hi back from B {int(time.time())}")
        await asyncio.sleep(0.6)

        mdb = _mdb()
        a_doc = mdb.users.find_one({"id": a_id}, {"_id": 0, "friends": 1}) or {}
        b_doc = mdb.users.find_one({"id": b_id}, {"_id": 0, "friends": 1}) or {}
        assert b_id in (a_doc.get("friends") or []), f"A.friends missing B: {a_doc}"
        assert a_id in (b_doc.get("friends") or []), f"B.friends missing A: {b_doc}"

    @pytest.mark.asyncio
    async def test_b_one_way_stale_A_has_B_but_not_B_has_A_repair(self, pair):
        """Iter161 repair: A had B (stale), B did not have A. Two-way DM
        must write BOTH sides idempotently."""
        self._hard_reset(pair)
        a_id, b_id = pair["a_id"], pair["b_id"]
        mdb = _mdb()
        mdb.users.update_one({"id": a_id}, {"$addToSet": {"friends": b_id}})  # stale

        conv_id = self._dm_start(pair["a"], a_id, b_id)
        mdb.messages.delete_many({"dm_id": conv_id})
        await _ws_send(conv_id, a_id, pair["a"]["access_token"], f"[repair-A] {int(time.time())}")
        await _ws_send(conv_id, b_id, pair["b"]["access_token"], f"[repair-B] {int(time.time())}")
        await asyncio.sleep(0.6)

        a_doc = mdb.users.find_one({"id": a_id}, {"_id": 0, "friends": 1}) or {}
        b_doc = mdb.users.find_one({"id": b_id}, {"_id": 0, "friends": 1}) or {}
        assert b_id in (a_doc.get("friends") or [])
        assert a_id in (b_doc.get("friends") or []), (
            f"iter161 REGRESSED — B.friends still missing A after repair: {b_doc}"
        )
        # Idempotent — no duplicates
        assert (a_doc.get("friends") or []).count(b_id) == 1
        assert (b_doc.get("friends") or []).count(a_id) == 1

    @pytest.mark.asyncio
    async def test_c_one_way_stale_B_has_A_but_not_A_has_B_repair(self, pair):
        """Mirror of scenario 2 — the exact iter161 bug."""
        self._hard_reset(pair)
        a_id, b_id = pair["a_id"], pair["b_id"]
        mdb = _mdb()
        mdb.users.update_one({"id": b_id}, {"$addToSet": {"friends": a_id}})  # stale

        conv_id = self._dm_start(pair["a"], a_id, b_id)
        mdb.messages.delete_many({"dm_id": conv_id})
        await _ws_send(conv_id, a_id, pair["a"]["access_token"], f"[repair-A2] {int(time.time())}")
        await _ws_send(conv_id, b_id, pair["b"]["access_token"], f"[repair-B2] {int(time.time())}")
        await asyncio.sleep(0.6)

        a_doc = mdb.users.find_one({"id": a_id}, {"_id": 0, "friends": 1}) or {}
        b_doc = mdb.users.find_one({"id": b_id}, {"_id": 0, "friends": 1}) or {}
        assert b_id in (a_doc.get("friends") or []), (
            f"iter161 REGRESSED — A.friends still missing B: {a_doc}"
        )
        assert a_id in (b_doc.get("friends") or [])

    @classmethod
    def teardown_class(cls):
        try:
            mdb = _mdb()
            a = mdb.users.find_one({"username": "billdo"}, {"_id": 0, "id": 1})
            b = mdb.users.find_one({"username": "art"}, {"_id": 0, "id": 1})
            if a and b:
                mdb.users.update_one({"id": a["id"]}, {"$pull": {"friends": b["id"]}})
                mdb.users.update_one({"id": b["id"]}, {"$pull": {"friends": a["id"]}})
                mdb.friend_requests.delete_many({"$or": [
                    {"from_id": a["id"], "to_id": b["id"]},
                    {"from_id": b["id"], "to_id": a["id"]},
                ]})
        except Exception as e:
            print(f"[focus2 teardown] {e}")


# ══════════════════════════════════════════════════════════════════
# FOCUS 3 — Outreach organisations backend (iter169 fix)
# ══════════════════════════════════════════════════════════════════
class TestFocus3_OutreachOrganisations:
    """POST doesn't 500 on happy path; GET returns coherent shape."""

    @pytest.fixture(scope="class")
    def cms_token(self):
        r = requests.post(f"{LOCAL_API}/cms/auth/login",
                          json={"email": CMS_EMAIL, "password": CMS_PASSWORD}, timeout=10)
        if r.status_code == 429:
            pytest.skip("CMS admin currently in lockout — retry later.")
        assert r.status_code == 200, r.text
        return r.json()["token"]

    @pytest.fixture(scope="class", autouse=True)
    def _cleanup(self, cms_token):
        mdb = _mdb()
        def wipe():
            for q in (
                {"id": {"$regex": f"^{MARKER}"}},
                {"contact_email": {"$regex": MARKER}},
                {"email": {"$regex": MARKER}},
                {"name": {"$regex": f"^Iter170 "}},
                {"organisation_name": {"$regex": f"^Iter170 "}},
            ):
                mdb.outreach_organisations.delete_many(q)
        wipe()
        yield
        wipe()

    def test_a_post_happy_path_returns_200_not_500(self, cms_token):
        email = f"{MARKER}happy-{uuid.uuid4().hex[:6]}@example.au"
        r = requests.post(f"{LOCAL_API}/cms/outreach/organisations",
                          headers=_h(cms_token),
                          json={"organisation_name": "Iter170 Happy Path Co",
                                "email": email,
                                "category": "retirement_village"}, timeout=10)
        assert r.status_code == 200, f"POST returned {r.status_code}: {r.text[:400]}"
        b = r.json()
        assert b["existing"] is False
        org = b["organisation"]
        assert org["organisation_name"] == "Iter170 Happy Path Co"
        assert org["email"] == org["contact_email"] == email.lower()

    def test_b_post_duplicate_returns_200_existing_true(self, cms_token):
        email = f"{MARKER}dup-{uuid.uuid4().hex[:6]}@example.au"
        payload = {"organisation_name": "Iter170 Dup Co", "email": email}
        r1 = requests.post(f"{LOCAL_API}/cms/outreach/organisations",
                           headers=_h(cms_token), json=payload, timeout=10)
        assert r1.status_code == 200
        r2 = requests.post(f"{LOCAL_API}/cms/outreach/organisations",
                           headers=_h(cms_token), json=payload, timeout=10)
        assert r2.status_code == 200, r2.text[:400]
        assert r2.json()["existing"] is True
        assert r2.json()["id"] == r1.json()["id"]

    def test_c_get_returns_coherent_shape_with_rows(self, cms_token):
        # Seed a row so we know at least one exists
        email = f"{MARKER}getshape-{uuid.uuid4().hex[:6]}@example.au"
        requests.post(f"{LOCAL_API}/cms/outreach/organisations",
                      headers=_h(cms_token),
                      json={"organisation_name": "Iter170 Shape Co",
                            "email": email,
                            "category": "u3a"}, timeout=10)
        r = requests.get(f"{LOCAL_API}/cms/outreach/organisations?limit=500",
                         headers=_h(cms_token), timeout=10)
        assert r.status_code == 200, r.text[:400]
        body = r.json()
        assert "rows" in body, f"missing rows key: {list(body.keys())}"
        rows = body["rows"]
        assert isinstance(rows, list)
        match = [x for x in rows if x.get("email") == email.lower()]
        assert len(match) == 1
        row = match[0]
        # Sanity: expected keys
        for k in ("id", "organisation_name", "email", "category", "status", "archived"):
            assert k in row, f"missing key {k}: {row}"
        assert row["archived"] is False
        assert row["category"] == "u3a"


# ══════════════════════════════════════════════════════════════════
# FOCUS 4 — Signup + suburb validation launch blockers
# ══════════════════════════════════════════════════════════════════
class TestFocus4_SignupAndSuburb:
    """POST /api/auth/signup accepts mobile fields; suburbs typeahead
    covers the 17.9k dataset from suburbs_extra.json."""

    _created_user_ids: List[str] = []

    def _fresh_signup_body(self) -> Dict[str, Any]:
        stamp = uuid.uuid4().hex[:8]
        return {
            "username": f"iter170_{stamp}",
            "password": "TestPass2026!",
            "email": f"{MARKER}{stamp}@example.au",
            "first_name": "Iter170",
            "suburb": "Turramurra",
            "suburb_postcode": "2074",
            "suburb_state": "NSW",
            "location_visibility": "suburb",
            "interests": ["gardening"],
            "avatar": "🌸",
            "birthday": "1955-06-15",
        }

    def test_a_signup_accepts_mobile_app_fields(self):
        body = self._fresh_signup_body()
        r = requests.post(f"{API}/auth/signup", json=body, timeout=15)
        assert r.status_code == 200, f"signup rejected: {r.status_code} {r.text[:400]}"
        data = r.json()
        assert "access_token" in data
        assert "user" in data
        u = data["user"]
        assert u["username"] == body["username"]
        assert u["first_name"] == "Iter170"
        assert u.get("suburb") == "Turramurra"
        assert u.get("avatar") == "🌸"
        self._created_user_ids.append(u["id"])

    def test_b_signup_rejects_short_username(self):
        r = requests.post(f"{API}/auth/signup",
                          json={"username": "ab", "password": "TestPass2026!"}, timeout=15)
        assert r.status_code == 400, r.text[:200]

    def test_c_signup_rejects_short_password(self):
        r = requests.post(f"{API}/auth/signup",
                          json={"username": f"iter170_short_{uuid.uuid4().hex[:6]}",
                                "password": "abc"}, timeout=15)
        # Pydantic min_length constraint returns 422; server-side check
        # returns 400. Either is a valid rejection.
        assert r.status_code in (400, 422), r.text[:200]

    def test_d_suburbs_search_returns_dataset_entries(self):
        """Suburbs typeahead must resolve names from the 17.9k dataset.
        Pick two suburbs from suburbs_extra.json and confirm hits."""
        # Load a few sample entries from the JSON dataset
        path = "/app/backend/suburbs_extra.json"
        with open(path, "r", encoding="utf-8") as fh:
            dataset = json.load(fh)
        assert isinstance(dataset, list) and len(dataset) > 15000, (
            f"suburbs_extra.json unexpectedly small: {len(dataset) if isinstance(dataset, list) else 'n/a'}"
        )
        # Grab a few well-known-ish entries (Acton ACT, and one further in)
        samples = [dataset[0], dataset[len(dataset) // 2], dataset[-1]]
        for s in samples:
            q = s["name"]
            r = requests.get(f"{API}/suburbs/search", params={"q": q, "limit": 20}, timeout=15)
            assert r.status_code == 200, r.text[:300]
            results = r.json().get("results", [])
            # Must have at least one hit matching name (case-insensitive)
            names = [x.get("name", "").lower() for x in results]
            assert q.lower() in names, (
                f"suburb '{q}' from dataset not returned by /suburbs/search. "
                f"Got names: {names[:10]}"
            )

    def test_e_signup_accepts_suburb_from_extra_dataset(self):
        """End-to-end: pick a suburb from suburbs_extra.json (that would
        not be in the pre-existing curated list) and confirm signup + user
        doc persists it."""
        with open("/app/backend/suburbs_extra.json", "r", encoding="utf-8") as fh:
            dataset = json.load(fh)
        # Pick an entry from the middle of the dataset
        target = dataset[len(dataset) // 3]
        body = self._fresh_signup_body()
        body["suburb"] = target["name"]
        body["suburb_postcode"] = target["postcode"]
        body["suburb_state"] = target["state"]
        r = requests.post(f"{API}/auth/signup", json=body, timeout=15)
        assert r.status_code == 200, (
            f"signup rejected with dataset suburb {target}: {r.status_code} {r.text[:400]}"
        )
        u = r.json()["user"]
        assert u.get("suburb") == target["name"], f"suburb not persisted: {u}"
        self._created_user_ids.append(u["id"])

    @classmethod
    def teardown_class(cls):
        try:
            mdb = _mdb()
            if cls._created_user_ids:
                mdb.users.delete_many({"id": {"$in": cls._created_user_ids}})
            # Also wipe by username prefix + email marker as belt-and-braces
            mdb.users.delete_many({"username": {"$regex": "^iter170_"}})
            mdb.users.delete_many({"email": {"$regex": MARKER}})
        except Exception as e:
            print(f"[focus4 teardown] {e}")
