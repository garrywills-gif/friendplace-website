"""YouBelong — Emergent-managed push notification relay.

Backend talks to https://integrations.emergentagent.com using the
EMERGENT_PUSH_KEY pod secret. The frontend NEVER touches that URL.

Key contract:
  * register_push  -> POST /api/v1/push/users/register
  * send_push      -> POST /api/v1/push/trigger      (recipients = list[user_id])

EMERGENT_PUSH_KEY is set to "placeholder" locally; the deploy pipeline swaps
it for a real key. send_push() failures must NEVER block the calling flow —
all call sites wrap in try/except.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger("youbelong.push")

PUSH_BASE_URL = "https://integrations.emergentagent.com"
PUSH_KEY = os.environ.get("EMERGENT_PUSH_KEY", "placeholder")

# Shared async client — created lazily because PUSH_KEY may be loaded after
# import-time via dotenv in server.py.
_client: Optional[httpx.AsyncClient] = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            base_url=PUSH_BASE_URL,
            headers={"X-Push-Key": os.environ.get("EMERGENT_PUSH_KEY", "placeholder")},
            timeout=10.0,
        )
    return _client


router = APIRouter()


class RegisterPushBody(BaseModel):
    user_id: str
    platform: str  # "android" | "ios"
    device_token: str


@router.post("/register-push", status_code=201)
async def register_push(body: RegisterPushBody):
    """Frontend posts the user's native push token here; we relay it upstream."""
    # Scaffold mode — no real key yet. Don't fail the frontend; just no-op.
    key = os.environ.get("EMERGENT_PUSH_KEY", "placeholder")
    if not key or key == "placeholder":
        logger.info("register-push skipped — EMERGENT_PUSH_KEY not configured yet")
        return {"status": "skipped", "reason": "push key not configured"}
    try:
        resp = await _get_client().post(
            "/api/v1/push/users/register",
            json=body.model_dump(),
        )
    except httpx.HTTPError as e:
        logger.warning("register-push upstream error: %s", e)
        raise HTTPException(502, "Push provider unavailable")
    if resp.status_code == 401:
        raise HTTPException(500, "EMERGENT_PUSH_KEY missing or invalid")
    if resp.status_code >= 500:
        raise HTTPException(502, "Push provider unavailable")
    if resp.status_code >= 400:
        logger.warning("register-push %s: %s", resp.status_code, resp.text)
        raise HTTPException(resp.status_code, "register-push failed")
    return {"status": "registered"}


async def send_push(
    recipients: list[str],
    data: dict,
    idempotency_key: Optional[str] = None,
) -> None:
    """Fire-and-(mostly)-forget push send.

    `recipients` are YouBelong user ids — SuprSend resolves tokens server-side.
    `data` MUST include `title` and `message`. Optional: `subtext`,
    `image_url` (https), `action_url` (becomes data.action_url on device).
    """
    if not recipients:
        return
    if len(recipients) > 100:
        raise ValueError("max 100 recipients per /trigger call; chunk before sending")
    if "title" not in data or "message" not in data:
        raise ValueError("data must include title and message")
    payload: dict = {"recipients": recipients, "data": data}
    if idempotency_key:
        payload["$idempotency_key"] = idempotency_key
    try:
        resp = await _get_client().post("/api/v1/push/trigger", json=payload)
    except httpx.HTTPError as e:
        logger.warning("send_push upstream error: %s", e)
        return
    if resp.status_code == 401:
        # Treat missing key as non-fatal in scaffold mode — deploy will inject it
        logger.info("send_push skipped — EMERGENT_PUSH_KEY not set yet")
        return
    if resp.status_code >= 500:
        logger.warning("send_push upstream 5xx: %s", resp.text)
        return
    if resp.status_code >= 400:
        logger.warning("send_push %s: %s", resp.status_code, resp.text)
