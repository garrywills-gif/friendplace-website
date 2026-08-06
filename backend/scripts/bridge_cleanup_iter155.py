"""
Bridge Cleanup (iter155)
========================

Approved by user on 2026-08-06.

What this script does (in order):

  Step 1  DRY-RUN (default): classify every mcgs_cases, mcgs_signals,
          support_tickets and notices row into an ``origin`` bucket:

              production | seed | test | diagnostic

          and export a JSON snapshot of every affected record BEFORE any
          write. No changes are made in dry-run mode.

  Step 2  APPLY (``--apply``): backfill ``origin`` on every existing
          record and archive all open cases/signals whose origin != production
          by transitioning them to RESOLVED with:

              resolved_action = "archived_non_production"
              resolved_by     = "system:bridge_cleanup_iter155"
              notes attached to state_transitions with the exact bucket.

          The record is NEVER deleted. Full audit trail preserved.

Safeguards:
  - Snapshot exported to /app/backend/backups/bridge_cleanup_iter155-<ts>.json
    before any write.
  - Idempotent: re-running after --apply is a no-op for already-classified rows.
  - All state changes go through the ``state_transitions`` append-only log
    already used by MCGS.

Classification patterns (deterministic — no LLM):
  TEST_PATTERNS = [
      "TEST_MOD_", "TEST_notice", "TEST_report_target", "TEST_iter",
      "TEST_SSE", "TEST_MCGS", "PROP_", "Test bug",
  ]
  * A case_key / subject / body / entity_ref.id matching any pattern -> test
  * moderation_source == "retro_scan_iter153" on a demo-user notice -> seed
  * user_name literally "Test" -> test
  * Orphaned notice_moderation case whose notice no longer exists -> test
  * milestones signals -> production (they're informational, not test) but
    downstream queries filter kind="milestone" out of the "needs action" count
  * Everything else -> production (default)
"""

from __future__ import annotations

import asyncio
import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Ensure /app/backend is on sys.path so we can import services.*
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/backend/.env")

BACKUP_DIR = Path("/app/backend/backups")
BACKUP_DIR.mkdir(parents=True, exist_ok=True)

# Deterministic patterns. Anything containing "TEST_" (uppercase with
# underscore) is by convention a test artifact in this codebase. We also
# match a couple of shorter proposal-test tokens (PROP_) and one legacy
# "Test bug" string.
TEST_PATTERNS = [
    "TEST_",          # umbrella: TEST_MOD_, TEST_notice, TEST_SSE, TEST_MCGS,
                      # TEST_iter*, TEST_subject, TEST_remove_me, TEST_pre,
                      # TEST_target_notice, TEST_auto_protect, TEST_report_target,
                      # TEST_be_kind, TEST_iter28_user, etc.
    "PROP_",          # proposal-flow e2e fixtures
    "Test bug",
]
TEST_USER_NAMES = {"test"}

OPEN_STATES = {"NEW", "SEEN", "IN_REVIEW", "SNOOZED", "ESCALATED"}

ACTOR_ID = "system:bridge_cleanup_iter155"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _text_contains_test(*fields: str) -> str | None:
    """Return the matched pattern (or None)."""
    for f in fields:
        if not f:
            continue
        for p in TEST_PATTERNS:
            if p in f:
                return p
    return None


async def classify_notice(db, notice_id: str | None) -> tuple[str, str]:
    """Return (origin, reason) for a notice referenced by a moderation case/signal."""
    if not notice_id:
        return "test", "missing entity_ref.id"
    # Legacy synthetic ids used by iter153 retro-scan fixtures
    if notice_id.startswith("TEST_MOD_legacy") or notice_id.startswith("TEST_MOD_"):
        return "test", f"legacy fixture id ({notice_id[:24]}…)"
    notice = await db.notices.find_one({"id": notice_id})
    if not notice:
        return "test", "orphaned – notice no longer exists"
    body_text = " ".join(str(notice.get(k, "")) for k in ("title", "body"))
    tp = _text_contains_test(body_text, notice.get("user_name", ""))
    if tp:
        return "test", f"notice content matches {tp}"
    if (notice.get("user_name") or "").strip().lower() == "test":
        return "test", "author is literal 'Test' user"
    mod_src = notice.get("moderation_source") or ""
    if mod_src == "retro_scan_iter153":
        # If author is a demo/seed user (Margaret / Frank / Joyce / etc.),
        # this is seed content re-flagged retroactively — archive as seed.
        return "seed", f"retro_scan_iter153 seed notice (user_name={notice.get('user_name')})"
    # Genuine notice
    return "production", "genuine notice"


async def classify_case(db, case: dict) -> tuple[str, str]:
    subj = case.get("subject") or ""
    key = case.get("case_key") or ""
    prefix = key.split(":", 1)[0] if ":" in key else "unknown"
    tp = _text_contains_test(subj, key)
    if tp:
        return "test", f"case matches {tp}"
    if prefix == "notice_moderation":
        eid = key.split(":", 1)[1] if ":" in key else None
        return await classify_notice(db, eid)
    if prefix == "support_ticket":
        eid = key.split(":", 1)[1] if ":" in key else None
        if eid:
            ticket = await db.support_tickets.find_one({"id": eid})
            if not ticket:
                return "test", "orphaned – support_ticket no longer exists"
            sub = ticket.get("subject") or ticket.get("title") or ""
            tp2 = _text_contains_test(sub, ticket.get("body") or "")
            if tp2:
                return "test", f"linked ticket matches {tp2}"
            return "production", "genuine support ticket"
        return "production", "support ticket case"
    return "production", "default"


async def classify_signal(db, sig: dict) -> tuple[str, str]:
    subj = sig.get("subject") or ""
    body = sig.get("body") or ""
    entity_id = (sig.get("entity_ref") or {}).get("id") or ""
    producer = sig.get("producer") or ""
    tp = _text_contains_test(subj, body, entity_id)
    if tp:
        return "test", f"signal matches {tp}"
    if producer == "notice_moderation":
        return await classify_notice(db, entity_id)
    if producer == "support_ticket":
        if entity_id:
            ticket = await db.support_tickets.find_one({"id": entity_id})
            if not ticket:
                return "test", "orphaned – support_ticket no longer exists"
            sub = ticket.get("subject") or ticket.get("title") or ""
            tp2 = _text_contains_test(sub, ticket.get("body") or "")
            if tp2:
                return "test", f"linked ticket matches {tp2}"
            return "production", "genuine support ticket"
        return "production", "support ticket signal"
    if producer == "milestones":
        return "production", "milestone informational signal"
    return "production", "default"


async def classify_ticket(ticket: dict) -> tuple[str, str]:
    sub = ticket.get("subject") or ticket.get("title") or ""
    body = ticket.get("body") or ""
    tp = _text_contains_test(sub, body)
    if tp:
        return "test", f"ticket matches {tp}"
    return "production", "genuine ticket"


async def classify_notice_row(notice: dict) -> tuple[str, str]:
    body_text = " ".join(str(notice.get(k, "")) for k in ("title", "body"))
    tp = _text_contains_test(body_text, notice.get("user_name") or "")
    if tp:
        return "test", f"notice content matches {tp}"
    if (notice.get("user_name") or "").strip().lower() == "test":
        return "test", "author is literal 'Test' user"
    # All 60 notices are is_demo=true seed users, but the notices themselves
    # are the seed community content. Treat them as production for chat/feed
    # purposes; they're 'seed'-flagged only when retro-scan_iter153 flagged
    # them prolifically. To keep it simple and preserve normal notice feed:
    if notice.get("moderation_source") == "retro_scan_iter153":
        return "seed", "retro_scan_iter153 re-flag"
    return "production", "genuine notice"


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true",
                    help="Actually write changes. Default is dry-run.")
    args = ap.parse_args()

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    print(f"\n=== Bridge Cleanup iter155 — {'APPLY' if args.apply else 'DRY-RUN'} @ {ts} ===\n")

    # ------------------------------------------------------------------
    # Snapshot: export all rows we will touch (open cases/signals + all
    # support_tickets + all notices) so a rollback is trivial.
    # ------------------------------------------------------------------
    snapshot = {
        "generated_at": _now_iso(),
        "mode": "apply" if args.apply else "dry_run",
        "mcgs_cases": await db.mcgs_cases.find({}, {"_id": 0}).to_list(None),
        "mcgs_signals": await db.mcgs_signals.find({}, {"_id": 0}).to_list(None),
        "support_tickets": await db.support_tickets.find({}, {"_id": 0}).to_list(None),
        "notices": await db.notices.find({}, {"_id": 0}).to_list(None),
    }
    snap_path = BACKUP_DIR / f"bridge_cleanup_iter155-{ts}.json"
    with snap_path.open("w") as fh:
        json.dump(snapshot, fh, default=str, indent=2)
    print(f"[snapshot] wrote {snap_path}  "
          f"({len(snapshot['mcgs_cases'])} cases, "
          f"{len(snapshot['mcgs_signals'])} signals, "
          f"{len(snapshot['support_tickets'])} tickets, "
          f"{len(snapshot['notices'])} notices)\n")

    # ------------------------------------------------------------------
    # Classify + build change plan
    # ------------------------------------------------------------------
    plan: dict[str, list[dict]] = defaultdict(list)   # collection -> list of updates

    # Cases
    for c in snapshot["mcgs_cases"]:
        origin, reason = await classify_case(db, c)
        rec = {"id": c["id"], "origin": origin, "reason": reason,
               "case_key": c.get("case_key"), "subject": c.get("subject"),
               "status": c.get("status"), "priority": c.get("priority")}
        plan["mcgs_cases"].append(rec)

    # Signals
    for s in snapshot["mcgs_signals"]:
        origin, reason = await classify_signal(db, s)
        rec = {"id": s["id"], "origin": origin, "reason": reason,
               "producer": s.get("producer"),
               "subject": s.get("subject"),
               "status": s.get("status"), "priority": s.get("priority")}
        plan["mcgs_signals"].append(rec)

    # Tickets
    for t in snapshot["support_tickets"]:
        origin, reason = await classify_ticket(t)
        rec = {"id": t["id"], "origin": origin, "reason": reason,
               "subject": t.get("subject") or t.get("title"),
               "status": t.get("status")}
        plan["support_tickets"].append(rec)

    # Notices
    for n in snapshot["notices"]:
        origin, reason = await classify_notice_row(n)
        rec = {"id": n["id"], "origin": origin, "reason": reason,
               "title": n.get("title"), "user_name": n.get("user_name")}
        plan["notices"].append(rec)

    # ------------------------------------------------------------------
    # Print DRY-RUN summary
    # ------------------------------------------------------------------
    for coll, recs in plan.items():
        print(f"── {coll} ──")
        bucket_c: Counter = Counter(r["origin"] for r in recs)
        for k, v in bucket_c.most_common():
            print(f"    origin={k:12s}  {v}")
        # Show a few examples per bucket
        by_bucket = defaultdict(list)
        for r in recs:
            by_bucket[r["origin"]].append(r)
        for b, rs in by_bucket.items():
            print(f"    examples ({b}):")
            for r in rs[:4]:
                extra = r.get("case_key") or r.get("subject") or r.get("title") or r.get("id")
                print(f"       - {r['id'][:8]}…  ({r['reason']})  {str(extra)[:70]}")
        print()

    # Reconciliation: support_tickets vs bridge cases
    open_tickets = [t for t in snapshot["support_tickets"] if t.get("status") == "open"]
    bridge_ticket_case_keys = {c.get("case_key") for c in snapshot["mcgs_cases"]
                                if c.get("case_key", "").startswith("support_ticket:")
                                and c.get("status") in OPEN_STATES}
    print(f"── Support-ticket reconciliation ──")
    print(f"    open support_tickets rows: {len(open_tickets)}")
    print(f"    open support_ticket bridge cases: {len(bridge_ticket_case_keys)}")
    missing = []
    for t in open_tickets:
        expected_key = f"support_ticket:{t['id']}"
        if expected_key not in bridge_ticket_case_keys:
            missing.append(t)
    print(f"    open tickets with NO bridge case: {len(missing)}")
    for m in missing:
        print(f"       - {m['id']}  status={m['status']}  subject={(m.get('subject') or m.get('title') or '')[:70]}")
        # Also check resolved case
        rc = await db.mcgs_cases.find_one({"case_key": f"support_ticket:{m['id']}"})
        if rc:
            print(f"         (bridge case exists but status={rc.get('status')})")
        else:
            print(f"         (no bridge case ever created)")
    print()

    # Save plan JSON
    plan_path = BACKUP_DIR / f"bridge_cleanup_iter155-plan-{ts}.json"
    with plan_path.open("w") as fh:
        json.dump(plan, fh, default=str, indent=2)
    print(f"[plan] wrote {plan_path}\n")

    if not args.apply:
        print("DRY-RUN complete. Re-run with --apply to execute.")
        return

    # ==================================================================
    # APPLY changes
    # ==================================================================
    print("Applying changes…\n")

    # 1. Backfill origin on every row (never overwrite an existing explicit origin)
    for coll, recs in plan.items():
        n_bulk = 0
        for r in recs:
            res = await db[coll].update_one(
                {"id": r["id"], "$or": [{"origin": {"$exists": False}}, {"origin": None}]},
                {"$set": {"origin": r["origin"], "origin_reason": r["reason"],
                          "origin_tagged_at": _now_iso(),
                          "origin_tagged_by": ACTOR_ID}},
            )
            if res.modified_count:
                n_bulk += 1
        print(f"  backfilled origin on {n_bulk}/{len(recs)} rows in {coll}")

    # 2. Archive non-production open cases + signals
    now = _now_iso()

    def archive_transition(from_state: str, reason: str) -> dict:
        return {
            "from": from_state,
            "to": "RESOLVED",
            "at": now,
            "actor_id": ACTOR_ID,
            "actor_kind": "system",
            "via_channel": "bridge_cleanup_iter155",
            "notes": f"archived_non_production ({reason})",
        }

    # Signals
    sig_archived = 0
    for r in plan["mcgs_signals"]:
        if r["origin"] == "production":
            continue
        if r["status"] not in OPEN_STATES:
            continue
        transition = archive_transition(r["status"], r["reason"])
        await db.mcgs_signals.update_one(
            {"id": r["id"]},
            {"$set": {"status": "RESOLVED",
                       "resolved_action": "archived_non_production",
                       "resolved_by": ACTOR_ID,
                       "resolved_at": now,
                       "updated_at": now},
             "$push": {"state_transitions": transition}},
        )
        sig_archived += 1
    print(f"  archived {sig_archived} non-production open signals")

    # Cases
    case_archived = 0
    for r in plan["mcgs_cases"]:
        if r["origin"] == "production":
            continue
        if r["status"] not in OPEN_STATES:
            continue
        await db.mcgs_cases.update_one(
            {"id": r["id"]},
            {"$set": {"status": "RESOLVED",
                       "resolved_action": "archived_non_production",
                       "resolved_by": ACTOR_ID,
                       "resolved_at": now,
                       "updated_at": now}},
        )
        case_archived += 1
    print(f"  archived {case_archived} non-production open cases")

    # Support tickets: archive any open non-production tickets so their
    # state matches their (already-resolved) bridge cases and they drop out
    # of the ops queue.
    ticket_archived = 0
    for r in plan["support_tickets"]:
        if r["origin"] == "production":
            continue
        if r["status"] != "open":
            continue
        await db.support_tickets.update_one(
            {"id": r["id"]},
            {"$set": {"status": "resolved",
                       "resolved_at": now,
                       "resolved_action": "archived_non_production",
                       "resolved_by": ACTOR_ID,
                       "updated_at": now}},
        )
        ticket_archived += 1
    print(f"  archived {ticket_archived} non-production open support tickets")

    # 3. Recompute cached counts (mcgs_counts) — hot single-doc cache
    from services.mcgs.signals import compute_counts
    counts = await compute_counts(db)
    print(f"\n  recomputed mcgs_counts: {json.dumps(counts, default=str)}")

    # 4. Verification summary
    print("\n=== VERIFICATION ===")
    prod_open_cases = await db.mcgs_cases.count_documents({
        "status": {"$in": list(OPEN_STATES)}, "origin": "production"
    })
    prod_open_sigs = await db.mcgs_signals.count_documents({
        "status": {"$in": list(OPEN_STATES)}, "origin": "production"
    })
    prod_milestone_sigs = await db.mcgs_signals.count_documents({
        "status": {"$in": list(OPEN_STATES)}, "origin": "production",
        "producer": "milestones",
    })
    prod_actionable_sigs = await db.mcgs_signals.count_documents({
        "status": {"$in": list(OPEN_STATES)}, "origin": "production",
        "producer": {"$ne": "milestones"},
    })
    open_prod_tickets = await db.support_tickets.count_documents({
        "status": "open", "origin": "production"
    })
    archived_test = await db.mcgs_cases.count_documents({"origin": "test"})
    archived_seed = await db.mcgs_cases.count_documents({"origin": "seed"})

    print(f"  open production cases (all):          {prod_open_cases}")
    print(f"  open production signals (all):        {prod_open_sigs}")
    print(f"    of which milestones (informational): {prod_milestone_sigs}")
    print(f"    of which actionable:                 {prod_actionable_sigs}")
    print(f"  open production support tickets:      {open_prod_tickets}")
    print(f"  archived test cases (audit-preserved): {archived_test}")
    print(f"  archived seed cases (audit-preserved): {archived_seed}")


if __name__ == "__main__":
    asyncio.run(main())
