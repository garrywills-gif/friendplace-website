"""Seed the starter Segments Garry sketched on 1 Aug 2026.

Idempotent — each starter is upserted by `id`, so re-running just
refreshes cached counts. Run with:

    PYTHONPATH=/app/backend python /app/backend/scripts/seed_starter_segments.py
"""
import asyncio
import os
import sys

sys.path.insert(0, "/app/backend")

from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

from services import segments as _segments  # noqa: E402


STARTERS = [
    {
        "id": "seg-all-founders",
        "name": "All Founding Members",
        "emoji": "🦋",
        "description": "Everyone in the Founding Members CRM.",
        "predicate": {"op": "filter", "id": "founder_only", "value": True},
    },
    {
        "id": "seg-new-members",
        "name": "New Members (last 7 days)",
        "emoji": "🆕",
        "description": "Anyone who created an account in the last week.",
        "predicate": {"op": "filter", "id": "joined_within", "value": 7},
    },
    {
        "id": "seg-havent-shared-moment",
        "name": "Haven't shared a Moment",
        "emoji": "✨",
        "description": "Members who joined but haven't posted a Moment yet.",
        "predicate": {"op": "filter", "id": "shared_moment", "value": False},
    },
    {
        "id": "seg-coffee-lovers",
        "name": "Coffee Lovers",
        "emoji": "☕",
        "description": "People who have Coffee as an interest.",
        "predicate": {"op": "filter", "id": "interest_any", "value": ["Coffee"]},
    },
    {
        "id": "seg-gardeners",
        "name": "Gardeners",
        "emoji": "🌱",
        "description": "People who have Gardening as an interest.",
        "predicate": {"op": "filter", "id": "interest_any", "value": ["Gardening"]},
    },
    {
        "id": "seg-walking-groups",
        "name": "Walking Groups",
        "emoji": "🚶",
        "description": "Members interested in walking.",
        "predicate": {"op": "filter", "id": "interest_any", "value": ["Walking"]},
    },
    {
        "id": "seg-sydney",
        "name": "Sydney",
        "emoji": "📍",
        "description": "Members whose suburb is Sydney (or a Sydney locality).",
        "predicate": {"op": "filter", "id": "location_suburb", "value": "Sydney"},
    },
    {
        "id": "seg-melbourne",
        "name": "Melbourne",
        "emoji": "📍",
        "description": "Members whose suburb is Melbourne.",
        "predicate": {"op": "filter", "id": "location_suburb", "value": "Melbourne"},
    },
    {
        "id": "seg-highly-active",
        "name": "Highly Active Members",
        "emoji": "💙",
        "description": "Members active in the last 7 days who have shared a Moment.",
        "predicate": {
            "op": "and",
            "children": [
                {"op": "filter", "id": "active_within",  "value": 7},
                {"op": "filter", "id": "shared_moment", "value": True},
            ],
        },
    },
    {
        "id": "seg-havent-visited",
        "name": "Haven't visited recently",
        "emoji": "😴",
        "description": "Members who haven't opened the app in over 30 days.",
        "predicate": {"op": "filter", "id": "inactive_over", "value": 30},
    },
    {
        "id": "seg-invalid-emails",
        "name": "Invalid Email Addresses",
        "emoji": "⚠️",
        "description": "Members whose email bounced or was reported as spam.",
        "predicate": {"op": "filter", "id": "email_invalid", "value": True},
    },
    {
        "id": "seg-opted-out",
        "name": "Opted Out",
        "emoji": "🚫",
        "description": "Founding Members who opted out of campaign emails.",
        "predicate": {"op": "filter", "id": "founder_status", "value": ["opted_out"]},
    },
]


async def main() -> None:
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ.get("DB_NAME", "test_database")
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    await _segments.ensure_indexes(db)
    print(f"Seeding {len(STARTERS)} starter segments into `{db_name}.segments`")

    created = updated = 0
    for s in STARTERS:
        existing = await db[_segments.COLLECTION].find_one({"id": s["id"]}, {"_id": 1})
        saved = await _segments.upsert_segment(db, s, actor_email="seed@friendplace.com.au")
        if existing:
            updated += 1
        else:
            created += 1
        emoji = saved.get("emoji") or "•"
        print(f"  {emoji} {saved['name']:35s} — {saved.get('last_count', '?')} members")

    print(f"\ndone: created {created}, updated {updated}")


if __name__ == "__main__":
    asyncio.run(main())
