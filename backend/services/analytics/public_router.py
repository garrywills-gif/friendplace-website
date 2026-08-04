"""
Public bridge-hit endpoint.

Unauthenticated, rate-limited, IP-hashed. Called by flyer QR landing
pages BEFORE the visitor reaches the registration form so we can
measure top-of-funnel traffic per (flyer_id / qr_code_id / campaign_id).
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from .bridge import BridgeRateLimited, record_hit

logger = logging.getLogger("friendplace.analytics.public")


class BridgeHitBody(BaseModel):
    channel: Optional[str] = None
    flyer_id: Optional[str] = None
    qr_code_id: Optional[str] = None
    campaign_id: Optional[str] = None
    ref_source: Optional[str] = None
    idempotency_key: Optional[str] = Field(
        None,
        description=(
            "Optional client-provided key. Repeat hits with the same "
            "key within 24 h return the original event id instead of "
            "creating duplicates."
        ),
    )


def _extract_ip(request: Request) -> str:
    """Prefer X-Forwarded-For (Kubernetes ingress) then fall back."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip() or "unknown"
    if request.client:
        return request.client.host or "unknown"
    return "unknown"


def build_bridge_public_router(db) -> APIRouter:
    router = APIRouter(tags=["bridge"])

    @router.post("/public/bridge/hit")
    async def bridge_hit(body: BridgeHitBody, request: Request):
        """Log a single bridge event.

        Returns::

            {"ok": true, "id": "<event_id>", "duplicate": false}

        Errors:
            429 — rate-limited (>10 hits/min for this visitor)
        """
        ip = _extract_ip(request)
        ua = request.headers.get("user-agent")
        ref = request.headers.get("referer")

        try:
            return await record_hit(
                db,
                ip=ip,
                channel=body.channel,
                flyer_id=body.flyer_id,
                qr_code_id=body.qr_code_id,
                campaign_id=body.campaign_id,
                ref_source=body.ref_source,
                user_agent=ua,
                referer=ref,
                idempotency_key=body.idempotency_key,
            )
        except BridgeRateLimited as exc:
            raise HTTPException(429, str(exc)) from exc
        except Exception:
            logger.exception("bridge_hit failed")
            raise HTTPException(500, "Failed to record bridge hit")

    return router


__all__ = ["build_bridge_public_router"]
