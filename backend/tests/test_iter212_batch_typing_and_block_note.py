"""iter212 batch — DM typing dots + Block private note.

Covers:
  T1  ws_dm typing event:
       - User A sends {"type":"typing","is_typing":true} ; user B receives
         {"type":"typing","user_id":A,"is_typing":true}.
       - Server does NOT persist the typing payload into db.messages.
  B1  POST /api/users/A/block/B with note persists under users.block_notes.{B}
      and surfaces via GET /api/users/A/blocked (note, note_at ISO).
  B2  Empty note → note=='' in list payload. Re-blocking with a new note
      OVERWRITES. Unblock clears both blocked[] and block_notes.{B}.
  B3  600-char note is truncated to exactly 500 chars.
  B4  Privacy: GET /api/users/B/blocked never leaks A's private note
      about B. B's blocked list only contains B's own notes.
"""
import asyncio
import json
import os
import uuid
from datetime import datetime, timezone

import pytest
import requests
import websockets
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


# ---------------------------------------------------------------- fixtures

@pytest.fixture(scope="module")
def demo_tokens():
    tokens = {}
    for name in ("maggie", "frankie", "joycey"):
        r = requests.post(f"{API}/auth/demo-login", json={"username": name}, timeout=15)
        assert r.status_code == 200, f"demo-login {name}: {r.status_code} {r.text}"
        d = r.json()
        tokens[name] = {"token": d["access_token"], "user": d["user"]}
    return tokens


@pytest.fixture(scope="module")
def mongo_db():
    client = AsyncIOMotorClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="module")
def fresh_pair():
    """Two brand-new signup accounts for the block tests."""
    suffix = uuid.uuid4().hex[:8]
    users = []
    for label in ("alpha", "beta"):
        body = {
            "username": f"TEST_i212_{label}_{suffix}",
            "password": "TestPass2026!",
            "first_name": label.capitalize(),
            "email": f"test_i212_{label}_{suffix}@example.com",
        }
        r = requests.post(f"{API}/auth/signup", json=body, timeout=20)
        assert r.status_code == 200, f"signup {label}: {r.status_code} {r.text}"
        d = r.json()
        users.append({"token": d["access_token"], "user": d["user"]})
    return users


def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# =================================================== T1 ws_dm typing event

class TestDmTypingEvent:
    def _ensure_conv(self, mongo_db, a_id: str, b_id: str) -> str:
        async def _upsert():
            lo, hi = sorted([a_id, b_id])
            conv_id = f"dm_{lo}_{hi}"
            now = datetime.now(timezone.utc).isoformat()
            await mongo_db.dm_conversations.update_one(
                {"id": conv_id},
                {"$setOnInsert": {
                    "id": conv_id,
                    "participants": [a_id, b_id],
                    "created_at": now,
                }, "$set": {"updated_at": now}},
                upsert=True,
            )
            return conv_id
        return _run(_upsert())

    def test_typing_fanout_and_no_persistence(self, demo_tokens, mongo_db):
        a = demo_tokens["maggie"]
        b = demo_tokens["frankie"]
        a_id, b_id = a["user"]["id"], b["user"]["id"]
        conv_id = self._ensure_conv(mongo_db, a_id, b_id)

        # Snapshot messages count BEFORE typing.
        async def _count_msgs():
            return await mongo_db.messages.count_documents({"dm_id": conv_id})
        before = _run(_count_msgs())

        async def _runner():
            ws_url_a = f"{WS_BASE}/api/ws/dm/{conv_id}?user_id={a_id}&token={a['token']}"
            ws_url_b = f"{WS_BASE}/api/ws/dm/{conv_id}?user_id={b_id}&token={b['token']}"
            received_by_b = []
            async with websockets.connect(ws_url_a) as wsa, websockets.connect(ws_url_b) as wsb:
                # Small warm-up so the server has registered both sockets.
                await asyncio.sleep(0.4)
                # A sends typing event.
                await wsa.send(json.dumps({"type": "typing", "is_typing": True}))
                # Give the hub a moment to broadcast.
                try:
                    while True:
                        raw = await asyncio.wait_for(wsb.recv(), timeout=2.0)
                        received_by_b.append(json.loads(raw))
                        # Keep draining in case there's any backlog, but
                        # stop as soon as we see the typing event.
                        if received_by_b[-1].get("type") == "typing":
                            break
                except asyncio.TimeoutError:
                    pass
                # Send is_typing:false too so we also exercise the stop path.
                await wsa.send(json.dumps({"type": "typing", "is_typing": False}))
                try:
                    raw = await asyncio.wait_for(wsb.recv(), timeout=2.0)
                    received_by_b.append(json.loads(raw))
                except asyncio.TimeoutError:
                    pass
            return received_by_b

        received = _run(_runner())
        typing_events = [m for m in received if m.get("type") == "typing"]
        assert typing_events, f"B received no typing events: all={received}"
        first = typing_events[0]
        assert first.get("user_id") == a_id, f"typing missing/wrong user_id: {first}"
        assert first.get("is_typing") is True, f"typing payload wrong: {first}"

        # Both start and stop should have landed.
        stops = [m for m in typing_events if m.get("is_typing") is False]
        assert stops, f"B did not receive is_typing:false after A sent stop: {typing_events}"

        # No persistence into db.messages.
        after = _run(_count_msgs())
        assert after == before, (
            f"typing event unexpectedly persisted: messages before={before} after={after}"
        )


# =================================================== B1 block with note

class TestBlockNote:
    def test_block_persists_note_and_lists_it(self, fresh_pair, mongo_db):
        a, b = fresh_pair[0], fresh_pair[1]
        a_id, b_id = a["user"]["id"], b["user"]["id"]
        note = "was rude in group chat"

        r = requests.post(
            f"{API}/users/{a_id}/block/{b_id}",
            json={"note": note},
            headers=_auth(a["token"]),
            timeout=10,
        )
        assert r.status_code == 200, f"block w/ note: {r.status_code} {r.text}"

        # Verify via Mongo directly.
        async def _check():
            return await mongo_db.users.find_one(
                {"id": a_id}, {"_id": 0, "block_notes": 1, "blocked": 1}
            )
        doc = _run(_check())
        assert b_id in (doc.get("blocked") or []), f"B not in blocked: {doc}"
        notes = (doc.get("block_notes") or {}).get(b_id)
        assert notes and notes.get("note") == note, f"note missing: {doc}"
        assert notes.get("at"), f"note_at missing: {doc}"

        # Verify via /blocked endpoint.
        r = requests.get(f"{API}/users/{a_id}/blocked", headers=_auth(a["token"]), timeout=10)
        assert r.status_code == 200, r.text
        entries = r.json().get("blocked") or []
        match = [e for e in entries if e.get("id") == b_id]
        assert match, f"B not in blocked endpoint response: {entries}"
        assert match[0].get("note") == note, f"note not surfaced: {match[0]}"
        assert match[0].get("note_at"), f"note_at not surfaced: {match[0]}"
        # ISO-parseable.
        datetime.fromisoformat(match[0]["note_at"].replace("Z", "+00:00"))


# =================================================== B2 empty note + overwrite + unblock

class TestBlockNoteOverwriteAndUnblock:
    def test_empty_note_then_overwrite_then_unblock(self, demo_tokens, mongo_db):
        # Fresh pair just for this test — use maggie and joycey.
        a = demo_tokens["maggie"]
        b = demo_tokens["joycey"]
        a_id, b_id = a["user"]["id"], b["user"]["id"]

        # Make sure no stale state leaks in from prior runs.
        _run(mongo_db.users.update_one(
            {"id": a_id},
            {"$pull": {"blocked": b_id}, "$unset": {f"block_notes.{b_id}": ""}},
        ))

        # 1) Block with empty note.
        r = requests.post(
            f"{API}/users/{a_id}/block/{b_id}",
            json={"note": ""},
            headers=_auth(a["token"]),
            timeout=10,
        )
        assert r.status_code == 200, r.text
        r = requests.get(f"{API}/users/{a_id}/blocked", headers=_auth(a["token"]), timeout=10)
        entry = next((e for e in r.json().get("blocked") or [] if e.get("id") == b_id), None)
        assert entry is not None, f"B not blocked: {r.json()}"
        assert entry.get("note") == "", f"empty note should surface as '': {entry}"

        # 2) Re-block with a new note → OVERWRITE.
        new_note = "second-time note"
        r = requests.post(
            f"{API}/users/{a_id}/block/{b_id}",
            json={"note": new_note},
            headers=_auth(a["token"]),
            timeout=10,
        )
        assert r.status_code == 200, r.text
        r = requests.get(f"{API}/users/{a_id}/blocked", headers=_auth(a["token"]), timeout=10)
        entry = next((e for e in r.json().get("blocked") or [] if e.get("id") == b_id), None)
        assert entry and entry.get("note") == new_note, f"note not overwritten: {entry}"

        # 3) Unblock → both blocked[] drops and block_notes.{B} $unset.
        r = requests.post(f"{API}/users/{a_id}/unblock/{b_id}", headers=_auth(a["token"]), timeout=10)
        assert r.status_code == 200, r.text

        async def _check():
            return await mongo_db.users.find_one(
                {"id": a_id}, {"_id": 0, "blocked": 1, "block_notes": 1}
            )
        doc = _run(_check())
        assert b_id not in (doc.get("blocked") or []), f"B still in blocked: {doc}"
        notes_map = doc.get("block_notes") or {}
        assert b_id not in notes_map, f"block_notes.{b_id} not unset: {notes_map}"


# =================================================== B3 length cap

class TestBlockNoteLengthCap:
    def test_600_char_note_truncated_to_500(self, demo_tokens, mongo_db):
        a = demo_tokens["frankie"]
        b = demo_tokens["joycey"]
        a_id, b_id = a["user"]["id"], b["user"]["id"]

        _run(mongo_db.users.update_one(
            {"id": a_id},
            {"$pull": {"blocked": b_id}, "$unset": {f"block_notes.{b_id}": ""}},
        ))

        long_note = "x" * 600
        r = requests.post(
            f"{API}/users/{a_id}/block/{b_id}",
            json={"note": long_note},
            headers=_auth(a["token"]),
            timeout=10,
        )
        assert r.status_code == 200, r.text

        r = requests.get(f"{API}/users/{a_id}/blocked", headers=_auth(a["token"]), timeout=10)
        entry = next((e for e in r.json().get("blocked") or [] if e.get("id") == b_id), None)
        assert entry is not None, f"B not blocked: {r.json()}"
        assert len(entry.get("note", "")) == 500, (
            f"note not truncated to 500: len={len(entry.get('note',''))}"
        )
        assert entry["note"] == "x" * 500

        # Cleanup.
        requests.post(f"{API}/users/{a_id}/unblock/{b_id}", headers=_auth(a["token"]), timeout=10)


# =================================================== B4 privacy — one-sided note

class TestBlockNotePrivacy:
    def test_b_blocked_list_does_not_contain_a_note_about_b(self, demo_tokens, mongo_db):
        # A blocks B with a note; B's own blocked list (which does NOT
        # include A unless B blocked A) must never return A's note.
        a = demo_tokens["maggie"]
        b = demo_tokens["frankie"]
        a_id, b_id = a["user"]["id"], b["user"]["id"]

        _run(mongo_db.users.update_one(
            {"id": a_id},
            {"$pull": {"blocked": b_id}, "$unset": {f"block_notes.{b_id}": ""}},
        ))
        _run(mongo_db.users.update_one(
            {"id": b_id},
            {"$pull": {"blocked": a_id}, "$unset": {f"block_notes.{a_id}": ""}},
        ))

        secret_note = "SECRET-NOTE-A-ABOUT-B"
        r = requests.post(
            f"{API}/users/{a_id}/block/{b_id}",
            json={"note": secret_note},
            headers=_auth(a["token"]),
            timeout=10,
        )
        assert r.status_code == 200, r.text

        # Fetch B's blocked list as B — must not return A at all
        # (because B didn't block A) and must never leak A's note.
        r = requests.get(f"{API}/users/{b_id}/blocked", headers=_auth(b["token"]), timeout=10)
        assert r.status_code == 200, r.text
        b_entries = r.json().get("blocked") or []
        serialised = json.dumps(b_entries)
        assert secret_note not in serialised, (
            f"A's private note leaked into B's blocked list: {serialised}"
        )
        # B's list must only contain B's own blocked ids (if any),
        # not A just because A blocked B.
        assert all(e.get("id") != a_id for e in b_entries), (
            f"B's blocked list unexpectedly contains A: {b_entries}"
        )

        # Now B blocks A with a different note and we verify B sees
        # ONLY B's own note (not A's about B).
        b_note = "B's own note about A"
        r = requests.post(
            f"{API}/users/{b_id}/block/{a_id}",
            json={"note": b_note},
            headers=_auth(b["token"]),
            timeout=10,
        )
        assert r.status_code == 200, r.text
        r = requests.get(f"{API}/users/{b_id}/blocked", headers=_auth(b["token"]), timeout=10)
        b_entries = r.json().get("blocked") or []
        a_entry = next((e for e in b_entries if e.get("id") == a_id), None)
        assert a_entry is not None, f"A missing from B's blocked list after B blocked A: {b_entries}"
        assert a_entry.get("note") == b_note, f"B's own note not surfaced: {a_entry}"
        assert secret_note not in json.dumps(b_entries), (
            f"A's private note STILL leaking into B's view: {b_entries}"
        )

        # Cleanup — unblock both ways.
        requests.post(f"{API}/users/{a_id}/unblock/{b_id}", headers=_auth(a["token"]), timeout=10)
        requests.post(f"{API}/users/{b_id}/unblock/{a_id}", headers=_auth(b["token"]), timeout=10)
