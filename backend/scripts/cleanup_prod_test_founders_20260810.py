#!/usr/bin/env python3
"""
cleanup_prod_test_founders_20260810.py

Soft-flag every Founder row that was created for testing/setup so the
public Founders Wall opens at 0 / 250 for the V1 launch — while
RESERVING founder_number #1 and #2 in the ledger so the first genuine
public signup is assigned Founder #3.

This is Path B (reserved-numbers variant) from the Batch B iter156
audit (Garry, 10 Aug 2026):

    - $set is_test = True on ALL 6 target rows so they disappear from
      the public wall + status counter (filter added in server.py).

    - $rename founder_number → former_founder_number ONLY on the last
      four rows (Gaz #3, garry #4, admin #5, kaya #6). Alice #1 and
      Bob #2 keep their founder_number intact — this "reserves" seats
      #1 and #2 in the DB ledger. Because they still carry
      `is_test = True`, they remain hidden from the public wall.

    - Because the promotion logic in server.py picks
      `max(existing founder_number) + 1`, and the max after this run
      is 2, the next real member will be assigned Founder #3.

    - is_founder = True is preserved on every row so we can prove the
      row was promoted at some point.

    - is_admin / password_hash / email / oauth / friendships / any
      other permissions are left completely untouched — this script
      does NOT alter admin access.

    - No user rows are deleted.

Usage:

    # Dry run — prints BEFORE snapshot + preview of the operation, no writes.
    #   MONGO_URL / DB_NAME must be set to the production connection.
    MONGO_URL='mongodb+srv://…' DB_NAME='<prod-db-name>' \\
      python3 cleanup_prod_test_founders_20260810.py --dry-run

    # Actually apply.
    MONGO_URL='mongodb+srv://…' DB_NAME='<prod-db-name>' \\
      python3 cleanup_prod_test_founders_20260810.py --commit

    # Rollback — restores founder_number and clears is_test on rows
    # this script itself touched (checks the reason tag).
    MONGO_URL='mongodb+srv://…' DB_NAME='<prod-db-name>' \\
      python3 cleanup_prod_test_founders_20260810.py --rollback

Idempotency: re-running --commit on already-flagged rows is a no-op —
`$rename` skips silently when the source field is absent, `$set` is
naturally idempotent. Safe to retry.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient


# ---- The exact production Founder rows to clean up ----
# Confirmed by the user (Garry Wills, 10 Aug 2026): every account below
# was created by him for testing / setup. None represent a genuine
# public member of the Founding Member cohort.
#
# `reserve_number = True` means we KEEP their `founder_number` in place
# so the ledger reserves that seat — the row is still hidden from the
# public wall via `is_test = True`. Only rows with reserve_number = False
# have their `founder_number` renamed to `former_founder_number`, which
# effectively releases the higher numbers back to the pool. The first
# real signup will land on `max(reserved) + 1 = 3`.
TARGETS: list[tuple[str, str, int, bool]] = [
    # (user id,                                         username,        current founder_number, reserve?)
    ("ac9c70fd-2f0b-4088-bfea-0c20539c690e",            "fw_test_alice",  1, True),   # RESERVED — keeps #1
    ("5e21539e-bc06-4db7-9186-5395052f4560",            "fw_test_bob",    2, True),   # RESERVED — keeps #2
    ("523149c2-dd9f-457d-ba5a-f939bb83bfd4",            "gaz",            3, False),  # number released to pool
    ("17290f98-f790-4a81-a56d-b95cd424c0ea",            "garry",          4, False),  # number released to pool
    ("dc2191dd-0290-4a79-bed8-9d3d6733015f",            "admin",          5, False),  # number released; admin permissions untouched
    ("ed4a450e-98e6-439b-b587-43710a434992",            "kaya",           6, False),  # number released to pool
]

REASON_TAG = "batch-b-iter156-founder-cleanup-20260810"


def _client() -> AsyncIOMotorClient:
    url = os.environ.get("MONGO_URL")
    if not url:
        print("ERROR: MONGO_URL env var is required", file=sys.stderr)
        sys.exit(2)
    return AsyncIOMotorClient(url)


def _db(c: AsyncIOMotorClient):
    name = os.environ.get("DB_NAME")
    if not name:
        print("ERROR: DB_NAME env var is required", file=sys.stderr)
        sys.exit(2)
    return c[name]


async def _snapshot(db) -> list[dict]:
    ids = [t[0] for t in TARGETS]
    docs = await db.users.find(
        {"id": {"$in": ids}},
        {"_id": 0, "id": 1, "username": 1, "is_founder": 1, "is_test": 1,
         "is_demo": 1, "is_admin": 1, "founder_number": 1,
         "former_founder_number": 1, "created_at": 1,
         "test_flagged_reason": 1},
    ).to_list(len(ids) + 5)
    # Preserve TARGETS order so operators can diff row-by-row against
    # the plan they've been given.
    idx = {tid: i for i, (tid, _, _, _) in enumerate(TARGETS)}
    docs.sort(key=lambda d: idx.get(d.get("id"), 999))
    return docs


def _pretty(docs: list[dict]) -> str:
    return json.dumps(docs, indent=2, default=str, ensure_ascii=False)


async def _dry_run(db) -> None:
    print("=" * 72)
    print("DRY RUN — no writes will be made")
    print("=" * 72)
    print("Targets (from TARGETS constant):")
    for tid, uname, num, reserve in TARGETS:
        action = "RESERVE founder_number" if reserve else "release founder_number → former_founder_number"
        print(f"  #{num}  @{uname:<16} {tid}  →  {action}")
    print("")
    print("BEFORE snapshot from production DB:")
    print(_pretty(await _snapshot(db)))
    print("")
    print("Proposed operations:")
    print("  1) Set is_test = True on ALL 6 rows (soft-flag).")
    print("  2) Rename founder_number → former_founder_number on the 4 rows")
    print("     where reserve_number is False (Gaz, garry, admin, kaya).")
    print("  3) Alice (#1) and Bob (#2) keep their founder_number for ledger")
    print("     reservation — invisible on the wall because of is_test.")
    print("")
    print("Nothing was written. Re-run with --commit to apply.")


async def _commit(db) -> None:
    before = await _snapshot(db)
    matched_ids = {d["id"] for d in before}
    missing = [(tid, un) for tid, un, _, _ in TARGETS if tid not in matched_ids]
    if missing:
        print(f"WARNING: {len(missing)} target id(s) not found in this DB:")
        for tid, un in missing:
            print(f"  @{un}  {tid}")
        print("They will simply be skipped — proceeding with the rows that matched.")

    all_ids = [t[0] for t in TARGETS]
    release_ids = [t[0] for t in TARGETS if not t[3]]

    ts = datetime.now(timezone.utc).isoformat()

    # Step 1 — soft-flag every target row.
    flag_res = await db.users.update_many(
        {"id": {"$in": all_ids}},
        {
            "$set": {
                "is_test": True,
                "test_flagged_at": ts,
                "test_flagged_reason": REASON_TAG,
            },
        },
    )
    print(f"Step 1 — is_test soft-flag: matched={flag_res.matched_count} modified={flag_res.modified_count}")

    # Step 2 — release founder_number on the non-reserved rows only.
    rename_res = await db.users.update_many(
        {"id": {"$in": release_ids}, "founder_number": {"$exists": True}},
        {"$rename": {"founder_number": "former_founder_number"}},
    )
    print(f"Step 2 — founder_number release (4 rows): matched={rename_res.matched_count} modified={rename_res.modified_count}")

    print("")
    print("AFTER snapshot:")
    print(_pretty(await _snapshot(db)))


async def _rollback(db) -> None:
    """Restore the DB to the state before --commit. Only touches rows
    this script itself flagged (identified by test_flagged_reason)."""
    ids = [t[0] for t in TARGETS]
    before = await _snapshot(db)
    print("Rolling back rows tagged by this script…")

    # Step 1 — restore founder_number where former_founder_number is set
    r_rename = await db.users.update_many(
        {"id": {"$in": ids},
         "former_founder_number": {"$exists": True},
         "test_flagged_reason": REASON_TAG},
        {"$rename": {"former_founder_number": "founder_number"}},
    )
    print(f"Step 1 — restore founder_number: matched={r_rename.matched_count} modified={r_rename.modified_count}")

    # Step 2 — clear our flags on every row we tagged
    r_unset = await db.users.update_many(
        {"id": {"$in": ids}, "test_flagged_reason": REASON_TAG},
        {"$unset": {"is_test": "", "test_flagged_at": "", "test_flagged_reason": ""}},
    )
    print(f"Step 2 — clear is_test / audit fields: matched={r_unset.matched_count} modified={r_unset.modified_count}")

    print("")
    print("AFTER snapshot:")
    print(_pretty(await _snapshot(db)))


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="print snapshot + plan, no writes")
    mode.add_argument("--commit", action="store_true", help="apply the Path B (reserved-numbers) mutations")
    mode.add_argument("--rollback", action="store_true", help="undo the flag (only for rows this script tagged)")
    args = ap.parse_args()

    client = _client()
    db = _db(client)
    try:
        if args.dry_run:
            await _dry_run(db)
        elif args.commit:
            await _commit(db)
        elif args.rollback:
            await _rollback(db)
    finally:
        client.close()


if __name__ == "__main__":
    asyncio.run(main())
