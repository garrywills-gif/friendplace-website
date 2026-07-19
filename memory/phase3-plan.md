# MCGS Phase 3 — Conversational Event Creation

**Baseline:** Phase 2 v1.1 (see `/app/memory/phase2-baseline-v1.1.md`)
**Approved by Garry:** 19 July 2026 ("Let's build that first.")
**Guiding principles this phase must protect (from `/app/memory/mcgs-architecture.md`):**
- #1 — George is central, not an add-on.
- #7 — George feels present.
- #8 — Build a relationship, not just answer questions.
- #9 — Reduce the effort required to bring people together.
- #10 — Never make people feel like they're filling out a form.
- #11 — George may infer, but never assume.

## Goal

Replace the create-event form with a natural conversation. Members, organisations, and administrators all describe an event to George in their own words; George extracts what's said, infers the rest from grounded sources, asks only what's genuinely missing, and produces a complete draft as an Action Preview. Only after human approval does anything get written.

## Universal experience — one conversation, three routes on approve

| Role | On approve → | Notes |
|---|---|---|
| Member | `cms_event_submissions` (status=pending) | Same review queue as the form today |
| Organisation | Org approval workflow | Verified orgs bypass in Phase 8 |
| Administrator | `cms_events` (status=published) | Immediate publish if permissioned |

## Architecture

- **Extraction stack**: Haiku for structured field extraction; Sonnet for conversation, clarification, and warm draft polish.
- **New collection** `george_event_conversations` — full turn history + current extracted state + defaults applied + missing fields + status.
- **New backend package** `services/george/event_creation/`:
    - `extractor.py` — Haiku-driven schema extraction with confidence per field.
    - `defaults.py` — grounded default inference from the approved sources (see below).
    - `composer.py` — Sonnet-driven conversation: next warm question OR final draft as an Action Preview.
    - `router.py` — post-approval routing by role.
- **New API surface** `/api/mcgs/george/event/*`:
    - `POST /start` — begin, returns session_id + first message (question OR draft)
    - `POST /turn` — send user reply, get next message
    - `GET /session/{id}` — fetch state
    - `POST /session/{id}/approve` — approve draft → route by role
    - `POST /session/{id}/cancel` — abandon

## Grounded default sources (locked with Garry, 19 July 2026)

Every inferred value must trace to one of:
- Organiser's previous events (title patterns, typical times, capacity, price, duration)
- Organisation's profile + preferred writing style
- Previously used venues + full venue history at each space
- Previous attendance numbers, durations, times, pricing
- Seasonal patterns
- Day-of-week patterns
- Public holidays where relevant
- Administrator's previous edits and approvals (continuous-improvement feedback loop)

**The rule**: George may *infer*, but never *assume*. If confidence is low, George asks — one warm question at a time.

## Milestones

**A — Admin CMS end-to-end (this session's focus)**
- Backend: extractor + defaults + composer + `/api/mcgs/george/event/*` endpoints
- Frontend: new "New event via George" surface in the admin CMS
- Approve path: on approve, create `cms_events` (status=published) for the admin
- Cancel path: session marked cancelled, nothing written
- Prompt-injection defence: user text is data, never instructions
- Success criteria: an admin can say *"George, create a coffee morning next Tuesday at 10am at the community hall"* and end up with a published event, with George having asked at most one or two warm follow-up questions

**B — Progressive missing-field conversation loop**
- Composer refines its follow-up logic: never asks two questions at once
- "Explain why I'm asking" mode for less obvious fields
- Progress hint (subtle, no checklist)
- Handles corrections mid-conversation ("actually make that 11am")

**C — Member-facing in the mobile app**
- "Talk to George" entry from Events area + persistent mic/chat button on Home
- Voice-first (uses existing Whisper STT + TTS pipeline)
- Approve path routes to `cms_event_submissions` (status=pending)

**D — Organisation flow + role-aware routing**
- Org profile writing-style learning
- Org approval workflow integration
- Role-aware permissions on approve

**E — Suggestions + full prompt-injection regression**
- George suggests improvements where helpful ("that lounge fits about twenty — is that the size you meant?")
- Prompt-injection classifier + behavioural refusal — target 12/12 + 12/12 (matching Phase 1/2)
- Learning-from-edits: on every admin edit of a George draft, record the correction for future confidence

## Non-goals for Phase 3

- No recurring-event UI (single events only in this phase).
- No cover-image generation (Phase 4 territory).
- No public event promotion / distribution beyond existing pipelines.
- No changes to the review-queue UI (the existing surface handles member submissions fine).

## Success criteria for Phase 3

1. An admin creates a real event in the CMS by talking to George — no form.
2. Every inferred value shows its source in the Action Preview.
3. Prompt-injection regression passes 12/12 + 12/12.
4. Members on mobile can do the same via voice; their draft lands in the review queue.
5. Organisations follow their approval workflow with zero UI regressions.
6. The conversation never feels like a form (subjective test — Garry sign-off after Milestone A).
