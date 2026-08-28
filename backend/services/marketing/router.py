"""FastAPI router for marketing sends + preview + history (iter159).

Mounted under ``/api/marketing/*`` and guarded by the existing CMS
admin auth (``current_cms_admin``).

Endpoints
---------
GET  /api/marketing/templates                 → list templates
POST /api/marketing/preview                   → render personalised preview (no send)
POST /api/marketing/send                      → send one email now, persist history
GET  /api/marketing/sends                     → history list
GET  /api/marketing/contacts                  → address book list
GET  /api/marketing/contacts/{email}          → single contact record

Bulk campaign endpoints (POST /campaigns/…) land in P1.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from services.marketing.templates import (
    TemplateContext,
    list_templates,
    render_template,
)
from services.marketing.sends import (
    FlyerAttachmentRequest,
    SendRequest,
    build_flyer_attachment,
    send_marketing_email,
    list_sends,
)
from services.marketing.contacts import (
    list_contacts,
    get_contact,
)


# ---------------------------------------------------------------------------
# Pydantic request/response models
# ---------------------------------------------------------------------------

class FlyerAttachModel(BaseModel):
    template_key: str
    layout: str = "poster_a4"
    field_values: Dict[str, str] = Field(default_factory=dict)
    filename: Optional[str] = None


class PreviewIn(BaseModel):
    template_id: str
    recipient_email: str = ""
    recipient_name: str = ""
    recipient_type: str = "person"
    organisation_name: str = ""
    suburb: str = ""
    subject_override: Optional[str] = None
    additional_message: str = ""
    # iter164ai — personal reply mode. When provided, templates that
    # support it (enquiry_reply) treat this as the ENTIRE editable
    # body — no canned intro, no template body + additional_message
    # concatenation. Preserves newlines / blank-line paragraphs
    # exactly; HTML is safely escaped before wrapping.
    body_text: Optional[str] = None
    flyer: Optional[FlyerAttachModel] = None
    # iter164aq — shared optional CTA button.
    cta_choice: Optional[str] = None
    cta_label: Optional[str] = None
    cta_url: Optional[str] = None


class SendIn(BaseModel):
    template_id: str
    recipient_email: str
    recipient_name: str = ""
    recipient_type: str = "person"
    organisation_name: str = ""
    suburb: str = ""
    subject_override: Optional[str] = None
    additional_message: str = ""
    body_text: Optional[str] = None       # iter164ai — see PreviewIn
    flyer: Optional[FlyerAttachModel] = None
    campaign_id: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    # iter164aq — shared optional CTA button.
    cta_choice: Optional[str] = None
    cta_label: Optional[str] = None
    cta_url: Optional[str] = None


class SendOut(BaseModel):
    ok: bool
    send_id: str
    message_id: Optional[str]
    error: Optional[str]
    error_code: Optional[str]
    recipient_email: str
    template_id: str


# ---------------------------------------------------------------------------
# Router builder
# ---------------------------------------------------------------------------

def build_marketing_router(db, current_cms_admin) -> APIRouter:
    """Return the /api/marketing/* router.

    ``current_cms_admin`` is passed in from the caller (server.py) to
    avoid importing the auth machinery here — it's the same
    dependency the rest of the CMS routes use.
    """
    router = APIRouter(prefix="/marketing", tags=["marketing"])

    # ------- Templates ----------------------------------------------------

    @router.get("/templates")
    async def _list_templates(
        audience: Optional[str] = None,
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ) -> Dict[str, List[Dict[str, Any]]]:
        return {"templates": list_templates(audience=audience)}

    # ------- Preview ------------------------------------------------------

    @router.post("/preview")
    async def _preview(
        body: PreviewIn,
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ) -> Dict[str, Any]:
        """Render the personalised HTML + text + subject. Never sends."""
        flyer_name = None
        flyer_meta: Optional[Dict[str, Any]] = None
        if body.flyer:
            # Build the attachment purely to obtain the friendly
            # filename + size for the preview — we discard the bytes.
            try:
                attachment = await build_flyer_attachment(
                    db,
                    FlyerAttachmentRequest(
                        template_key=body.flyer.template_key,
                        layout=body.flyer.layout,
                        field_values=body.flyer.field_values or {},
                        filename=body.flyer.filename,
                    ),
                    internal_base_url="",
                )
            except ValueError as exc:
                raise HTTPException(400, f"Flyer attachment error: {exc}") from exc
            flyer_name = attachment.filename.rsplit(".", 1)[0].replace("-", " ")
            flyer_meta = {
                "filename":   attachment.filename,
                "size_bytes": attachment.size_bytes,
                "template_key": attachment.template_key,
                "layout":       attachment.layout,
            }

        ctx = TemplateContext(
            recipient_name=body.recipient_name,
            recipient_email=body.recipient_email,
            recipient_type=body.recipient_type or "person",
            organisation_name=body.organisation_name,
            additional_message=body.additional_message,
            # iter164ai — pass body_text through so enquiry_reply
            # renders in personal-reply mode when the client sends it.
            body_text=body.body_text or "",
            suburb=body.suburb,
            subject_override=body.subject_override,
            flyer_name=flyer_name,
            # iter164aq — shared optional CTA button.
            cta_choice=body.cta_choice or "",
            cta_label=body.cta_label or "",
            cta_url=body.cta_url or "",
        )
        try:
            rendered = render_template(body.template_id, ctx)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

        return {
            "subject":       rendered.subject,
            "html":          rendered.html,
            "text":          rendered.text,
            "flyer":         flyer_meta,
        }

    # ------- Send ---------------------------------------------------------

    @router.post("/send")
    async def _send(
        body: SendIn,
        admin: dict = Depends(current_cms_admin),
    ) -> SendOut:
        try:
            req = SendRequest(
                template_id=body.template_id,
                recipient_email=body.recipient_email,
                recipient_name=body.recipient_name,
                recipient_type=body.recipient_type or "person",
                organisation_name=body.organisation_name,
                suburb=body.suburb,
                subject_override=body.subject_override,
                additional_message=body.additional_message,
                # iter164ai — pipe body_text into the send worker so
                # the delivered email matches the preview byte-for-byte.
                body_text=body.body_text or "",
                flyer=(
                    FlyerAttachmentRequest(
                        template_key=body.flyer.template_key,
                        layout=body.flyer.layout,
                        field_values=body.flyer.field_values or {},
                        filename=body.flyer.filename,
                    ) if body.flyer else None
                ),
                campaign_id=body.campaign_id,
                initiator=admin.get("email") if isinstance(admin, dict) else None,
                tags=list(body.tags or []),
                # iter164aq — shared optional CTA button.
                cta_choice=body.cta_choice or "",
                cta_label=body.cta_label or "",
                cta_url=body.cta_url or "",
            )
            outcome = await send_marketing_email(db, req)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        return SendOut(
            ok=outcome.ok,
            send_id=outcome.send_id,
            message_id=outcome.message_id,
            error=outcome.error,
            error_code=outcome.error_code,
            recipient_email=outcome.recipient_email,
            template_id=outcome.template_id,
        )

    # ------- History ------------------------------------------------------

    @router.get("/sends")
    async def _sends(
        limit: int = Query(default=100, le=500),
        campaign_id: Optional[str] = None,
        recipient_email: Optional[str] = None,
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ) -> Dict[str, List[Dict[str, Any]]]:
        rows = await list_sends(
            db, limit=limit,
            campaign_id=campaign_id,
            recipient_email=recipient_email,
        )
        return {"sends": rows}

    # ------- Contacts -----------------------------------------------------

    @router.get("/contacts")
    async def _contacts(
        q: Optional[str] = None,
        recipient_type: Optional[str] = None,
        limit: int = Query(default=200, le=500),
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ) -> Dict[str, List[Dict[str, Any]]]:
        rows = await list_contacts(
            db, limit=limit, recipient_type=recipient_type, q=q,
        )
        return {"contacts": rows}

    @router.get("/contacts/{email}")
    async def _contact(
        email: str,
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ) -> Dict[str, Any]:
        row = await get_contact(db, email)
        if not row:
            raise HTTPException(404, "Contact not found")
        return row

    return router


__all__ = ["build_marketing_router"]
