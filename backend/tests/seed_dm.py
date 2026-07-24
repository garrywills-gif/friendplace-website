"""Seed an unread DM from a demo sender (default maggie) to alex.
Run:
  MONGO_URL=... DB_NAME=... python /app/backend/tests/seed_dm.py [--sender maggie] [--text "hello"]
"""
import argparse
import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient


def dm_conv_id(a: str, b: str) -> str:
    lo, hi = sorted([a, b])
    return f"dm_{lo}_{hi}"


async def main():
    p = argparse.ArgumentParser()
    p.add_argument("--sender", default="maggie")
    p.add_argument("--recipient", default="member_first")
    p.add_argument("--text", default="Hey Alex, a test DM 🦋")
    args = p.parse_args()

    mongo_url = os.environ.get("MONGO_URL") or "mongodb://localhost:27017"
    db_name = os.environ.get("DB_NAME") or "test_database"
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    sender = await db.users.find_one({"username": args.sender}, {"_id": 0})
    recipient = await db.users.find_one({"username": args.recipient}, {"_id": 0})
    if not sender or not recipient:
        print(f"ERR sender={bool(sender)} recipient={bool(recipient)}")
        sys.exit(1)

    a, b = sender["id"], recipient["id"]
    conv_id = dm_conv_id(a, b)
    now = datetime.now(timezone.utc).isoformat()

    conv = await db.dm_conversations.find_one({"id": conv_id})
    if not conv:
        await db.dm_conversations.insert_one({
            "id": conv_id,
            "participants": [a, b],
            "created_at": now,
            "updated_at": now,
        })
        print(f"Created conv {conv_id}")
    else:
        await db.dm_conversations.update_one(
            {"id": conv_id},
            {"$set": {"updated_at": now, "archived_for": [], "hidden_for": []}},
        )
        print(f"Reused conv {conv_id}")

    # Clear recipient's last_read_at so the new message is unread.
    await db.dm_conversations.update_one(
        {"id": conv_id},
        {"$unset": {f"last_read_at.{b}": ""}},
    )

    msg = {
        "id": str(uuid.uuid4()),
        "dm_id": conv_id,
        "user_id": a,
        "user_name": sender.get("first_name", ""),
        "avatar": sender.get("avatar", ""),
        "text": args.text,
        "created_at": now,
        "reactions": {},
    }
    await db.messages.insert_one(msg)
    print(f"Inserted msg id={msg['id']} sender={sender.get('first_name')} → recipient={recipient.get('first_name')} conv={conv_id} text={args.text!r}")

    # Verify unread_count via aggregation-like check
    q = {"dm_id": conv_id, "user_id": {"$ne": b}}
    unread = await db.messages.count_documents(q)
    print(f"Unread count for recipient on this conv: {unread}")


if __name__ == "__main__":
    asyncio.run(main())
