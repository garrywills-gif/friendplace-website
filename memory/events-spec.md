# Events Module — spec (drafted 17 July 2026)

**Status:** APPROVED for build; queued behind Vercel push
**Why it matters:** Garry sees events as one of the biggest FriendPlace
features — the real-world extension of "belong". Also the anchor for
Local Business Sponsorships and community partnerships.

---

## Guiding principles

- **Same aesthetic as Success Stories & Founding Members.** List +
  editor pattern. Draft / Published + Hidden. Preview modal. Media
  Library avatar / cover pickers.
- **Two audiences, one editor.** Admins create; members RSVP. We
  build the CMS side first, RSVP UI second (on the mobile app + a
  public event page).
- **Local Business Sponsorships hook in from day one** as an
  optional field, so the schema is future-proof without adding UI
  complexity yet.

---

## Data model — `cms_events` collection

```
{
  id: uuid,
  title: string,                    // "Sunday walk at Merewether Beach"
  slug: string,                     // "sunday-walk-merewether" (auto from title)
  cover_image_url: string,          // Media Library
  summary: string,                  // short pitch (~200 chars)
  body_html: string,                // TipTap rich body

  // When & where
  starts_at: ISO,                   // local timezone in the display layer
  ends_at: ISO,
  timezone: string,                 // e.g. "Australia/Sydney"
  location_name: string,            // "Merewether Beach"
  location_address: string,         // "1 Henderson Pde, Merewether NSW"
  location_url: string,             // Google Maps or venue site
  is_online: boolean,               // if true, use meeting_url below
  meeting_url: string,

  // Attendance
  capacity: number | null,          // null = unlimited
  rsvp_deadline_at: ISO | null,
  cost_display: string,             // "Free", "Gold coin donation", "$15 pp"
  age_note: string,                 // "Everyone welcome" | "18+" | etc.

  // Host
  host_name: string,                // "FriendPlace Coffee Lounge"
  host_avatar_url: string,          // Media Library
  host_type: "friendplace" | "member" | "partner",
  host_member_id: string | null,    // ref cms_founding_members or users

  // Local Business Sponsorship (optional)
  sponsors: [
    {
      name: string,
      logo_url: string,             // Media Library
      website_url: string,
      tier: "presenting" | "supporting" | "in-kind",
    }
  ],

  // Editorial state
  status: "draft" | "published",
  hidden: boolean,
  featured: boolean,                // pin to top of the events page
  order: number,                    // manual override for the list

  // Timestamps
  created_at: ISO,
  updated_at: ISO,
  created_by: string,               // admin email
}
```

## RSVP model — `event_rsvps` collection

```
{
  id: uuid,
  event_id: string,
  user_id: string,                  // mobile-app user
  status: "going" | "waitlist" | "cancelled",
  note: string,                     // "bringing my sister"
  guests_count: number,             // 0-based extras
  created_at: ISO,
  updated_at: ISO,
}
```

Indexes: `{event_id, user_id}` unique; `{event_id, status, created_at}`
for the roster query; TTL on cancelled rows after 90 days if we want to
keep the collection tidy.

---

## Admin routes

### API (Bearer JWT, `cms_admin` purpose)
- `GET  /api/cms/events` — list (all states)
- `POST /api/cms/events` — create draft (auto title "New event", auto slug)
- `GET  /api/cms/events/{id}`
- `PATCH /api/cms/events/{id}` — partial
- `DELETE /api/cms/events/{id}`
- `POST /api/cms/events/reorder`
- `GET  /api/cms/events/{id}/roster` — RSVP list (admin only)
- `POST /api/cms/events/{id}/cancel` — sends cancellation email to
  everyone RSVP'd (needs Resend template)

### UI
- `/admin/events` — list with columns:
  cover (48×48) · title + summary · date · RSVP count / capacity · status
- `/admin/events/[id]` — editor. Two-column, richer than Founding Members:
  - Left: title, summary, TipTap body, sponsors editor (repeater),
    cover image picker
  - Right: date/time (start + end + tz), location block, capacity /
    deadline / cost / age note, host block, publishing controls

Adds a **calendar view** toggle to the list page? Nice-to-have; ship
list first.

---

## Public routes

- `GET /api/public/events` — upcoming published+visible events,
  sorted by `starts_at` asc. Includes RSVP counts (aggregated) but
  **not** the roster (privacy).
- `GET /api/public/events/{slug}` — single event detail (public).
- `POST /api/events/{slug}/rsvp` — **authenticated user only** (mobile app)
- `DELETE /api/events/{slug}/rsvp` — cancel your own RSVP

### Public UI pages
- `/events` on the marketing website: grid of upcoming events
- `/events/[slug]` on the marketing website: full event detail

Mobile app gets:
- New **Events tab** (or nested under a "Community" tab)
- Card list + detail + RSVP button
- "Add to calendar" (ICS download) on both platforms

---

## Wiring into Mission Control

- Sidebar nav → new "Events" entry with 📅 icon
- Dashboard Quick Action "Add Event" → enable (`?new=1` flow like the others)
- Dashboard summary tile → **Upcoming events** count (published, `starts_at > now`)
- System Status → nothing new needed
- Recent Activity (future) → events fire "created / published / cancelled" events

---

## Suggested phasing (three sub-sessions)

**Session A — Foundation (aim: 1 chat)**
- Backend: `cms_events` collection + CRUD + slug generation
- Frontend admin: list + editor (single event, no repeater fields yet)
- Public: `/api/public/events` + `/events` marketing page (list only)

**Session B — Rich fields + Sponsors + Public detail**
- Sponsors repeater in editor
- Host block + timezone/cost/age fields
- Public event detail page `/events/[slug]`
- "Add to Calendar" ICS generator (`/api/events/{slug}.ics`)

**Session C — RSVP + Roster + Cancellation**
- `event_rsvps` collection + endpoints
- Mobile app RSVP flow (Expo — new Events tab)
- Admin roster view + cancellation email via Resend

If Garry wants the mobile UX in parallel with A, we can shave B down
and start on the Expo side sooner.

---

## Open questions to confirm before Session A starts

1. Is `Australia/Sydney` the safe default timezone, or should new
   events pick from a small list (Sydney, Melbourne, Brisbane, Perth,
   Adelaide, Hobart, Darwin)?
2. Do we want a **recurring events** concept in v1 (weekly walking
   group) or is that Session B+?
3. Do sponsors get their own CMS section (browseable logo wall) or
   are they only referenced from within events?
4. RSVP cap behaviour when full: waitlist automatic, or hide RSVP
   button and show "Fully booked"?
5. Do event pages need comments/photos post-event? (Community bulletin
   board pattern.) Might be its own module later.
