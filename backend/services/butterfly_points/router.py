"""FastAPI router for manual Butterfly Points recognition (iter164h).

Mounted under ``/api/cms/members/*`` alongside the existing member
management routes. Every write also lands in ``admin_log`` via the
shared audit helper.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from services.butterfly_points.store import (
    AWARD_MIN, AWARD_MAX, AWARD_SOFT_WARN,
    REASON_MIN, REASON_MAX, PERSONAS,
    award_points_manual,
    reverse_ledger_entry,
    list_ledger_for_member,
    build_recognition_message,
)
from services import audit as _audit


class AwardIn(BaseModel):
    amount: int = Field(..., ge=AWARD_MIN, le=AWARD_MAX)
    reason: str = Field(..., min_length=REASON_MIN, max_length=REASON_MAX)
    persona: str


class ReverseIn(BaseModel):
    reason: str = Field(..., min_length=REASON_MIN, max_length=REASON_MAX)


class PreviewIn(BaseModel):
    amount: int = Field(..., ge=AWARD_MIN, le=AWARD_MAX)
    reason: str = Field(..., min_length=REASON_MIN, max_length=REASON_MAX)
    persona: str


def build_points_router(
    db, current_cms_admin,
    *,
    award_points_impl,          # server.award_points
    push_notification_impl,     # server.push_notification
) -> APIRouter:
    """Injecting the two server-side callables keeps this router free of
    a circular import against ``server.py``."""
    router = APIRouter(prefix="/members", tags=["butterfly-points"])

    def _reject_persona(persona: str) -> None:
        if persona not in PERSONAS:
            raise HTTPException(400, f"persona must be one of {list(PERSONAS)}")

    async def _require_member(user_id: str) -> Dict[str, Any]:
        row = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "first_name": 1, "display_name": 1, "email": 1})
        if not row:
            raise HTTPException(404, "Member not found")
        return row

    @router.get("/butterfly-points/policy")
    async def _policy(admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        """Small constants block for the CMS UI so the form + validation
        stays in lockstep with the backend."""
        return {
            "amount_min":      AWARD_MIN,
            "amount_max":      AWARD_MAX,
            "amount_soft_warn": AWARD_SOFT_WARN,
            "reason_min":      REASON_MIN,
            "reason_max":      REASON_MAX,
            "personas":        list(PERSONAS),
        }

    @router.post("/butterfly-points/preview")
    async def _preview(body: PreviewIn, admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        """What the admin sees in the modal preview MUST match what the
        member sees in their inbox — same builder, same wording."""
        _reject_persona(body.persona)
        return build_recognition_message(
            amount=int(body.amount),
            reason=body.reason,
            persona=body.persona,
        )

    @router.get("/{user_id}/butterfly-points")
    async def _list(user_id: str, admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        await _require_member(user_id)
        rows = await list_ledger_for_member(db, user_id=user_id)
        # Denormalised current balance from the user doc.
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "points": 1, "badges": 1})
        return {
            "user_id":      user_id,
            "points":       int((u or {}).get("points") or 0),
            "badges":       list((u or {}).get("badges") or []),
            "ledger":       rows,
        }

    @router.post("/{user_id}/butterfly-points/award")
    async def _award(
        user_id: str, body: AwardIn,
        admin: dict = Depends(current_cms_admin),
    ):
        _reject_persona(body.persona)
        member = await _require_member(user_id)
        try:
            row = await award_points_manual(
                db,
                user_id=user_id,
                amount=int(body.amount),
                reason=body.reason,
                persona=body.persona,
                admin_id=admin.get("id") if isinstance(admin, dict) else None,
                admin_email=admin.get("email") if isinstance(admin, dict) else None,
                admin_name=(admin.get("display_name") or admin.get("email"))
                            if isinstance(admin, dict) else None,
                award_points_impl=award_points_impl,
                push_notification_impl=push_notification_impl,
            )
        except ValueError as e:
            raise HTTPException(400, str(e))
        # Cross-cutting admin audit trail.
        await _audit.log_admin_action(
            db, admin=admin, action="member.points.award",
            target_type="member", target_id=user_id, reason=body.reason,
            metadata={
                "ledger_id": row["id"],
                "amount":    int(body.amount),
                "persona":   body.persona,
                "member_first_name": member.get("first_name"),
            },
        )
        return row

    @router.post("/{user_id}/butterfly-points/{ledger_id}/reverse")
    async def _reverse(
        user_id: str, ledger_id: str, body: ReverseIn,
        admin: dict = Depends(current_cms_admin),
    ):
        await _require_member(user_id)
        try:
            out = await reverse_ledger_entry(
                db,
                ledger_id=ledger_id,
                reason=body.reason,
                admin_id=admin.get("id") if isinstance(admin, dict) else None,
                admin_email=admin.get("email") if isinstance(admin, dict) else None,
                admin_name=(admin.get("display_name") or admin.get("email"))
                            if isinstance(admin, dict) else None,
                award_points_impl=award_points_impl,
            )
        except LookupError as e:
            raise HTTPException(404, str(e))
        except ValueError as e:
            raise HTTPException(400, str(e))
        # Guardrail: the target of the reversal MUST belong to the URL
        # user_id (defence-in-depth against a mis-typed id).
        if (out.get("reversal") or {}).get("user_id") != user_id:
            raise HTTPException(400, "ledger entry does not belong to this member")
        await _audit.log_admin_action(
            db, admin=admin, action="member.points.reverse",
            target_type="member", target_id=user_id, reason=body.reason,
            metadata={
                "ledger_id":  ledger_id,
                "reversal_id": (out.get("reversal") or {}).get("id"),
                "amount":     (out.get("reversal") or {}).get("amount"),
            },
        )
        return out

    return router


__all__ = ["build_points_router"]
