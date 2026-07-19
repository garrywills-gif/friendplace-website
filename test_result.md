# MCGS Phase 3 · Milestone A (final) — Shared George Platform + Butterfly Arrival + First Introduction

## 🧭 North Star reminder
FriendPlace mobile is the destination. Mission Control is the development surface. Every George experience is designed for members opening their phones; Mission Control consumes the same shared engine.

## What this iteration adds on top of iteration_71
- **P0 bug fix**: `/api/mcgs/george/presence` now resolves the admin's first name via `display_name` (was returning empty → greeting showed no name).
- **P0 bug fix**: The butterfly is now tappable in both `landed` and `resting` phases (previously the greeting bubble blocked taps).
- **NEW — First-time introduction**: Server-side flag `cms_admins.george_first_met_at`. When absent, the presence endpoint returns `first_meeting: true` and the butterfly renders the full introduction script (locked with Garry, 19 July 2026):
  > *"Hi, I'm George. Welcome to FriendPlace. It's lovely to meet you.*
  >
  > *I'm here to help you get the most out of FriendPlace. I can help you find people, discover groups and events, organise your own activities, play games together, answer questions, or if you'd simply like someone to chat with… I'm here for that too.*
  >
  > *Whenever you need me, just tap the butterfly.*
  >
  > *Why don't we start by getting to know each other?"*
  Three warm choices: **Yes, show me around** (opens the floating chat), **Let's just have a chat first** (opens the floating chat), **Maybe later** (dismisses).
  The introduction does NOT auto-fade. Any acknowledgement calls `POST /api/mcgs/george/introduced`, which sets `george_first_met_at` on the admin document; the introduction is retired forever after that.
- Docs updated with an explicit North Star section at the top of both `mcgs-architecture.md` and `george-platform.md`.

## Test credentials
- CMS admin: `hello@friendplace.com.au` / `TestPass2026!`
- Website: `http://localhost:3001` (mapped to `/` via nginx)
- Backend: `http://localhost:8001` (mapped to `/api` via nginx)
- The admin's `george_first_met_at` has been unset for testing — first login will trigger the introduction. To reset again mid-test: `db.cms_admins.updateMany({}, { $unset: { george_first_met_at: "" } })`.

## What to test

### P0 — First introduction (highest priority)
1. Sign in fresh. Within ~4-5s of landing on `/admin/bridge`, the butterfly should arrive and bloom the **introduction bubble** (not the rotating greeting). Verify all four paragraphs render (whitespace preserved) including *"play games together"*.
2. Verify three buttons: `Yes, show me around` (primary teal), `Let's just have a chat first` (secondary), `Maybe later` (tertiary underline link).
3. Verify the introduction **does not auto-fade** (wait 10+ seconds — bubble should still be there).
4. Clicking `Yes, show me around` opens the floating chat sheet (bottom-right).
5. Sign out, sign in again (or refresh) — the introduction should **NOT** re-appear. Instead, the returning-user greeting should show (rotating warm phrase including the name "Garry", e.g. *"Morning, Garry. Nice to see you..."*).

### P0 — Name resolution
6. On the returning-user greeting (after step 5), the admin's first name **"Garry"** should appear in the bubble text.
7. `GET /api/mcgs/george/presence` (bearer admin token) returns `name: "Garry"` and `first_meeting: false` after introduction.

### P0 — Tap during landed phase
8. On a returning session (where the greeting bubble auto-fades in 6.5s), tap the butterfly while the bubble is still visible (during the ~6.5s window). The bubble should dismiss and the floating chat sheet should open. Previously this was blocked.

### P1 — Full conversation engine
9. Navigate to `/admin/george/new-event`. Send *"I'd like to run a Christmas Bowls evening on Saturday 5 December at 10am at the Community Hall. About 24 people. Open to everyone."*. Within 60s the Action Preview renders with a warm celebration line (rule 3). `✓ Confirm & Create` produces a success screen headed **"Your event is live."** (admin has `publish_events`), including the event title and 3 buttons.
10. Rule 5 test: on a fresh session, after the draft appears, send *"Actually, let's call it 'Twilight Bowls' instead, and move it to 6pm."* — draft updates warmly, no errors.

### P1 — Backend endpoints
11. `GET /api/mcgs/george/presence` returns 200 with `{ actor_id, name, unfinished, last_completed, first_meeting }` — types correct.
12. `POST /api/mcgs/george/introduced` returns `{ ok: true, george_first_met_at }` and is idempotent.
13. `GET /api/mcgs/events/pending-approval` returns 200 with `{ items: [], count: 0 }` at rest.

### P2 — Ambient behaviour
14. Butterfly rests at bottom-right on all authenticated admin routes (Bridge, Workspace, New Event, Events, Media, etc.) and does NOT re-arrive on same-day route changes.
15. Sidebar navigation works: George's Workspace, Bridge, Dashboard, etc.

## Notes for the tester
- Sonnet + Haiku round-trips: 5–20s. Allow up to 60s per George reply.
- Butterfly aria-label: `"Talk to George — tap to open"`.
- Confirm & Create button aria-label: `"Confirm and create the event"`.
- If the introduction doesn't fire, verify with `db.cms_admins.find({email: "hello@friendplace.com.au"}, {george_first_met_at: 1})` — the field should not exist. If it does, unset it and retest.
- The pre-existing `🎙️` mic in the top `AskGeorgeBar` also has aria-label `"Talk to George"` (without the "— tap to open" suffix) — do not confuse the two.
- We are NOT testing member/organisation flows this iteration; those come with mobile and member web login.

## Files of reference (recent changes)
Backend:
- `/app/backend/mcgs_module.py` — presence endpoint name fix, `first_meeting` field, `/mcgs/george/introduced` endpoint
- `/app/backend/services/george/event_creation/service.py` — approve rewired, presence helper, 5 tone rules
- `/app/backend/services/george/permissions.py` — new

Frontend:
- `/app/website/components/george/GeorgeButterfly.tsx` — introduction flow + tap-during-landed
- `/app/website/components/george/GeorgeConversation.tsx` — shared engine
- `/app/website/components/george/GeorgeFloatingChat.tsx`
- `/app/website/components/george/GeorgeButterflyMark.tsx`
- `/app/website/components/george/GeorgeSuggestionCard.tsx`
- `/app/website/components/admin/AdminShell.tsx` — mounts the butterfly

Docs:
- `/app/memory/mcgs-architecture.md` — North Star at top, principles #13–#15
- `/app/memory/george-platform.md` — North Star at top, surfaces table now flags mobile as PRIMARY DESTINATION
