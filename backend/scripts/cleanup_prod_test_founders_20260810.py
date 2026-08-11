#!/usr/bin/env python3
"""
cleanup_prod_test_founders_20260810.py

Reset the public Founders Wall for V1 launch. Reserved-numbers Path B
(final variant, Garry Wills, 10 Aug 2026):

    - @gaz becomes the sole public Founder, renumbered from #3 → #1.
      The old number 3 is snapshotted into `former_founder_number`
      so the rollback path can restore it exactly.

    - @fw_test_bob keeps founder_number = 2 as an INVISIBLE reserved
      seat for "George" (to be identified). is_test = true hides them
      from the public wall so the seat is real in the ledger but not
      shown to members.

    - @fw_test_alice, @garry (chat-test), @admin, @kaya are all
      soft-archived: is_test = true is set, founder_number is renamed
      to former_founder_number. Their user rows and their
      authentication continue to work — is_admin on the admin row is
      NOT touched, so admin access is preserved. @kaya remains a
      functional test/chat account; @garry (chat-test) is soft-
      archived rather than kept for testing (per Garry's decision).

    - is_founder = True is preserved on every touched row for audit /
      possible future reinstatement.

    - No user rows are deleted.

Predicted public outcome after --commit + backend redeploy:
    GET /api/founders/status  →  {"cap":250,"taken":1,"remaining":249,"open":true}
    GET /api/founders          →  1 row (Garry, founder_number: 1)
    Next genuine signup number →  #3
       (highest existing founder_number in DB = 2 [Bob, reserved],
        public count = 1 [Garry], so next = max(2+1, 1+1) = 3)

Usage:
    # Dry run — prints BEFORE snapshot + preview of the operation, no writes.
    MONGO_URL='mongodb+srv://…' DB_NAME='<prod-db-name>' \\
      python3 cleanup_prod_test_founders_20260810.py --dry-run

    # Apply.
    MONGO_URL='mongodb+srv://…' DB_NAME='<prod-db-name>' \\
      python3 cleanup_prod_test_founders_20260810.py --commit

    # Rollback — restores all touched rows. Only affects rows tagged
    # with test_flagged_reason = REASON_TAG.
    MONGO_URL='mongodb+srv://…' DB_NAME='<prod-db-name>' \\
      python3 cleanup_prod_test_founders_20260810.py --rollback
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient


# Three action classes:
#   promote_to  = the row becomes the public Founder at this number.
#                  We snapshot the old number into former_founder_number
#                  before setting the new one. is_test stays UNSET so the
#                  row appears on the public wall.
#   reserve     = the row keeps its current founder_number as an invisible
#                  reservation. We set is_test=True so the wall hides it,
#                  but leave founder_number in place so the numbering
#                  ceiling stays intact and the next signup skips this seat.
#   soft_archive = the row is fully removed from the founder cohort but
#                   its user account is preserved. We $rename founder_number
#                   into former_founder_number and set is_test=True. Admin
#                   permissions on @admin are NOT touched.
TARGETS: list[dict] = [
    {"id": "523149c2-dd9f-457d-ba5a-f939bb83bfd4",
     "username": "gaz",
     "current_number": 3,
     "action": "promote_to",
     "new_number": 1},
    {"id": "5e21539e-bc06-4db7-9186-5395052f4560",
     "username": "fw_test_bob",
     "current_number": 2,
     "action": "reserve"},
    {"id": "ac9c70fd-2f0b-4088-bfea-0c20539c690e",
     "username": "fw_test_alice",
     "current_number": 1,
     "action": "soft_archive"},
    {"id": "17290f98-f790-4a81-a56d-b95cd424c0ea",
     "username": "garry",
     "current_number": 4,
     "action": "soft_archive_deactivate"},
    {"id": "dc2191dd-0290-4a79-bed8-9d3d6733015f",
     "username": "admin",
     "current_number": 5,
     "action": "soft_archive"},
    {"id": "ed4a450e-98e6-439b-b587-43710a434992",
     "username": "kaya",
     "current_number": 6,
     "action": "soft_archive"},
]

REASON_TAG = "batch-b-iter156-founder-cleanup-20260810"
SNAPSHOT_FIELDS = {
    "_id": 0, "id": 1, "username": 1, "first_name": 1,
    "is_founder": 1, "is_test": 1, "is_demo": 1, "is_admin": 1,
    "banned": 1, "banned_reason": 1,
    "founder_number": 1, "former_founder_number": 1,
    "created_at": 1, "test_flagged_reason": 1,
}


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
    ids = [t["id"] for t in TARGETS]
    docs = await db.users.find({"id": {"$in": ids}}, SNAPSHOT_FIELDS).to_list(len(ids) + 5)
    idx = {t["id"]: i for i, t in enumerate(TARGETS)}
    docs.sort(key=lambda d: idx.get(d.get("id"), 999))
    return docs


def _pretty(docs: list[dict]) -> str:
    return json.dumps(docs, indent=2, default=str, ensure_ascii=False)


def _plan_summary() -> str:
    lines: list[str] = []
    for t in TARGETS:
        if t["action"] == "promote_to":
            lines.append(f"  @{t['username']:<16}  #{t['current_number']} → PROMOTE to #{t['new_number']}  "
                         f"(snapshot old number to former_founder_number, keep is_founder=True, no is_test)")
        elif t["action"] == "reserve":
            lines.append(f"  @{t['username']:<16}  #{t['current_number']}   RESERVE seat as invisible  "
                         f"(keep founder_number={t['current_number']}, set is_test=True)")
        elif t["action"] == "soft_archive_deactivate":
            lines.append(f"  @{t['username']:<16}  #{t['current_number']} → soft-archive + DEACTIVATE  "
                         f"($rename founder_number → former_founder_number, set is_test=True, set banned=True — login blocked)")
        else:
            lines.append(f"  @{t['username']:<16}  #{t['current_number']} → soft-archive  "
                         f"($rename founder_number → former_founder_number, set is_test=True)")
    return "\n".join(lines)


async def _dry_run(db) -> None:
    print("=" * 72)
    print("DRY RUN — no writes will be made")
    print("=" * 72)
    print("Plan:")
    print(_plan_summary())
    print("")
    print("BEFORE snapshot from production DB:")
    print(_pretty(await _snapshot(db)))
    print("")
    print("Predicted public outcome after --commit + backend redeploy:")
    print("  /api/founders/status  →  {\"cap\":250,\"taken\":1,\"remaining\":249,\"open\":true}")
    print("  /api/founders          →  1 row: Garry #1")
    print("  Next genuine signup  →  #3   (max founder_number=2 [Bob reserved]; public count=1)")
    print("")
    print("Nothing was written. Re-run with --commit to apply.")


async def _commit(db) -> None:
    before = await _snapshot(db)
    matched_ids = {d["id"] for d in before}
    missing = [(t["id"], t["username"]) for t in TARGETS if t["id"] not in matched_ids]
    if missing:
        print(f"WARNING: {len(missing)} target id(s) not found in this DB — will be skipped:")
        for mid, mu in missing:
            print(f"  @{mu:<16} {mid}")

    ts = datetime.now(timezone.utc).isoformat()

    # Bucket rows by action
    all_ids = [t["id"] for t in TARGETS]
    promote_targets = [t for t in TARGETS if t["action"] == "promote_to"]
    reserve_targets = [t for t in TARGETS if t["action"] == "reserve"]
    archive_targets = [t for t in TARGETS if t["action"] in ("soft_archive", "soft_archive_deactivate")]
    deactivate_targets = [t for t in TARGETS if t["action"] == "soft_archive_deactivate"]

    # ── Step 1 ── Soft-flag every reserve + archive row (NOT the promote row).
    flag_ids = [t["id"] for t in reserve_targets + archive_targets]
    r1 = await db.users.update_many(
        {"id": {"$in": flag_ids}},
        {"$set": {
            "is_test": True,
            "test_flagged_at": ts,
            "test_flagged_reason": REASON_TAG,
        }},
    )
    print(f"Step 1 — soft-flag reserve + archive rows: matched={r1.matched_count} modified={r1.modified_count}")

    # ── Step 2 ── Rename founder_number → former_founder_number on archive rows.
    archive_ids = [t["id"] for t in archive_targets]
    r2 = await db.users.update_many(
        {"id": {"$in": archive_ids}, "founder_number": {"$exists": True}},
        {"$rename": {"founder_number": "former_founder_number"}},
    )
    print(f"Step 2 — release founder_number on soft-archive rows: matched={r2.matched_count} modified={r2.modified_count}")

    # ── Step 2b ── Deactivate rows flagged as `soft_archive_deactivate`
    #     by setting `banned: True`. That's the field the FastAPI login
    #     paths check (password, demo, Google, Apple) so a banned row
    #     cannot start a new session. Existing sessions would expire
    #     when their token does. We stamp the reason so the rollback
    #     path knows this was us and can safely clear the flag.
    if deactivate_targets:
        deactivate_ids = [t["id"] for t in deactivate_targets]
        r2b = await db.users.update_many(
            {"id": {"$in": deactivate_ids}},
            {"$set": {
                "banned": True,
                "banned_at": ts,
                "banned_reason": REASON_TAG,
            }},
        )
        print(f"Step 2b — deactivate (ban) login on {', '.join('@' + t['username'] for t in deactivate_targets)}: matched={r2b.matched_count} modified={r2b.modified_count}")

    # ── Step 3 ── Renumber the promote target(s). Each promote step is
    # a two-stage update on that specific user to guarantee we don't
    # collide with an existing founder_number: first snapshot the old
    # value, then set the new one.
    for t in promote_targets:
        # 3a) Snapshot the existing founder_number into former_founder_number.
        #      We use $rename which is a no-op if the source is absent.
        await db.users.update_one(
            {"id": t["id"], "founder_number": {"$exists": True}},
            {"$rename": {"founder_number": "former_founder_number"}},
        )
        # 3b) Set the new founder_number, and stamp a promote_reason so
        #      rollback can find and reverse it.
        r3 = await db.users.update_one(
            {"id": t["id"]},
            {"$set": {
                "founder_number": t["new_number"],
                "promote_reason": REASON_TAG,
                "promoted_at": ts,
            }},
        )
        print(f"Step 3 — promote @{t['username']} to #{t['new_number']}: matched={r3.matched_count} modified={r3.modified_count}")

    print("")
    print("AFTER snapshot:")
    print(_pretty(await _snapshot(db)))


async def _rollback(db) -> None:
    """Undo everything this script did. Only affects rows tagged by
    this script (via test_flagged_reason or promote_reason). Never
    touches rows we didn't tag.
    """
    ids = [t["id"] for t in TARGETS]
    print("Rolling back rows tagged by this script…")

    # ── R1 ── Undo the promote: restore former_founder_number → founder_number,
    #          drop the promote metadata.
    r1 = await db.users.update_many(
        {"id": {"$in": ids},
         "promote_reason": REASON_TAG,
         "former_founder_number": {"$exists": True}},
        [
            # Aggregation pipeline: set founder_number FROM former_founder_number,
            # then unset both former_founder_number and the promote metadata.
            {"$set": {"founder_number": "$former_founder_number"}},
            {"$unset": ["former_founder_number", "promote_reason", "promoted_at"]},
        ],
    )
    print(f"R1 — undo promote: matched={r1.matched_count} modified={r1.modified_count}")

    # ── R2 ── For soft-archive rows: restore former_founder_number → founder_number.
    r2 = await db.users.update_many(
        {"id": {"$in": ids},
         "test_flagged_reason": REASON_TAG,
         "former_founder_number": {"$exists": True}},
        {"$rename": {"former_founder_number": "founder_number"}},
    )
    print(f"R2 — restore founder_number on archived rows: matched={r2.matched_count} modified={r2.modified_count}")

    # ── R3 ── Clear the is_test / audit fields on every row we tagged.
    r3 = await db.users.update_many(
        {"id": {"$in": ids}, "test_flagged_reason": REASON_TAG},
        {"$unset": {"is_test": "", "test_flagged_at": "", "test_flagged_reason": ""}},
    )
    print(f"R3 — clear is_test / audit fields: matched={r3.matched_count} modified={r3.modified_count}")

    # ── R4 ── Un-ban any rows we deactivated. Only rows tagged by us
    #     via banned_reason = REASON_TAG are touched — never any other
    #     genuine ban.
    r4 = await db.users.update_many(
        {"id": {"$in": ids}, "banned_reason": REASON_TAG},
        {"$unset": {"banned": "", "banned_at": "", "banned_reason": ""}},
    )
    print(f"R4 — undo login deactivation: matched={r4.matched_count} modified={r4.modified_count}")

    print("")
    print("AFTER snapshot:")
    print(_pretty(await _snapshot(db)))


async def main() -> None:
    ap = argparse.ArgumentParser(description="Founders Wall reset — reserved-numbers Path B (final).")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--commit", action="store_true")
    mode.add_argument("--rollback", action="store_true")
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
