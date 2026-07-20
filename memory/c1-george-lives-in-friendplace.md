# C1 — George Lives in FriendPlace

Renamed with Garry 22 July 2026 from *"George as FriendPlace Companion"*.
The rename matters: after Slice 3, George is no longer attached to
Home. He lives alongside the member across every screen, and the
conversation lives with him. Ships in three slices (all now SHIPPED).

## Overall shape

George keeps ONE identity and ONE home in FriendPlace: the butterfly
that lives at the top-right of the Home screen, next to the FriendPlace
logo. Tapping him always opens the same modal — the same face, the
same voice, no separate "chat with George" tab or button anywhere
else in the app. The Chats tab is reserved for **member-to-member**
messaging and must never become a second entrance to George.

The butterfly is George's front door. What happens inside the modal
depends on what George knows about the member right now:

- **Genuinely paused event conversation exists** → George opens with a
  warm, continuity-aware welcome-back and offers *carry on* / *start
  something new* (B5 behaviour, unchanged).
- **No paused event** → George opens with a broad, warm, time-of-day
  greeting. The composer says *"Tell George anything…"*. Nothing about
  the surface assumes the member has come to create an event.

The rest of the C1 work happens **inside the LLM prompt and the routing
logic**, not in the UI. From the member's point of view, George just
got a lot more helpful.

## Slice 1 — Companion Router (SHIPPED)

**Goal**: George recognises intent across events, navigation, groups,
notices, friends and general chat, and responds naturally to each,
without forcing everything back into event creation.

**Success test messages** (Garry, 21 July 2026):
- "Where are the games?"
- "How do I update my profile?"
- "What is the Coffee Lounge?"
- "I'd like to organise a barbecue."
- "I'm having a difficult day."
- "Who can see my notice-board post?"

Each of these should receive a direct, natural, honest response.

### Principles locked in the prompt

1. **Answer first, then chat.** Direct answer in one sentence, then
   the warm follow-up. Never scripted preambles like *"Great question!"*.
2. **Natural, not instructional phrasing.** Not *"To find X, go to Y
   and tap Z"* — instead *"X is on Y, just tap Z and you'll be there."*
3. **Shortest path first.** One clear path when George knows the
   answer; never list every possible route.
4. **Confidence rule.** Below ~90% confidence, say so honestly.
   *"I don't want to guess — the Help tab is the safest place to check."*
5. **Observation, not repetition.** Notice the INTENT, not the noun.
   *"I'd like a barbecue"* → *"That could be a lovely way to bring
   a few people together"*, not *"A barbecue sounds like fun"*.
6. **Sticky event mode.** Once mid-plan, a general question mid-
   conversation gets a two-sentence answer and a gentle offer to
   return. Only explicit "start over" resets it.
7. **Conversational continuity.** *"I forgot what we were doing"*
   gets a warm reminder using EXTRACTED + last turns.
8. **Asked to do the whole thing.** *"Just set it up for me"* → George
   helps compose the draft; the member still taps Approve. Never
   pretend the event was sent.
9. **Out-of-scope questions.** Weather, news, general knowledge →
   honest *"I can't check that for you"* without shutting the door.
10. **Sensitive topics** (medical, legal, financial, emotional) get
    a warm human acknowledgement (no therapy language), Coffee Lounge
    for company FIRST, professional help / Lifeline (13 11 14) ONLY
    when it genuinely fits — not on every sad turn.
11. **Bereavement / deep grief.** Slow all the way down. Acknowledge
    briefly. No signposting on the first turn. Company invitation
    only if it fits the moment.
12. **Deferrals**: account/security/support → Help tab; moderation
    and reporting → Help tab; emergencies → 000; missing info →
    honest "I don't have that in front of me"; personal decisions →
    George helps think it through, never decides for the member.
13. **Never invent facts.** "I don't have that in front of me" is a
    perfectly good answer.
14. **Never pretend an action happened** unless George truly has that
    capability. In C1 he can compose event drafts (for approval) but
    cannot post to notices, message friends, update profile fields,
    change passwords, delete accounts, or report on the member's behalf.

### Architecture (Slice 1)

**Same session model.** All George conversations continue to live in
`george_event_conversations` (the collection name predates C1 — a
future refactor may rename it). Every session has:
- `turns[]`: role + content + optional excitement/working/warmth/suggestion
- `extracted{}`: rolling event-field state (populated only when there's
  event content — general chat leaves it untouched)
- `draft{}`: only populated when the composer reaches `ready_to_draft`
- `status`: `in_progress` | `drafted` | `paused` | `approved` | `cancelled`
- `pending_suggestion`, `suggestion_offered`: names/description/invitation nudges

**Same endpoints.** Slice 1 does not add any new routes:
- `POST /api/mcgs/george/event/start` — starts (or bare-opens) a session
- `POST /api/mcgs/george/event/session/{id}/turn` — sends a turn
- `POST /api/mcgs/george/event/session/{id}/approve` — creates the event
- `POST /api/mcgs/george/event/session/{id}/pause` — save for later
- `POST /api/mcgs/george/event/session/{id}/cancel` — don't save
- `POST /api/mcgs/george/event/session/{id}/resume` — welcome back
- `GET  /api/mcgs/george/presence` — decides which modal to open

The Slice 1 win is **the composer prompt** (Sonnet 4.5) doing the
routing internally. `_compose_next` sees the whole conversation, the
extracted state, and the payload, and decides:
- Is the member mid-plan? Stay in event context.
- Is this a general question? Answer directly using the FriendPlace map.
- Is this sensitive? Route through the SENSITIVE TOPICS rules.
- Is this a deferral moment? Route through DEFERRALS.

The Haiku extractor keeps running for every user turn — cheaply pulling
event fields when they're present, returning nulls when they're not.
`_merge_extracted` only writes non-null patches, so general chat never
pollutes the event state.

## Slice 2 — App Navigation Chips (SHIPPED)

**Goal**: George can deep-link the member to the right screen with a
soft, tappable chip below his answer. Members don't have to remember
instructions — they follow George's lead.

### Contract

The composer JSON schema (Sonnet 4.5) now accepts:

```json
"navigate_to": {
  "key": "home | chats | friends | lounge | profile | games | groups | notices | events | recipes | founders | help | notifications | settings",
  "label": "e.g. 'Take me to Games'"
}
```

Rules baked into the prompt (NAVIGATE_TO USAGE section):

- ONE `navigate_to` per turn max.
- `key` MUST be one of the whitelisted keys (frontend drops any others).
- Never on sensitive-topic, bereavement, emergency, or "I can't help"
  turns.
- Never during active event creation (`state=needs_question` with a
  draft in progress, or `state=ready_to_draft`).
- Only when George has just said "X is on the Y screen" and a
  shortcut would genuinely help.
- The `message` still contains the natural sentence; the chip is a
  shortcut, never a replacement.

### Backend

- `_clean_navigate_to()` validator in
  `/app/backend/services/george/event_creation/service.py` — enforces
  the whitelist, applies a small alias table (`coffee_lounge` → `lounge`,
  `notice_board` → `notices`, singular → plural fallbacks), caps
  labels at 40 chars.
- Every George turn record now carries `navigate_to: {key, label} | null`.

### Frontend

- Authoritative map lives at `/app/frontend/src/lib/george-nav-map.ts`
  with typed `GEORGE_NAV_MAP` and `resolveGeorgeNavigate()`. The two
  whitelists (backend + frontend) MUST stay in sync — if a key is
  added on one side, add it on the other in the same PR.
- Chip renders as a single "Take me to X" primary button below the
  George turn, using the existing `chipPrimary` style so it feels
  identical to the welcome-back / suggestion chips.
- Tap → `onLeave()` closes the modal, then `router.push(target.href)`
  on the next tick so dismissal completes cleanly.
- Chip is only shown when `!busy && !showPreview` and the turn has
  a resolvable navigate_to — belt-and-braces alongside the prompt rule.

### Adding a new destination

1. Add the new key to `_NAVIGATE_KEYS` and `_NAVIGATE_DEFAULT_LABELS`
   in `services/george/event_creation/service.py`.
2. Add the new entry to `GEORGE_NAV_MAP` in
   `/app/frontend/src/lib/george-nav-map.ts`.
3. Update the FriendPlace map in the composer prompt so George knows
   the destination exists.
4. Both whitelists are the security perimeter — a hallucinated key is
   silently dropped on both sides.

## Slice 3 — George Follows the Member (SHIPPED)

**Locked with Garry 22 July 2026, from post-Slice-2 real-conversation
testing feedback.** The core principle:

> "George follows the member, and the conversation follows George."

Before Slice 3 George was only present on Home, and closing his modal
meant losing the conversation. The whole point of Slice 3 is that this
never happens again.

### Persistent butterfly everywhere

`GeorgeGlobalHost` lives at the root of the app (mounted from
`app/_layout.tsx`) and renders `<GeorgeButterfly />` on every member
screen — Home, Chats, Friends, Coffee Lounge, Profile, Games, Groups,
Notice Board, Events, Recipes, Founders, Help, Settings, Notifications,
and any secondary pages under those. Hidden on `/`, `/auth/*`,
`/onboarding`, `/waitlist`, and whenever there is no authenticated user.

The `<GeorgeButterfly />` component was NOT moved — only its mount
point. The daily-arrival animation and greeting bubble still fire once
per calendar day, just as before, but now from the root layout so the
animation isn't repeated on every tab switch.

### Conversation follows George (session persistence)

`GeorgeProvider` maintains `activeSessionId` in memory and mirrors it
to AsyncStorage under `george.activeSession`. The rules:

- Every session created via `eventStart` or `eventResume` writes its
  id to the context.
- Reopening the George modal on **any** screen picks up the same
  session, restoring turns/draft/status server-side.
- Terminal outcomes clear the sticky id:
  - `dontSave()` — server-side cancel + `clearActiveSession()`
  - `eventApprove()` — successful post + `clearActiveSession()`
- `saveForLater()` explicitly does NOT clear the sticky id — the
  paused session is still the one the member will resume next.

Server remains the source of truth for content. The AsyncStorage cache
only tracks WHICH session to resume, never any turns or draft data.

### Current-screen context awareness

`usePathname()` is normalised to a canonical key by `pathnameToScreenKey`
(home / lounge / friends / events / groups / notices / games / profile /
chats / recipes / help / settings / notifications / founders / etc.).
This key rides on every API call:

- `POST /api/mcgs/george/event/start` — body includes `current_screen`
- `POST /api/mcgs/george/event/session/{id}/turn` — same

The backend `_compose_next` and `_compose_bare_opener` receive it and
add it to the JSON payload the Sonnet composer sees. The prompt tells
George: **"context is usually invisible. Use it to make answers better,
never to narrate where the member is."**

### Screen-aware openers

Bare openers (i.e. tapping the butterfly with no seed text) now
optionally use a screen-aware line ~35% of the time on non-Home
screens. Locked library:

- **Lounge**: *"Hi Alex. Is there anything I can help you with while you're here?"*
- **Events**: *"Looking for something in Events?"*
- **Profile**: *"Would you like a hand with your profile?"*
- **Friends**: *"Looking for someone in particular?"*
- **Groups**: *"Anything I can help with in Groups?"*
- **Notices**: *"Anything I can help with on the Notice Board?"*
- **Games**: *"Fancy a game?"*

The other 65% of the time the neutral time-of-day greeting still wins,
so George never sounds like he's narrating the app.

### Request acknowledgement (prompt rule)

When a member explicitly asks George to do something ("Can you take me
to X?", "Show me my profile"), the composer opens with a short rotating
acknowledgement (*Absolutely / Sure thing / Of course / Here you go /
Certainly / Happy to / On it*) before the info + chip. Never used for
plain "where is X?" questions — those still get answer-first.

### Greeting bubble dwell time

Bumped from 6.5s → 12s so longer returning-user greetings have room to
be read before the bubble tucks away. Tap-to-dismiss still works.

### Files touched

- `/app/backend/services/george/event_creation/service.py` — `current_screen`
  threaded through `start_event_conversation`, `take_conversation_turn`,
  `_compose_next`, `_compose_bare_opener`; new `_pick_greeting_with_screen`
  library; three new locked prompt sections (CURRENT SCREEN, REQUEST
  ACKNOWLEDGEMENT).
- `/app/backend/mcgs_module.py` — `EventConversationStartIn` +
  `EventConversationTurnIn` accept `current_screen`.
- `/app/frontend/src/lib/george-context.tsx` — new (`GeorgeProvider` +
  `useGeorge`).
- `/app/frontend/src/components/george/GeorgeGlobalHost.tsx` — new.
- `/app/frontend/src/lib/george-api.ts` — `eventStart` + `eventTurn`
  now take `currentScreen`.
- `/app/frontend/src/components/george/GeorgeEventCreation.tsx` — uses
  context; resumes stored active session; passes `currentScreen`;
  clears session on approve/cancel.
- `/app/frontend/src/components/george/GeorgeButterfly.tsx` — greeting
  dwell bumped to 12s.
- `/app/frontend/app/_layout.tsx` — mounts `<GeorgeProvider>` +
  `<GeorgeGlobalHost />`.
- `/app/frontend/app/(tabs)/home.tsx` — local `<GeorgeButterfly />`
  removed.

## Slice 3 v2 — Post-testing fixes (SHIPPED 22 July 2026)

Fixed after Garry's Slice 3 walkthrough revealed 7 issues.

### 1. Request acknowledgements now fire (Issue 1)

Composer prompt's REQUEST ACKNOWLEDGEMENT section rewritten to expand the
recognised action-verb library: "take me to", "let's go to", "let's
head to", "head to", "jump to", "bring me to", "open", "show me", "go
to", "help me post/share/find", "walk me through", "would you...". The
distinction is now sharp:

- *"Where is X?"* → answer-first, chip optional.
- *"Take me to X" / "Let's go to X"* → acknowledgement + answer + chip.
- *"Can you help me do X?"* → acknowledgement, guide them in, +chip.

Rotating library expanded to 10 openers so George never repeats himself.

### 2. Butterfly visibility halo (Issue 2)

`butterflyPress` now paints a soft white 88%-opacity halo behind
George with a subtle iOS shadow (Android elevation). Cheap to render,
keeps him legible against the teal Lounge buttons and any coloured
backdrop.

### 3. Flutter-in on George-led navigation (Issue 3)

New `landedFrom` + `markGeorgeLedNavigation()` + `consumeLanded()` in
`GeorgeProvider`. The "Take me to X" chip sets `landedFrom` to the
destination just before `router.push`. `<GeorgeButterfly />` watches
`landedFrom`; when the pathname matches the destination it plays a
short (~900ms) settle-in animation from a small offset. Then clears
the flag. Never fires on manual member navigation.

### 4. Feature-help now guides instead of refusing (Issue 4)

New composer prompt section HELPFUL FOR FEATURES YOU CAN'T FULLY DO
YET. Rule: George NEVER stops at *"I can't do that yet."* He must
acknowledge, guide, add a `navigate_to` chip when one exists. Examples
baked in for recipes ("open Recipes and tap 'Post your recipe' — I'll
take you there"), invitations, profile edits, etc.

### 5. False "Games hub" event resume (Issue 5)

Root cause: the Haiku extractor was scooping FriendPlace screen names
into `extracted.title`, then `_session_has_event_content` was
returning True on title alone. Fixed at three layers:

- **Extractor prompt** now has a CRITICAL section listing every
  FriendPlace screen name as never-events. Only extract event
  content when there's a real gathering signal AND a supporting
  fact (date / time / location / capacity).
- **`_merge_extracted`** rejects any title that matches the
  `_SCREEN_TITLE_BLOCKLIST` at merge time (defense in depth).
- **`_session_has_event_content`** rewritten. Now requires ONE of:
  a real draft with a concrete field, OR `status='paused'`
  (explicit Save-for-later), OR extracted has at least one CONCRETE
  event fact (date/time/location/capacity/price), OR a title (not a
  screen name) AND the composer has reached `ready_to_draft` at
  some point. A title alone is no longer enough.

### 6. Composer keyboard staying locked (Issue 6)

`startSomethingNew` now always releases `busy` in `finally` (was
possible to leak on network hiccup) and calls `clearActiveSession()`
before the fresh `eventStart` so no intermediate re-render can
resurrect the cancelled session. `carryOn` unchanged — it goes through
`sendText` which has its own release path. The welcome-back chips are
also now guarded by `isEventMode` so a false-positive resume can't
lock the UI in the first place.

### 7. Event-specific labels for general chats (Issue 7)

Header is now mode-aware:

- **Event mode** (`draft` populated OR `status='drafted'|'paused'` OR
  any past turn was `ready_to_draft`): shows *Don't save* + *Save for
  later*.
- **General chat mode** (everything else): shows *Reset* + *Close*.
  *Close* dismisses the modal while keeping the sticky session (the
  whole conversation follows George). *Reset* wipes the session
  server-side + `clearActiveSession()`.

The mode is derived by `isEventMode` in `GeorgeEventCreation.tsx`.

## Non-goals for C1 (unchanged)

- A separate "Chats with George" tab — George stays in one place.
- Notifications from George — deferred, not part of any C1 slice.
- Actions taken on the member's behalf (posting to notices, messaging
  friends, updating profile) — future capabilities, not C1.
- Voice-to-text on the mobile app — future.

## Testing status

Slice 1 ships as prompt-only changes to `services/george/event_creation/service.py`.
Manual walkthroughs by Garry against the six success-test messages will
confirm feel before Slice 2 is scoped.
