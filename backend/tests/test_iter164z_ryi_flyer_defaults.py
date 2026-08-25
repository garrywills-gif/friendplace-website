"""iter164z — Register Your Interest flyer default copy + layout.

Verifies the founding_flyer_v1 renderer's new pre-launch defaults:

  • Headline default: "REGISTER YOUR INTEREST"
  • Supporting text default: FriendPlace-launch invite line
  • Feature row: Make Friends · Local Events · Share a Moment · Community Groups
  • Bottom CTA: "SCAN TO REGISTER YOUR INTEREST"

We compare byte-hashes rather than trying to OCR the flyer, because
the renderer is deterministic when `qr_code_id` is pinned and the
copy is the only knob that changes between the checked-in "before"
and "after" versions.
"""

from __future__ import annotations

import asyncio
import hashlib
import os

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ.get("DB_NAME", "test_database")


def _render_default_a4_hash():
    async def _run():
        from services.flyers import render_flyer
        from services.flyers import renderer as r
        client = AsyncIOMotorClient(MONGO_URL)
        try:
            db = client[DB_NAME]
            row = await db.users.find_one({"is_admin": True}, {"_id": 0, "id": 1})
            assert row and row.get("id"), "need at least one admin"
            r._RENDER_CACHE.clear()
            res = await render_flyer(
                db, "founding_member_invite", "poster_a4",
                {"admin_id": row["id"], "qr_code_id": "qr_TEST", "flyer_id": "test"},
            )
            return res.content, hashlib.sha256(res.content).hexdigest()
        finally:
            client.close()

    return asyncio.run(_run())


def test_default_render_uses_new_ryi_defaults():
    """The default (no headline/supporting_text override) render must
    now bake in the new Register Your Interest copy — different bytes
    from the same call with the OLD defaults would have produced.

    We can't directly check text pixels, but we verify:
      1. It renders (no exception).
      2. It's a PNG of the expected shape (~180-220 KB posters).
      3. It differs from a render where we pass the OLD default copy
         through the override — proving the DEFAULT changed, not just
         the override plumbing.
    """
    async def _run():
        from services.flyers import render_flyer
        from services.flyers import renderer as r
        client = AsyncIOMotorClient(MONGO_URL)
        try:
            db = client[DB_NAME]
            row = await db.users.find_one({"is_admin": True}, {"_id": 0, "id": 1})
            r._RENDER_CACHE.clear()
            pinned = {"admin_id": row["id"], "qr_code_id": "qr_TEST", "flyer_id": "test"}
            default_render = await render_flyer(
                db, "founding_member_invite", "poster_a4", pinned,
            )
            old_copy_render = await render_flyer(
                db, "founding_member_invite", "poster_a4",
                {
                    **pinned,
                    "headline": "FIND YOUR PEOPLE.",
                    "supporting_text": "Meet new friends. Join local events. Feel connected.",
                },
            )
            return default_render.content, old_copy_render.content
        finally:
            client.close()

    default_content, with_old_copy = asyncio.run(_run())
    assert default_content.startswith(b"\x89PNG\r\n"), "must be PNG"
    assert 100_000 < len(default_content) < 350_000, (
        f"unexpected poster size {len(default_content)} — layout drift?"
    )
    assert default_content != with_old_copy, (
        "The default render must have changed — new pre-launch defaults "
        "should differ visibly from the old FIND-YOUR-PEOPLE copy."
    )


def test_render_still_honours_overrides():
    """Regression: an explicit override still trumps the new defaults."""
    async def _run():
        from services.flyers import render_flyer
        from services.flyers import renderer as r
        client = AsyncIOMotorClient(MONGO_URL)
        try:
            db = client[DB_NAME]
            row = await db.users.find_one({"is_admin": True}, {"_id": 0, "id": 1})
            r._RENDER_CACHE.clear()
            base = await render_flyer(
                db, "founding_member_invite", "poster_a4",
                {"admin_id": row["id"], "qr_code_id": "qr_TEST"},
            )
            over = await render_flyer(
                db, "founding_member_invite", "poster_a4",
                {"admin_id": row["id"], "qr_code_id": "qr_TEST",
                 "headline": "GARRY WAS HERE"},
            )
            assert base.content != over.content
        finally:
            client.close()

    asyncio.run(_run())
