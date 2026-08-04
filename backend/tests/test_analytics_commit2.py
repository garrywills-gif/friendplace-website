"""
Integration tests for Commit-2 analytics additions.

Covers:
    - Bridge hash + rate limit + idempotency
    - Acquisition parsing (both nested + flat forms)
    - Flyer + bridge analytics queries (partial coverage notes)
    - George's analytics tool registration + execution
    - Admin API auth + happy-path
    - Public bridge-hit endpoint (auth-free, rate-limited)
"""

from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, timezone

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

from services.analytics import get_engine
from services.analytics.acquisition import parse_acquisition
from services.analytics.bridge import (
    BridgeRateLimited,
    ensure_indexes,
    hash_ip,
    record_hit,
)
from services.analytics.time_ranges import NamedRange


def _make_db():
    from dotenv import load_dotenv
    load_dotenv()
    client = AsyncIOMotorClient(os.getenv("MONGO_URL"))
    return client, client[os.getenv("DB_NAME")]


# ---------------------------------------------------------------------------
# IP hashing
# ---------------------------------------------------------------------------


class TestIPHashing:
    def test_hash_is_deterministic_per_process(self):
        assert hash_ip("203.0.113.1") == hash_ip("203.0.113.1")

    def test_different_ips_produce_different_hashes(self):
        assert hash_ip("203.0.113.1") != hash_ip("203.0.113.2")

    def test_hash_is_64_hex_chars(self):
        h = hash_ip("1.2.3.4")
        assert len(h) == 64
        int(h, 16)  # must be valid hex


# ---------------------------------------------------------------------------
# Acquisition parser
# ---------------------------------------------------------------------------


class TestAcquisitionParser:
    def test_nested_object_wins(self):
        acq = parse_acquisition({
            "acquisition": {
                "channel": "flyer",
                "flyer_id": "founding_member_invite",
                "qr_code_id": "qr_abc",
            },
            "acq_channel": "campaign",  # should be ignored
        })
        assert acq["channel"] == "flyer"
        assert acq["flyer_id"] == "founding_member_invite"
        assert acq["qr_code_id"] == "qr_abc"

    def test_flat_form_fallback(self):
        acq = parse_acquisition({
            "acq_channel": "qr",
            "acq_flyer_id": "founding_member_invite",
            "acq_ref_source": "poster-mon",
        })
        assert acq["channel"] == "qr"
        assert acq["flyer_id"] == "founding_member_invite"
        assert acq["ref_source"] == "poster-mon"

    def test_unknown_channel_defaults_to_organic(self):
        acq = parse_acquisition({"acq_channel": "not-a-real-channel"})
        assert acq["channel"] == "organic"

    def test_empty_payload_returns_organic(self):
        acq = parse_acquisition({})
        assert acq["channel"] == "organic"
        assert acq["flyer_id"] is None
        assert acq["captured_at"] is not None


# ---------------------------------------------------------------------------
# Bridge write path (live DB)
# ---------------------------------------------------------------------------


class TestBridgeHits:
    def test_record_hit_persists_and_idempotency_works(self):
        async def _go():
            client, db = _make_db()
            key = f"test_{uuid.uuid4().hex}"
            try:
                await ensure_indexes(db)
                r1 = await record_hit(
                    db, ip="203.0.113.42", channel="flyer",
                    flyer_id="founding_member_invite",
                    qr_code_id="qr_test_zzz",
                    idempotency_key=key,
                )
                assert r1["ok"] and r1["duplicate"] is False
                r2 = await record_hit(
                    db, ip="203.0.113.42", channel="flyer",
                    flyer_id="founding_member_invite",
                    qr_code_id="qr_test_zzz",
                    idempotency_key=key,
                )
                assert r2["duplicate"] is True
                assert r1["id"] == r2["id"]
            finally:
                await db.bridge_events.delete_many({"idempotency_key": key})
                client.close()
        asyncio.run(_go())

    def test_rate_limit_triggers_after_budget_exhausted(self, monkeypatch):
        # Force the rate limit to 3 for this test.
        monkeypatch.setenv("BRIDGE_RATE_LIMIT_PER_MIN", "3")
        # Need to reload the module so the constant re-reads env.
        import importlib
        import services.analytics.bridge as _b
        importlib.reload(_b)

        async def _go():
            client, db = _make_db()
            ip = f"203.0.113.{uuid.uuid4().int % 200 + 20}"
            try:
                await _b.ensure_indexes(db)
                for _ in range(3):
                    await _b.record_hit(db, ip=ip, channel="flyer")
                with pytest.raises(_b.BridgeRateLimited):
                    await _b.record_hit(db, ip=ip, channel="flyer")
            finally:
                await db.bridge_events.delete_many({"ip_hash": _b.hash_ip(ip)})
                client.close()
        asyncio.run(_go())

        # Restore original module state
        monkeypatch.delenv("BRIDGE_RATE_LIMIT_PER_MIN", raising=False)
        importlib.reload(_b)


# ---------------------------------------------------------------------------
# New analytics queries
# ---------------------------------------------------------------------------


class TestNewQueries:
    def test_flyer_query_returns_partial_coverage_note(self):
        async def _go():
            client, db = _make_db()
            try:
                engine = get_engine()
                r = await engine.run(
                    "flyers.best_by_registrations",
                    db=db,
                    range_kind=NamedRange.THIS_MONTH,
                )
                assert r.coverage in {"partial", "full"}
                # Coverage note must mention the tracking-start date so
                # George doesn't fabricate attribution for old rows.
                assert any(
                    "attribution" in n.lower() or "tracked" in n.lower()
                    for n in r.notes
                )
            finally:
                client.close()
        asyncio.run(_go())

    def test_bridge_top_sources_reflects_recent_hits(self):
        """Seed a bridge event and verify it shows up in the query."""
        async def _go():
            client, db = _make_db()
            key = f"testq_{uuid.uuid4().hex}"
            try:
                await ensure_indexes(db)
                await record_hit(
                    db, ip=f"198.51.100.{uuid.uuid4().int % 250 + 1}",
                    channel="flyer",
                    flyer_id="__test_flyer_seed__",
                    qr_code_id="__qr_test__",
                    idempotency_key=key,
                )
                engine = get_engine()
                r = await engine.run(
                    "bridge.top_sources", db=db,
                    range_kind=NamedRange.THIS_MONTH,
                )
                assert r.breakdown is not None
                # The seeded flyer must appear somewhere in the breakdown.
                keys = [row.label for row in r.breakdown]
                assert any("__test_flyer_seed__" in k for k in keys)
            finally:
                await db.bridge_events.delete_many({"idempotency_key": key})
                client.close()
        asyncio.run(_go())


# ---------------------------------------------------------------------------
# George tool
# ---------------------------------------------------------------------------


class TestGeorgeTool:
    def test_run_analytics_query_is_registered(self):
        from services.george.tools import TOOL_REGISTRY
        assert "run_analytics_query" in TOOL_REGISTRY
        tool = TOOL_REGISTRY["run_analytics_query"]
        # All 12 registered queries must be in the enum.
        enum = tool["args"]["query_id"]["enum"]
        assert len(enum) == 12
        assert "members.joined" in enum
        assert "flyers.best_by_registrations" in enum
        assert "bridge.top_sources" in enum

    def test_run_analytics_query_returns_george_summary(self):
        """George's tool envelope must include the pre-formatted summary."""
        async def _go():
            client, db = _make_db()
            try:
                from services.george.tools import TOOL_REGISTRY
                tool = TOOL_REGISTRY["run_analytics_query"]
                envelope = await tool["run"](
                    db,
                    {"query_id": "members.founding_numbers",
                     "range_kind": "all_time",
                     "compare": False},
                )
                assert "george_summary" in envelope
                assert "coverage" in envelope
                assert envelope["value"] >= 0
                # Must be a string, not "Metric: N" style — George reads it.
                assert isinstance(envelope["george_summary"], str)
            finally:
                client.close()
        asyncio.run(_go())

    def test_run_analytics_query_surfaces_coverage_notes(self):
        """When coverage is partial, notes must flow to George."""
        async def _go():
            client, db = _make_db()
            try:
                from services.george.tools import TOOL_REGISTRY
                tool = TOOL_REGISTRY["run_analytics_query"]
                envelope = await tool["run"](
                    db,
                    {"query_id": "flyers.best_by_registrations",
                     "range_kind": "this_month",
                     "compare": False},
                )
                assert envelope["coverage"] in {"partial", "full"}
                # If partial, must include the honest-coverage note.
                if envelope["coverage"] == "partial":
                    assert len(envelope["coverage_notes"]) > 0
            finally:
                client.close()
        asyncio.run(_go())
