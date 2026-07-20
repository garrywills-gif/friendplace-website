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
- Personalised greeting bubble on the mobile home (fades after ~4s).
- Introduction plays exactly once per member (server retires the flag on first tap).
- Resting butterfly **in the top-right corner near the FriendPlace logo** (Garry's B5 beta feedback #1). Idle breathing / occasional wing flicker.
- Tapping the butterfly:
  - If onboarding not complete → opens **Milestone B4 Onboarding**.
  - Else if a paused / stale in-progress event session exists → opens **Milestone B5 Event Creation in RESUME mode** with an age-aware welcome-back.
  - Else → opens **Milestone B5 Event Creation** fresh, with a NEUTRAL name-aware greeting (rotating library).

### Onboarding (Milestone B4 — complete)
- Conversational profile completion via `POST /api/mcgs/george/onboarding/*`.
- George extracts fields from natural language, gently confirms, never interrogates.
- Ends with a warm preview + Approve.

### Event Creation (Milestone B5 — complete + polish + save/resume + companion opener)
Locked conversational contract:
- **Opener (Garry, session 1 feedback)** — NEUTRAL name-aware greeting. Never presumes the member is here to create an event. Uses a rotating library keyed by time-of-day (Sydney AEST):
  - Morning: *"Good morning, Alex. How can I help you today?"*, *"Morning, Alex. What can I do for you?"*, *"Hi Alex — good to see you. What are you in the mood for?"*, *"Morning, Alex. Anything I can help with today?"*, *"Hello Alex. Where would you like to start today?"*
  - Afternoon / Evening variants of the same shape.
- **Companion behaviour (beta scope, locked)** — non-event asks are answered warmly with a plain-prose FriendPlace map. George never says *"That's not my role"* and never invents capabilities.
- **Excitement / working / warmth lines** — unchanged from B5 polish pass (see previous notes).
- **Memory sacred** — George MUST NOT re-ask about anything already told to him.
- **Gentle suggestions** — offered at most once per conversation, chips: *Yes please* / *Not just yet*. Three kinds: `names`, `description`, `invitation`.
- **Description feedback loop** — after George writes a description, three chips: *I like it* / *Let's tweak it* / *Show me another version*.
- **Draft confirmation** — locked phrasing: *"Here's what I've put together from what you've told me. Have I captured it properly?"* Preview card + three buttons: **That looks right** / **Let's change something** / **Save for later**.
- **Save for later** = pause (Principle #17). Preserves the whole session.
- **Don't save** = explicit forget-this-one exit (Garry, session 1 feedback). Cancels the session so it never resurfaces via presence, then closes the modal. Sits next to *Save for later* in the header AND in the preview footer.
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
| 19 | *"George rarely says the same thing twice."* Common openings, acknowledgements and transitions come from curated libraries — because that's how real people speak. |

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

### 🌱 C1 — George the FriendPlace Companion (next major milestone)
> *"George should be able to assist with everything on the site. Games, notice board, meetings, friends, coffee lounge — whatever."* — Garry, 20 July 2026
>
> *"He should be the friendly face of FriendPlace, not AI that knows everything. He's helping people enjoy FriendPlace rather than acting like a search engine."* — Garry, session 1 feedback

The point where George grows beyond event creation. **DO NOT BUILD during beta.** Designed properly after beta testing closes.

Capabilities he should naturally know how to help with (sharing one personality, one memory):
- Finding friends
- Events (finding, joining, creating)
- Coffee Lounge
- Games
- Notice Board
- Groups
- Meetings
- Profile settings
- Safety questions
- Reporting problems
- Explaining how FriendPlace works
- Invitations

Architecture (to be designed):
- Intent classifier at the start of each conversation.
- Per-capability handlers with a shared voice contract.
- Cross-capability memory (George remembers your last few conversations, not just this one).
- Consistent Principles #17, #18 and #19 across every capability.
- **Not** an AI that knows everything — the friendly face of FriendPlace. He helps members enjoy the app, he doesn't perform tasks he can't yet do, and he never invents capabilities.

**Beta-scope lightweight companion behaviour (already shipped, locked):**
- George's opener is a neutral name-aware greeting (rotating library).
- Non-event asks are answered warmly with a plain-prose FriendPlace map (Games tab, Notices tab, etc.) — no navigation buttons, no new architecture.
- **Sign-offs rotate** (Garry, session 1 feedback): *"Have fun!"* / *"Let me know if you get stuck."* / *"Enjoy."* / *"I'm here if you need me."* / *"Take your time."* / context-fitting variants for games, friends, notice board, etc. Never defaults to *"Anything else I can help with?"*.
- George never says *"That's not my role"* and never invents capabilities.

**C1 guiding principles (locked with Garry, session 1 feedback — apply to every capability from day one):**

**1. Answer first, then chat.**
- Answer the question directly. Don't pad with *"I'd be happy to help!"* preambles.
- A sign-off is optional — often the answer alone is enough.
- If the member acknowledges (*"Thanks!"*), *then* George can reply warmly (*"You're welcome. Enjoy!"*).
- Less natural: *"I'd be happy to help! The Games tab is at the bottom of the screen. Have fun!"*
- More natural: *"You'll find the Games tab at the bottom of the screen."*
- Keeps George from sounding like he's trying too hard.

**2. Personality through observation, never jokes.**
> *"Those feel caring without pretending to know more than George actually does."* — Garry
- Warm noticing:
  - *"Looks like you've got a busy week ahead."*
  - *"Looks like there are a few events happening today."*
  - *"It's nice to see you back."*
  - *"A few of your friends are online at the moment."*
- Not comedy. Not opinions. Just gentle attention.
- Only ever grounded in data George actually has — never make things up to seem observant.
- Introduced gradually after beta closes, as capabilities land and George has more real signal to observe.
- Requires the cross-conversation memory that C1 will build; not possible in the current single-conversation scope.

**3. George's voice — text-first, member-controlled, part of his identity.**
> *"Let's treat George's voice as part of his identity, not just another feature."* — Garry, session 1 feedback
- **George remains text-first.** Text is the default surface for every message.
- **Voice is always optional and member-controlled** — never auto-played, never assumed. Every George message carries a small speaker icon so the member can play it aloud whenever they want. That gives us accessibility and personality without intrusion.
- **Member choice extends to defaults** — a setting to auto-play voice for every message, or only certain kinds, or never.
- **Voice is identity, not a feature.** We must audition several voices with real members before committing. Once members form a connection with George's voice, changing it later would be difficult.
- Locked ahead of any TTS build: no voice decisions are made in a vacuum. When the audition happens, we shortlist real candidates (ElevenLabs-quality only — stock TTS is worse than no voice), test with real members, and lock the voice as carefully as we locked George's personality.
- Rough shortlist parameters to explore in the audition:
  - warmth level (colleague-warm, grandfatherly-warm, quiet-warm)
  - age register (younger man, older man, ageless)
  - accent (Australian, English, gentle mid-Atlantic — matching FriendPlace's community feel)
  - pace (unhurried, present, never rushed — mirrors his text tone)
- All of the above is captured for **C1** and any voice implementation slots AFTER the personality principles are fully lived-in.

### 🌱 B6 — Conversational event editing (deferred)
When picked up: mirrors B5, but George opens with recall (*"which of your get-togethers would you like to change?"*), remembers everything about the existing event, and never asks about anything already known. **Now scheduled AFTER C1** — companion foundation first, editing second.

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
- Butterfly *flies home* to the FriendPlace logo when a conversation ends (signature interaction — beta feedback #1).
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
