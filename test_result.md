# MCGS Phase 2 — E2E regression sweep (v1.1 freeze)

## Original problem statement
Build the Mission Control George System (MCGS) — an operations centre for FriendPlace with grounded AI assistant George, live Signal Feed, Action Preview pattern, and Rhythms (Morning Briefing / Midday Pulse / End-of-Day Wrap-up / Milestone Recognition).

## Testing scope for this sweep — BACKEND ONLY
Phase 2 (Rhythms) is feature-complete. This sweep is the freeze-baseline regression before signing v1.1. Confirm Phase 1 still passes and Phase 2 works end-to-end.

## Existing test credentials
- CMS admin: `hello@friendplace.com.au` / `TestPass2026!` (see `/app/memory/test_credentials.md`)
- Backend URL: `http://localhost:8001`
- All `/api/mcgs/*` routes require `Authorization: Bearer <token>` obtained from `POST /api/cms/auth/login` (response has `token` and `admin` fields).

## What to test (each is a separate pass/fail)

### A. Phase 1 regression (must still pass)
1. Login and receive a bearer token from `POST /api/cms/auth/login`.
2. `GET /api/mcgs/signals/counts` returns 200 with numeric counts by priority.
3. `GET /api/mcgs/signals?priority=P0` returns 200 and array shape.
4. `GET /api/mcgs/cases` returns 200.
5. Prompt-injection regression: `cd /app/backend && python3 tests/mcgs/test_prompt_injection.py` — must PASS 12/12 on classifier AND 12/12 on George behaviour.

### B. Rhythm settings
6. `GET /api/mcgs/rhythms/settings` returns merged defaults (timezone `Australia/Melbourne`, morning weekday `07:00`, weekend `08:30`, midday `12:30`, eod `18:00`, `eod_inactivity_wait_minutes: 30`, channel bools true, `vacation_mode: false`).
7. `PUT /api/mcgs/rhythms/settings` with `{"morning_weekday_at":"07:15"}` returns 200 with the merged patch. Invalid time (`"7am"`) returns 400.
8. After PUT, `GET /api/mcgs/rhythms/scheduler` shows updated `next_run_at` for the morning weekday job.

### C. Morning Briefing
9. `POST /api/mcgs/rhythms/morning/compose?force=true` returns a briefing with `content_json.opener_line`, `content_json.recommendation`, `content_json.recommendation_heading`, `content_markdown`, and `grounded_sources.local_now` non-null.
10. Second call *without* `force` returns the SAME briefing id (idempotent per (admin, morning, date)).
11. `GET /api/mcgs/rhythms/today` includes today's morning briefing.
12. `POST /api/mcgs/rhythms/briefings/{id}/seen` sets `bridge_seen_at`. Second call is a safe no-op.
13. `POST /api/mcgs/rhythms/briefings/{id}/acknowledge` sets `bridge_acknowledged_at`.

### D. Midday Pulse (silent by default)
14. `POST /api/mcgs/rhythms/midday/evaluate?force=true` with no material change since morning returns `{"status":"skipped","skip_reason":"no_material_change",...}` — nothing persisted.
15. After inserting a P1 signal directly into MongoDB (`db.mcgs_signals`) with `created_at` AFTER today's morning briefing `delivered_at`, force-evaluate again — the pulse should FIRE and persist a row with `content_json.heading` (rotating), `content_json.opener_line`, `content_json.recommendation`, `content_json.recommendation_heading`. (Clean up the test signal at the end.)

### E. End-of-Day Wrap-up
16. `POST /api/mcgs/rhythms/eod/compose?force=true` returns a briefing with `content_json.opener_line`, `content_json.today_line`, `content_json.sign_off_line`, and `opener_used` set (rotating).
17. `unresolved_carryover` is stored at the top level.
18. Morning briefing (force-recomposed) picks up `unresolved_carryover` — the composer should include it in `content_json.continuity_line` if present, or acknowledge it grounded.

### F. Delivery + dedup policy
19. `POST /api/mcgs/rhythms/morning/deliver` when `bridge_seen_at` is NULL should deliver email (Resend `is_configured()` returns True) → `channels.email == "delivered"`, and push → either `"delivered"` or `"skipped_no_linked_mobile_user"` (both acceptable).
20. With `bridge_seen_at` set, delivery returns `channels.email == "skipped_seen_on_bridge"` AND `channels.push == "skipped_seen_on_bridge"`.
21. `POST /api/mcgs/rhythms/midday/deliver` for a fired pulse returns `channels.email == "not_in_policy"` (Garry's rule — no routine midday emails).

### G. Milestone Recognition
22. `POST /api/mcgs/rhythms/milestones/scan` returns `{"paused":..., "awarded":[...], "count":N}` without raising. If any milestones were previously awarded (e.g. safeguarding 30-day streak), the count should be 0 on the second call (idempotency).
23. Awarded milestones appear in `db.mcgs_signals` with `category=milestone` and `priority=P3`.
24. `db.mcgs_milestones_awarded` has a unique index enforced on `(milestone_key, period_key)`.

### H. Scheduler
25. `GET /api/mcgs/rhythms/scheduler` returns `running: true` with jobs for `morning-weekday`, `morning-weekend`, `midday`, `eod`, and `milestones.scan`.
26. Each per-admin job's `next_run_at` respects the admin's timezone.

## Do NOT test
- Frontend UI (that's covered by manual screenshots).
- Anything outside `/api/mcgs/*` endpoints.

## Cleanup
- Delete any test signals inserted (producer=`test`).
- Do NOT delete real milestone signals or briefings.

## Expected outcome
All 26 checks PASS. Log any failure with a suggested fix.
