# Milestone B — Bringing George into the FriendPlace mobile app

> *"I don't want members to feel like they're opening another app. I want them to feel like someone has welcomed them into a community."* — Garry, 19 July 2026

---

## North Star for this milestone

Milestone A proved the shared platform in Mission Control. **Milestone B is the moment George moves into members' hands.** Every design decision is measured against a member opening their phone for the very first time. Mission Control is a reference implementation; the mobile experience is the real thing.

---

## Priority order (locked)

1. **George arrives** with the butterfly.
2. **George introduces himself** — the same welcome script as Mission Control, adapted to a phone screen.
3. **George welcomes the member** on returning sessions with a warm familiar greeting.
4. **George begins a conversation** — tap the butterfly, floating chat opens.
5. **George helps organise an event** — the same shared engine, hitting the same backend endpoints.
6. **George remains quietly present** through the butterfly, forever in the corner.

Everything after this (proactive noticing, groups, announcements, invitations, volunteering, newsletters, games, community activities) grows from the same platform and can wait.

---

## Success test

A new member downloads FriendPlace, taps in, and — without ever reading a tutorial — walks away thinking:

> *"Someone welcomed me. That was surprisingly enjoyable."*

---

## Technical shape (proposed — to be locked with Garry at the start of the mobile session)

### Native components to build (Expo, React Native)

| Component | Role | Reference |
|---|---|---|
| `GeorgeButterfly` (RN) | Same interaction as the web version | `/app/website/components/george/GeorgeButterfly.tsx` |
| `GeorgeButterflyMark` (RN) | Same SVG, using `react-native-svg` | `/app/website/components/george/GeorgeButterflyMark.tsx` |
| `GeorgeConversation` (RN) | Same conversation engine, native chrome | `/app/website/components/george/GeorgeConversation.tsx` |
| `GeorgeFloatingChat` (RN) | Bottom-sheet chat surface | `/app/website/components/george/GeorgeFloatingChat.tsx` |

### Animation approach

- `react-native-reanimated` v3 worklets for the butterfly path (matching the web keyframes but with the native performance headroom to feel truly gentle).
- `react-native-svg` for the butterfly mark (same shape, same gradients).
- `Animated.spring` for the greeting bubble bloom to match the *bloom, don't slide* feel.

### Backend contract (no changes)

The mobile app uses the same endpoints:

- `GET  /api/mcgs/george/presence` — returns `first_meeting` too, so mobile picks up the introduction flag automatically.
- `POST /api/mcgs/george/introduced` — retires the introduction.
- `POST /api/mcgs/george/event/start` / `/turn` / `/session/{id}/approve` / `/cancel` — conversation.
- `GET  /api/mcgs/george/event/session/{id}` — rehydrate.

**One change required for mobile:** the `george_first_met_at` field currently lives on `cms_admins`. For mobile members it must live on `users` — the presence endpoint should read from whichever collection matches the caller's auth type. This is a small backend refactor at the start of Milestone B.

### Where the butterfly lives on mobile

- **On every authenticated screen** — Home, Events, Groups, Profile, etc.
- **Arrival fires once per calendar day per actor** — same storage semantics as web, but using `SecureStore` / `AsyncStorage`.
- **First launch after install → introduction plays.** Regardless of the daily gate.

### Entry points on mobile

1. **Persistent butterfly button** bottom-right of every authenticated screen.
2. **"Talk to George"** entry from the Events tab (matches principle #9 — reduce effort to bring people together).
3. **"Talk to George"** entry from the Groups tab (planned; not blocking mobile Milestone B).

---

## What NOT to do in Milestone B

- Do not build capabilities beyond event creation. Groups, announcements, games etc. wait for Milestone C.
- Do not introduce a mobile-specific George voice or personality. He is one George.
- Do not fork the conversation engine. If mobile needs something the web version doesn't, add it to the shared engine and update both.
- Do not build proactive companion behaviours yet. That is a future milestone; the room for it is already reserved in the architecture.

---

## Definition of done

1. On a new install, opening the app → butterfly flutters in → introduction plays → member can choose to start a conversation or dismiss.
2. On a returning session, the butterfly rests quietly; tapping opens the floating chat.
3. A member can create an event by tapping the butterfly and having a natural conversation. The event lands in `events_pending_approval` (because members default to `publish_events=false`) with `submitted_for_review` as the outcome, and the success screen reads: *"Off to the FriendPlace team."*
4. Mission Control now shows this pending item in its moderation queue. An admin can approve or decline; approval publishes to `events`.
5. Every animation feels intentional; every greeting warm; every moment feels like *someone welcomed you*, not *you opened an app*.

---

## First question — RESOLVED (19 July 2026)

> **George introduces himself BEFORE profile completion.**

Garry's decision, locked:

> *"George should become the guide who helps people complete their profile, rather than appearing afterwards. Instead of presenting a registration process, we can turn onboarding into a conversation."*

The consequences of this decision are architectural:

1. **There is no separate onboarding form.** The first thing a new member sees after sign-up is the butterfly arriving. Profile fields (name, age band, interests, suburb, availability, "what would you like more of in your life?") are collected *by George in conversation*, not by a stepper.
2. **Onboarding becomes George's first capability.** Following the same pattern as event creation (Haiku extractor + Sonnet composer, grounded defaults where they exist, one warm question at a time, Action Preview at the end).
3. **The introduction script leads directly into the profile conversation.** After *"Why don't we start by getting to know each other?"*, tapping **Yes, show me around** opens the floating chat which already has George's first onboarding question ready.
4. **Profile completion is a permission** (`profile_complete`), not a screen. Some George capabilities (creating an event, joining a group) may check this permission; George will offer to finish the last piece of profile before proceeding, warmly.
5. **The Action Preview at the end of onboarding** shows the member their draft profile with the same *Confirm & Save* / *Make Changes* pattern. Editing is conversational: *"Actually, I'd rather not share my street name."*

---

## Proposed slice order for Milestone B (locked with Garry, 19 July 2026)

To keep each mobile session testable, we ship in narrow slices. Each slice ends with something a member can *feel*.

### Slice B1 — The mobile butterfly (foundation)
- Native `GeorgeButterfly`, `GeorgeButterflyMark`, arrival animation via Reanimated 3, resting state, tap gesture.
- Presence endpoint read (name, `first_meeting`).
- Persistent on the Home screen only for now.
- Success test: install the app, log in — the butterfly flutters in, lands, gives a warm greeting bubble, and rests.

### Slice B2 — The first introduction (once, forever)
- Native introduction bubble with all three choices, wired to `POST /api/mcgs/george/introduced`.
- Backend refactor: `george_first_met_at` moves from `cms_admins` to the `users` collection when the caller is a member. Presence + introduced routes now support both actor types via the existing auth machinery.
- Success test: fresh member sees the full introduction on first launch; never again after.

### Slice B3 — George's floating conversation
- Native `GeorgeFloatingChat` bottom sheet mounting the shared engine.
- Shared engine ported: React Native version of `GeorgeConversation` with the same `chrome` contract. Same backend endpoints, same tone rules, same Action Preview.
- Success test: tap the butterfly → sheet opens → the intro's *"Yes, show me around"* leads directly into a conversation.

### Slice B4 — Conversational onboarding (George's first real task)

> **Framing (locked with Garry, 19 July 2026):** B4 is *not* profile completion. It is *"George learning enough about someone to begin helping them belong."* Every design decision below must honour that framing.

**Continuity contract**

- When the member taps the butterfly for the first time after choosing *"Yes, let's begin"*, George picks up *exactly* where he paused. No re-introduction. No "start onboarding" screen. No visible shift into a form or workflow. His first line is:
  > *"Let's start with something easy. What would you like me to call you?"*
- Presence will tell us whether an onboarding session is in flight or complete. Tapping the butterfly resumes that session rather than starting a new one.

**How George gathers information (this is what makes it different from a form)**

1. **He listens naturally, never interrogates.** A single natural answer can populate several fields. E.g. from *"I'm recently retired and mostly looking for people nearby to have coffee with"* George may infer: age band ≈ 60+, life stage = retired, interest in local friendships, coffee-style casual social preference, desire for nearby connections.
2. **He acknowledges what he heard**, then asks only for what is still genuinely missing — and only if it matters.
3. **Sensitive questions are gentle and optional.** *"Would you mind telling me roughly what area you live in? A suburb is plenty — you don't need to share your address."*
4. **"I'd rather skip that" is always welcome.** George responds warmly and continues without pressure. Skipped fields are marked `skipped=true` server-side so we never re-ask.
5. **George stops as soon as he has enough to begin helping.** He is not trying to fill a form.

**Member-language Action Preview**

Not *"Confirm & Save"*. Not *"database field: value"*. Written the way one person hands notes to another:

> **Here's what I've learned about you**
> Name: Alex
> Area: The Ponds
> Interested in: Coffee, gardening and local outings
> Usually available: Weekday mornings
> Looking for: More friendship and regular social activities

Buttons: **That looks right** (primary) · **Change something** (continues the conversation) · **Finish later** (soft dismiss; the session remains resumable).

**Backend shape**

- New capability under `/app/backend/services/george/onboarding/` mirroring `event_creation/`:
  - Haiku extractor: many fields, high recall, careful with confidence.
  - Sonnet composer: same 5 tone rules; explicit rule to *listen and acknowledge* before asking anything new.
  - Endpoints: `POST /api/mcgs/george/onboarding/start`, `POST /.../session/{id}/turn`, `GET /.../session/{id}`, `POST /.../session/{id}/approve`, `POST /.../session/{id}/cancel`.
  - Approve writes profile fields to the member's `users` document and sets `profile_complete: true`. Skipped fields are recorded, not retried.
- Presence endpoint gains `onboarding: { session_id, status, last_george_line }` so any surface can seamlessly resume.

**Mobile shape**

- Port the shared `GeorgeConversation` engine to React Native. Same chrome contract as web.
- Tapping the butterfly for a member without `profile_complete=true`:
  - If an onboarding session exists → resume it.
  - Otherwise → start onboarding with George's warm bridging line.
- Action Preview rendered in member language exactly as above.
- Skip affordance ("I'd rather skip that") available every turn via a small quiet chip below the composer, not as a big red button.

### Slice B5 — Event creation on mobile (deferred until B1–B4 feel right)
- The same `GeorgeConversation` engine, now with the event-creation capability wired.
- Member submissions route to `events_pending_approval`; Mission Control reviews them.
- Success test: a member creates an event by tapping the butterfly. It lands in Mission Control's moderation queue. An admin approves it. It appears in the member's Events tab.
