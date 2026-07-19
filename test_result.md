# MCGS Phase 3 · Milestone A (final) — Shared George Platform + Butterfly Arrival

## What this iteration adds

This iteration promoted George from an admin feature to a **shared FriendPlace platform**, and gave him his signature interaction — a butterfly that flutters in on first-visit-per-day and rests in the corner as his permanent home.

### Backend (permission-aware routing)
- New module `/app/backend/services/george/permissions.py` with `KNOWN_CAPABILITIES = (publish_events, create_groups, message_members, manage_volunteers)`.
- `POST /api/mcgs/george/event/session/{id}/approve` now returns `outcome: "published" | "submitted_for_review"` — driven by the actor's **`publish_events` permission**, not their role.
  - Admins default to `true` → writes to `events`.
  - Members always default `false` → writes to a new `events_pending_approval` collection.
  - Organisations default `false`, overridable via `organisations.permissions.publish_events`.
- New moderation queue endpoints (admin-only):
  - `GET  /api/mcgs/events/pending-approval` — list.
  - `POST /api/mcgs/events/pending-approval/{id}/approve` — promote to `events`.
  - `POST /api/mcgs/events/pending-approval/{id}/decline` — decline (with optional note).
- New light presence endpoint powering the butterfly:
  - `GET /api/mcgs/george/presence` → `{ name, unfinished: [...], last_completed: {...} }`. Pure Mongo lookups, no LLM cost.

### Frontend (shared platform)
- **Component extraction & rename**: `mcgs/GeorgeEventChat.tsx` → `components/george/GeorgeConversation.tsx`. Now role-agnostic; the *hosting surface* passes `GeorgeConversationChrome` describing where "Leave" goes, what buttons appear on success, and (optionally) a `successLine` override.
- **Suggestion card** moved to `components/george/GeorgeSuggestionCard.tsx` with prop-driven copy.
- **Role-aware success screen** reads `outcome`:
  - `published` → *"Your event is live." / "I've added <title> to today's activity. Have a lovely time with it."*
  - `submitted_for_review` → *"Off to the FriendPlace team." / "I've sent <title> to the FriendPlace team for a quick look. I'll let you know as soon as it's live."*
- Old admin-owned files removed; nothing under `/components/mcgs/` still imports George.
- Mission Control CONSUMES the shared engine via a thin wrapper at `/admin/george/new-event/page.tsx`.

### The butterfly — signature interaction
Mounted globally in `AdminShell` (visible on every authenticated admin page).

Files:
- `/app/website/components/george/GeorgeButterfly.tsx` — orchestration, animation phases, greeting logic.
- `/app/website/components/george/GeorgeButterflyMark.tsx` — the SVG mark (teal→cyan gradient, deeper teal body, two antennae). Intentionally not the 🦋 emoji.
- `/app/website/components/george/GeorgeFloatingChat.tsx` — the floating chat sheet that opens on tap.

Behaviour (locked with Garry, 19 July 2026):
1. **Arrival** — fires at most once per calendar day per actor. Storage: `localStorage["george.lastArrival.{actorId}"]`. If ≥ 3 days since last arrival, greeting shifts warmer.
2. **Motion** — drifts in from off-screen top-right, ~3.7s cubic-bezier path to the bottom-right corner. ~28% of arrivals do a gentle looping arc instead of a direct path (variation so it feels alive, not scripted). Wings visibly flap during flight.
3. **Landing + greeting** — 320ms after landing, a small speech bubble blooms next to the butterfly with a rotating warm greeting. Continuity: if the actor has an unfinished draft, the greeting name-drops it and shows a `Continue with "…" →` button that resumes that session. If it's been ≥ 3 days, George says *"It's been a little while — nice to see you."* and (if we have one) mentions the last thing we finished together.
4. **Auto-fade** — bubble fades after 6.5s or on any scroll / keypress / tap.
5. **Resting** — butterfly stays forever in the bottom-right corner, giving a tiny wing flutter every ~95 seconds so it feels alive but never distracting.
6. **Tap** — a small flutter animation, then a floating chat sheet blooms (bottom-right, dialog role). The sheet mounts the *same* `GeorgeConversation` engine, has `Open my Workspace →` for continuation, and `×` / Escape to close.

## Test credentials
- CMS admin: `hello@friendplace.com.au` / `TestPass2026!`
- Website base URL: `http://localhost:3001` (mapped to `/` via nginx).
- Backend base URL: `http://localhost:8001` (mapped to `/api` via nginx).

## What to test — priority order

### P0 — The butterfly experience
1. Sign in. On landing (`/admin/bridge`), within ~4 seconds a butterfly SVG should appear at the bottom-right with a greeting bubble. The greeting should contain the admin's first name (or a rotating warm variant).
2. The bubble should fade within ~6.5s. Butterfly remains resting in the bottom-right corner on every subsequent page.
3. Clicking the butterfly (aria-label `"Talk to George — tap to open"`) opens a floating chat sheet with the empty state, three chip suggestions, and a composer. Header shows `"Talking with George"` on the left and `Open my Workspace →` on the right, plus a close button.
4. Pressing Escape or clicking the backdrop or `×` closes the sheet; the butterfly remains at rest.
5. Navigating to `/admin/george` or `/admin/george/new-event` should also show the butterfly at rest (no re-arrival for the same actor same day). The arrival gate is stored in `localStorage["george.lastArrival.{actorId}"]`.
6. `Continue with "<title>" →` button appears only if the actor has an unfinished George conversation (skip unless you seed one).

### P1 — Shared conversation engine
7. From `/admin/george/new-event`, sending *"I'd like to run a Christmas Bowls evening on Saturday 5 December at 10am at the Community Hall. About 24 people. Open to everyone."* should within 60s produce George's warm reply beginning with a celebration line + a full Action Preview (title, friendly date, location, capacity, audience, description, and a *Why George chose these details* collapsible).
8. Tone rule 5 — sending *"Actually, let's call it 'Twilight Bowls' instead, and move it to 6pm."* should update the draft warmly (title → Twilight Bowls, time → 18:00) with no errors.
9. Clicking `✓ Confirm & Create` (aria-label `"Confirm and create the event"`) shows a success screen headed **"Your event is live."** (since the admin has `publish_events`), with warm copy including the event title. `Back to the Bridge` / `View in Events` / `Create another` buttons appear.
10. `Advanced edit` link toggles a field-level panel and any overrides land in the approved event.

### P2 — Permission-based routing (backend)
11. `GET /api/mcgs/george/presence` with the admin bearer token returns `{ name, unfinished, last_completed }` (fields present, arrays are arrays). No LLM cost, fast.
12. `GET /api/mcgs/events/pending-approval` returns `{ items: [], count: 0 }` at rest.
13. The system SHOULD gracefully route member/organisation approvals to the pending queue — but seeding a member account is out of scope here. It's enough to confirm the endpoints exist and the shared engine handles both outcomes at the UI level (test #7–#9 exercises the published path; the wording branch for `submitted_for_review` is a compile-time constant in `GeorgeConversation.tsx > SuccessScreen`).

### P3 — Regressions
14. `/admin/bridge` still renders normally (Morning Briefing, Signal Feed, Health Pulse placeholders). The right rail's *"Would you like to create something today?"* suggestion card links to `/admin/george/new-event`.
15. `/admin/george` (workspace landing) still shows all 7 capability tiles with only Create Event navigable.
16. Sidebar still shows `George's Workspace` and marks it active on both `/admin/george` and `/admin/george/new-event`.
17. Leaving the chat via `Leave and go back to the Bridge` calls cancel + navigates to `/admin/bridge`.

## Files of reference (recent changes)
Backend:
- `/app/backend/services/george/permissions.py` (new)
- `/app/backend/services/george/event_creation/service.py` (approve rewired, presence added, 5 tone-rule prompt)
- `/app/backend/services/george/event_creation/__init__.py`
- `/app/backend/mcgs_module.py` (presence + pending-approval endpoints)

Frontend:
- `/app/website/components/george/GeorgeConversation.tsx` (shared engine)
- `/app/website/components/george/GeorgeButterfly.tsx` (arrival + resting + tap)
- `/app/website/components/george/GeorgeButterflyMark.tsx` (SVG mark)
- `/app/website/components/george/GeorgeFloatingChat.tsx` (bottom-right chat sheet)
- `/app/website/components/george/GeorgeSuggestionCard.tsx`
- `/app/website/components/admin/AdminShell.tsx` (mounts `<GeorgeButterfly />`)
- `/app/website/app/admin/george/new-event/page.tsx` (thin admin wrapper)
- `/app/website/app/admin/bridge/page.tsx` (imports suggestion card from new location)
- `/app/website/lib/george-api.ts` (new)
- `/app/website/lib/mcgs-api.ts` (added `outcome` to EventApprovalResult)

Docs:
- `/app/memory/mcgs-architecture.md` (principle #13, three new decision-log rows)
- `/app/memory/george-platform.md` (new — canonical platform contract)

## Notes for the tester
- Sonnet + Haiku round-trips 5–20s. Allow up to 60s per George reply.
- Two composer buttons: `Start with George` (first send) and `Send` (subsequent).
- Confirm & Create button aria-label: `"Confirm and create the event"`.
- Butterfly aria-label: `"Talk to George — tap to open"`.
- The pre-existing `🎙️` mic button in the top `AskGeorgeBar` also has `aria-label="Talk to George"` — use the specific label above to target the butterfly.
- If the arrival didn't fire on your run, either the admin's actor id is missing from the shell or the localStorage gate has already been used today. To force it: `localStorage.removeItem("george.lastArrival.<actorId>")` then reload.
- Rhythms Phase 2 regression sweep is NOT in scope for this iteration.
