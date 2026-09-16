#!/usr/bin/env python3
"""
seed_founder_reserved_slots.py

Restore genuine historical Founding-Member number gaps by seeding them into
the reserved-slot / gap-fill queue that `_next_founder_number()` drains
lowest-first (see backend/server.py). The next genuine registrations then
receive these numbers, in ascending order, WITHOUT renumbering or altering
any existing founder record.

Target gaps (Garry, audited from the live Founding Members list):

    #0092, #0100, #0101

The current live sequence includes #0091 → #0093, and later #0099 → #0102.
#0055 and #0093 are opted-out members that still display, so these three
numbers are real ownerless gaps.

SAFETY MODEL
------------
  * --dry-run (DEFAULT): pure read-only. For each target it reports whether the
    number has any owner in `interest_registrations` (any is_test / any status)
    or `retired_registrations` (founder_number OR former_founder_number), and
    whether a reserved slot already exists. NO writes.
  * --commit: seeds ONLY numbers proven ownerless in this run. It refuses to
    seed any number that has a live (non-test) registration owner, and it is
    idempotent (an existing slot is left untouched, never duplicated or
    resurrected once consumed).

The queue is a separate collection; the monotonic counter and every existing
founder record are never touched by this script.

USAGE
-----
    # Read-only ownership verification (no writes). RUN THIS FIRST in prod.
    MONGO_URL='mongodb+srv://…' DB_NAME='<prod-db-name>' \
      python3 seed_founder_reserved_slots.py --dry-run

    # Seed the ownerless gaps into the live reserved-slot queue.
    MONGO_URL='mongodb+srv://…' DB_NAME='<prod-db-name>' \
      python3 seed_founder_reserved_slots.py --commit
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient

TARGET_NUMBERS = [92, 100, 101]  # audited gaps, ascending (issued lowest-first)
SLOTS_COLL = "founder_reserved_slots"
SEED_NOTE = "Audited Founding Member gap restored to reserved-slot queue (Garry, milestone recovery)"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _ownership_evidence(db, number: int) -> dict:
    """Read-only: gather every owner-ish reference to `number`."""
    live = await db.interest_registrations.find(
        {"founder_number": number},
        {"_id": 0, "id": 1, "first_name": 1, "email": 1, "status": 1, "is_test": 1},
    ).to_list(None)
    retired = await db.retired_registrations.find(
        {"$or": [{"founder_number": number}, {"former_founder_number": number}]},
        {"_id": 0, "id": 1, "founder_number": 1, "former_founder_number": 1,
         "email": 1, "status": 1},
    ).to_list(None)
    slot = await db[SLOTS_COLL].find_one({"number": number}, {"_id": 0})

    live_real = [r for r in live if not r.get("is_test")]
    return {
        "number": number,
        "interest_registrations": live,
        "retired_registrations": retired,
        "existing_slot": slot,
        "ownerless": len(live_real) == 0,  # a real, non-test owner blocks seeding
    }


async def _reserve(db, number: int, ev: dict) -> dict:
    """Idempotent, validated seed of one number. Mirrors server._reserve_founder_slot."""
    if not ev["ownerless"]:
        return {"number": number, "seeded": False, "reason": "number already assigned"}
    if ev["existing_slot"]:
        return {"number": number, "seeded": False,
                "reason": f"slot already present (status={ev['existing_slot'].get('status')})"}
    await db[SLOTS_COLL].insert_one({
        "number": number,
        "status": "available",
        "created_at": _now_iso(),
        "created_by": "seed_founder_reserved_slots.py",
        "note": SEED_NOTE,
    })
    return {"number": number, "seeded": True, "reason": "reserved (available)"}


def _print_evidence(ev: dict) -> None:
    n = ev["number"]
    print(f"\n#{n:04d}")
    print(f"  interest_registrations : {ev['interest_registrations'] or 'none'}")
    print(f"  retired_registrations  : {ev['retired_registrations'] or 'none'}")
    print(f"  existing reserved slot : {ev['existing_slot'] or 'none'}")
    print(f"  ownerless (seedable)   : {ev['ownerless']}")


async def main(commit: bool) -> int:
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        print("ERROR: set MONGO_URL and DB_NAME env vars (production target).")
        return 2

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    try:
        # Ensure the unique index exists so --commit can't ever double-seed.
        await db[SLOTS_COLL].create_index("number", unique=True)

        print(f"Target DB: {db_name}")
        print(f"Mode     : {'COMMIT (writes)' if commit else 'DRY-RUN (read-only)'}")
        print(f"Targets  : {', '.join('#%04d' % n for n in TARGET_NUMBERS)}")

        evidence = [await _ownership_evidence(db, n) for n in sorted(TARGET_NUMBERS)]
        print("\n=== OWNERSHIP EVIDENCE (read-only) ===")
        for ev in evidence:
            _print_evidence(ev)

        blocked = [ev["number"] for ev in evidence if not ev["ownerless"]]
        if blocked:
            print("\n⚠️  These numbers have a live owner and will NOT be seeded: "
                  + ", ".join("#%04d" % n for n in blocked))

        if not commit:
            print("\nDRY-RUN complete. No writes made. "
                  "Re-run with --commit once ownership is confirmed.")
            return 0

        print("\n=== COMMIT: seeding ownerless gaps ===")
        for ev in evidence:
            res = await _reserve(db, ev["number"], ev)
            tag = "SEEDED" if res["seeded"] else "skipped"
            print(f"  #{res['number']:04d}: {tag} — {res['reason']}")

        remaining = await db[SLOTS_COLL].count_documents({"status": "available"})
        print(f"\nAvailable reserved slots now: {remaining}")
        print("The next genuine registrations will receive the available "
              "reserved numbers lowest-first.")
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--dry-run", action="store_true", help="read-only (default)")
    g.add_argument("--commit", action="store_true", help="seed ownerless gaps")
    args = ap.parse_args()
    sys.exit(asyncio.run(main(commit=args.commit)))
