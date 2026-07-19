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
from fastapi.responses import StreamingResponse, Response
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


# ---------------------------------------------------------------------------
# Router factory
# ---------------------------------------------------------------------------

def build_router(db) -> APIRouter:
    from cms_module import _decode  # circular-safe: cms_module doesn't need us at import.

    router = APIRouter(tags=["mcgs"])

    # ---- Shared auth dependency ----
    async def current_admin(
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
        return admin

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

    class TTSIn_local(BaseModel):
        text: str = Field(..., min_length=1, max_length=3800)
        voice: str = Field("nova")
        speed: float = Field(0.95, ge=0.5, le=1.5)

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
