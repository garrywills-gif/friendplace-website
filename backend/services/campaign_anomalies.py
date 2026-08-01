"""Campaign anomaly detection — CRM Phase 2B (Delivery & Engagement).

After every Resend webhook event lands, we evaluate the parent
campaign's current state and, if something looks off, emit an MCGS
signal (`category=anomaly`) so it surfaces on The Bridge.

Detection rules (Garry, 1 Aug 2026):

    1. **High bounce rate** — bounces / accepted > 5% AND accepted >= 20.
       Priority: P1 (may hurt sender reputation).
    2. **Any complaint** — a single email.complained event is
       significant. Priority: P1 (address immediately).
    3. **Delivery drop** — delivered / accepted < 90% AND accepted >= 50.
       Priority: P2 (needs investigation; could be a domain issue).
    4. **High open, low click** — after 4h from send, open_rate >= 30%
       AND click_rate < 1% AND unique_opens >= 10.
       Priority: P3 (creative / CTA didn't land — informational).

Everything is deduped via MCGS case_keys, so a campaign that keeps
receiving bounces produces ONE signal (not one per bounce). New
bounces just refresh the signal's `last_signal_at`.

The rule set is deliberately conservative so The Bridge doesn't cry
wolf. Thresholds live in this file as constants — easy to tune later
without a redeploy (or we can lift them into a `settings` document).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

log = logging.getLogger("friendplace.campaigns.anomalies")

# ── Thresholds ────────────────────────────────────────────────────
HIGH_BOUNCE_RATE = 0.05          # 5%
HIGH_BOUNCE_MIN_ACCEPTED = 20    # avoid noise on tiny sends

LOW_DELIVERY_RATE = 0.90         # 90%
LOW_DELIVERY_MIN_ACCEPTED = 50   # need enough volume for the rate to mean anything

LOW_CLICK_RATE = 0.01            # 1%
HIGH_OPEN_RATE_FOR_LOW_CLICK = 0.30  # 30%
MIN_OPENS_FOR_CLICK_CHECK = 10
CLICK_CHECK_DELAY = timedelta(hours=4)  # wait 4h before flagging low CTR

PRODUCER = "campaign_anomalies"


# ── Helpers ───────────────────────────────────────────────────────
def _rate(numerator: int, denominator: int) -> float:
    if not denominator:
        return 0.0
    return float(numerator) / float(denominator)


def _parse_iso(dt_str: Optional[str]) -> Optional[datetime]:
    if not dt_str:
        return None
    try:
        # Accept both `Z` and `+00:00` suffixes.
        return datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
    except Exception:
        return None


def _fmt_pct(x: float) -> str:
    return f"{x * 100:.1f}%"


# ── Detection ─────────────────────────────────────────────────────
def _detect(campaign: dict) -> list[dict]:
    """Return the anomalies present on this campaign right now.

    Each returned dict has: `key` (short id), `priority`, `subject`,
    `body`, `context` (metrics for the signal payload).
    """
    stats = campaign.get("stats") or {}
    accepted   = int(stats.get("accepted")   or 0)
    delivered  = int(stats.get("delivered")  or 0)
    bounced    = int(stats.get("bounced")    or 0)
    complained = int(stats.get("complained") or 0)
    unique_op  = int(stats.get("unique_opens")  or 0)
    unique_cl  = int(stats.get("unique_clicks") or 0)
    sent_at    = _parse_iso(campaign.get("sent_at") or campaign.get("scheduled_at"))
    now        = datetime.now(timezone.utc)
    title      = (
        campaign.get("name")          # canonical field
        or campaign.get("title")       # legacy / summary shape
        or campaign.get("subject")
        or "(untitled campaign)"
    )

    out: list[dict] = []

    # 1) HIGH BOUNCE — protect sender reputation.
    if accepted >= HIGH_BOUNCE_MIN_ACCEPTED and _rate(bounced, accepted) > HIGH_BOUNCE_RATE:
        rate = _rate(bounced, accepted)
        out.append({
            "key":      "high_bounce",
            "priority": "P1",
            "subject":  f"Bounce rate looks high on \u201c{title}\u201d",
            "body": (
                f"{bounced} of {accepted} recipients bounced ({_fmt_pct(rate)}). "
                "That\u2019s well above the 5% threshold we watch for \u2014 worth checking the "
                "founder list for typo\u2019d addresses before the next send. I\u2019ve "
                "flagged the bouncers as `email_invalid` automatically so they won\u2019t "
                "receive more."
            ),
            "context": {"bounced": bounced, "accepted": accepted, "rate": rate},
        })

    # 2) COMPLAINT — a single one is worth surfacing.
    if complained > 0:
        out.append({
            "key":      "complaint",
            "priority": "P1",
            "subject":  f"Spam complaint on \u201c{title}\u201d",
            "body": (
                f"{complained} recipient(s) marked \u201c{title}\u201d as spam. "
                "I\u2019ve opted them out automatically so they won\u2019t receive "
                "future campaigns. A single complaint is normal; a pattern is worth "
                "reviewing the copy for."
            ),
            "context": {"complained": complained, "accepted": accepted},
        })

    # 3) DELIVERY DROP — DNS / domain / provider issue.
    if accepted >= LOW_DELIVERY_MIN_ACCEPTED:
        dr = _rate(delivered, accepted)
        if dr < LOW_DELIVERY_RATE:
            out.append({
                "key":      "low_delivery",
                "priority": "P2",
                "subject":  f"Delivery rate is low on \u201c{title}\u201d",
                "body": (
                    f"Only {delivered} of {accepted} accepted emails were delivered "
                    f"({_fmt_pct(dr)}). Below 90% usually points to a domain or "
                    "provider issue \u2014 might be worth double-checking SPF / DKIM / DMARC "
                    "on friendplace.com.au."
                ),
                "context": {"delivered": delivered, "accepted": accepted, "rate": dr},
            })

    # 4) HIGH OPEN, LOW CLICK — creative/CTA needs a look.
    if (
        sent_at
        and now - sent_at > CLICK_CHECK_DELAY
        and unique_op >= MIN_OPENS_FOR_CLICK_CHECK
        and _rate(unique_op, accepted) >= HIGH_OPEN_RATE_FOR_LOW_CLICK
        and _rate(unique_cl, accepted) < LOW_CLICK_RATE
    ):
        or_pct = _rate(unique_op, accepted)
        cr_pct = _rate(unique_cl, accepted)
        out.append({
            "key":      "high_open_low_click",
            "priority": "P3",
            "subject":  f"Opens strong, clicks quiet on \u201c{title}\u201d",
            "body": (
                f"Open rate is a healthy {_fmt_pct(or_pct)} but click rate is only "
                f"{_fmt_pct(cr_pct)}. Members are opening but not acting on the CTA. "
                "Might be a copy / button-placement thing worth an A/B test on the "
                "next send."
            ),
            "context": {"open_rate": or_pct, "click_rate": cr_pct,
                        "unique_opens": unique_op, "unique_clicks": unique_cl},
        })

    return out


# ── Emit signals via MCGS ─────────────────────────────────────────
async def evaluate_and_signal(db: Any, campaign_id: str) -> list[str]:
    """Detect anomalies on `campaign_id` and emit MCGS signals for any
    that aren't already flagged. Returns the list of case_keys emitted.

    Idempotent — each anomaly is scoped to a unique `case_key` per
    campaign+type, so re-running is safe and won't produce duplicate
    Bridge cards.
    """
    campaign = await db.campaigns.find_one({"id": campaign_id})
    if not campaign:
        return []
    anomalies = _detect(campaign)
    if not anomalies:
        return []

    from services.mcgs import create_signal  # lazy import — avoid circular
    emitted: list[str] = []
    for a in anomalies:
        case_key = f"campaign.anomaly.{a['key']}.{campaign_id}"
        try:
            await create_signal(
                db,
                producer=PRODUCER,
                entity_ref={
                    "kind":  "campaign",
                    "id":    campaign_id,
                    "label": campaign.get("title") or campaign.get("subject") or campaign_id,
                },
                subject=a["subject"],
                body=a["body"],
                category="anomaly",
                priority=a["priority"],
                case_key=case_key,
                source="system",
            )
            emitted.append(case_key)
        except Exception as e:  # noqa: BLE001 — anomaly emission is best-effort
            log.warning(
                "campaign anomaly signal failed (campaign=%s key=%s): %s",
                campaign_id, a["key"], e,
            )
    return emitted
