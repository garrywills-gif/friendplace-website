"""Resend webhook receiver — CRM Phase 2B (Delivery & Engagement).

Public endpoint that receives per-email events from Resend after we
send a campaign. Every event is verified, deduped, stored raw for
audit/replay, and folded into a live timeline + rollup counters that
the Mission Control dashboard and George's KB can reason over.

Design principles (Garry, 1 Aug 2026):
  1. **Every email is a timeline, not just a status** — keep the full
     event history per recipient (`campaign_recipient_events`) so
     "she says she never got it" is answerable with a single query.
  2. **Keep raw payloads** — `resend_webhook_events` retains every
     signed webhook body for at least 90 days so stats can be
     rebuilt if a rollup ever drifts.
  3. **Rollups are cached, not authoritative** — recompute is always
     possible from the raw log.
  4. **Idempotent** — Resend retries on 5xx, so we dedupe by the
     Svix message id (`svix-id` header). Second delivery = 200 OK
     with no side-effect.
  5. **Verified** — signature verified with HMAC-SHA256 following
     Svix's spec (Resend uses Svix for signing). Requests older
     than 5 minutes are rejected as replay attempts.
  6. **Fail closed** — if `RESEND_WEBHOOK_SECRET` is unset AND
     `WEBHOOKS_ALLOW_UNSIGNED` is not explicitly "true", we return
     401. This means the endpoint is safe to deploy before the
     secret is pasted in.

Data model:
    resend_webhook_events   – raw signed payloads, dedupe key = svix_id
    campaign_recipient_events – per-recipient timeline (sent/delivered/opened/…)
    campaign_recipients     – extended with rollup fields (delivered_at, …)
    campaigns.stats         – campaign-wide counters (delivered, opened, …)

Endpoint (see `campaign_webhooks_router`):
    POST /api/webhooks/resend
        Headers:  svix-id, svix-timestamp, svix-signature
        Body:     Resend event JSON
        Returns:  200 {ok: True} on accept
                  401 on bad signature / missing secret
                  400 on malformed body / stale timestamp
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, Request

log = logging.getLogger("friendplace.webhooks.resend")

# ── Collections ────────────────────────────────────────────────────
RAW_COLL = "resend_webhook_events"       # verbatim payloads, 90-day TTL
EVENTS_COLL = "campaign_recipient_events"  # per-recipient timeline
RECIP_COLL = "campaign_recipients"        # rollup fields on existing docs
CAMPAIGNS_COLL = "campaigns"              # campaign-wide stats

# Retention: 90 days on the raw event log. Rollups + timeline are kept
# indefinitely — they're small (a handful of events per recipient) and
# invaluable for CS ("she says she never got it, prove otherwise").
RAW_TTL_SECONDS = 60 * 60 * 24 * 90

# Reject webhooks whose Svix timestamp is more than this many seconds
# stale — replay protection. 5 minutes matches Svix's default tolerance.
MAX_TIMESTAMP_DRIFT_SECONDS = 5 * 60


# ── Event type mapping ────────────────────────────────────────────
#
# Full list of Resend events + how they update the recipient rollup.
# Keep the vocabulary lower-snake so the frontend can render pills
# directly from `type` without a translation table.
EVENT_ROLLUP_FIELD = {
    "email.sent":              "sent_at",          # already set on send; webhook confirms
    "email.delivered":         "delivered_at",
    "email.delivery_delayed":  "delayed_at",
    "email.opened":            "first_opened_at",  # first only; count separately
    "email.clicked":           "first_clicked_at",
    "email.bounced":           "bounced_at",
    "email.complained":        "complained_at",
}

# Events that increment a counter rather than only setting a timestamp.
COUNTER_FIELD = {
    "email.opened":  "open_count",
    "email.clicked": "click_count",
}

# Campaign-wide status counters (mirrored on `campaigns.stats.*`).
CAMPAIGN_STAT_KEY = {
    "email.sent":              "sent",
    "email.delivered":         "delivered",
    "email.delivery_delayed":  "delayed",
    "email.opened":            "opened",
    "email.clicked":           "clicked",
    "email.bounced":           "bounced",
    "email.complained":        "complained",
}


# ── Index setup ───────────────────────────────────────────────────
async def ensure_indexes(db: Any) -> None:
    """Idempotent index creation. Called once on FastAPI startup."""
    try:
        # Raw event log — unique on svix_id (dedupe) + TTL on inserted_at.
        await db[RAW_COLL].create_index("svix_id", unique=True, name="svix_id_unique")
        await db[RAW_COLL].create_index(
            "inserted_at", expireAfterSeconds=RAW_TTL_SECONDS, name="ttl_inserted_at",
        )
        # Timeline — most common lookup is "give me all events for this
        # recipient, oldest first".
        await db[EVENTS_COLL].create_index(
            [("recipient_id", 1), ("at", 1)], name="recipient_at",
        )
        await db[EVENTS_COLL].create_index(
            [("campaign_id", 1), ("at", -1)], name="campaign_at_desc",
        )
        await db[EVENTS_COLL].create_index("resend_email_id", name="resend_email_id")
    except Exception as e:  # noqa: BLE001 — indexes are best-effort at boot
        log.warning("campaign_webhooks ensure_indexes failed: %s", e)


# ── Svix signature verification ───────────────────────────────────
#
# Reference: https://docs.svix.com/receiving/verifying-payloads/how-manual
# Signature header shape:   "v1,BASE64SIG v1,ANOTHERSIG ..."
# Signed content:           "{svix_id}.{svix_timestamp}.{raw_body}"
# HMAC:                     SHA-256 keyed by the secret bytes.
# Secret env value shape:   "whsec_BASE64PART"  → we strip the prefix
#                           and base64-decode the remainder before use.
def _decode_secret(secret: str) -> bytes:
    """Decode Resend/Svix secret into raw HMAC key bytes."""
    if not secret:
        return b""
    s = secret.strip()
    if s.startswith("whsec_"):
        s = s[len("whsec_"):]
    # Some tenants receive the raw base64 already; be tolerant.
    try:
        return base64.b64decode(s)
    except Exception:
        # If it's not base64, treat the raw string as the key bytes —
        # tolerate lightly so a mispaste still surfaces a clear
        # "signature mismatch" instead of a crash.
        return s.encode("utf-8")


def _extract_signatures(header_value: str) -> list[str]:
    """Turn 'v1,SIG1 v1,SIG2' into ['SIG1', 'SIG2']."""
    out: list[str] = []
    for tok in (header_value or "").split():
        if "," in tok:
            _ver, sig = tok.split(",", 1)
            sig = sig.strip()
            if sig:
                out.append(sig)
    return out


def verify_signature(
    *,
    secret: str,
    svix_id: str,
    svix_timestamp: str,
    svix_signature: str,
    raw_body: bytes,
) -> tuple[bool, Optional[str]]:
    """Return (ok, reason). Reason is populated only on failure."""
    if not (svix_id and svix_timestamp and svix_signature):
        return False, "missing_svix_headers"
    # Replay protection.
    try:
        ts = int(svix_timestamp)
    except Exception:
        return False, "bad_timestamp"
    now = int(time.time())
    if abs(now - ts) > MAX_TIMESTAMP_DRIFT_SECONDS:
        return False, "stale_timestamp"

    key = _decode_secret(secret)
    if not key:
        return False, "no_secret_configured"

    signed = f"{svix_id}.{svix_timestamp}.".encode("utf-8") + raw_body
    expected = base64.b64encode(hmac.new(key, signed, hashlib.sha256).digest()).decode("ascii")

    for sig in _extract_signatures(svix_signature):
        if hmac.compare_digest(sig, expected):
            return True, None
    return False, "signature_mismatch"


# ── Event dispatcher ──────────────────────────────────────────────
async def _resolve_recipient(db: Any, resend_email_id: Optional[str]) -> Optional[dict]:
    """Look up the campaign_recipient this event pertains to.

    Resend gives us an email_id (their internal id) which we stored on
    the recipient row at send time as `message_id`. That's our join key.
    """
    if not resend_email_id:
        return None
    return await db[RECIP_COLL].find_one({"message_id": resend_email_id})


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _persist_timeline_event(
    db: Any,
    *,
    recipient: dict,
    evt_type: str,
    at: str,
    payload_data: dict,
) -> None:
    """Append an entry to the per-recipient timeline. Best-effort — the
    rollup is still recorded even if the timeline write fails."""
    doc = {
        "id":                str(uuid.uuid4()),
        "campaign_id":       recipient.get("campaign_id"),
        "recipient_id":      recipient.get("id"),
        "founder_id":        recipient.get("founder_id"),
        "email":             recipient.get("email"),
        "type":              evt_type,
        "at":                at,
        "resend_email_id":   payload_data.get("email_id"),
        # Small subset of the payload we surface in the UI drill-down.
        "meta": {
            "link_url":     (payload_data.get("click") or {}).get("link"),
            "bounce_type":  (payload_data.get("bounce") or {}).get("type"),
            "bounce_msg":   (payload_data.get("bounce") or {}).get("message"),
            "subject":      payload_data.get("subject"),
        },
    }
    try:
        await db[EVENTS_COLL].insert_one(doc)
    except Exception as e:  # noqa: BLE001
        log.warning("timeline insert failed for recipient %s / %s: %s",
                    recipient.get("id"), evt_type, e)


async def _apply_recipient_rollup(
    db: Any,
    *,
    recipient: dict,
    evt_type: str,
    at: str,
    payload_data: dict,
) -> None:
    """Update campaign_recipients with the latest event's rollup fields."""
    set_fields: dict[str, Any] = {
        "last_event_type": evt_type,
        "last_event_at":   at,
    }
    # Set the type-specific timestamp field (only if it's not already
    # set — first opened / first clicked stay "first").
    field = EVENT_ROLLUP_FIELD.get(evt_type)
    if field:
        if field.startswith("first_") and recipient.get(field):
            pass  # keep the original first-open / first-click
        else:
            set_fields[field] = at

    # Status transitions for terminal events.
    if evt_type == "email.bounced":
        set_fields["status"] = "bounced"
        b = (payload_data.get("bounce") or {})
        if b.get("type"):
            set_fields["bounce_type"] = b.get("type")
        if b.get("message"):
            set_fields["bounce_message"] = b.get("message")
    elif evt_type == "email.complained":
        set_fields["status"] = "complained"
    elif evt_type == "email.delivered" and (recipient.get("status") or "").lower() in (
        "", "sent", "delayed"
    ):
        set_fields["status"] = "delivered"

    update: dict[str, Any] = {"$set": set_fields}
    counter_field = COUNTER_FIELD.get(evt_type)
    if counter_field:
        update["$inc"] = {counter_field: 1}

    try:
        await db[RECIP_COLL].update_one({"id": recipient["id"]}, update)
    except Exception as e:  # noqa: BLE001
        log.warning("recipient rollup failed for %s / %s: %s",
                    recipient.get("id"), evt_type, e)


async def _apply_campaign_stats(
    db: Any,
    *,
    campaign_id: Optional[str],
    evt_type: str,
    recipient: dict,
    was_first: bool,
) -> None:
    """Increment `campaigns.stats.<key>`. `was_first` is True only for
    the FIRST open / first click on this recipient — used to also bump
    the unique-count metric that the dashboard renders as open-rate."""
    if not campaign_id:
        return
    key = CAMPAIGN_STAT_KEY.get(evt_type)
    if not key:
        return
    inc: dict[str, int] = {f"stats.{key}": 1}
    if evt_type == "email.opened" and was_first:
        inc["stats.unique_opens"] = 1
    if evt_type == "email.clicked" and was_first:
        inc["stats.unique_clicks"] = 1
    try:
        await db[CAMPAIGNS_COLL].update_one(
            {"id": campaign_id}, {"$inc": inc, "$set": {"stats.last_event_at": _now_iso()}},
        )
    except Exception as e:  # noqa: BLE001
        log.warning("campaign stats bump failed for %s / %s: %s",
                    campaign_id, evt_type, e)


async def _flag_founder_if_needed(
    db: Any,
    *,
    recipient: dict,
    evt_type: str,
    at: str,
) -> None:
    """Terminal-event flags on the founder record — protects our sender
    reputation by never re-sending to a bad address or complainer."""
    founder_id = recipient.get("founder_id")
    if not founder_id:
        return
    if evt_type == "email.bounced":
        try:
            await db.interest_registrations.update_one(
                {"id": founder_id},
                {"$set": {
                    "email_invalid":    True,
                    "email_invalid_at": at,
                    "email_invalid_reason": "bounce",
                }},
            )
        except Exception as e:  # noqa: BLE001
            log.warning("founder bounce flag failed for %s: %s", founder_id, e)
    elif evt_type == "email.complained":
        try:
            await db.interest_registrations.update_one(
                {"id": founder_id},
                {"$set": {
                    "status":              "opted_out",
                    "opted_out_at":        at,
                    "opted_out_reason":    "spam_complaint",
                }},
            )
        except Exception as e:  # noqa: BLE001
            log.warning("founder complaint flag failed for %s: %s", founder_id, e)


async def handle_event(db: Any, event: dict, raw_body_len: int) -> dict:
    """Dispatch a Resend event to the appropriate rollup + timeline."""
    evt_type = event.get("type") or event.get("event") or "unknown"
    data = event.get("data") or {}
    resend_email_id = data.get("email_id") or data.get("id")
    at = event.get("created_at") or data.get("created_at") or _now_iso()

    recipient = await _resolve_recipient(db, resend_email_id)
    if not recipient:
        # Not one of our campaigns — could be a transactional email
        # (password reset, RYI ack). Log and move on; not an error.
        log.info(
            "resend webhook: no matching recipient (type=%s email_id=%s body_len=%s)",
            evt_type, resend_email_id, raw_body_len,
        )
        return {"ok": True, "matched": False, "type": evt_type}

    # Detect "first open/click" BEFORE we mutate, so we can bump the
    # unique-open / unique-click campaign counter accurately.
    was_first = False
    if evt_type == "email.opened":
        was_first = not recipient.get("first_opened_at")
    elif evt_type == "email.clicked":
        was_first = not recipient.get("first_clicked_at")

    await _persist_timeline_event(
        db, recipient=recipient, evt_type=evt_type, at=at, payload_data=data,
    )
    await _apply_recipient_rollup(
        db, recipient=recipient, evt_type=evt_type, at=at, payload_data=data,
    )
    await _apply_campaign_stats(
        db, campaign_id=recipient.get("campaign_id"),
        evt_type=evt_type, recipient=recipient, was_first=was_first,
    )
    await _flag_founder_if_needed(
        db, recipient=recipient, evt_type=evt_type, at=at,
    )

    # Anomaly evaluation — after every bounce / complaint we recheck
    # the campaign, and on a low-rate schedule after opens/clicks.
    # Best-effort: never fail the webhook because anomaly detection had
    # a hiccup. See services/campaign_anomalies.py for the rule set.
    try:
        from services import campaign_anomalies as _anom
        # Cheap events (opens/clicks/delivered) don't need re-evaluation
        # on every fire — only on state-changing terminal events. Keeps
        # signal volume calm and avoids re-writing the same case on
        # every open. Bounce and complaint always trigger.
        should_evaluate = evt_type in (
            "email.bounced", "email.complained", "email.delivered", "email.delivery_delayed",
        )
        if should_evaluate and recipient.get("campaign_id"):
            await _anom.evaluate_and_signal(db, recipient["campaign_id"])
    except Exception as e:  # noqa: BLE001
        log.warning("anomaly evaluation raised (non-fatal): %s", e)

    return {"ok": True, "matched": True, "type": evt_type,
            "recipient_id": recipient.get("id"),
            "campaign_id":  recipient.get("campaign_id")}


# ── Router factory ────────────────────────────────────────────────
def build_router(db: Any) -> APIRouter:
    """Build the FastAPI router for Resend webhooks.

    Mounted at /api/webhooks/* in server.py (public — no auth). Access
    control is provided by the Svix signature check.
    """
    router = APIRouter()

    @router.post("/webhooks/resend")
    async def resend_webhook(
        request: Request,
        svix_id: Optional[str] = Header(default=None, alias="svix-id"),
        svix_timestamp: Optional[str] = Header(default=None, alias="svix-timestamp"),
        svix_signature: Optional[str] = Header(default=None, alias="svix-signature"),
    ):
        raw = await request.body()
        secret = os.getenv("RESEND_WEBHOOK_SECRET", "").strip()
        allow_unsigned = os.getenv("WEBHOOKS_ALLOW_UNSIGNED", "").strip().lower() == "true"

        # Signature verification.
        if secret:
            ok, reason = verify_signature(
                secret=secret,
                svix_id=svix_id or "",
                svix_timestamp=svix_timestamp or "",
                svix_signature=svix_signature or "",
                raw_body=raw,
            )
            if not ok:
                log.warning("resend webhook rejected: %s", reason)
                # 401 for signature failures; 400 for stale/bad timestamp so
                # Resend's retry policy behaves sensibly.
                if reason in ("stale_timestamp", "bad_timestamp"):
                    raise HTTPException(400, f"webhook: {reason}")
                raise HTTPException(401, f"webhook: {reason}")
        elif not allow_unsigned:
            log.warning("resend webhook rejected: no secret configured")
            raise HTTPException(401, "webhook: RESEND_WEBHOOK_SECRET not set")
        else:
            log.warning(
                "resend webhook: PROCESSING UNSIGNED — %s bytes, svix-id=%s. "
                "This is only safe for local dev. Set RESEND_WEBHOOK_SECRET "
                "and remove WEBHOOKS_ALLOW_UNSIGNED before enabling in prod.",
                len(raw), svix_id,
            )

        # Parse.
        try:
            event = json.loads(raw.decode("utf-8"))
        except Exception:
            raise HTTPException(400, "webhook: invalid JSON body")

        # Idempotency — insert-or-noop on svix_id.
        dedupe_id = svix_id or f"noid-{uuid.uuid4()}"
        try:
            await db[RAW_COLL].insert_one({
                "svix_id":     dedupe_id,
                "type":        event.get("type") or event.get("event"),
                "created_at":  event.get("created_at"),
                "inserted_at": datetime.now(timezone.utc),
                "payload":     event,
                "raw_len":     len(raw),
                "verified":    bool(secret),
            })
        except Exception as e:  # duplicate key = replay → ack silently
            # DuplicateKeyError has code 11000; motor exposes it under
            # pymongo.errors. Import lazily to keep this module lean.
            from pymongo.errors import DuplicateKeyError
            if isinstance(e, DuplicateKeyError):
                log.info("resend webhook: replay ignored (svix_id=%s)", dedupe_id)
                return {"ok": True, "replay": True}
            log.exception("resend webhook: raw insert failed")
            # Still process below — we'd rather double-count than drop.

        result = await handle_event(db, event, raw_body_len=len(raw))
        return result

    # ── Ops helpers (unauthenticated ping to prove the endpoint is
    # reachable — no side effects, safe to poll). Also useful for
    # Resend's "Test" button which doesn't hit /webhooks/resend at all.
    @router.get("/webhooks/resend/health")
    async def resend_webhook_health():
        secret_set = bool(os.getenv("RESEND_WEBHOOK_SECRET", "").strip())
        allow_unsigned = os.getenv("WEBHOOKS_ALLOW_UNSIGNED", "").strip().lower() == "true"
        return {
            "ok":              True,
            "secret_configured": secret_set,
            "allow_unsigned":  allow_unsigned,
            "route":           "/api/webhooks/resend",
        }

    return router
