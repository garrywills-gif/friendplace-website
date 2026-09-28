#!/usr/bin/env python3
"""One-time PRODUCTION repair — backfill Founding Member numbers (+ ack email)
for the real interest_registrations that never received a number because the
production website was serving the old single-phase flow (it saved via Phase-1
`/public/register-interest`, which no longer allocates a number, and never
called the Phase-2 confirm endpoint that draws + locks the number).

WHAT IT DOES (guarded, idempotent, DRY-RUN by default):
  1. Finds every REAL registration with a missing/null founder_number,
     excluding test (is_test) and reserved-seed (is_reserved) rows.
  2. Sorts them created_at OLDEST-FIRST.
  3. Assigns each a number using the SAME production allocator the new
     confirmation flow uses — server._assign_founder_number_to_registration()
     → server._next_founder_number() (reserved/gap slots lowest-first, then the
     monotonic counter). This is atomic + non-burning.
  4. For each newly-numbered person, checks whether the Founding Member
     acknowledgement email was already sent (ack_sent_at / ack_message_id, and
     a defensive scan of email_test_log). If NOT, sends the normal ack email
     ONCE using their newly-assigned number (identical template + sender to the
     confirm endpoint). If it WAS, it is not resent.
  5. Never renumbers anyone who already has a number.
  6. Prints the mapping:  Name → founder number → email already sent / sent now
  7. Verifies zero real registrations remain with a missing founder_number.

IDEMPOTENCY / RE-RUN SAFETY:
  • Number: the allocator's attach is a conditional update on
    {founder_number: None}; a row that already has a number returns it and
    draws nothing new. A per-row `backfill_repaired_at` marker is also set for
    audit. Re-running therefore cannot give the same person a second number.
  • Email: guarded on ack_sent_at / ack_message_id (and email_test_log). A
    re-run will report "email already sent" and send nothing.

USAGE — run INSIDE the target (production) environment so server.db points at
the production database:
    python scripts/repair_founder_backfill_20260927.py            # DRY-RUN report
    python scripts/repair_founder_backfill_20260927.py --apply    # perform repair
    python scripts/repair_founder_backfill_20260927.py --apply --no-email
"""
from __future__ import annotations

import sys
import asyncio
import argparse
from datetime import datetime, timezone

sys.path.insert(0, "/app/backend")

import server  # noqa: E402


REPAIR_TAG = "backfill_repair_20260927"

# ── Confirmed production expectation (from the customer) ─────────────────────
# The ONLY available reserved slots in production are these, and there are
# exactly 7 numberless real registrations. Because the allocator always draws
# reserved slots LOWEST-FIRST and we process registrations OLDEST-FIRST, the
# oldest registration receives 108, the next 109, … the newest 121:
#     Mandy → 108, Abdul → 109, Hannen abdallah → 110, Yvonne → 118,
#     Ruby → 119, Belinda → 120, Monique → 121
# These are used purely as a SAFETY PRE-FLIGHT: if production does not match
# this shape exactly, the script refuses to --apply (unless --force) so it can
# never assign an unexpected number.
EXPECTED_SLOTS = [108, 109, 110, 118, 119, 120, 121]
EXPECTED_COUNT = 7
EXPECTED_NAME_ORDER = ["mandy", "abdul", "hannen", "yvonne", "ruby", "belinda", "monique"]


async def _available_reserved_slots(db) -> list[int]:
    docs = await db[server._FOUNDER_RESERVED_SLOTS_COLL].find(
        {"status": "available"}, {"_id": 0, "number": 1}
    ).to_list(10000)
    return sorted(int(d["number"]) for d in docs if d.get("number") is not None)


async def _preflight(db, rows) -> tuple[bool, list[str]]:
    """Confirm production matches the confirmed shape so the allocator will
    produce EXACTLY the expected mapping. Returns (ok, notes)."""
    notes: list[str] = []
    ok = True
    avail = await _available_reserved_slots(db)
    if len(rows) != EXPECTED_COUNT:
        ok = False
        notes.append(f"expected {EXPECTED_COUNT} numberless real rows, found {len(rows)}")
    if avail != EXPECTED_SLOTS:
        ok = False
        notes.append(f"expected available reserved slots {EXPECTED_SLOTS}, found {avail}")
    # Names are advisory (order is the real guarantee) — warn, don't fail.
    for i, r in enumerate(rows[:len(EXPECTED_NAME_ORDER)]):
        want = EXPECTED_NAME_ORDER[i]
        got = _display_name(r).lower()
        if want not in got:
            notes.append(f"NOTE: position {i} expected ~'{want}', got '{_display_name(r)}' (order still drives assignment)")
    return ok, notes


def _created_key(r: dict):
    """Oldest-first sort key that tolerates missing/oddly-typed created_at."""
    v = r.get("created_at")
    return (v is None, str(v or ""))


def _display_name(r: dict) -> str:
    fn = (r.get("first_name") or "").strip()
    ln = (r.get("last_name") or "").strip()
    full = (fn + (" " + ln if ln else "")).strip()
    return full or (r.get("email") or "(unknown)")


async def _ack_already_sent(db, r: dict) -> bool:
    """True if the Founding Member acknowledgement email has demonstrably
    already gone out for this registration."""
    if r.get("ack_sent_at") or r.get("ack_message_id"):
        return True
    # Defensive: some historical rows may have logged the ack without the
    # inline flags. Treat an 'ack' email_test_log row for this founder as sent.
    try:
        hit = await db.email_test_log.find_one(
            {"founder_id": r.get("id"), "mode": "ack"}, {"_id": 1}
        )
        if hit:
            return True
    except Exception:
        pass
    return False


async def _send_ack_email(db, reg_id: str, first_name: str, email: str,
                          companion, founder_number: int) -> tuple[bool, str]:
    """Send the SAME warm Founding Member acknowledgement the confirm endpoint
    sends. Returns (sent_ok, detail). Never raises."""
    effective_companion = companion or "george"
    try:
        from email_service import send_email_detailed, waitlist_template
        subject, html_body, text_body = waitlist_template(
            first_name=first_name or "Friend",
            founder_number=founder_number,
            companion=effective_companion,
        )
        ack_result = await send_email_detailed(
            to=email, subject=subject, html=html_body, text=text_body
        )
        ok = bool(getattr(ack_result, "ok", False) and getattr(ack_result, "message_id", None))
        if ok:
            now = server.now_iso()
            try:
                await db.email_test_log.insert_one({
                    "message_id": ack_result.message_id, "template": "waitlist",
                    "companion": effective_companion, "recipient": email,
                    "subject": subject, "created_at": now,
                    "mode": "ack", "founder_id": reg_id, "source": REPAIR_TAG,
                })
            except Exception:
                pass
            try:
                await db.interest_registrations.update_one(
                    {"id": reg_id},
                    {"$set": {"ack_sent_at": now, "ack_message_id": ack_result.message_id}},
                )
            except Exception:
                pass
            return True, ack_result.message_id
        return False, str(getattr(ack_result, "error", "send failed"))
    except Exception as e:  # noqa: BLE001
        return False, f"exception: {e}"


# ── Approved explicit mapping (name token → founder number), oldest-first ────
# This is the SINGLE SOURCE OF TRUTH the deployed backfill endpoint uses. It is
# name-anchored (not merely ordering-based) so each of the seven people can only
# ever receive their approved number.
APPROVED_MAPPING = [
    ("mandy", 108),
    ("abdul", 109),
    ("hannen", 110),   # matches "Hannen abdallah"
    ("yvonne", 118),
    ("ruby", 119),
    ("belinda", 120),
    ("monique", 121),
]


async def _consume_specific_slot(db, number: int) -> int:
    """Atomically mark reserved slot `number` consumed. Returns matched_count
    (1 = we consumed an available slot now, 0 = it was not available)."""
    res = await db[server._FOUNDER_RESERVED_SLOTS_COLL].update_one(
        {"number": number, "status": "available"},
        {"$set": {"status": "consumed", "consumed_at": server.now_iso(),
                  "consumed_by": REPAIR_TAG}},
    )
    return res.matched_count


async def _numberless_real_rows(db) -> list[dict]:
    rows = await db.interest_registrations.find({
        "$or": [{"founder_number": None}, {"founder_number": {"$exists": False}}],
        "is_test": {"$ne": True},
        "is_reserved": {"$ne": True},
    }, {"_id": 0}).to_list(10000)
    rows.sort(key=_created_key)
    return rows


async def _verify_after(db) -> dict:
    remaining = await db.interest_registrations.count_documents({
        "$or": [{"founder_number": None}, {"founder_number": {"$exists": False}}],
        "is_test": {"$ne": True}, "is_reserved": {"$ne": True},
    })
    still_avail = await _available_reserved_slots(db)
    target_slots = [n for _, n in APPROVED_MAPPING]
    slots_consumed = [n for n in target_slots if n not in still_avail]
    slots_ok = all(n not in still_avail for n in target_slots)
    dupes = await db.interest_registrations.aggregate([
        {"$match": {"is_test": {"$ne": True}, "founder_number": {"$type": "number"}}},
        {"$group": {"_id": "$founder_number", "n": {"$sum": 1}}},
        {"$match": {"n": {"$gt": 1}}},
    ]).to_list(1000)
    top = await db.interest_registrations.find_one(
        {"is_test": {"$ne": True}, "founder_number": {"$type": "number"}},
        {"_id": 0, "founder_number": 1}, sort=[("founder_number", -1)],
    )
    max_num = int((top or {}).get("founder_number") or 0)
    counter = await db.counters.find_one({"id": server._FOUNDER_NUMBER_COUNTER_ID}, {"_id": 0, "value": 1})
    counter_val = int((counter or {}).get("value") or 0)
    next_new = (still_avail[0] if still_avail else counter_val + 1)
    return {
        "numberless_remaining": remaining,
        "numberless_remaining_ok": remaining == 0,
        "reserved_slots_consumed": slots_consumed,
        "reserved_slots_still_available": still_avail,
        "reserved_slots_consumed_ok": slots_ok,
        "duplicate_founder_numbers": [{"number": d["_id"], "count": d["n"]} for d in dupes],
        "duplicate_founder_numbers_ok": not dupes,
        "highest_founder_number": max_num,
        "counter": counter_val,
        "next_new_allocation": next_new,
        "next_new_allocation_display": server._fmt_founder_no(next_new),
        "next_is_128": next_new == 128,
    }


async def run_exact_backfill(db, apply: bool, send_email: bool = True) -> dict:
    """Guarded, idempotent, name-anchored backfill for exactly the seven
    approved registrations. Used by the deployed admin endpoint AND the CLI.

    Validation is ALL-OR-NOTHING: if any target is missing/ambiguous, already
    owns a different number, or its slot/number is already taken by someone
    else, NOTHING is changed and the errors are returned. If every target
    already owns its approved number (a second run), it changes nothing and
    reports each as 'already done'.
    """
    rows = await _numberless_real_rows(db)
    # Index every registration by number-ownership for conflict checks.
    def _match_one(token: str) -> list[dict]:
        return [r for r in rows if token in _display_name(r).lower()]

    plan: list[dict] = []      # {token, number, reg, action}
    errors: list[str] = []

    for token, number in APPROVED_MAPPING:
        # Who (if anyone) already owns this number?
        owner = await db.interest_registrations.find_one(
            {"founder_number": number, "is_test": {"$ne": True}},
            {"_id": 0, "id": 1, "first_name": 1, "last_name": 1, "email": 1},
        )
        matches = _match_one(token)
        if owner:
            # Idempotent case: the correct person already owns it.
            if token in _display_name(owner).lower():
                plan.append({"token": token, "number": number, "reg": owner, "action": "already_done"})
                continue
            errors.append(f"#{number:04d} is already owned by '{_display_name(owner)}' — refusing (would duplicate for '{token}').")
            continue
        if len(matches) == 0:
            errors.append(f"no numberless registration found matching '{token}' for #{number:04d}.")
            continue
        if len(matches) > 1:
            errors.append(f"ambiguous: {len(matches)} numberless registrations match '{token}' — refusing.")
            continue
        reg = matches[0]
        cur = reg.get("founder_number")
        if isinstance(cur, int) and cur > 0 and cur != number:
            errors.append(f"'{token}' already owns #{cur:04d}; approved is #{number:04d} — refusing (never renumber).")
            continue
        # Slot must be available (or already consumed — only acceptable when the
        # person already owns the number, handled by the owner branch above).
        avail = await _available_reserved_slots(db)
        if number not in avail:
            errors.append(f"reserved slot #{number:04d} is not available — refusing.")
            continue
        plan.append({"token": token, "number": number, "reg": reg, "action": "assign"})

    ok = not errors
    planned_view = [{
        "name": _display_name(p["reg"]), "email": (p["reg"].get("email") or ""),
        "number": p["number"], "number_display": server._fmt_founder_no(p["number"]),
        "action": p["action"],
    } for p in plan]

    if not apply or not ok:
        return {
            "mode": "dry-run" if not apply else "aborted",
            "ok": ok,
            "errors": errors,
            "planned": planned_view,
            "note": ("Pre-flight only — re-call with dry_run=false to apply." if ok
                     else "Refused: validation errors above; nothing was changed."),
        }

    # ── APPLY (all-or-nothing validation already passed) ──
    results: list[dict] = []
    for p in plan:
        reg = p["reg"]; number = p["number"]; reg_id = reg.get("id")
        name = _display_name(reg)
        first_name = (reg.get("first_name") or "").strip() or "Friend"
        email = (reg.get("email") or "").strip().lower()
        companion = reg.get("companion_choice")

        if p["action"] == "already_done":
            fresh = await db.interest_registrations.find_one({"id": reg_id}, {"_id": 0}) or reg
            email_status = "email already sent" if await _ack_already_sent(db, fresh) else "email not previously sent"
            results.append({"name": name, "number": number, "number_display": server._fmt_founder_no(number),
                            "email_status": email_status, "action": "already_done"})
            continue

        # 1) Consume the SPECIFIC reserved slot.
        consumed = await _consume_specific_slot(db, number)
        if consumed != 1:
            results.append({"name": name, "number": number, "number_display": server._fmt_founder_no(number),
                            "email_status": "skipped", "action": "slot_unavailable"})
            continue
        # 2) Attach the exact number atomically (only if still numberless).
        now = server.now_iso()
        res = await db.interest_registrations.update_one(
            {"id": reg_id, "$or": [{"founder_number": None}, {"founder_number": {"$exists": False}}]},
            {"$set": {"founder_number": number, "founder_number_locked": True,
                      "status": "registered", "confirmed_at": reg.get("confirmed_at") or now,
                      "updated_at": now, "backfill_repaired_at": now, "backfill_repair_tag": REPAIR_TAG}},
        )
        if res.matched_count != 1:
            # Lost the race / already numbered — recycle the slot back.
            await db[server._FOUNDER_RESERVED_SLOTS_COLL].update_one(
                {"number": number}, {"$set": {"status": "available"}})
            results.append({"name": name, "number": number, "number_display": server._fmt_founder_no(number),
                            "email_status": "skipped", "action": "attach_failed"})
            continue

        # 3) Ack email once, guarded.
        fresh = await db.interest_registrations.find_one({"id": reg_id}, {"_id": 0}) or reg
        if await _ack_already_sent(db, fresh):
            email_status = "email already sent"
        elif not send_email:
            email_status = "email skipped (send_email=false)"
        elif not email:
            email_status = "email skipped (no address on file)"
        else:
            sent, detail = await _send_ack_email(db, reg_id, first_name, email, companion, number)
            email_status = "email sent now" if sent else f"email FAILED ({detail})"
        results.append({"name": name, "number": number, "number_display": server._fmt_founder_no(number),
                        "email_status": email_status, "action": "assigned"})

    verification = await _verify_after(db)
    all_ok = (verification["numberless_remaining_ok"] and verification["reserved_slots_consumed_ok"]
              and verification["duplicate_founder_numbers_ok"] and verification["next_is_128"])
    return {"mode": "apply", "ok": all_ok, "errors": [], "results": results, "verification": verification}


async def main(apply: bool, send_email: bool, force: bool) -> int:
    db = server.db
    mode = "APPLY" if apply else "DRY-RUN"
    print(f"Founder backfill repair ({REPAIR_TAG}) — DB={db.name!r}  mode={mode}  email={'ON' if send_email else 'OFF'}")
    print("=" * 74)

    query = {
        "$or": [{"founder_number": None}, {"founder_number": {"$exists": False}}],
        "is_test": {"$ne": True},
        "is_reserved": {"$ne": True},
    }
    rows = await db.interest_registrations.find(query, {"_id": 0}).to_list(10000)
    rows.sort(key=_created_key)  # oldest-first

    avail = await _available_reserved_slots(db)
    print(f"Real registrations missing a founder_number: {len(rows)}  (oldest-first)")
    print(f"Available reserved slots (lowest-first draw order): {avail}")
    print("-" * 74)
    print("PLANNED assignment (oldest registration → lowest reserved slot):")
    for i, r in enumerate(rows):
        planned = EXPECTED_SLOTS[i] if i < len(EXPECTED_SLOTS) else "(counter)"
        planned_disp = server._fmt_founder_no(planned) if isinstance(planned, int) else planned
        print(f"   {i+1}. {_display_name(r):<26} {r.get('email','')!r:<32} created={r.get('created_at')}  → {planned_disp}")
    if not rows:
        print("   (nothing to repair)")

    ok, notes = await _preflight(db, rows)
    if notes:
        print("-" * 74)
        for n in notes:
            print(f"   {n}")
    print("-" * 74)

    if not apply:
        print("DRY-RUN — re-run with --apply to assign numbers and (optionally) send ack emails.")
        print(f"Pre-flight match: {'OK ✅' if ok else 'MISMATCH ⚠️  (--apply would abort unless --force)'}")
        return 0 if ok else 1

    if not ok and not force:
        print("ABORT: production shape does not match the confirmed expectation.")
        print("       No records were changed. Re-check, or pass --force to override.")
        return 2

    results: list[tuple[str, int, str]] = []  # (name, number, email_status)
    for r in rows:
        reg_id = r.get("id")
        name = _display_name(r)
        first_name = (r.get("first_name") or "").strip() or "Friend"
        email = (r.get("email") or "").strip().lower()
        companion = r.get("companion_choice")

        # 1) Assign via the EXACT production allocator (idempotent + non-burning).
        try:
            number = await server._assign_founder_number_to_registration(reg_id)
        except Exception as e:  # noqa: BLE001
            print(f"   !! {name}: number assign FAILED ({e}) — skipping, no number burned.")
            continue

        # Mark status + audit trail (mirrors confirm's status flip). Only set
        # confirmed_at if not already confirmed; always stamp the repair marker.
        now = server.now_iso()
        set_fields = {"status": "registered", "backfill_repaired_at": now, "backfill_repair_tag": REPAIR_TAG}
        if not r.get("confirmed_at"):
            set_fields["confirmed_at"] = now
        try:
            await db.interest_registrations.update_one({"id": reg_id}, {"$set": set_fields})
        except Exception:
            pass

        # 2) Ack email — guarded so a re-run never double-sends.
        fresh = await db.interest_registrations.find_one({"id": reg_id}, {"_id": 0}) or r
        if await _ack_already_sent(db, fresh):
            email_status = "email already sent"
        elif not send_email:
            email_status = "email skipped (--no-email)"
        elif not email:
            email_status = "email skipped (no address on file)"
        else:
            sent, detail = await _send_ack_email(db, reg_id, first_name, email, companion, number)
            email_status = "email sent now" if sent else f"email FAILED ({detail})"

        results.append((name, number, email_status))
        print(f"   ✓ {name:<28} → {server._fmt_founder_no(number)}  |  {email_status}")

    # ── Final report ──
    print("\n" + "=" * 74)
    print("REPAIR MAPPING (Name → founder number → email status)")
    print("-" * 74)
    for name, number, email_status in results:
        print(f"   {name:<28} → {server._fmt_founder_no(number)}  →  {email_status}")

    remaining = await db.interest_registrations.count_documents({
        "$or": [{"founder_number": None}, {"founder_number": {"$exists": False}}],
        "is_test": {"$ne": True},
        "is_reserved": {"$ne": True},
    })
    print("-" * 74)
    print("VERIFICATION")

    # 1) No real registration left without a number.
    print(f"   1. real registrations still missing founder_number: {remaining}  "
          f"{'✅' if remaining == 0 else '⚠️'}")

    # 2) The 7 targeted reserved slots are now consumed.
    still_avail = await _available_reserved_slots(db)
    slots_consumed = [n for n in EXPECTED_SLOTS if n not in still_avail]
    slots_ok = all(n not in still_avail for n in EXPECTED_SLOTS)
    print(f"   2. reserved slots consumed {slots_consumed} ; still-available={still_avail}  "
          f"{'✅' if slots_ok else '⚠️'}")

    # 3) No duplicate founder numbers across all live (non-test) rows.
    dupes = await db.interest_registrations.aggregate([
        {"$match": {"is_test": {"$ne": True}, "founder_number": {"$type": "number"}}},
        {"$group": {"_id": "$founder_number", "n": {"$sum": 1}}},
        {"$match": {"n": {"$gt": 1}}},
    ]).to_list(1000)
    print(f"   3. duplicate founder numbers: {[{'number': d['_id'], 'count': d['n']} for d in dupes] or 'none'}  "
          f"{'✅' if not dupes else '⚠️'}")

    # 4) Next new founder number continues correctly after the current highest.
    top = await db.interest_registrations.find_one(
        {"is_test": {"$ne": True}, "founder_number": {"$type": "number"}},
        {"_id": 0, "founder_number": 1}, sort=[("founder_number", -1)],
    )
    max_num = int((top or {}).get("founder_number") or 0)
    counter = await db.counters.find_one({"id": server._FOUNDER_NUMBER_COUNTER_ID}, {"_id": 0, "value": 1})
    counter_val = int((counter or {}).get("value") or 0)
    # With no available reserved gaps left, the next confirm draws counter+1.
    next_num = (still_avail[0] if still_avail else counter_val + 1)
    next_ok = (counter_val >= max_num) and (next_num > max_num or next_num in still_avail)
    print(f"   4. highest founder_number={max_num} ; counter={counter_val} ; next new → "
          f"{server._fmt_founder_no(next_num)}  {'✅' if next_ok else '⚠️'}")

    all_ok = (remaining == 0) and slots_ok and (not dupes) and next_ok
    print("-" * 74)
    print("✅ Repair complete and verified." if all_ok else "⚠️  Repair finished with warnings — review above.")
    return 0 if all_ok else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="perform the repair (default: dry-run)")
    ap.add_argument("--no-email", action="store_true", help="assign numbers but do NOT send ack emails")
    ap.add_argument("--force", action="store_true", help="override the pre-flight shape guard")
    args = ap.parse_args()
    sys.exit(asyncio.run(main(apply=args.apply, send_email=not args.no_email, force=args.force)))
