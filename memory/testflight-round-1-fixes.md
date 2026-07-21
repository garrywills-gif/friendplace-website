# TestFlight Feedback Round 1 — Fixes Applied

**Build:** 1.0.8 / 115
**Date:** 27 July 2026
**Reporter:** Garry (TestFlight physical device testing)

## Bugs fixed (P0 — launch-blocking)

### 1. George conversations lost after event creation ✅
- **Root cause:** `approve()` cleared `activeSessionId` and unmounted the modal, replaced it with a fullscreen `GeorgeEventCelebration` modal.
- **Fix:** `GeorgeEventCreation.approve()` now keeps the modal open, appends a special `celebration` turn plus a warm follow-up turn ("Anything else I can help with?"), and silently spawns a fresh session for follow-up messages. New `EventCelebrationCard` renders inline beneath the celebration turn.
- **Files:** `frontend/src/components/george/GeorgeEventCreation.tsx`, `frontend/src/lib/george-api.ts` (added `celebration` field to `EventTurn`), `frontend/src/components/george/GeorgeButterfly.tsx` (removed the old celebration modal).

### 2. Event confirmation chat disappears after "That looks right" ✅
Same fix as #1 — the modal now stays in place with the entire conversation visible.

### 3. B6 conversational event editing wouldn't fire ✅
- **Root cause:** The Haiku intent classifier occasionally returns `is_edit_intent: false` for phrasings like "edit my coffee morning" or "update the BBQ" when the LLM under-classifies. The flow then falls through to the composer as if it were a new-event turn.
- **Fix:** Added a deterministic safety net (`_has_edit_signal` + `match_events` fallback) in `try_handle_edit_intent`. If the classifier says no but a broad edit-verb keyword hits AND the actor has at least one plausibly-matching event, promote to a moderate-confidence `update` intent so the flow proceeds. Also expanded the cancel pattern to catch "call the bbq off" style phrasings. Verified: 10/10 positive cases now detected.
- **Files:** `backend/services/george/event_edit_flow.py`.

## Bugs fixed (P1)

### 4. Send Chat / Send Flutter to a member ✅
- **Fix:** Added a new prompt section "MEMBER-TO-MEMBER ACTIONS: CHATS & FLUTTERS" that instructs George to warmly acknowledge, name the destination, and attach a `navigate_to` chip (`friends` when a specific person is named, `chats` for general chat browsing).
- **Files:** `backend/services/george/event_creation/service.py`.

### 5. Stale chat history reappearing unexpectedly ✅
- **Root cause:** `activeSessionId` was stored in AsyncStorage as a bare string with no TTL. A backgrounded / mid-flight session could resurface days later.
- **Fix:** Store `{ id, ts }` JSON and enforce a 24h TTL on hydrate. Falls back to legacy bare-string format for backward-compat.
- **Files:** `frontend/src/lib/george-context.tsx`.

### 6. Auto-read new messages doesn't work ✅ (added on top of round 1)
- **Root cause:** The device TTS (`expo-speech`) was inaudible on iOS with the ringer switch muted and used a mismatched voice from the Speaker (▶︎) button's cloud voice.
- **Fix:** New shared helper `speakGeorgeAloud()` routes auto-read through the same cloud-persona voice + `playAudioUri` pipeline that the Speaker button uses. Device TTS remains as a fallback if the cloud call fails.
- **Files:** `frontend/src/lib/george-auto-read.ts` (new), `frontend/src/components/george/GeorgeEventCreation.tsx`, `frontend/src/components/george/GeorgeOnboarding.tsx`.

## Bugs fixed (P2)

### 7. George feels too static — subtle bob animation ✅
- Added a 3-flap wing flutter + 3px hop every ~10s while at rest to both the floating butterfly (`GeorgeButterfly.tsx`) and the inline `<GeorgeHeaderMark />` (`Header.tsx`). Reanimated timing: 130/150/130/180 ms — a soft heartbeat, never distracting.

## FP Café refactor

### 8. Rename Coffee Lounge → FP Café + permanent pinned café ✅
- **Backend:** New `_ensure_fp_cafe_table()` seeds a permanent, protected, pinned table (id: `fp-cafe-permanent`) with `host_id: "system"`. Called idempotently inside `_migrate_table_metadata`. `list_tables` now pins any `pinned: true` doc to the top.
- **Frontend:** Global rename of user-facing "Coffee Lounge" → "FP Café" across ~20 files (labels, help text, notifications, share text, milestones). The special pinned card renders with a teal border, an `📌 ALWAYS OPEN` badge, no host attribution, and a `Pull Up a Chair` CTA. Members opt in with one tap (not auto-joined).
- **George prompt:** New FP CAFÉ AS THE FIRST DOOR section — George recommends the café to new members ("A nice first step is to pop into the FP Café and say hello.") and contextually when a member says they're lonely / new / unsure. Only ever one Café mention per conversation.
- **Files:** `backend/server.py`, `backend/services/george/event_creation/service.py`, `frontend/app/(tabs)/lounge.tsx`, `frontend/app/home.tsx`, `frontend/src/lib/george-nav-map.ts`, and 15+ other files with user-facing labels.

## Verified via smoke tests

- `python3 /tmp/smoke_edit_intent.py` — 10/10 positive edit-intent phrasings detected.
- `curl /api/tables` — FP Café returns as the first row with `pinned: true, protected: true`.
- Frontend renders FP Café as pinned card with teal border and "ALWAYS OPEN" badge.

## Version bump

- `frontend/app.json`: version 1.0.7 → **1.0.8**, iOS `buildNumber` 114 → **115**, Android `versionCode` 114 → **115**.
