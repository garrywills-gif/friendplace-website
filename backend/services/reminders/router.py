"""iter162 — Reminders REST router.

Mounted under /api/cms/reminders/* by cms_module.py. Admin auth required.
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .store import (
    complete_reminder,
    create_reminder,
    delete_reminder,
    get_reminder,
    list_reminders,
    update_reminder,
    REMINDER_RECURRENCE,
)


class ReminderCreateIn(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    note: Optional[str] = Field(default="", max_length=1000)
    due_at: str = Field(..., description="ISO 8601 UTC (accepts trailing Z or offset)")
    recurrence: str = Field(default="none")


class ReminderUpdateIn(BaseModel):
    title: Optional[str] = None
    note: Optional[str] = None
    due_at: Optional[str] = None
    recurrence: Optional[str] = None
    status: Optional[str] = None


def build_reminders_router(db: Any, current_cms_admin) -> APIRouter:
    router = APIRouter(prefix="/reminders", tags=["reminders"])

    @router.get("")
    async def _list(status: Optional[str] = None, limit: int = 200, _=Depends(current_cms_admin)):
        try:
            items = await list_reminders(db, status=status, limit=limit)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return {"items": items, "count": len(items)}

    @router.post("")
    async def _create(payload: ReminderCreateIn, admin=Depends(current_cms_admin)):
        try:
            doc = await create_reminder(
                db,
                title=payload.title,
                note=payload.note or "",
                due_at=payload.due_at,
                recurrence=payload.recurrence,
                created_by=(admin or {}).get("email") if isinstance(admin, dict) else None,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return doc

    @router.get("/{reminder_id}")
    async def _get(reminder_id: str, _=Depends(current_cms_admin)):
        r = await get_reminder(db, reminder_id)
        if not r:
            raise HTTPException(status_code=404, detail="reminder not found")
        return r

    @router.patch("/{reminder_id}")
    async def _update(reminder_id: str, payload: ReminderUpdateIn, _=Depends(current_cms_admin)):
        try:
            r = await update_reminder(
                db, reminder_id,
                title=payload.title, note=payload.note,
                due_at=payload.due_at, recurrence=payload.recurrence, status=payload.status,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if not r:
            raise HTTPException(status_code=404, detail="reminder not found")
        return r

    @router.post("/{reminder_id}/complete")
    async def _complete(reminder_id: str, _=Depends(current_cms_admin)):
        r = await complete_reminder(db, reminder_id)
        if not r:
            raise HTTPException(status_code=404, detail="reminder not found")
        return r

    @router.delete("/{reminder_id}")
    async def _delete(reminder_id: str, _=Depends(current_cms_admin)):
        ok = await delete_reminder(db, reminder_id)
        if not ok:
            raise HTTPException(status_code=404, detail="reminder not found")
        return {"ok": True}

    @router.get("/_meta/options")
    async def _meta(_=Depends(current_cms_admin)):
        return {"recurrences": REMINDER_RECURRENCE}

    return router
