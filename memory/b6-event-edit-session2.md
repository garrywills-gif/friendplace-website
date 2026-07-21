# B6 — Conversational event editing (Session 2)

**Session 2 shipped, 25 Jul 2026.**

## What Session 2 adds

George now understands and performs event edits inside the normal
conversation loop. No new API endpoints; Session 2 wires the Session 1
service layer (`event_edit.py`) into `take_conversation_turn` in
`event_creation/service.py` via a new module `event_edit_flow.py`.

## The Rules (locked with Garry, 25 Jul 2026)

**Apply immediately (low risk):**
- description, notes, title, emoji, price, audience, duration

**Ask to confirm (high risk):**
- date, time, location, capacity, visibility, cancel, restore
- Also: any update touching 3+ fields at once

**Undo:** applied immediately (it's a "put it back", not a new mutation).

## How a turn is now processed

```
POST /api/mcgs/george/event/session/{sid}/turn { text: "move Coffee to 3pm" }
    ↓
take_conversation_turn(...)
    ↓
    if edit_flow.step == "awaiting_confirm":
        handle_awaiting_confirm(...)     # interpret yes/no
        → applied | declined | (fallthrough on ambiguous)
    elif edit_flow.step == "clarifying":
        handle_clarifying(...)           # resolve "which event?"
    else:
        try_handle_edit_intent(...)      # Haiku intent classifier
        → applied | awaiting_confirm | disambiguate | needs_details
                  | (None → normal composer)
    ↓
    if handled: save session (turns + edit_flow) and return
    else: fall through to Sonnet composer (unchanged)
```

## Session state additions

The `george_event_conversations` collection now carries an optional
`edit_flow` sub-object on each session:

```json
{
  "edit_flow": {
    "active": true,
    "step": "idle" | "clarifying" | "awaiting_confirm",
    "action": "update" | "cancel" | "restore" | "undo" | null,
    "target_event_id": "uuid",
    "target_event_title": "Coffee Catch-Up",
    "pending_changes": { "time": "15:00" },
    "candidates": [ { "id": "...", "title": "..." } ],
    "last_audit_id": "uuid",
    "last_summary": "Alex updated the time on Coffee Catch-Up with George",
    "updated_at": "ISO"
  }
}
```

Mid-edit resume is a first-class feature: if a member closes the app
mid-confirmation, `edit_flow.step` stays as `awaiting_confirm` and their
next reply (a yes/no or a new command) is interpreted correctly.

## The `edit` metadata George turns now carry

Every George turn produced by the edit flow includes an `edit` block
for Session 3's UI:

```json
"edit": {
  "kind": "edit_awaiting_confirm" | "edit_applied" | "edit_declined"
        | "edit_disambiguate"     | "edit_needs_details"
        | "edit_undo_needs_target"| "edit_error",
  "action": "update" | "cancel" | "restore" | "undo",
  "pending_changes": { "field": "new_value", ... },
  "applied":         { "field": "new_value", ... },
  "proposal":        { "summary": "...", "action": "update", "changes": {...} },
  "event":           { "id", "title", "date", "time", "location" },
  "candidates":      [ { "id", "title" } ],
  "audit":           { "id", "summary", "severity", "action" }
}
```

## Ambiguity safety

If a member replies to a confirmation prompt with something that
doesn't clearly parse as yes/no (e.g. "hmm not sure"), the pending
change is NOT discarded. `edit_flow.step = "awaiting_confirm"` stays,
and the Sonnet composer takes the turn so George can gently re-ask.

## Files

- `services/george/event_edit_flow.py` (new, ~750 lines)
- `services/george/event_creation/service.py` (`take_conversation_turn` extended)
- `services/george/event_edit.py` (`capacity` added to `SIGNIFICANT_FIELDS`)

## What's next (Session 3 — UI polish)

- `<EventChangeSummaryCard>` component that renders `edit.proposal`.
- Confirmation chip pattern below `edit_awaiting_confirm` turns:
  *Yes, confirm* / *Keep as is*.
- "Edit with George" entry point on organiser event cards.
- Applied indicator in the George bubble for `edit_applied`.

## Verified via smoke test (this session)

`/tmp/b6_session2_smoke.py` covers 5 scenarios end-to-end through the
turn endpoint: low-risk applied immediately, high-risk confirmed, high-risk
declined, cancel-then-decline, undo. All pass against a real Alex event.
