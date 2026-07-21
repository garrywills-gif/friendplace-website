# B6 Session 2 — Conversational Event Editing (Wired into George's SSE turn)

## Change since last iteration
- **Milestone B6 Session 2 shipped** — George now understands and performs event edits inside the normal event conversation loop.
  - Low-risk edits (description, notes, title, emoji, price, audience, duration) are applied **immediately** and George replies warmly ("Done — I've updated the description on Coffee Catch-Up.").
  - High-risk edits (date, time, location, capacity, visibility, cancel/restore) ALWAYS require confirmation. George shows a short change summary and asks: *"Just to confirm, you'd like me to change the time from 2pm to 3pm on Coffee Catch-Up?"*. A yes/no reply from the member is interpreted and either applied or discarded.
  - Multi-field updates (3+ fields at once) are also confirmed regardless of risk.
  - Undo is treated as low-risk (it's a "put it back"): applied immediately.
  - **Mid-edit resume**: the confirmation state is stored on the conversation session (`edit_flow.step: 'awaiting_confirm'`), so if the member drops off and comes back, their next reply is still interpreted as the confirmation.
  - **Ambiguity is safe**: if the confirm-or-deny reply is unclear ("hmm not sure"), the pending edit is preserved and the normal composer picks up so George can gently re-ask.
- **`capacity` is now a significant field** in `event_edits.py` — capacity changes now always require confirmation per Garry's Session 2 rules.

## Files touched
- `/app/backend/services/george/event_edit.py` — added `capacity` to `SIGNIFICANT_FIELDS`.
- `/app/backend/services/george/event_edit_flow.py` — **new module**. Haiku-backed intent classifier + confirmation flow + service calls into the existing match/apply/cancel/undo layer. Also owns the warm George copy for edit outcomes.
- `/app/backend/services/george/event_creation/service.py` — `take_conversation_turn` now offers each turn to the edit-flow hooks BEFORE the normal creation composer runs. Three hooks in priority order:
    1. `handle_awaiting_confirm` — interpret a yes/no reply to a pending high-risk change.
    2. `handle_clarifying` — resolve a "which event did you mean?" reply.
    3. `try_handle_edit_intent` — classify a fresh edit intent (Haiku) and either apply / confirm / disambiguate.
  If any hook handles the turn, the session's `edit_flow` sub-state is persisted and the composer is skipped.
- No new API endpoints — Session 2 wires into the existing `/api/mcgs/george/event/session/{sid}/turn` endpoint.

## How the George turn payload changed
The George turn dict now optionally carries an `edit` object so Session 3 UI can render change summary cards and confirmation chips:

```json
"edit": {
  "kind": "edit_awaiting_confirm" | "edit_applied" | "edit_declined" | "edit_disambiguate" | "edit_needs_details" | "edit_undo_needs_target" | "edit_error",
  "action": "update" | "cancel" | "restore" | "undo",
  "pending_changes": { "time": "15:00", ... },
  "applied": { "description": "..." },
  "proposal": { "summary": "...", "action": "update", "changes": {...} },
  "event":   { "id": "...", "title": "...", "date": "...", "time": "...", "location": "..." },
  "candidates": [ { "id": "...", "title": "..." } ],
  "audit":   { "id": "...", "summary": "...", "severity": "significant" | "minor", "action": "update" }
}
```

Frontend Session 3 will use `edit.kind` to switch UI (chip pair vs applied indicator vs disambiguation list).

## What to test

### P0 — Backend / Conversation
**Preconditions:** log in as `member@friendplace.com.au` / `TestPass2026!`. There must be at least one event the member hosts (Alex has one seeded — "Coffee Catch-Up").

1. Start a George conversation (`POST /api/mcgs/george/event/start` with `{"text":"hello"}`), then send edit turns via `/api/mcgs/george/event/session/{sid}/turn`.
2. **LOW-RISK applies immediately** — send *"please update the description of my Coffee Catch-Up to mention that parking is limited"*. Last George turn should have `edit.kind = "edit_applied"` and content starting with *"Done — I've updated the description on Coffee Catch-Up."*
3. **HIGH-RISK requires confirmation** — send *"actually let's move the Coffee Catch-Up to 3pm instead"*. George's turn should have `edit.kind = "edit_awaiting_confirm"`, `edit.pending_changes.time = "15:00"`, and content like *"Just to confirm, you'd like me to change the time from 2pm to 3pm on Coffee Catch-Up?"* Session should persist `edit_flow.step = "awaiting_confirm"`.
4. **Confirmation via yes** — reply *"yes please"*. Turn kind should be `edit_applied`; event row's `time` should now be `15:00`; a new `event_edits` audit row should exist with `action=update, severity=significant`.
5. **Denial preserves original** — trigger a fresh high-risk edit (*"change the date to next Saturday"*), then reply *"no, keep it as is"*. Kind should be `edit_declined`. No mutation to the event.
6. **Cancel requires confirmation** — *"cancel the Coffee Catch-Up event"* → `edit_awaiting_confirm` with `action=cancel`. Reply *"no, actually don't"* → `edit_declined`; event NOT cancelled.
7. **Undo works** — send *"undo the last change please"*. Kind should be `edit_applied` with `action=undo`, and the previously applied field should be reverted. A new `event_edits` audit row with `action=undo` exists linked to the prior row (`reverses_edit_id` / `reversed_by_edit_id`).
8. **Multiple significant fields** — *"change the Coffee Catch-Up to next Friday at 4pm at the Town Hall"* should always ask to confirm.
9. **Mid-edit persistence** — after step 3 (awaiting confirm), GET `/api/mcgs/george/event/session/{sid}` should show `edit_flow.step = "awaiting_confirm"` and `edit_flow.pending_changes.time = "15:00"`. This survives a page refresh; the next `/turn` "yes" applies it.
10. **Ambiguous confirm reply** — after step 3, reply *"hmm not sure"*. `edit_flow.step` should STILL be `"awaiting_confirm"` (pending change preserved). George's next turn comes from the normal composer.

### P1 — Regression guard
11. Normal event **creation** still works (send *"I'd like to organise a bingo night on Friday"* on a fresh session — Sonnet composer handles it, no edit flow interference).
12. Sensitive/companion chat unchanged (say *"hello George, I'm having a difficult day"*).
13. Save-for-later / resume from B5 still work.

### Not in Session 2 (deferred to Session 3)
- `<EventChangeSummaryCard>` UI component
- Confirmation chip pattern in mobile UI
- "Edit with George" button on organiser event cards
- Frontend rendering of `edit.kind` in the George bubble

## Test credentials
- Mobile member: `member@friendplace.com.au` / `TestPass2026!` (Alex; has a seeded "Coffee Catch-Up" event).
- Mission Control admin: `hello@friendplace.com.au` / `TestPass2026!`.

## Notes for the tester
- The intent classifier (Haiku) is called on every turn — expect ~500ms extra latency per turn. This is acceptable for MVP.
- The classifier is aware of `session_has_draft_in_progress` — if the member is actively planning a new event, references like "change the time to 4pm" are interpreted as draft edits (composer), NOT edits to an existing event.
- All edit outcomes write immutable rows to `event_edits` (see B6 Session 1 foundation doc).
- Backend smoke test lives at `/tmp/b6_session2_smoke.py` (5 scenarios, all passing).
