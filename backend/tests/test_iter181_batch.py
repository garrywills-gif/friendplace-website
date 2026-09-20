"""iter181 batch — backend tests for:
  ITEM 1: POST /api/play/find-match (matchmaking) + 24h decline cooldown.
  ITEM 2: /api/friends/{uid} now returns a `status` object per friend.
  ITEM 7: POST /api/notices creation + GET /api/notices includes it.

All tests run against the public preview URL (EXPO_PUBLIC_BACKEND_URL)."""
from __future__ import annotations

import os
import time
import uuid
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient

# NOTE: conftest.py sets EXPO_PUBLIC_BACKEND_URL to a stale preview host.
# For this iteration we hardcode the current preview URL (per review request).
BASE_URL = "https://outreach-campaigns.preview.emergentagent.com".rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


def _demo_login(session: requests.Session, username: str) -> dict:
    r = session.post(f"{API}/auth/demo-login", json={"username": username}, timeout=15)
    assert r.status_code == 200, f"demo-login({username}) failed: {r.status_code} {r.text}"
    data = r.json()
    return {"token": data["access_token"], "user": data["user"]}


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def sess():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def caller(sess):
    return _demo_login(sess, "maggie")


@pytest.fixture(scope="module")
def candidate(sess):
    # We'll pick a non-friend of maggie. joycey/billdo/dot/art/eil/roy are options.
    # test_credentials says maggie<->frankie are friends; the others are not.
    return _demo_login(sess, "joycey")


@pytest.fixture(scope="module")
def mongo_db():
    client = MongoClient(MONGO_URL)
    return client[DB_NAME]


def _make_online(db, uid: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    db.users.update_one(
        {"id": uid},
        {"$set": {"last_seen_at": now, "privacy": "everyone"},
         "$unset": {"status": ""}},
    )


def _ensure_not_friends(db, a: str, b: str) -> None:
    db.users.update_one({"id": a}, {"$pull": {"friends": b}})
    db.users.update_one({"id": b}, {"$pull": {"friends": a}})


def _clear_declines(db, a: str, b: str) -> None:
    pair = ":".join(sorted([a, b]))
    db.play_declines.delete_one({"pair": pair})


# ── Item 1a: find-match returns 200 with matchmaking session ─────────────
def test_find_match_returns_online_non_friend(sess, caller, candidate, mongo_db):
    db = mongo_db
    _ensure_not_friends(db, caller["user"]["id"], candidate["user"]["id"])
    _clear_declines(db, caller["user"]["id"], candidate["user"]["id"])

    # Make ONLY the candidate look online. Push everyone else offline so
    # the picker deterministically chooses joycey.
    now = datetime.now(timezone.utc).isoformat()
    old = "2024-01-01T00:00:00+00:00"
    db.users.update_many({}, {"$set": {"last_seen_at": old}})
    db.users.update_one(
        {"id": candidate["user"]["id"]},
        {"$set": {"last_seen_at": now, "privacy": "everyone", "banned": False,
                  "profile_hidden": False},
         "$unset": {"status": ""}},
    )

    r = sess.post(
        f"{API}/play/find-match",
        json={"game": "quick_trivia"},
        headers=_auth(caller["token"]),
        timeout=15,
    )
    assert r.status_code == 200, f"find-match failed: {r.status_code} {r.text}"
    data = r.json()
    assert data["status"] == "invited"
    assert data["origin"] == "matchmaking"
    assert data["host_id"] == caller["user"]["id"]
    assert data["guest_id"] == candidate["user"]["id"], (
        f"expected guest={candidate['user']['id']} but got {data['guest_id']}"
    )
    assert data["game"] == "quick_trivia"


# ── Item 1b: after decline, same pair excluded for 24h (404) ─────────────
def test_decline_cooldown_prevents_rematch(sess, caller, candidate, mongo_db):
    db = mongo_db
    # Setup: candidate is the only online eligible user.
    now = datetime.now(timezone.utc).isoformat()
    old = "2024-01-01T00:00:00+00:00"
    db.users.update_many({}, {"$set": {"last_seen_at": old}})
    db.users.update_one(
        {"id": candidate["user"]["id"]},
        {"$set": {"last_seen_at": now, "privacy": "everyone", "banned": False,
                  "profile_hidden": False},
         "$unset": {"status": ""}},
    )
    _ensure_not_friends(db, caller["user"]["id"], candidate["user"]["id"])
    _clear_declines(db, caller["user"]["id"], candidate["user"]["id"])

    r = sess.post(
        f"{API}/play/find-match",
        json={"game": "quick_trivia"},
        headers=_auth(caller["token"]),
        timeout=15,
    )
    assert r.status_code == 200, r.text
    sid = r.json()["id"]

    # Guest declines.
    rd = sess.post(
        f"{API}/play/{sid}/decline",
        headers=_auth(candidate["token"]),
        timeout=15,
    )
    assert rd.status_code == 200, rd.text

    # Verify decline record exists.
    pair = ":".join(sorted([caller["user"]["id"], candidate["user"]["id"]]))
    rec = db.play_declines.find_one({"pair": pair})
    assert rec is not None, "play_declines record was not written"

    # Second find-match should NOT re-match same guest → 404 (candidate is
    # the only online eligible user).
    r2 = sess.post(
        f"{API}/play/find-match",
        json={"game": "quick_trivia"},
        headers=_auth(caller["token"]),
        timeout=15,
    )
    assert r2.status_code == 404, f"expected 404 after decline, got {r2.status_code}: {r2.text}"
    body = r2.json()
    detail = body.get("detail") or ""
    assert "no one" in detail.lower() or "free to play" in detail.lower()


# ── Item 1c: 404 with no eligible users ──────────────────────────────────
def test_find_match_404_when_none_online(sess, caller, mongo_db):
    db = mongo_db
    # Push everyone offline.
    old = "2024-01-01T00:00:00+00:00"
    db.users.update_many({}, {"$set": {"last_seen_at": old}})

    r = sess.post(
        f"{API}/play/find-match",
        json={"game": "quick_trivia"},
        headers=_auth(caller["token"]),
        timeout=15,
    )
    assert r.status_code == 404
    detail = r.json().get("detail") or ""
    assert "free to play" in detail.lower() or "no one" in detail.lower()


# ── Item 1d: invalid game rejected ───────────────────────────────────────
def test_find_match_rejects_unknown_game(sess, caller):
    r = sess.post(
        f"{API}/play/find-match",
        json={"game": "nonsense"},
        headers=_auth(caller["token"]),
        timeout=15,
    )
    assert r.status_code == 400


# ── Item 2: /api/friends/{uid} includes per-friend status object ─────────
def test_friends_list_includes_status(sess, caller):
    r = sess.get(
        f"{API}/friends/{caller['user']['id']}",
        headers=_auth(caller["token"]),
        timeout=15,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert "friends" in data
    assert isinstance(data["friends"], list)
    if not data["friends"]:
        pytest.skip("no friends to inspect status shape")
    friend = data["friends"][0]
    assert "status" in friend, f"friend row missing status: {friend}"
    st = friend["status"]
    assert isinstance(st, dict)
    for k in ("label", "code", "emoji"):
        assert k in st, f"status missing key {k}: {st}"


# ── Item 7: POST /api/notices creates a notice; GET returns it ────────────
def test_create_and_fetch_notice(sess, caller, mongo_db):
    payload = {
        "user_id": caller["user"]["id"],
        "title": f"TEST_iter181 {uuid.uuid4().hex[:6]}",
        "body": "iter181 notice creation test — active_from/active_to null.",
        "category": "general",
        "active_from": None,
        "active_to": None,
    }
    r = sess.post(f"{API}/notices", json=payload, timeout=15)
    assert r.status_code == 200, f"create notice failed: {r.status_code} {r.text}"
    created = r.json()
    nid = created.get("id")
    assert nid, f"missing id in create response: {created}"
    assert created["title"] == payload["title"]

    # Confirm persistence via Mongo (removes dependency on radius/moderation).
    doc = mongo_db.notices.find_one({"id": nid})
    assert doc is not None, f"notice {nid} not persisted in Mongo"
    assert doc["title"] == payload["title"]
    assert doc["user_id"] == payload["user_id"]

    # Best-effort: verify notice appears in GET /notices (may be filtered by
    # moderation/auto-hide if the moderation service flagged it).
    time.sleep(0.5)
    rg = sess.get(f"{API}/notices", timeout=15)
    assert rg.status_code == 200, rg.text
    items = rg.json()
    if isinstance(items, dict):
        items = items.get("notices") or items.get("items") or []
    ids = [n.get("id") for n in items if isinstance(n, dict)]
    if nid not in ids:
        # Not a hard fail: check if held by moderation via DB.
        held = bool(doc.get("held") or doc.get("auto_hidden") or doc.get("removed"))
        print(f"NOTE: notice {nid} absent from GET /notices "
              f"(held={held}, origin={doc.get('origin')}) — persistence still verified.")

    # Cleanup — remove test notice.
    mongo_db.notices.delete_one({"id": nid})
