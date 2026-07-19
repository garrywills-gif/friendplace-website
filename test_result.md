# MCGS Phase 3 · Milestone A — Admin Chat Surface (Conversational Event Creation)

## Original problem statement
Build the Admin Chat Surface UI for MCGS Phase 3 Milestone A (Conversational Event Creation). George converses warmly, celebrates when the draft is ready, and returns an Action Preview. Editing happens *by talking to George* — primary CTA `Confirm & Create`, secondary `Make Changes` continues the chat. New surface lives at `/admin/george/new-event` and is reachable from the Bridge (suggestion card) and from a new `/admin/george` Workspace landing page.

Backend has already been baked (Milestone A backend). This iteration adds the UI + 5 tone refinements + new architectural principle #12.

## Test credentials
- **CMS admin login**: `hello@friendplace.com.au` / `TestPass2026!`
- Website base URL: `http://localhost:3001` (mapped to `/` via nginx)
- Backend base URL: `http://localhost:8001` (mapped to `/api` via nginx)

Login form on `/admin/login`. After login the app redirects to `/admin/bridge`.

## Frontend test scope — Milestone A

### 1. George's Workspace landing (`/admin/george`)
- Renders `"George's Workspace"` heading, workspace intro copy, and 7 capability tiles.
- **Create Event** tile is clickable → navigates to `/admin/george/new-event`.
- The other 6 tiles (Draft Announcement, Create Group, Invite Members, Plan Community Activity, Generate Newsletter, Volunteer Request) show a `Coming soon` pill and are not clickable.
- Bottom link "← Back to the Bridge" navigates to `/admin/bridge`.

### 2. Bridge suggestion card (`/admin/bridge`)
- Right-rail contains a card titled *"Would you like to create something today?"*.
- Contains a primary CTA `Talk to George about an event` → `/admin/george/new-event`.
- Contains secondary link `Or open George's Workspace` → `/admin/george`.

### 3. Admin Chat Surface (`/admin/george/new-event`) — happy path
- Renders heading `Create an Event with George` with breadcrumb back to Workspace.
- Empty state shows butterfly, warm copy, and 3 conversational starter chips.
- Sending a fully-formed seed (e.g. *"I'd like to run a Christmas Bowls evening on Saturday 5 December at 10am at the Community Hall. About 24 people. Open to everyone."*) via the `Start with George` button:
  - Shows a working row (`… Just noting the details you've given me…` or similar animated dots).
  - Renders George's reply beginning with a warm/celebratory line (rule 3: *"Here we are — I think this one's going to be a hit."*, *"That's your event ready."*, etc.).
  - Renders the **Action Preview card** with: title, friendly date (Saturday 5 December · 10:00), location, capacity, audience, description, and a `Why George chose these details` collapsible.
  - Primary button `✓ Confirm & Create`.
  - Secondary button `✏️ Make Changes`.
  - Small `Advanced edit` link below toggles a field-level panel.

### 4. Conversation-based edits (rule 5 — forgive mind changes)
- With a draft on screen, send *"Actually, let's call it 'Twilight Bowls' instead, and move it to 6pm."* → George replies warmly (e.g. *"Perfect — Twilight Bowls at 6pm it is."*) and the Action Preview updates title → **Twilight Bowls**, time → **18:00**. No error, no lecture, no field-editing.

### 5. Advanced edit panel
- Clicking `Advanced edit` reveals inputs for Title, Location, Date, Time, Capacity, Audience, Description prefilled with the current draft. Changing a value and clicking `Confirm & Create` includes the override in the approval payload.

### 6. Confirm & Create + success screen
- Clicking `Confirm & Create` shows `Creating…` label briefly, then displays the success screen:
  - Butterfly icon, `Your event is ready.` heading, warm copy *"I've added <Title> to today's activity. Have a lovely time with it. — George"*.
  - `Back to the Bridge`, `View in Events`, and `Create another` buttons.

### 7. "Leave and go back" quiet exit
- Clicking the small `Leave and go back to the Bridge` link at the bottom of the chat surface calls the cancel endpoint and navigates to `/admin/bridge`.

### 8. Nav integration
- Sidebar under `/admin/*` shows `George's Workspace` between `The Bridge` and `Dashboard (old)` with 🦋 icon; the item is `active` on both `/admin/george` and `/admin/george/new-event`.

## Backend API surface used
All endpoints require `Authorization: Bearer <token>` from `POST /api/cms/auth/login`:
- `POST /api/mcgs/george/event/start` — body `{ text }` → returns `EventSession` with `turns`, `draft`, `status`, `field_being_asked`.
- `POST /api/mcgs/george/event/session/{id}/turn` — body `{ text }`.
- `POST /api/mcgs/george/event/session/{id}/approve` — body `{ edits: null | Partial<EventDraft> }`.
- `POST /api/mcgs/george/event/session/{id}/cancel`.
- `GET /api/mcgs/george/event/session/{id}`.

## Files of reference
- `/app/website/app/admin/george/page.tsx` — Workspace landing.
- `/app/website/app/admin/george/new-event/page.tsx` — Chat surface page.
- `/app/website/components/mcgs/GeorgeEventChat.tsx` — Chat surface component (empty state, chat bubbles, working row, ActionPreviewCard, success screen).
- `/app/website/components/mcgs/GeorgeSuggestionCard.tsx` — Bridge right-rail suggestion card.
- `/app/website/app/admin/bridge/page.tsx` — Bridge (unchanged apart from importing the suggestion card).
- `/app/website/components/admin/AdminShell.tsx` — Sidebar nav (new `George's Workspace` item).
- `/app/website/lib/mcgs-api.ts` — new `eventCreationApi` typed client.
- `/app/backend/services/george/event_creation/service.py` — updated Composer prompt with 5 tone rules + `restart_requested` handling + `excitement_line` / `working_line` fields.
- `/app/memory/mcgs-architecture.md` — new principle #12 and new decision log rows.

## Notes for the tester
- Sonnet calls can take 5–20 seconds; wait up to 60 s for a George reply after each send.
- The two buttons in the composer are `Start with George` (initial send) and `Send` (subsequent turns).
- The `Confirm & Create` button has `aria-label="Confirm and create the event"` for reliable targeting.
- The `Make Changes` button simply focuses the composer input — it does not open a form.
- If tests need to inspect the database, the conversation lives in `db.george_event_conversations` and admin-approved events land in `db.events` with `created_by_george: true`.

## Rhythms Phase 2 baseline (regression, backend only)
The previous v1.1 backend regression suite passed 26/26. Do NOT re-run those unless MCGS Phase 3 UI tests uncover a regression on the Bridge cards.
