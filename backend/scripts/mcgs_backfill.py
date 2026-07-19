#!/usr/bin/env python3
"""One-shot backfill: convert existing pending event submissions and
open support tickets into MCGS Signals + Cases.

Idempotent — safe to re-run. The MCGS Signal service's own dedup logic
(open Case + open Signal on the same producer/entity) means re-running
this script never creates duplicates.

Usage (from anywhere; loads /app/backend/.env for MONGO_URL):

    python /app/backend/scripts/mcgs_backfill.py
    python /app/backend/scripts/mcgs_backfill.py --dry-run
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

# Make `backend` importable when run standalone.
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv
load_dotenv(BACKEND_DIR / ".env")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from services.mcgs import create_signal  # noqa: E402
from services.mcgs.signals import ensure_indexes as mcgs_ensure_indexes  # noqa: E402


async def backfill(dry_run: bool = False) -> None:
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME", "test_database")
    if not mongo_url:
        print("MONGO_URL missing in env; aborting.")
        return

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    if not dry_run:
        await mcgs_ensure_indexes(db)
        print("indexes ensured.")

    # ---- 1. Pending event submissions ----
    submissions = await db.cms_event_submissions.find(
        {"status": "pending"}, {"_id": 0},
    ).to_list(1000)
    print(f"found {len(submissions)} pending event submission(s)")

    made_ev = 0
    for sub in submissions:
        sub_id = sub.get("id")
        if not sub_id:
            continue
        if dry_run:
            print(f"  would create signal for submission {sub_id} — {sub.get('event_title', '')[:60]}")
            continue
        try:
            await create_signal(
                db,
                producer="event_submission",
                entity_ref={"kind": "event_submission", "id": sub_id},
                subject=f"Event awaiting review: {sub.get('event_title', '(untitled)')}"[:120],
                body=(
                    f"Submitted by {sub.get('organisation_name') or sub.get('contact_name') or '(unknown)'}\n\n"
                    f"{sub.get('description') or ''}"
                )[:4000],
                category="attention",
                priority="P2",
                case_key=f"event_submission:{sub_id}",
                source="user_report",
                injection_check_fields=[sub.get("event_title"), sub.get("description")],
            )
            made_ev += 1
        except Exception as exc:
            print(f"  ! submission {sub_id} failed: {exc}")

    # ---- 2. Open support tickets ----
    tickets = await db.support_tickets.find(
        {"status": "open"}, {"_id": 0},
    ).to_list(1000)
    print(f"found {len(tickets)} open support ticket(s)")

    made_tk = 0
    for t in tickets:
        t_id = t.get("id")
        if not t_id:
            continue
        if dry_run:
            print(f"  would create signal for ticket {t_id} — {t.get('subject', '')[:60]}")
            continue
        try:
            await create_signal(
                db,
                producer="support_ticket",
                entity_ref={"kind": "support_ticket", "id": t_id},
                subject=f"Support ticket: {t.get('subject', '(no subject)')}"[:120],
                body=(t.get("message") or "")[:4000],
                category="attention",
                priority="P2",
                case_key=f"support_ticket:{t_id}",
                source="user_report",
                injection_check_fields=[t.get("subject"), t.get("message")],
            )
            made_tk += 1
        except Exception as exc:
            print(f"  ! ticket {t_id} failed: {exc}")

    print("---")
    if dry_run:
        print(f"[dry-run] would create {len(submissions)} event signals, {len(tickets)} ticket signals")
    else:
        print(f"created/updated {made_ev} event signals, {made_tk} ticket signals")

    client.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="MCGS backfill: submissions + tickets -> Signals")
    parser.add_argument("--dry-run", action="store_true", help="Show what would happen; don't write.")
    args = parser.parse_args()
    asyncio.run(backfill(dry_run=args.dry_run))


if __name__ == "__main__":
    main()
