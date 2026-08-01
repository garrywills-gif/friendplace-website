# Product Polish Backlog — Next after CRM Phase 2C

*Locked with Garry, 1 Aug 2026. These four items ship together as one "Product
Polish" phase before the next major feature set. They are quality-of-life
improvements that will make the whole product feel more finished.*

**Do these AFTER**: CRM Phase 2C is fully signed off.
**Do these BEFORE**: George Analytics, George Moderation Drafts, Reports admin
migration, or any other new feature.

---

## 1. 🦋 Replace the legacy green butterfly (P0)

**Goal**: A single, consistent FriendPlace butterfly used everywhere.

- Adopt the new FriendPlace butterfly as the sole design-system butterfly.
- Replace every occurrence of the legacy green butterfly across:
  - Mobile app (Expo — `/app/frontend`)
  - Marketing website (Next.js — `/app/website/app/(marketing)`)
  - Mission Control CMS (Next.js — `/app/website/app/admin`)
- Update:
  - Favicons + app icons + splash screens
  - Every in-product illustration, header logo, empty state, and George avatar
  - Email templates + campaign preview mastheads
  - README screenshots
- Do a global grep before merge to confirm no legacy asset is still referenced.

## 2. 💬 George Workspace chat window (P0)

**Goal**: A George chat window that behaves like a proper floating panel.

Requirements:
- Draggable anywhere on screen.
- Remembers its last position during the session (sessionStorage; not persisted
  across full reloads unless we agree otherwise).
- Never allowed to open off-screen — clamp within viewport on mount and after
  window resize.
- Maintains minimise / restore behaviour (already exists; must survive drag).

Notes:
- Applies to George's workspace panel (Mission Control) and any web surface
  where George floats. Mobile keeps its full-screen chat.

## 3. 🖥️ Mission Control responsive layout (P0)

**Goal**: The Bridge + every dashboard page always fits at common laptop sizes.

Requirements:
- No horizontal clipping.
- Cards resize gracefully (flex/grid with sensible min widths).
- Dashboard remains fully usable on 13" MacBook Air (1440×900) and 14"
  Windows laptops (1366×768).
- Avoid requiring horizontal scrolling on any admin page.
- Test at: 1920×1080, 1440×900, 1366×768, 1280×800.

Scope:
- `/admin` (The Bridge)
- `/admin/founding-members`
- `/admin/campaigns` + `/admin/campaigns/new` + `/admin/campaigns/[id]`
- `/admin/segments` + `/admin/segments/[id]`
- `/admin/moments`

## 4. 📣 Flyers — unified library (P0)

**Goal**: One flyer library, authored in Mission Control, displayed in the app.

Requirements:
- **Single source of truth** — one `flyers` collection (or equivalent) shared
  between the mobile app and Mission Control. No parallel copies.
- Mission Control becomes the place to:
  - **Create** flyers (compose title, body, image, CTA, audience)
  - **Edit** flyers (in-place, with versioning)
  - **Publish** flyers (state: draft → published)
  - **Archive** flyers (state: published → archived; keeps history)
- The mobile app simply **displays** published flyers — no separate authoring
  path on mobile.
- The **two flyers currently created in MCGS** must automatically appear
  everywhere in FriendPlace once the merge is done (do not require re-creation).
- Backend: expose read-only `/api/flyers?status=published` for the mobile app;
  full CRUD under `/api/cms/flyers` for Mission Control admins.

Migration:
- Inventory existing flyer records in both surfaces.
- Merge / de-duplicate — prefer the MCGS versions as canonical (per Garry).
- Point mobile app at the shared read endpoint; remove any mobile-only
  authoring UI.

---

## Ordering
Suggested execution order (matches user's priority stack):

1. 🦋 Butterfly swap (fast, high-visibility)
2. 🖥️ Mission Control responsive layout (blocks daily admin use)
3. 💬 George chat window (isolated to workspace)
4. 📣 Flyers merge (biggest surface change — do last with fresh energy)

## After this polish phase
Return to the main P1 roadmap (in this order, per Garry):
1. George Analytics (natural-language answers combining Members, Campaigns,
   Segments, Moments, Events, The Bridge)
2. George Moderation Drafts (Warn/Suspend/Ban suggested messages)
3. Reports admin migration (`/admin/reports` + detail view)
