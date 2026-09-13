"""
iter162 — Retest of the exact Frank -> Maggie flow reported by the user.

User story:
  Frank sent Maggie a DM, Maggie replied, but neither got added as a friend.

This test reproduces the flow verbatim against the LOCAL/preview backend:
  1. Clear friends both directions + wipe conversation/messages/notifications.
  2. POST /api/dm/start (frankie -> maggie).
  3. WS DM: frankie sends a message.
  4. WS DM: maggie replies.
  5. Wait 600ms, then verify:
     * GET /api/users/{frankie.id}     → friends contains maggie.id
     * GET /api/users/{maggie.id}      → friends contains frankie.id
     * GET /api/friends/{frankie.id}   → canonical list includes Maggie
     * GET /api/friends/{maggie.id}    → canonical list includes Frank
"""
from __future__ import annotations

import asyncio
import json
import os
import time

import pymongo
import pytest
import requests
import websockets

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"

WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


def _demo_login(username: str) -> dict:
    r = requests.post(
        f"{BASE_URL}/api/auth/demo-login",
        json={"username": username},
        timeout=15,
    )
    assert r.status_code == 200, f"demo-login {username} failed: {r.status_code} {r.text[:300]}"
    return r.json()


def _auth(sess: dict) -> dict:
    return {"Authorization": f"Bearer {sess['access_token']}", "Content-Type": "application/json"}


def _mdb():
    return pymongo.MongoClient(MONGO_URL)[DB_NAME]


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


@pytest.mark.asyncio
async def test_frank_to_maggie_two_way_dm_triggers_bidirectional_friendship():
    frankie = _demo_login("frankie")
    maggie = _demo_login("maggie")
    f_id = frankie["user"]["id"]
    m_id = maggie["user"]["id"]

    mdb = _mdb()

    # 1. Clear friends both directions + wipe conv/messages/notifications/FR
    mdb.users.update_one({"id": f_id}, {"$pull": {"friends": m_id}})
    mdb.users.update_one({"id": m_id}, {"$pull": {"friends": f_id}})
    mdb.friend_requests.delete_many({
        "$or": [{"from_id": f_id, "to_id": m_id}, {"from_id": m_id, "to_id": f_id}],
    })
    mdb.notifications.delete_many({
        "type": "friend_accepted",
        "$or": [
            {"user_id": f_id, "payload.friend_id": m_id},
            {"user_id": m_id, "payload.friend_id": f_id},
        ],
    })

    # 2. POST /api/dm/start
    r = requests.post(
        f"{BASE_URL}/api/dm/start",
        json={"user_id": f_id, "other_id": m_id},
        headers=_auth(frankie),
        timeout=15,
    )
    assert r.status_code == 200, f"/api/dm/start: {r.status_code} {r.text[:300]}"
    conv_id = r.json()["id"]

    # Purge any residual message history for this conv
    mdb.messages.delete_many({"dm_id": conv_id})

    # 3. WS: frankie -> maggie
    await _ws_send(conv_id, f_id, frankie["access_token"],
                   f"hi maggie from frank {int(time.time())}")

    # 4. WS: maggie -> frankie (the trigger for auto-friendship)
    await _ws_send(conv_id, m_id, maggie["access_token"],
                   f"hi back frank from maggie {int(time.time())}")

    # 5. Wait 600ms and verify
    await asyncio.sleep(0.6)

    # GET /api/users/{frankie.id}
    r_frank = requests.get(f"{BASE_URL}/api/users/{f_id}",
                           headers=_auth(frankie), timeout=15)
    assert r_frank.status_code == 200, r_frank.text[:300]
    frank_doc = r_frank.json()
    assert m_id in (frank_doc.get("friends") or []), (
        f"Frank.friends missing Maggie. friends={frank_doc.get('friends')}"
    )

    # GET /api/users/{maggie.id}
    r_mag = requests.get(f"{BASE_URL}/api/users/{m_id}",
                        headers=_auth(maggie), timeout=15)
    assert r_mag.status_code == 200, r_mag.text[:300]
    mag_doc = r_mag.json()
    assert f_id in (mag_doc.get("friends") or []), (
        f"Maggie.friends missing Frank. friends={mag_doc.get('friends')}"
    )

    # GET /api/friends/{frankie.id}
    r_ff = requests.get(f"{BASE_URL}/api/friends/{f_id}",
                        headers=_auth(frankie), timeout=15)
    assert r_ff.status_code == 200, r_ff.text[:300]
    body_ff = r_ff.json()
    friends_ff = body_ff.get("friends", [])
    ids_ff = [f.get("id") for f in friends_ff if isinstance(f, dict)]
    assert m_id in ids_ff, (
        f"canonical /api/friends/{{frank}} missing Maggie. ids={ids_ff}"
    )

    # GET /api/friends/{maggie.id}
    r_fm = requests.get(f"{BASE_URL}/api/friends/{m_id}",
                        headers=_auth(maggie), timeout=15)
    assert r_fm.status_code == 200, r_fm.text[:300]
    body_fm = r_fm.json()
    friends_fm = body_fm.get("friends", [])
    ids_fm = [f.get("id") for f in friends_fm if isinstance(f, dict)]
    assert f_id in ids_fm, (
        f"canonical /api/friends/{{maggie}} missing Frank. ids={ids_fm}"
    )

    print(f"[iter162] frank.friends count={len(frank_doc.get('friends') or [])}, "
          f"maggie.friends count={len(mag_doc.get('friends') or [])}, "
          f"canonical(frank)={len(ids_ff)}, canonical(maggie)={len(ids_fm)}")


def teardown_module(module):
    """Best-effort cleanup: leave the pair NOT friends so re-runs start clean."""
    try:
        m = pymongo.MongoClient(MONGO_URL)[DB_NAME]
        f = m.users.find_one({"username": "frankie"}, {"_id": 0, "id": 1})
        g = m.users.find_one({"username": "maggie"}, {"_id": 0, "id": 1})
        if f and g:
            f_id, m_id = f["id"], g["id"]
            m.users.update_one({"id": f_id}, {"$pull": {"friends": m_id}})
            m.users.update_one({"id": m_id}, {"$pull": {"friends": f_id}})
            m.friend_requests.delete_many({"$or": [
                {"from_id": f_id, "to_id": m_id},
                {"from_id": m_id, "to_id": f_id},
            ]})
            m.notifications.delete_many({
                "type": "friend_accepted",
                "$or": [
                    {"user_id": f_id, "payload.friend_id": m_id},
                    {"user_id": m_id, "payload.friend_id": f_id},
                ],
            })
    except Exception as e:
        print(f"[teardown] skipped: {e}")
