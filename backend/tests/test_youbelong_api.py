"""YouBelong backend API tests."""
import os
import json
import asyncio
import pytest
import requests
import websockets

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://belong-together.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://") + "/api/ws"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def maggie(s):
    r = s.post(f"{API}/auth/demo-login", json={"username": "maggie"})
    assert r.status_code == 200, r.text
    return r.json().get("user", r.json())


@pytest.fixture(scope="module")
def frankie(s):
    r = s.post(f"{API}/auth/demo-login", json={"username": "frankie"})
    assert r.status_code == 200, r.text
    return r.json().get("user", r.json())


# ---- Health ----
def test_health(s):
    r = s.get(f"{API}/health")
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


# ---- Auth ----
def test_login_maggie(maggie):
    assert maggie["username"] == "maggie"
    assert maggie["first_name"] == "Margaret"
    assert "id" in maggie and "_id" not in maggie
    assert maggie["points"] > 0
    assert "Friendly Butterfly" in maggie["badges"]


def test_login_missing_user(s):
    r = s.post(f"{API}/auth/demo-login", json={"username": "nobody_xyz_123"})
    assert r.status_code == 404


def test_signup_duplicate(s):
    r = s.post(f"{API}/auth/signup", json={"first_name": "X", "username": "maggie", "password": "secret123"})
    assert r.status_code == 400


# ---- Users ----
def test_list_users(s):
    r = s.get(f"{API}/users")
    assert r.status_code == 200
    users = r.json()
    assert len(users) >= 8
    assert all("_id" not in u for u in users)


def test_list_users_filter_suburb(s):
    r = s.get(f"{API}/users", params={"suburb": "Bondi"})
    assert r.status_code == 200
    for u in r.json():
        assert "bondi" in u["suburb"].lower()


def test_list_users_search(s):
    r = s.get(f"{API}/users", params={"q": "frank"})
    assert r.status_code == 200
    names = [u["username"] for u in r.json()]
    assert "frankie" in names


def test_get_user(s, maggie):
    r = s.get(f"{API}/users/{maggie['id']}")
    assert r.status_code == 200
    assert r.json()["username"] == "maggie"


def test_block_user(s, maggie, frankie):
    # use a dummy block target to avoid polluting friend graph
    r = s.post(f"{API}/users/{maggie['id']}/block/{frankie['id']}")
    assert r.status_code == 200
    assert r.json().get("ok") is True


def test_report_user(s, maggie, frankie):
    r = s.post(f"{API}/users/{maggie['id']}/report/{frankie['id']}", params={"reason": "test"})
    assert r.status_code == 200


# ---- Tables ----
def test_list_tables(s):
    r = s.get(f"{API}/tables")
    assert r.status_code == 200
    tables = r.json()
    names = [t["name"] for t in tables]
    for expected in ["Morning Coffee", "Gardening Chat", "Men's Shed", "Book Club", "Pet Lovers", "New Friends", "Sydney Locals"]:
        assert expected in names, f"missing seeded table {expected}"
    assert all("_id" not in t for t in tables)


def test_get_table_with_seated_users(s):
    tables = s.get(f"{API}/tables").json()
    tid = tables[0]["id"]
    r = s.get(f"{API}/tables/{tid}")
    assert r.status_code == 200
    j = r.json()
    assert "seated_users" in j
    for u in j["seated_users"]:
        assert "_id" not in u


def test_create_table(s, maggie):
    r = s.post(f"{API}/tables", json={"name": "TEST_Table", "emoji": "🧪", "description": "auto", "host_id": maggie["id"]})
    assert r.status_code == 200
    t = r.json()
    assert t["name"] == "TEST_Table"
    assert maggie["id"] in t["seated"]
    # verify persistence
    r2 = s.get(f"{API}/tables/{t['id']}")
    assert r2.status_code == 200


def test_table_messages(s):
    tables = s.get(f"{API}/tables").json()
    tid = tables[0]["id"]
    r = s.get(f"{API}/tables/{tid}/messages")
    assert r.status_code == 200
    msgs = r.json()
    assert isinstance(msgs, list)


# ---- Groups ----
def test_list_groups(s):
    r = s.get(f"{API}/groups")
    assert r.status_code == 200
    assert len(r.json()) >= 5


def test_join_group(s, frankie):
    groups = s.get(f"{API}/groups").json()
    gid = groups[0]["id"]
    r = s.post(f"{API}/groups/{gid}/join/{frankie['id']}")
    assert r.status_code == 200


def test_group_posts_and_like(s, maggie):
    groups = s.get(f"{API}/groups").json()
    gid = groups[0]["id"]
    r = s.post(f"{API}/groups/{gid}/posts", json={
        "group_id": gid, "user_id": maggie["id"], "user_name": "Margaret", "avatar": "🌸", "text": "TEST_post"
    })
    assert r.status_code == 200
    pid = r.json()["id"]
    r2 = s.post(f"{API}/groups/posts/{pid}/like/{maggie['id']}")
    assert r2.status_code == 200
    r3 = s.post(f"{API}/groups/posts/{pid}/comment", json={"user_id": maggie["id"], "user_name": "Margaret", "text": "TEST_comment"})
    assert r3.status_code == 200


# ---- Events ----
def test_list_events(s):
    r = s.get(f"{API}/events")
    assert r.status_code == 200
    events = r.json()
    titles = [e["title"] for e in events]
    assert "Men's Shed BBQ" in titles
    assert "Library Book Club" in titles
    assert len(events) >= 7


def test_rsvp_event(s, frankie):
    events = s.get(f"{API}/events").json()
    eid = events[0]["id"]
    before = s.get(f"{API}/users/{frankie['id']}").json()["points"]
    r = s.post(f"{API}/events/{eid}/rsvp/{frankie['id']}")
    assert r.status_code == 200
    after = s.get(f"{API}/users/{frankie['id']}").json()["points"]
    assert after >= before  # may already be RSVP'd
    # unrsvp
    s.post(f"{API}/events/{eid}/unrsvp/{frankie['id']}")


# ---- Notices ----
def test_notices(s, maggie):
    r = s.get(f"{API}/notices")
    assert r.status_code == 200
    assert len(r.json()) >= 4
    # create
    r2 = s.post(f"{API}/notices", json={
        "user_id": maggie["id"], "user_name": "Margaret", "avatar": "🌸",
        "title": "TEST_notice", "body": "test", "category": "Announcement"
    })
    assert r2.status_code == 200
    nid = r2.json()["id"]
    assert s.post(f"{API}/notices/{nid}/like/{maggie['id']}").status_code == 200
    assert s.post(f"{API}/notices/{nid}/comment", json={"user_id": maggie["id"], "user_name": "M", "text": "ok"}).status_code == 200


# ---- Flutters ----
def test_seeded_flutters_for_maggie(s, maggie):
    """PRD: Margaret should have incoming flutters from Frank and Dorothy on first launch."""
    r = s.get(f"{API}/flutters/{maggie['id']}")
    assert r.status_code == 200
    flutters = r.json()
    # this asserts the seed - if missing, this is a real bug
    senders = {f.get("from_name") for f in flutters}
    assert "Frank" in senders, f"No seeded Flutter from Frank. Got: {flutters}"
    assert "Dorothy" in senders, f"No seeded Flutter from Dorothy. Got: {flutters}"


def test_send_flutter(s, frankie, maggie):
    r = s.post(f"{API}/flutters/send", json={"from_id": frankie["id"], "to_id": maggie["id"], "message": "TEST"})
    assert r.status_code == 200
    j = r.json()
    assert j["from_name"] == "Frank"


# ---- DM ----
def test_dm_start_and_messages(s, maggie, frankie):
    r = s.post(f"{API}/dm/start", json={"user_id": maggie["id"], "other_id": frankie["id"]})
    assert r.status_code == 200
    cid = r.json()["id"]
    r2 = s.get(f"{API}/dm/{cid}/messages")
    assert r2.status_code == 200


def test_dm_conversations(s, maggie):
    r = s.get(f"{API}/dm/{maggie['id']}/conversations")
    assert r.status_code == 200
    convs = r.json()
    # Margaret seeded with Joyce
    assert len(convs) >= 1
    has_joyce = any(c.get("other", {}).get("username") == "joycey" for c in convs)
    assert has_joyce


# ---- Friends ----
def test_friend_request(s, frankie, maggie):
    r = s.post(f"{API}/friends/request", json={"from_id": frankie["id"], "to_id": maggie["id"]})
    assert r.status_code == 200


# ---- WebSocket Table ----
def test_ws_table_chat(s, maggie):
    tables = s.get(f"{API}/tables").json()
    tid = tables[0]["id"]

    async def go():
        uri = f"{WS_BASE}/table/{tid}?user_id={maggie['id']}"
        async with websockets.connect(uri) as ws:
            # consume any presence message
            try:
                await asyncio.wait_for(ws.recv(), timeout=2)
            except asyncio.TimeoutError:
                pass
            await ws.send(json.dumps({"text": "TEST_ws_msg"}))
            # read broadcasts
            for _ in range(4):
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=3)
                    data = json.loads(raw)
                    if data.get("type") == "message" and data["message"]["text"] == "TEST_ws_msg":
                        return True
                except asyncio.TimeoutError:
                    break
            return False

    assert asyncio.get_event_loop().run_until_complete(go())


# ---- WebSocket DM ----
def test_ws_dm_chat(s, maggie, frankie):
    cid = s.post(f"{API}/dm/start", json={"user_id": maggie["id"], "other_id": frankie["id"]}).json()["id"]

    async def go():
        uri = f"{WS_BASE}/dm/{cid}?user_id={maggie['id']}"
        async with websockets.connect(uri) as ws:
            await ws.send(json.dumps({"text": "TEST_dm_ws"}))
            for _ in range(4):
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=3)
                    data = json.loads(raw)
                    if data.get("type") == "message" and data["message"]["text"] == "TEST_dm_ws":
                        return True
                except asyncio.TimeoutError:
                    break
            return False

    assert asyncio.get_event_loop().run_until_complete(go())
