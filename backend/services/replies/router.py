"""FastAPI router for inbound replies (iter160b).

Mounted under ``/api/cms/replies/*``.

Endpoints
---------
GET    /cms/replies                     → list w/ filters (unread, resolved, q, campaign_id)
POST   /cms/replies                     → manually log a reply
GET    /cms/replies/unread-count        → for sidebar badge
GET    /cms/replies/{id}                → get one
PATCH  /cms/replies/{id}/read           → toggle read state
PATCH  /cms/replies/{id}/resolve        → toggle resolved state
DELETE /cms/replies/{id}                → delete a reply
"""
from __future__ import annotations
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from services.replies.store import (
    REPLY_CHANNELS,
    create_reply, list_replies, get_reply,
    mark_read, mark_resolved, delete_reply,
    unread_count, awaiting_count,
)


class ReplyIn(BaseModel):
    from_email: str
    from_name: str = ""
    subject: str = ""
    body: str = ""
    channel: str = "email"
    campaign_id: Optional[str] = None
    related_send_id: Optional[str] = None
    received_at: Optional[str] = None
    notes: str = ""


class ReadIn(BaseModel):
    read: bool = True


class ResolveIn(BaseModel):
    resolved: bool = True


def build_replies_router(db, current_cms_admin) -> APIRouter:
    router = APIRouter(prefix="/replies", tags=["replies"])

    @router.get("")
    async def _list(
        read: Optional[bool] = None,
        resolved: Optional[bool] = None,
        campaign_id: Optional[str] = None,
        q: Optional[str] = None,
        limit: int = Query(default=200, le=1000),
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ) -> Dict[str, Any]:
        rows = await list_replies(
            db, read=read, resolved=resolved,
            campaign_id=campaign_id, q=q, limit=limit,
        )
        return {
            "replies":        rows,
            "unread_count":   await unread_count(db),
            "awaiting_count": await awaiting_count(db),
        }

    @router.get("/unread-count")
    async def _unread(admin: dict = Depends(current_cms_admin)) -> Dict[str, int]:  # noqa: ARG001
        return {
            "unread_count":   await unread_count(db),
            "awaiting_count": await awaiting_count(db),
        }

    @router.post("")
    async def _create(
        body: ReplyIn, admin: dict = Depends(current_cms_admin),
    ) -> Dict[str, Any]:
        try:
            row = await create_reply(
                db,
                from_email=body.from_email,
                from_name=body.from_name,
                subject=body.subject,
                body=body.body,
                channel=body.channel,
                campaign_id=body.campaign_id,
                related_send_id=body.related_send_id,
                received_at=body.received_at,
                notes=body.notes,
                created_by=admin.get("email") if isinstance(admin, dict) else None,
            )
        except ValueError as e:
            raise HTTPException(400, str(e))
        return row

    @router.get("/{reply_id}")
    async def _get(reply_id: str, admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        row = await get_reply(db, reply_id)
        if not row:
            raise HTTPException(404, "Reply not found")
        return row

    @router.patch("/{reply_id}/read")
    async def _read(
        reply_id: str, body: ReadIn,
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        row = await mark_read(db, reply_id, read=body.read)
        if not row:
            raise HTTPException(404, "Reply not found")
        return row

    @router.patch("/{reply_id}/resolve")
    async def _resolve(
        reply_id: str, body: ResolveIn,
        admin: dict = Depends(current_cms_admin),
    ):
        row = await mark_resolved(
            db, reply_id, resolved=body.resolved,
            resolved_by=admin.get("email") if isinstance(admin, dict) else None,
        )
        if not row:
            raise HTTPException(404, "Reply not found")
        return row

    @router.delete("/{reply_id}")
    async def _delete(reply_id: str, admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        ok = await delete_reply(db, reply_id)
        if not ok:
            raise HTTPException(404, "Reply not found")
        return {"ok": True}

    @router.get("/meta/channels")
    async def _channels(admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        return {"channels": list(REPLY_CHANNELS)}

    return router


__all__ = ["build_replies_router"]
