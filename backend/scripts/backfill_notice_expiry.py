"""
TestFlight feedback (Neo, Feb 2026 — item #2):
79 of the ~97 live notices had no `active_to`, so pre-launch and June
test posts never dropped off the member-facing board.

This one-off backfill applies the "30-day stale" rule that was signed
off with the user:

    For every non-removed notice with no `active_to`, set
    `active_to = created_at + 30 days`.

Notices that are STILL within their 30-day window remain visible.
Everything older rotates off the Notice Board immediately on the next
feed load. Nothing is deleted — expired notices remain in Mongo and
can still be inspected / restored via MCGS admin tools.

Idempotent: re-running the script skips notices that already have an
`active_to` (so re-publishing is safe).

Usage:
    cd /app/backend && python3 scripts/backfill_notice_expiry.py [--dry-run]
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()

DEFAULT_DAYS = 30


def _parse_iso(s: str) -> datetime | None:
    try:
        return datetime.fromisoformat((s or "").replace("Z", "+00:00"))
    except Exception:
        return None


async def main(dry_run: bool, days: int) -> int:
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "test_database")]
    now = datetime.now(timezone.utc)

    # Only touch notices that are not already soft-removed and have no
    # explicit `active_to`. Legacy records can also have `active_to=""`.
    query = {
        "removed": {"$ne": True},
        "$or": [
            {"active_to": {"$exists": False}},
            {"active_to": None},
            {"active_to": ""},
        ],
    }

    cursor = db.notices.find(query, {"_id": 0, "id": 1, "created_at": 1, "title": 1})
    to_update: list[tuple[str, str, str]] = []
    async for d in cursor:
        created = _parse_iso(d.get("created_at") or "")
        if not created:
            # Legacy row with no parseable timestamp — anchor to now so
            # it still expires predictably rather than lingering.
            created = now
        active_to = created + timedelta(days=days)
        to_update.append((d["id"], created.isoformat(), active_to.isoformat()))

    print(f"[notices] candidates: {len(to_update)}  (window: {days} days)")
    if dry_run:
        for nid, ca, at in to_update[:20]:
            print(f"  would set active_to={at} on {nid}  (created {ca})")
        if len(to_update) > 20:
            print(f"  ... +{len(to_update) - 20} more")
        print("[notices] dry-run only — no writes performed.")
        return 0

    expired = 0
    for nid, _ca, at in to_update:
        res = await db.notices.update_one(
            {"id": nid, "$or": [
                {"active_to": {"$exists": False}},
                {"active_to": None},
                {"active_to": ""},
            ]},
            {"$set": {"active_to": at}},
        )
        if res.modified_count and _parse_iso(at) and _parse_iso(at) < now:  # type: ignore[operator]
            expired += 1
    print(f"[notices] updated: {len(to_update)}  (of which {expired} are already past-dated and will hide immediately)")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Back-fill `active_to` on legacy notices.")
    parser.add_argument("--dry-run", action="store_true", help="Report what would change without writing.")
    parser.add_argument("--days", type=int, default=DEFAULT_DAYS, help="Stale window in days (default 30).")
    args = parser.parse_args()
    sys.exit(asyncio.run(main(dry_run=args.dry_run, days=args.days)))
