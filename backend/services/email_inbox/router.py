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

import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from email_service import send_email_detailed
from services.email_inbox import store


class MailboxIn(BaseModel):
    address: str
    label: Optional[str] = None


class ReadIn(BaseModel):
    read: bool = True


class ReplyIn(BaseModel):
    body_text: str
    body_html: Optional[str] = None
    subject: Optional[str] = None


def _extract_inbound(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Normalise a provider webhook body into our inbound shape.

    Tolerant of Resend inbound (``{type, data:{...}}``), a flat generic
    body, and SendGrid-style inbound parse. Missing bits degrade
    gracefully rather than erroring.
    """
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload

    def _addr(v: Any) -> str:
        if isinstance(v, dict):
            return str(v.get("email") or v.get("address") or "")
        if isinstance(v, list) and v:
            return _addr(v[0])
        return str(v or "")

    def _name(v: Any) -> str:
        if isinstance(v, dict):
            return str(v.get("name") or "")
        return ""

    to_val = data.get("to") or data.get("recipient") or payload.get("to")
    from_val = data.get("from") or data.get("sender") or payload.get("from")

    headers = data.get("headers") or payload.get("headers") or {}
    if isinstance(headers, list):  # some providers send a list of {name,value}
        headers = {str(h.get("name", "")).lower(): h.get("value") for h in headers if isinstance(h, dict)}
    else:
        headers = {str(k).lower(): v for k, v in headers.items()} if isinstance(headers, dict) else {}

    references = data.get("references") or headers.get("references") or ""
    if isinstance(references, str):
        references = [r for r in references.replace(",", " ").split() if r]

    return {
        "to": _addr(to_val),
        "from_email": _addr(from_val),
        "from_name": _name(from_val) or data.get("from_name") or payload.get("from_name") or "",
        "subject": data.get("subject") or payload.get("subject") or "(no subject)",
        "text": data.get("text") or data.get("plain") or payload.get("text") or "",
        "html": data.get("html") or payload.get("html") or "",
        "message_id": (data.get("message_id") or headers.get("message-id")
                       or payload.get("message_id") or ""),
        "in_reply_to": (data.get("in_reply_to") or headers.get("in-reply-to") or ""),
        "references": references,
        "received_at": data.get("received_at") or payload.get("received_at"),
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

    # ── public inbound webhook ───────────────────────────────────────
    @router.post("/inbound")
    async def _inbound(
        payload: Dict[str, Any],
        x_inbox_token: Optional[str] = Header(default=None),
    ):
        """Provider webhook for incoming email. Secure by setting
        ``INBOUND_EMAIL_SECRET`` in the backend env and configuring the
        provider to send it as the ``X-Inbox-Token`` header. If the env
        var is unset the endpoint still accepts posts (so it works before
        the secret is configured) — set it before going live."""
        secret = (os.getenv("INBOUND_EMAIL_SECRET") or "").strip()
        if secret and (x_inbox_token or "").strip() != secret:
            raise HTTPException(401, "Invalid inbound token")
        normalised = _extract_inbound(payload)
        if not normalised["to"]:
            raise HTTPException(400, "Could not determine recipient mailbox")
        row = await store.store_inbound(db, normalised)
        return {"ok": True, "id": row["id"], "thread_id": row["thread_id"]}

    return router


__all__ = ["build_email_inbox_router"]
