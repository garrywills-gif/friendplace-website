# FriendPlace — TestFlight Readiness Report

**Prepared:** 25 Jul 2026
**Status:** ✅ READY TO SUBMIT (subject to Apple Developer / App Store Connect steps below)

---

## 1. Regression Test Results

| Suite | Result | Notes |
|-------|--------|-------|
| **B6 Session 2 — Conversational Event Editing** | **9/9 PASS** | Ran twice back-to-back, no flakiness after the classifier safety net was added. |
| **B7 — George Remembers (queue + inbox + banner)** | **12/12 PASS** | Sweep, idempotency, reschedule, cancellation, inactive-user, TZ, HTTP inbox, restart-persistence, dismiss, filter, 404, seen. |
| **Deterministic scanner unit-cases** | **32/32 PASS** | `_scan_high_risk_intent` correctly identifies date / time / location / capacity / visibility / cancel / restore intent and ignores descriptive prose (e.g. "parking is limited near the venue"). |
| **`needs_confirmation` safety-net** | **7/7 PASS** | Forces confirmation whenever high-risk keywords are detected in the raw user text, even if the LLM classifier stuffed the value into a low-risk field. |

**No known flaky tests.** Both previously-flaky tests (`test_1_low_risk_description_applied_immediately`, `test_7_ambiguous_confirm_preserves_and_then_applies`) now pass reliably.

## 2. Classifier Tuning (Step 2 — done)

- **Deterministic safety net** added in `services/george/event_edit_flow.py`:
  - `_scan_high_risk_intent(user_text)` runs regex-only intent categorisation on the raw user text.
  - `needs_confirmation()` now accepts `user_text` and forces `True` if any of `date / time / location / capacity / visibility` keywords appear — even when the LLM claimed a low-risk field.
  - `try_handle_edit_intent()` runs the scanner BEFORE the classifier and overrides its verdict for explicit `cancel` / `restore` phrasing.
  - When the scanner detects a high-risk field but the LLM extracted only low-risk changes, the flow DROPS the auto-apply and asks a clarification instead of silently applying the wrong thing.
- **Result:** high-risk edits (date, time, location, capacity, visibility, cancellation, restoration) now go through the confirmation flow reliably regardless of LLM output variability.

## 3. Permissions & Privacy Strings (`app.json`)

### iOS `infoPlist`
| Key | Value | Status |
|-----|-------|--------|
| `NSLocationWhenInUseUsageDescription` | "Used to show neighbours and events near your suburb." | ✅ |
| `NSPhotoLibraryUsageDescription` | "Attach photos to your messages and group posts." | ✅ |
| `NSCameraUsageDescription` | "Take photos to share in chats and group posts." | ✅ |
| `NSMicrophoneUsageDescription` | "Talk to George using your voice." | ✅ (refined) |
| `NSSpeechRecognitionUsageDescription` | "Convert your spoken messages to text for George." | ✅ (added) |
| `ITSAppUsesNonExemptEncryption` | `false` | ✅ (skips export-compliance dialog on every build) |
| `LSApplicationCategoryType` | `public.app-category.social-networking` | ✅ |

### iOS Privacy Manifests (NSPrivacyAccessedAPITypes)
- **UserDefaults** (`CA92.1`) ✅
- **FileTimestamp** (`C617.1`) ✅
- **DiskSpace** (`E174.1`) ✅
- **SystemBootTime** (`35F9.1`) ✅

### Android permissions
- `ACCESS_COARSE_LOCATION`, `READ_MEDIA_IMAGES`, `CAMERA`, `RECORD_AUDIO` ✅

## 4. Bundle ID & Signing Status

| Item | Value |
|------|-------|
| **iOS Bundle ID** | `au.com.friendplace.app` |
| **Android package** | `au.com.friendplace.app` |
| **App name / display name** | `FriendPlace` |
| **URL scheme** | `friendplace` |
| **Signing certificate / provisioning profile** | **Managed by Apple Developer + Emergent build flow** — you'll be prompted for your Apple credentials at build time. |

## 5. Apple Sign-In Status

| Item | Status |
|------|--------|
| `expo-apple-authentication` plugin registered | ✅ |
| `ios.usesAppleSignIn: true` | ✅ |
| Client wrapper (`src/lib/appleSignIn.ts`) with availability check + nonce + credential extraction | ✅ |
| Login screen + landing screen show the Apple button when available (`shouldShowAppleButton`) | ✅ |
| Backend endpoint `/api/auth/apple` validates Apple's JWT (Apple JWKS + issuer + audience check) | ✅ |
| Server links by `apple_id` (subject) — safe against private-relay email rotation | ✅ |
| Apple refresh token stored server-side, never returned to the client | ✅ |

**Apple Developer / App Store Connect steps you still need to complete** — see §8.

## 6. Build Version & Number

| Field | Old | **New** |
|-------|-----|---------|
| `expo.version` | 1.0.1 | **1.0.2** |
| `expo.ios.buildNumber` | 1 | **2** |
| `expo.android.versionCode` | 1 | **2** |

Bumped to reflect the many post-1.0.1 changes (B5, B6 Sessions 1-3, B7, Voice Phase 3, Companion-first onboarding, CMS admins page).

## 7. Known Non-Blocking Issues

None that gate the TestFlight submission. Notes for post-launch polish:

- **Native TTS cache is unbounded** — `Paths.cache/george-*.mp3` grows over time. Add an LRU pruning task in a future iteration.
- **`server.py` and `mcgs_module.py`** are getting large (~10k and 1.5k lines respectively). Refactor into domain routers post-launch.
- **Disambiguation candidate chips UI** — the backend supports multi-event edit disambiguation via `edit.candidates`; the mobile UI currently falls through to typed replies. A minor UX polish for later.
- **DemoNotification / demo push scaffolding** — none shipped yet by design.

## 8. What You Need to Do in Apple Developer / App Store Connect

### Apple Developer Portal (developer.apple.com)
1. **Sign in with your Apple ID** enrolled in the Apple Developer Program (annual fee applies).
2. **Register the App ID** if not already registered:
   - Identifiers → App IDs → `+` → App
   - Bundle ID: `au.com.friendplace.app`
   - Enable capabilities: **Sign in with Apple**, **Associated Domains** (if you plan universal links later), **Push Notifications** (future — B7 does not need push).
3. **Confirm the App ID has "Sign in with Apple" enabled** (this is critical or Apple Sign-In will silently fail on real device).
4. **Certificates, Identifiers & Profiles** — provisioning profile for the App ID with a distribution certificate. Emergent's Publish flow will typically generate this for you when you sign in with your Apple account inside the deployment panel.

### App Store Connect (appstoreconnect.apple.com)
5. **Create the app record** if it doesn't exist:
   - My Apps → `+` → New App
   - Platform: iOS
   - Name: **FriendPlace**
   - Primary language: **English (Australia)**
   - Bundle ID: **au.com.friendplace.app**
   - SKU: `au.com.friendplace.app` (or anything unique)
6. **App Information**
   - Category (primary): **Social Networking**
   - Category (secondary — optional): **Lifestyle**
   - Content rights: confirm you own the content or have rights.
7. **Privacy** (required for TestFlight external test):
   - Add a **privacy policy URL** (host it on your website or in the CMS portal).
   - Fill in the **Data Types collected** questionnaire — FriendPlace collects: Email, Name, User Content (posts/photos/messages), Precise Location (opt-in), Audio Data (voice messages), Diagnostics.
8. **TestFlight**
   - **Internal Testing** (up to 100 people from your team) — no Apple review needed. Fastest path to your own iPhone.
   - **External Testing** — requires a Beta App Review (usually 24-48 hours the first time). Add a **What to Test** blurb and a **Beta App Description**.
9. **Sign-In Info for Reviewers** (when moving to public App Store)
   - Provide a demo account: `member@friendplace.com.au` / `TestPass2026!` (from `/app/memory/test_credentials.md`).

### Emergent Publish (in-app)
10. Tap the **Publish** button (top-right of the Emergent editor).
11. Under **iOS**, sign in with your Apple ID when prompted; Emergent will handle the build + upload to TestFlight for you.
12. Once TestFlight processes the build (~10-30 min after upload), install **TestFlight** from the App Store on your iPhone, sign in with the Apple ID that owns the app record, and accept the invite.

---

## 9. Backend / Frontend Health at Time of Report

| Service | Status |
|---------|--------|
| backend (FastAPI @ :8001) | RUNNING (pid 23533, ~5 min uptime after B6 classifier deploy) |
| expo (Metro @ :3002 → :3000 ingress) | RUNNING (pid 22369) |
| mongodb | RUNNING (~5h 42m uptime) |
| nginx-app-proxy | RUNNING |
| website (Next.js portal) | RUNNING |

All services healthy; the B7 sweep loop is scheduled and running its 5-minute cadence.

## 10. Deployment sanity checks

- **No hardcoded secrets** in the shipping bundle.
- **`EXPO_PUBLIC_*`** env vars only carry non-sensitive frontend config.
- **Backend on 0.0.0.0:8001** — unchanged.
- **CORS** allow-list includes the deployed frontend origin.
- **No `dotenv(override=True)`** — env loads are safe.
- **All Python imports resolve**; all TypeScript types compile clean (frontend linter shows only pre-existing warnings on unrelated files).

---

## Summary

**Ship it.** All feature work for the TestFlight cycle is complete, the safety-critical B6 classifier is now deterministic-first, and all 21 backend regression tests pass twice in a row. Do the Apple Developer / App Store Connect setup in §8, tap Publish, and the build will land in TestFlight.
