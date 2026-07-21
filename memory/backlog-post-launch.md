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

---

## ✅ Success Stories editor — SHIPPED (17 July 2026)

Completed in this session:
- Dedicated `cms_success_stories` MongoDB collection with own timestamps and ordering
- Full CRUD backend at `/api/cms/success-stories/*` (18/18 pytests passing)
- Two-page admin UX: list at `/admin/success-stories`, editor at `/admin/success-stories/[id]`
- Rich text (TipTap) body, author name/role/location, avatar via Media Library picker
- **Draft / Published toggle** (separate from Hidden)
- **Hidden toggle** — published stories can be temporarily hidden without demoting to draft
- **Preview modal** rendered with the shared `<StoryCard>` component (WYSIWYG parity with public site)
- Up/down reorder controls with bulk /reorder endpoint
- Created / Last Updated dates visible on the editor header
- Public page live at `/success-stories` (grid of published+visible stories, 60s ISR)
- Dashboard: new "Success stories" summary tile + Quick Action "Add Success Story" enabled
- Sidebar nav: new "Success Stories" entry
- Public API projection stripped so admin-only fields (created_by / created_at) never leak

Also in this session:
- Quick Actions strip on dashboard (Add FAQ / Upload Image / Add Success Story live;
  Add Founding Member / Add Event pending)
- Expanded System Status panel (Website / API / Database / Last publish / Version)
- Nginx proxy extended to serve all marketing site public routes on the preview URL,
  so `/success-stories`, `/about`, `/faqs` etc. render the CMS-driven website locally

---

## ✅ Founding Members editor — SHIPPED (17 July 2026)

Completed in this session:
- Dedicated `cms_founding_members` MongoDB collection with own timestamps + ordering + member number
- Full CRUD backend at `/api/cms/founding-members/*` (22/22 pytests passing)
- Two-page admin UX: list at `/admin/founding-members`, editor at `/admin/founding-members/[id]`
- Fields: name, member number (auto-suggests max+1 on create), role, location, avatar (Media Library), TipTap bio
- **Draft / Published + Hidden** toggles (same 3-state model as Success Stories)
- **Preview modal** with shared `<FoundingMemberCard>` component — badge shows "FOUNDING MEMBER #<n>"
- Reorder ↑↓ with bulk POST /reorder endpoint
- Public `/api/public/founders` now reads from new collection (legacy fallback preserved during migration)
- Public payload strips admin metadata (created_by / created_at / status / hidden never leak)
- Dashboard: 5th summary tile now bound to `founding_members_count_editable` (editable roster, not signup count)
- Sidebar nav: "Founding Members" entry with 👥 icon
- Quick Action "Add Founding Member" enabled (was placeholder before)
- HIGH-priority bug fix: publish() now enforces `number >= 1` on BOTH client guard AND backend PATCH — a founding member #0 can never be published from any surface

---

## ✅ Events Module — Session A SHIPPED (17 July 2026)

Completed this session:
- Dedicated `cms_events` + `event_rsvps` MongoDB collections
- Full admin CRUD at `/api/cms/events/*` + RSVP roster + waitlist auto-flip on capacity
- Auto-generated unique slug from title
- Cascade delete: removing an event wipes its RSVPs
- Two-page admin UX: `/admin/events` list + `/admin/events/[id]` editor
- All Garry-requested v1 fields: title, description, rich body, cover image, start/end/timezone,
  in-person vs online, venue name/address/URL, meeting URL, capacity, RSVP deadline,
  cost (free/paid + display), organiser name/contact, accessibility notes, sponsors repeater
- Preview modal renders "PROUDLY SUPPORTED BY" sponsor band + all key metadata
- Automatic waitlist when capacity is reached; auto-promotes waitlist → going on cancellation
- Admin can add RSVPs manually (roster panel in editor)
- Public /events page with RSVP counters and "N spots left"/"Waitlist open" pill
- Public /api/public/events (upcoming only) and /api/public/events/{slug}
- Public payload strips admin metadata (created_by, status, hidden never leak)
- Dashboard: 6th tile "Upcoming events" + Quick Action "Add Event" enabled + sidebar nav entry
- Nginx proxy extended to serve `/events` on the preview URL

Deferred to Session B:
- Public /events/[slug] detail page + public RSVP form (email capture, no login)
- Add-to-calendar (ICS download)
- Mobile app RSVP UX (new Events tab)
- Automatic cancellation email via Resend when admin cancels an event

---

## ☕ Coffee Lounge — George as host + social games (roadmap)

**Requested by:** Garry, 17 July 2026 (not building now)

George gently offers a game to lounge visitors who are alone or
waiting for friends. Games become multiplayer/joinable so late
arrivals can tap "Join Game" and slot in. Turns "waiting alone" into
"we're doing something together."

Full spec: `/app/memory/george-spec.md` → "Phase 6 — Coffee Lounge host"

Depends on George Phase 2 (mobile) shipping first. Some game
foundations already exist in `/app/backend/` (trivia, word search,
sudoku, suburbs, spot-the-difference backdrops) — the new work is
the social multiplayer layer + George's host prompts.

---

## ➕ Additions captured 25 Jul 2026 (TestFlight-eve consolidation)

Everything the assistant + Garry had scattered across sessions but
hadn't yet written into this file. Priorities are rough steer only —
adjust when you come back.

### 🎪 Events Module — Session B (Garry, 17 Jul, still open)
Reiterated here so it lives in one place — carries over from the
Events block above:
- [ ] Public `/events/[slug]` detail page + email-capture RSVP form (no login)
- [ ] Add-to-calendar `.ics` download on the detail page + confirmation email
- [ ] **Mobile app RSVP UX** — dedicated Events tab in the mobile app that
      reads `/api/public/events`, supports join / waitlist / cancel
- [ ] Automatic cancellation email via Resend when admin cancels an event

### 💬 B6 Session 3 — Stretch UI polish (P4)
Only the disambiguation piece is left; core B6 is now stable.
- [ ] **Disambiguation candidate chips** — the backend already returns
      `edit.candidates` when a member's edit request could match >1 of
      their events. Currently the mobile UI falls through to a typed
      reply. Post-launch, render tappable chips so the member can
      resolve the ambiguity in one tap.
- [ ] Same treatment on the web preview.

### 💛 B7 — George Remembers polish (P3)
MVP is live; these are the "would be nice" extras Garry deferred:
- [ ] **Attendee-facing pre-event and post-event messages** (organiser-only
      for MVP). Copy + timing decisions to be re-locked before build.
- [ ] **Per-community timezone** support — currently hardcoded to
      `Australia/Sydney`. Add a `community.tz` column or a per-event
      `tz` field and thread it through `_event_start_dt_utc()`.
- [ ] **How-did-it-go workflow** — post-event message becomes a card
      that lets the organiser jot a quick note or attach a photo the
      community can see. Talk to Garry about tone before building.
- [ ] **Remembered-change nudge** — bring this back if a real member
      complaint proves George's edit-time confirmations aren't enough.
      Explicitly not-shipping-for-launch (Garry, 25 Jul).

### 🔊 George voice & audio (P4)
- [ ] **Native TTS cache pruning** — `Paths.cache/george-*.mp3` grows
      unbounded on device. Add an LRU sweeper (async task on app
      background) that keeps the newest ~20 files and deletes the rest.
- [ ] **Voice persona additions** — beyond George / Georgia, consider
      an Australian-accented voice pair once the OpenAI TTS catalogue
      supports it (or fall back to ElevenLabs).
- [ ] **STT quality on noisy environments** — investigate a
      confidence-threshold gate that asks "did you mean X?" instead
      of blindly using low-confidence transcriptions.

### 💬 Chats tab — member-to-member DMs (P3)
Full feature deferred until after TestFlight:
- [ ] 1:1 DMs with typing indicator + delivered receipts
- [ ] Push notification on new message (needs push infra, below)
- [ ] Block / mute / report
- [ ] George opt-in for "gentle icebreaker" on new DMs

### 🍎 Apple Sign-In finalisation (P2 — critical for TestFlight review)
Client + server are shipped. Remaining infrastructure:
- [ ] In Apple Developer portal — App ID `au.com.friendplace.app` MUST
      have **"Sign in with Apple"** capability enabled BEFORE the first
      TestFlight external test round, or Apple will reject the build.
- [ ] Add a **Sign-In with Apple** button to any web surface that also
      offers Google login, per Apple's parity rule.
- [ ] Once live, confirm private-relay email forwarding round-trips
      to a monitored inbox.

### 🔔 Push notifications (P3)
Explicitly deferred until after launch. When we're ready:
- [ ] Wire the Emergent-managed push integration
- [ ] Ask Garry for `google-services.json` from Firebase console
- [ ] `EMERGENT_PUSH_KEY` gets injected by Emergent at deploy time —
      no manual edit
- [ ] Feature *only* works on native iOS/Android builds (never Expo Go)
- [ ] First candidate use cases: new DM, RSVP flip on your event, B7
      pre-event nudge, MCGS admin alerts

### 🧭 MCGS Phase 4 — Health Pulse UI (P3)
Backend rhythms are shipped; the dashboard is what's outstanding.
- [ ] Community-wide vitals dashboard in Mission Control:
      active members / new joins / event RSVPs / George interactions /
      complaint volume — trend lines + week-on-week deltas
- [ ] Drill-down into any metric to the underlying event / user rows
- [ ] Alert thresholds Garry can tune (e.g. "flag if RSVPs drop >30%
      week-on-week")

### 🚨 MCGS Phase 5 — Alerts routing + SMS (P3)
- [ ] Routing rules for who gets which alert kind (organiser, admin,
      George itself)
- [ ] SMS groundwork — Twilio integration for the highest-priority
      alerts (community safety, event cancellations)
- [ ] In-app alerts inbox on the mobile app (separate from George
      Remembers)

### 🧹 Codebase refactor — server.py + mcgs_module.py (P4)
- [ ] `/app/backend/server.py` is ~10 000 lines. Split into domain
      routers under `/app/backend/routes/` (auth, events, george,
      cms, mcgs, admin, media). Ship route-by-route so tests can
      catch regressions per slice.
- [ ] `/app/backend/mcgs_module.py` is ~1 550 lines — same treatment.
- [ ] Move Pydantic models out of the router files and into
      `/app/backend/models/` per domain.
- [ ] Ensure route-level tests in `/app/backend/tests/` still pass
      after each move.

### 📱 Native build sanity items (P3 — do before wider TestFlight round)
- [ ] Verify audio playback in background on a real device (Voice
      Phase 3 relies on `expo-audio` which needs a native build to
      confirm)
- [ ] Verify Apple Sign-In on a real device (Expo Go can't test it)
- [ ] Verify push flow end-to-end on a real device (when built)
- [ ] Icon / splash on both light and dark iOS themes
- [ ] Screenshot capture for the App Store listing on iPhone 15 Pro
      Max + iPhone 15 (App Store requires the top-two current sizes)

### 🌏 Multi-community / multi-region (P5 — future thinking)
- [ ] Per-community branding (colours, name, tagline)
- [ ] Per-community timezone (see B7 polish)
- [ ] Per-community admin scoping — a Mission Control admin should
      only see their own community's data
- [ ] Cross-community discovery (opt-in) — "See what's happening in
      nearby FriendPlace communities"

### 🩺 Observability & ops (P4)
- [ ] Basic error reporting (Sentry or LogTail) on both backend and
      frontend
- [ ] Structured logs for the George LLM calls (prompt tokens,
      completion tokens, cost per turn — for budget visibility)
- [ ] Uptime monitoring for the deployed backend + Next.js portal
- [ ] Automated DB backups (Mongo Atlas snapshots — configure retention)

### 📝 Content & marketing (P3)
- [ ] Privacy policy page hosted somewhere the App Store form can
      link to (drafted in `app_store_listing_draft.md` — needs to
      go live on friendplace.com.au before submission)
- [ ] Terms of service page (same)
- [ ] Contact / support email address publicly listed
- [ ] "How George works" transparency page — explains AI use in
      plain language, addresses the "is this real?" question
- [ ] Founders' page updates as more Founding Members join

---

**Note (Garry, 25 Jul 2026):** Feature freeze is in effect from this
consolidation onward. Nothing on this list gets built until FriendPlace
is live on TestFlight and a full external test round has completed.

