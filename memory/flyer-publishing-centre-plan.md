# Flyer Publishing Centre — Architecture (Locked for Next Session)

*Locked by Garry, 1 August 2026. This is the first task of the next
session. Do NOT modify or "improve" the plan — start with it as
written. Any tweaks should be raised with Garry before implementation.*

---

## Vision

Not simply a list of PDFs. A **Publishing Centre** with the
lifecycle **Create → Preview → Publish → Share → Archive**.

Eventually George should be able to say things like:

> *"I've prepared a Coffee Morning flyer for Castle Hill Library."*

or

> *"Would you like me to generate a Founding Member flyer for
> Kellyville?"*

Build the foundations with that future in mind.

---

## Principle

Mission Control is the **single source of truth** for flyers. The
mobile app **displays** published flyers but never authors them. No
duplicate flyer systems.

---

## Data model

**Collection:** `flyer_templates`

Fields:
```
{
  id,
  key,               // stable slug, e.g. "founding_member_invite"
  name,              // "Founding Member Invite"
  description,       // short admin-facing description
  category,          // "invite" | "event" | "group" | "notice" | "poster"
  layout,            // renderer key: "a4-portrait", "square-social", etc.
  fields[],          // schema of the placeholders (e.g. venue, url, admin_id)
  preview_image,     // URL to a cached preview thumbnail
  status,            // "draft" | "published" | "archived"
  published_at,      // ISO — set on publish
  created_by,        // admin id
  updated_at,
  version            // incremented on every save
}
```

**No collection for "generated instances."** Flyers are generated
on-demand via the existing QR/referral engine — personalised per
admin/venue/URL. We do **not** store thousands of PDFs.

---

## Seed templates (both migrate from existing designs)

1. **Founding Member Invite** — the existing `/api/admin/invite-flyer`
   endpoint becomes this template's renderer.
2. **Community Notice** — from `/app/website/public/flyer-mockups/`.

Future templates (build progressively as needed):
- Event Flyer
- Coffee Morning Flyer
- Local Group Flyer
- Community Notice
- Venue Poster

---

## Backend endpoints

**Admin (Mission Control) — authenticated:**
- `GET    /api/cms/flyer-templates`             — list, filter by status
- `POST   /api/cms/flyer-templates`             — create
- `GET    /api/cms/flyer-templates/{id}`        — detail
- `PATCH  /api/cms/flyer-templates/{id}`        — edit
- `POST   /api/cms/flyer-templates/{id}/publish`   — flip status to published
- `POST   /api/cms/flyer-templates/{id}/unpublish` — flip status back to draft
- `POST   /api/cms/flyer-templates/{id}/archive`   — flip status to archived

**Rendering (unified) — public with signed params:**
- `POST /api/flyer-templates/{key}/render` — generates the
  personalised HTML/PDF with QR. Accepts params like `admin_id`,
  `venue`, `url`, `date`, etc. per the template's `fields[]` schema.

**Mobile — public read:**
- `GET /api/flyers/published` — read-only list for the mobile app.

**Backward compatibility:**
- The old `/api/admin/invite-flyer` becomes a thin wrapper that calls
  the new templated renderer with `key=founding_member_invite`.

---

## Mission Control UI (`/admin/flyers`)

**List page:**
- Category tabs (Invite, Event, Group, Notice, Poster)
- Status filter (Draft, Published, Archived)
- One card per template — thumbnail, name, publish status,
  "used N times" badge
- Quick actions on hover: Preview · Edit · Publish · Archive · Duplicate

**New / Edit page:**
- Template metadata form (name, category, layout, description)
- Field editor for the personalisation placeholders
- **Live preview** panel (renders exactly as it will appear when
  generated, with sample QR)

**Preview surface:**
- Full-fidelity render, including sample QR
- Print/download button (calls the renderer with sample params)

**Publish lifecycle:**
`Draft → Preview → Publish → Share → Archive`

Track:
- `status` transitions in an audit log entry
- `used_count` — incremented every time `/api/flyer-templates/{key}/render`
  returns a successful render

---

## Mobile app (light touch)

- **"Share a flyer"** screen listing published templates.
- Tap a template → mobile app calls
  `POST /api/flyer-templates/{key}/render` with the current user's
  referral URL, downloads the rendered PDF or shares it via the
  native share sheet.
- Header uses the master FriendPlace butterfly (already handled).

---

## George integration — foundations for tomorrow

Register these tools so George can eventually surface flyers
naturally in conversation:

- `list_flyer_templates` → *"What flyers are published?"*
- `render_flyer` → future *"I've prepared a Coffee Morning flyer for
  Castle Hill Library."*

Add a KB entry per template describing:
- Purpose
- When to suggest it
- Which fields it needs

---

## Estimated effort

| Stage                                          | Time   |
|-----------------------------------------------|--------|
| Backend collection + endpoints + seeder       | ~45 min |
| Mission Control UI (list + detail + preview)  | ~60 min |
| Mobile flyer screen                            | ~20 min |
| George tools + KB entries                      | ~15 min |
| **Total**                                      | **~2.5 hrs** |

---

## Order of build (tomorrow)

1. Backend collection + seed the 2 existing designs as templates
2. Backend CRUD + rendering endpoint
3. Mission Control UI — list page → detail/edit page → live preview
4. Publish lifecycle wiring
5. Backward-compat wrapper on `/api/admin/invite-flyer`
6. Mobile "Share a flyer" screen
7. George tools + KB
8. Test with `testing_agent` end-to-end

---

## Success criteria

- Both existing flyers (Founding Member Invite + Community Notice)
  live as templates on Day 1.
- Any admin can create, preview, publish, share and archive a flyer
  from `/admin/flyers` without touching code.
- The mobile app shows only published flyers and generates
  personalised versions on tap.
- George can answer *"What flyers are published?"* by tomorrow evening.
