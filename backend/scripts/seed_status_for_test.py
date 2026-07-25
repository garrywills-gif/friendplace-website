"""Seed varied statuses on demo users for AvatarWithBadge visual QA."""
import asyncio
import os
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, "/app/backend")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
from services.status.service import heartbeat, set_manual, set_in_cafe, COLL  # noqa: E402


async def main():
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "test_database")
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    # Look up demo users by username
    usernames = ["maggie", "frankie", "joycey", "billdo", "dot", "art", "eil", "roy"]
    users = await db.users.find({"username": {"$in": usernames}}).to_list(20)
    by_name = {u["username"]: u for u in users}
    print("Found users:", [f"{u['username']}={u['id']}" for u in users])

    # maggie -> online (default): heartbeat only, no manual
    if "maggie" in by_name:
        await db[COLL].delete_one({"user_id": by_name["maggie"]["id"]})
        await heartbeat(db, by_name["maggie"]["id"])
        print(f"maggie ({by_name['maggie']['id']}) -> online (heartbeat only)")

    # frankie -> looking (🦋)
    if "frankie" in by_name:
        await heartbeat(db, by_name["frankie"]["id"])
        await set_manual(db, by_name["frankie"]["id"], "looking")
        print(f"frankie ({by_name['frankie']['id']}) -> looking")

    # joycey -> happy (😊)
    if "joycey" in by_name:
        await heartbeat(db, by_name["joycey"]["id"])
        await set_manual(db, by_name["joycey"]["id"], "happy")
        print(f"joycey ({by_name['joycey']['id']}) -> happy")

    # billdo -> busy (🟡)
    if "billdo" in by_name:
        await heartbeat(db, by_name["billdo"]["id"])
        await set_manual(db, by_name["billdo"]["id"], "busy")
        print(f"billdo ({by_name['billdo']['id']}) -> busy")

    # dot -> in_cafe with happy manual (café should beat happy)
    if "dot" in by_name:
        await heartbeat(db, by_name["dot"]["id"])
        await set_manual(db, by_name["dot"]["id"], "happy")
        await set_in_cafe(db, by_name["dot"]["id"], "table-test-1")
        print(f"dot ({by_name['dot']['id']}) -> in_cafe (with happy manual)")

    # art -> OFFLINE (no member_status doc)
    if "art" in by_name:
        await db[COLL].delete_one({"user_id": by_name["art"]["id"]})
        print(f"art ({by_name['art']['id']}) -> offline (no doc)")

    # eil -> OFFLINE via stale last_seen
    if "eil" in by_name:
        stale = datetime.now(timezone.utc) - timedelta(minutes=15)
        await db[COLL].update_one(
            {"user_id": by_name["eil"]["id"]},
            {"$set": {"last_seen_at": stale, "manual_status": None,
                      "manual_status_set_at": None, "manual_status_expires_at": None,
                      "in_cafe_table_id": None, "updated_at": stale},
             "$setOnInsert": {"user_id": by_name["eil"]["id"]}},
            upsert=True,
        )
        print(f"eil ({by_name['eil']['id']}) -> offline (stale last_seen)")

    # roy -> looking too, for double-check
    if "roy" in by_name:
        await heartbeat(db, by_name["roy"]["id"])
        await set_manual(db, by_name["roy"]["id"], "looking")
        print(f"roy ({by_name['roy']['id']}) -> looking")

    # Verify via status_for_users
    from services.status.service import status_for_users
    ids = [u["id"] for u in users]
    result = await status_for_users(db, ids)
    print("\nEffective statuses:")
    for u in users:
        print(f"  {u['username']:8s} {u['id']}  ->  {result.get(u['id'])}")

    # Print Alex's id for later reference
    alex = await db.users.find_one({"username": "member_first"})
    if alex:
        print(f"\nAlex (member_first): {alex['id']}")
        print(f"Alex.friends = {alex.get('friends')}")


asyncio.run(main())
