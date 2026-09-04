"""Hard email suppression layer (iter164bd).

A provider-independent, email-keyed suppression list that survives
imports, status changes and provider changes. The authoritative record
lives in the ``email_suppressions`` collection keyed by normalised email
— NOT on the outreach org — so a re-imported spreadsheet can never reset
it. Every send path checks this list by email before sending.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

COLL = "email_suppressions"
REASONS = ("unsubscribed", "hard_bounce", "spam_complaint", "manual")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _norm(email: Optional[str]) -> str:
    return (email or "").strip().lower()


async def is_suppressed(db, email: Optional[str]) -> bool:
    e = _norm(email)
    if not e:
        return False
    return await db[COLL].find_one({"email": e}, {"_id": 1}) is not None


async def get_suppression(db, email: Optional[str]) -> Optional[Dict[str, Any]]:
    return await db[COLL].find_one({"email": _norm(email)}, {"_id": 0})


async def suppressed_set(db, emails: Iterable[str]) -> set:
    norm = list({_norm(e) for e in emails if e})
    if not norm:
        return set()
    cur = db[COLL].find({"email": {"$in": norm}}, {"_id": 0, "email": 1})
    return {d["email"] async for d in cur}


async def suppress_email(db, email: str, *, reason: str, source: str,
                         note: Optional[str] = None) -> Dict[str, Any]:
    e = _norm(email)
    if not e or "@" not in e:
        raise ValueError("A valid email is required to suppress")
    reason = reason if reason in REASONS else "manual"
    now = _now()
    entry = {"at": now, "reason": reason, "source": source, "note": note}
    existing = await db[COLL].find_one({"email": e})
    if existing:
        await db[COLL].update_one({"email": e}, {
            "$set": {"email_suppressed": True, "updated_at": now},
            "$push": {"history": entry},
        })
        return await get_suppression(db, e)
    doc = {
        "id": str(uuid.uuid4()), "email": e, "email_suppressed": True,
        "suppression_reason": reason, "suppressed_at": now,
        "suppressed_source": source, "created_at": now, "updated_at": now,
        "history": [entry],
    }
    await db[COLL].insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


async def filter_recipients(db, recipients: List[dict]) -> List[dict]:
    """Drop any recipient whose email is suppressed. Used by the audience
    resolver so preview/test/real sends all exclude suppressed addresses."""
    if not recipients:
        return recipients
    supp = await suppressed_set(db, [r.get("email") for r in recipients])
    if not supp:
        return recipients
    return [r for r in recipients if _norm(r.get("email")) not in supp]


# ── secure signed unsubscribe token ────────────────────────────────
def _secret() -> str:
    return (os.getenv("UNSUBSCRIBE_SECRET") or os.getenv("JWT_SECRET")
            or os.getenv("RESEND_WEBHOOK_SECRET") or "friendplace-unsub")


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def make_token(email: str) -> str:
    e = _norm(email)
    mac = hmac.new(_secret().encode(), e.encode(), hashlib.sha256).digest()
    return f"{_b64(e.encode())}.{_b64(mac)}"


def verify_token(token: str) -> Optional[str]:
    try:
        payload, sig = (token or "").split(".", 1)
        email = _unb64(payload).decode()
        expected = make_token(email).split(".", 1)[1]
        if hmac.compare_digest(sig, expected):
            return _norm(email)
    except Exception:
        return None
    return None


def unsubscribe_url(email: str) -> str:
    base = (os.getenv("PUBLIC_API_BASE_URL")
            or "https://belong-together.emergent.host").rstrip("/")
    return f"{base}/api/public/unsubscribe?token={make_token(email)}"


async def ensure_indexes(db) -> None:
    await db[COLL].create_index("email", unique=True)


__all__ = [
    "COLL", "REASONS", "is_suppressed", "get_suppression", "suppressed_set",
    "suppress_email", "filter_recipients", "make_token", "verify_token",
    "unsubscribe_url", "ensure_indexes",
]
