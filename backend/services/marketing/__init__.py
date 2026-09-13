"""FriendPlace marketing outbound service (iter159).

Public API:
  - list_templates()                  → catalogue of marketing email templates
  - render_template(...)              → produce personalised HTML + text + subject
  - build_flyer_attachment(...)       → fetch flyer PDF bytes ready for Resend
  - upsert_contact(...)               → save/update a marketing_contacts row
  - record_send(...)                  → persist to marketing_sends
  - send_marketing_email(...)         → the orchestrator used by the router

Privacy invariant (NON-NEGOTIABLE — from Garry's spec):
  Every recipient receives an INDIVIDUAL email. This module NEVER
  places more than one recipient in Resend's `to` list, and NEVER
  includes cc/bcc. The router-level bulk path (P1) must call
  send_marketing_email() once per recipient.
"""

from .templates import (
    MARKETING_TEMPLATES,
    list_templates,
    render_template,
)
from .sends import (
    build_flyer_attachment,
    send_marketing_email,
    record_send,
    list_sends,
)
from .contacts import (
    upsert_contact,
    list_contacts,
)

__all__ = [
    "MARKETING_TEMPLATES",
    "list_templates",
    "render_template",
    "build_flyer_attachment",
    "send_marketing_email",
    "record_send",
    "list_sends",
    "upsert_contact",
    "list_contacts",
]
