# Beta Baseline — George B5 (20 July 2026)

**Status:** ❄️ FROZEN for member walkthroughs. No new capabilities to be added until Garry has completed persona testing and shared observations.

> *"The next phase is not more development. It's experiencing George properly and learning from how he feels in real use."* — Garry, 20 July 2026

---

## What "frozen" means

- **Do not** add B6 (conversational event editing).
- **Do not** start B7 (George Remembers — day-before/day-after check-ins).
- **Do not** refactor George's tone, prompts, colours, animations, or endpoints while testing is underway.
- **Do** fix any bug Garry reports during testing that genuinely breaks a persona flow (regressions only).
- **Do** capture Garry's observations verbatim into `/app/memory/beta-testing-notes.md`.

---

## What George can do today (locked)

### Presence & arrival
- Personalised morning/afternoon/evening greeting bubble on the mobile home (fades after ~4s).
- Introduction plays exactly once per member (server retires the flag on first tap).
- Resting butterfly with idle breathing / occasional wing flicker.
- Tapping the butterfly:
  - If onboarding not complete → opens **Milestone B4 Onboarding**.
  - Else if a paused / stale in-progress event session exists → opens **Milestone B5 Event Creation in RESUME mode** with an age-aware welcome-back.
  - Else → opens **Milestone B5 Event Creation** fresh.

### Onboarding (Milestone B4 — complete)
- Conversational profile completion via `POST /api/mcgs/george/onboarding/*`.
- George extracts fields from natural language, gently confirms, never interrogates.
- Ends with a warm preview + Approve.

### Event Creation (Milestone B5 — complete + polish + save/resume)
Locked conversational contract:
- **Opener (Principle #18)** — never a field question. Rotates by vibe: neutral / unsure / nervous.
- **Excitement line** — bold teal, on genuine warmth moments.
- **Working line** — rotated italic slate: *"Here's what I've understood so far."*, *"So far, this is what I'm picturing."*, *"Let me make sure I've captured your idea properly."*, *"I'm just piecing it together in my head."*, *"Just picturing how this could come together."* Never the same twice per conversation.
- **Warmth line** — earned quiet encouragement, italic teal: *"I think people are really going to enjoy this."*, *"This sounds like a wonderful way to bring people together."*, *"I'm looking forward to seeing this on FriendPlace."*, *"Whoever comes along is lucky to be part of this."* Max ~once per 3 turns, never on opener.
- **Memory sacred** — George MUST NOT re-ask about anything already told to him.
- **Gentle suggestions** — offered at most once per conversation, chips: *Yes please* / *Not just yet*. Three kinds: `names`, `description`, `invitation`.
- **Description feedback loop** — after George writes a description, three chips: *I like it* / *Let's tweak it* / *Show me another version*.
- **Draft confirmation** — locked phrasing: *"Here's what I've put together from what you've told me. Have I captured it properly?"* Preview card + three buttons: **That looks right** / **Let's change something** / **Save for later**.
- **Save for later** = pause (Principle #17). Preserves the whole session.
- **Resume** = age-aware welcome-back turn + chips: *Yes, let's carry on* / *Start something new*.
  - Fresh pause → *"Welcome back, Alex. We were putting together your ..."*
  - Stale (>14 days) → *"It's been a little while since we were ..."*
  - No-title-yet → *"We were in the middle of planning a get-together."*
  - Seamless resume for <10 min stale in-progress sessions (no welcome-back turn).
- **Idempotent resume** — hitting it twice doesn't stack welcome-back turns.
- **Approve routing** — permission-aware: `publish_events` → live; otherwise → `events_pending_approval`.
- **Celebration screen** after approval — permission-aware phrasing.

### Locked design principles
| # | Principle |
| - | - |
| 17 | *"A conversation with George never truly ends. It simply pauses until the member chooses to continue."* |
| 18 | *"George earns trust before collecting information. George listens first. George remembers. George gently confirms. George never interrogates. George never rushes."* |

### Locked visual language
- **Green bubble = George** (`#CCFBF1` fill / `#5EEAD4` border / `#0F172A` text). Applied across intro, onboarding, event creation, resume, CMS, greeting.
- **Neutral bubble = member** (`#FFFFFF` / `#E2E8F0` / `#0F172A`, weight 500).
- **Action Preview card** = distinct pale teal (`#F0FDFA`) — visually different from normal chat.
- **Typing dots** = deep teal (`#0F766E`).
- **Excitement line** = bold teal (`#0F766E`).
- **Working line** = italic slate (`#475569`).
- **Warmth line** = italic teal (`#0F766E`).

---

## API surface (frozen)
| Method | Path | Purpose |
| - | - | - |
| GET  | `/api/mcgs/george/presence`                             | Router state + paused session |
| POST | `/api/mcgs/george/introduced`                           | Retire first-meeting flag |
| POST | `/api/mcgs/george/onboarding/start`                     | Onboarding start/resume |
| POST | `/api/mcgs/george/onboarding/session/{sid}/turn`        | Onboarding turn |
| POST | `/api/mcgs/george/onboarding/session/{sid}/approve`     | Approve profile |
| POST | `/api/mcgs/george/onboarding/session/{sid}/finish-later`| Finish onboarding later |
| POST | `/api/mcgs/george/event/start`                          | Start event conversation (empty text = warm opener) |
| POST | `/api/mcgs/george/event/session/{sid}/turn`             | Event turn |
| GET  | `/api/mcgs/george/event/session/{sid}`                  | Fetch session |
| POST | `/api/mcgs/george/event/session/{sid}/approve`          | Approve event |
| POST | `/api/mcgs/george/event/session/{sid}/pause`            | Save for later |
| POST | `/api/mcgs/george/event/session/{sid}/resume`           | Resume with welcome-back |
| POST | `/api/mcgs/george/event/session/{sid}/cancel`           | Explicit cancel (used by *Start something new*) |

---

## Roadmap deferred (do NOT build during beta)

### 🌱 B6 — Conversational event editing (deferred)
> *"A member says: 'I'd like to change my event.' George helps them update it as another natural continuation."*
When we pick this up: the shape mirrors B5, but George opens with recall (*"which of your get-togethers would you like to change?"*), remembers everything about the existing event, and never asks about anything already known.

### 🌱 B7 — George Remembers (deferred, but captured)
> *"George's relationship shouldn't end when the event is published."*
Shape:
- **Day-before check-in** (tied to the event George helped create):
  > *"Hi Alex. Your lawn bowls afternoon is tomorrow. I just wanted to wish you all the best. I hope everyone has a great time."*
- **Day-after follow-up**:
  > *"Hi Alex. I've been wondering how your lawn bowls afternoon went. I'd love to hear about it."*
- Emphasis: connected to the **actual event** George helped create — never a generic notification.
- Over time, George gradually remembers meaningful preferences ("You usually run these at 10am — same again?").

### 🌱 Other backlog (unchanged)
- Apple Sign-In for the new Bundle ID.
- Dedicated "Chats" tab in the mobile app.
- Refactor `/app/backend/server.py` (~10k lines).
- MCGS Phase 4 (Health Pulse UI) and Phase 5 (Alerts + SMS).

---

## Personas to walk through
1. **A first-time organiser** — has an idea but has never done this before.
2. **Only a vague idea** — *"I'm thinking about organising something."*
3. **Nearly every detail at once** — full one-shot description.
4. **Changes their mind halfway** — swaps date, title, capacity mid-conversation.
5. **Declines George's suggestion** — says *"Not just yet"* to a name/description/invitation offer.
6. **Saves for later and returns** — pause, come back, welcome-back chips, carry on OR start something new.

Notes template: `/app/memory/beta-testing-notes.md`.
