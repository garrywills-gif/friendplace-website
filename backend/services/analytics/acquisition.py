"""
Acquisition-tracking helpers.

Provides:

- ``parse_acquisition(payload)`` — coerces free-form UTM-ish fields from
  a public HTTP payload into a canonical ``acquisition`` sub-document.
- ``attach_acquisition_to_registration()`` — used by the interest-registration
  write path to persist the object AND (best-effort) link a bridge_event.

The canonical shape is::

    acquisition: {
        "channel":      "flyer" | "qr" | "campaign" | "web" | "referral" | "organic",
        "flyer_id":     str | None,   # FK to flyer_templates.key
        "qr_code_id":   str | None,   # opaque id printed on the flyer
        "campaign_id":  str | None,   # FK to campaigns.id
        "ref_source":   str | None,   # generic UTM-like tag
        "captured_at":  ISO datetime,
    }
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from motor.motor_asyncio import AsyncIOMotorDatabase

from .bridge import coerce_channel, mark_conversion


def _clean(v: Any, max_len: int = 120) -> Optional[str]:
    """Trim + length-cap a free-text field. Returns None for empties."""
    if v is None:
        return None
    s = str(v).strip()[:max_len]
    return s or None


def parse_acquisition(payload: dict[str, Any]) -> dict[str, Any]:
    """Extract a canonical ``acquisition`` object from a public payload.

    Accepts either an ``acquisition: {...}`` sub-object OR flat top-level
    fields (``acq_channel``, ``acq_flyer_id``, ``acq_qr_code_id``,
    ``acq_campaign_id``, ``acq_ref_source``). Front-ends built for the
    Bridge landing page pass the flat form; QR URLs pass the sub-object.
    """
    if isinstance(payload.get("acquisition"), dict):
        raw = payload["acquisition"]
    else:
        raw = {
            "channel": payload.get("acq_channel"),
            "flyer_id": payload.get("acq_flyer_id"),
            "qr_code_id": payload.get("acq_qr_code_id"),
            "campaign_id": payload.get("acq_campaign_id"),
            "ref_source": payload.get("acq_ref_source"),
        }

    return {
        "channel": coerce_channel(raw.get("channel")),
        "flyer_id": _clean(raw.get("flyer_id"), 120),
        "qr_code_id": _clean(raw.get("qr_code_id"), 120),
        "campaign_id": _clean(raw.get("campaign_id"), 120),
        "ref_source": _clean(raw.get("ref_source"), 120),
        "captured_at": datetime.now(timezone.utc).isoformat(),
    }


async def attach_acquisition_to_registration(
    db: AsyncIOMotorDatabase,
    *,
    registration_id: str,
    acquisition: dict[str, Any],
) -> Optional[str]:
    """After creating a registration, link the most recent bridge_event
    (matching the acquisition attribution) to it. Returns the linked
    event id, or None when no match was found.

    Called AFTER the registration doc has already been inserted so the
    linked event carries the real registration id, not a placeholder.
    """
    return await mark_conversion(
        db,
        qr_code_id=acquisition.get("qr_code_id"),
        flyer_id=acquisition.get("flyer_id"),
        campaign_id=acquisition.get("campaign_id"),
        ref_source=acquisition.get("ref_source"),
        registration_id=registration_id,
    )


__all__ = ["parse_acquisition", "attach_acquisition_to_registration"]
