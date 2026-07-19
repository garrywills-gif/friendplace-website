"""Grounded defaults for Conversational Event Creation.

Rule (Garry, 19 July 2026):
> "George may infer, but never assume. Whenever confidence isn't high
>  enough, George should ask."

Every value returned here carries its source. If we can't ground a
field, we return None and the composer will ask.

Sources (locked in decision log):
- Organiser's previous events
- Organisation's profile + preferred writing style
- Previously used venues + venue history
- Previous attendance numbers, durations, times, pricing
- Seasonal patterns / day-of-week patterns
- Public holidays where relevant
- Administrator's previous edits and approvals
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from typing import Any, Optional


# Weekday-name lookup for warmer source strings ("Tuesday mornings" etc.).
_WEEKDAY = ["Monday", "Tuesday", "Wednesday", "Thursday",
            "Friday", "Saturday", "Sunday"]


def _confidence_from_hits(hits: int, threshold: int = 3) -> str:
    if hits >= threshold * 2:
        return "high"
    if hits >= threshold:
        return "moderate"
    return "low"


async def _organisers_past_events(db: Any, host_id: Optional[str]) -> list[dict]:
    if not host_id:
        return []
    return await db.events.find(
        {"host_id": host_id},
        {"_id": 0, "title": 1, "time": 1, "date": 1, "capacity": 1,
         "location": 1, "emoji": 1, "rsvps": 1},
    ).sort([("created_at", -1)]).to_list(50)


async def _events_at_venue(db: Any, location: Optional[str]) -> list[dict]:
    if not location:
        return []
    return await db.events.find(
        {"location": {"$regex": f"^{location}$", "$options": "i"}},
        {"_id": 0, "title": 1, "time": 1, "capacity": 1, "rsvps": 1},
    ).sort([("created_at", -1)]).to_list(50)


def _majority(values: list, min_hits: int = 2) -> Optional[Any]:
    values = [v for v in values if v not in (None, "", 0)]
    if not values:
        return None
    counter = Counter(values)
    top, hits = counter.most_common(1)[0]
    if hits < min_hits:
        return None
    return top


async def infer_defaults(
    db: Any,
    extracted: dict,
    *,
    host_id: Optional[str] = None,
) -> dict:
    """Return per-field inferred defaults with source + confidence.

    Shape:
        {
          "time": {"value": "10:00", "source": "...", "confidence": "moderate"},
          "capacity": {"value": 20, "source": "...", "confidence": "high"},
          ...
        }

    Only returns fields the caller didn't already extract with high
    confidence — the caller decides whether to accept each inference.
    """
    result: dict[str, dict] = {}

    past = await _organisers_past_events(db, host_id)
    venue_past = await _events_at_venue(db, extracted.get("location"))

    # ----- time-of-day norm from organiser's own history -----
    if not extracted.get("time"):
        times = [e.get("time") for e in past if e.get("time")]
        maj = _majority(times, min_hits=2)
        if maj:
            result["time"] = {
                "value": maj,
                "source": f"your previous events typically start at {maj}",
                "confidence": _confidence_from_hits(times.count(maj)),
            }

    # ----- capacity from same organiser -----
    if not extracted.get("capacity"):
        caps = [e.get("capacity") for e in past if isinstance(e.get("capacity"), int)]
        if caps:
            maj = _majority(caps, min_hits=2)
            if maj:
                result["capacity"] = {
                    "value": int(maj),
                    "source": f"your last few events had a capacity of {maj}",
                    "confidence": _confidence_from_hits(caps.count(maj)),
                }

    # ----- venue capacity from history at same location -----
    if not extracted.get("capacity") and venue_past:
        rsvp_counts = [len(e.get("rsvps") or []) for e in venue_past]
        rsvp_counts = [n for n in rsvp_counts if n > 0]
        if rsvp_counts:
            typical = int(round(sum(rsvp_counts) / len(rsvp_counts)))
            if typical > 0 and "capacity" not in result:
                result["capacity"] = {
                    "value": typical,
                    "source": (
                        f"{extracted.get('location')} has hosted "
                        f"{len(venue_past)} event(s) with an average of "
                        f"{typical} attending"
                    ),
                    "confidence": _confidence_from_hits(len(venue_past)),
                }

    # ----- emoji from organiser's palette -----
    if not extracted.get("emoji"):
        emojis = [e.get("emoji") for e in past if e.get("emoji")]
        maj = _majority(emojis, min_hits=2)
        if maj:
            result["emoji"] = {
                "value": maj,
                "source": "matches the emoji you usually use",
                "confidence": _confidence_from_hits(emojis.count(maj)),
            }

    # ----- day-of-week pattern for a partial date -----
    if not extracted.get("date") and past:
        weekdays: list[str] = []
        for e in past:
            d = e.get("date")
            if not d:
                continue
            try:
                dt = datetime.fromisoformat(d)
                weekdays.append(_WEEKDAY[dt.weekday()])
            except Exception:
                continue
        maj_wd = _majority(weekdays, min_hits=3)
        if maj_wd:
            result["weekday_hint"] = {
                "value": maj_wd,
                "source": f"most of your events run on {maj_wd}s",
                "confidence": _confidence_from_hits(weekdays.count(maj_wd)),
            }

    return result


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
