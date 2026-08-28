"""Outreach FastAPI router (iter160a). Mounted inside cms_module."""
from __future__ import annotations
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from services.outreach.store import (
    OUTREACH_STATUSES, OUTREACH_CATEGORIES,
    upsert_org, get_org, list_orgs, delete_org,
    archive_org, restore_org,
    log_communication, mark_replied,
)


class OrgIn(BaseModel):
    organisation_name: str
    email: str
    contact_name: str = ""
    phone: str = ""
    category: str = ""
    tags: List[str] = Field(default_factory=list)
    suburb: str = ""
    state: str = ""
    notes: str = ""
    status: Optional[str] = None
    is_test: bool = False


class MarkRepliedIn(BaseModel):
    subject: Optional[str] = None
    body: Optional[str] = None
    campaign_id: Optional[str] = None
    direction: str = "inbound"


class LogCommIn(BaseModel):
    kind: str
    body: str = ""


def build_outreach_router(db, current_cms_admin) -> APIRouter:
    router = APIRouter(prefix="/outreach", tags=["outreach"])

    @router.get("/meta")
    async def _meta(admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        return {"statuses": OUTREACH_STATUSES, "categories": OUTREACH_CATEGORIES}

    @router.get("/organisations")
    async def _list(
        q: Optional[str] = None,
        category: Optional[str] = None,
        status: Optional[str] = None,
        archived: bool = Query(default=False),
        limit: int = Query(default=500, le=2000),
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        rows = await list_orgs(
            db, q=q, category=category, status=status,
            archived=archived, limit=limit,
        )
        return {"organisations": rows}

    @router.post("/organisations")
    async def _create(
        body: OrgIn,
        admin: dict = Depends(current_cms_admin),
    ):
        try:
            row = await upsert_org(
                db, body.model_dump(),
                created_by=admin.get("email") if isinstance(admin, dict) else None,
            )
        except ValueError as e:
            raise HTTPException(400, str(e))
        return row

    @router.get("/organisations/{org_id}")
    async def _get(org_id: str, admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        row = await get_org(db, org_id)
        if not row:
            raise HTTPException(404, "Organisation not found")
        return row

    @router.patch("/organisations/{org_id}")
    async def _update(
        org_id: str,
        body: OrgIn,
        admin: dict = Depends(current_cms_admin),
    ):
        existing = await get_org(db, org_id)
        if not existing:
            raise HTTPException(404, "Organisation not found")
        try:
            row = await upsert_org(
                db, body.model_dump(), org_id=org_id,
                created_by=admin.get("email") if isinstance(admin, dict) else None,
            )
        except ValueError as e:
            raise HTTPException(400, str(e))
        return row

    @router.delete("/organisations/{org_id}")
    async def _delete(org_id: str, admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        ok = await delete_org(db, org_id)
        if not ok:
            raise HTTPException(404, "Organisation not found")
        return {"ok": True}

    @router.post("/organisations/{org_id}/archive")
    async def _archive(org_id: str, admin: dict = Depends(current_cms_admin)):
        """Soft-archive an org. Preserves the entire record + history;
        excludes it from the active list and campaign audiences."""
        row = await archive_org(
            db, org_id,
            archived_by=admin.get("email") if isinstance(admin, dict) else None,
        )
        if not row:
            raise HTTPException(404, "Organisation not found")
        return row

    @router.post("/organisations/{org_id}/restore")
    async def _restore(org_id: str, admin: dict = Depends(current_cms_admin)):
        """Restore a soft-archived org, making it eligible again."""
        row = await restore_org(
            db, org_id,
            restored_by=admin.get("email") if isinstance(admin, dict) else None,
        )
        if not row:
            raise HTTPException(404, "Organisation not found")
        return row

    @router.post("/organisations/{org_id}/mark-replied")
    async def _mark_replied(
        org_id: str, body: MarkRepliedIn,
        admin: dict = Depends(current_cms_admin),
    ):
        row = await mark_replied(
            db, org_id=org_id,
            subject=body.subject, body=body.body,
            campaign_id=body.campaign_id, direction=body.direction,
            logged_by=admin.get("email") if isinstance(admin, dict) else None,
        )
        if not row:
            raise HTTPException(404, "Organisation not found")
        return row

    @router.post("/organisations/{org_id}/log")
    async def _log(
        org_id: str, body: LogCommIn,
        admin: dict = Depends(current_cms_admin),
    ):
        row = await log_communication(
            db, org_id=org_id, kind=body.kind, body=body.body,
            logged_by=admin.get("email") if isinstance(admin, dict) else None,
        )
        if not row:
            raise HTTPException(404, "Organisation not found")
        return row

    return router


__all__ = ["build_outreach_router"]
