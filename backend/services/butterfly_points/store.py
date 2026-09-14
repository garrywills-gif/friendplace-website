"""Butterfly Points ledger — manual admin recognition (iter164h).

Two design principles:

1. **Immutable, additive ledger.** Every manual award writes one row
   with ``kind="award"`` and a positive ``amount``. A reversal writes a
   NEW row with ``kind="reversal"``, a negative ``amount`` mirroring the
   original, and a ``reverses_id`` pointer. The original row is NEVER
   mutated — the audit trail sees both events forever.

2. **Badges are milestones, not scoreboards.** ``users.badges`` is
   append-only in the existing model; a reversal that drops the balance
   below a threshold does NOT revoke a badge. See :func:`award_points_manual`.

Doc shape (``COLL_LEDGER``)::

    {
      id:                uuid,                # ledger row id
      user_id:           the recipient (users.id),
      amount:            +N for awards, -N for reversals,
      reason:            5..300 chars, verbatim what the member sees,
      persona:           "george" | "georgia",
      kind:              "award" | "reversal",
      reverses_id:       ledger.id of the row being reversed (reversals only),
      reversed_at:       iso — set on the ORIGINAL award once reversed
                         (denormalised so the UI can grey it out cheaply),
      reversed_by_ledger_id: the reversal row id (denormalised),
      admin_id:          CMS admin id who executed the action,
      admin_email:       stamped for readability in the CMS,
      admin_name:        display name at action time,
      notification_id:   notifications.id (award rows only) so the UI
                         can show a "member saw this" hint,
      created_at:        iso timestamp.
    }
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import uuid

# ---------------------------------------------------------------------------
# Constants — echoed to the frontend via the /policy endpoint below.
# ---------------------------------------------------------------------------

COLL_LEDGER = "butterfly_points_ledger"

LEDGER_KIND_AWARD    = "award"
LEDGER_KIND_REVERSAL = "reversal"

PERSONAS = ("george", "georgia")

AWARD_MIN        = 1
AWARD_MAX        = 100
AWARD_SOFT_WARN  = 50    # UI shows a soft warning above this value
REASON_MIN       = 5
REASON_MAX       = 300

# Persona display metadata used to build member-facing notifications.
# Kept small and copy-locked here so tests can assert exact wording.
_PERSONA_META = {
    "george":  {"name": "George",  "avatar": "🦋"},
    "georgia": {"name": "Georgia", "avatar": "🦋"},
}


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Member-facing message builder
# ---------------------------------------------------------------------------

def build_recognition_message(
    *, amount: int, reason: str, persona: str,
) -> Dict[str, str]:
    """Return the exact title + body the recipient will see.

    Kept warm but not gushy — one line of recognition, one line of why,
    one line of "thanks for being that kind of person". Same shape as the
    admin's preview, so what they see is what the member reads.

    Copy-locked with Garry: friendly, human, single sentence per line.
    """
    meta  = _PERSONA_META.get(persona) or _PERSONA_META["george"]
    plural = "point" if int(amount) == 1 else "points"
    title = f"{meta['avatar']} {meta['name']} — Butterfly {plural} for you"
    body = (
        f"You've been given {amount} Butterfly {plural} — "
        f"for {reason.strip()}. "
        f"Thank you for being that kind of person on FriendPlace."
    )
    return {"title": title, "body": body, "persona_name": meta["name"], "persona_avatar": meta["avatar"]}


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def _validate_award(amount: int, reason: str, persona: str) -> None:
    if not isinstance(amount, int) or amount < AWARD_MIN or amount > AWARD_MAX:
        raise ValueError(f"amount must be an integer between {AWARD_MIN} and {AWARD_MAX}")
    trimmed = (reason or "").strip()
    if len(trimmed) < REASON_MIN or len(trimmed) > REASON_MAX:
        raise ValueError(f"reason must be {REASON_MIN}–{REASON_MAX} characters")
    if persona not in PERSONAS:
        raise ValueError(f"persona must be one of {PERSONAS}")


# ---------------------------------------------------------------------------
# Ledger writes
# ---------------------------------------------------------------------------

async def award_points_manual(
    db: Any, *,
    user_id: str,
    amount: int,
    reason: str,
    persona: str,
    admin_id: Optional[str],
    admin_email: Optional[str],
    admin_name: Optional[str],
    award_points_impl,          # async callable: (user_id, amount, reason) -> None
    push_notification_impl,     # async callable → returns the notification doc
) -> Dict[str, Any]:
    """Persist a manual award, credit the member's running balance, and
    dispatch the warm George/Georgia notification.

    The two ``*_impl`` callables are dependency-injected so the store can
    be unit-tested without importing the FastAPI world (server.py's
    ``award_points`` + ``push_notification`` live there). Production
    wiring happens in ``router.py``.
    """
    _validate_award(amount, reason, persona)

    ledger_id = str(uuid.uuid4())
    now       = _iso_now()
    trimmed   = reason.strip()

    # 1. Credit the running balance via the existing helper. This also
    #    grants any new milestone badges through the pre-existing
    #    thresholds — reversals do NOT revoke badges by design.
    await award_points_impl(user_id, int(amount), f"admin_recognition:{ledger_id}")

    # 2. Send the warm George/Georgia notification.
    msg = build_recognition_message(amount=amount, reason=trimmed, persona=persona)
    await push_notification_impl(
        user_id,
        "recognition",
        msg["title"],
        msg["body"],
        {
            "sender_persona":   persona,
            "sender_name":      msg["persona_name"],
            "sender_avatar":    msg["persona_avatar"],
            "amount":           int(amount),
            "reason":           trimmed,
            "ledger_id":        ledger_id,
            "kind":             LEDGER_KIND_AWARD,
        },
    )
    # server.push_notification doesn't return the doc, but the payload
    # carries our ledger_id — look it back up for a stable pointer.
    notif = await db.notifications.find_one(
        {"user_id": user_id, "payload.ledger_id": ledger_id},
        {"_id": 0, "id": 1},
    )
    notification_id = (notif or {}).get("id")

    # 3. Persist the ledger row LAST so it captures the notification id.
    doc: Dict[str, Any] = {
        "id":              ledger_id,
        "user_id":         user_id,
        "amount":          int(amount),
        "reason":          trimmed,
        "persona":         persona,
        "kind":            LEDGER_KIND_AWARD,
        "reverses_id":     None,
        "reversed_at":     None,
        "reversed_by_ledger_id": None,
        "admin_id":        admin_id,
        "admin_email":     admin_email,
        "admin_name":      admin_name,
        "notification_id": notification_id,
        "created_at":      now,
    }
    await db[COLL_LEDGER].insert_one(doc)
    return await db[COLL_LEDGER].find_one({"id": ledger_id}, {"_id": 0}) or doc


async def reverse_ledger_entry(
    db: Any, *,
    ledger_id: str,
    reason: str,
    admin_id: Optional[str],
    admin_email: Optional[str],
    admin_name: Optional[str],
    award_points_impl,          # same signature as above; amount will be NEGATIVE
) -> Dict[str, Any]:
    """Reverse a prior award. Additive — writes a NEW negative ledger
    row and stamps the original with a back-pointer.

    - Rejects if the original doesn't exist or isn't a positive award.
    - Rejects if the original is ALREADY reversed (idempotency guard).
    - Balance decrement uses the same ``award_points`` helper with a
      negative amount so the running total stays honest.
    - Badges are NOT revoked (existing model is milestone-only).
    - ``reason`` on the reversal explains WHY (audit); no member-facing
      notification is sent for the reversal (the member never saw a
      running balance change bulletin, so a "we took it back" ping
      would be more jarring than helpful — Garry-locked default).
    """
    trimmed = (reason or "").strip()
    if len(trimmed) < REASON_MIN or len(trimmed) > REASON_MAX:
        raise ValueError(f"reversal reason must be {REASON_MIN}–{REASON_MAX} characters")

    original = await db[COLL_LEDGER].find_one({"id": ledger_id}, {"_id": 0})
    if not original:
        raise LookupError("original ledger entry not found")
    if original.get("kind") != LEDGER_KIND_AWARD:
        raise ValueError("only award rows can be reversed")
    if original.get("reversed_at"):
        raise ValueError("this award has already been reversed")

    now = _iso_now()
    reversal_id = str(uuid.uuid4())
    original_amount = int(original.get("amount") or 0)

    # 1. Decrement running balance. Points can drop but badges stay.
    await award_points_impl(
        original["user_id"], -original_amount,
        f"admin_reversal:{ledger_id}",
    )

    # 2. Persist the reversal row.
    reversal: Dict[str, Any] = {
        "id":              reversal_id,
        "user_id":         original["user_id"],
        "amount":          -original_amount,
        "reason":          trimmed,
        "persona":         original.get("persona"),
        "kind":            LEDGER_KIND_REVERSAL,
        "reverses_id":     ledger_id,
        "reversed_at":     None,
        "reversed_by_ledger_id": None,
        "admin_id":        admin_id,
        "admin_email":     admin_email,
        "admin_name":      admin_name,
        "notification_id": None,
        "created_at":      now,
    }
    await db[COLL_LEDGER].insert_one(reversal)

    # 3. Stamp the original (denormalised so the UI doesn't need a join).
    await db[COLL_LEDGER].update_one(
        {"id": ledger_id},
        {"$set": {
            "reversed_at":            now,
            "reversed_by_ledger_id":  reversal_id,
        }},
    )

    return {
        "reversal": await db[COLL_LEDGER].find_one({"id": reversal_id}, {"_id": 0}),
        "original": await db[COLL_LEDGER].find_one({"id": ledger_id}, {"_id": 0}),
    }


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

async def list_ledger_for_member(
    db: Any, *,
    user_id: str,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    """Return newest-first ledger rows for one member."""
    cur = (
        db[COLL_LEDGER]
        .find({"user_id": user_id}, {"_id": 0})
        .sort("created_at", -1)
        .limit(int(max(1, min(limit, 500))))
    )
    return [row async for row in cur]


async def sum_ledger_delta_for_member(db: Any, user_id: str) -> int:
    """Net delta this ledger has applied to the running balance. Useful
    for reconciliation / diagnostics — the user document's ``points``
    field is still the source of truth for display."""
    total = 0
    async for row in db[COLL_LEDGER].find({"user_id": user_id}, {"_id": 0, "amount": 1}):
        total += int(row.get("amount") or 0)
    return total


# ---------------------------------------------------------------------------
# Indexes
# ---------------------------------------------------------------------------

async def ensure_indexes(db: Any) -> None:
    await db[COLL_LEDGER].create_index("user_id")
    await db[COLL_LEDGER].create_index("created_at")
    await db[COLL_LEDGER].create_index("reverses_id")
    await db[COLL_LEDGER].create_index("kind")
