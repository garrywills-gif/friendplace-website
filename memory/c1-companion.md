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
