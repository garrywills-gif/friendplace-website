"""iter164 — Retire duplicate Founding Member registrations safely.

USAGE
-----

Dry run (default) — shows what WOULD happen without touching the DB::

    cd /app/backend
    python scripts/retire_duplicate_founding_members.py

Retire ALL duplicate emails (keep earliest per email, retire the rest)::

    python scripts/retire_duplicate_founding_members.py --apply

Retire ONE specific duplicate by founder number (safest for a targeted
fix; the script will refuse if that number isn't actually a duplicate)::

    python scripts/retire_duplicate_founding_members.py --apply --retire 11

Retire duplicates for one specific email::

    python scripts/retire_duplicate_founding_members.py --apply --email dora@example.com

WHAT IT DOES
------------

1. Finds duplicate emails in ``interest_registrations`` (excluding
   ``is_test:true``).
2. Chooses the KEEPER: the row with the lowest ``founder_number`` (or,
   if numbers are missing, the earliest ``created_at``).
3. For every other row with the same email:
   - Copies the full document into ``retired_registrations`` with a
     ``retired_at`` timestamp, a ``reason`` string and the id of the
     keeper. This is an audit trail; nothing is silently deleted.
   - Deletes the row from ``interest_registrations``.
4. Prints a clear before/after summary.

The Founding Member counter is NOT rewound — a gap in numbering
(e.g. #0010 kept, #0011 retired, next new registration gets #0012)
is intentional and safer than reusing a number that may have already
been quoted in an email to someone else.

SAFETY
------

- Dry run by default; only ``--apply`` actually writes.
- Refuses to retire the KEEPER by mistake (uses ``--retire`` to name
  which founder number to remove, and only allows it when that
  number's email really does have another row with a lower number).
- Never touches ``is_reserved:true`` seed rows.
- Never touches ``is_test:true`` fixtures.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Make the backend package importable when run from ./scripts
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _find_duplicate_groups(db, only_email: str | None = None):
    """Return a list of dicts: {email, rows: [row, ...]} for every
    non-test email that has more than one row."""
    match = {"is_test": {"$ne": True}}
    if only_email:
        match["email"] = only_email.strip().lower()

    pipeline = [
        {"$match": match},
        {"$group": {"_id": "$email", "n": {"$sum": 1},
                    "rows": {"$push": "$$ROOT"}}},
        {"$match": {"n": {"$gt": 1}}},
    ]
    groups = await db.interest_registrations.aggregate(pipeline).to_list(None)
    # Return only groups that pass the follow-up sanity check.
    out = []
    for g in groups:
        # Never retire reserved rows automatically.
        rows = [r for r in g["rows"] if not r.get("is_reserved")]
        if len(rows) < 2:
            continue
        rows.sort(key=lambda r: (
            r.get("founder_number") if isinstance(r.get("founder_number"), int) else 10**9,
            r.get("created_at") or "",
        ))
        out.append({"email": g["_id"], "keeper": rows[0], "duplicates": rows[1:]})
    return out


async def _retire_row(db, row, keeper, reason: str):
    """Move a row from interest_registrations → retired_registrations."""
    now = _now_iso()
    audit = dict(row)
    audit.pop("_id", None)
    audit["retired_at"] = now
    audit["retire_reason"] = reason
    audit["retire_keeper_id"] = keeper.get("id")
    audit["retire_keeper_founder_number"] = keeper.get("founder_number")

    await db.retired_registrations.insert_one(audit)
    await db.interest_registrations.delete_one({"id": row["id"]})


def _summarise(row):
    return {
        "founder_number": row.get("founder_number"),
        "email":          row.get("email"),
        "first_name":     row.get("first_name"),
        "created_at":     row.get("created_at"),
        "status":         row.get("status"),
        "id":             row.get("id"),
    }


async def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--apply", action="store_true",
                        help="Actually retire duplicates (default is dry-run).")
    parser.add_argument("--email", type=str, default=None,
                        help="Only consider this email address (case-insensitive).")
    parser.add_argument("--retire", type=int, default=None,
                        help="Retire this specific founder number "
                             "(must be a real duplicate — the script refuses otherwise).")
    args = parser.parse_args()

    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ.get("DB_NAME", "friendplace")
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    print(f"[iter164] Scanning {db_name}.interest_registrations for duplicates...")

    groups = await _find_duplicate_groups(db, only_email=args.email)
    if not groups:
        print("[iter164] No duplicate emails found. Nothing to do.")
        return

    total_retire = 0
    for g in groups:
        print()
        print(f"  Email: {g['email']}")
        print(f"    KEEP    → {json.dumps(_summarise(g['keeper']))}")
        for d in g["duplicates"]:
            print(f"    RETIRE  → {json.dumps(_summarise(d))}")
        total_retire += len(g["duplicates"])

    if args.retire is not None:
        # Targeted mode: only retire the row with the given founder_number,
        # and only if it's genuinely a duplicate.
        target_row = None
        target_keeper = None
        for g in groups:
            for d in g["duplicates"]:
                if d.get("founder_number") == args.retire:
                    target_row = d
                    target_keeper = g["keeper"]
                    break
            if target_row:
                break
        if not target_row:
            print(f"\n[iter164] Refused: founder_number #{args.retire:04d} is not "
                  f"listed as a duplicate above (either it's the keeper for its email, "
                  f"or its email is not duplicated at all).")
            return
        if not args.apply:
            print(f"\n[iter164] Dry-run: would retire ONLY #{args.retire:04d} "
                  f"(keeper is #{target_keeper.get('founder_number'):04d}).")
            print("[iter164] Re-run with --apply to make it real.")
            return
        await _retire_row(db, target_row, target_keeper,
                          reason=f"iter164 targeted retire of duplicate #{args.retire:04d}")
        print(f"\n[iter164] ✓ Retired #{args.retire:04d}. "
              f"Keeper #{target_keeper.get('founder_number'):04d} untouched. "
              f"Audit row written to retired_registrations.")
        return

    if not args.apply:
        print(f"\n[iter164] Dry-run summary: {total_retire} row(s) would be retired "
              f"across {len(groups)} email(s).")
        print("[iter164] Re-run with --apply to make it real, or --retire <N> "
              "to retire a single founder number.")
        return

    for g in groups:
        for d in g["duplicates"]:
            await _retire_row(db, d, g["keeper"],
                              reason="iter164 bulk retire of duplicate email")
    print(f"\n[iter164] ✓ Retired {total_retire} row(s). "
          f"Audit rows written to retired_registrations.")


if __name__ == "__main__":
    asyncio.run(main())
