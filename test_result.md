# Milestone B5 — Polish Pass (July 2026)

## What this iteration adds on top of B5 baseline
Locked with Garry after the initial B5 delivery. Polish focused on making the conversation feel less like the workflow reached Step 7 and more like a colleague thinking alongside the member.

### Wording refinements
- **Working line rotated** — no more *"Let me note down what you've told me."* George now uses a natural rotation:
  - *"Here's what I've understood so far."*
  - *"So far, this is what I'm picturing."*
  - *"Let me make sure I've captured your idea properly."*
  - *"I'm just piecing it together in my head."*
  - *"Just picturing how this could come together."*
  Never the same twice in one conversation. Composer prompt rewritten to enforce.

### New: warmth_line (quiet encouragement)
- George now has a dedicated warmth line ALONGSIDE excitement/working. Only landed when EARNED (max once per 3 turns, never on opener). Benchmark phrasing:
  - *"I think people are really going to enjoy this."*
  - *"This sounds like a wonderful way to bring people together."*
  - *"I'm looking forward to seeing this on FriendPlace."*
  - *"Whoever comes along is lucky to be part of this."*
- Rendered in teal italic BELOW the working line and ABOVE the main message.

### Memory reinforced
- Composer prompt now enforces MEMORY IS SACRED — George MUST NOT re-ask about anything already in `EXTRACTED`, even at low confidence. Re-asking is described as "the single fastest way to lose trust." Includes explicit rule: if `EXTRACTED.time = "14:00"`, NEVER ask "what time…" — either accept it or gently confirm in passing.

### Gentle suggestions (offered at most once per conversation)
- New `suggestion` object on George turns with `kind: names | description | invitation` + `offer_line`.
- Frontend renders a chip pair below the offer: **Yes please** / **Not just yet**.
- Rules enforced by the composer AND the session state:
  - Never on opener.
  - Never twice in one conversation.
  - Only when the moment genuinely calls for it.
- Session persists `suggestion_offered` + `pending_suggestion` so the composer always knows.
- **Accept flow**:
  - `names` → George proposes 2–3 warm names inline; member picks (or asks for another set).
  - `description` → George writes ONE description into `draft.description`, message includes "How does that sound?" and a `description_written: true` flag. Frontend shows three feedback buttons.
  - `invitation` → George warms up the whole description/title.

### Description feedback (three-button loop)
- After George writes/refines a description, the frontend shows three chips: **I like it** / **Let's tweak it** / **Show me another version**.
- Backing sends the appropriate turn text; George reacts naturally.

### Staged reveal on mobile (natural typing rhythm)
- New in `GeorgeEventCreation.tsx`: when a George turn arrives from the API, the UI shows a typing-dots bubble for ~480ms, then reveals the George bubble with a staggered fade-in per line: excitement (220ms) → 320ms pause → working (220ms) → 320ms pause → warmth (220ms) → 320ms pause → main message (260ms). Perceived rhythm mimics a colleague pausing between thoughts.
- User-turn bubbles are optimistic (no staged reveal) so the composer feels responsive.

### Files changed
- `/app/backend/services/george/event_creation/service.py` — composer prompt rewritten, `_compose_next` accepts suggestion state, `_clean_suggestion` gate, session persists new fields.
- `/app/frontend/src/lib/george-api.ts` — new types (`EventSuggestion`, `warmth_line`, `description_written`, session suggestion state).
- `/app/frontend/src/components/george/GeorgeEventCreation.tsx` — rebuilt with staged reveal, GeorgeBubble (Animated) component, TypingDots component, suggestion chips, description-feedback buttons.

## Test credentials (unchanged)
- Mobile member: `member@friendplace.com.au` / `TestPass2026!` (Alex). `profile_complete: true` — tap the butterfly to open B5.
- CMS admin: `hello@friendplace.com.au` / `TestPass2026!`
- Frontend: `http://localhost:3000`  •  Backend: `http://localhost:8001`

## What to test

### P0 — Composer output correctness
1. Empty-text `POST /api/mcgs/george/event/start` returns opener with `excitement_line: "I'd love to help with that."` and `message` starting with *"Tell me about the kind of get-together…"*. NO `warmth_line` or `suggestion` on the opener.
2. First user turn describing an event (with a rich detail and a "first-time" cue) should produce a George reply with all three lines: `excitement_line`, `working_line` (rotated — NOT "Let me note down what you've told me"), `warmth_line` (earned), and one warm question.
3. If the member says they don't have a name in mind → George MUST emit `suggestion: { kind: "names", ... }` with `pending_suggestion` mirrored on the session, and `suggestion_offered: true`.
4. On accept ("Yes please, suggest a few names") → George MUST propose 2–3 names inline in `message`, `suggestion` MUST be `null`, `suggestion_offered: true` still.
5. Suggestion can only fire ONCE per conversation — subsequent turns should have `suggestion: null`.
6. If a member mentions time/date/location/audience upfront, George MUST NOT ask about them later.

### P0 — Mobile UI (Playwright at http://localhost:3000)
7. Log in as Alex, tap butterfly. Verify typing-dots bubble briefly (~500ms), then George's opener appears with the excitement + main-message split.
8. Send the rich idea from step 2. Verify the bubble shows: bold teal excitement → italic grey working → italic teal warmth → main message. All four lines present, distinct typography.
9. Send "I don't have a name in mind." → George offers a `names` suggestion. Chip row appears below the bubble: **Yes please** (teal solid) / **Not just yet** (white bordered).
10. Tap **Yes please** → George proposes 2–3 names inline. Chip row disappears (no re-offer).
11. Send "I like [name], let's go with that." → George pushes to `drafted` status, preview card appears with title, buttons **That looks right / Let's change something / Save for later**.
12. Fresh conversation: send "I want to organise a picnic at the park on Sunday at 3pm. Room for 20." Then next turn: George should NOT ask about time or location again.
13. Fresh conversation, accept a description offer → George writes ONE description in `draft.description`. The three feedback chips appear: **I like it** / **Let's tweak it** / **Show me another version**.

### P0 — Regressions to guard against
14. Milestone B4 (onboarding) still works when `profile_complete=false`.
15. Approve → `submitted_for_review` for members without `publish_events` — celebration screen unchanged.
16. Save for later still cancels the session cleanly.

## Testing notes
- Sonnet turns still take 4–10 seconds; add buffer to Playwright waits.
- Composer output is JSON — parse defensively.
- Warmth line is NOT guaranteed every turn (by design). It's earned. Don't require its presence for a green test.
- `description_written` shows up on suggestion-accept turns for kinds `description` or `invitation`.
