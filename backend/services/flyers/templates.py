"""Templates collection — data-driven flyer catalogue.

One document per template. Adding a new template later means inserting
a doc (or hitting `POST /api/cms/flyer-templates`) — no code change
required.

Seeded on first boot:
  • ``founding_member_invite`` — the existing PIL renderer
    (`/api/admin/invite-flyer`) becomes this template's engine.
  • ``community_notice`` — the pre-built PDFs in
    ``/app/website/public/flyer-mockups/download-*``.

Field library (Garry, 3 Aug 2026):
  A shared bank of editable placeholders that any template can opt
  into. Templates stay generic; the wording is content, not code —
  so an admin can change the headline or venue without asking a
  developer for a new template. Engines opt-in to which fields
  they honour; the render endpoint accepts them all as optional
  query params, so engines that don't use a field simply ignore it.
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
#     Uses only `admin_id`, `venue`, `url`. Preserved verbatim per Garry's
#     "keep the existing renderer exactly as it is" instruction.
#   • "static_pdf"        → serves a pre-generated PDF from disk.
#   • "dynamic_flyer_v1"  → RESERVED for future generic templates that
#     honour the full FIELD_LIBRARY. Not implemented yet; when it lands
#     the UI + render endpoint + George tool binding are already wired.
# When George eventually gets richer templates, add e.g. "coffee_morning_v1"
# without touching this file.
# ---------------------------------------------------------------------------
ENGINE_FOUNDING = "founding_flyer_v1"
ENGINE_STATIC_PDF = "static_pdf"
ENGINE_DYNAMIC = "dynamic_flyer_v1"


# ---------------------------------------------------------------------------
# FIELD_LIBRARY — the canonical bank of editable placeholders.
#
# A template's `fields` array references entries from here (by `key`), so
# the UI can look up label, type, help text and validation in one place.
# Adding a new field to the library is data-only — every template can
# opt into it via the /admin/flyers/[key] editor.
#
# Type meanings:
#   "text"        — short single-line string (venue name, headline)
#   "textarea"    — multi-line supporting text
#   "date"        — ISO date (YYYY-MM-DD)
#   "time"        — 24h HH:MM
#   "url"         — HTTPS URL for QR destination
#   "select"      — enum; the field entry supplies `options`
#   "hidden"      — passed through but not surfaced in the editor UI
#                   (e.g. admin_id for QR attribution)
# ---------------------------------------------------------------------------
FIELD_LIBRARY: List[Dict[str, Any]] = [
    {"key": "admin_id",         "label": "Sharing admin",     "type": "hidden",   "help": "QR credit attribution."},
    {"key": "suburb",           "label": "Suburb / local area", "type": "text",   "help": "Where this flyer is going up."},
    {"key": "venue",            "label": "Venue",              "type": "text",    "help": "e.g. Kellyville Library, Ashfield Bowling Club"},
    {"key": "meeting_day",      "label": "Meeting day",        "type": "select",  "options": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Weekdays", "Weekends"]},
    {"key": "meeting_time",     "label": "Meeting time",       "type": "time"},
    {"key": "meeting_date",     "label": "Specific date",      "type": "date",    "help": "Leave blank for recurring events."},
    {"key": "organiser",        "label": "Organiser / contact","type": "text",    "help": "Name shown as 'Organised by …'"},
    {"key": "contact_phone",    "label": "Contact phone",      "type": "text"},
    {"key": "contact_email",    "label": "Contact email",      "type": "text"},
    {"key": "headline",         "label": "Headline",           "type": "text",    "help": "Big line at the top of the flyer."},
    {"key": "supporting_text",  "label": "Supporting text",    "type": "textarea","help": "Short paragraph under the headline."},
    {"key": "url",              "label": "QR destination URL", "type": "url",     "help": "Where the QR code sends scanners. Defaults to friendplace.com.au?ref=<admin>."},
    {"key": "logo_position",    "label": "Logo position",      "type": "select",  "options": ["top-left", "top-centre", "top-right", "bottom-left", "bottom-centre", "bottom-right", "hidden"]},
]

# O(1) lookup used by the render endpoint to know which query-string
# params are recognised field keys (unknown params get ignored so the
# API is forward-compatible).
KNOWN_FIELD_KEYS = {f["key"] for f in FIELD_LIBRARY}


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
        # Fields the FOUNDING engine actually honours today. The full
        # FIELD_LIBRARY is available on other templates; this engine is
        # deliberately conservative to preserve the existing PIL design.
        "fields": [
            {"key": "admin_id", "label": "Sharing admin ID", "type": "hidden", "required": True},
            {"key": "venue", "label": "Venue or host name", "type": "text", "required": False,
             "help": "Printed along the bottom as 'Posted by …'"},
            {"key": "url", "label": "QR destination URL", "type": "url", "required": False,
             "help": "Defaults to https://friendplace.com.au?ref=<admin>"},
        ],
        "supported_layouts": [
            "poster_a3", "poster_a4", "flyer_a5", "flyer_a5_2up_a4", "flyer_a5_4up_a3",
        ],
        "default_layout": "poster_a4",
        "preview_image": None,
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
        "fields": [],
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
            "id": tpl["key"],
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
    recently updated first."""
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


def resolve_field(key: str) -> Optional[Dict[str, Any]]:
    """Look up a field's metadata (label, type, options) by key."""
    for f in FIELD_LIBRARY:
        if f["key"] == key:
            return dict(f)
    return None


def field_library() -> List[Dict[str, Any]]:
    """Public view of the field library for the UI's 'add field' picker."""
    return [dict(f) for f in FIELD_LIBRARY]



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
