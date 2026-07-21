# B6 Session 3 — Conversational Event Edit UI

## Change since Session 2
B6 Session 3 ships the **frontend polish** that renders and interacts
with the edit metadata George's turns now carry:

- **`<EventChangeSummaryCard>`** — new component rendered beneath any
  George bubble whose turn has `edit`. It supports:
  - **Compact chip pair** for single-field edits (e.g. `TIME 2pm → 3pm`
    with `Confirm` / `Keep as is`).
  - **Full card** for 2+ field edits (per-field OLD → NEW rows).
  - **Applied "done" state** — muted card with a green checkmark,
    field diffs still visible, plus...
  - **Undo chip with 30-second countdown** — taps send "undo that"
    through the George turn endpoint (the classifier + service
    handles the revert).
  - **Cancel confirmation** shown as a danger-styled "Yes, cancel it"
    button.
  - **Declined state** — a quiet muted "Left as it was" line.
- **"Ask George to edit this event"** row on `/events/edit/[id]`
  (organiser-only) opens George with a prefilled prompt.
- **`openGeorgeWithPrompt(text)`** added to `GeorgeContext` so any
  screen can hand a starter message to George — the composer receives
  the text and the member reviews before sending (review-first rule).
- **Backend enhancement**: `edit_applied` turns now carry a `before`
  snapshot alongside `applied`, so the UI can render accurate
  OLD → NEW diffs after the event has been mutated. Old smoke test
  still all-green: `pytest tests/test_b6_session2_edit_flow.py -v` = 9/9.

## Files touched / created
- `/app/frontend/src/components/george/EventChangeSummaryCard.tsx` (new, ~400 lines).
- `/app/frontend/src/components/george/GeorgeEventCreation.tsx` — imports the card, adds `onEditAction` handler (`confirm` → "yes please", `decline` → "no, keep as is", `undo` → "undo that"), consumes `pendingOpener` into the composer, and only makes chip actions interactive on the latest George turn.
- `/app/frontend/src/lib/george-context.tsx` — adds `openGeorgeWithPrompt`, `pendingOpener`, `consumePendingOpener`.
- `/app/frontend/src/lib/george-api.ts` — adds `edit?: EventEditMeta` to `EventTurn` plus `EventEditKind`, `EventEditAction`, `EventEditMeta` types (including the new `before` field).
- `/app/frontend/app/events/edit/[id].tsx` — new "Ask George to edit this event" row.
- `/app/backend/services/george/event_edit_flow.py` — `_before_from_audit()` helper; three `edit_applied` sites now pass `before`.

## What to test (frontend)

Log in on the mobile web preview as `member@friendplace.com.au` / `TestPass2026!`. Alex hosts a seeded "Coffee Catch-Up" event (id `62217b94-b6ee-45de-834c-912040e58dd3`).

### P0 — Session 3 UI
1. **Entry point exists**: navigate to `/events/edit/62217b94-b6ee-45de-834c-912040e58dd3`. Scroll — the "Ask George to edit this event" row (blue butterfly-bg tile) should appear above the Save/Cancel buttons.
2. **Entry point opens George with opener**: tap it. George should open (butterfly host modal) and the composer should be prefilled with `Help me edit my "Coffee Catch-Up" event` — the member can review before tapping Send.
3. **Compact card for a single-field high-risk edit**: type *"please change the time to 3pm"* → Send. Wait for George's reply (~5-10s). A card should appear underneath the bubble showing `TIME 2pm → 3pm` with `Confirm` and `Keep as is` buttons.
4. **Confirm applies + applied card + Undo chip**: tap `Confirm`. Composer shows "yes please" as the sent turn. George replies with `Done — I've updated the time on Coffee Catch-Up.` and a **muted APPLIED card** appears showing `TIME 2pm → 3pm` and an **Undo · 30s** chip that visibly counts down.
5. **Undo works**: within 30s, tap the Undo chip. George replies `Done — I've reverted the last change on Coffee Catch-Up.` and time reverts to 2pm on the event in Mongo. The applied card disappears from the latest turn.
6. **Historical cards become inert**: after scrolling back through the conversation, the older `TIME 2pm → 3pm` awaiting-confirm card's Confirm button should be visually disabled (opacity ~0.6) — historical only.
7. **Full card for a multi-field edit**: send *"please move Coffee Catch-Up to next Friday at 5pm at the Town Hall instead"*. The card should show all three fields (DATE / TIME / LOCATION) with each row struck-through OLD → downarrow → bold NEW.
8. **Decline preserves original**: send *"actually change the date to next Monday"*, then tap `Keep as is`. George says `No worries — I've left Coffee Catch-Up as it was.` and a quiet muted "Left as it was" line replaces the card.
9. **Cancel confirmation is danger-styled**: send *"cancel the Coffee Catch-Up event"*. The card should say "Cancel Coffee Catch-Up" with a red `Yes, cancel it` button. Tap `Keep as is` — event stays uncancelled in Mongo.
10. **Low-risk edit shows applied card only (no confirm)**: send *"please update the description to mention parking is limited"*. George should reply immediately with `Done — I've updated the description...` and an APPLIED card should appear (no confirm chip step). Undo chip still shows 30s.

### P1 — Regression
11. Normal event creation still works — start a new session (no opener), send *"I'd like to organise a book club on Friday at 6pm"*. No edit cards should render — the normal composer replies.
12. Companion chat unaffected — send *"hello George"*. No edit metadata / cards.

### Not for this session
- Disambiguation candidate chips (backend supports it via `edit.candidates` but the UI just falls through to typed replies for MVP).
- Native (iOS/Android) — Session 3 tests on the mobile web preview only. Native builds should be validated on a device.

## Credentials
- Mobile member: `member@friendplace.com.au` / `TestPass2026!` (Alex; hosts "Coffee Catch-Up" event `62217b94-b6ee-45de-834c-912040e58dd3`).

## Notes
- The chip actions (`Confirm` / `Keep as is` / `Undo`) fire "yes please" / "no, keep as is" / "undo that" through the normal event turn endpoint — the backend classifier short-circuits these on `_looks_like_confirm` word-boundary regex without hitting an LLM. Latency: ~200-500ms typical.
- The `before` snapshot on applied turns comes from the audit row's per-field `{old, new}` changes list — no extra Mongo read.
- The Undo chip is a client-only countdown; the actual undo works whenever, but the chip disappears at 0s. Members can always type "undo that" to trigger it.
