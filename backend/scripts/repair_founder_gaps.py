#!/usr/bin/env python3
"""Repair historical Founding Member number gaps — SAFELY and idempotently.

For each target number we run OWNERSHIP CHECKS across every collection that
could legitimately own or remember a founder number:
  • interest_registrations   (live founder rows — any status, incl. is_test)
  • retired_registrations    (retired history, if present)
  • founder_reserved_slots   (already queued?)
  • a generic scan of ALL collections for any of the founder-number-ish fields:
        founder_number, retired_founder_number, keeper_founder_number,
        retire_keeper_founder_number, original_founder_number

A number is only ever reserved (added to founder_reserved_slots as
`available`) when it is GENUINELY UNUSED everywhere. Reservation goes through
server._reserve_founder_slot, which itself refuses to reserve a number a live
registration holds — so this is belt-and-braces.

DRY-RUN BY DEFAULT. Pass --apply to actually reserve the unused gaps. Existing
successful registrations and founder numbers are NEVER touched or renumbered.

Usage (run inside the target environment, e.g. production):
    python scripts/repair_founder_gaps.py                 # report only
    python scripts/repair_founder_gaps.py --apply         # reserve unused gaps
    python scripts/repair_founder_gaps.py 108 109 110 --apply
"""
from __future__ import annotations

import sys
import asyncio
import argparse

sys.path.insert(0, "/app/backend")

import server  # noqa: E402

# Production gaps reported by Garry (iter190). Override on the CLI if needed.
DEFAULT_TARGETS = [108, 109, 110, 118, 119, 120, 121]

_FOUNDER_FIELDS = [
    "founder_number",
    "retired_founder_number",
    "keeper_founder_number",
    "retire_keeper_founder_number",
    "original_founder_number",
]


async def _owners_of(db, number: int) -> list[dict]:
    """Return a list of {collection, field, count} for every place `number`
    appears under a founder-number-ish field, across ALL collections."""
    hits: list[dict] = []
    names = await db.list_collection_names()
    for coll in names:
        for field in _FOUNDER_FIELDS:
            try:
                n = await db[coll].count_documents({field: number})
            except Exception:
                n = 0
            if n:
                hits.append({"collection": coll, "field": field, "count": n})
    return hits


async def main(targets: list[int], apply: bool) -> int:
    db = server.db
    print(f"Founder-gap repair — DB={db.name!r}  mode={'APPLY' if apply else 'DRY-RUN'}")
    print("=" * 68)

    to_reserve: list[int] = []
    for number in sorted(set(int(n) for n in targets)):
        display = server._fmt_founder_no(number)
        owners = await _owners_of(db, number)
        slot = await db[server._FOUNDER_RESERVED_SLOTS_COLL].find_one({"number": number})

        # Ownership = any real founder-number reference in a NON-slot collection.
        real_owners = [h for h in owners if h["collection"] != server._FOUNDER_RESERVED_SLOTS_COLL]

        print(f"\n{display} (n={number})")
        if real_owners:
            for h in real_owners:
                print(f"   OWNED  → {h['collection']}.{h['field']} ×{h['count']}")
            print("   → SKIP (number is in use / remembered; never re-issue).")
            continue
        if slot:
            print(f"   reserved_slot status={slot.get('status')!r} — already queued.")
            if slot.get("status") == "available":
                print("   → already available; nothing to do.")
            else:
                print("   → SKIP (slot exists but not available; leaving as-is).")
            continue
        print("   UNUSED everywhere — eligible to reserve (lowest-first).")
        to_reserve.append(number)

    print("\n" + "=" * 68)
    if not to_reserve:
        print("No unused gaps to reserve. Nothing to do.")
        return 0

    print(f"Eligible to reserve: {', '.join(server._fmt_founder_no(n) for n in to_reserve)}")
    if not apply:
        print("DRY-RUN — re-run with --apply to reserve these as available slots.")
        return 0

    for number in to_reserve:
        res = await server._reserve_founder_slot(
            number, note="gap repair (iter190)", created_by="repair_founder_gaps",
        )
        print(f"   reserve {server._fmt_founder_no(number)} → {res}")
    print("Done. Future confirmed registrations will fill these lowest-first.")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("numbers", nargs="*", type=int, help="founder numbers (default: known prod gaps)")
    ap.add_argument("--apply", action="store_true", help="actually reserve unused gaps")
    args = ap.parse_args()
    targets = args.numbers or DEFAULT_TARGETS
    sys.exit(asyncio.run(main(targets, args.apply)))
