"""Organisation Outreach reconciliation.

WHY
───
The Vercel-deployed ``/admin/outreach`` page currently shows 0
organisations because ``outreach_organisations`` is empty. Garry believes
historical outreach touches (spreadsheet imports, campaign sends,
retirement-village replies, RSL / library contacts, etc.) may still
exist in adjacent collections. This script:

    1. Scans every accessible collection for organisation-shaped records
       (has ``organisation_name`` + a contact channel like email/phone).
    2. De-duplicates against ``outreach_organisations`` by email
       (case-insensitive) and by normalised organisation name.
    3. Upserts each fresh find into ``outreach_organisations`` using the
       canonical outreach schema (name/contact_email/contact_phone/…).
    4. Cross-references send history (``email_test_log`` +
       ``campaign_recipients``) and, for any org whose contact_email
       matches a successful send, marks it ``contacted`` with
       ``last_contact_at`` set to the most-recent successful send.

INVARIANTS
──────────
- **Never overwrites** an existing ``outreach_organisations`` record. The
  script upserts NEW rows only; existing rows keep every field including
  ``status``, ``notes``, ``tags``, ``communications``.
- **Never invents data**. Every reconciled row is traceable to a source
  document (recorded in ``reconciled_from``).
- **Idempotent**. Running twice never duplicates. Email is the natural
  key; a stable synthetic email is generated only when the source lacks
  one so the dedupe surface is still deterministic.
- **Dry-run by default**. Use ``--commit`` to actually write.

USAGE
─────
    python /app/backend/scripts/outreach_reconcile.py            # dry-run
    python /app/backend/scripts/outreach_reconcile.py --commit   # write
    python /app/backend/scripts/outreach_reconcile.py --commit --verbose
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv  # noqa: E402
load_dotenv(BACKEND_DIR / ".env")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

import os  # noqa: E402


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _norm_email(v: Any) -> str:
    if not isinstance(v, str):
        return ""
    return v.strip().lower()


def _norm_name(v: Any) -> str:
    if not isinstance(v, str):
        return ""
    return re.sub(r"\s+", " ", v.strip().lower())


def _is_test_email(email: str) -> bool:
    """Best-effort filter for obvious test/synthetic addresses.

    We never want to seed outreach with @example.com / TEST_ /
    @nowhere.local style addresses. Real production data is out of
    scope of these heuristics and stays intact.
    """
    if not email:
        return True
    if "@" not in email:
        return True
    return (
        email.endswith("@example.com")
        or email.endswith("@x.com")
        or email.endswith("@nowhere.local")
        or "test" in email.split("@")[0].lower()
        or email.startswith("garry+iter")
        or "timeline-test" in email
        or "campaign-test" in email
    )


# ─── Source scanners ────────────────────────────────────────────────
#
# Each scanner yields ``candidate`` dicts of the form:
#   {
#     "organisation_name": str,   # required, non-empty
#     "contact_email":     str,   # may be "" if no channel
#     "contact_phone":     str,
#     "contact_name":      str,
#     "category":          str,   # optional freeform
#     "suburb":            str,
#     "state":             str,
#     "notes":             str,
#     "source_collection": str,   # e.g. "cms_event_submissions"
#     "source_id":         str,   # source document's id
#     "source_created_at": str,
#   }
#
# We deliberately DO NOT copy source-side status/tags/dates onto the
# outreach row — those semantics belong to the outreach system.


async def _scan_event_submissions(db) -> List[Dict[str, Any]]:
    """cms_event_submissions rows carry organisation_name +
    contact_email/phone. Each represents an org that reached out to us
    to run an event. That's a legitimate outreach relationship.

    Filters (conservative — we'd rather miss a legit row than seed a
    test one):
      • status must not be ``rejected`` — rejected submissions are the
        moderation bin, not evidence of a real relationship.
      • reviewer_notes hinting the submission was a QA test (matches
        /test|reject.*button|ping|smoke/i) drops the row.
      • obvious test / synthetic emails (@example.com etc.) drop it too.
    """
    out: List[Dict[str, Any]] = []
    cursor = db.cms_event_submissions.find(
        {"organisation_name": {"$type": "string", "$ne": ""}},
        {"_id": 0},
    )
    async for d in cursor:
        name = (d.get("organisation_name") or "").strip()
        email = _norm_email(d.get("contact_email"))
        if not name:
            continue
        if (d.get("status") or "").lower() == "rejected":
            continue
        reviewer_notes = (d.get("reviewer_notes") or "").lower()
        if re.search(r"\btest\b|reject.*button|\bping\b|smoke", reviewer_notes):
            continue
        # Also drop obvious test names/emails.
        if email and _is_test_email(email):
            continue
        if name.lower() in ("ping", "test", "test org") or "test" in name.lower():
            continue
        out.append({
            "organisation_name": name,
            "contact_email":     email,
            "contact_phone":     (d.get("contact_phone") or "").strip(),
            "contact_name":      (d.get("contact_name") or "").strip(),
            "category":          "event_submission",
            "suburb":            "",
            "state":             "",
            "notes":             f"Reconciled from event submission {d.get('submission_ref') or d.get('id')}",
            "source_collection": "cms_event_submissions",
            "source_id":         d.get("id"),
            "source_created_at": d.get("created_at"),
        })
    return out


async def _scan_interest_registrations_organisation_tag(db) -> List[Dict[str, Any]]:
    """interest_registrations that carry an explicit organisation-facing
    tag or an ``organisation_name`` field. Personal registrations
    (default shape) are ignored — they belong on the Founding Members
    CRM, not on Outreach."""
    out: List[Dict[str, Any]] = []
    q = {
        "$or": [
            {"tags": {"$in": ["organisation", "organization", "outreach"]}},
            {"organisation_name": {"$type": "string", "$ne": ""}},
            {"organisation":      {"$type": "string", "$ne": ""}},
        ],
    }
    cursor = db.interest_registrations.find(q, {"_id": 0})
    async for d in cursor:
        name = (
            (d.get("organisation_name") or d.get("organisation") or "").strip()
        )
        if not name:
            # A tagged-but-unnamed row: fall back to first_name only if
            # it clearly looks like an org name (has "RSL", "Village",
            # "Library" etc.).
            fn = (d.get("first_name") or "").strip()
            if re.search(r"\b(rsl|village|library|club|council|centre|community)\b", fn, re.I):
                name = fn
        if not name:
            continue
        email = _norm_email(d.get("email"))
        out.append({
            "organisation_name": name,
            "contact_email":     email,
            "contact_phone":     (d.get("phone") or d.get("contact_phone") or "").strip(),
            "contact_name":      (d.get("contact_name") or d.get("first_name") or "").strip(),
            "category":          (d.get("category") or "interest_registration").strip(),
            "suburb":            "",
            "state":             (d.get("state_country") or "").strip(),
            "notes":             f"Reconciled from interest registration {d.get('id')}",
            "source_collection": "interest_registrations",
            "source_id":         d.get("id"),
            "source_created_at": d.get("created_at"),
        })
    return out


SOURCES = [
    _scan_event_submissions,
    _scan_interest_registrations_organisation_tag,
]


# ─── Extended scanners: campaigns + marketing contacts ─────────────
#
# Rationale (added iter168b after Garry pointed out the Retirement
# Village outreach campaigns): the audience system's ``_resolve_audience``
# resolves each campaign against ``interest_registrations`` and then
# writes one row per recipient into ``campaign_recipients``. That means
# **the definitive source of truth for who was actually emailed on an
# outreach campaign is ``campaign_recipients``**, not the audience
# filter (which is misleading — everything shows "All Founding Members"
# in the label). So we scan ``campaigns`` for outreach-flavoured
# name/title/subject, then unwind each into its recipient list, and
# reconcile each unique email into ``outreach_organisations`` with the
# delivery history preserved.

# Regex that identifies outreach-flavoured campaigns by title.
_OUTREACH_CAMPAIGN_RX = re.compile(
    r"retirement\s*villages?|\brsl\b|\blibrary\b|\bcouncil\b|"
    r"\bcommunity\s*centre\b|outreach|organisations?",
    re.IGNORECASE,
)


def _campaign_status_to_org_status(recipient_status: str) -> str:
    """Map a campaign_recipients ``status`` value to an outreach status.

    Only used when we're SEEDING a fresh org row. Existing orgs are
    never regressed.
    """
    s = (recipient_status or "").lower()
    if s in ("delivered", "opened", "clicked", "sent"):
        return "contacted"
    if s == "bounced":
        return "bounced"
    if s == "complained":
        return "unsubscribed"
    if s in ("failed",):
        return "bounced"
    return "not_contacted"


def _rec_evidence_at(rec: Dict[str, Any]) -> Optional[str]:
    """Best available timestamp on a campaign_recipients row."""
    for k in ("delivered_at", "sent_at", "first_opened_at",
             "first_clicked_at", "bounced_at", "complained_at",
             "last_event_at"):
        v = rec.get(k)
        if v:
            return v
    return None


async def _scan_campaigns_and_recipients(db) -> List[Dict[str, Any]]:
    """Walk every campaign whose title matches the outreach regex, then
    walk its ``campaign_recipients`` rows and yield one candidate per
    unique recipient. Recipient's ``first_name`` becomes the tentative
    organisation_name — imperfect but honest: the frontend can rename
    from the detail page. Notes carry the campaign trail.

    Also included: any campaign_recipients row whose ``email`` does NOT
    appear in ``interest_registrations`` (i.e. it wasn't resolved from
    the founder list) — that's a strong signal it's an outreach org
    even if the campaign title is generic.
    """
    out: List[Dict[str, Any]] = []

    # ── 1. Campaigns whose title matches the outreach regex ──
    match_campaigns: List[Dict[str, Any]] = []
    async for c in db.campaigns.find({}, {"_id": 0}):
        for k in ("name", "title", "subject"):
            if isinstance(c.get(k), str) and _OUTREACH_CAMPAIGN_RX.search(c[k]):
                match_campaigns.append(c)
                break

    # ── 2. Build a founder-email set once, for cross-check ──
    founder_emails: set[str] = set()
    async for r in db.interest_registrations.find({}, {"_id": 0, "email": 1}):
        e = _norm_email(r.get("email"))
        if e:
            founder_emails.add(e)

    # ── 3. Emit candidates from every recipient of matched campaigns ─
    seen_here: Dict[str, Dict[str, Any]] = {}
    for c in match_campaigns:
        cid = c.get("id")
        camp_name = c.get("name") or c.get("title") or "Outreach campaign"
        async for r in db.campaign_recipients.find({"campaign_id": cid}, {"_id": 0}):
            email = _norm_email(r.get("email"))
            if not email or _is_test_email(email):
                continue
            name = (r.get("first_name") or "").strip() or camp_name
            entry = seen_here.get(email)
            evidence_at = _rec_evidence_at(r)
            comm = {
                "at": evidence_at,
                "kind": f"campaign_{r.get('status') or 'send'}",
                "direction": "outbound",
                "subject": r.get("subject") or c.get("subject") or "",
                "campaign_id": cid,
                "campaign_name": camp_name,
                "status": r.get("status"),
                "message_id": r.get("message_id"),
                "bounce_type": r.get("bounce_type"),
                "bounce_message": r.get("bounce_message"),
                "by": "system:outreach_reconcile",
            }
            if entry is None:
                seen_here[email] = {
                    "organisation_name": name,
                    "contact_email": email,
                    "contact_phone": "",
                    "contact_name": "",
                    "category": "retirement_village" if re.search(r"retirement|village", camp_name, re.I) else "outreach",
                    "suburb": "",
                    "state": "",
                    "notes": f"Reconciled from campaign '{camp_name}'.",
                    "source_collection": "campaign_recipients",
                    "source_id": r.get("id"),
                    "source_created_at": evidence_at,
                    "_history": [comm],
                    "_status_from_recipients": _campaign_status_to_org_status(r.get("status", "")),
                    "_last_contact_at": evidence_at,
                }
            else:
                entry["_history"].append(comm)
                # Prefer the most-recent evidence for last_contact_at.
                if evidence_at and (
                    entry["_last_contact_at"] is None
                    or evidence_at > entry["_last_contact_at"]
                ):
                    entry["_last_contact_at"] = evidence_at
                # Bump status only if newer evidence is stronger.
                # Order: not_contacted < bounced < unsubscribed < contacted
                order = {"not_contacted": 0, "bounced": 1, "unsubscribed": 2, "contacted": 3}
                new_status = _campaign_status_to_org_status(r.get("status", ""))
                if order.get(new_status, 0) > order.get(entry["_status_from_recipients"], 0):
                    entry["_status_from_recipients"] = new_status
        out.extend(list(seen_here.values()))
        # Reset for next campaign so cross-campaign dedupe is handled
        # centrally by the reconciler (not lost here).
        seen_here.clear()

    # ── 4. Also emit ANY campaign_recipients whose email is NOT a
    #      founder, regardless of campaign title. That covers cases
    #      where an outreach campaign wasn't named obviously.
    async for r in db.campaign_recipients.find({}, {"_id": 0}):
        email = _norm_email(r.get("email"))
        if not email or _is_test_email(email):
            continue
        if email in founder_emails:
            continue  # this recipient came from founder list — skip
        # Fetch the campaign for context (cheap, only for outliers).
        c = await db.campaigns.find_one({"id": r.get("campaign_id")}, {"_id": 0})
        camp_name = (c or {}).get("name") or (c or {}).get("title") or "Historical campaign"
        name = (r.get("first_name") or "").strip() or camp_name
        evidence_at = _rec_evidence_at(r)
        out.append({
            "organisation_name": name,
            "contact_email": email,
            "contact_phone": "",
            "contact_name": "",
            "category": "outreach",
            "suburb": "",
            "state": "",
            "notes": f"Reconciled from non-founder campaign recipient (campaign '{camp_name}').",
            "source_collection": "campaign_recipients",
            "source_id": r.get("id"),
            "source_created_at": evidence_at,
            "_history": [{
                "at": evidence_at,
                "kind": f"campaign_{r.get('status') or 'send'}",
                "direction": "outbound",
                "subject": r.get("subject") or (c or {}).get("subject") or "",
                "campaign_id": r.get("campaign_id"),
                "campaign_name": camp_name,
                "status": r.get("status"),
                "message_id": r.get("message_id"),
                "bounce_type": r.get("bounce_type"),
                "bounce_message": r.get("bounce_message"),
                "by": "system:outreach_reconcile",
            }],
            "_status_from_recipients": _campaign_status_to_org_status(r.get("status", "")),
            "_last_contact_at": evidence_at,
        })
    return out


async def _scan_marketing_contacts_collection(db) -> List[Dict[str, Any]]:
    """Some deployments carry a ``marketing_contacts`` (or
    ``cms_marketing_contacts``) collection where each row has a
    ``recipient_type`` field. When ``recipient_type == 'organisation'``
    we treat the row as a first-class outreach candidate. The scanner
    silently returns [] if the collection doesn't exist yet — safe for
    fresh installs.
    """
    out: List[Dict[str, Any]] = []
    names = await db.list_collection_names()
    candidates_cols = [c for c in names
                       if c in ("marketing_contacts", "cms_marketing_contacts",
                                "outreach_contacts", "cms_contacts")]
    for col in candidates_cols:
        async for d in db[col].find({}, {"_id": 0}):
            rtype = (d.get("recipient_type") or d.get("contact_type") or "").lower()
            if rtype not in ("organisation", "organization", "org"):
                continue
            name = (
                d.get("organisation_name") or d.get("organization_name")
                or d.get("name") or d.get("first_name") or ""
            ).strip()
            email = _norm_email(d.get("email") or d.get("contact_email"))
            if not name:
                continue
            if email and _is_test_email(email):
                continue
            out.append({
                "organisation_name": name,
                "contact_email":     email,
                "contact_phone":     (d.get("phone") or d.get("contact_phone") or "").strip(),
                "contact_name":      (d.get("contact_name") or "").strip(),
                "category":          (d.get("category") or d.get("type") or "").strip(),
                "suburb":            (d.get("suburb") or "").strip(),
                "state":             (d.get("state") or "").strip(),
                "notes":             f"Reconciled from {col} (recipient_type=organisation)",
                "source_collection": col,
                "source_id":         d.get("id"),
                "source_created_at": d.get("created_at"),
            })
    return out


# Extend the source list — order matters for dedupe (highest-signal
# sources first so their status/history wins).
SOURCES = [
    _scan_marketing_contacts_collection,     # explicit organisation contacts
    _scan_campaigns_and_recipients,          # actual send history
    _scan_event_submissions,                 # inbound org contacts
    _scan_interest_registrations_organisation_tag,
]


# ─── Reconciliation core ───────────────────────────────────────────


async def _load_existing_index(db) -> Tuple[Dict[str, Dict], Dict[str, Dict]]:
    """Build case-insensitive email + normalised-name lookup tables from
    the current ``outreach_organisations`` collection."""
    by_email: Dict[str, Dict] = {}
    by_name:  Dict[str, Dict] = {}
    async for d in db.outreach_organisations.find({}, {"_id": 0}):
        e = _norm_email(d.get("contact_email") or d.get("email"))
        n = _norm_name(d.get("name") or d.get("organisation_name"))
        if e:
            by_email[e] = d
        if n:
            by_name[n] = d
    return by_email, by_name


async def _build_send_history_index(db) -> Dict[str, str]:
    """Map ``email_lower → most-recent successful send ISO timestamp``.

    Sources:
      • ``email_test_log`` — CMS-driven sends (mode=real preferred, but
        we also count mode=ack because those are real emails too).
      • ``campaign_recipients`` — bulk campaign sends with status in
        {delivered, opened, clicked, sent}.
    """
    latest: Dict[str, str] = {}

    def _bump(email: str, at: Optional[str]) -> None:
        if not email or not at:
            return
        prev = latest.get(email)
        if prev is None or at > prev:
            latest[email] = at

    async for d in db.email_test_log.find({}, {"_id": 0}):
        email = _norm_email(d.get("recipient"))
        if _is_test_email(email):
            continue
        _bump(email, d.get("sent_at") or d.get("created_at"))

    async for d in db.campaign_recipients.find(
        {"status": {"$in": ["delivered", "opened", "clicked", "sent"]}},
        {"_id": 0},
    ):
        email = _norm_email(d.get("email"))
        if _is_test_email(email):
            continue
        _bump(
            email,
            d.get("delivered_at") or d.get("sent_at")
            or d.get("first_opened_at") or d.get("last_event_at"),
        )

    return latest


def _synthetic_email(name: str, source_id: str) -> str:
    """When a candidate has no email we still need a stable natural key
    for de-duplication. Format is obviously non-routable so we never
    accidentally mail it."""
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "org"
    tail = (source_id or uuid.uuid4().hex)[:8]
    return f"{slug}-{tail}@no-email.reconciled.local"


async def reconcile(*, commit: bool, verbose: bool) -> Dict[str, Any]:
    mongo_url = os.environ["MONGO_URL"]
    db_name   = os.environ["DB_NAME"]
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    try:
        report: Dict[str, Any] = {
            "commit_mode":       commit,
            "started_at":        _now_iso(),
            "db_name":           db_name,
            "before":            {},
            "candidates":        {"total": 0, "by_source": {}},
            "reconciled":        {"created": 0, "existing_skipped": 0},
            "contact_bumps":     {"marked_contacted": 0, "already_contacted": 0},
            "created_samples":   [],
            "notes":             [],
        }

        # ── Snapshot before ────────────────────────────────────────
        report["before"]["outreach_organisations_total"]    = await db.outreach_organisations.count_documents({})
        report["before"]["outreach_organisations_active"]   = await db.outreach_organisations.count_documents({"archived": {"$ne": True}})
        report["before"]["outreach_organisations_archived"] = await db.outreach_organisations.count_documents({"archived": True})

        # ── Gather candidates ──────────────────────────────────────
        candidates: List[Dict[str, Any]] = []
        for scan in SOURCES:
            rows = await scan(db)
            report["candidates"]["by_source"][scan.__name__] = len(rows)
            candidates.extend(rows)
        report["candidates"]["total"] = len(candidates)
        if verbose:
            print(f"  scanned {len(candidates)} candidate rows")

        # ── Dedupe against existing + against each other ──────────
        existing_by_email, existing_by_name = await _load_existing_index(db)
        # Track candidates we've already accepted this run so multiple
        # sources for the same org collapse into one insert.
        accepted_by_email: Dict[str, Dict[str, Any]] = {}
        accepted_by_name:  Dict[str, Dict[str, Any]] = {}
        skipped_dupe = 0
        merged_within_run = 0

        for cand in candidates:
            name = cand["organisation_name"].strip()
            email = _norm_email(cand["contact_email"])
            key_name = _norm_name(name)
            # Skip if this org already exists in outreach_organisations
            if email and email in existing_by_email:
                skipped_dupe += 1
                continue
            if key_name and key_name in existing_by_name:
                skipped_dupe += 1
                continue
            # If we've already accepted a matching candidate in this
            # run, MERGE the extra evidence (history + strongest status
            # + latest last-contact) instead of dropping the new
            # candidate's info on the floor.
            prior = None
            if email and email in accepted_by_email:
                prior = accepted_by_email[email]
            elif key_name and key_name in accepted_by_name:
                prior = accepted_by_name[key_name]
            if prior is not None:
                merged_within_run += 1
                # Merge histories
                prior_hist = prior.get("_history") or []
                new_hist = cand.get("_history") or []
                prior["_history"] = prior_hist + new_hist
                # Merge status via same monotonic order
                order = {"not_contacted": 0, "bounced": 1, "unsubscribed": 2, "contacted": 3}
                pri_st = prior.get("_status_from_recipients") or "not_contacted"
                new_st = cand.get("_status_from_recipients") or "not_contacted"
                if order.get(new_st, 0) > order.get(pri_st, 0):
                    prior["_status_from_recipients"] = new_st
                # Latest evidence timestamp wins for last_contact_at
                p_last = prior.get("_last_contact_at")
                n_last = cand.get("_last_contact_at")
                if n_last and (not p_last or n_last > p_last):
                    prior["_last_contact_at"] = n_last
                # Prefer non-empty contact metadata from either source
                for k in ("contact_phone", "contact_name", "suburb", "state", "category"):
                    if not prior.get(k) and cand.get(k):
                        prior[k] = cand[k]
                continue
            # Fresh accept — fill synthetic email if no natural key
            if not email:
                email = _synthetic_email(name, cand.get("source_id") or "")
                cand["contact_email"] = email
                cand["notes"] = (
                    (cand.get("notes") or "")
                    + " (synthetic no-email key generated during reconciliation)"
                ).strip()
            if email:
                accepted_by_email[email] = cand
            if key_name:
                accepted_by_name[key_name] = cand
        report["reconciled"]["existing_skipped"]     = skipped_dupe
        report["reconciled"]["merged_within_run"]    = merged_within_run
        report["reconciled"]["net_new"]              = len(accepted_by_email)

        # ── Prepare insert documents ──────────────────────────────
        send_index = await _build_send_history_index(db)
        docs_to_insert: List[Dict[str, Any]] = []
        for email, cand in accepted_by_email.items():
            now = _now_iso()
            # Evidence timestamps: prefer campaign-recipient evidence
            # captured in the scanner, fall back to email_test_log/other
            # sends registered in send_index.
            hist_from_cand = cand.get("_history") or []
            cand_last = cand.get("_last_contact_at")
            index_last = send_index.get(email)
            last_contact_at = None
            for v in (cand_last, index_last):
                if v and (last_contact_at is None or v > last_contact_at):
                    last_contact_at = v
            # Status: recipients-derived (bounced/unsubscribed/contacted)
            # is the strongest signal. Fall back to send_index bump.
            status = cand.get("_status_from_recipients")
            if not status or status == "not_contacted":
                status = "contacted" if index_last else "not_contacted"
            # Communications: keep campaign_recipients evidence verbatim
            # so the detail-page timeline reads back "Retirement Villages
            # #3 — delivered 2026-08-28" etc. Also record the send_index
            # bump if it's newer than any campaign entry.
            comms: List[Dict[str, Any]] = list(hist_from_cand)
            if index_last and (not comms or all(
                (c.get("at") or "") < index_last for c in comms if c.get("at")
            )):
                comms.append({
                    "at": index_last,
                    "kind": "reconciled_send_evidence",
                    "direction": "outbound",
                    "subject": "(historical send — pre-Outreach reconciliation)",
                    "campaign_id": None,
                    "by": "system:outreach_reconcile",
                })
            doc = {
                "id":              str(uuid.uuid4()),
                "name":            cand["organisation_name"],
                "contact_email":   email,
                "contact_phone":   cand.get("contact_phone", ""),
                "contact_name":    cand.get("contact_name", ""),
                "category":        cand.get("category", ""),
                "suburb":          cand.get("suburb", ""),
                "state":           cand.get("state", ""),
                "postcode":        "",
                "website":         "",
                "notes":           cand.get("notes", ""),
                "tags":            [],
                "status":          status,
                "outreach_number": None,
                "last_contact_at": last_contact_at,
                "communications":  comms,
                "created_at":      now,
                "updated_at":      now,
                "archived":        False,
                "reconciled_from": {
                    "collection":  cand.get("source_collection"),
                    "source_id":   cand.get("source_id"),
                    "reconciled_at": now,
                    "script":      "outreach_reconcile.py",
                },
            }
            docs_to_insert.append(doc)
            if status == "contacted":
                report["contact_bumps"]["marked_contacted"] += 1

        # Also bump EXISTING organisations that have send evidence but
        # are still marked ``not_contacted``.
        cursor = db.outreach_organisations.find(
            {"status": {"$in": [None, "", "not_contacted", "new", "registered"]}},
            {"_id": 0, "id": 1, "contact_email": 1, "status": 1},
        )
        bumps_existing: List[Tuple[str, str]] = []
        async for d in cursor:
            e = _norm_email(d.get("contact_email"))
            last = send_index.get(e)
            if not last:
                continue
            bumps_existing.append((d["id"], last))

        # ── Commit or dry-run ─────────────────────────────────────
        if docs_to_insert:
            report["created_samples"] = [
                {"name": d["name"], "email": d["contact_email"], "status": d["status"]}
                for d in docs_to_insert[:10]
            ]
        if commit:
            if docs_to_insert:
                await db.outreach_organisations.insert_many(docs_to_insert)
                report["reconciled"]["created"] = len(docs_to_insert)
            for org_id, last in bumps_existing:
                await db.outreach_organisations.update_one(
                    {"id": org_id, "status": {"$in": [None, "", "not_contacted", "new", "registered"]}},
                    {"$set": {
                        "status":          "contacted",
                        "last_contact_at": last,
                        "updated_at":      _now_iso(),
                    }, "$push": {"communications": {
                        "at": last, "kind": "reconciled_send_evidence",
                        "direction": "outbound",
                        "subject": "(historical send — pre-Outreach reconciliation)",
                        "campaign_id": None,
                        "by": "system:outreach_reconcile",
                    }}},
                )
            report["contact_bumps"]["marked_contacted"] += len(bumps_existing)
        else:
            report["reconciled"]["created"] = 0
            report["notes"].append(
                "DRY RUN — no writes. Pass --commit to actually create rows."
            )
            report["contact_bumps"]["would_bump_existing"] = len(bumps_existing)

        # ── Snapshot after ─────────────────────────────────────────
        report["after"] = {
            "outreach_organisations_total":    await db.outreach_organisations.count_documents({}),
            "outreach_organisations_active":   await db.outreach_organisations.count_documents({"archived": {"$ne": True}}),
            "outreach_organisations_archived": await db.outreach_organisations.count_documents({"archived": True}),
        }
        report["finished_at"] = _now_iso()
        return report
    finally:
        client.close()


def _print_report(r: Dict[str, Any]) -> None:
    print("─" * 60)
    print(f"Outreach reconciliation  |  DB: {r['db_name']}  |  commit={r['commit_mode']}")
    print("─" * 60)
    print(f"Before  outreach_organisations:  {r['before']['outreach_organisations_total']} "
          f"(active {r['before']['outreach_organisations_active']}, "
          f"archived {r['before']['outreach_organisations_archived']})")
    print(f"Candidates found:           {r['candidates']['total']}")
    for src, n in r["candidates"]["by_source"].items():
        print(f"    {src:<48} {n}")
    print(f"Existing duplicates skipped: {r['reconciled']['existing_skipped']}")
    print(f"Merged within this run:      {r['reconciled'].get('merged_within_run', 0)}")
    print(f"Net new to create:           {r['reconciled']['net_new']}")
    print(f"Actually created:            {r['reconciled']['created']}")
    print(f"Marked contacted (new+existing): {r['contact_bumps']['marked_contacted']}")
    if not r["commit_mode"]:
        print(f"Would bump existing:         {r['contact_bumps'].get('would_bump_existing', 0)}")
    print(f"After   outreach_organisations:  {r['after']['outreach_organisations_total']} "
          f"(active {r['after']['outreach_organisations_active']}, "
          f"archived {r['after']['outreach_organisations_archived']})")
    if r["created_samples"]:
        print("Sample created rows:")
        for s in r["created_samples"]:
            print(f"    - {s['name']:<40} {s['email']:<40} [{s['status']}]")
    for note in r["notes"]:
        print(f"NOTE: {note}")
    print("─" * 60)


async def _amain() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--commit", action="store_true",
                        help="Actually write. Default is dry-run.")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()
    report = await reconcile(commit=args.commit, verbose=args.verbose)
    _print_report(report)


def main() -> None:
    asyncio.run(_amain())


if __name__ == "__main__":
    main()
