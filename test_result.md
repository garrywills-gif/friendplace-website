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
        Implemented the YouBelong Trivia game end-to-end. Backend has the full
        session lifecycle, ~150 curated questions across 7 categories × 4
        difficulties, deterministic Daily Trivia, and proper Butterfly Points +
        Achievement Flutter triggering ONLY on Hard/Nightmare completions
        (legacy "expert" bug fixed).

        Please test:
          1. Backend trivia endpoints (catalog, daily, full session flow with
             correct + incorrect answers, lifelines fields, completion awards
             expected points 5/10/20/35 and grants achievements appropriately).
          2. Frontend: Games Hub now shows enabled Trivia tile + Daily Trivia
             row. Trivia Hub renders categories + 4 difficulty rows + Daily
             card. Player runs the round, supports 50/50 + Skip, shows
             feedback + explanation, displays results with score + points.
          3. Confirm log_game_completion grants "hard" achievement on a hard
             completion and "nightmare" on a nightmare completion (this was
             previously broken due to the "expert" key mismatch).

        Demo accounts in /app/memory/test_credentials.md.
