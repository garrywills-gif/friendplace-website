# George Onboarding — "Clear chat" option (Iteration 134)

## Context
Small UX refinement locked with Garry: during onboarding, members reopening George return to the previous conversation with no obvious way to restart. Added a "Clear chat" pill in the onboarding header.

Requirements (verbatim from Garry):
- Clear chat button visible during onboarding.
- Selecting it clears the onboarding conversation and starts again from George's opening greeting.
- Preserves any preferences already saved to the member profile (`users.george_profile`). Only the transient in-progress conversation is wiped.
- Do NOT change any of George's wording. The "always learning" line stays.

## What shipped

### Backend
- `services/george/onboarding/service.py`
  - New `reset_onboarding_session(db, session_id)` — marks the current session `status=cancelled` (with `cancel_reason="cleared_by_member"`), then calls `start_or_resume_onboarding` to create a fresh session with George's opening greeting. **Does not touch `users.george_profile`.**
- `services/george/onboarding/__init__.py` — exports `reset_onboarding_session`.
- `mcgs_module.py`
  - Imports `reset_onboarding_session`.
  - New endpoint: `POST /api/mcgs/george/onboarding/session/{session_id}/reset` (actor-authenticated, returns the fresh session dict).

### Frontend
- `src/lib/george-api.ts` — added `onboardingReset(sessionId)`.
- `src/components/george/GeorgeOnboarding.tsx`
  - New "Clear chat" pill in the header (teal outline, small refresh icon).
  - `Alert.alert` confirmation on iOS/Android; `window.confirm` on web with copy: *"Start over? This will clear our conversation and begin again from my opening greeting. Anything I've already saved to your profile stays."*
  - On confirm → calls `/reset`, replaces local `sessionId/turns/known/status`, clears composer input, resets auto-read pointer, stops any in-flight speech.

## What to test — backend
1. `POST /api/mcgs/george/onboarding/start` for `member_first` (Alex).
2. Send a turn or two so the session has content: `POST /api/mcgs/george/onboarding/session/{id}/turn` with a message like "I'm Alex from Kellyville, I like walking and reading."
3. `POST /api/mcgs/george/onboarding/session/{id}/reset`. Expect 200 with a new `session_id`, fresh `turns` list containing George's opening greeting, `known={}`, `status="in_progress"`.
4. Old session should be marked `status=cancelled` in `db.george_onboarding_conversations`.
5. `users.george_profile` for Alex should be **unchanged** (whatever was there before is still there).
6. Auth guard: calling `/reset` with a different actor's token → 403.
7. Non-existent session id → 404.

## What to test — frontend
1. Log in as `member_first` / `TestPass2026!`.
2. Ensure onboarding is active. If Alex is already through onboarding, rewind: set `profile_complete=false` and any onboarding sessions to `in_progress` (Mongo tips in `/app/memory/test_credentials.md`).
3. Open onboarding — a "Clear chat" pill should appear in the header, between the name and "Finish later".
4. Send at least one reply to George so the transcript grows.
5. Tap "Clear chat" — confirmation dialog appears.
6. Confirm → transcript resets, George's opening greeting reappears as the only turn.
7. Confirm the mic button, Send, "Finish later", and skip chip still work after reset.
8. Verify the visible copy is unchanged (no rewording of George's messages).

## Credentials
- Member: `member_first` / `TestPass2026!` (Alex; see `/app/memory/test_credentials.md` §Milestone B for rewind steps).
- Admin: `hello@friendplace.com.au` / `TestPass2026!` (not needed for this test).

## Files changed
- `/app/backend/services/george/onboarding/service.py`
- `/app/backend/services/george/onboarding/__init__.py`
- `/app/backend/mcgs_module.py`
- `/app/frontend/src/lib/george-api.ts`
- `/app/frontend/src/components/george/GeorgeOnboarding.tsx`

## Not tested / out of scope
- No prompt or wording changes to George — all existing onboarding tests should still pass unchanged.
- Flyer Publishing Centre — pending per Garry's next-session plan (`/app/memory/flyer-publishing-centre-plan.md`).
