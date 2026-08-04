"""Templates collection — data-driven flyer catalogue.

One document per template. Adding a new template later means inserting
a doc (or hitting `POST /api/cms/flyer-templates`) — no code change
required.

Seeded on first boot:
  • ``founding_member_invite`` — the existing PIL renderer
    (`/api/admin/invite-flyer`) becomes this template's engine.
  • ``community_notice`` — the pre-built PDFs in
    ``/app/website/public/flyer-mockups/download-*``.
"""

from __future__ import annotations
import logging
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone

logger = logging.getLogger("friendplace.flyers.templates")

COLL_FLYER_TEMPLATES = "flyer_templates"


# ---------------------------------------------------------------------------
# Engine keys — how the renderer knows which underlying pipeline to invoke
# for a given template. Kept as strings (not enums) so future engines can
# be added in DATA rather than code:
#   • "founding_flyer_v1" → calls the existing PIL `admin_invite_flyer`.
#   • "static_pdf"        → serves a pre-generated PDF from disk.
# When George eventually gets richer templates, add e.g. "coffee_morning_v1"
# without touching this file.
# ---------------------------------------------------------------------------
ENGINE_FOUNDING = "founding_flyer_v1"
ENGINE_STATIC_PDF = "static_pdf"


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---------------------------------------------------------------------------
# Seed data. Deliberately verbose so both admins and George can read
# `description` + `george_hint` and understand when to suggest each.
# ---------------------------------------------------------------------------
_SEED_TEMPLATES: List[Dict[str, Any]] = [
    {
        "key": "founding_member_invite",
        "name": "Founding Member Invite",
        "description": (
            "The signature FriendPlace poster. Bold typography, live "
            "founding-member counter, QR code that credits the printing "
            "admin. Use for community noticeboards, libraries and clubs."
        ),
        "category": "invite",
        "engine": ENGINE_FOUNDING,
        # Fields the caller can personalise. Rendered engine-side.
        "fields": [
            {"key": "admin_id", "label": "Sharing admin ID", "type": "hidden", "required": True},
            {"key": "venue", "label": "Venue or host name", "type": "text", "required": False,
             "help": "Printed along the bottom as 'Posted by …'"},
            {"key": "url", "label": "Referral URL", "type": "hidden", "required": False},
        ],
        # Which of the layout registry's outputs this template supports.
        # Every layout in `registry.LAYOUTS` is valid here — but a template
        # can opt-out of layouts that don't suit its design.
        "supported_layouts": [
            "poster_a3", "poster_a4", "flyer_a5", "flyer_a5_2up_a4", "flyer_a5_4up_a3",
        ],
        "default_layout": "poster_a4",
        "preview_image": None,   # generated on first preview + cached
        "status": "published",
        "used_count": 0,
        "george_hint": (
            "Suggest when an admin asks for a poster to invite new members, "
            "or when they mention flyers for a venue, library, or club."
        ),
    },
    {
        "key": "community_notice",
        "name": "Community Notice",
        "description": (
            "Warm community-notice flyer intended for shopping centres, "
            "cafés and cork-boards. Includes a large 'Belong. Chat. Meet.' "
            "callout and a QR for direct signup."
        ),
        "category": "notice",
        "engine": ENGINE_STATIC_PDF,
        # Static-PDF engines don't take dynamic fields — the design is
        # pre-baked. Kept as an empty list so the UI still renders a form
        # scaffolding consistently.
        "fields": [],
        # Static PDFs are shipped in the website's `/public/flyer-mockups/`
        # tree. The keys map to which asset to serve for each layout.
        "static_assets": {
            "poster_a3": "download-a3.pdf",
            "poster_a4": "download-a4.pdf",
        },
        "supported_layouts": ["poster_a3", "poster_a4"],
        "default_layout": "poster_a4",
        "preview_image": "/flyer-mockups/download-thumb.png",
        "status": "published",
        "used_count": 0,
        "george_hint": (
            "Suggest for shopfront cork-boards, cafés and shopping centres "
            "when an admin doesn't need per-admin QR attribution."
        ),
    },
]


async def ensure_indexes(db) -> None:
    """Idempotent — safe to call on every boot."""
    coll = db[COLL_FLYER_TEMPLATES]
    await coll.create_index("key", unique=True)
    await coll.create_index("status")
    await coll.create_index("category")


async def seed_flyer_templates(db) -> Dict[str, int]:
    """Insert the seeded templates if they aren't already present.

    Returns a small summary dict so the boot log makes it obvious what
    happened (``{'seeded': 2, 'skipped': 0}``).
    """
    await ensure_indexes(db)
    coll = db[COLL_FLYER_TEMPLATES]
    seeded, skipped = 0, 0
    for tpl in _SEED_TEMPLATES:
        existing = await coll.find_one({"key": tpl["key"]}, {"_id": 0, "key": 1})
        if existing:
            skipped += 1
            continue
        doc = {
            **tpl,
            "id": tpl["key"],   # slug doubles as id for readability in URLs
            "created_at": _iso_now(),
            "updated_at": _iso_now(),
            "published_at": _iso_now() if tpl.get("status") == "published" else None,
            "version": 1,
        }
        await coll.insert_one(doc)
        seeded += 1
        logger.info("flyer template seeded: %s", tpl["key"])
    return {"seeded": seeded, "skipped": skipped}


async def list_templates(
    db,
    status: Optional[str] = None,
    category: Optional[str] = None,
) -> List[dict]:
    """List templates. Sensible default: everything not archived, most
    recently updated first (so drafts you're editing surface at the
    top of the CMS list)."""
    q: Dict[str, Any] = {}
    if status:
        q["status"] = status
    else:
        q["status"] = {"$ne": "archived"}
    if category:
        q["category"] = category
    docs = await db[COLL_FLYER_TEMPLATES].find(q, {"_id": 0}).sort("updated_at", -1).to_list(500)
    return docs


async def get_template(db, key_or_id: str) -> Optional[dict]:
    return await db[COLL_FLYER_TEMPLATES].find_one(
        {"$or": [{"key": key_or_id}, {"id": key_or_id}]},
        {"_id": 0},
    )
