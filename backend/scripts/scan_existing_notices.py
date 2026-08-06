"""Retroactive scan of existing Notice Board posts.

Runs the shared moderation heuristic
(`services.moderation.business_content.moderation_verdict`) against every
existing notice that has NOT already been flagged, and:

    1. Marks flagged notices with `pending_review=True` and the same
       `moderation_reasons` / `moderation_score` fields the live POST
       handler writes.
    2. **Does NOT hide or remove already-published notices.** We only
       flag them for administrator review — Garry's explicit call
       (iter153): "clean up genuine business advertising without
       accidentally taking down legitimate community notices."
    3. Files an MCGS Signal so the notice lands in the shared
       moderation queue.

Idempotent — re-running skips notices that are already flagged.

Usage::

    python -m scripts.scan_existing_notices          # dry-run summary
    python -m scripts.scan_existing_notices --apply  # actually write

Locked with Garry (iter153, June 2026).
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Ensure the backend directory is on sys.path so `services.*` and
# `server.py` helpers resolve when run as a script.
_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(_BACKEND_DIR / ".env")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def main(apply: bool = False, limit: int = 0) -> None:
    from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
    from services.moderation import moderation_verdict  # noqa: E402

    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME") or "friendplace"
    if not mongo_url:
        print("MONGO_URL missing from environment", file=sys.stderr)
        sys.exit(1)

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    # Only consider notices we haven't already flagged. `pending_review`
    # true → already handled by the live path or a prior scan. Keeps
    # the script idempotent.
    query = {
        "$and": [
            {"$or": [
                {"pending_review": {"$exists": False}},
                {"pending_review": False},
            ]},
            {"$or": [
                {"removed": {"$exists": False}},
                {"removed": False},
            ]},
        ]
    }

    cur = db.notices.find(query, {"_id": 0})
    scanned = 0
    flagged = 0
    updates: list[dict] = []

    async for n in cur:
        scanned += 1
        if limit and scanned > limit:
            break
        verdict = await moderation_verdict(
            db,
            title=n.get("title") or "",
            body=n.get("body") or "",
            location="",
            user_id=n.get("user_id"),
            kind="notice",
        )
        if not verdict.get("should_hold"):
            continue
        flagged += 1
        updates.append({
            "id": n.get("id"),
            "user_id": n.get("user_id"),
            "title": (n.get("title") or "")[:80],
            "reasons": verdict.get("reasons") or [],
            "score": verdict.get("score"),
            "prolific": verdict.get("prolific_flag"),
            "prior_count": verdict.get("prior_count"),
        })

    print(f"Scanned {scanned} notices — {flagged} would be flagged.")
    for u in updates[:20]:
        print(f"  • {u['id'][:8]}  score={u['score']}  reasons={u['reasons']}")
    if len(updates) > 20:
        print(f"  … and {len(updates) - 20} more")

    if not apply:
        print("\nDry run — pass --apply to write changes.")
        return

    # Apply updates.
    print(f"\nApplying moderation flags to {len(updates)} notice(s)…")
    for u in updates:
        # Mark for review, DO NOT hide/remove. Retro-scan intent
        # (iter153): flag existing suspects for admin review only.
        await db.notices.update_one(
            {"id": u["id"]},
            {"$set": {
                "pending_review":         True,
                "moderation_reasons":     list(u["reasons"]),
                "moderation_score":       int(u["score"] or 0),
                "moderation_prolific":    bool(u["prolific"]),
                "moderation_prior_count": int(u["prior_count"] or 0),
                "moderation_flagged_at":  _now_iso(),
                "moderation_source":      "retro_scan_iter153",
            }},
        )
        # File an MCGS Signal for admin review. Best-effort — a signal
        # failure must not block the flag write.
        try:
            from services.mcgs import create_signal as _mcgs_create_signal
            from services.george import triage_signal_with_haiku as _mcgs_triage
            await _mcgs_create_signal(
                db,
                producer="notice_moderation",
                entity_ref={"kind": "notice", "id": u["id"]},
                subject=f"Existing notice flagged for review: {u['title']}"[:120],
                body=(
                    f"Retroactive scan (iter153) flagged this notice.\n"
                    f"Reasons: {', '.join(u['reasons']) or '(none)'}\n"
                    f"Score: {u['score']}  "
                    f"Prolific: {u['prolific']}  "
                    f"Prior count: {u['prior_count']}\n"
                )[:4000],
                category="attention",
                priority="P2",
                case_key=f"notice_moderation:{u['id']}",
                source="system",
                triage_fn=_mcgs_triage,
            )
        except Exception as e:  # noqa: BLE001
            print(f"  ! MCGS signal failed for {u['id']}: {e}", file=sys.stderr)

    print("Done.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true",
                        help="Actually write the moderation flags (default: dry run).")
    parser.add_argument("--limit", type=int, default=0,
                        help="Cap the number of notices scanned (0 = no cap).")
    args = parser.parse_args()
    asyncio.run(main(apply=args.apply, limit=args.limit))
