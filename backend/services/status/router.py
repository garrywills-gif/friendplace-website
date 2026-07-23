"""FastAPI router for presence/status endpoints.

Wire-format-only. All business logic lives in service.py.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from services.status import service as svc


class SetManualBody(BaseModel):
    manual_status: str | None = Field(
        default=None,
        description="One of 'looking' | 'happy' | 'busy' | null. null clears.",
    )


def build_status_router(db, current_user):
    """Return a FastAPI APIRouter wired to the given db and auth dep.

    `current_user` is the async dep that returns the authenticated user
    doc (matches the pattern used elsewhere in server.py).
    """
    r = APIRouter(prefix="/status", tags=["status"])

    @r.get("/me")
    async def status_me(me: dict = Depends(current_user)):
        return await svc.get_status(db, me["id"])

    @r.patch("/me")
    async def status_me_patch(body: SetManualBody, me: dict = Depends(current_user)):
        try:
            return await svc.set_manual(db, me["id"], body.manual_status)
        except ValueError as e:
            raise HTTPException(400, str(e))

    @r.post("/heartbeat")
    async def status_heartbeat(me: dict = Depends(current_user)):
        await svc.heartbeat(db, me["id"])
        return {"ok": True}

    @r.get("/looking")
    async def status_looking(
        me: dict = Depends(current_user),
        scope: str = Query("nearby", pattern="^(nearby|friends|all)$"),
    ):
        rows = await svc.list_looking(db, me["id"], scope=scope)
        return {"items": rows, "scope": scope}

    @r.get("/for-users")
    async def status_for_users(
        me: dict = Depends(current_user),
        ids: str = Query("", description="Comma-separated user IDs, max 50"),
    ):
        id_list = [x.strip() for x in ids.split(",") if x.strip()]
        if len(id_list) > 50:
            raise HTTPException(400, "max 50 ids per request")
        # Bump the requester's own heartbeat while we're here — cheap
        # and keeps them online in the eyes of others without an extra
        # round-trip.
        await svc.heartbeat(db, me["id"])
        return {"statuses": await svc.status_for_users(db, id_list)}

    return r
