# Milestone A — v1.2 Baseline (FROZEN 19 July 2026)

> *"FriendPlace is where George lives. Mission Control is where we perfect him. You are not building an admin AI — you are building the FriendPlace companion."*

Milestone A is the foundation of George as a **shared community platform**. Everything below is frozen; future work extends this baseline, it does not rewrite it.

---

## What v1.2 delivers

### 1. The shared conversation engine
- `/app/website/components/george/GeorgeConversation.tsx` — role-agnostic, mounted by any surface.
- Surfaces pass a `GeorgeConversationChrome`; George is not aware of Mission Control, the website, or the mobile app.
- Composer prompt (Claude Sonnet) enforces the 5 tone rules: excitement, working, celebration, natural reasoning, forgiveness of mind changes.
- Extractor (Claude Haiku) captures fields incrementally; grounded defaults resolve venue/time/etc from history.
- Action Preview is conversation-first: `✓ Confirm & Create` (primary), `✏️ Make Changes` (refocuses composer), quiet `Advanced edit` link.

### 2. Permission-based publishing
- `/app/backend/services/george/permissions.py` with `KNOWN_CAPABILITIES = (publish_events, create_groups, message_members, manage_volunteers)`.
- Publishing is a **permission**, not a role. Verification ≠ publishing permission.
- Approve endpoint returns `outcome: "published" | "submitted_for_review"`; the shared engine reads this and picks the right role-aware success line.
- Moderation queue collection `events_pending_approval` + admin endpoints `GET /api/mcgs/events/pending-approval`, `POST /.../{id}/approve`, `POST /.../{id}/decline`.

### 3. The butterfly — signature interaction
- `/app/website/components/george/GeorgeButterfly.tsx` + custom SVG mark `GeorgeButterflyMark.tsx` (teal→cyan gradient, deeper teal body, brand-ready).
- Arrival: once per calendar day per actor (`localStorage["george.lastArrival.<actorId>"]`); warmer tone after ≥ 3 days away; ≈28% of arrivals do a gentle looping arc for variation.
- Landing at bottom-right, warm greeting bubble blooms, auto-fades after 6.5s (or on scroll/keypress/tap).
- Resting forever in the bottom-right corner, quiet idle wing-flutter every ~90 s.
- Tap → tiny flutter, then floating chat sheet (`GeorgeFloatingChat`) which mounts the same shared engine.

### 4. First-time introduction (once, forever)
- Backend flag `cms_admins.george_first_met_at` (later `users.george_first_met_at` for mobile members).
- `GET /api/mcgs/george/presence` → `first_meeting: true` when absent.
- Full welcome script: *"Hi, I'm George. Welcome to FriendPlace. It's lovely to meet you…"* including *"play games together"* and ending with *"Why don't we start by getting to know each other?"*.
- Three warm choices: **Yes, show me around** (opens the floating chat), **Let's just have a chat first** (opens the floating chat), **Maybe later** (dismisses).
- Introduction bubble does NOT auto-fade. Any acknowledgement → `POST /api/mcgs/george/introduced` → field set with `$setOnInsert`-style guard so the audit timestamp reflects the *actual* first meeting.
- Never re-shown thereafter. Subsequent greetings assume familiarity, with continuity when we have an unfinished draft or a recent completed one.

### 5. Presence
- `GET /api/mcgs/george/presence` returns `{ actor_id, name, unfinished: [...], last_completed, first_meeting }`. Pure Mongo, no LLM cost.
- Powers name-personalised greetings, continuity ("Your bowls tournament draft is still here whenever you'd like to continue"), and the first-meeting gate.

### 6. Mission Control consumes George
- `/admin/george` — George's Workspace landing (7 capability tiles; only Create Event live).
- `/admin/george/new-event` — thin admin wrapper mounting `GeorgeConversation`.
- Bridge (`/admin/bridge`) has a warm suggestion card.
- Sidebar item `George's Workspace`.
- **Nothing under `/components/mcgs/` still owns George.** MC is purely a consumer.

---

## Guiding principles active in v1.2 (see `/app/memory/mcgs-architecture.md` for full list)

1. George is central, not an add-on.
5. George should reduce cognitive load, not increase it.
6. Silence is a feature.
7. George feels present.
8. George should build a relationship.
9. George should reduce the effort required to bring people together.
10. George should never make people feel like they're filling out a form.
11. George may infer, but never assume.
12. George should make organising an event feel exciting, not administrative.
13. **George is a platform, not a feature.**
14. **FriendPlace is where George lives. Mission Control is where we perfect him.**
15. George introduces himself exactly once.
16. **George is a community companion, not an AI assistant.**

---

## Verified end-to-end (19 July 2026)

All frontend + backend flows tested by the testing agent (iteration_72):
- ✅ Introduction bubble renders full script + three choices, does not auto-fade.
- ✅ `Yes, show me around` opens the floating chat with the same shared engine.
- ✅ Returning greeting shows the admin's first name ("Garry").
- ✅ Tap on butterfly works during both `landed` and `resting` phases.
- ✅ `/presence` and `/introduced` idempotent and correctly typed.
- ✅ Full conversational event creation: warm draft → conversational edit → Confirm & Create → "Your event is live." success screen.
- ✅ No regressions on Bridge, Workspace, sidebar navigation.

---

## What v1.2 does NOT deliver (deliberately)

- **Mobile George** — the destination. Milestone B starts here.
- **Member web login** — members still only authenticate on mobile.
- **Proactive companion behaviours** (principle #16) — architectural room is reserved; no proactive nudges yet.
- **Verified organisations** — verification and `publish_events` are separate; verified-org flow is not yet implemented.
- **Group / announcement / newsletter / games / volunteer capabilities** — all plug into the same platform, but not yet wired.

---

## Files at freeze

Backend:
- `/app/backend/services/george/permissions.py`
- `/app/backend/services/george/event_creation/service.py`
- `/app/backend/services/george/event_creation/__init__.py`
- `/app/backend/mcgs_module.py` (routes for `/mcgs/george/event/*`, `/mcgs/george/presence`, `/mcgs/george/introduced`, `/mcgs/events/pending-approval/*`)

Frontend (Mission Control consuming George):
- `/app/website/components/george/GeorgeConversation.tsx`
- `/app/website/components/george/GeorgeButterfly.tsx`
- `/app/website/components/george/GeorgeButterflyMark.tsx`
- `/app/website/components/george/GeorgeFloatingChat.tsx`
- `/app/website/components/george/GeorgeSuggestionCard.tsx`
- `/app/website/lib/george-api.ts`
- `/app/website/lib/mcgs-api.ts` (event creation client)
- `/app/website/components/admin/AdminShell.tsx` (mounts `<GeorgeButterfly />`)
- `/app/website/app/admin/george/page.tsx` (Workspace landing)
- `/app/website/app/admin/george/new-event/page.tsx` (thin admin wrapper)
- `/app/website/app/admin/bridge/page.tsx` (imports the suggestion card)

Docs:
- `/app/memory/mcgs-architecture.md` (North Star at top, principles #13–#16)
- `/app/memory/george-platform.md` (platform contract, North Star at top)
- `/app/memory/milestone-a-baseline-v1.2.md` (this file)
- `/app/memory/milestone-b-mobile-plan.md` (the next milestone)
