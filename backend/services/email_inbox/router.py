"""HTTP routes for the MCGS combined email inbox.

Admin routes (all require a signed-in CMS admin):
    GET    /cms/email/mailboxes
    POST   /cms/email/mailboxes                {address, label?}
    DELETE /cms/email/mailboxes/{mailbox_id}
    GET    /cms/email/messages?mailbox=&read=&archived=&limit=
    GET    /cms/email/messages/{id}            (returns message + thread)
    POST   /cms/email/messages/{id}/read       {read: bool}
    POST   /cms/email/messages/{id}/archive
    POST   /cms/email/messages/{id}/restore
    POST   /cms/email/messages/{id}/reply      {body_text, body_html?, subject?}
    GET    /cms/email/unread-count

Public route (provider webhook — secured by a shared secret header):
    POST   /cms/email/inbound
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from email_service import send_email_detailed
from services.campaign_webhooks import verify_signature
from services.email_inbox import store

_log = logging.getLogger("friendplace.email_inbox")


class MailboxIn(BaseModel):
    address: str
    label: Optional[str] = None


class ReadIn(BaseModel):
    read: bool = True


class ReplyIn(BaseModel):
    body_text: str
    body_html: Optional[str] = None
    subject: Optional[str] = None


def _display_name(headers: Dict[str, Any]) -> str:
    """Pull the sender display name out of the retrieved headers.from."""
    raw = str((headers or {}).get("from") or "")
    if "<" in raw:
        name = raw.split("<", 1)[0].strip().strip('"').strip()
        return name
    return ""


def _references_list(headers: Dict[str, Any]) -> List[str]:
    refs = (headers or {}).get("references") or ""
    if isinstance(refs, list):
        return [str(r) for r in refs if r]
    return [r for r in str(refs).replace(",", " ").split() if r]


async def _pick_mailbox(db, to_list: List[str], received_for: List[str]) -> str:
    """Resolve which managed FriendPlace address this email is for.

    Prefer a `to`/`received_for` address that matches a managed mailbox;
    otherwise fall back to the first recipient so nothing is dropped."""
    candidates = [str(a).strip().lower() for a in (list(to_list or []) + list(received_for or [])) if a]
    if not candidates:
        return ""
    managed = {m["address"] for m in await store.list_mailboxes(db)}
    for c in candidates:
        if c in managed:
            return c
    return candidates[0]


async def _normalise_received(db, data: Dict[str, Any]) -> Dict[str, Any]:
    """Build our inbound shape from the webhook `data` + the full email
    fetched from Resend (body/headers are not in the webhook)."""
    email_id = data.get("email_id") or data.get("id") or ""
    full = await store.fetch_received_email(email_id) if email_id else {}
    headers = full.get("headers") or {}

    to_list = data.get("to") or full.get("to") or []
    if isinstance(to_list, str):
        to_list = [to_list]
    received_for = data.get("received_for") or full.get("received_for") or []
    if isinstance(received_for, str):
        received_for = [received_for]
    mailbox = await _pick_mailbox(db, to_list, received_for)

    return {
        "to": mailbox,
        "from_email": data.get("from") or full.get("from") or "",
        "from_name": _display_name(headers),
        "subject": data.get("subject") or full.get("subject") or "(no subject)",
        "text": full.get("text") or "",
        "html": full.get("html") or "",
        "message_id": data.get("message_id") or full.get("message_id") or "",
        "in_reply_to": headers.get("in-reply-to") or "",
        "references": _references_list(headers),
        "received_at": data.get("created_at") or full.get("created_at"),
        "resend_email_id": email_id,
        "received_for": received_for,
    }


def build_email_inbox_router(db, current_cms_admin) -> APIRouter:
    router = APIRouter(prefix="/email", tags=["cms-email"])

    # ── mailboxes ────────────────────────────────────────────────────
    @router.get("/mailboxes")
    async def _mailboxes(admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        return {"mailboxes": await store.list_mailboxes(db)}

    @router.post("/mailboxes")
    async def _add_mailbox(body: MailboxIn, admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        try:
            return await store.add_mailbox(db, body.address, body.label)
        except ValueError as e:
            raise HTTPException(400, str(e))

    @router.delete("/mailboxes/{mailbox_id}")
    async def _remove_mailbox(mailbox_id: str, admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        ok = await store.remove_mailbox(db, mailbox_id)
        if not ok:
            raise HTTPException(404, "Mailbox not found")
        return {"ok": True, "id": mailbox_id}

    # ── messages ─────────────────────────────────────────────────────
    @router.get("/messages")
    async def _messages(
        mailbox: Optional[str] = None,
        read: Optional[bool] = None,
        archived: bool = False,
        limit: int = 200,
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        return await store.list_messages(
            db, mailbox=mailbox, read=read, archived=archived, limit=limit)

    @router.get("/messages/{message_id}")
    async def _message(
        message_id: str,
        mark_read: bool = True,
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        out = await store.get_thread(db, message_id)
        if not out:
            raise HTTPException(404, "Message not found")
        if mark_read and not out["message"].get("read"):
            await store.set_read(db, message_id, True)
            out = await store.get_thread(db, message_id)
        return out

    @router.post("/messages/{message_id}/read")
    async def _read(message_id: str, body: ReadIn, admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        row = await store.set_read(db, message_id, body.read)
        if not row:
            raise HTTPException(404, "Message not found")
        return row

    @router.post("/messages/{message_id}/archive")
    async def _archive(message_id: str, admin: dict = Depends(current_cms_admin)):
        by = admin.get("email") if isinstance(admin, dict) else None
        row = await store.archive_message(db, message_id, by)
        if not row:
            raise HTTPException(404, "Message not found")
        return row

    @router.post("/messages/{message_id}/restore")
    async def _restore(message_id: str, admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        row = await store.restore_message(db, message_id)
        if not row:
            raise HTTPException(404, "Message not found")
        return row

    @router.post("/messages/{message_id}/reply")
    async def _reply(message_id: str, body: ReplyIn, admin: dict = Depends(current_cms_admin)):
        text = (body.body_text or "").strip()
        if not text and not (body.body_html or "").strip():
            raise HTTPException(400, "Reply body is required")
        out = await store.get_thread(db, message_id)
        if not out:
            raise HTTPException(404, "Message not found")
        parent = out["message"]
        mailbox = parent.get("mailbox")            # reply FROM the FriendPlace address
        to_email = parent.get("from_email")        # reply TO the original sender
        if not to_email:
            raise HTTPException(400, "Original sender address is unknown")
        subject = (body.subject or "").strip() or parent.get("subject") or "(no subject)"
        if not subject.lower().startswith("re:"):
            subject = f"Re: {subject}"
        html = (body.body_html or "").strip() or (
            "<div style=\"font-family:system-ui,sans-serif;font-size:15px;"
            "line-height:1.6;color:#0f172a;white-space:pre-wrap\">"
            + (text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
            + "</div>"
        )
        result = await send_email_detailed(
            to=to_email, subject=subject, html=html, text=text or None,
            from_email=mailbox, reply_to=mailbox,
        )
        if not result.ok:
            raise HTTPException(
                502,
                f"Reply could not be sent: {result.error or 'unknown error'}",
            )
        sent_by = admin.get("email") if isinstance(admin, dict) else None
        stored = await store.store_outbound_reply(
            db, parent=parent, mailbox=mailbox, to_email=to_email,
            subject=subject, text=text, html=html,
            message_id=result.message_id, sent_by=sent_by,
        )
        await store.set_read(db, message_id, True)
        return {"ok": True, "message_id": result.message_id, "reply": stored}

    @router.get("/unread-count")
    async def _unread(admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        return {"count": await store.unread_count(db)}

    # ── Resend inbound webhook (native email.received flow) ──────────
    @router.post("/inbound")
    async def _inbound(request: Request):
        """Resend inbound webhook. Verifies the Svix signature with the
        inbound webhook's OWN signing secret (``RESEND_INBOUND_WEBHOOK_SECRET``
        — separate from the campaign webhook), accepts ``email.received``
        events, fetches the full message from Resend by ``email_id``, and
        stores it against the correct FriendPlace mailbox. Always returns
        200 for accepted/ignored events so Resend does not retry.
        """
        raw_body = await request.body()
        ok, reason = verify_signature(
            secret=os.getenv("RESEND_INBOUND_WEBHOOK_SECRET", ""),
            svix_id=request.headers.get("svix-id", ""),
            svix_timestamp=request.headers.get("svix-timestamp", ""),
            svix_signature=request.headers.get("svix-signature", ""),
            raw_body=raw_body,
        )
        if not ok:
            raise HTTPException(401, f"signature verification failed: {reason}")

        try:
            payload = json.loads(raw_body or b"{}")
        except Exception:
            raise HTTPException(400, "Invalid JSON body")

        if payload.get("type") != "email.received":
            # Acknowledge other event types without storing them.
            return {"ok": True, "ignored": payload.get("type")}

        data = payload.get("data") or {}
        normalised = await _normalise_received(db, data)
        if not normalised["to"]:
            _log.warning("inbound email had no resolvable recipient: %s", data.get("email_id"))
            return {"ok": True, "skipped": "no_recipient"}
        row = await store.store_inbound(db, normalised)
        return {"ok": True, "id": row["id"], "thread_id": row["thread_id"]}

    return router


__all__ = ["build_email_inbox_router"]
