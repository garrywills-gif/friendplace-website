"""Marketing sends orchestration + history persistence (iter159).

The core function is ``send_marketing_email`` which:
  1. Renders the chosen template with the recipient context.
  2. Optionally fetches the flyer as a PDF attachment.
  3. Sends the email via the existing ``email_service.send_email_detailed``
     (Resend). ONE recipient per SDK call — this is the privacy
     invariant guaranteeing bulk sends can never leak addresses.
  4. Persists a row to ``marketing_sends`` capturing everything we
     might want to audit later (recipient, template used, flyer used,
     Resend message id, status, error code).
  5. Upserts the contact into ``marketing_contacts`` so their history
     is available on next send.

The bulk campaign runner (P1) will call this function once per
recipient inside a loop — there is intentionally no batch variant.
"""
from __future__ import annotations

import base64
import logging
import re
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import httpx

from email_service import send_email_detailed, SendResult
from services.marketing.templates import TemplateContext, render_template
from services.marketing.contacts import upsert_contact

logger = logging.getLogger("friendplace.marketing.sends")

COLL_SENDS = "marketing_sends"


# ---------------------------------------------------------------------------
# Flyer attachment
# ---------------------------------------------------------------------------

@dataclass
class FlyerAttachmentRequest:
    """What the caller asks for."""
    template_key: str
    layout: str = "poster_a4"
    field_values: Dict[str, str] = field(default_factory=dict)
    # Optional friendly filename override — otherwise we auto-generate
    # from the template + layout + venue.
    filename: Optional[str] = None


@dataclass
class FlyerAttachmentResult:
    filename: str
    content_type: str
    b64: str            # base64-encoded content for Resend `attachments`
    size_bytes: int
    template_key: str
    layout: str


async def build_flyer_attachment(
    db,
    req: FlyerAttachmentRequest,
    *,
    internal_base_url: str,
    admin_token: Optional[str] = None,
) -> FlyerAttachmentResult:
    """Fetch the flyer as PDF and return it in Resend-ready shape.

    We invoke the existing CMS render endpoint (``/api/cms/flyer-templates/
    {key}/render?format=pdf``) so the marketing send path shares the same
    output as the Publishing Centre. Zero renderer duplication.
    """
    from services import flyers as _flyers

    # Validate the template exists + layout is supported. Better a
    # helpful error here than an opaque 500 later.
    tpl = await _flyers.get_template(db, req.template_key)
    if not tpl:
        raise ValueError(f"Flyer template '{req.template_key}' not found.")
    supported = list(tpl.get("supported_layouts") or [])
    if supported and req.layout not in supported:
        raise ValueError(
            f"'{req.layout}' is not supported by '{tpl.get('name')}'. "
            f"Supported: {', '.join(supported)}."
        )

    # Direct in-process render — MUCH faster and avoids the HTTP round
    # trip. The render layer already handles field filtering.
    from services.flyers.pdf_export import png_bytes_to_pdf_bytes

    params: Dict[str, Any] = dict(req.field_values or {})
    # admin_id fallback so previews always work (mirrors the CMS render
    # endpoint's own fallback behaviour).
    if not params.get("admin_id"):
        fallback = await db.users.find_one(
            {"is_admin": True, "is_demo": {"$ne": True}}, {"_id": 0, "id": 1},
        )
        if not fallback:
            fallback = await db.users.find_one({"is_admin": True}, {"_id": 0, "id": 1})
        if fallback:
            params["admin_id"] = fallback["id"]

    try:
        result = await _flyers.render_flyer(
            db=db,
            template_key=req.template_key,
            layout_key=req.layout,
            params=params,
        )
    except (ValueError, KeyError, FileNotFoundError) as exc:
        raise ValueError(str(exc)) from exc

    if result.media_type == "application/pdf":
        pdf_bytes = result.content
    elif result.media_type == "image/png":
        pdf_bytes, _ext = png_bytes_to_pdf_bytes(result.content, req.layout)
    else:
        raise ValueError(f"Cannot attach flyer of type {result.media_type}")

    filename = (req.filename or "").strip()
    if not filename:
        stem = result.filename.rsplit(".", 1)[0]
        filename = f"{stem}.pdf"
    if not filename.lower().endswith(".pdf"):
        filename += ".pdf"

    b64 = base64.b64encode(pdf_bytes).decode("ascii")
    return FlyerAttachmentResult(
        filename=filename,
        content_type="application/pdf",
        b64=b64,
        size_bytes=len(pdf_bytes),
        template_key=req.template_key,
        layout=req.layout,
    )


# ---------------------------------------------------------------------------
# Send + record
# ---------------------------------------------------------------------------

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _validate_email(addr: str) -> str:
    addr = (addr or "").strip()
    if not _EMAIL_RE.match(addr):
        raise ValueError(f"Not a valid email address: {addr!r}")
    return addr


@dataclass
class SendRequest:
    template_id: str
    recipient_email: str
    recipient_name: str = ""
    recipient_type: str = "person"        # "person" | "organisation"
    organisation_name: str = ""
    suburb: str = ""
    subject_override: Optional[str] = None
    additional_message: str = ""
    flyer: Optional[FlyerAttachmentRequest] = None
    # A single campaign_id if this send belongs to a bulk campaign.
    campaign_id: Optional[str] = None
    # Who initiated the send (CMS admin email or id) — audit trail.
    initiator: Optional[str] = None
    # Free-form tags for filtering the history view.
    tags: List[str] = field(default_factory=list)


@dataclass
class SendOutcome:
    ok: bool
    send_id: str
    message_id: Optional[str]
    error: Optional[str]
    error_code: Optional[str]
    recipient_email: str
    template_id: str


async def send_marketing_email(db, req: SendRequest) -> SendOutcome:
    """Render, attach, send, and record.

    Privacy invariant: `to` is a single recipient. Never batched.
    """
    recipient_email = _validate_email(req.recipient_email)

    ctx = TemplateContext(
        recipient_name=req.recipient_name,
        recipient_email=recipient_email,
        recipient_type=req.recipient_type or "person",
        organisation_name=req.organisation_name,
        additional_message=req.additional_message,
        suburb=req.suburb,
        subject_override=req.subject_override,
        flyer_name=None,  # populated below if flyer attaches
    )

    flyer_attachment: Optional[FlyerAttachmentResult] = None
    if req.flyer:
        # Build the attachment BEFORE rendering the body so the copy
        # can reference the flyer by name.
        flyer_attachment = await build_flyer_attachment(
            db, req.flyer, internal_base_url="",
        )
        # Refresh ctx with the flyer's friendly filename (minus .pdf)
        friendly_flyer_name = flyer_attachment.filename.rsplit(".", 1)[0].replace("-", " ")
        ctx.flyer_name = friendly_flyer_name

    rendered = render_template(req.template_id, ctx)

    resend_attachments: Optional[List[Dict[str, Any]]] = None
    if flyer_attachment:
        resend_attachments = [{
            "filename":    flyer_attachment.filename,
            "content":     flyer_attachment.b64,
            "content_type": flyer_attachment.content_type,
        }]

    # ---- The critical single-recipient call ------------------------------
    # send_email_detailed places `to` into a list of ONE. Never batched,
    # never CC'd, never BCC'd.
    send_result: SendResult = await send_email_detailed(
        to=recipient_email,
        subject=rendered.subject,
        html=rendered.html,
        text=rendered.text,
        attachments=resend_attachments,
    )
    # ---------------------------------------------------------------------

    send_id = str(uuid.uuid4())
    from datetime import datetime, timezone
    iso_now = datetime.now(timezone.utc).isoformat()

    row = {
        "id":                send_id,
        "created_at":        iso_now,
        "campaign_id":       req.campaign_id,
        "template_id":       req.template_id,
        "recipient_email":   recipient_email,
        "recipient_name":    req.recipient_name,
        "recipient_type":    req.recipient_type,
        "organisation_name": req.organisation_name,
        "suburb":            req.suburb,
        "subject":           rendered.subject,
        "flyer_template":    req.flyer.template_key if req.flyer else None,
        "flyer_layout":      req.flyer.layout if req.flyer else None,
        "flyer_filename":    flyer_attachment.filename if flyer_attachment else None,
        "flyer_size_bytes":  flyer_attachment.size_bytes if flyer_attachment else None,
        "status":            "sent" if send_result.ok else "failed",
        "message_id":        send_result.message_id,
        "error":             send_result.error,
        "error_code":        send_result.error_code,
        "http_status":       send_result.http_status,
        "initiator":         req.initiator,
        "tags":              list(req.tags or []),
    }
    try:
        await db[COLL_SENDS].insert_one(row)
    except Exception:  # noqa: BLE001
        logger.exception("failed to persist marketing_send row (id=%s)", send_id)

    # Upsert the contact so we build up a marketing address book over time.
    try:
        await upsert_contact(
            db,
            email=recipient_email,
            name=req.recipient_name,
            recipient_type=req.recipient_type,
            organisation_name=req.organisation_name,
            suburb=req.suburb,
            last_send_id=send_id,
            last_send_status=row["status"],
        )
    except Exception:
        logger.exception("failed to upsert marketing_contact (email=%s)", recipient_email)

    # iter160a: if this email is a known outreach org, also update THEIR
    # timeline + last_contact_at. Silently no-op if not an outreach org.
    if send_result.ok:
        try:
            from services.outreach.store import touch_last_contact as _tlc
            await _tlc(
                db, email=recipient_email, campaign_id=req.campaign_id,
                subject=rendered.subject, send_id=send_id,
            )
        except Exception:
            logger.exception("outreach touch_last_contact failed (email=%s)", recipient_email)

    # iter160b: if this send is a reply to an outstanding inbound_reply
    # (either because template_id='enquiry_reply' or the caller flagged
    # it), auto-mark those replies resolved so the badge count drops.
    if send_result.ok:
        try:
            from services.replies.store import resolve_replies_for_email as _rre
            treat_as_reply = (
                req.template_id == "enquiry_reply"
                or "reply" in [str(t).lower() for t in (req.tags or [])]
            )
            if treat_as_reply:
                await _rre(
                    db, from_email=recipient_email,
                    resolved_by=req.initiator, send_id=send_id,
                )
        except Exception:
            logger.exception("resolve_replies_for_email failed (email=%s)", recipient_email)

    return SendOutcome(
        ok=send_result.ok,
        send_id=send_id,
        message_id=send_result.message_id,
        error=send_result.error,
        error_code=send_result.error_code,
        recipient_email=recipient_email,
        template_id=req.template_id,
    )


# ---------------------------------------------------------------------------
# History
# ---------------------------------------------------------------------------

async def record_send(db, row: Dict[str, Any]) -> None:
    """Direct insert for callers that already built the row (e.g. tests)."""
    await db[COLL_SENDS].insert_one(row)


async def list_sends(
    db,
    *,
    limit: int = 100,
    campaign_id: Optional[str] = None,
    recipient_email: Optional[str] = None,
) -> List[Dict[str, Any]]:
    q: Dict[str, Any] = {}
    if campaign_id:
        q["campaign_id"] = campaign_id
    if recipient_email:
        q["recipient_email"] = recipient_email.strip().lower()
    cur = db[COLL_SENDS].find(q, {"_id": 0}).sort("created_at", -1).limit(int(limit))
    return [row async for row in cur]


async def ensure_indexes(db) -> None:
    await db[COLL_SENDS].create_index("created_at")
    await db[COLL_SENDS].create_index("campaign_id")
    await db[COLL_SENDS].create_index("recipient_email")


__all__ = [
    "FlyerAttachmentRequest",
    "FlyerAttachmentResult",
    "SendRequest",
    "SendOutcome",
    "build_flyer_attachment",
    "send_marketing_email",
    "record_send",
    "list_sends",
    "ensure_indexes",
    "COLL_SENDS",
]
