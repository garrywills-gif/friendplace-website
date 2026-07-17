"""iCalendar (RFC 5545) file builder for FriendPlace events.

Kept in its own module because ICS generation has just enough
edge-cases (line-folding, escaping, TZ headers, UID stability) that
inlining it into `cms_module.py` would smear the concerns.

Design decisions
────────────────
* **No third-party dep.** `ics.py` / `icalendar` both work fine but
  the RFC is small and this file is dead-simple; taking a runtime
  dep for ~80 lines of string formatting isn't worth it.
* **Stable UIDs.** UID is a function of the event id (never the
  slug, which can change if the admin renames the event). This lets
  users' calendars *update* their entry rather than creating a
  duplicate when the event is edited.
* **DTSTAMP always UTC.** Per RFC 5545 §3.8.7.2 the DTSTAMP MUST be
  in UTC. Event start/end are also emitted in UTC (`…Z`) so we
  don't have to ship a VTIMEZONE block for every possible zone.
* **Escaping.** Commas, semicolons and newlines inside TEXT values
  must be escaped per RFC 5545 §3.3.11. `_esc()` handles it.
* **75-octet line folding** per §3.1. We keep it simple: if a line
  is > 75 chars, break every 75 chars and prefix continuations with
  a single space.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional


def _esc(value: Optional[str]) -> str:
    """Escape a value for an iCalendar TEXT property."""
    if value is None:
        return ""
    return (
        str(value)
        .replace("\\", "\\\\")
        .replace(",", "\\,")
        .replace(";", "\\;")
        .replace("\n", "\\n")
        .replace("\r", "")
    )


def _to_utc(dt_str: Optional[str]) -> Optional[str]:
    """Convert an ISO-8601 timestamp to the compact iCal `YYYYMMDDTHHMMSSZ` form.

    Returns None if the input is empty or unparseable — callers can
    then decide whether to skip that field entirely.
    """
    if not dt_str:
        return None
    try:
        # `datetime.fromisoformat` handles "2026-07-30T10:00:00+10:00"
        # and "2026-07-30T00:00:00Z" (via replace).
        dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
    except Exception:
        return None
    if dt.tzinfo is None:
        # Naive input — assume it was already UTC.
        dt = dt.replace(tzinfo=timezone.utc)
    dt_utc = dt.astimezone(timezone.utc)
    return dt_utc.strftime("%Y%m%dT%H%M%SZ")


def _fold(line: str) -> str:
    """Fold a single logical line to 75 octets per RFC 5545 §3.1."""
    if len(line) <= 75:
        return line
    chunks = []
    i = 0
    # First chunk keeps its position; subsequent chunks are indented
    # with a single space (the continuation marker).
    chunks.append(line[:75])
    i = 75
    while i < len(line):
        chunks.append(" " + line[i:i + 74])
        i += 74
    return "\r\n".join(chunks)


def event_to_ics(
    event: Dict[str, Any],
    *,
    site_url: str = "https://www.friendplace.com.au",
    rsvp_email: Optional[str] = None,
    cancelled: bool = False,
) -> str:
    """Return the full iCalendar text for the given event.

    Args:
        event: A dict shaped like a `cms_events` row (title,
               starts_at, ends_at, timezone, venue_*, meeting_url, …).
        site_url: Base URL for the URL:… property (falls back so tests
                  work offline).
        rsvp_email: If provided, embedded as an ORGANIZER so calendars
                    can pre-populate a reply address.
        cancelled: When True, marks the event as CANCELLED per RFC —
                   Outlook/Google will visually strike it through and
                   remove reminders. Used by the admin "cancel event"
                   fan-out.
    """
    now_utc = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    uid = f"event-{event['id']}@friendplace.com.au"

    dtstart = _to_utc(event.get("starts_at"))
    dtend = _to_utc(event.get("ends_at"))
    # An event with no end-time is legal in iCal only when using
    # VALUE=DATE; simpler to default to +1h if we know start.
    if dtstart and not dtend:
        try:
            start_dt = datetime.strptime(dtstart, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
            dtend = (start_dt.replace(hour=start_dt.hour + 1)).strftime("%Y%m%dT%H%M%SZ")
        except Exception:
            dtend = None

    # LOCATION: for online events prefer the meeting URL, else the
    # venue name + address. Calendars render this best when it's a
    # single line.
    if event.get("is_online"):
        location = event.get("meeting_url") or "Online"
    else:
        loc_parts = [event.get("venue_name") or "", event.get("venue_address") or ""]
        location = ", ".join(p for p in loc_parts if p)

    slug = event.get("slug") or event.get("id")
    url = f"{site_url.rstrip('/')}/events/{slug}"
    description_lines = []
    if event.get("description"):
        description_lines.append(str(event["description"]).strip())
    if event.get("cost_display"):
        description_lines.append(f"Cost: {event['cost_display']}")
    if event.get("organiser_name"):
        description_lines.append(f"Hosted by: {event['organiser_name']}")
    description_lines.append(f"Full details: {url}")
    description = "\n".join(description_lines)

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//FriendPlace//Events//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:CANCEL" if cancelled else "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{now_utc}",
    ]
    if dtstart:
        lines.append(f"DTSTART:{dtstart}")
    if dtend:
        lines.append(f"DTEND:{dtend}")
    lines.append(f"SUMMARY:{_esc(event.get('title'))}")
    if description:
        lines.append(f"DESCRIPTION:{_esc(description)}")
    if location:
        lines.append(f"LOCATION:{_esc(location)}")
    lines.append(f"URL:{_esc(url)}")
    if rsvp_email:
        lines.append(f"ORGANIZER;CN=FriendPlace:mailto:{rsvp_email}")
    lines.append("STATUS:CANCELLED" if cancelled else "STATUS:CONFIRMED")
    if cancelled:
        lines.append("SEQUENCE:1")
    lines.append("TRANSP:OPAQUE")
    lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")

    # Fold + CRLF terminate as the RFC requires.
    return "\r\n".join(_fold(ln) for ln in lines) + "\r\n"
