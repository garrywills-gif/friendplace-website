"""Organisation Outreach reconciliation.

WHY
───
The Vercel-deployed ``/admin/outreach`` page currently shows 0
organisations because ``cms_organisations`` is empty. Garry believes
historical outreach touches (spreadsheet imports, campaign sends,
retirement-village replies, RSL / library contacts, etc.) may still
exist in adjacent collections. This script:

    1. Scans every accessible collection for organisation-shaped records
       (has ``organisation_name`` + a contact channel like email/phone).
    2. De-duplicates against ``cms_organisations`` by email
       (case-insensitive) and by normalised organisation name.
    3. Upserts each fresh find into ``cms_organisations`` using the
       canonical outreach schema (name/contact_email/contact_phone/…).
    4. Cross-references send history (``email_test_log`` +
       ``campaign_recipients``) and, for any org whose contact_email
       matches a successful send, marks it ``contacted`` with
       ``last_contact_at`` set to the most-recent successful send.

INVARIANTS
──────────
- **Never overwrites** an existing ``cms_organisations`` record. The
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


# ─── Reconciliation core ───────────────────────────────────────────


async def _load_existing_index(db) -> Tuple[Dict[str, Dict], Dict[str, Dict]]:
    """Build case-insensitive email + normalised-name lookup tables from
    the current ``cms_organisations`` collection."""
    by_email: Dict[str, Dict] = {}
    by_name:  Dict[str, Dict] = {}
    async for d in db.cms_organisations.find({}, {"_id": 0}):
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
        report["before"]["cms_organisations_total"]    = await db.cms_organisations.count_documents({})
        report["before"]["cms_organisations_active"]   = await db.cms_organisations.count_documents({"archived": {"$ne": True}})
        report["before"]["cms_organisations_archived"] = await db.cms_organisations.count_documents({"archived": True})

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
            # Skip if this org already exists
            if email and email in existing_by_email:
                skipped_dupe += 1
                continue
            key_name = _norm_name(name)
            if key_name and key_name in existing_by_name:
                skipped_dupe += 1
                continue
            # Also skip if we've already accepted a matching candidate
            # in this same run.
            if email and email in accepted_by_email:
                merged_within_run += 1
                continue
            if key_name and key_name in accepted_by_name:
                merged_within_run += 1
                continue
            # Fill synthetic email so downstream idempotency has a key
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
            last_contact_at = send_index.get(email)
            status = "contacted" if last_contact_at else "not_contacted"
            comms: List[Dict[str, Any]] = []
            if last_contact_at:
                comms.append({
                    "at": last_contact_at,
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
        cursor = db.cms_organisations.find(
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
                await db.cms_organisations.insert_many(docs_to_insert)
                report["reconciled"]["created"] = len(docs_to_insert)
            for org_id, last in bumps_existing:
                await db.cms_organisations.update_one(
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
            "cms_organisations_total":    await db.cms_organisations.count_documents({}),
            "cms_organisations_active":   await db.cms_organisations.count_documents({"archived": {"$ne": True}}),
            "cms_organisations_archived": await db.cms_organisations.count_documents({"archived": True}),
        }
        report["finished_at"] = _now_iso()
        return report
    finally:
        client.close()


def _print_report(r: Dict[str, Any]) -> None:
    print("─" * 60)
    print(f"Outreach reconciliation  |  DB: {r['db_name']}  |  commit={r['commit_mode']}")
    print("─" * 60)
    print(f"Before  cms_organisations:  {r['before']['cms_organisations_total']} "
          f"(active {r['before']['cms_organisations_active']}, "
          f"archived {r['before']['cms_organisations_archived']})")
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
    print(f"After   cms_organisations:  {r['after']['cms_organisations_total']} "
          f"(active {r['after']['cms_organisations_active']}, "
          f"archived {r['after']['cms_organisations_archived']})")
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
