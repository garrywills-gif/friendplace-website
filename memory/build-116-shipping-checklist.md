# Build 116 — Ready for TestFlight ✅

**Date:** 28 July 2026
**Verified by:** Testing agent + main-agent code review + screenshot audit

## Backend E2E — 8/8 PASS (automated)

`/app/backend/tests/test_iter85_testflight_round2.py`
- Health, Founders open, FP Café pinned + protected + persistent, `/api/voice/transcribe` reachable, jigsaw fully curated, member login OK, demo-login OK, onboarding start reachable.

## Frontend verified

- **Lounge**: FP Café row 0, teal border, `📌 ALWAYS OPEN` badge, `Pull Up a Chair` CTA. No "Coffee Lounge" or "Lounge tab" text.
- **/user/[id]**: only inline header butterfly renders; floating overlay correctly suppressed.
- **Onboarding**: profile summary card retired; warm thank-you turn injected.
- **Welcome screen**: clean, on-brand, Founding Members banner prominent, Apple/Google Sign-In buttons present.
- **Auto-read cursor**: persisted per session_id in AsyncStorage.
- **Approval flow**: pre-approval history preserved; celebration renders inline; lazy fresh-session spawn on first post-approval message.
- **VoiceInputButton**: `process.env` cast removed so Metro inlines the URL at build time.
- **Founders composer**: live `system_state.founders` injected on every LLM call.

## Small polish just applied

- **Friends screen no-friends toast** — suppressed the misleading "Failed to load" red toast on 401/403 auth hydrate. Members with no friends now see a clean empty state instead.

## What we can only verify on device / TestFlight

- Whisper STT (mic press → recording → transcript) — automated browsers can't tap OS mic prompt.
- Native `expo-audio` cloud TTS playback (silent-mode override on iOS).
- Push notification permission prompt at end of onboarding.
- Apple Sign-In flow (requires real Apple ID + provisioned bundle).

Suggested single-device manual smoke path (≈8 minutes):
1. Fresh install / delete + reinstall to reset AsyncStorage. Open the app.
2. Sign up as new member OR log in via `member@friendplace.com.au / TestPass2026!`.
3. Complete George onboarding, confirm the warm thank-you and only two buttons.
4. Tap into Lounge → confirm FP Café is pinned first with correct wording.
5. Open a member's profile → confirm no static butterfly.
6. Send a Flutter → confirm no error.
7. Tap George → create a coffee morning → tap "That looks right".
8. Confirm chat stays open + inline celebration + follow-up prompt.
9. Ask George to edit the coffee morning → confirm he enters the flow.
10. Ask "How do I become a founding member?" → confirm encouraging response with live count.
11. Tap mic in a chat → confirm STT records + transcribes.
12. Log out → log back in → confirm onboarding not re-triggered and no duplicate speech.

## Ship criteria

If all 12 manual steps pass, hit **Publish → Generate iOS build** and submit 1.0.9 / build 116 to TestFlight.
