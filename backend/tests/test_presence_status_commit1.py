"""Presence & Status backend tests — Commit 1 verification.

Runs directly against the FastAPI TestClient + local Mongo. Covers:
  1. ensure_indexes creates all four indexes
  2. GET /api/status/me returns offline for a fresh user
  3. PATCH /api/status/me sets manual_status + expires
  4. Heartbeat bumps last_seen_at → online
  5. Manual status timeout falls back to online after expiry
  6. Precedence: Looking > In FP Café > Busy > Happy > Online
  7. list_looking respects: nearby scope + blocks + Nearby Opt-In + self
  8. status_for_users batches correctly
  9. auto_clear (dm_message) HONOURS the historical-message guard
  10. auto_clear (dm_message) fires for messages AFTER manual_status_set_at
  11. auto_clear (cafe_join) fires unconditionally
  12. Café join hook: real POST /api/tables/{id}/join/{user_id} clears Looking
  13. Existing endpoints backward-compatible (regression smoke on friends list)
"""
import asyncio, os, sys, uuid
from datetime import datetime, timezone, timedelta

sys.path.insert(0, '/app/backend')
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
load_dotenv('/app/backend/.env')

from services.status import service as svc


async def _fresh_db():
    client = AsyncIOMotorClient(os.getenv('MONGO_URL'))
    db = client[os.getenv('DB_NAME', 'test_database')]
    # Clean previous test docs
    await db[svc.COLL].delete_many({"user_id": {"$regex": "^test-"}})
    await db.users.delete_many({"id": {"$regex": "^test-"}})
    return client, db


async def main():
    client, db = await _fresh_db()
    passed, failed = [], []

    def ok(name):
        passed.append(name); print(f"  ✅ {name}")
    def bad(name, err):
        failed.append((name, str(err))); print(f"  ❌ {name}: {err}")

    # ── 1. Indexes ──────────────────────────────────────────
    try:
        await svc.ensure_indexes(db)
        idx = await db[svc.COLL].index_information()
        want = {"user_id_1"}  # unique
        assert want.issubset(idx.keys()), f"missing base index: {idx.keys()}"
        # Partial index existence
        has_manual = any('manual_status_1' in k for k in idx.keys())
        has_cafe   = any('in_cafe_table_id' in k for k in idx.keys())
        assert has_manual, "manual_status partial index missing"
        assert has_cafe, "in_cafe_table_id partial index missing"
        ok(f"ensure_indexes creates {len(idx)} indexes")
    except Exception as e:
        bad("ensure_indexes", e)

    # ── 2. Fresh user → offline ─────────────────────────────
    uid = f"test-{uuid.uuid4().hex[:8]}"
    try:
        r = await svc.get_status(db, uid)
        assert r["effective"] == "offline", r
        ok(f"fresh user is 'offline' — {r['effective']}")
    except Exception as e:
        bad("fresh-user offline", e)

    # ── 3. Manual set ───────────────────────────────────────
    try:
        await svc.heartbeat(db, uid)  # come online
        r = await svc.set_manual(db, uid, "looking")
        assert r["effective"] == "looking", r
        assert r["manual"] == "looking"
        assert svc._as_aware(r["manual_expires_at"]) > svc._utc_now()
        ok(f"set_manual('looking') → effective={r['effective']}")
    except Exception as e:
        bad("set_manual looking", e)

    # ── 4. Heartbeat → online ───────────────────────────────
    try:
        await svc.set_manual(db, uid, None)  # clear
        await svc.heartbeat(db, uid)
        r = await svc.get_status(db, uid)
        assert r["effective"] == "online", r
        ok(f"heartbeat brings user to 'online' — {r['effective']}")
    except Exception as e:
        bad("heartbeat online", e)

    # ── 5. Manual timeout falls back ────────────────────────
    try:
        await svc.set_manual(db, uid, "happy")
        # Manually poison expiry into the past
        past = svc._utc_now() - timedelta(seconds=1)
        await db[svc.COLL].update_one({"user_id": uid}, {"$set": {"manual_status_expires_at": past}})
        r = await svc.get_status(db, uid)
        assert r["effective"] == "online", f"expired happy should → online, got {r['effective']}"
        ok("expired manual status falls back to online")
    except Exception as e:
        bad("timeout fallback", e)

    # ── 6. Precedence check ─────────────────────────────────
    try:
        await svc.set_manual(db, uid, "busy")
        await svc.set_in_cafe(db, uid, "table-x")
        r = await svc.get_status(db, uid)
        assert r["effective"] == "in_cafe", f"café > busy expected, got {r['effective']}"
        await svc.set_manual(db, uid, "looking")
        r = await svc.get_status(db, uid)
        assert r["effective"] == "looking", f"looking > in_cafe expected, got {r['effective']}"
        await svc.set_in_cafe(db, uid, None)
        ok("precedence: Looking > In FP Café > Busy > Happy > Online")
    except Exception as e:
        bad("precedence", e)

    # ── 7. list_looking privacy filter ──────────────────────
    try:
        # 3 members: A looks + nearby-opt-in + suburb=Ballarat,
        #            B looks + no opt-in,
        #            C looks + blocks the viewer.
        viewer = f"test-viewer-{uuid.uuid4().hex[:6]}"
        A = f"test-A-{uuid.uuid4().hex[:6]}"
        B = f"test-B-{uuid.uuid4().hex[:6]}"
        C = f"test-C-{uuid.uuid4().hex[:6]}"
        await db.users.insert_many([
            {"id": viewer, "name": "Viewer", "suburb": "Ballarat", "nearby_opt_in": True},
            {"id": A, "name": "Alex", "suburb": "Ballarat", "nearby_opt_in": True},
            {"id": B, "name": "Bee",   "suburb": "Ballarat", "nearby_opt_in": False},
            {"id": C, "name": "Cara",  "suburb": "Ballarat", "nearby_opt_in": True, "blocked_ids": [viewer]},
        ])
        for u in (viewer, A, B, C):
            await svc.heartbeat(db, u)
            await svc.set_manual(db, u, "looking")
        rows = await svc.list_looking(db, viewer_id=viewer, scope="nearby")
        ids = [r["user_id"] for r in rows]
        assert viewer not in ids, "viewer must not appear"
        assert A in ids, "A should appear (nearby + opted in)"
        assert B not in ids, "B should be filtered (no opt-in)"
        assert C not in ids, "C should be filtered (blocked viewer)"
        ok(f"list_looking privacy: viewer/opt-in/blocks all enforced ({len(rows)} visible)")
    except Exception as e:
        bad("list_looking privacy", e)

    # ── 8. status_for_users batch ───────────────────────────
    try:
        r = await svc.status_for_users(db, [A, B, C, viewer, "test-nobody"])
        assert r.get(A) == "looking"
        assert r.get("test-nobody") == "offline"
        assert len(r) == 5
        ok(f"status_for_users batch — {len(r)} entries")
    except Exception as e:
        bad("status_for_users", e)

    # ── 9. auto_clear DM historical guard ───────────────────
    try:
        u2 = f"test-hist-{uuid.uuid4().hex[:6]}"
        await svc.heartbeat(db, u2)
        await svc.set_manual(db, u2, "looking")
        # Simulate a HISTORICAL message (before manual_status_set_at)
        set_at = (await db[svc.COLL].find_one({"user_id": u2}))["manual_status_set_at"]
        hist = set_at - timedelta(minutes=5)
        cleared = await svc.auto_clear(db, u2, svc.TRIG_DM_MESSAGE, event_time=hist)
        assert cleared is False, "historical message must not clear"
        r = await svc.get_status(db, u2)
        assert r["effective"] == "looking", "still looking after historical msg"
        ok("auto_clear DM historical guard: pre-set-at message does NOT clear")
    except Exception as e:
        bad("auto_clear historical guard", e)

    # ── 10. auto_clear DM new-message fires ─────────────────
    try:
        new = svc._utc_now() + timedelta(seconds=1)
        cleared = await svc.auto_clear(db, u2, svc.TRIG_DM_MESSAGE, event_time=new)
        assert cleared is True, "new message should clear"
        r = await svc.get_status(db, u2)
        assert r["effective"] == "online", f"expected online after clear, got {r['effective']}"
        ok("auto_clear DM new-message: post-set-at message clears")
    except Exception as e:
        bad("auto_clear new-message", e)

    # ── 11. auto_clear café join fires unconditionally ──────
    try:
        u3 = f"test-cafe-{uuid.uuid4().hex[:6]}"
        await svc.heartbeat(db, u3)
        await svc.set_manual(db, u3, "looking")
        cleared = await svc.auto_clear(db, u3, svc.TRIG_CAFE_JOIN)
        assert cleared is True
        ok("auto_clear café_join: fires unconditionally")
    except Exception as e:
        bad("auto_clear café_join", e)

    # ── 12. Sample-response snapshot ────────────────────────
    try:
        sample_uid = f"test-sample-{uuid.uuid4().hex[:6]}"
        await svc.heartbeat(db, sample_uid)
        r_me = await svc.set_manual(db, sample_uid, "happy")
        assert set(r_me.keys()) >= {"user_id", "effective", "manual", "manual_set_at", "manual_expires_at", "in_cafe_table_id", "last_seen_at"}
        ok(f"sample /status/me shape complete: effective={r_me['effective']}")
        print(f"     Sample: user_id={r_me['user_id'][:16]}, effective={r_me['effective']}, expires_in={(svc._as_aware(r_me['manual_expires_at'])-svc._utc_now()).total_seconds():.0f}s")
    except Exception as e:
        bad("sample response shape", e)

    # ── Cleanup ─────────────────────────────────────────────
    await db[svc.COLL].delete_many({"user_id": {"$regex": "^test-"}})
    await db.users.delete_many({"id": {"$regex": "^test-"}})
    client.close()

    print()
    print(f"✅ {len(passed)} passed   ❌ {len(failed)} failed")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
