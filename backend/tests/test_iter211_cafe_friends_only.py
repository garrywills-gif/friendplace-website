"""iter211 regression — FP Café friends-only access control.

Bug (Garry, Sep 2026): an uninvited member (Xanda) could join a
friends-only table. A `visibility == "friends"` table must admit ONLY
the creator and the explicitly-invited members — enforced both in the
café list (hidden from others) and on join (403 "This table is invite
only.").

Scenario:
  creator invites A + B; C is NOT invited.
  → C is denied (403 invite_only) and can't see the table in the list.
  → creator, A and B are all allowed to join and DO see it.
"""
import os
import uuid

import httpx
import pytest
from motor.motor_asyncio import AsyncIOMotorClient


def _base_url() -> str:
    env = "/app/frontend/.env"
    if os.path.exists(env):
        for line in open(env):
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                return line.split("=", 1)[1].strip()
    return os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001")


BASE = _base_url().rstrip("/") + "/api"


def _signup(client: httpx.Client, name: str) -> dict:
    u = f"it211_{name}_{uuid.uuid4().hex[:8]}"
    r = client.post(f"{BASE}/auth/signup", json={
        "username": u, "password": "TestPass123!", "first_name": name.capitalize(),
    })
    assert r.status_code == 200, f"signup {name} failed: {r.status_code} {r.text}"
    d = r.json()
    return {"id": d["user"]["id"], "token": d["access_token"], "username": u}


def _auth(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


@pytest.mark.asyncio
async def test_friends_only_table_blocks_uninvited():
    client = httpx.Client(timeout=30)
    mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = mongo[os.environ.get("DB_NAME", "test_database")]
    table_id = f"it211-{uuid.uuid4().hex[:8]}"
    users = {}
    try:
        for n in ("creator", "amy", "ben", "cara"):
            users[n] = _signup(client, n)

        # Seed a friends-only table directly (bypasses create_table's
        # friend-filtering — we're testing the access GATE, not invites).
        await db.tables.insert_one({
            "id": table_id,
            "name": "Book club (invite only)",
            "emoji": "📚",
            "host_id": users["creator"]["id"],
            "visibility": "friends",
            "invited_ids": [users["amy"]["id"], users["ben"]["id"]],
            "seated": [users["creator"]["id"]],
            "declined_ids": [],
            "created_at": "2026-09-30T00:00:00+00:00",
            "last_activity_at": "2026-09-30T00:00:00+00:00",
        })

        def join(user):
            return client.post(
                f"{BASE}/tables/{table_id}/join/{user['id']}",
                headers=_auth(user["token"]),
            )

        # C (uninvited) is denied with the friendly invite-only message.
        rc = join(users["cara"])
        assert rc.status_code == 403, f"C should be blocked, got {rc.status_code}: {rc.text}"
        detail = rc.json().get("detail")
        msg = detail.get("message") if isinstance(detail, dict) else str(detail)
        assert "invite only" in (msg or "").lower(), f"unexpected message: {detail}"

        # A and B (invited) are allowed.
        for n in ("amy", "ben"):
            r = join(users[n])
            assert r.status_code == 200, f"{n} should join, got {r.status_code}: {r.text}"

        # Creator is allowed (already seated → idempotent ok).
        assert join(users["creator"]).status_code == 200

        # List visibility: hidden from C, visible to A.
        def listed_ids(user):
            r = client.get(f"{BASE}/tables", params={"user_id": user["id"]}, headers=_auth(user["token"]))
            assert r.status_code == 200, r.text
            data = r.json()
            rows = data if isinstance(data, list) else data.get("tables", data)
            return {t.get("id") for t in rows}

        assert table_id not in listed_ids(users["cara"]), "C must NOT see the friends-only table"
        assert table_id in listed_ids(users["amy"]), "A (invited) must see the table"
    finally:
        await db.tables.delete_one({"id": table_id})
        if users:
            await db.users.delete_many({"id": {"$in": [u["id"] for u in users.values()]}})
        client.close()
        mongo.close()
