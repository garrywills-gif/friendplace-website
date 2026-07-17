# FriendPlace — Post-Launch Ideas Backlog

Ideas captured but explicitly deferred to keep launch focused.

---

## 🎨 Rotating "welcome" backgrounds (Mobile app + Website)

**Requested by:** David
**When:** Session 15 July 2026
**Priority:** Nice-to-have — NOT urgent, do not delay launch

**The idea:**
Make the welcome/onboarding screens feel more emotionally alive by
using bright, warm, real-life community images as the background —
people having coffee, walking together, gardening, attending community
events. Rotate a few images so the app + website feel fresh every time
someone opens them.

**Why it matters:**
The current gradient + butterfly is polished but slightly abstract.
Real photos of belonging would communicate what FriendPlace is
*emotionally* the moment someone lands on it — instead of relying on
the tagline to do the work alone.

**Scope when we build it (est. ~15–20 credits):**

Mobile app:
- [ ] Add a `WelcomeBackground` component that fades between 4–6
      curated lifestyle photos (cross-fade, 6–8s intervals)
- [ ] Respect `prefers-reduced-motion` — fall back to a single static
      image if the OS is set to reduce animation
- [ ] Serve images via the same MongoDB media library the Mini-CMS
      uses — so David can add / remove / reorder without a dev cycle
- [ ] Keep the FriendPlace butterfly + tagline overlaid on top for
      brand consistency
- [ ] Add a subtle navy gradient overlay (bottom → top, 40% opacity)
      so text stays readable regardless of the underlying photo

Website:
- [ ] Same treatment on the home hero background (behind the current
      navy gradient) — very soft, low-opacity so the hero copy still
      dominates
- [ ] Cross-fade timing tuned separately from the mobile app since the
      website context is different (visitors linger longer per screen)

**Curation criteria:**
- Warm/golden lighting
- Australian diversity (age, ethnicity, ability)
- Real moments — no staged corporate stock
- No overtly branded logos in the shot
- Landscape orientation for mobile portrait bg + website hero

**When to schedule:**
- After the mobile app is live on TestFlight ✅
- After the website is deployed to friendplace.com.au ✅
- Ideally paired with the Mission Control media library so David can
  swap the pool from the admin UI without any dev help


---

## 🎛 Mission Control expansion (Mini-CMS → full admin suite)

**Requested by:** Garry
**When:** Session 17 July 2026
**Priority:** Not urgent — post-launch polish

**The idea:**
Grow the Mini-CMS into a proper FriendPlace Mission Control that
covers content editing plus operational visibility for events,
sponsors, and community health.

**Shipped in this session (quick wins):**
- [x] Rename dashboard heading → "FriendPlace Mission Control"
- [x] Subtitle: "Welcome back, Garry. Manage your website, content and media from one place."
- [x] Dashboard summary cards with live counts (Pages / Media / FAQs /
      Founding Members / Website Status)
- [x] Website status badge — 🟠 Private / 🟢 Live / 🔴 Maintenance —
      auto-reads `FRIENDPLACE_INDEXABLE`
- [x] Sidebar FriendPlace logo scaled up ~25%

**Still to build (deferred):**
- [ ] **Success Stories editor** — CRUD with rich text, author name +
      avatar via Media Library, ordering
- [ ] **Founding Members editor** — name, number, blurb, avatar,
      published/hidden toggle, ordering
- [ ] **Events module** — list + create + RSVP roster, tied to Local
      Business Sponsorships (see line item elsewhere in this file)
- [ ] **Partnerships module** — sponsor logos, sponsorship tiers,
      testimonials, downloadable media kit
- [ ] **Analytics dashboard** — sign-ups by day, active users,
      event RSVPs, public-site → mobile-download funnel
- [ ] **Settings module** — brand copy (tagline / straplines),
      email templates, admin invites, danger zone (wipe/export)
- [ ] **Maintenance mode toggle** in the badge — clicking flips
      `FRIENDPLACE_INDEXABLE` (or a new `MAINTENANCE_MODE` env) and
      shows a friendly holding page on the public site


---

## 🚀 Mission Control — dashboard enhancement ideas (round 2)

**Requested by:** Garry
**When:** Session 17 July 2026 (afternoon)
**Priority:** Not urgent — preserve the clean/uncluttered feel

**Guiding principle Garry set:** "Simplicity is one of the strengths of
Mission Control, and I'd rather build on that than overload it."
Every item below MUST justify its space on the dashboard.

### A. Quick Actions strip (small, high-value)
A single compact row of icon buttons directly under the welcome
subtitle for the actions Garry uses daily:
- [ ] ➕ Add FAQ            → jumps to /admin/faqs and focuses a new blank row
- [ ] 🖼️ Upload Image        → opens Media Library upload picker inline
- [ ] 📖 Add Success Story  → (waits on Success Stories editor)
- [ ] 👥 Add Founding Member → (waits on Founding Members editor)
- [ ] 📅 Add Event           → (waits on Events module)

### B. System Status panel (fits inside/next to the Website Status card)
Compact — one small card, four coloured dots, no big header:
- [ ] 🌐 Website: reuses existing Private/Live/Maintenance state
- [ ] 🟢 API: pings `/api/ping` on load; red on failure
- [ ] 🟢 Database: read from a new `/api/cms/health/db` endpoint that
      pings Mongo
- [ ] 🚀 Last Publish: shows relative time from `site_content.updated_at`
      (already stored; just needs surfacing)
- [ ] 📦 Version: shows a build/version constant baked at deploy time
      (Vercel env var `VERCEL_GIT_COMMIT_SHA` or a hand-cut `APP_VERSION`)

### C. Recent Activity feed (own section, opt-in-visible)
Every save writes to a new `cms_activity_log` collection:
- [ ] Automatic activity events on: page updated · FAQ added ·
      image uploaded · founding member joined · website published ·
      settings changed
- [ ] Dashboard section shows the last 5–8 with relative timestamps
      and an "actor" (which admin did it)
- [ ] Link to a full `/admin/activity` page with filtering by type

### D. Future widget stack (each behind a feature flag)
Only render when the underlying data source exists:
- [ ] 👥 Total registered users (from `users` collection)
- [ ] 🦋 Founding Members trend (weekly delta)
- [ ] 📅 Upcoming events (after Events module ships)
- [ ] 💬 New contact-form messages / support enquiries
- [ ] 📈 Website visitors (needs analytics — Plausible? Umami?)
- [ ] 📲 App downloads (App Store Connect + Play Console APIs — big lift)
- [ ] ❤️ Community engagement stats (posts/day, reactions/day)

### E. Notifications centre (small bell in top-right of the shell)
- [ ] `cms_notifications` collection populated by system events
- [ ] Bell icon with unread pill in AdminShell header
- [ ] Dropdown panel with items: New Founding Member · Contact form
      enquiry · Failed upload · System alert · Update available
- [ ] Mark-as-read, dismiss, "settings" for what to notify on

### F. Global search (⌘K)
- [ ] Command-K palette that indexes every CMS-managed thing:
      pages, FAQs (question text), success stories, founding members,
      media (filename + alt), events
- [ ] Fuzzy match, keyboard-first UX, jumps to the editor with the
      item focused
- [ ] Server-side: probably a lightweight `/api/cms/search?q=` that
      unions the collections until we outgrow it, then swap for a
      real index (Meilisearch/Typesense) if warranted

**Suggested phasing when we come back to this:**
1. **Phase A + B** (Quick Actions + System Status) — fit the current
   aesthetic, low risk, high daily-utility value. Small footprint.
2. **Phase C** (Activity feed) — needs the log table + write-side
   integration in every mutating endpoint. Medium build.
3. **Phase E** (Notifications) — builds on C's activity plumbing.
4. **Phase F** (Global search) — once we have >10 editable objects.
5. **Phase D** (Widgets) — parallel to the analytics dashboard already
   in the earlier backlog block; may collapse into that one.
