"""
Bridge-hit telemetry.

Records QR-scan / flyer-landing events into ``bridge_events`` so we can
answer "which flyer generated the most traffic?" and "which QR source
converts best?". Design constraints:

- **No raw IPs**: we hash the visitor IP with a rotating server-side salt
  so we can count unique visitors without ever persisting PII.
- **Rate limited**: 10 hits / minute / IP-hash. Prevents accidental
  scan-loop spam or malicious flooding of the analytics store.
- **Idempotent-friendly**: each hit produces a unique event id; upstream
  callers can pass an ``idempotency_key`` to dedupe repeated pings.
- **Attribution-first**: every event carries ``flyer_id``,
  ``qr_code_id``, ``campaign_id`` and ``ref_source`` when available, so
  the downstream analytics queries can group by any of them.

The public HTTP endpoint (``POST /api/public/bridge/hit``) is wired up
in ``services.analytics.public_router``.
"""

from __future__ import annotations

import hashlib
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from motor.motor_asyncio import AsyncIOMotorDatabase

logger = logging.getLogger("friendplace.analytics.bridge")


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

#: MongoDB collection storing bridge events.
COLL_BRIDGE_EVENTS: str = "bridge_events"

#: Server-side salt used to hash visitor IPs. Set via env var
#: ``BRIDGE_SALT``. Rotate periodically by generating a new random value
#: (``openssl rand -hex 32``) and redeploying — existing hashes will no
#: longer match new visitor hashes, so unique-visitor counts reset. That
#: is the desired behaviour of rotation.
#:
#: If the env var is missing we deliberately DO NOT fall back to a
#: hard-coded default: that would silently make every deployment's
#: hashes correlatable with every other deployment's. Instead we fall
#: back to a per-process random value and log a warning so ops notices.
_BRIDGE_SALT: str = os.getenv("BRIDGE_SALT") or ""
if not _BRIDGE_SALT:
    _BRIDGE_SALT = uuid.uuid4().hex
    logger.warning(
        "BRIDGE_SALT env var is not set — using a per-process random salt. "
        "Set BRIDGE_SALT in production for stable IP-hash correlation."
    )

#: Rate-limit budget. Requests exceeding this from the same IP-hash in
#: any 60-second window are rejected with HTTP 429.
RATE_LIMIT_PER_MINUTE: int = int(os.getenv("BRIDGE_RATE_LIMIT_PER_MIN", "10"))

#: Valid ``channel`` values. Enforced at write-time so upstream callers
#: can't invent new channels that would confuse the top-sources query.
ALLOWED_CHANNELS: set[str] = {
    "flyer",     # printed flyer QR
    "qr",        # generic QR (not tied to a specific flyer template)
    "campaign",  # email campaign link
    "web",       # organic website navigation
    "referral",  # explicit ref link (utm_source=…)
    "organic",   # unknown / direct traffic (default when nothing else matches)
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def hash_ip(ip: str) -> str:
    """Return a stable SHA-256 hex digest of ``ip + BRIDGE_SALT``.

    The output is a 64-char hex string; the raw IP never leaves this
    process. Rotating ``BRIDGE_SALT`` cycles every visitor to a new
    hash (documented behaviour of the "rotate" operation).
    """
    payload = (ip or "").strip() + "|" + _BRIDGE_SALT
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def coerce_channel(raw: Optional[str]) -> str:
    """Return a validated channel value, defaulting to ``organic``."""
    channel = (raw or "").strip().lower()
    return channel if channel in ALLOWED_CHANNELS else "organic"


# ---------------------------------------------------------------------------
# Rate limiting (MongoDB-backed so it survives worker restarts)
# ---------------------------------------------------------------------------


async def _within_rate_limit(db: AsyncIOMotorDatabase, ip_hash: str) -> bool:
    """Return True if this IP-hash is under the per-minute budget."""
    cutoff_iso = (_now() - timedelta(minutes=1)).isoformat()
    recent = await db[COLL_BRIDGE_EVENTS].count_documents(
        {"ip_hash": ip_hash, "at": {"$gt": cutoff_iso}}
    )
    return recent < RATE_LIMIT_PER_MINUTE


# ---------------------------------------------------------------------------
# Write path
# ---------------------------------------------------------------------------


async def record_hit(
    db: AsyncIOMotorDatabase,
    *,
    ip: str,
    channel: Optional[str] = None,
    flyer_id: Optional[str] = None,
    qr_code_id: Optional[str] = None,
    campaign_id: Optional[str] = None,
    ref_source: Optional[str] = None,
    user_agent: Optional[str] = None,
    referer: Optional[str] = None,
    idempotency_key: Optional[str] = None,
) -> dict[str, Any]:
    """Persist a single bridge event.

    Returns a dict of the form::

        {"ok": True, "id": "<event_id>", "duplicate": False}

    Raises ``BridgeRateLimited`` if the caller has exceeded the rate
    budget for the current minute.
    """
    ip_hash = hash_ip(ip)

    if not await _within_rate_limit(db, ip_hash):
        raise BridgeRateLimited(
            f"Rate limit exceeded: {RATE_LIMIT_PER_MINUTE} hits/min per visitor."
        )

    # Idempotency: if the caller supplied the same key within the last
    # 24 h we return the existing doc. Prevents scan-loops from adding
    # dozens of near-identical rows when the visitor's browser is
    # confused about caching.
    if idempotency_key:
        dedup_cutoff = (_now() - timedelta(hours=24)).isoformat()
        existing = await db[COLL_BRIDGE_EVENTS].find_one(
            {
                "idempotency_key": idempotency_key,
                "at": {"$gt": dedup_cutoff},
            },
            {"_id": 0, "id": 1},
        )
        if existing:
            return {"ok": True, "id": existing["id"], "duplicate": True}

    doc: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "at": _now_iso(),
        "channel": coerce_channel(channel),
        "flyer_id": (flyer_id or "").strip() or None,
        "qr_code_id": (qr_code_id or "").strip() or None,
        "campaign_id": (campaign_id or "").strip() or None,
        "ref_source": (ref_source or "").strip()[:120] or None,
        "ip_hash": ip_hash,
        "user_agent": (user_agent or "")[:280] or None,
        "referer": (referer or "")[:280] or None,
        "idempotency_key": idempotency_key or None,
        "converted_to_registration_id": None,  # written later when the
        # visitor actually registers — see mark_conversion() below.
    }
    await db[COLL_BRIDGE_EVENTS].insert_one(dict(doc))
    return {"ok": True, "id": doc["id"], "duplicate": False}


async def mark_conversion(
    db: AsyncIOMotorDatabase,
    *,
    qr_code_id: Optional[str],
    flyer_id: Optional[str],
    campaign_id: Optional[str],
    ref_source: Optional[str],
    registration_id: str,
) -> Optional[str]:
    """Link the most recent unconverted bridge_event for this
    (flyer/qr/campaign) to a newly-created registration id.

    Called from the interest-registration write path so bridge_events
    know which hits actually converted. Best-effort: if we can't find a
    matching hit (e.g. attribution came in via UTM but no bridge ping)
    we just skip.

    Returns the linked event id, or None if no match was found.
    """
    filters: list[dict[str, Any]] = []
    if qr_code_id:
        filters.append({"qr_code_id": qr_code_id})
    if flyer_id:
        filters.append({"flyer_id": flyer_id})
    if campaign_id:
        filters.append({"campaign_id": campaign_id})
    if ref_source:
        filters.append({"ref_source": ref_source})
    if not filters:
        return None

    query = {"$or": filters, "converted_to_registration_id": None}
    doc = await db[COLL_BRIDGE_EVENTS].find_one_and_update(
        query,
        {"$set": {"converted_to_registration_id": registration_id}},
        sort=[("at", -1)],
        projection={"_id": 0, "id": 1},
    )
    return doc["id"] if doc else None


# ---------------------------------------------------------------------------
# Indexes (idempotent — safe to call on every boot)
# ---------------------------------------------------------------------------


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    """Create the indexes bridge queries rely on."""
    coll = db[COLL_BRIDGE_EVENTS]
    await coll.create_index("id", unique=True)
    await coll.create_index("at")
    await coll.create_index("ip_hash")
    await coll.create_index("flyer_id")
    await coll.create_index("campaign_id")
    await coll.create_index("qr_code_id")
    await coll.create_index("channel")
    await coll.create_index("idempotency_key", sparse=True)


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class BridgeRateLimited(Exception):
    """Raised by ``record_hit`` when the caller is over budget."""


__all__ = [
    "COLL_BRIDGE_EVENTS",
    "ALLOWED_CHANNELS",
    "RATE_LIMIT_PER_MINUTE",
    "BridgeRateLimited",
    "hash_ip",
    "coerce_channel",
    "record_hit",
    "mark_conversion",
    "ensure_indexes",
]
