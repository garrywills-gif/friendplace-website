"""Unified CRM status service (iter160a).

Computes the current 'contact status' for any person by joining
data across:
    - founding_members
    - outreach_organisations
    - interest_registrations / contact_submissions / support_tickets (enquiries)
    - campaign_recipients (proof we've emailed them)
    - marketing_sends (proof we've one-off emailed them)
    - inbound_replies (proof they've replied) -- populated by 160b

Status output (unified across all sources):
    not_contacted   - we've never sent them anything
    contacted       - we've emailed them, no reply logged
    awaiting_reply  - they replied; we owe them a response
    replied         - we replied to their reply; conversation warm
    joined          - founding member 'joined' status
    declined        - explicit no thanks
    bounced         - deliverability failure
"""
from __future__ import annotations
from typing import Any, Dict, List, Optional


def _lower(x: Optional[str]) -> Optional[str]:
    return x.strip().lower() if isinstance(x, str) and x.strip() else None


async def status_for_email(db, email: str) -> Dict[str, Any]:
    """Return the unified status for a single email.

    Never raises - unknown emails return status='not_contacted'.
    """
    e = _lower(email) or ""
    if not e:
        return {"email": "", "status": "not_contacted", "sources": []}

    ci_email = {"$regex": f"^{__import__('re').escape(e)}$", "$options": "i"}

    fm = await db.founding_members.find_one({"email": ci_email}, {"_id": 0})
    org = await db.outreach_organisations.find_one({"email": e}, {"_id": 0})

    # Every outbound send touching this email
    campaign_recips = await db.campaign_recipients.find(
        {"email": ci_email}, {"_id": 0}
    ).sort("sent_at", -1).to_list(50)
    marketing_sends = await db.marketing_sends.find(
        {"recipient_email": e}, {"_id": 0}
    ).sort("created_at", -1).to_list(50)

    # Inbound replies (160b populates this collection; falls back to org.last_reply_at).
    inbound = []
    try:
        inbound = await db.inbound_replies.find(
            {"from_email": ci_email}, {"_id": 0}
        ).sort("received_at", -1).to_list(50)
    except Exception:
        inbound = []

    # Last outbound "we emailed them" timestamp (any channel).
    outbound_times: List[str] = []
    for r in campaign_recips:
        t = r.get("sent_at") or r.get("created_at")
        if t: outbound_times.append(t)
    for r in marketing_sends:
        t = r.get("created_at")
        if t and r.get("status") == "sent": outbound_times.append(t)
    last_outbound_at = max(outbound_times) if outbound_times else None

    # Last inbound "they replied" timestamp (inbound collection OR org.last_reply_at).
    inbound_times: List[str] = [i.get("received_at") for i in inbound if i.get("received_at")]
    if org and org.get("last_reply_at"):
        inbound_times.append(org["last_reply_at"])
    last_inbound_at = max(inbound_times) if inbound_times else None

    # Also detect if WE replied AFTER their inbound (via outbound reply logs on the org).
    last_our_reply_at: Optional[str] = None
    if org:
        for c in reversed(org.get("communications") or []):
            if c.get("kind") == "reply_outbound":
                last_our_reply_at = c.get("at")
                break

    # ── Decide status ──
    status = "not_contacted"
    reason = "no outbound record"

    if fm and fm.get("status") == "joined":
        status, reason = "joined", "founding member joined"
    elif fm and fm.get("status") == "opted_out":
        status, reason = "unsubscribed", "founding member opted_out"
    elif last_inbound_at and (not last_our_reply_at or last_our_reply_at < last_inbound_at):
        status, reason = "awaiting_reply", "inbound reply not yet answered"
    elif last_our_reply_at and last_inbound_at and last_our_reply_at >= last_inbound_at:
        status, reason = "replied", "we replied after their inbound"
    elif last_outbound_at:
        status, reason = "contacted", "outbound send, no reply yet"

    return {
        "email":            e,
        "status":           status,
        "reason":           reason,
        "last_outbound_at": last_outbound_at,
        "last_inbound_at":  last_inbound_at,
        "last_our_reply_at": last_our_reply_at,
        "sources": {
            "founding_member": bool(fm),
            "outreach_org":    bool(org),
            "campaign_recipients_count": len(campaign_recips),
            "marketing_sends_count":     len(marketing_sends),
            "inbound_replies_count":     len(inbound),
        },
        "founding_member_status": fm.get("status") if fm else None,
        "outreach_status": org.get("status") if org else None,
    }


async def list_awaiting_reply(db, *, limit: int = 200) -> List[Dict[str, Any]]:
    """People we owe a reply to: outreach_organisations.status='awaiting_reply'
    OR any inbound_replies without an outbound reply after.

    Ordered oldest-inbound-first so genuinely-stale threads surface first
    (Elizabeth's 13 Aug email should appear before someone who wrote yesterday).
    """
    out: List[Dict[str, Any]] = []
    seen_emails: set = set()

    # 1) Outreach orgs explicitly in awaiting_reply
    async for org in db.outreach_organisations.find(
        {"status": "awaiting_reply", "is_test": {"$ne": True}}, {"_id": 0},
    ).sort("last_reply_at", 1).limit(limit):
        e = _lower(org.get("email"))
        if e and e not in seen_emails:
            seen_emails.add(e)
            out.append({
                "email":            e,
                "name":             org.get("contact_name") or org.get("organisation_name"),
                "organisation":     org.get("organisation_name"),
                "source":           "outreach_organisation",
                "source_id":        org.get("id"),
                "last_inbound_at":  org.get("last_reply_at"),
                "last_outbound_at": org.get("last_contact_at"),
            })

    # 2) inbound_replies collection (populated by 160b). Report any inbound
    #    whose thread has no outbound reply after the inbound arrived.
    try:
        async for rep in db.inbound_replies.find(
            {"resolved": {"$ne": True}}, {"_id": 0},
        ).sort("received_at", 1).limit(limit):
            e = _lower(rep.get("from_email"))
            if not e or e in seen_emails: continue
            seen_emails.add(e)
            out.append({
                "email":         e,
                "name":          rep.get("from_name") or e,
                "organisation":  rep.get("organisation_name"),
                "source":        "inbound_reply",
                "source_id":     rep.get("id"),
                "last_inbound_at":  rep.get("received_at"),
                "campaign_id":   rep.get("campaign_id"),
                "subject":       rep.get("subject"),
            })
    except Exception:
        pass

    return out[:limit]


async def list_needs_follow_up(
    db, *, days_since_last_contact: int = 7, limit: int = 200,
) -> List[Dict[str, Any]]:
    """Outreach orgs where we sent something >= N days ago and got no reply."""
    from datetime import datetime, timezone, timedelta
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days_since_last_contact)).isoformat()
    out: List[Dict[str, Any]] = []
    async for org in db.outreach_organisations.find(
        {"status": "contacted",
         "last_contact_at": {"$lte": cutoff},
         "is_test": {"$ne": True}},
        {"_id": 0},
    ).sort("last_contact_at", 1).limit(limit):
        out.append({
            "email":            org.get("email"),
            "name":             org.get("contact_name") or org.get("organisation_name"),
            "organisation":     org.get("organisation_name"),
            "source":           "outreach_organisation",
            "source_id":        org.get("id"),
            "last_outbound_at": org.get("last_contact_at"),
        })
    return out


__all__ = ["status_for_email", "list_awaiting_reply", "list_needs_follow_up"]
