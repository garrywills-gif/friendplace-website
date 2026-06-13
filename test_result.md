#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  Build "YouBelong", a community/friendship app for older adults. Latest task:
  Implement the **Trivia Game** for the Games Hub. Must support 7 categories
  (Australia, History, Music, Movies, Sport, Gardening, General Knowledge),
  the four mandated difficulties (Easy / Moderate / Hard / Nightmare), accessible
  large-text UI with SpeakButton on questions, lifelines (50/50 and Skip),
  Daily Trivia, auto-save and resume, Butterfly Points on completion, and
  Achievement Flutters to friends ONLY on Hard/Nightmare completions.

backend:
  - task: "Trivia API – catalog, daily, session start/get/answer/complete, sessions list, stats"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: |
            New trivia endpoints under /api/games/trivia/*:
              GET  /catalog           – categories, difficulties, meta
              GET  /daily             – deterministic 10-question daily set
              POST /session/{uid}     – start session (category, difficulty, daily)
              GET  /session/{uid}/{sid} – load session (questions stripped of answer)
              POST /session/{uid}/{sid}/answer  – submit/skip; tracks lifelines, current_index
              POST /session/{uid}/{sid}/complete – finalises, awards points, calls log_game_completion
              GET  /sessions/{uid}    – active + recent
              GET  /stats/{uid}       – totals/accuracy/by_difficulty
            Question bank lives in /app/backend/trivia_data.py (~150 questions).
            Smoke-tested with curl: start → answer → complete works, points + achievements awarded.
            Also fixed legacy bug in log_game_completion where "expert" was used instead
            of the new "hard"/"nightmare" achievement keys.

  - task: "Achievement key fix (hard/nightmare instead of legacy 'expert')"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: |
            log_game_completion now grants the "hard" achievement when difficulty=="hard"
            and "nightmare" when difficulty=="nightmare". Jigsaw's unified mapping no
            longer translates to challenging/expert.

frontend:
  - task: "Trivia Hub screen (category + difficulty picker, daily card, stats, resume)"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/games/trivia/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: |
            New file replaces old games/trivia.tsx. Features: instructions card with
            SpeakButton, prominent Daily Trivia call-to-action, in-progress resume
            scroller, stats summary, category chips (Mixed + 7 cats), 4 difficulty
            rows (Easy/Moderate/Hard/Nightmare), recent games list, big "Start" CTA.

  - task: "Trivia Player screen (large-text Q&A, SpeakButton, lifelines, feedback, results)"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/games/trivia/player.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: |
            Question card with SpeakButton reading question + options aloud, A/B/C/D
            answer buttons (large min-height), correct/wrong colouring + explanation,
            "50/50" lifeline that hides two wrong answers (1 use), "Skip" lifeline
            (1 use). Results screen shows score, % correct, points earned, granted
            achievements, and per-question recap.

  - task: "Games Hub – enable Trivia tile and Daily Trivia link"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/games/index.tsx"
    stuck_count: 0
    priority: "low"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: |
            Trivia tile is now ready=true. Daily Trivia card is enabled with subtitle
            "10 mixed questions · 15 pts" and routes to /games/trivia.

  - task: "API client – trivia methods"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/lib/api.ts"
    stuck_count: 0
    priority: "low"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: |
            Added triviaCatalog, triviaDaily, triviaStart, triviaGetSession,
            triviaAnswer, triviaComplete, triviaSessions, triviaStats.

metadata:
  created_by: "main_agent"
  version: "1.0"
  test_sequence: 1
  run_ui: true

test_plan:
  current_focus:
    - "Trivia API – catalog, daily, session start/get/answer/complete, sessions list, stats"
    - "Trivia Hub screen (category + difficulty picker, daily card, stats, resume)"
    - "Trivia Player screen (large-text Q&A, SpeakButton, lifelines, feedback, results)"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    -agent: "main"
    -message: |
        PHASE A WRAP-UP — Onboarding + Profile editing shipped.

        Onboarding (`/app/onboarding.tsx`)
        ==================================
        Brand-new 7-step swipeable tour gated by `user.onboarding_completed`.
        Steps: Welcome → Coffee Lounge → Flutters → Butterfly Points →
        Community Notice Board → Games Hub → Accessibility. Each step has
        a SpeakButton reading the title + body aloud. Skip button and
        manual dot navigation supported. "Let's go" finalises via
        `POST /api/users/{id}/onboarding-complete` + `refresh()` then
        `replace('/(tabs)/home')`.

        Routing changes:
          - Signup now redirects to `/onboarding` instead of `/(tabs)/home`.
          - Login error handling now surfaces "Your account is restricted"
            for 403/banned/suspended.
          - Home tab redirects to `/onboarding` if `user.onboarding_completed
            === false` (defensive guard for any auth path that misses the
            new redirect).

        Profile edit (`/app/profile/edit.tsx`)
        ======================================
        Full editor backing the new backend fields:
          - **Photo** — expo-image-picker for upload (stored as base64 data URI)
            with permission-aware flow + 12-emoji avatar grid for non-uploaders.
          - **Name + Suburb + Birthday** (YYYY-MM-DD or MM-DD).
          - **About Me** — 500-char bio with live counter.
          - **Interests** — 16 chip selector (toggle).
          - **Favourite Games** — 7-chip selector.
          - **Privacy settings** — three segmented controls + one toggle:
            profile visibility (Everyone / Friends only), friend requests
            (Everyone / Friends of friends / Off), show in Find Friends
            (on/off).
          - Save → `PATCH /api/users/{id}/profile` + `PATCH /api/users/{id}/privacy-settings` + refresh + back.

        Auth context type extended with `is_admin`, `onboarding_completed`,
        `favourite_games`, `birthday`, `privacy_settings`, `restricted`,
        `banned` so type-checking is honest across the new screens.

        Profile tab now exposes an **Edit Profile** button (above Help &
        Support / Accessibility / Settings / 🛡 Admin tools).

        Smoke-tested
        ============
          - Onboarding step 1 (Welcome) and step 4 (Butterfly Points)
            render correctly with SpeakButton + Skip + Back/Next.
          - Edit Profile shows the auth gate ("Please log in.") for
            unauthenticated visitors.
          - Bundle clean (no transform errors).

        Test plan for the testing agent (next iteration)
        ================================================
          1. Backend regression: all previous 19 admin/safety + 16 bingo +
             10 trivia tests still pass.
          2. Backend: `PATCH /users/{id}/profile` with new fields
             (bio/avatar/interests/favourite_games/birthday) persists and
             returns the updated user.
          3. Backend: `PATCH /users/{id}/privacy-settings` updates the
             three sub-keys atomically; rejects invalid values.
          4. Backend: `POST /users/{id}/onboarding-complete` flips the flag
             so the home gate doesn't redirect any more.
          5. Frontend: Onboarding swipes through all 7 steps, skip works,
             finish flips the backend flag and lands on Home.
          6. Frontend: Profile edit — pick an emoji avatar, edit bio,
             toggle interests + favourite games, change privacy, Save
             redirects back and the new values appear on the profile.
          7. Frontend: A brand-new signup auto-routes to onboarding, then
             the second login goes straight to Home.

        Per the user's strongly-emphasised requirements, the focus of this
        session was the Safety / Admin Moderation system.

        Backend
        =======
        Models extended on User: `is_admin`, `restricted`, `restricted_at`,
        `restricted_reason`, `banned`, `suspended_until`, `privacy_settings`
        (profile_visibility / friend_requests / show_in_find_friends),
        `favourite_games`, `birthday`, `onboarding_completed`.
        Startup migration now backfills these fields safely on existing users
        and promotes `maggie` to `is_admin: true` (without overwriting on
        subsequent restarts).

        Endpoints added under `/api`:
          - `POST /reports` — submit a report (user/notice/message/dm/profile),
            auto-infers `target_user_id` when reporting content, returns the
            friendly "Thank you. We've received your report and will review it."
          - `GET /safety/report-reasons` — taxonomy (Spam, Harassment/Bullying,
            Inappropriate Content, Fake Profile, Scam/Suspicious Behaviour, Other).
          - Auto-restriction: 3 distinct reporters within 24 hours on the same
            target → user marked restricted, their notices set `auto_hidden: true`
            (hidden from public listing), open reports flagged urgent, admins
            notified. Verified via curl: 3 reports → `auto_restricted: true`,
            target now `restricted: true`, `restricted_reason: "Auto-restricted:
            3+ reports in 24h"`.
          - `POST /notices` rejects 403 if author is restricted/banned.
          - `POST /auth/login` blocks banned + suspended users (notifies admins
            on the attempt) and auto-clears expired suspensions.

        Admin endpoints (gated by `_require_admin`, returns 403 otherwise):
          - `GET /admin/summary` — counts: new / reviewing / urgent / resolved
            reports + open/resolved support + total/restricted/banned users.
          - `GET /admin/reports?status=…` — list (urgent first, then newest),
            enriched with reporter + target user info.
          - `GET /admin/reports/{id}` — full detail incl. related content
            (notice / message), reporter, target user, and target's report history.
          - `POST /admin/reports/{id}/status?status=…` — mark new / reviewing /
            resolved / dismissed with admin_note.
          - `POST /admin/users/warn|suspend|ban|restore` — pushes an in-app
            notification to the user explaining the action and (when a report
            is referenced) closes that report with `outcome=warned/suspended_24h
            /banned/...`.
          - `POST /admin/content/remove` — removes a notice or message
            (text replaced with "[Removed by moderator]").
          - `GET /admin/support/tickets`, `POST /admin/support/tickets/{id}/resolve`.

        Support tickets:
          - `POST /support/tickets` — user-facing endpoint; admins get a
            "New support ticket" in-app notification.

        Frontend
        ========
        New screens:
          - `/admin/index.tsx` — gated admin home. Hero tiles for Urgent / New /
            Reviewing / Resolved / Support open / Restricted. Tab switcher
            between Reports and Support tickets. Status filter chips. Urgent
            reports highlighted in red with the URGENT badge.
          - `/admin/report/[id].tsx` — full report detail with reported user
            card (status + restriction reason + warning of previous report
            history), reporter info, related content (the actual notice/message
            body), admin-note text field, and action buttons:
              Status: Mark reviewing / Dismiss / Mark resolved
              User actions: Warn user · Suspend 24h · Suspend 7 days · Ban user
              (and Restore access when the user is already restricted/banned)
              Content actions: Remove notice/message
          - `/help.tsx` — Help Centre with searchable FAQ accordion (10
            curated Q&As), Contact Support form (Account help / Suggestion /
            Other categories), Report a Problem form. Tickets POST to
            `/support/tickets`.

        New component:
          - `src/components/ReportSheet.tsx` — reusable structured-report
            bottom sheet. Pulls reason taxonomy from `/safety/report-reasons`.
            Two-stage flow: choose reason + add notes → "Thank you" view with
            optional "Block this user" CTA + auto-restricted banner when
            applicable. Wired into Notices kebab menu.

        Profile screen now exposes:
          - Help & Support entry (always)
          - 🛡 Admin tools entry (only when `user.is_admin === true`)

        Frontend safety enforcement:
          - Notices feed filters out `removed: true` and `auto_hidden: true`
            documents server-side.
          - Restricted/banned users can't POST a notice (403 from backend).
          - Restored users have their notices un-hidden in one click.

        Test credentials
        ================
          - **maggie** (admin demo account) — use `/auth/demo-login { "username":
            "maggie" }` then navigate to /admin or open Profile → Admin tools.

        Curl smoke-tests confirmed:
          - 3 reports from 3 different users within 24h auto-restrict the
            target and mark all open reports urgent.
          - Non-admin → 403 on every `/admin/*` endpoint.
          - Admin → 200 on `/admin/summary`, full counts visible.

        Test plan for the testing agent (next iteration):
          - Backend: report submission, auto-restrict threshold, admin
            permissions, status transitions, warn/suspend/ban/restore,
            content removal, login blocked for banned/suspended users.
          - Frontend: ReportSheet on a Notice kebab, end-to-end report flow,
            Admin home renders for maggie only, report detail actions update
            state and notifications fire to the reported user.

        Carry-over for the next session (Phase A items not yet built):
          - Onboarding 6-step tour (Coffee Lounge / Flutters / Butterfly
            Points / Notice Board / Games Hub / Accessibility) — gated by
            `onboarding_completed` flag (backend already supports it).
          - Profile editing UI for avatar upload (base64), bio, interests,
            favourite games, privacy settings (endpoints already exist).
          - Wire ReportSheet into DMs and User Profiles (currently only Notices).

        Backend (`/api/games/bingo/*`):
          - `/catalog` — 4 difficulties with full meta (cols/rows/cards/free_center/pattern/points/auto_call_ms).
          - `/daily` — deterministic daily card seeded by date.
          - `/community-events`, `/community-events/{eid}/leaderboard` — 3 seeded async events with sorted leaderboards.
          - `/session/{uid}` POST start, GET load, PUT update (call_index + marked), POST complete.
          - `/sessions/{uid}`, `/stats/{uid}`.
          - Win patterns enforced server-side: `any_line` (Easy/Moderate), `two_lines_corners` (Hard), `full_house` across all cards (Nightmare). Returns 400 when the player calls Bingo without a valid pattern.
          - Points: Easy 5 / Moderate 10 / Hard 20 / Nightmare 35; Daily flat 15; events use their own point values (12/25/50).
          - Calls `log_game_completion` with the real difficulty so Flutter notifications fire only on Hard/Nightmare (using the achievement-key fix from the last iteration).

        Frontend:
          - `/games/bingo/index.tsx` — instructions w/ SpeakButton, Daily Bingo card, Community Events list, Resume card, stats, 4 difficulty picker rows, Start CTA.
          - `/games/bingo/player.tsx` — huge "LAST CALL" banner (B-7 style with letter prefix), one or two cards (Nightmare), tap-to-mark with validation against `calledSet`, auto-call timer for Hard (4s) / Nightmare (3s), TTS announcement of each call when `prefs.readMessagesAloud` is on, manual "Call next" button for Easy/Moderate, "Call BINGO!" submit, results screen with points + granted achievements, recent calls strip.
          - Games Hub tile now `ready: true` with sub "75-ball · 4 levels · live events".

        Curl smoke tests passed (start → update marked → complete on any-line win returns +5 pts; complete with no win returns 400).

        Please test:
          1. Backend Bingo endpoints — catalog, daily, community events list/leaderboard, session lifecycle, all 4 difficulties including correct pattern enforcement (full_house for nightmare requires every cell of every card; two_lines_corners requires 2 full lines + 4 corners on hard).
          2. Frontend hub renders all sections, difficulty selection works, Daily/Event/Custom start each route to player with correct settings.
          3. Player: card displays with letter row, tap-to-mark only works on called numbers, "Call next" advances and announces (TTS when read-aloud preference is on), auto-call works on Hard/Nightmare, "Call BINGO!" validates and shows results on a win.
          4. Confirm achievements: completing Hard or Nightmare grants the respective achievement and Flutter notification; Easy/Moderate do NOT trigger Flutter.

        Fixes applied:
          1. Deleted dead duplicate `/app/games/quiz.tsx` (superseded by full Trivia, no route pointed to it).
          2. Removed `router.back()` buttons from all four tab roots (Home, Lounge, Friends, Profile) — they were nonsensical and risked sending freshly-logged-in users back to the welcome screen.
          3. Replaced `Alert.alert` (silent on react-native-web) across the app with a new cross-platform `confirm()` API exposed from `ToastProvider`. Updated callers:
             - `notices.tsx`: report / block / delete confirms + a brand-new bottom-sheet "Notice options" modal for the kebab menu.
             - `games/jigsaw/[id].tsx`: restart confirm.
             - (Trivia already uses its own modal from the previous iteration.)
          4. Deduped `blockUser` in `src/lib/api.ts`.
          5. Welcome screen "Continue with Apple/Google" no longer silently logs in as a demo user. Shows a clear "Coming soon" toast directing users to email signup.
          6. Updated cheer copy "Let's celebrate in the Coffee Lounge" → "Join me in the Coffee Lounge" (matches the agreed wording for Bingo's congrats flow).

        Other findings verified working:
          - All Games Hub tile routes resolve (ready=true → game, ready=false → /games/coming-soon).
          - Notifications screen routes per-type (friend_request → inbox, dm, table_join, flutter, event_invite, notice_comment) all valid.
          - Friend request inbox (incoming/outgoing, accept/decline/cancel) is intact.
          - Read-aloud (SpeakButton) honours `prefs.readMessagesAloud` on Home thought, Notices titles+comments+replies, Events, Trivia questions, Accessibility settings.
          - Cheer kinds (well_done / congrats / coffee / flutter) already match the four reactions the user requested for Bingo winners.

        Still open / future polish:
          - `/settings.tsx` and `/settings/accessibility.tsx` both exist with overlapping toggles — could be merged into a single "Settings" hub with sub-pages. Non-urgent, not breaking anything.
          - `games/wordsearch.tsx` placeholder is unreachable (hub routes to coming-soon). Will be replaced when Word Search is built.

        Ready to build Bingo next.
