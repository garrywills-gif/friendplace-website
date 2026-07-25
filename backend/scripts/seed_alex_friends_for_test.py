"""Seed Alex's friends list + one incoming friend request for badge testing."""
import asyncio
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, "/app/backend")
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


async def main():
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "test_database")
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    alex = await db.users.find_one({"username": "member_first"})
    if not alex:
        print("No Alex found; abort.")
        return
    alex_id = alex["id"]

    friend_names = ["maggie", "frankie", "joycey", "billdo", "dot", "art", "eil"]
    friend_users = await db.users.find({"username": {"$in": friend_names}}).to_list(20)
    friend_ids = [u["id"] for u in friend_users]

    await db.users.update_one({"id": alex_id}, {"$set": {"friends": friend_ids}})
    for u in friend_users:
        cur = set(u.get("friends") or [])
        cur.add(alex_id)
        await db.users.update_one({"id": u["id"]}, {"$set": {"friends": list(cur)}})

    print(f"Alex friends set: {len(friend_ids)}")
    for fu in friend_users:
        print(f"  friend {fu['username']} ({fu['id']})")

    # Create incoming friend request from roy -> alex if none exists
    roy = await db.users.find_one({"username": "roy"})
    if roy:
        existing = await db.friend_requests.find_one({"from_id": roy["id"], "to_id": alex_id, "status": "pending"})
        if not existing:
            await db.friend_requests.insert_one({
                "id": f"testreq-{roy['id']}-{alex_id}",
                "from_id": roy["id"],
                "to_id": alex_id,
                "status": "pending",
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            print(f"Created friend request from roy ({roy['id']}) to Alex")
        else:
            print("Friend request from roy already exists")

    # Print final state
    alex2 = await db.users.find_one({"id": alex_id})
    print(f"Alex friends now: {alex2.get('friends')}")


asyncio.run(main())
