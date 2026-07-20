# C1 — George as FriendPlace Companion

Locked with Garry, 21 July 2026. Ships in three slices.

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
2. **Observation, not jokes.** Reflect what the member said. No canned
   humour, no filler quips.
3. **Sticky event mode.** Once the member is planning an event, that
   context stays active. A general question mid-plan gets a two-
   sentence answer and a gentle offer to return to the event. Only
   an explicit "start over" resets it.
4. **Sensitive topics** (medical, legal, financial, emotional) get
   acknowledgement first, no diagnosis, a gentle suggestion of a
   trusted professional or support line, AND a useful FriendPlace
   next step (Coffee Lounge, friends, supportive event).
5. **Deferrals**: moderation/discipline → Help tab + FriendPlace team;
   emergencies → 000; missing information → honest "I don't have that
   in front of me"; personal decisions → George helps think it through,
   never decides for the member.
6. **Never invent facts.** "I don't have that in front of me" is a
   perfectly good answer.
7. **Never pretend an action happened** unless George truly has that
   capability. In C1 he can create events (via approval) but cannot
   post to notices, message friends on the member's behalf, update
   profile fields, etc. He must say so warmly and point the way.

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

## Slice 2 — App Navigation (planned)

**Goal**: George can deep-link the member to the right screen.

- When George is helping a member find something (Games, Coffee Lounge,
  Notices, Friends, etc.), his reply includes a structured `navigate_to`
  hint the frontend renders as a soft, tappable chip: *"Take me there"*.
- Chips only appear when the destination genuinely helps.
- No auto-navigation — the member always chooses.
- Deep-link targets read from an authoritative map maintained in
  `/app/frontend/src/lib/george-nav-map.ts` (to be created).

Architecture note: this requires adding a `navigate_to` field to the
composer JSON schema and a small frontend chip renderer. Both live
alongside the existing suggestion chips.

## Slice 3 — Text-first Voice identity (planned)

**Goal**: bake George's cadence, word choice, and voice-of-a-person
guide into the system prompt so his voice feels consistent across
Mission Control (Chief-of-Staff) and FriendPlace (Companion).

- No TTS yet. Optional playback is a later capability.
- Add a shared `GEORGE_VOICE` block to `/app/backend/services/george/prompt.py`
  that both the Chief-of-Staff and Companion prompts import.
- Style guide: warm colleague voice, first-person plural where natural,
  never "AI/model/algorithm", small observations instead of jokes,
  celebrate people not numbers, honest about limitations.

## Non-goals for C1

- A separate "Chats with George" tab — George stays in one place.
- Notifications from George — deferred, not part of any C1 slice.
- Actions taken on the member's behalf (posting to notices, messaging
  friends, updating profile) — future capabilities, not C1.
- Voice-to-text on the mobile app — future.

## Testing status

Slice 1 ships as prompt-only changes to `services/george/event_creation/service.py`.
Manual walkthroughs by Garry against the six success-test messages will
confirm feel before Slice 2 is scoped.
