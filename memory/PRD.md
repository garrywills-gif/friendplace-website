# YouBelong — Friendship & Community App

YouBelong is a mobile-first friendship and community app for anyone looking to make new friends, expand their social circle, or feel more connected to their local area. It is **not a dating app** — its core is the **Coffee Lounge**: virtual tables where people pull up a chair and have a real-time chat. The app is designed to be accessible and welcoming for everyone, with thoughtful defaults (large text, soft palette, plain English) that work for users of any age or technical confidence.

## Stack
- **Frontend**: Expo Router (React Native Web), TypeScript
- **Backend**: FastAPI + Motor (async MongoDB)
- **Real-time**: WebSockets (FastAPI native) at `/api/ws/table/{id}` and `/api/ws/dm/{conv_id}`
- **Storage**: MongoDB (collections: users, tables, groups, group_posts, events, notices, dm_conversations, messages, friend_requests, flutters, reports)
- **Auth**: Prototype username-only (no passwords). Seeded demo accounts available.

## Key Features

### Welcome screen
- Real YouBelong butterfly logo
- Primary tagline "Find Your People."
- Secondary tagline "Because You Belong Too."
- Sign Up, Log In, Continue with Apple, Continue with Google (Apple/Google trigger a quick demo login as Margaret)

### Home
- 7 large tiles: Coffee Lounge (hero), Find Friends, Local Events, Community Groups, Notice Board, Games, My Profile
- Brand logo + greeting
- Butterfly Points card with earned badges
- **Flutter inbox banner** — when friends send you a Flutter, the banner appears on home with Reply/Dismiss buttons

### Coffee Lounge (CORE feature)
- Seeded tables: Morning Coffee, Gardening Chat, Men's Shed, Book Club, Pet Lovers, New Friends, Sydney Locals
- **Occupancy indicators**: Empty Table / 1 Person / 2 People / 5 People / Full Table
- **"Active Now"** green badge when ≥ 2 are seated
- Public + Friends-only visibility
- Create your own table from the FAB (emoji picker, name, description, visibility)
- Real-time WebSocket chat with presence (join/leave)
- 1 point per message, 10 points for creating a table

### Find Friends
- Search by name / interest, filter chips by suburb
- Each friend card has 3 actions: Add Friend, **🦋 Flutter**, Message
- View profile screen: Add, Flutter, Message, Block, Report

### Flutter (warm online ping)
- Backend: `/api/flutters/send`, `/api/flutters/{user_id}`, `/api/flutters/{flutter_id}/read`
- Recipients see a purple Flutter banner on Home with Reply (opens DM) and Dismiss
- Sender earns 2 Butterfly Points

### Private Messaging
- Inbox accessible from Friends tab
- Real-time WebSocket DM (`/api/ws/dm/{conv_id}`)
- Conversation list with last message preview

### Community Groups
- Seeded: Walking Group, Community Volunteers, Garden Club, Travel Enthusiasts, Coffee Catch-Ups
- Join/open, post text updates with likes

### Notice Board
- Categories: Announcement, Share, Ask, Activity
- Like and comment posts
- 4 points for posting a notice

### Local Events
- Seeded: Coffee Morning, Community Morning Tea, Walking Group, Men's Shed BBQ, Community Market, Library Book Club, Trivia Afternoon
- RSVP / un-RSVP (6 points on RSVP)
- Date, time, location displayed

### Games
- Bingo (5×5 generated card, randomly called numbers, win-line detection)
- Trivia (multi-question Australia-flavoured)
- Word Search (10×10 grid with 6 words to find)
- Jigsaw (3×3 sliding puzzle)
- **Daily Quiz** — 5 questions deterministically selected per calendar date

### Butterfly Points & Badges
- Friendly Butterfly (10+ points)
- Helpful Neighbour (30+)
- Social Star (60+)
- Community Builder (100+)
- Earned via posting, messaging, RSVPs, creating tables, fluttering

### Profile
- Hero with avatar, name, suburb, bio
- Stats: Points, Friends count, Badges count
- Badges (locked/unlocked grid)
- Interests
- Friends grid (clickable)
- Settings & Log Out

### Settings & Accessibility
- **Large text** toggle (1.2× font scale across whole app)
- **High contrast** colour palette toggle (deep blue on white)
- Voice-to-text hint (uses native keyboard mic)
- Community Guidelines list
- Safety info

### Safety
- Report user button (saves to `reports` collection)
- Block user button (adds to user's `blocked` list)
- Community Guidelines visible in Settings

## URL Conventions
- All backend routes prefixed with `/api`
- Frontend fetches via `EXPO_PUBLIC_BACKEND_URL + /api/...`
- WebSocket: `wss://.../api/ws/table/{id}?user_id=...`

## Seed Data
On first startup the backend seeds 8 demo users, 7 tables (with starter messages), 5 groups (with sample posts), 7 events (with RSVPs), 4 notices, 2 incoming Flutters for Margaret, and 1 DM thread between Margaret and Joyce.

## Files of Note
- `/app/backend/server.py` — all FastAPI routes + WS hubs + seed
- `/app/frontend/app/index.tsx` — Welcome
- `/app/frontend/app/auth/{login,signup}.tsx`
- `/app/frontend/app/(tabs)/{home,lounge,friends,profile}.tsx`
- `/app/frontend/app/table/[id].tsx` — WS table chat
- `/app/frontend/app/dm/[id].tsx` — WS DM
- `/app/frontend/app/events.tsx`, `groups.tsx`, `group/[id].tsx`, `notices.tsx`, `messages.tsx`, `settings.tsx`, `user/[id].tsx`
- `/app/frontend/app/games/{index,bingo,trivia,wordsearch,jigsaw,quiz}.tsx`
- `/app/frontend/src/lib/{theme,auth,api,toast}.tsx`
- `/app/frontend/src/components/{Button,Header}.tsx`

## Future / Backlog (parked — not building yet)

### Local Business Sponsorships (V2 — after user growth)
- **Why parked**: Need a critical mass of engaged members before ad inventory is valuable to local businesses. Build the audience first, monetisation second.
- **Concept**: Local cafés, libraries, RSL clubs, fitness studios pay (or free for charities) to host/sponsor real-world events. Returns: sponsor profile card, branded event tile, member perks (e.g. "10% off"), map pin in "Friendly Places Near Me", optional Sponsor-of-the-Week spotlight.
- **Tiers**: Free Community (libraries/charities) · Local ~$15–30/mo · Partner ~$80/mo.
- **"First Post Free" hook**: When auto-detector flags commercial content from a non-sponsor, show friendly modal — "Your first post is on us 🎁" — then prompt to subscribe. One-shot per email+phone, 7-day expiry, still wears "Sponsored" chip, still moderated by Maggie. Acts as both growth funnel AND moderation tool (same keyword detector powers both).
- **Anti-promotion guardrails to build alongside**: Community Rules screen + signup tickbox · "Promoting a business" report reason · Auto-flag URLs/prices/commercial keywords → admin queue · Rate-limits for new accounts (2 posts/day, 1 event/week for first 48 hrs) · Business-name detection on profiles.
- **Tech**: New `sponsors` collection · `events.sponsor_id` linkage · Stripe Subscriptions (test key already in pod) · Admin approval queue in existing Maggie dashboard.
- **Trust**: All sponsors manually approved · No DMs to members · No tracking pixels · Clear "Sponsored" labels.
- **Trigger to revisit**: When DAU > ~500 or specific local businesses start asking how they can promote.

## June 2026 — Batch 2: shared-root-cause remediation (LOCAL ONLY, not pushed)
- ROOT CAUSE PROVEN: Emergent preview edge intermittently returns plain-text "404 page not found" for the preview hostname. This single blip caused: admin 404, George stuck "thinking", voice failure, Read Aloud failure.
- Fix A: `/app/website/lib/fetch-retry.ts` (new) — fetchWithRetry (2 retries, 500/1500ms backoff) on network errors, 502/503/504, and edge-signature 404. Wired into cms-api.ts + mcgs-api.ts (req, transcribeAudio, speakText, askGeorge). Content-Type dropped from GETs (no more CORS preflights).
- Fix B: askGeorge hardened — res.ok check, 30s first-byte / 60s idle watchdog, guaranteed single `done` via finally, new `error` event kind. AskGeorgeSheet: Stop button while busy, "↻ Try again" chip on failed turns, busy reset on close, "Stopped —" bubble on user cancel.
- Fix C: Read Aloud Safari fix — Audio element created inside click gesture + silent-WAV unlock before TTS fetch; inline Try again chip replaces alert().
- Fix D: AskGeorgeBar mic errors — console.error real cause; retry-exhaustion maps to "connection hiccupped" wording. Composer mic still deliberately disabled (BATCH-B pending).
- Support note drafted (NOT sent): /app/memory/support_note_preview_edge_404.md
- Tested: iteration_106.json — 7/8 pass; voice fake-mic scenario skipped (harness limitation). Cosmetic wording fix applied after test.
- STILL PENDING ON EMERGENT SUPPORT: production Mongo empty / data migration before any URL cutover; preview edge routing stability.

## July 2026 — Knowledge Phase 2: institutional memory with permission-gated retrieval
Decision (30 Jul 2026): One George · One memory · Different permissions. A single `knowledge_base` collection with per-entry `visibility` ("public" | "admin") and optional `admin_context` field. Member-side George sees only public entries; admin-side George sees everything plus the admin_context layer on public entries. All new entries and George's chat-drafts default to `visibility="admin"` — public is a deliberate promotion.
- Backend: `services/knowledge.py` extended with visibility filtering, create_entry, update_entry, confirm_draft, discard_entry, supersede_entry (auto-fills evolution_note), backfill_embeddings. Admin_context and evolution_note fields carry the extra layers.
- Draft-from-chat: `services/george/chat.py` post-turn detector (Haiku classifier) creates a `status="draft"` entry when the admin shares new institutional info, streams a `kb_proposal` SSE event to the client. Prefiltered via regex hints so the vast majority of turns skip the classifier entirely.
- CMS routes: `POST /api/cms/knowledge`, `PATCH /api/cms/knowledge/{id}`, `POST /api/cms/knowledge/{id}/confirm | discard | supersede`, `GET /api/cms/knowledge-drafts`, `POST /api/cms/knowledge/reseed`. All actions dual-write to admin_log with `kb.entry.*` action namespace.
- MCGS UI: `/admin/knowledge` — Library with search + type/visibility/status filters, drafts strip at top, add-entry modal with visibility toggle and conditional admin_context textarea, per-row Edit/Supersede/Discard with confirmation. Sidebar entry added under System.
- Seeding: 17 canonical entries classified (10 public: stories/principles/RYI/moderation philosophy; 7 admin: decisions/roadmap/security philosophy/MCGS Bridge). KB-STORY-002 "Why George is a butterfly" carries an admin_context layer as the reference implementation.
- Known: embeddings 401 with current Emergent LLM key — retrieval falls back to keyword-only (works for 17-entry KB; will need proper embeddings gateway before the KB grows to hundreds).
- Tested: 9 kb.* audit-log entries land correctly · create/confirm/update/supersede/discard flow end-to-end verified via API · Knowledge Library and Author Modal render correctly in MCGS.


## 30 July 2026 — George Character Foundation LOCKED
Garry declared George's character foundation complete after a full day of conversations where he "stopped testing George and simply enjoyed talking to him." Foundation is now protected — refinements only when triggered by real-world use, and only when explicitly requested by Garry. Reference entry: **KB-STORY-007 "George Identity Milestone — 30 July 2026"** (admin-only, contains verbatim record of the milestone and the four anchor phrases that define George's voice).
- **Protected components** in `services/george/prompt.py`:
  1. `CHIEF_OF_STAFF_PERSONA` (Who You Are + Your Purpose + Your Voice)
  2. `CHARACTER_PRINCIPLES` — seven permanent principles: Honesty before certainty · Warmth before efficiency · Help him think, don't decide for him · Recognise don't flatter · Documented knowledge vs Thoughtful reasoning (labelled) · Trust is earned, never assumed · You exist for FriendPlace.
  3. `OPERATING_RULES` Rule 1 — Factual claims (grounded) vs Documented knowledge (KB cited) vs Principled reasoning (labelled).
- **Anchor phrases** (do not remove): *"I'm not here to make FriendPlace efficient. I'm here to help you keep it human, even as it grows."* · *"The community feels warmer because I'm here, not colder."* · *"You close the laptop smiling once in a while."* · *"I'll always want important decisions to have a human behind them."*
- **Focus from here:** building Mission Control and remaining FriendPlace features WITH George alongside — not redesigning George.



## 30 July 2026 — MCGS Slice 1 (Member Management) shipped
Migrated all member management from the mobile admin screen to the Next.js MCGS desktop surface, behind the identity-confirmation safeguard contract.
- **Pages:** `/admin/members` (search + status filter + paginated list) and `/admin/members/{id}` (identity header · Moderation Summary card · action bar · note composer · Ask George fairness prompts · unified timeline of reports + moderation_log).
- **Safeguards proven end-to-end** (Playwright): every consequential action (warn/suspend/ban/restore/delete) opens the `ConfirmIdentityAction` dialog first. The primary button is locked until (a) reason ≥3 chars and (b) "I have checked these details" checkbox ticked. Delete requires typing the Member ID (GitHub-style). Cancel is default focus. Escape closes without submitting.
- **Backend:** switched member-action endpoints from closure-scoped Pydantic body models to `body: dict = Body(...)` because Pydantic v2 wasn't binding the closure-scoped models as request bodies (they were being read as query params, silently failing). All six actions now land correctly with dual-writes to `moderation_log` and `admin_log`.
- **Timeline:** reverse-chronological interleaving of reports + moderation_log with Density (Compact/Comfortable) and Filter (All/Actions/Reports) toggles. Open reports carry inline quick-action buttons ("Warn from this", "Suspend", "Ban") that pre-seed the confirm dialog with the report id.
- **Ask George (5 fairness prompts on the profile):** summarise history · compare prior reports · spot patterns · unusual activity · **have we treated similar cases consistently?**
- **Retired mobile screen:** `/app/frontend/app/admin/user/[id].tsx` now shows a "Moved to Mission Control" screen with a rocket icon, the requested Member ID for reference, and a back-to-admin-home button. No moderation actions can be taken from mobile any more.
- **Tests:** `/app/backend/tests/test_mcgs_member_management.py` — 15/15 pytest cases pass in 0.4s. Retained as regression suite.
- **Next:** Slice 2 (Reports) — `/admin/reports` list + detail view + auto-link into member profile from any report row.


## 30 July 2026 — Two pre-launch product decisions recorded
Captured against KB entries so they don't get lost between now and launch.
- **KB-DEC-003 · Recipes belong within Share a Moment, not as top-level navigation.** Philosophy: *"Recipes aren't a destination — they're a way of sharing a moment with other people."* Removes Recipes from the primary nav; absorbs it into the Share a Moment composer (which reads *"A photo, a story or something that made you smile today"*).
- **KB-DEC-004 · Home screen becomes the welcoming centre of FriendPlace (V1 redesign).** Home is the room a member enters, not a dashboard. Reference mockup: `/app/memory/assets/home-screen-mockup-2026-07-30.png`. Tile layout: FP Café hero card at top · Find Friends / Local Events · Share a Moment / Community Groups · Notice Board / Games · My Profile card. Bottom nav = Home · Chats · FP Café · Friends · Profile (no Recipes tab).
- **KB-ROAD-002** updated to link both entries under a new "Pre-launch product decisions" section.
- Decisions are **admin-only** so George uses them when reasoning about scope with the admin, but doesn't leak the redesign to members before it ships.


## 31 July 2026 — No-guilt polish + Apple Sign-In Bundle ID aligned
Three refinements + one shipping-critical config fix, all under the "No guilt. Ever." principle.
- **Profile "Complete your profile" card softened.** Replaced the persistent nag + 4-chip missing-fields checklist with a single gentle one-liner that adapts to what's actually missing (photo → suburb → bio → interests). Copy example: *"Add a profile photo whenever you're ready."* A subtle × dismiss button records dismisses per-user in AsyncStorage (`profile_gentle_invite_dismisses_v1:{uid}`) and after two dismisses the card quietly disappears forever. Members can still add anything later from Edit Profile.
- **Marketing website Share-a-Moment showcase cards** on `/app/website/app/page.tsx` no longer display the ❤️ likes / 💬 comments counts. Guardrail per Garry, 26 June 2026: these are showcase cards, not a live feed — engagement counts subtly shift focus towards popularity. Locked wording *"No pressure. No expectations. Just everyday moments worth sharing."* remains beneath the grid.
- **Author profiles reachable from the feed and from comments.** Moment feed card now has a nested Pressable on the avatar + name row that opens `/user/{author_id}`; the rest of the card still opens the moment. Comment authors on the detail view are now tappable too — same intent, "I want to say hi to the person who left this warm word."
- **Apple Sign-In Bundle ID aligned with backend.** `app.json` iOS `bundleIdentifier` and Android `package` moved from `com.youbelong.community` → `au.com.friendplace.app` to match backend `APPLE_CLIENT_ID_IOS` / `APPLE_SIWA_CLIENT_ID`. Backend endpoint already carries the correct .p8 key (team `6XRMF8PK98`, key `9DAMF5JRK8`). 17/17 SIWA rotation tests pass end-to-end minting an ES256 JWT with the new audience. Native Sign-in flow can only be verified on a real iOS device via TestFlight (documented in `/app/memory/testflight-readiness-report.md`).


## 1 August 2026 — Embeddings 401 finally put to bed + Unified George KB

### Root cause identified after 3 forks
The Emergent LLM key gateway (`https://integrations.emergentagent.com/llm`)
does not expose any embedding models — only chat/image/TTS/whisper/video.
Previous forks kept trying to fix "the wrong endpoint"; the actual answer
is that embeddings simply aren't available via that key.

### The fix — one architectural decision
Switched from OpenAI `text-embedding-3-small` (cloud, key-dependent) to
`sentence-transformers/all-MiniLM-L6-v2` (local, ONNX runtime via
`fastembed`, 384-dim, zero external dependency). Weights (~90 MB) are
downloaded once from HuggingFace, cached in-process for the lifetime of
the container, and stored under `~/.cache/fastembed`. `EMBED_DIM` moved
from 1536 → 384. All 24 KB entries embedded and semantic retrieval
verified working ("someone who hasn't logged in for weeks" now retrieves
the No-Guilt principle even without literal word overlap).

### Knowledge Health card
New `GET /api/cms/knowledge-health` endpoint feeding a Mission Control
diagnostics card that shows Total / Embedded / Model / Last run at a
glance, with a "Re-embed everything" action for post-model-swap
backfills. Runs record themselves to `knowledge_meta` so the timestamp
survives restarts.

### Unified George — one memory, three personalities
- **KB is now the single source of truth** for all three Georges.
  Personality lives in each caller's system prompt; institutional
  memory lives in `knowledge_base`.
- New shared helper `services/george/kb_grounding.py::ground_for_george()`
  is the single hook every George calls. Enforces the visibility
  gate (`is_admin` derived from `surface`), formats the prompt block,
  writes telemetry.
- **MCGS George** → sees `visibility="public"` + `admin_context` layer
  + `visibility="admin"` entries.
- **Member George** (event creation, onboarding) → sees `visibility="public"`
  only. Wired into `event_creation/service.py::_compose_next` and
  `onboarding/service.py::_compose`.
- **Website /meet George** → same member-side pipeline, `visibility="public"` only.

### Telemetry — see which entries George consulted
New collection `george_kb_hits` records every retrieval:
`{surface, session_id, user_id/admin_id, query (first 400 chars),
hit_ids, hit_scores, hit_count, at}`. Exposed via
`GET /api/cms/knowledge-retrievals?limit=&surface=` with a 7-day coverage
roll-up per surface. Zero-hit queries are recorded too, so we can spot
topics the KB doesn't yet cover.

### Two new principles seeded to KB (visibility=public)
- **KB-PRIN-CELEBRATES** — *George celebrates the little things.*
  First moment, first friend, first event, Founding Member number.
  One line, warm, never confetti.
- **KB-PRIN-REMEMBERS** — *George remembers, gently.*
  Health check-ins, travel, family occasions. Only when it feels
  caring, never surveillance-y.

Every George everywhere now knows both principles — teach once, know
once. Verified by retrieval across all three surfaces.

### MCGS-only greeting familiarity (visibility=admin)
- **KB-PRIN-MCGS-FAMILIARITY** — *"Morning, mate." / "G'day, Garry."*
  Applies **only** to Mission Control. Roughly 1 greeting in 4-5, never
  twice in a row, never on the mobile app or public site. Visibility
  gate keeps this invisible to member/public Georges (verified end-to-end).
  Wired into `services/george/prompt.py::build_system_prompt` via the
  new `GREETING_FAMILIARITY_MCGS` block.

### Files touched
- `/app/backend/services/knowledge.py` — local ONNX embedder,
  `health()`, `backfill_embeddings(force=)`, new fallback filter that
  detects dim drift.
- `/app/backend/services/george/kb_grounding.py` — NEW; the shared
  hook every George uses.
- `/app/backend/services/george/chat.py` — MCGS chat now routes
  through `ground_for_george`.
- `/app/backend/services/george/event_creation/service.py` — member
  composer accepts `kb_block=`; both callers retrieve first.
- `/app/backend/services/george/onboarding/service.py` — onboarding
  composer accepts `kb_block=`; ground on every turn after the first.
- `/app/backend/services/george/prompt.py` — new
  `GREETING_FAMILIARITY_MCGS` block scoped to MCGS.
- `/app/backend/cms_module.py` — `/knowledge-health`,
  `/knowledge-retrievals`, `backfill-embeddings` now takes `force=`.
- `/app/backend/server.py` — ensure telemetry indexes at startup.
- `/app/backend/requirements.txt` — `fastembed`, `onnxruntime`, etc.
- `/app/website/lib/cms-api.ts` — `knowledgeHealth`, `knowledgeRetrievals`,
  `backfillKnowledgeEmbeddings({ force })`.
- `/app/website/components/knowledge/KnowledgeHealthCard.tsx` — NEW.
- `/app/website/app/admin/knowledge/page.tsx` — health card slotted
  above the drafts panel.
- `/app/memory/PRINCIPLES.md` — added rules 5, 6, 7.
- `/app/website/PUBLIC_EXPERIENCE_PRINCIPLES.md` — added celebration
  and memory principles (public); MCGS familiarity is deliberately
  admin-only, not published here.
- `/app/memory/design-morning-welcome.md` — NEW; specs the greeting
  screen we build tomorrow.

### What this means going forward
> Teach George something once — anywhere — and every George that's
> allowed to see it knows it immediately. No hardcoded prompt strings
> to update. No parallel knowledge stores drifting apart.


## 1 August 2026 — Daily Welcome shipped, data-driven end to end

Every FriendPlace member now sees George's greeting the first time they open the app each calendar day. Not before, not after. Not on refresh. Not on second visit. Just once, warmly, when they walk in.

- **Storage-driven**: greetings live in `george_greetings` (Mongo). Three kinds — `opener`, `warm_thought`, `invitation` — each with band (morning/afternoon/evening/any), weight, seasonal window, and an active flag. Zero greeting strings hardcoded in the Expo app.
- **Shape variation**: the backend picks one of four SHAPES per day, weighted so no shape dominates. 25% opener only. 30% opener+warm. 30% opener+invitation. 15% all three. Locked with Garry: *"real people don't greet you the same way every morning."*
- **Collision guard**: a small heuristic drops a warm thought that would create redundant phrasing with the chosen opener ("Nice to see you… It's lovely to see you." now becomes just "Nice to see you.").
- **Callback ready**: `callback` field in the payload replaces the warm thought when we ship "George remembers, gently" wiring. Today it returns null but the shape is stable.
- **Once per calendar day**: gated by `george_daily_welcome_state.{user_id, last_date}`. Local timezone from the user document; falls back to Australia/Melbourne. Force-preview available for admins via `GET /api/cms/george/greetings/preview`.
- **Admin CRUD**: full `/api/cms/george/greetings/*` set (list/create/update/delete/preview) so Garry (or any future admin) can add, retire, or seasonally schedule greetings without a deploy.
- **New public KB entry** `KB-PRIN-GREETS-LIKE-A-PERSON` seeded and embedded so every George everywhere knows the principle.

### Endpoints
- `GET /api/mcgs/george/daily-welcome` — member client hits this on Home mount. Returns `{shown, opener, warm_thought, invitation, callback, shape, band, date}` or `{shown: false}`.
- `GET /api/cms/george/greetings` — admin list.
- `POST /api/cms/george/greetings` — create.
- `PATCH /api/cms/george/greetings/{id}` — update.
- `DELETE /api/cms/george/greetings/{id}` — delete.
- `GET /api/cms/george/greetings/preview?first_name=Margaret` — preview without burning any user's daily slot.

### Files
- `/app/backend/services/george/daily_welcome.py` — NEW; all the greeting logic + seed + admin CRUD helpers.
- `/app/backend/mcgs_module.py` — member endpoint.
- `/app/backend/cms_module.py` — admin CRUD + preview.
- `/app/backend/server.py` — index+seed at startup.
- `/app/frontend/src/lib/george-api.ts` — `dailyWelcome()`.
- `/app/frontend/src/components/george/DailyWelcomeCard.tsx` — NEW.
- `/app/frontend/app/(tabs)/home.tsx` — mount above `MyStatusCard`.
- `/app/memory/PRINCIPLES.md` — added principle 8.
- `/app/memory/design-morning-welcome.md` — locked spec.

### Next up (per Garry's priority order)
- CRM Phase 2B (Resend delivery webhooks) — blocked on webhook URL in Resend dashboard.
- CRM Phase 2C (Segments).
- Wire George Remembers → Daily Welcome callback field once the "remembering plain-language facts" feature is scoped.
- Mission Control admin page for the Greeting Library (`/admin/knowledge/greetings`) — quality-of-life; low priority.


## 1 August 2026 — CRM Phase 2C shipped (Segments + Campaign Integration)
End-to-end delivery of the Segments system and its wiring into Campaigns.
- **Predicate DSL** (`services/segments.py`): declarative JSON tree — filters + and/or/nor/not compositors. 12 filter types (status, tag, days, suburb match, interests, campaign engagement, etc.). Adding a new filter registers a function in the DSL — never rewrites the query engine.
- **12 starter segments** seeded (`scripts/seed_starter_segments.py`): All Founding Members, New Members (last 7 days), Opted Out, Never Contacted, Warm Leads, Sydney Members, Melbourne Members, Brisbane Members, VIPs, Silent, Recently Engaged, Highly Engaged.
- **CMS Segments UI** (`/admin/segments` + `/admin/segments/[id]`): emoji-tinted cards, per-card actions (Edit / Duplicate / Refresh count / Archive / Create Campaign), live audience preview while building.
- **Campaign integration (Stage 4)**: `audience_filter.segment_id` in `CampaignAudienceFilter`. `_resolve_audience` intersects segment email set with the classic filter. `/admin/campaigns/new` shows Recipient toggle (`● Saved segment` / `○ Custom filter`); George quietly suggests 1-3 fitting segments as text is typed (`/api/cms/segments/suggest` — no LLM, just word-overlap over name/description/summary). Send button gates on segment-picked-and-count-greater-than-zero. ConfirmModal shows the chosen segment name + description. Backward-compatible with pre-2C drafts.
- **Verified end-to-end**: iteration_132 — backend 17/17 pass · frontend visually verified · no email sending triggered during tests.

## Product Polish Backlog (next after Phase 2C — see `/app/memory/product-polish-backlog.md`)
Locked with Garry 1 Aug 2026. Four items ship together as one polish phase
before the next major feature set (George Analytics, Moderation Drafts,
Reports migration).
1. 🦋 Replace the legacy green butterfly with the new FriendPlace butterfly
   everywhere (mobile, marketing site, Mission Control, emails, icons).
2. 💬 George Workspace chat window — draggable, remembers session position,
   clamps to viewport, preserves minimise/restore.
3. 🖥️ Mission Control responsive layout — no horizontal clipping, cards
   resize gracefully, usable on 13"/14" laptops, no horizontal scrolling.
4. 📣 Flyers — one shared library. Mission Control authors (create/edit/
   publish/archive); mobile app displays only. The two flyers already
   created in MCGS must automatically appear everywhere post-merge.


## 1 August 2026 — Product Polish Phase 1 shipped ✅

Three of four polish items shipped in a single session. The fourth
(Flyer Publishing Centre) is fully specified and queued for the next
session — see `/app/memory/flyer-publishing-centre-plan.md`.

### 🦋 The FriendPlace butterfly — one canonical mark, everywhere
- The **marketing website butterfly** is now the single official
  FriendPlace butterfly. Master PNGs: `/app/website/public/brand-assets/butterfly.png`
  + byte-identical mirror `/app/frontend/assets/brand/friendplace-butterfly.png`.
- Single component (web + RN mirror): `GeorgeButterflyMark`. Every
  butterfly slot on every surface renders this component.
- 34 standalone butterfly displays swapped across 19 mobile files;
  marketing hero/features/success-stories/launch converted; all
  Mission Control cards + floating chat + credo now on the master
  butterfly.
- **Brand doctrine locked** in `/app/memory/FRIENDPLACE_BUTTERFLY.md`:
  represents *two people coming together*, belonging, friendship,
  hope, community. The heart between the upper wings is intentional.
  Evolution is allowed; redesign or reinterpretation is not.

### 📜 The Credo — daily reminder in Mission Control
> **"Every friendship begins with two people."**

Displayed quietly beneath the "Mission Control" heading in the
sidebar. Italic, faded, whispers rather than shouts. Every feature
we build ultimately helps those two people find one another.

### 🖥️ Mission Control responsive layout
Sidebar tightened to 240px; main column padding responds at
1400/1280/1160px; Bridge grid stacks below 1080px; `min-width: 0` on
all grid children. **Zero horizontal scroll verified at 1200 · 1280 ·
1440 · 1920px.**

### 💬 George's floating chat is a professional draggable window
- Drag by the header (six-dot handle + `cursor: grab`)
- Position remembered in `sessionStorage`
- Viewport-clamped on drag AND on window resize
- Escape closes; minimise/restore preserved
- Desktop: no backdrop so you can still see The Bridge behind
- Narrow (<720px): light backdrop for touch-dismiss

### Next
Product Polish Phase 1 is **complete**. Tomorrow: start with the
**Flyer Publishing Centre** exactly as specified in
`/app/memory/flyer-publishing-centre-plan.md`.
