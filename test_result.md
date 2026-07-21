# B7 — George Remembers (MVP)

## What shipped
- **Persistent inbox** (`george_remembers` Mongo collection) that queues:
  - **`pre_event`** — organiser-only, fires ~18 h before the event start.
  - **`post_event`** — organiser-only, fires ~2 h after the event's estimated end (start + 4 h).
- **Sweep loop** (`services/george/remembers.py::sweep_loop`) runs every 5 minutes with a 15 s startup delay. Idempotent: it never inserts a duplicate active row for the same `(event_id, kind)`.
- **Reschedule handling** — when an event's date/time changes, still-scheduled rows are superseded and fresh rows inserted for the new time. Delivered rows (already-seen) are left alone unless the shift is > 6 h.
- **Cancellation handling** — events with `cancelled: True` produce no rows; a second sweep pass cancels any orphaned scheduled rows whose event was removed. The inbox endpoint also does a belt-and-braces per-fetch re-verification so a cancelled event never surfaces even if the sweep hasn't run yet.
- **Inactive account handling** — sweep skips inactive/deleted organisers.
- **Timezone-aware** — all wall-clock event date+time interpreted as `Australia/Sydney`; storage is UTC ISO8601.
- **Home banner** (`GeorgeRemembersBanner`) — quiet, warm card that fetches on home focus, plays TTS via `SpeakButton`, cycles through multiple messages, and supports dismiss. Renders `null` when empty (no home layout disruption).

## API surface
- `GET  /api/mcgs/george/remembers/inbox` → `{ items: RemembersMessage[] }`. Upgrades due `scheduled` rows to `delivered` on read.
- `POST /api/mcgs/george/remembers/{msg_id}/dismiss` → 404 if not this user's row.
- `POST /api/mcgs/george/remembers/{msg_id}/seen` — idempotent viewport beacon (never 404s).

## Files touched / created
- `/app/backend/services/george/remembers.py` (new, ~450 lines) — sweep, delivery, inbox helpers, templates.
- `/app/backend/mcgs_module.py` — 3 new endpoints under `/mcgs/george/remembers/*`.
- `/app/backend/server.py` — startup hook wires `ensure_indexes` + `sweep_loop` as a background task.
- `/app/frontend/src/components/george/GeorgeRemembersBanner.tsx` (new) — home banner.
- `/app/frontend/src/lib/george-api.ts` — `remembersInbox` / `remembersDismiss` / `remembersSeen` methods + `RemembersMessage` type.
- `/app/frontend/app/(tabs)/home.tsx` — banner slotted below `FirstRunCard`.
- `/tmp/b7_remembers_smoke.py` — sweep-level smoke test (5 scenarios, ALL PASS).

## Message templates (deterministic, no LLM cost)
- Pre-event: *"Your {title} is tomorrow, {first_name}. I hope everyone has a lovely time."*
- Post-event: *"How did {title} go, {first_name}? I hope you had a lovely {morning|afternoon|evening}."* — time-of-day derived from the event's local start hour.

## What to test (backend + frontend)

### P0 — Backend (queue + delivery)
Use `member@friendplace.com.au` / `TestPass2026!` (Alex, id `d8ef0bc1-1dfe-44d8-aa8b-46a0ad68e0ba`).

1. **Sweep creates rows for a future event** — insert an event `18h + 1h = 19h` from now (so pre_event = 1h from now). Call `POST /api/mcgs/george/remembers/inbox` before the sweep — should be empty. Run the sweep (either wait 5 min or `python -c "from services.george.remembers import sweep_once; ..."`). Now the row exists in Mongo with `status='scheduled'`.
2. **Idempotency** — running the sweep twice results in `created=0` on the second pass.
3. **Rescheduling** — after step 1, update the event to a different time. Next sweep marks the old row `status='superseded'` and inserts a fresh row aligned to the new time.
4. **Cancellation** — set `cancelled: True` on an event with a scheduled row. Next sweep marks the row `status='cancelled'` with `cancelled_reason='event_removed'`.
5. **Inactive user** — set `is_active: False` on an organiser. Sweep skips them (`skipped_inactive_user` count increments; no rows inserted).
6. **TZ handling** — events with time in Sydney local should compute `scheduled_for` in UTC correctly (18h before local start).

### P0 — Inbox + Dismiss (HTTP)
7. **Due rows are delivered on read** — a `scheduled` row whose `scheduled_for` is in the past is returned by the inbox and upgraded to `delivered` in the same call.
8. **Delivered rows persist across restarts** — after step 7, restart the backend (`sudo supervisorctl restart backend`) and re-fetch the inbox. The row should still be in the list with `status='delivered'`.
9. **Dismiss removes the row from inbox** — `POST /remembers/{id}/dismiss` → row transitions to `status='dismissed'` and no longer appears in `/inbox`.
10. **Cancelled event is filtered from inbox** — even if a `delivered` row exists, if its event is now `cancelled: True`, the inbox endpoint filters it out (belt-and-braces).
11. **Wrong user can't dismiss** — dismissing another user's row returns 404.
12. **Regression: `/mcgs/george/presence` and event edit endpoints untouched** — Session 2 tests should still pass (`pytest tests/test_b6_session2_edit_flow.py` = 9/9).

### P0 — Frontend banner
13. **Empty state renders nothing** — no rows → home shows nothing extra (no visible banner).
14. **Card renders** — with a delivered row, the banner appears below `FirstRunCard` with:
    - Green butterfly icon + "GEORGE REMEMBERS" label
    - Message text ("Your ... is tomorrow, Alex. I hope everyone has a lovely time.")
    - Speaker button + dismiss (×) button
15. **Dismiss works** — tap ×, card disappears optimistically. Refresh page → still gone.
16. **Multiple messages cycle** — with 2+ rows, a "1 of N" pill appears with prev/next chevron buttons. Nav cycles between them.
17. **Speaker button plays TTS** — tap speaker icon, audio plays (uses existing `SpeakButton` — no B7 change).

## Test credentials
- Mobile member: `member@friendplace.com.au` / `TestPass2026!`
- Mission Control admin: `hello@friendplace.com.au` / `TestPass2026!`

## Helpers for testers
- Reset test state:
```python
import asyncio, os
from motor.motor_asyncio import AsyncIOMotorClient
async def main():
    c = AsyncIOMotorClient(os.environ.get('MONGO_URL','mongodb://localhost:27017'))
    db = c['test_database']
    alex = await db.users.find_one({'username': 'member_first'})
    await db.events.delete_many({'host_id': alex['id'], 'title': {'$regex': '^DEMO_'}})
    await db.george_remembers.delete_many({'recipient_id': alex['id']})
asyncio.run(main())
```
- Seed a due `pre_event` row: run `/tmp/b7_remembers_smoke.py` first (creates SMOKE_ events), then adapt for DEMO_ events kept for manual UI testing.
- Force a sweep pass without waiting for the 5-minute loop:
```python
import asyncio, sys
sys.path.insert(0, "/app/backend")
from motor.motor_asyncio import AsyncIOMotorClient
from services.george import remembers
async def main():
    c = AsyncIOMotorClient(os.environ.get("MONGO_URL","mongodb://localhost:27017"))
    await remembers.sweep_once(c["test_database"])
asyncio.run(main())
```

## Not in this MVP
- Push notifications (needs the emergent-managed push integration + deploy)
- Attendee-facing messages (organiser-only for MVP)
- "How did it go?" follow-ups with notes/photo workflows
- Remembered-change nudge (would repeat what George already confirms at edit-time)
- Per-community timezone (Aus fixed for now)
