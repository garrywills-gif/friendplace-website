"""Founding Members CRM — shared counting rules.

**Single source of truth** for the headline Founding-Members metrics
so the ``/api/cms/crm/founding-members/stats`` endpoint (dashboard
card) and George's ``founding_members_summary`` tool can never drift
apart again.

Design contract (iter163):

- All "today" boundaries use **Sydney** calendar-day midnight
  (:func:`services.time_boundaries.sydney_today_start_iso`). UTC boundaries
  are forbidden here — they were the cause of the New-Today drift bug.

- Reserved slots (``is_reserved: true`` — Garry #0001, George #0002)
  are counted in ``total`` and ``joined`` because they *are* Founding
  Members, but excluded from every other headline metric because they
  don't need to be invited or converted.

- Test-flagged rows (``is_test: true``) are always excluded.

If you need to change the counting rules, edit this module and both
consumers pick it up automatically. Add or update the assertions in
``backend/tests/test_iter163_founding_counts_align.py``.
"""

from __future__ import annotations

from typing import Any, Dict, List

from ..time_boundaries import sydney_today_start_iso

#: Statuses that mean "registered but not yet moved forward". Kept in
#: sync with ``cms_module._AWAITING_STATUSES``; if you change one,
#: change both (and the test-suite will yell if they diverge).
AWAITING_STATUSES: List[str] = ["registered", "new"]


def _base_all() -> Dict[str, Any]:
    """Rows worth counting at all — excludes QA fixtures."""
    return {"is_test": {"$ne": True}}


def _base_public() -> Dict[str, Any]:
    """Rows that represent *real* prospective members. Excludes
    reserved slots (#0001 Garry, #0002 George) — those have their own
    status of ``joined`` and don't need an invite path.
    """
    return {**_base_all(), "is_reserved": {"$ne": True}}


async def compute_founding_members_stats(db: Any) -> Dict[str, Any]:
    """Return the canonical Founding-Members headline dict.

    Fields (both dashboard card and George tool return these):

    - ``total``               — all rows (incl. reserved), test-flagged excluded.
    - ``new_today``           — public rows created since **Sydney midnight**.
    - ``awaiting_contact``    — public rows still ``registered``/``new`` (legacy field name; see ``awaiting_invitation``).
    - ``awaiting_invitation`` — same value as ``awaiting_contact`` under the correct semantic name (iter161c).
    - ``invited``             — public rows with ``status = invited``.
    - ``joined``              — rows with ``status = joined`` (includes reserved by design — Garry and George are "joined" founders).
    - ``opted_out``           — public rows with ``status = opted_out``.
    - ``latest``              — most-recent public row (small projection).
    - ``_semantics``          — ground-truth semantic notes George can quote.
    """
    base_all = _base_all()
    base_public = _base_public()
    today_iso = sydney_today_start_iso()

    total = await db.interest_registrations.count_documents(base_all)
    new_today = await db.interest_registrations.count_documents({
        **base_public,
        "created_at": {"$gte": today_iso},
    })
    awaiting = await db.interest_registrations.count_documents({
        **base_public,
        "$or": [
            {"status": {"$exists": False}},
            {"status": None},
            {"status": {"$in": AWAITING_STATUSES}},
        ],
    })
    invited = await db.interest_registrations.count_documents({
        **base_public, "status": "invited",
    })
    joined = await db.interest_registrations.count_documents({
        **base_all, "status": "joined",
    })
    opted_out = await db.interest_registrations.count_documents({
        **base_public, "status": "opted_out",
    })

    latest = await db.interest_registrations.find_one(
        base_public,
        {
            "_id": 0, "id": 1, "first_name": 1, "email": 1,
            "state_country": 1, "created_at": 1, "founder_number": 1,
        },
        sort=[("created_at", -1)],
    )

    return {
        "total":               total,
        "new_today":           new_today,
        "awaiting_contact":    awaiting,
        # iter161c: expose the correct semantic name as a first-class
        # field so George doesn't have to infer it from tone. The two
        # names carry the SAME number for API back-compat.
        "awaiting_invitation": awaiting,
        "invited":             invited,
        "joined":              joined,
        "opted_out":           opted_out,
        "latest":              latest,
        # Ground-truth note George quotes when asked "how many haven't
        # been emailed?" — comes from the tool layer, not the prompt,
        # so it stays in sync with actual flow behaviour.
        "_semantics": {
            "awaiting_contact_meaning": (
                "These members registered their interest and received the "
                "automatic registration acknowledgement email at signup. "
                "They are now awaiting the personal FriendPlace invitation "
                "email — this is what admins send from the Founding Members "
                "page or via a campaign. Do NOT say these people have not "
                "been emailed."
            ),
            # iter161c fields — preserved verbatim so George's prompt
            # keeps matching them.
            "preferred_label": "awaiting invitation",
            "auto_registration_email_sent": True,
            "personal_invitation_sent":     False,
            # iter163 additions — surfaced so George can be honest about
            # the counting rules if Garry asks.
            "today_boundary": "Australia/Sydney calendar day (midnight local).",
            "reserved_slots_excluded_from": [
                "new_today", "awaiting_contact", "awaiting_invitation",
                "invited", "opted_out", "latest",
            ],
            "reserved_slots_included_in": ["total", "joined"],
        },
    }


async def count_registered_today_public(db: Any) -> int:
    """Convenience: exactly the number the *dashboard* shows as
    "New today". Used by George's chat topic router so the value can
    never drift from the card."""
    return await db.interest_registrations.count_documents({
        **_base_public(),
        "created_at": {"$gte": sydney_today_start_iso()},
    })
