# B5 — "Save for later" resume flow (Option A)

## Change since last iteration
- **"Save for later" no longer deletes.** It sets `status = paused` and preserves the whole session (draft, extracted, defaults, conversation history). The old behaviour was to cancel — the change is intentional and locked with Garry.
- **Butterfly router extended** — on tap, the presence call now returns any OPEN event session (paused OR in_progress), and the butterfly modal opens that session in resume mode. Only truly `cancelled` / `drafted` / `approved` sessions are treated as over.
- **Age-aware welcome-back**: George now appends a warm, continuity-aware turn when a paused/stale session is resumed:
  - Fresh paused session → *"Welcome back, Alex. We were putting together your Coffee & Company. Would you like to carry on from where we left off?"*
  - Stale (>14 days) → *"Welcome back, Alex. It's been a little while since we were putting together your Coffee & Company. Would you like to carry on from where we left off, or would you prefer to start something new?"*
  - No-title-yet → *"Welcome back, Alex. We were in the middle of planning a get-together. Would you like to carry on from where we left off?"*
- **Seamless resume for short absences**: if the session was `in_progress` and last touched <10 minutes ago, no welcome-back is appended — the modal just re-opens on the same conversation (feels identical to never having left).
- **Idempotent**: calling resume twice does NOT re-append a welcome-back if the last turn already is one.
- Two new chips render below the welcome-back turn: **Yes, let's carry on** (teal solid) / **Start something new** (secondary). *Start something new* cancels the paused session and boots a fresh conversation with George's opener.

## New / changed endpoints
- `POST /api/mcgs/george/event/session/{sid}/pause` — new. Marks session as `paused` with `paused_at`.
- `POST /api/mcgs/george/event/session/{sid}/resume` — new. Sets status back to `in_progress` and returns the full session (with a welcome-back turn appended when appropriate).
- `GET /api/mcgs/george/presence` — extended. Adds `paused_event_session: { session_id, status, title, paused_at, updated_at } | null` covering both paused AND stale in-progress sessions.

## Files touched
- `/app/backend/services/george/event_creation/service.py` — new `pause_event_session`, `resume_event_session`, `latest_paused_event_session`, `_welcome_back_line`.
- `/app/backend/services/george/event_creation/__init__.py` — exports updated.
- `/app/backend/mcgs_module.py` — new routes + presence extension.
- `/app/frontend/src/lib/george-api.ts` — new `EventTurn.welcome_back`, `Presence.paused_event_session`, `PausedEventSession` type, `eventPause` + `eventResume` methods.
- `/app/frontend/src/components/george/GeorgeEventCreation.tsx` — accepts `resumeSessionId` prop; "Save for later" now calls `eventPause`; renders welcome-back chip pair; **Start something new** cancels + fresh-starts inline.
- `/app/frontend/src/components/george/GeorgeButterfly.tsx` — reads `paused_event_session` from presence, opens event modal with `resumeSessionId`.

## What to test

### P0 — Backend
1. `POST /pause` on an in-progress session → status becomes `paused`, `paused_at` set, all other data preserved.
2. `GET /presence` after pause → returns `paused_event_session` with `status: "paused"` and the session's title (if drafted) or null.
3. `POST /resume` on a paused session → status becomes `in_progress`, a new George turn is appended with `welcome_back: true` and content beginning with "Welcome back, Alex. We were putting together your ...".
4. `POST /resume` on the SAME session again → status stays `in_progress`, NO extra welcome-back turn appended (idempotent).
5. Simulate a stale session (mongo update `paused_at` to 20 days ago) → resume message contains "It's been a little while" AND offers the two paths verbatim.
6. `POST /resume` on an in-progress session with `updated_at` <10 min ago → no welcome-back appended (seamless).
7. `POST /resume` on a session without a landed title → welcome-back says "We were in the middle of planning a get-together." (no double "putting together").
8. Only the session's own actor can pause/resume — a different bearer returns 403.

### P0 — Mobile UI
9. Sign in as Alex, tap butterfly, chat, tap **Save for later** → modal closes, back on home.
10. Tap butterfly again → modal opens with the FULL conversation history intact + a new George welcome-back bubble. Chips: **Yes, let's carry on** / **Start something new**.
11. Tap **Yes, let's carry on** → George continues normally (short natural continuation). Chips disappear.
12. Fresh setup, get to welcome-back, tap **Start something new** → the paused session is cancelled, the modal REBOOTS with just George's fresh opener; conversation history is gone.
13. Chat until drafted, tap the button-form "Save for later" (below the preview card) → same pause behaviour, next tap resumes with the same continuity.

## Test credentials
Unchanged — Alex is `profile_complete: true` and has NO paused sessions right now (cleaned).

## Recent regressions to guard against
- Milestone B4 onboarding unchanged.
- Milestone B5 baseline: opener, warmth line, memory sacred, suggestions once per conversation — all still hold.
- Approving from a resumed session still routes correctly (`submitted_for_review` for members without `publish_events`).

## Notes for the tester
- The old `eventCancel` endpoint still exists and is still used by "Start something new" (which explicitly cancels the paused session before booting fresh).
- The resume flow is triggered by presence — if `paused_event_session` is null, the butterfly opens fresh. Presence is refreshed on every tap.
- Sonnet turns take 4–10s — allow buffers in Playwright.
