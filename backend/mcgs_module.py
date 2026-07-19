"""MCGS router \u2014 API surface for The Bridge.

Endpoints under /api/mcgs/* and /api/george/*.

Auth: all routes require a valid CMS admin bearer token. Decoded via
the same helper `cms_module` uses so we share one identity source.

Design refs:
- `/app/memory/mcgs-phase1-plan.md` \u00a73 (API surface)
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from services.mcgs import (
    SignalError,
    compute_counts,
    get_case,
    get_signal,
    list_cases,
    list_signals,
    transition_case,
    transition_signal,
    assign_case,
)
from services.mcgs.events import signal_events
from services.mcgs.rhythms import (
    get_rhythm_settings,
    update_rhythm_settings,
    record_admin_heartbeat,
    compose_morning_briefing,
    compose_midday_pulse,
    compose_eod_wrapup,
    scan_milestones,
    reschedule_admin,
    scheduler_status,
    deliver_briefing,
)
from services.mcgs.rhythms.models import COLL_BRIEFINGS
from services.mcgs.rhythms.settings import RhythmSettingsError
from services.george.event_creation import (
    start_event_conversation,
    take_conversation_turn,
    get_event_session,
    approve_event_draft,
    cancel_event_session,
    actor_george_presence,
)
from services.george import grounded_chat_stream

log = logging.getLogger("friendplace.mcgs.api")

bearer = HTTPBearer(auto_error=False)


# ---------------------------------------------------------------------------
# Pydantic input schemas
# ---------------------------------------------------------------------------

class SignalStateIn(BaseModel):
    to: str = Field(..., description="Target state")
    notes: Optional[str] = None
    snoozed_until: Optional[str] = None
    resolved_action: Optional[str] = None


class CaseStateIn(BaseModel):
    to: str
    notes: Optional[str] = None
    resolved_action: Optional[str] = None


class CaseAssignIn(BaseModel):
    assignee_id: Optional[str] = None


class TicketReplyIn(BaseModel):
    ticket_id: str
    draft: str = Field(..., min_length=1, max_length=8000)
    confirmed: bool = Field(..., description="Must be true; the human explicit-confirm gate")
    george_involved: bool = False
    george_reasoning: Optional[str] = None
    case_id: Optional[str] = None


class SubmissionDecisionIn(BaseModel):
    submission_id: str
    decision: str = Field(..., description="approve | reject | changes_requested")
    confirmed: bool = Field(..., description="Must be true; the human explicit-confirm gate")
    note: Optional[str] = None
    george_involved: bool = False
    george_reasoning: Optional[str] = None
    case_id: Optional[str] = None


class GeorgeChatIn(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    chat_id: Optional[str] = None
    scope: str = Field("mcgs")


class TicketReplyProposalIn(BaseModel):
    ticket_id: str


class SubmissionDecisionProposalIn(BaseModel):
    submission_id: str
    decision: str


class TTSIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=3800)
    voice: str = Field("nova")
    speed: float = Field(0.95, ge=0.5, le=1.5)


class RhythmSettingsIn(BaseModel):
    """Partial-patch of an admin's Rhythm settings. Only known fields are stored."""
    timezone: Optional[str] = None
    morning_weekday_at: Optional[str] = None
    morning_weekend_at: Optional[str] = None
    midday_at: Optional[str] = None
    eod_at: Optional[str] = None
    eod_inactivity_wait_minutes: Optional[int] = None
    email_channel_enabled: Optional[bool] = None
    push_channel_enabled: Optional[bool] = None
    eod_email_enabled: Optional[bool] = None
    midday_push_enabled: Optional[bool] = None
    quiet_hours_start: Optional[str] = None
    quiet_hours_end: Optional[str] = None
    vacation_mode: Optional[bool] = None


class EventConversationStartIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)


class EventConversationTurnIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)


class EventApproveIn(BaseModel):
    edits: Optional[dict] = None


class PendingApprovalDecisionIn(BaseModel):
    decision: str = Field(..., description="approve | decline")
    note: Optional[str] = None


# ---------------------------------------------------------------------------
# Router factory
# ---------------------------------------------------------------------------

def build_router(db) -> APIRouter:
    from cms_module import _decode  # circular-safe: cms_module doesn't need us at import.

    router = APIRouter(tags=["mcgs"])

    # ---- Shared auth dependency ----
    async def current_admin(
        request: Request,
        creds: HTTPAuthorizationCredentials = Depends(bearer),
    ) -> dict:
        if not creds or not creds.credentials:
            raise HTTPException(401, "Not authenticated")
        payload = _decode(creds.credentials, "cms_admin")
        admin = await db.cms_admins.find_one(
            {"id": payload["sub"]}, {"_id": 0, "password_hash": 0},
        )
        if not admin:
            raise HTTPException(401, "Admin no longer exists")
        # Phase 2 \u2014 Rhythms: heartbeat every authenticated MCGS call.
        # Powers the End-of-Day considerate-deferral rule. Best-effort;
        # never blocks the request.
        try:
            route_key = request.url.path if request else None
        except Exception:
            route_key = None
        await record_admin_heartbeat(db, admin.get("id"), route=route_key)
        return admin

    # =====================================================================
    # /api/mcgs/rhythms/*  \u2014 Phase 2 settings + heartbeat surface
    # =====================================================================

    @router.get("/mcgs/rhythms/settings")
    async def api_get_rhythm_settings(admin: dict = Depends(current_admin)):
        settings = await get_rhythm_settings(db, admin.get("id"))
        return settings

    @router.put("/mcgs/rhythms/settings")
    async def api_update_rhythm_settings(
        body: RhythmSettingsIn,
        admin: dict = Depends(current_admin),
    ):
        patch = {k: v for k, v in body.model_dump().items() if v is not None}
        try:
            updated = await update_rhythm_settings(db, admin.get("id"), patch)
        except RhythmSettingsError as exc:
            raise HTTPException(400, str(exc))
        # Milestone C \u2014 rebuild this admin's scheduled jobs so tz / times
        # / vacation-mode take effect immediately.
        try:
            await reschedule_admin(admin.get("id"))
        except Exception:
            log.exception("reschedule after settings update failed (non-fatal)")
        return updated

    @router.post("/mcgs/rhythms/heartbeat")
    async def api_rhythm_heartbeat(
        request: Request,
        admin: dict = Depends(current_admin),
    ):
        """Explicit heartbeat endpoint the Bridge UI can ping while a tab is
        open. `current_admin` already records a heartbeat on every call \u2014
        this endpoint is the intentional \"I'm still here\" ping.
        """
        return {"ok": True, "admin_id": admin.get("id")}

    # ---- Morning Briefing: compose + fetch + acknowledge ----

    @router.post("/mcgs/rhythms/morning/compose")
    async def api_compose_morning(
        force: bool = Query(default=False),
        admin: dict = Depends(current_admin),
    ):
        """Compose today's Morning Briefing for the current admin.

        Idempotent by default (returns the already-composed row if one
        exists for today). Pass `?force=true` to recompose \u2014 respected
        only for testing / opener rotation experiments.

        **One-briefing-per-day rule**: if Garry asks for his briefing
        before the scheduled cron fires, that call becomes today's
        official briefing \u2014 the cron simply delivers to secondary
        channels and never re-generates content.
        """
        settings = await get_rhythm_settings(db, admin.get("id"))
        try:
            row = await compose_morning_briefing(
                db, admin.get("id"),
                force=force,
                timezone_name=settings.get("timezone"),
            )
        except Exception as exc:
            log.exception("morning briefing compose failed")
            raise HTTPException(500, f"Morning briefing failed: {exc}")
        # Strip Mongo ObjectId if present.
        row.pop("_id", None)
        return row

    @router.post("/mcgs/rhythms/morning/deliver")
    async def api_deliver_morning(admin: dict = Depends(current_admin)):
        """Deliver today's Morning Briefing to secondary channels
        (email, push). Idempotent \u2014 respects `channels_delivered` and
        the \"already read on Bridge\" dedup rule.
        """
        row = await db[COLL_BRIEFINGS].find_one(
            {
                "admin_id": admin.get("id"),
                "rhythm_type": "morning",
                "date_key": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            },
            {"_id": 0},
        )
        if not row:
            raise HTTPException(404, "No morning briefing yet for today.")
        settings = await get_rhythm_settings(db, admin.get("id"))
        return await deliver_briefing(db, row, settings)

    @router.get("/mcgs/rhythms/scheduler")
    async def api_scheduler_status(admin: dict = Depends(current_admin)):
        """Snapshot of registered cron jobs. Handy for verifying your
        schedule is what you expect."""
        return scheduler_status()

    # ---- Midday Pulse (Milestone D) ----

    @router.post("/mcgs/rhythms/midday/evaluate")
    async def api_midday_evaluate(
        force: bool = Query(default=False),
        admin: dict = Depends(current_admin),
    ):
        """Evaluate the Midday Pulse gate. Returns either a persisted
        briefing row (when material changes fire the pulse) or a
        `{status: skipped, skip_reason: ...}` payload (silence).

        `force=true` bypasses the "already composed today" idempotency
        so you can re-evaluate for testing.
        """
        settings = await get_rhythm_settings(db, admin.get("id"))
        try:
            row = await compose_midday_pulse(
                db,
                admin.get("id"),
                force=force,
                timezone_name=settings.get("timezone"),
            )
        except Exception as exc:
            log.exception("midday pulse compose failed")
            raise HTTPException(500, f"Midday pulse failed: {exc}")
        row.pop("_id", None)
        return row

    @router.post("/mcgs/rhythms/midday/deliver")
    async def api_midday_deliver(admin: dict = Depends(current_admin)):
        """Deliver today's Midday Pulse to push (if genuinely important).
        Bridge is already source of truth. No email by policy.
        """
        row = await db[COLL_BRIEFINGS].find_one(
            {
                "admin_id": admin.get("id"),
                "rhythm_type": "midday",
                "date_key": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            },
            {"_id": 0},
        )
        if not row:
            raise HTTPException(404, "No midday pulse fired for today.")
        settings = await get_rhythm_settings(db, admin.get("id"))
        return await deliver_briefing(db, row, settings)

    # ---- End-of-Day Wrap-up (Milestone E) ----

    @router.post("/mcgs/rhythms/eod/compose")
    async def api_eod_compose(
        force: bool = Query(default=False),
        admin: dict = Depends(current_admin),
    ):
        """Compose today's End-of-Day Wrap-up. Idempotent by default.

        Note: this bypasses the considerate-deferral rule (which lives in
        the scheduler). Use `?force=true` for testing content only.
        """
        settings = await get_rhythm_settings(db, admin.get("id"))
        try:
            row = await compose_eod_wrapup(
                db,
                admin.get("id"),
                force=force,
                timezone_name=settings.get("timezone"),
            )
        except Exception as exc:
            log.exception("EOD wrap-up compose failed")
            raise HTTPException(500, f"EOD wrap-up failed: {exc}")
        row.pop("_id", None)
        return row

    @router.post("/mcgs/rhythms/eod/deliver")
    async def api_eod_deliver(admin: dict = Depends(current_admin)):
        """Deliver today's EOD wrap-up to secondary channels (email if enabled)."""
        row = await db[COLL_BRIEFINGS].find_one(
            {
                "admin_id": admin.get("id"),
                "rhythm_type": "eod",
                "date_key": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            },
            {"_id": 0},
        )
        if not row:
            raise HTTPException(404, "No EOD wrap-up for today.")
        if row.get("status") == "skipped":
            return row
        settings = await get_rhythm_settings(db, admin.get("id"))
        return await deliver_briefing(db, row, settings)

    # ---- Milestone Recognition (Milestone F) ----

    @router.post("/mcgs/rhythms/milestones/scan")
    async def api_milestones_scan(admin: dict = Depends(current_admin)):
        """Run the milestone scanner on demand. Idempotent — awards each
        milestone at most once per period. Paused during safety-sensitive
        windows.
        """
        try:
            result = await scan_milestones(db)
        except Exception as exc:
            log.exception("milestone scan failed")
            raise HTTPException(500, f"Milestone scan failed: {exc}")
        return result

    # =====================================================================
    # /api/mcgs/george/event/*  — Conversational Event Creation (Phase 3)
    # =====================================================================

    @router.post("/mcgs/george/event/start")
    async def api_event_start(
        body: EventConversationStartIn,
        admin: dict = Depends(current_admin),
    ):
        """Begin a new event-creation conversation with George.

        The initial text can be a full description or a short seed —
        George extracts what's there, checks grounded defaults, and
        either asks the next warm question or produces a complete draft.
        """
        try:
            session = await start_event_conversation(
                db,
                actor_id=admin.get("id"),
                actor_role="admin",
                initial_text=body.text,
                host_id=admin.get("id"),
            )
        except Exception as exc:
            log.exception("event conversation start failed")
            raise HTTPException(500, f"Could not start conversation: {exc}")
        return session

    @router.post("/mcgs/george/event/session/{session_id}/turn")
    async def api_event_turn(
        session_id: str,
        body: EventConversationTurnIn,
        admin: dict = Depends(current_admin),
    ):
        try:
            session = await take_conversation_turn(db, session_id, body.text)
        except ValueError as exc:
            raise HTTPException(404, str(exc))
        except Exception as exc:
            log.exception("event conversation turn failed")
            raise HTTPException(500, f"Could not continue conversation: {exc}")
        if session.get("actor_id") != admin.get("id"):
            raise HTTPException(403, "Not your conversation.")
        return session

    @router.get("/mcgs/george/event/session/{session_id}")
    async def api_event_session(
        session_id: str,
        admin: dict = Depends(current_admin),
    ):
        session = await get_event_session(db, session_id)
        if not session:
            raise HTTPException(404, "Session not found")
        if session.get("actor_id") != admin.get("id"):
            raise HTTPException(403, "Not your conversation.")
        return session

    @router.post("/mcgs/george/event/session/{session_id}/approve")
    async def api_event_approve(
        session_id: str,
        body: EventApproveIn,
        admin: dict = Depends(current_admin),
    ):
        session = await get_event_session(db, session_id)
        if not session:
            raise HTTPException(404, "Session not found")
        if session.get("actor_id") != admin.get("id"):
            raise HTTPException(403, "Not your conversation.")
        try:
            result = await approve_event_draft(db, session_id, edits=body.edits)
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        except Exception as exc:
            log.exception("event conversation approve failed")
            raise HTTPException(500, f"Approve failed: {exc}")
        return result

    @router.post("/mcgs/george/event/session/{session_id}/cancel")
    async def api_event_cancel(
        session_id: str,
        admin: dict = Depends(current_admin),
    ):
        session = await get_event_session(db, session_id)
        if not session:
            raise HTTPException(404, "Session not found")
        if session.get("actor_id") != admin.get("id"):
            raise HTTPException(403, "Not your conversation.")
        return await cancel_event_session(db, session_id)

    @router.get("/mcgs/george/presence")
    async def api_george_presence(admin: dict = Depends(current_admin)):
        """Light 'what does George know about me right now?' call.

        Powers the arrival butterfly's continuity greetings — recent
        unfinished drafts, the last thing we finished together, and
        whether this is our first meeting (so the introduction script
        runs). No LLM cost; pure Mongo lookups. Never blocks arrival
        on failure.
        """
        try:
            presence = await actor_george_presence(db, actor_id=admin.get("id"))
        except Exception:
            log.exception("george presence lookup failed (non-fatal)")
            presence = {"actor_id": admin.get("id"), "unfinished": [], "last_completed": None}
        presence["name"] = (
            admin.get("display_name")
            or admin.get("name")
            or (admin.get("email", "").split("@")[0] if admin.get("email") else None)
            or ""
        )
        # Has this actor met George before? The introduction plays exactly once.
        presence["first_meeting"] = not bool(admin.get("george_first_met_at"))
        return presence

    @router.post("/mcgs/george/introduced")
    async def api_george_introduced(admin: dict = Depends(current_admin)):
        """Persist the fact that George has now introduced himself to
        this actor. From here on he greets them as someone he knows.
        Idempotent: only sets the field if it wasn't already there, so
        the audit timestamp reflects the *actual* first meeting.
        """
        now = datetime.now(timezone.utc).isoformat()
        try:
            await db.cms_admins.update_one(
                {"id": admin.get("id"), "george_first_met_at": {"$exists": False}},
                {"$set": {"george_first_met_at": now}},
            )
            fresh = await db.cms_admins.find_one(
                {"id": admin.get("id")},
                {"_id": 0, "george_first_met_at": 1},
            ) or {}
        except Exception:
            log.exception("george introduced write failed (non-fatal)")
            fresh = {"george_first_met_at": now}
        return {"ok": True, "george_first_met_at": fresh.get("george_first_met_at", now)}


    # =====================================================================
    # /api/mcgs/events/pending-approval  — moderation queue for actors
    # WITHOUT the `publish_events` permission (members, low-trust orgs).
    # Publishing is a permission, not a role, so this queue is shared.
    # =====================================================================

    @router.get("/mcgs/events/pending-approval")
    async def api_pending_approval_list(admin: dict = Depends(current_admin)):
        cursor = db.events_pending_approval.find(
            {"status": {"$in": ["pending", None]}}, {"_id": 0},
        ).sort("created_at", -1).limit(200)
        items = [doc async for doc in cursor]
        return {"items": items, "count": len(items)}

    @router.post("/mcgs/events/pending-approval/{item_id}/approve")
    async def api_pending_approval_approve(
        item_id: str,
        admin: dict = Depends(current_admin),
    ):
        item = await db.events_pending_approval.find_one({"id": item_id}, {"_id": 0})
        if not item:
            raise HTTPException(404, "Pending item not found")
        if item.get("status") == "approved":
            return {"ok": True, "already": True}
        now = datetime.now(timezone.utc).isoformat()
        target = {
            "id": str(uuid.uuid4()),
            "title": item.get("title") or "Untitled event",
            "emoji": item.get("emoji") or "🎉",
            "description": item.get("description") or "",
            "location": item.get("location") or "",
            "date": item.get("date") or "",
            "time": item.get("time") or "",
            "capacity": item.get("capacity"),
            "audience": item.get("audience"),
            "price": item.get("price"),
            "host_id": item.get("host_id"),
            "rsvps": [], "rsvps_maybe": [], "rsvps_cant": [], "waitlist": [],
            "created_at": now,
            "created_by_george": True,
            "george_session_id": item.get("george_session_id"),
            "approved_by_admin_id": admin.get("id"),
            "created_by_actor_id": item.get("submitted_by"),
            "created_by_actor_role": item.get("submitted_by_role"),
            "from_pending_id": item.get("id"),
        }
        await db.events.insert_one({**target})
        await db.events_pending_approval.update_one(
            {"id": item_id},
            {"$set": {
                "status": "approved",
                "approved_at": now,
                "approved_by_admin_id": admin.get("id"),
                "published_event_id": target["id"],
                "updated_at": now,
            }},
        )
        target.pop("_id", None)
        return {"ok": True, "target": target}

    @router.post("/mcgs/events/pending-approval/{item_id}/decline")
    async def api_pending_approval_decline(
        item_id: str,
        body: PendingApprovalDecisionIn,
        admin: dict = Depends(current_admin),
    ):
        item = await db.events_pending_approval.find_one({"id": item_id})
        if not item:
            raise HTTPException(404, "Pending item not found")
        now = datetime.now(timezone.utc).isoformat()
        await db.events_pending_approval.update_one(
            {"id": item_id},
            {"$set": {
                "status": "declined",
                "declined_at": now,
                "declined_by_admin_id": admin.get("id"),
                "decline_note": body.note or "",
                "updated_at": now,
            }},
        )
        return {"ok": True}

    @router.get("/mcgs/rhythms/today")
    async def api_rhythms_today(admin: dict = Depends(current_admin)):
        """Return today's Rhythm outputs for the Bridge card.

        Today = the admin's local `date_key` in Australia/Melbourne by
        default (Phase 2 uses UTC date_key \u2014 timezone-aware date_key
        arrives with Milestone C's scheduler).
        """
        from datetime import datetime as _dt, timezone as _tz
        date_key = _dt.now(_tz.utc).strftime("%Y-%m-%d")
        rows = await db[COLL_BRIEFINGS].find(
            {
                "admin_id": admin.get("id"),
                "date_key": date_key,
            },
            {"_id": 0},
        ).sort([("delivered_at", -1)]).to_list(10)
        return {"date_key": date_key, "items": rows, "count": len(rows)}

    @router.post("/mcgs/rhythms/briefings/{briefing_id}/seen")
    async def api_briefing_seen(
        briefing_id: str, admin: dict = Depends(current_admin),
    ):
        """Mark a briefing as seen on the Bridge. Prevents email dedup
        from re-sending the same content."""
        from datetime import datetime as _dt, timezone as _tz
        now = _dt.now(_tz.utc).isoformat()
        res = await db[COLL_BRIEFINGS].update_one(
            {"id": briefing_id, "admin_id": admin.get("id"), "bridge_seen_at": None},
            {"$set": {"bridge_seen_at": now, "status": "seen"}},
        )
        return {"updated": res.modified_count, "seen_at": now}

    @router.post("/mcgs/rhythms/briefings/{briefing_id}/acknowledge")
    async def api_briefing_acknowledge(
        briefing_id: str, admin: dict = Depends(current_admin),
    ):
        """Mark a briefing as acknowledged \u2014 removes the pinned card."""
        from datetime import datetime as _dt, timezone as _tz
        now = _dt.now(_tz.utc).isoformat()
        res = await db[COLL_BRIEFINGS].update_one(
            {"id": briefing_id, "admin_id": admin.get("id")},
            {"$set": {"bridge_acknowledged_at": now, "status": "acknowledged"}},
        )
        if not res.matched_count:
            raise HTTPException(404, "Briefing not found")
        return {"acknowledged_at": now}

    # =====================================================================
    # /api/mcgs/signals
    # =====================================================================

    @router.get("/mcgs/signals")
    async def api_list_signals(
        admin: dict = Depends(current_admin),
        status: Optional[list[str]] = Query(default=None),
        priority: Optional[list[str]] = Query(default=None),
        category: Optional[list[str]] = Query(default=None),
        assignee_id: Optional[str] = Query(default=None),
        limit: int = Query(default=50, ge=1, le=200),
    ):
        rows = await list_signals(
            db, status=status, priority=priority, category=category,
            assignee_id=assignee_id, limit=limit,
        )
        return {"items": rows, "count": len(rows)}

    @router.get("/mcgs/signals/{signal_id}")
    async def api_get_signal(signal_id: str, admin: dict = Depends(current_admin)):
        sig = await get_signal(db, signal_id)
        if not sig:
            raise HTTPException(404, "Signal not found")
        return sig

    @router.patch("/mcgs/signals/{signal_id}/state")
    async def api_transition_signal(
        signal_id: str,
        body: SignalStateIn,
        admin: dict = Depends(current_admin),
    ):
        try:
            updated = await transition_signal(
                db,
                signal_id=signal_id,
                to_state=body.to,
                actor_id=admin.get("id"),
                actor_kind="human",
                notes=body.notes,
                via_channel="bridge",
                snoozed_until=body.snoozed_until,
                resolved_action=body.resolved_action,
            )
        except SignalError as exc:
            raise HTTPException(400, str(exc))
        return updated

    # =====================================================================
    # /api/mcgs/cases
    # =====================================================================

    @router.get("/mcgs/cases")
    async def api_list_cases(
        admin: dict = Depends(current_admin),
        status: Optional[list[str]] = Query(default=None),
        priority: Optional[list[str]] = Query(default=None),
        category: Optional[list[str]] = Query(default=None),
        assignee_id: Optional[str] = Query(default=None),
        limit: int = Query(default=50, ge=1, le=200),
    ):
        rows = await list_cases(
            db, status=status, priority=priority, category=category,
            assignee_id=assignee_id, limit=limit,
        )
        return {"items": rows, "count": len(rows)}

    @router.get("/mcgs/cases/{case_id}")
    async def api_get_case(case_id: str, admin: dict = Depends(current_admin)):
        case = await get_case(db, case_id)
        if not case:
            raise HTTPException(404, "Case not found")
        return case

    @router.patch("/mcgs/cases/{case_id}/state")
    async def api_transition_case(
        case_id: str, body: CaseStateIn,
        admin: dict = Depends(current_admin),
    ):
        try:
            updated = await transition_case(
                db, case_id=case_id, to_state=body.to,
                actor_id=admin.get("id"), actor_kind="human",
                notes=body.notes, via_channel="bridge",
                resolved_action=body.resolved_action,
            )
        except SignalError as exc:
            raise HTTPException(400, str(exc))
        return updated

    @router.post("/mcgs/cases/{case_id}/assign")
    async def api_assign_case(
        case_id: str, body: CaseAssignIn,
        admin: dict = Depends(current_admin),
    ):
        try:
            updated = await assign_case(
                db, case_id=case_id, assignee_id=body.assignee_id,
                actor_id=admin.get("id"), actor_kind="human",
                via_channel="bridge",
            )
        except SignalError as exc:
            raise HTTPException(404, str(exc))
        return updated

    # =====================================================================
    # /api/mcgs/actions/*  \u2014 Action Preview execution (voice-safeguard gate)
    # =====================================================================

    @router.post("/mcgs/actions/ticket-reply")
    async def api_action_ticket_reply(
        body: TicketReplyIn, admin: dict = Depends(current_admin),
    ):
        if not body.confirmed:
            raise HTTPException(400, "Action requires explicit confirmation (confirmed=true).")
        from services.mcgs.actions import execute_ticket_reply
        try:
            result = await execute_ticket_reply(
                db,
                ticket_id=body.ticket_id,
                reply_text=body.draft,
                admin=admin,
                george_involved=body.george_involved,
                george_reasoning=body.george_reasoning,
                case_id=body.case_id,
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        except RuntimeError as exc:
            raise HTTPException(502, str(exc))
        return result

    @router.post("/mcgs/actions/submission-decision")
    async def api_action_submission_decision(
        body: SubmissionDecisionIn, admin: dict = Depends(current_admin),
    ):
        if not body.confirmed:
            raise HTTPException(400, "Action requires explicit confirmation (confirmed=true).")
        from services.mcgs.actions import execute_submission_decision
        try:
            result = await execute_submission_decision(
                db,
                submission_id=body.submission_id,
                decision=body.decision,
                note=body.note,
                admin=admin,
                george_involved=body.george_involved,
                george_reasoning=body.george_reasoning,
                case_id=body.case_id,
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        return result

    # =====================================================================
    # /api/mcgs/proposals/*  \u2014 Ask George for a draft directly (no chat)
    # =====================================================================

    @router.post("/mcgs/proposals/ticket-reply")
    async def api_proposal_ticket_reply(
        body: TicketReplyProposalIn, admin: dict = Depends(current_admin),
    ):
        from services.george.proposals import propose_ticket_reply
        return await propose_ticket_reply(db, body.ticket_id, admin)

    @router.post("/mcgs/proposals/submission-decision")
    async def api_proposal_submission_decision(
        body: SubmissionDecisionProposalIn, admin: dict = Depends(current_admin),
    ):
        from services.george.proposals import propose_submission_decision
        return await propose_submission_decision(
            db, body.submission_id, body.decision, admin,
        )

    # =====================================================================
    # /api/mcgs/counts \u2014 hot single-doc cache
    # =====================================================================

    @router.get("/mcgs/counts")
    async def api_counts(admin: dict = Depends(current_admin)):
        return await compute_counts(db)

    # =====================================================================
    # /api/mcgs/stream \u2014 SSE from the channel-agnostic event bus
    # =====================================================================

    @router.get("/mcgs/stream")
    async def api_stream(
        request: Request,
        admin: dict = Depends(current_admin),
    ):
        """Server-Sent Events stream of Signal + Case updates.

        Any subscriber (this route today; push worker + email worker
        tomorrow) subscribes to the same in-process ``signal_events``
        bus. See services/mcgs/events.py.
        """
        queue, unsubscribe = await signal_events.subscribe()

        async def event_gen():
            try:
                # First frame so the client knows the stream is alive.
                hello = {"type": "hello", "at": datetime.now(timezone.utc).isoformat()}
                yield f"event: hello\ndata: {json.dumps(hello)}\n\n"

                while True:
                    if await request.is_disconnected():
                        break
                    try:
                        event = await asyncio.wait_for(queue.get(), timeout=15)
                    except asyncio.TimeoutError:
                        # Keep-alive comment.
                        yield ": keep-alive\n\n"
                        continue
                    kind = event.get("type", "message")
                    yield f"event: {kind}\ndata: {json.dumps(event, default=str)}\n\n"
            except asyncio.CancelledError:
                pass
            finally:
                unsubscribe()

        return StreamingResponse(
            event_gen(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    # =====================================================================
    # /api/george/chat \u2014 grounded chat, streams tokens over SSE
    # =====================================================================

    @router.post("/george/chat")
    async def api_george_chat(
        body: GeorgeChatIn,
        admin: dict = Depends(current_admin),
    ):
        chat_id = body.chat_id or str(uuid.uuid4())
        session_id = f"{admin.get('id')}::{chat_id}"

        # Fetch prior turns for continuity (last N).
        chat_doc = await db.george_chats.find_one(
            {"id": chat_id, "admin_id": admin.get("id"), "scope": "mcgs"},
            {"_id": 0, "turns": {"$slice": -12}},
        )
        prior_turns = (chat_doc or {}).get("turns") or []

        now_iso = datetime.now(timezone.utc).isoformat()

        # Record the user's turn first \u2014 do it up-front so if the stream
        # dies mid-flight, the message is still logged for audit.
        user_turn = {
            "role": "user", "content": body.message,
            "input_kind": "text", "output_kind": None,
            "created_at": now_iso,
        }
        await db.george_chats.update_one(
            {"id": chat_id, "admin_id": admin.get("id"), "scope": "mcgs"},
            {
                "$set": {"last_active_at": now_iso, "scope": "mcgs"},
                "$setOnInsert": {
                    "id": chat_id, "admin_id": admin.get("id"),
                    "started_at": now_iso,
                    "voice_seconds_today": 0,
                },
                "$push": {"turns": user_turn},
                "$inc": {"message_count_today": 1},
            },
            upsert=True,
        )

        async def event_gen():
            reply_text_parts: list[str] = []
            usage: dict = {}
            try:
                # Emit the chat_id so the UI can pick up subsequent turns.
                yield f"event: session\ndata: {json.dumps({'chat_id': chat_id})}\n\n"

                async for ev in grounded_chat_stream(
                    db=db, admin=admin, user_message=body.message,
                    session_id=session_id, prior_turns=prior_turns,
                ):
                    kind = ev.get("kind")
                    if kind == "delta":
                        reply_text_parts.append(ev.get("text") or "")
                        yield f"event: delta\ndata: {json.dumps({'text': ev.get('text')})}\n\n"
                    elif kind == "plan":
                        yield f"event: plan\ndata: {json.dumps(ev.get('plan') or {})}\n\n"
                    elif kind == "tools":
                        # Slim the tool result payload for the wire.
                        results = ev.get("results") or []
                        yield f"event: tools\ndata: {json.dumps({'results': results}, default=str)}\n\n"
                    elif kind == "action_preview":
                        # Full Action Preview payload streamed to the client
                        # so the sheet can render an inline preview card.
                        preview = ev.get("preview") or {}
                        yield f"event: action_preview\ndata: {json.dumps(preview, default=str)}\n\n"
                    elif kind == "done":
                        usage = {"error": ev.get("error")} if ev.get("error") else {}
                        yield f"event: done\ndata: {json.dumps({'reply_length': len(ev.get('reply') or '')})}\n\n"
            except asyncio.CancelledError:
                pass
            finally:
                # Persist George's reply (best-effort; never abort the stream).
                try:
                    reply = "".join(reply_text_parts)
                    if reply:
                        george_turn = {
                            "role": "george", "content": reply,
                            "input_kind": None, "output_kind": "text",
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        }
                        await db.george_chats.update_one(
                            {"id": chat_id, "admin_id": admin.get("id"), "scope": "mcgs"},
                            {"$push": {"turns": george_turn}, "$set": {"last_active_at": george_turn["created_at"]}},
                        )
                except Exception:
                    log.exception("george reply persistence failed")

        return StreamingResponse(
            event_gen(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    @router.get("/george/history")
    async def api_george_history(
        admin: dict = Depends(current_admin),
        limit: int = Query(default=5, ge=1, le=25),
    ):
        rows = await db.george_chats.find(
            {"admin_id": admin.get("id"), "scope": "mcgs"},
            {"_id": 0, "id": 1, "started_at": 1, "last_active_at": 1,
             "turns": {"$slice": -1}},
        ).sort("last_active_at", -1).to_list(limit)
        return {"items": rows}

    @router.delete("/george/history/{chat_id}")
    async def api_george_history_delete(
        chat_id: str, admin: dict = Depends(current_admin),
    ):
        res = await db.george_chats.delete_one(
            {"id": chat_id, "admin_id": admin.get("id"), "scope": "mcgs"},
        )
        return {"deleted": res.deleted_count}

    # =====================================================================
    # /api/george/voice/*  \u2014 STT + TTS via Emergent LLM key
    # =====================================================================

    @router.post("/george/voice/transcribe")
    async def api_george_transcribe(
        audio: UploadFile = File(...),
        admin: dict = Depends(current_admin),
    ):
        """Transcribe an audio clip via Whisper-1. The transcript
        returns for review \u2014 nothing sent to George automatically."""
        from emergentintegrations.llm.openai.speech_to_text import OpenAISpeechToText
        import os as _os, io, tempfile
        key = _os.environ.get("EMERGENT_LLM_KEY")
        if not key:
            raise HTTPException(500, "EMERGENT_LLM_KEY missing")

        data = await audio.read()
        # Whisper expects a file-like with .name.
        ext = (audio.filename or "clip.webm").rsplit(".", 1)[-1].lower()
        if ext not in {"mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm"}:
            ext = "webm"

        # Wrap bytes in a temp file so litellm has a real path.
        with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as tmp:
            tmp.write(data)
            path = tmp.name

        stt = OpenAISpeechToText(api_key=key)
        try:
            with open(path, "rb") as fh:
                resp = await stt.transcribe(file=fh, model="whisper-1", response_format="json")
        except Exception as exc:
            log.exception("STT failed")
            raise HTTPException(502, f"Transcription failed: {exc}")
        finally:
            try: _os.unlink(path)
            except Exception: pass

        text = getattr(resp, "text", None) or (resp.get("text") if isinstance(resp, dict) else None) or ""
        return {"transcript": text}

    @router.post("/george/voice/speak")
    async def api_george_speak(body: TTSIn, admin: dict = Depends(current_admin)):
        """Return mp3 audio of the provided text. Called on-demand when
        Garry taps Play on a reply, or auto when 'Read to me' is on."""
        from emergentintegrations.llm.openai.text_to_speech import OpenAITextToSpeech
        import os as _os
        key = _os.environ.get("EMERGENT_LLM_KEY")
        if not key:
            raise HTTPException(500, "EMERGENT_LLM_KEY missing")

        tts = OpenAITextToSpeech(api_key=key)
        voice = body.voice if body.voice in OpenAITextToSpeech.VOICES else "nova"
        try:
            audio = await tts.generate_speech(
                text=body.text, model="tts-1", voice=voice,
                speed=body.speed, response_format="mp3",
            )
        except Exception as exc:
            log.exception("TTS failed")
            raise HTTPException(502, f"Speech generation failed: {exc}")

        from fastapi.responses import Response as _Response
        return _Response(content=audio, media_type="audio/mpeg")

    return router
