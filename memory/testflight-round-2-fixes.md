# TestFlight Feedback Round 2 — Fixes Applied

**Build:** 1.0.9 / 116
**Date:** 28 July 2026
**Reporter:** Garry (TestFlight physical device testing)

## 🔴 P0 — Regressions from Round 1

### 1. George chat closes after final event confirmation ✅
- **Root cause:** After approval we spawned a fresh session synchronously and set `sessionId` to the new one. When the user next sent a message, its response (containing only the fresh opener + reply) REPLACED local `turns` state, wiping the pre-approval history + inline celebration.
- **Fix:**
  - Snapshot the pre-approval conversation into `preApprovalHistoryRef` right before the celebration turns are appended, so it survives across the fresh-session boundary.
  - Removed the synchronous `eventStart` from `approve()` and moved it to a **lazy spawn inside `sendText`** — first post-approval message spawns a fresh session using that text as the seed (no redundant opener duplicates the follow-up).
  - `revealApiTurns` now ALWAYS prepends `preApprovalHistoryRef.current` when rebuilding local turns, so the scrollback stays whole no matter which session we're on.
  - Added a `turnsRef` mirroring `turns` state so `approve()` can capture the current transcript synchronously without a `setTurns(prev)` closure hack.
- **Files:** `frontend/src/components/george/GeorgeEventCreation.tsx`.

### 2. George cannot edit events (B6 flow still not entering) ✅
- **Fix:**
  - Added a strict "EDITING EXISTING EVENTS" section to George's prompt that explicitly forbids the "best done from the Events tab" bail-out response (which was the observed hallucination).
  - Added detailed classifier logging (`event_edit_intent classification ...`) so every future edit-intent decision is inspectable in backend logs.
  - Round 1's `_has_edit_signal` safety net stays in place.
- **Files:** `backend/services/george/event_creation/service.py`, `backend/services/george/event_edit_flow.py`.

## 🟡 P1 — Functionality & Polish

### 3. "Take me to FriendPlace" button off-screen ✅
- Bumped onboarding footer `paddingBottom` to `Math.max(insets.bottom + 12, 24)` so the CTA always clears the home indicator + rounded corner. **Files:** `frontend/app/onboarding.tsx`.

### 4. George re-reads last message on reopen ✅
- Auto-read cursor is now persisted **per session_id** in AsyncStorage (`@george.autoread.cursor.v1`). On boot we load the persisted count into `lastAutoReadCountRef`, and each auto-read persists the new count. Reopens see `turns.length <= cursor` → skip. Members must tap Speaker to replay.
- **Files:** `frontend/src/components/george/GeorgeEventCreation.tsx`.

### 5. Jigsaw "Surprise Me" title/image mismatch ✅
- **Root cause:** The `_GENERATED` "endless library" in `jigsaw_data.py` labelled random Picsum seeds under specific categories (e.g. "Classic Cars #6" = a wheat field).
- **Fix:** Retired `_GENERATED` entirely. Catalog now uses `_CURATED` Unsplash photos only — every title/category truly matches its image. **File:** `backend/jigsaw_data.py`.

### 6. George's FP Café wording ✅
- New "IMPORTANT COPY RULE" locks: **never** say "Lounge tab" / "under Lounge". Correct phrasings are enumerated. **File:** `backend/services/george/event_creation/service.py`.

### 7. Static butterfly on member profile pages ✅
- The floating George butterfly overlay showed on `/user/[id]` because those pages alias to the `friends` screen key. Now suppressed via a `/^\/user(\/|$)/` pathname check in `GeorgeButterfly.tsx`. **Files:** `frontend/src/components/george/GeorgeButterfly.tsx`.

### 8–11. STT in DMs, Groups, FP Café, and Recipes ✅
- **Root cause:** `VoiceInputButton` used `(process.env as any).EXPO_PUBLIC_BACKEND_URL` which prevented Metro from statically inlining the value on native builds, so physical devices POSTed to a relative `/api/voice/transcribe` (rejected by native `fetch` as "Invalid URL"). Simply removing the `as any` cast lets Babel inline the value.
- **New surfaces:** Added `VoiceInputButton` to Community Groups composer (`app/group/[id].tsx`) and Recipe comment composer (`app/recipes/[id].tsx`). Speaker read-aloud already lives in the recipe header via `SpeakButton`.
- **Files:** `frontend/src/components/VoiceInputButton.tsx`, `frontend/app/group/[id].tsx`, `frontend/app/recipes/[id].tsx`.

### 12. Founding Member response ✅
- Every George composer call now includes `system_state.founders = { cap, taken, remaining, open }` computed live from `db.users.count_documents({ is_founder: True })`. Prompt has locked templates for "open" (encourage), "closed" (500 taken), and null (safe fallback pointing to `/founders`).
- **Files:** `backend/services/george/event_creation/service.py` (new `_founders_system_state` helper + prompt section).

## ✨ Onboarding refinement (user's added note)

- **Removed** the "Here's what I've learned about you" profile summary card entirely. Members no longer see the analytical breakdown.
- Instead, when the onboarding session transitions to `drafted` status, `GeorgeOnboarding` injects a warm thank-you turn into the chat:
  > *"That's really helpful, [Name]. Thank you. I think I've got a lovely picture of what you enjoy. If I ever get something wrong, just let me know — I'm always learning."*
  Then the two action buttons remain: **That looks right / Change something**.
- **File:** `frontend/src/components/george/GeorgeOnboarding.tsx`.

## Verification

- Founders endpoint: `curl /api/founders/status` → `{ cap:500, taken:4, remaining:496, open:true }` ✓
- FP Café is row 0 of `/api/tables` with `pinned:true, protected:true` ✓
- Backend + Metro started cleanly. All lint warnings resolved.

## Version

`app.json`: **1.0.8 → 1.0.9**, iOS `buildNumber` **115 → 116**, Android `versionCode` **115 → 116**.
