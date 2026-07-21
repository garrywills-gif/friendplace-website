# B6 — Conversational event editing (Foundation)

**Session 1 shipped, 25 Jul 2026.**

## What's live

Backend service module at `/app/backend/services/george/event_edit.py` +
6 HTTP routes on `/api/mcgs/george/event_edit/*`:

| Route | Behaviour |
| --- | --- |
| `POST /match` | `{query, limit}` → candidate events the actor can edit. Only organisers see their own; admins see all. |
| `POST /apply` | `{event_id, changes, source}` → diffs vs current, writes audit row, returns `{event, audit}`. Only editable fields (`EDITABLE_FIELDS` in the service module) are respected. |
| `POST /cancel` | Soft-cancel. Writes significant-severity audit row. |
| `POST /restore` | Reverse of cancel. Writes significant-severity audit row. |
| `POST /undo` | Reverses the most recent non-undo audit row for the event. Undo of `update` re-writes reverse fields; undo of `cancel` calls restore; undo of `restore` calls cancel. Two-way `reverses_edit_id` / `reversed_by_edit_id` linkage is stamped. |
| `GET /history/{event_id}` | Newest-first audit trail for Mission Control + B7 memory. |

## Audit schema (`event_edits` collection)

Denormalised so Mission Control + B7 can render lines like
*"George helped Margaret update Book Club yesterday"* without joins.

```json
{
  "id": "uuid",
  "event_id": "uuid",
  "event_title_at_edit": "Book Club",
  "editor_id": "uuid",
  "editor_name": "Margaret",
  "editor_kind": "organiser" | "admin",
  "source": "george" | "event_ui" | "admin_ui" | "api",
  "severity": "minor" | "significant",
  "action": "update" | "cancel" | "restore" | "undo",
  "changes": [{"field": "date", "old": "...", "new": "..."}],
  "summary": "Margaret updated the date on Book Club with George",
  "created_at": "ISO",
  "reverses_edit_id": null | "uuid",
  "reversed_by_edit_id": null | "uuid"
}
```

## Severity taxonomy

* **Significant**: any change touching `date`, `time`, `location`,
  `cancelled`, or `visibility`. Also every `cancel` / `restore` action.
  Front-end will require explicit confirmation chips like "Yes, move
  to Fri 26 Jul".
* **Minor**: everything else (title tweak, description, capacity,
  emoji, notes). Front-end will show a single "Save" chip.

## What's next (Session 2)

* Extend the George system prompt (`/app/backend/services/george/event_creation/service.py`)
  to detect **edit intent** alongside its existing create/navigate intents.
* Wire `match` / `apply` / `cancel` / `restore` / `undo` as LLM
  tools inside the SSE loop.
* Add resume-mid-edit via the existing `george_conversations`
  `status: 'paused'` mechanism.

## Verified via curl (this session)

Every path listed above was smoke-tested against a real event with
`member@friendplace.com.au`. Severity classification, warm summary
lines, two-way undo linkage, and 400 on double-cancel all confirmed.
