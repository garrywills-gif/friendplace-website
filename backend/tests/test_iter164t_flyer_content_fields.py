"""iter164t — Flyer Publishing Centre editor: content field pass-through.

Bug (Garry, 24 Aug 2026): In the Flyer Publishing Centre editor,
changing the ``headline`` and ``supporting_text`` fields did not
update the preview. The founding_flyer_v1 engine ignored the two
fields — the render endpoint accepted them but the PIL renderer
still hardcoded "FIND YOUR PEOPLE." and the four-icon lead line.

Fix: propagate ``headline`` and ``supporting_text`` from the render
endpoint → ``services.flyers.render_flyer`` → ``_render_founding``
→ ``server.admin_invite_flyer`` where they're used in place of the
hardcoded strings (when non-empty).

The four render calls below share one Motor client so pytest-asyncio's
default per-test loop doesn't tear the transport out from under us.
"""

from __future__ import annotations

import asyncio
import os

import pytest
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ.get("DB_NAME", "test_database")


def test_content_field_overrides_change_the_render():
    """One-shot test: baseline vs headline-only vs both-overrides
    should each produce different PNG bytes; empty overrides should be
    a byte-for-byte no-op against the baseline (with QR id pinned).
    """
    async def _run():
        from services.flyers import render_flyer

        client = AsyncIOMotorClient(MONGO_URL)
        try:
            db = client[DB_NAME]
            row = await db.users.find_one({"is_admin": True}, {"_id": 0, "id": 1})
            assert row and row.get("id"), "expected at least one admin user"
            admin_id = row["id"]

            # Pin the QR uuid so bit-for-bit comparison isn't defeated
            # by the renderer's per-call uuid.uuid4() default.
            pinned = {
                "admin_id": admin_id,
                "qr_code_id": "qr_TEST",
                "flyer_id": "test_flyer",
            }
            baseline = await render_flyer(
                db, "founding_member_invite", "poster_a4", pinned,
            )
            headline_only = await render_flyer(
                db, "founding_member_invite", "poster_a4",
                {**pinned, "headline": "REGISTER YOUR INTEREST"},
            )
            with_support = await render_flyer(
                db, "founding_member_invite", "poster_a4",
                {**pinned,
                 "headline": "REGISTER YOUR INTEREST",
                 "supporting_text": "Leave your name at the door."},
            )
            empty_overrides = await render_flyer(
                db, "founding_member_invite", "poster_a4",
                {**pinned, "headline": "", "supporting_text": ""},
            )
        finally:
            client.close()

        # 1. Every render came back as a PNG.
        for r in (baseline, headline_only, with_support, empty_overrides):
            assert r.media_type == "image/png"

        # 2. Empty overrides are a byte-for-byte no-op vs baseline —
        #    the founding engine's legacy output must be preserved.
        assert baseline.content == empty_overrides.content, (
            "Empty override strings must not change the rendered bytes"
        )

        # 3. Headline override changes the render.
        assert baseline.content != headline_only.content, (
            "Headline override should change the rendered PNG"
        )

        # 4. Adding supporting_text on top changes it again.
        assert headline_only.content != with_support.content, (
            "Supporting_text override should change the rendered PNG"
        )

    asyncio.run(_run())


def test_unknown_layout_still_rejected():
    """Sanity check — the supported_layouts guard stays intact."""
    async def _run():
        from services.flyers import render_flyer

        client = AsyncIOMotorClient(MONGO_URL)
        try:
            db = client[DB_NAME]
            row = await db.users.find_one({"is_admin": True}, {"_id": 0, "id": 1})
            assert row and row.get("id"), "expected at least one admin user"
            with pytest.raises((ValueError, KeyError)):
                await render_flyer(
                    db, "founding_member_invite", "not_a_real_layout",
                    {"admin_id": row["id"], "headline": "REGISTER YOUR INTEREST"},
                )
        finally:
            client.close()

    asyncio.run(_run())
