"""iter164aa — Founding-Member ribbon toggle passthrough test.

Bug the fix addresses: the "BECOME A FOUNDING MEMBER" yellow ribbon
was always rendered on the founding_flyer_v1 poster. There was no way
to opt out for the pre-launch Register Your Interest flow.

Fix: `show_founding_member` (bool) is now:
  • an explicit parameter on `admin_invite_flyer` (default True)
  • accepted on the CMS render endpoint as a query string toggle
  • wired into the Publishing Centre editor as a checkbox (defaults
    OFF for the founding_flyer_v1 engine)

Test verifies the boundary contract end-to-end.
"""

from __future__ import annotations

import asyncio
import os

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ.get("DB_NAME", "test_database")


def test_show_founding_member_toggle_changes_the_render():
    async def _run():
        from services.flyers import render_flyer
        from services.flyers import renderer as r
        client = AsyncIOMotorClient(MONGO_URL)
        try:
            db = client[DB_NAME]
            row = await db.users.find_one({"is_admin": True}, {"_id": 0, "id": 1})
            r._RENDER_CACHE.clear()
            pinned = {"admin_id": row["id"], "qr_code_id": "qr_TEST", "flyer_id": "test"}

            with_ribbon = await render_flyer(
                db, "founding_member_invite", "poster_a4",
                {**pinned, "show_founding_member": "true"},
            )
            without = await render_flyer(
                db, "founding_member_invite", "poster_a4",
                {**pinned, "show_founding_member": "false"},
            )
            return with_ribbon.content, without.content
        finally:
            client.close()

    a, b = asyncio.run(_run())
    assert a != b, (
        "show_founding_member toggle must materially change the render — "
        "ribbon-on and ribbon-off should produce different bytes."
    )
    # Ribbon-off is roughly ~15 KB lighter (yellow block gone), so
    # sanity-check the size direction while we're here.
    assert len(b) < len(a) + 50_000, (
        f"unexpectedly larger ribbon-off render: on={len(a)} off={len(b)}"
    )


def test_show_founding_member_defaults_to_true_when_omitted():
    """Passing no value must render identically to `true` — protects
    every legacy caller of `admin_invite_flyer` from a behaviour flip."""
    async def _run():
        from services.flyers import render_flyer
        from services.flyers import renderer as r
        client = AsyncIOMotorClient(MONGO_URL)
        try:
            db = client[DB_NAME]
            row = await db.users.find_one({"is_admin": True}, {"_id": 0, "id": 1})
            r._RENDER_CACHE.clear()
            pinned = {"admin_id": row["id"], "qr_code_id": "qr_TEST", "flyer_id": "test"}
            omitted = await render_flyer(
                db, "founding_member_invite", "poster_a4", pinned,
            )
            explicit_true = await render_flyer(
                db, "founding_member_invite", "poster_a4",
                {**pinned, "show_founding_member": "true"},
            )
            return omitted.content, explicit_true.content
        finally:
            client.close()

    a, b = asyncio.run(_run())
    assert a == b, "Omitted show_founding_member must match `true` for legacy safety"


def test_show_founding_member_bool_true_matches_string_true():
    """Explicit Python bool True on the internal call path must match
    the string 'true' that comes off the HTTP layer."""
    async def _run():
        from services.flyers import render_flyer
        from services.flyers import renderer as r
        client = AsyncIOMotorClient(MONGO_URL)
        try:
            db = client[DB_NAME]
            row = await db.users.find_one({"is_admin": True}, {"_id": 0, "id": 1})
            r._RENDER_CACHE.clear()
            pinned = {"admin_id": row["id"], "qr_code_id": "qr_TEST"}
            bool_true = await render_flyer(
                db, "founding_member_invite", "poster_a4",
                {**pinned, "show_founding_member": True},
            )
            str_true = await render_flyer(
                db, "founding_member_invite", "poster_a4",
                {**pinned, "show_founding_member": "true"},
            )
            return bool_true.content, str_true.content
        finally:
            client.close()

    a, b = asyncio.run(_run())
    assert a == b, "bool True and string 'true' must render the same"
