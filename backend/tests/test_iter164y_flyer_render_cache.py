"""iter164y — Flyer render response cache tests.

Launch-critical fix: the Register Your Interest preview was slow / timing
out because every keystroke re-fired a fresh render (~500 ms warm,
~3 s cold). The bounded in-memory LRU response cache in
``services.flyers.renderer`` collapses identical (template, layout,
params) tuples to a single physical render.

These tests exercise the cache directly (no HTTP layer) so they're
fast and deterministic.
"""

from __future__ import annotations

import asyncio
import os
import time

import pytest
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ.get("DB_NAME", "test_database")


def _admin_id_and_db_and_render():
    """Small helper — returns (db, admin_id, render_flyer, cache_module).

    We construct a fresh Motor client per test so pytest-asyncio's
    per-test event loop teardown doesn't leave dangling coroutines.
    """
    from services.flyers import render_flyer
    from services.flyers import renderer as renderer_mod

    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    return client, db, render_flyer, renderer_mod


def test_repeat_render_hits_the_cache():
    """Two identical calls must return byte-identical PNGs and the
    second must be materially faster than the first."""
    async def _run():
        client, db, render_flyer, renderer_mod = _admin_id_and_db_and_render()
        try:
            row = await db.users.find_one({"is_admin": True}, {"_id": 0, "id": 1})
            admin_id = row["id"]
            # Isolate this test's cache footprint so an earlier run in
            # the same process doesn't skew the timings.
            renderer_mod._RENDER_CACHE.clear()
            pinned = {"admin_id": admin_id, "qr_code_id": "qr_TEST",
                      "flyer_id": "test", "headline": "CACHE-TEST"}

            t0 = time.perf_counter()
            a = await render_flyer(db, "founding_member_invite", "poster_a4", pinned)
            first_ms = (time.perf_counter() - t0) * 1000

            t0 = time.perf_counter()
            b = await render_flyer(db, "founding_member_invite", "poster_a4", pinned)
            second_ms = (time.perf_counter() - t0) * 1000

            assert a.content == b.content, "cached bytes must match"
            # Warm render is ~500 ms; a cache hit is dominated by the
            # Mongo audit-write and returns in well under 100 ms.
            assert second_ms < 250, (
                f"second call should be a fast cache hit (got {second_ms:.0f} ms; "
                f"first was {first_ms:.0f} ms)"
            )
        finally:
            client.close()

    asyncio.run(_run())


def test_field_change_bypasses_cache():
    """Changing a field must produce a fresh render (different bytes)."""
    async def _run():
        client, db, render_flyer, renderer_mod = _admin_id_and_db_and_render()
        try:
            row = await db.users.find_one({"is_admin": True}, {"_id": 0, "id": 1})
            admin_id = row["id"]
            renderer_mod._RENDER_CACHE.clear()
            base = {"admin_id": admin_id, "qr_code_id": "qr_TEST"}
            a = await render_flyer(db, "founding_member_invite", "poster_a4",
                                    {**base, "headline": "FIRST"})
            b = await render_flyer(db, "founding_member_invite", "poster_a4",
                                    {**base, "headline": "SECOND"})
            assert a.content != b.content, (
                "Different headline must render different bytes — the cache "
                "key includes every param."
            )
        finally:
            client.close()

    asyncio.run(_run())


def test_cache_ttl_expiry():
    """Entries past their TTL must be regenerated, not served stale."""
    async def _run():
        client, db, render_flyer, renderer_mod = _admin_id_and_db_and_render()
        try:
            row = await db.users.find_one({"is_admin": True}, {"_id": 0, "id": 1})
            admin_id = row["id"]
            renderer_mod._RENDER_CACHE.clear()

            pinned = {"admin_id": admin_id, "qr_code_id": "qr_TTL"}
            a = await render_flyer(db, "founding_member_invite", "poster_a4", pinned)
            # Fast-forward every entry so the next call misses.
            for k in list(renderer_mod._RENDER_CACHE.keys()):
                expires_at, payload = renderer_mod._RENDER_CACHE[k]
                renderer_mod._RENDER_CACHE[k] = (time.time() - 1, payload)
            t0 = time.perf_counter()
            b = await render_flyer(db, "founding_member_invite", "poster_a4", pinned)
            elapsed_ms = (time.perf_counter() - t0) * 1000
            # After TTL the render is a fresh compute (~500 ms), not a
            # ~5 ms cache hit.
            assert elapsed_ms > 100, (
                f"TTL expiry should force a real render, got {elapsed_ms:.0f} ms"
            )
            # Bytes still identical because the inputs haven't changed
            # AND qr_code_id was pinned.
            assert a.content == b.content
        finally:
            client.close()

    asyncio.run(_run())


def test_cache_lru_eviction_upper_bound():
    """The cache must never grow unbounded."""
    async def _run():
        client, db, render_flyer, renderer_mod = _admin_id_and_db_and_render()
        try:
            row = await db.users.find_one({"is_admin": True}, {"_id": 0, "id": 1})
            admin_id = row["id"]
            renderer_mod._RENDER_CACHE.clear()
            # Enqueue MAXLEN + 4 distinct keys — final size must ==
            # MAXLEN (oldest evicted first).
            n = renderer_mod._RENDER_CACHE_MAXLEN + 4
            for i in range(n):
                await render_flyer(
                    db, "founding_member_invite", "poster_a4",
                    {"admin_id": admin_id, "qr_code_id": f"qr_{i}",
                     "headline": f"LRU_{i}"},
                )
            assert len(renderer_mod._RENDER_CACHE) == renderer_mod._RENDER_CACHE_MAXLEN
        finally:
            client.close()

    asyncio.run(_run())


def test_static_pdf_engine_bypasses_cache():
    """Only the founding engine caches. The static-pdf engine is
    served straight off disk — it doesn't need our RAM cache."""
    async def _run():
        client, db, render_flyer, renderer_mod = _admin_id_and_db_and_render()
        try:
            renderer_mod._RENDER_CACHE.clear()
            # Attempt to render the community_notice static PDF — even
            # if the file isn't present in this env, we're only checking
            # that no entry was added to the founding cache.
            try:
                await render_flyer(db, "community_notice", "poster_a4", {})
            except (ValueError, FileNotFoundError):
                pass  # fine — behaviour we're asserting is cache-shape
            assert len(renderer_mod._RENDER_CACHE) == 0
        finally:
            client.close()

    asyncio.run(_run())
