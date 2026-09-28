"""
Iteration 204 — Notice Board timezone grace regression.

Bug: The Notice Board composer sends `active_from` as the user's LOCAL
midnight converted to UTC. For members west of UTC this is a FUTURE UTC
instant — which previously caused `_within_active_period` in
`list_notices` (server.py ~8866) to hide the poster's brand-new notice.

Fix (server.py list_notices): adds a 14h grace to the active-period
check so a notice is live for its whole start/end DAY everywhere, while
notices scheduled for a genuinely different day stay hidden.

Test matrix (backend only):
  1. active_from ~+8h future  → author sees it in feed (was hiding).
  2. Filter-independence: same notice appears with mismatched category
     and tight radius_km (author safety-net).
  3. Scheduling: active_from ~+48h future → notice HIDDEN.
  4. Expiry: active_to ~-48h past → notice HIDDEN.
  5. Regression: normal (active_from in past) notice appears.
  6. SEC-002: server overrides client-supplied user_id with JWT identity.
  7. Auth required to create.

Cleanup: every notice created here is prefixed "QA_TZ_" and DELETEd via
Mongo at teardown.
"""

import os
import time
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
    or "http://localhost:8001"
).rstrip("/")

API = f"{BASE_URL}/api"

# Demo users we can rotate through if we hit the 6/hour create-rate cap
DEMO_USERS = ["frankie", "billdo", "dot", "art", "joycey", "eil", "roy", "maggie"]


# ---------------------------------------------------------------- helpers ----
def _demo_login(username: str):
    r = requests.post(f"{API}/auth/demo-login", json={"username": username}, timeout=15)
    if r.status_code != 200:
        return None, None
    data = r.json()
    return data["access_token"], data["user"]


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _post_notice(token: str, uid: str, *, title: str, body: str = "qa body",
                 category: str = "Announcement",
                 active_from: Optional[str] = None,
                 active_to: Optional[str] = None,
                 client_user_id: Optional[str] = None):
    payload = {
        "user_id": client_user_id or uid,
        "title": title,
        "body": body,
        "category": category,
    }
    if active_from is not None:
        payload["active_from"] = active_from
    if active_to is not None:
        payload["active_to"] = active_to
    return requests.post(
        f"{API}/notices",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )


def _list_notices(uid: str, **params) -> List[dict]:
    params["user_id"] = uid
    r = requests.get(f"{API}/notices", params=params, timeout=15)
    assert r.status_code == 200, f"GET /notices failed {r.status_code}: {r.text[:200]}"
    return r.json()


def _delete_notice_by_mongo(nid: str):
    """Best-effort teardown — talks to the local mongo directly."""
    try:
        from pymongo import MongoClient  # type: ignore
        mongo_url = os.environ.get("MONGO_URL")
        db_name = os.environ.get("DB_NAME")
        if not mongo_url or not db_name:
            return
        MongoClient(mongo_url)[db_name].notices.delete_one({"id": nid})
    except Exception:
        pass


# --------------------------------------------------------------- fixtures ----
@pytest.fixture(scope="module")
def author():
    """Return a (token, user) for a demo account that still has create-quota."""
    for name in DEMO_USERS:
        token, user = _demo_login(name)
        if not token:
            continue
        # Ping create with an ultra-cheap probe: try a create; if 429, rotate.
        probe = _post_notice(token, user["id"], title="QA_TZ_probe",
                             active_to=_iso(datetime.now(timezone.utc) - timedelta(hours=72)))
        if probe.status_code == 429:
            continue
        if probe.status_code == 200:
            _delete_notice_by_mongo(probe.json().get("id"))
            return token, user, name
        # Other error — try next demo
    pytest.skip("No demo account with available create-notice quota")


@pytest.fixture
def created_ids():
    ids: List[str] = []
    yield ids
    for nid in ids:
        _delete_notice_by_mongo(nid)


# ---------------------------------------------------------- test functions ---
def test_health_notices_endpoint_reachable():
    r = requests.get(f"{API}/notices", timeout=15)
    assert r.status_code == 200, r.text[:200]
    assert isinstance(r.json(), list)


def test_future_by_a_few_hours_is_visible_to_author(author, created_ids):
    """CORE bug: active_from ~+8h future (simulating west-of-UTC 'today
    midnight') must be visible to the author after fix."""
    token, user, _ = author
    af = _iso(datetime.now(timezone.utc) + timedelta(hours=8))
    r = _post_notice(token, user["id"], title="QA_TZ_future_8h",
                     category="Announcement", active_from=af)
    assert r.status_code == 200, f"create failed: {r.status_code} {r.text[:200]}"
    notice = r.json()
    created_ids.append(notice["id"])

    feed = _list_notices(user["id"])
    ids = [n.get("id") for n in feed]
    assert notice["id"] in ids, (
        f"Author's future-by-8h notice was hidden (regression). "
        f"active_from={af}. feed size={len(feed)}."
    )


def test_filter_independence_author_safety_net(author, created_ids):
    """Even with a mismatched category + tight radius, the author must
    still see their just-posted notice (author safety-net)."""
    token, user, _ = author
    af = _iso(datetime.now(timezone.utc) + timedelta(hours=6))
    r = _post_notice(token, user["id"], title="QA_TZ_safetynet",
                     category="Question", active_from=af)
    assert r.status_code == 200, r.text[:200]
    notice = r.json()
    created_ids.append(notice["id"])

    feed = _list_notices(user["id"], category="Announcement", radius_km=1)
    ids = [n.get("id") for n in feed]
    assert notice["id"] in ids, (
        "Author safety-net failed: mismatched category+tight radius hid "
        "author's own notice."
    )


def test_scheduling_still_hides_far_future(author, created_ids):
    """active_from +48h → still hidden (grace is 14h)."""
    token, user, _ = author
    af = _iso(datetime.now(timezone.utc) + timedelta(hours=48))
    r = _post_notice(token, user["id"], title="QA_TZ_future_48h",
                     category="Announcement", active_from=af)
    assert r.status_code == 200, r.text[:200]
    notice = r.json()
    created_ids.append(notice["id"])

    feed = _list_notices(user["id"])
    ids = [n.get("id") for n in feed]
    assert notice["id"] not in ids, (
        "Far-future (48h) notice leaked into feed — grace too wide."
    )


def test_expired_still_hidden(author, created_ids):
    """active_to -48h past → hidden."""
    token, user, _ = author
    at = _iso(datetime.now(timezone.utc) - timedelta(hours=48))
    r = _post_notice(token, user["id"], title="QA_TZ_expired_48h",
                     category="Announcement", active_to=at)
    assert r.status_code == 200, r.text[:200]
    notice = r.json()
    created_ids.append(notice["id"])

    feed = _list_notices(user["id"])
    ids = [n.get("id") for n in feed]
    assert notice["id"] not in ids, (
        "Expired notice (active_to -48h) is still in the feed."
    )


def test_normal_past_active_from_visible(author, created_ids):
    """Regression: active_from in the past appears normally."""
    token, user, _ = author
    af = _iso(datetime.now(timezone.utc) - timedelta(hours=2))
    r = _post_notice(token, user["id"], title="QA_TZ_past_2h",
                     category="Announcement", active_from=af)
    assert r.status_code == 200, r.text[:200]
    notice = r.json()
    created_ids.append(notice["id"])

    feed = _list_notices(user["id"])
    ids = [n.get("id") for n in feed]
    assert notice["id"] in ids, "Normal past-active_from notice missing from feed."


def test_sec_002_server_overrides_client_user_id(author, created_ids):
    """SEC-002: client-supplied user_id in body is IGNORED — server
    stores the authenticated caller's id.

    The module fixture's demo user may have exhausted its 6/hr create
    quota by this point, so rotate through remaining demo accounts
    until we find one with quota."""
    used_username = author[2]
    fresh_token = None
    fresh_user = None
    for name in DEMO_USERS:
        if name == used_username:
            continue
        t, u = _demo_login(name)
        if not t:
            continue
        # Cheap probe with an already-expired active_to so it stays hidden
        probe = _post_notice(t, u["id"], title="QA_TZ_sec002_probe",
                             active_to=_iso(datetime.now(timezone.utc) - timedelta(hours=72)))
        if probe.status_code == 429:
            continue
        if probe.status_code == 200:
            created_ids.append(probe.json()["id"])
            fresh_token, fresh_user = t, u
            break
    if not fresh_token:
        pytest.skip("No demo account with available create quota for SEC-002 test")

    # Pick a DIFFERENT demo user's id as the forged one
    other_name = next(n for n in DEMO_USERS if n != fresh_user.get("username"))
    _, other_user = _demo_login(other_name)
    forged_uid = other_user["id"]
    assert forged_uid != fresh_user["id"]

    r = _post_notice(fresh_token, fresh_user["id"], title="QA_TZ_sec002",
                     category="Announcement", client_user_id=forged_uid)
    assert r.status_code == 200, r.text[:200]
    notice = r.json()
    created_ids.append(notice["id"])

    assert notice["user_id"] == fresh_user["id"], (
        f"SEC-002 broken: server accepted forged user_id "
        f"{forged_uid!r} instead of authenticated {fresh_user['id']!r}"
    )


def test_create_notice_requires_auth():
    payload = {
        "user_id": "anyone",
        "title": "QA_TZ_noauth",
        "body": "should fail",
        "category": "Announcement",
    }
    r = requests.post(f"{API}/notices", json=payload, timeout=15)
    assert r.status_code in (401, 403), (
        f"Expected 401/403 without auth, got {r.status_code}: {r.text[:200]}"
    )
