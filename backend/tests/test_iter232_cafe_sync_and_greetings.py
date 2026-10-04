"""iter232 supplementary — FP Café message-sync + /community/today
greeted-member strip. Uses sync pymongo (not motor) for DB prep/cleanup to
avoid cross-loop asyncio issues inside pytest.
"""
import os
import sys
import json
import time
import threading
import pytest
import requests
import websocket
from datetime import datetime, timezone

BASE_URL = os.environ.get("PLAY_BACKEND_URL", "http://localhost:8001").rstrip("/")

sys.path.insert(0, "/app/backend")

from pymongo import MongoClient  # noqa: E402

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


@pytest.fixture(scope="module")
def mdb():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="module")
def maggie():
    r = requests.post(f"{BASE_URL}/api/auth/demo-login", json={"username": "maggie"})
    assert r.status_code == 200, r.text
    data = r.json()
    return {"token": data["access_token"], "id": data["user"]["id"]}


def _hdr(u):
    return {"Authorization": f"Bearer {u['token']}", "Content-Type": "application/json"}


# --------------------------- (1) FP Café message sync -----------------

class TestCafeMessageSync:
    def test_messages_persist_and_broadcast(self, maggie, mdb):
        host = maggie
        table_body = {
            "name": "TEST_iter232_sync",
            "host_id": host["id"],
            "capacity": 4,
            "topic": "test",
        }
        r = requests.post(f"{BASE_URL}/api/tables", json=table_body, headers=_hdr(host))
        assert r.status_code == 200, r.text
        table_id = r.json()["id"]

        try:
            ws_url_base = BASE_URL.replace("http://", "ws://").replace("https://", "wss://")
            ws_url = f"{ws_url_base}/api/ws/table/{table_id}?user_id={host['id']}&token={host['token']}"

            received_a, received_b, received_a2 = [], [], []

            def _mk_handler(buf):
                def _on(ws, msg):
                    try:
                        data = json.loads(msg)
                    except Exception:
                        return
                    if data.get("type") == "message":
                        buf.append(data["message"])
                return _on

            ws_a = websocket.WebSocketApp(ws_url, on_message=_mk_handler(received_a))
            ws_b = websocket.WebSocketApp(ws_url, on_message=_mk_handler(received_b))
            threading.Thread(target=ws_a.run_forever, daemon=True).start()
            threading.Thread(target=ws_b.run_forever, daemon=True).start()
            time.sleep(1.5)

            ws_a.send(json.dumps({"text": "hello-from-A"}))
            time.sleep(1.0)
            ws_b.send(json.dumps({"text": "hello-from-B"}))
            time.sleep(1.2)

            texts_a = [m.get("text") for m in received_a]
            texts_b = [m.get("text") for m in received_b]
            assert "hello-from-A" in texts_a and "hello-from-B" in texts_a, (
                f"socket A missing broadcasts: {texts_a}")
            assert "hello-from-A" in texts_b and "hello-from-B" in texts_b, (
                f"socket B missing broadcasts: {texts_b}")

            # Simulate disconnect
            ws_a.close()
            time.sleep(0.6)

            # REST hydration must contain both
            r_hist = requests.get(f"{BASE_URL}/api/tables/{table_id}/messages")
            assert r_hist.status_code == 200, r_hist.text
            text_set = {m.get("text") for m in r_hist.json()}
            assert "hello-from-A" in text_set and "hello-from-B" in text_set, (
                f"persistence missing messages: {text_set}")

            # Reconnect as A → B should still receive subsequent broadcasts
            ws_a2 = websocket.WebSocketApp(ws_url, on_message=_mk_handler(received_a2))
            threading.Thread(target=ws_a2.run_forever, daemon=True).start()
            time.sleep(1.2)
            prev_b_count = len(received_b)
            ws_a2.send(json.dumps({"text": "after-reconnect"}))
            time.sleep(1.2)

            new_b_texts = [m.get("text") for m in received_b[prev_b_count:]]
            assert "after-reconnect" in new_b_texts, (
                f"socket B did not receive post-reconnect broadcast: {received_b}")

            r_hist2 = requests.get(f"{BASE_URL}/api/tables/{table_id}/messages")
            text_set2 = {m.get("text") for m in r_hist2.json()}
            assert "after-reconnect" in text_set2

            try:
                ws_a2.close()
                ws_b.close()
            except Exception:
                pass
        finally:
            mdb.messages.delete_many({"table_id": table_id})
            mdb.tables.delete_one({"id": table_id})


# --------------------------- (2) /community/today strips greeted ------

class TestCommunityTodayStripsGreeted:
    def test_welcome_strips_new_member(self, maggie, mdb):
        host = maggie
        new_user_id = "TEST_iter232_newuser"
        # Clean any prior stray from a failed run
        mdb.users.delete_one({"id": new_user_id})
        mdb.notifications.delete_many({"user_id": new_user_id})
        now = datetime.now(timezone.utc).isoformat()
        user_doc = {
            "id": new_user_id,
            "username": "testnewmember_iter232",
            "first_name": "NewPerson",
            "avatar": "🌱",
            "suburb": "Testville",
            "created_at": now,
            "is_demo": False,
            "banned": False,
            "restricted": False,
            "friends": [],
            "blocked": [],
        }
        mdb.users.insert_one(user_doc)

        try:
            r = requests.get(f"{BASE_URL}/api/community/today",
                             params={"user_id": host["id"]})
            assert r.status_code == 200, r.text
            new_ids = {u["id"] for u in r.json().get("new_members") or []}
            assert new_user_id in new_ids, (
                f"Pre-check failed: new member not in new_members: {new_ids}")

            mdb.notifications.delete_many({
                "type": "welcome",
                "user_id": new_user_id,
                "payload.from_id": host["id"],
            })

            r2 = requests.post(f"{BASE_URL}/api/greetings/send", json={
                "from_id": host["id"],
                "to_id": new_user_id,
                "kind": "welcome",
            })
            assert r2.status_code == 200, r2.text
            body = r2.json()
            assert body.get("ok") is True
            assert body.get("type") == "welcome"

            # New member stripped from /community/today
            r3 = requests.get(f"{BASE_URL}/api/community/today",
                              params={"user_id": host["id"]})
            assert r3.status_code == 200, r3.text
            new_ids_after = {u["id"] for u in r3.json().get("new_members") or []}
            assert new_user_id not in new_ids_after, (
                f"new member should be stripped: {new_ids_after}")

            # /greetings/sent-today/{host} lists recipient in `welcome`
            r4 = requests.get(f"{BASE_URL}/api/greetings/sent-today/{host['id']}",
                              headers=_hdr(host))
            assert r4.status_code == 200, r4.text
            body4 = r4.json()
            welcomes = body4.get("welcome") or body4.get("welcomes") or []
            assert new_user_id in welcomes, (
                f"sent-today should include recipient under welcome, got: {body4}")

        finally:
            mdb.users.delete_one({"id": new_user_id})
            mdb.notifications.delete_many({"user_id": new_user_id})
