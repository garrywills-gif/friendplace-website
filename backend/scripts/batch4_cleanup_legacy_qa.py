"""Batch-4 QA cleanup — one-off maintenance script.

Context (from Garry's Batch-3 QA report):
    "I closed all 23 support tickets yesterday. I also resolved the two
     outstanding signals yesterday. George still reports 23 open support
     tickets and two outstanding signals."

Investigation showed the underlying DB genuinely had 23 tickets in
`status: 'open'` and 2 signals in `status: 'NEW'`. Whatever "close"
control Garry used on mobile did not update `status`, so the tickets
never actually resolved. All 23 tickets on inspection were leftover QA
seed data (a mix of automated test tickets and Garry's own manual QA
tickets). The 2 NEW signals had empty `reason`/`kind` fields — also
clearly test artefacts.

This script performs the cleanup Garry originally intended:
    * Every currently-`open` ticket → `status: 'resolved'`, admin_note
      pinned so anyone browsing the audit later knows exactly what
      happened and why.
    * Every currently-`NEW` signal → `status: 'RESOLVED'` with the same
      audit note.

Run once from the pod:
    python /app/backend/scripts/batch4_cleanup_legacy_qa.py
"""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

AUDIT_NOTE = (
    "Bulk-resolved during Batch 4 QA cleanup on {now}. Legacy QA data — "
    "no external member impact. See Neo (Batch 4) for context."
)


async def main() -> None:
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    now_iso = datetime.now(timezone.utc).isoformat()
    note = AUDIT_NOTE.format(now=now_iso)

    # ── Tickets ────────────────────────────────────────────────────────
    open_before = await db.support_tickets.count_documents({"status": "open"})
    tickets_res = await db.support_tickets.update_many(
        {"status": "open"},
        {
            "$set": {
                "status": "resolved",
                "resolved_at": now_iso,
                "updated_at": now_iso,
                "admin_note": note,
                "resolution_source": "batch4_cleanup",
            }
        },
    )
    open_after = await db.support_tickets.count_documents({"status": "open"})
    print(
        f"support_tickets: {open_before} open → {open_after} open  "
        f"(matched={tickets_res.matched_count}, modified={tickets_res.modified_count})"
    )

    # ── Signals ────────────────────────────────────────────────────────
    new_before = await db.mcgs_signals.count_documents({"status": "NEW"})
    signals_res = await db.mcgs_signals.update_many(
        {"status": "NEW"},
        {
            "$set": {
                "status": "RESOLVED",
                "resolved_at": now_iso,
                "updated_at": now_iso,
                "admin_note": note,
                "resolution_source": "batch4_cleanup",
            }
        },
    )
    new_after = await db.mcgs_signals.count_documents({"status": "NEW"})
    print(
        f"mcgs_signals   : {new_before} NEW → {new_after} NEW  "
        f"(matched={signals_res.matched_count}, modified={signals_res.modified_count})"
    )

    print("done.")


if __name__ == "__main__":
    asyncio.run(main())
