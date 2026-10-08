"""
Read-only diagnostic for Founding Member registrations missing a
`founder_number`.

Context (Neo, Feb 2026 — Vik's missing FMN investigation):
  The register-interest flow is two-phase. Phase 1 saves the row with
  `status: pending_confirmation` and NO number. Phase 2 (confirm, the
  "That's my hello" tap) is the ONLY place a number is drawn. If a
  visitor abandons between phase 1 and phase 2, the row stays
  numberless. The CRM timeline event #1 is built from the row's
  `created_at` so it ALWAYS reads "Registered as Founding Member" —
  which is misleading. This script buckets the actual data so an admin
  can confirm the state before touching anything.

Buckets:
  • phase1_abandoned — status=pending_confirmation, no `founder_number`,
    no `ack_sent_at`. The visitor almost certainly never pressed
    "That's my hello".
  • lost_mid_flow   — status in {registered, invited, joined, opted_out}
    but `founder_number` is empty. If this bucket is non-empty, there's
    a real bug (status flipped without the number landing). Needs
    manual investigation per row.
  • reserved_slot   — `is_reserved=True`. These are placeholders (Garry
    #0001, George #0002) and may or may not carry a number depending
    on when the slot was seeded. Listed for completeness; usually
    nothing to do here.
  • other           — anything else that doesn't match the above
    (status=new, status missing, etc.). Reported so no row is lost.

This script WRITES NOTHING. Run against production safely.

Usage:
    cd /app/backend && python3 scripts/audit_founder_numbers.py
    cd /app/backend && python3 scripts/audit_founder_numbers.py --email melozvik@gmail.com
    cd /app/backend && python3 scripts/audit_founder_numbers.py --json
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()


def _bucket(row: dict) -> str:
    fn = row.get("founder_number")
    has_num = isinstance(fn, int) and fn > 0
    if has_num:
        return "has_number"
    if row.get("is_reserved"):
        return "reserved_slot"
    status = (row.get("status") or "").lower()
    if status == "pending_confirmation":
        return "phase1_abandoned"
    if status in {"registered", "invited", "joined", "opted_out"}:
        return "lost_mid_flow"
    return "other"


def _summarise(row: dict) -> dict:
    return {
        "id":              row.get("id"),
        "email":           row.get("email"),
        "first_name":      row.get("first_name"),
        "status":          row.get("status"),
        "founder_number":  row.get("founder_number"),
        "ack_sent_at":     row.get("ack_sent_at"),
        "confirmed_at":    row.get("confirmed_at"),
        "created_at":      row.get("created_at"),
        "updated_at":      row.get("updated_at"),
        "linked_user_id":  row.get("linked_user_id"),
        "is_reserved":     bool(row.get("is_reserved")),
        "merged_into":     row.get("merged_into"),
        "source":          row.get("source"),
        "state_country":   row.get("state_country"),
    }


async def main(email_filter: str | None, as_json: bool) -> int:
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "test_database")]

    query: dict[str, Any] = {
        "$or": [
            {"founder_number": {"$exists": False}},
            {"founder_number": None},
            {"founder_number": 0},
        ],
        # Audit-only — don't surface merged duplicates, they're known.
        "merged_into": None,
    }
    if email_filter:
        query["email"] = {"$regex": f"^{email_filter.strip().lower()}$", "$options": "i"}

    rows = await db.interest_registrations.find(query, {"_id": 0}).sort("created_at", -1).to_list(10000)

    buckets: dict[str, list[dict]] = {
        "phase1_abandoned": [],
        "lost_mid_flow":    [],
        "reserved_slot":    [],
        "other":            [],
    }
    for r in rows:
        b = _bucket(r)
        if b == "has_number":
            continue
        buckets[b].append(_summarise(r))

    totals_total = await db.interest_registrations.count_documents({"merged_into": None})
    with_num = totals_total - sum(len(v) for v in buckets.values())

    report = {
        "query_email_filter": email_filter,
        "totals": {
            "interest_registrations_live": totals_total,
            "with_founder_number":         with_num,
            "missing_founder_number":      sum(len(v) for v in buckets.values()),
            "phase1_abandoned":            len(buckets["phase1_abandoned"]),
            "lost_mid_flow":               len(buckets["lost_mid_flow"]),
            "reserved_slot":               len(buckets["reserved_slot"]),
            "other":                       len(buckets["other"]),
        },
        "rows_by_bucket": buckets,
    }

    if as_json:
        print(json.dumps(report, indent=2, default=str))
        return 0

    print("Founding Member number audit (read-only)")
    print("=========================================")
    for k, v in report["totals"].items():
        print(f"  {k:30s} = {v}")
    for name, display in [
        ("phase1_abandoned", "Phase 1 abandoned (needs resume link / allocate)"),
        ("lost_mid_flow",    "⚠ Lost mid-flow (status registered+ but no number — BUG)"),
        ("reserved_slot",    "Reserved slot (Garry/George style placeholder)"),
        ("other",            "Other (unclassified — investigate)"),
    ]:
        rows = buckets[name]
        if not rows:
            continue
        print(f"\n--- {display}  ({len(rows)}) ---")
        for r in rows:
            print(
                f"  {r['email'] or '(no email)':40s} "
                f"first_name={r['first_name']!r:16s} "
                f"status={r['status']!r:22s} "
                f"ack_sent_at={r['ack_sent_at'] or '-'} "
                f"created_at={r['created_at'] or '-'} "
                f"id={r['id']}"
            )
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Audit interest_registrations for missing founder_number.")
    parser.add_argument("--email", help="Filter to a single email (case-insensitive).")
    parser.add_argument("--json", action="store_true", help="Emit the full report as JSON.")
    args = parser.parse_args()
    sys.exit(asyncio.run(main(email_filter=args.email, as_json=args.json)))
