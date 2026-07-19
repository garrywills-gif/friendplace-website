# MCGS Phase 2 — Rhythms

**Baseline:** Phase 1 v1.0 (see `/app/memory/phase1-baseline-v1.0.md`)
**Approved by Garry:** 19 July 2026 ("Everything looks excellent. Please begin Phase 2.")
**Goal:** Make George feel like a colleague who starts, punctuates, and closes each day with you — not a scheduled reporting engine.

---

## Guiding line

> George should reduce cognitive load, not increase it. **Silence is a feature.**

Every Rhythm ships only if it helps Garry think less while staying better informed. If it just adds noise, it doesn't ship.

## What Phase 2 delivers

### 1. Morning Briefing

**Timing** (admin-configurable; defaults locked with Garry):
- Weekdays: **07:00** Australia/Melbourne
- Weekends: **08:30** Australia/Melbourne

**Structure** (locked — never rearranged):
```
🦋 [Rotating opener], Garry. Here's your [day] briefing.

What changed overnight
   • …grounded facts…

What needs your attention
   • …grounded, prioritised, with recommended starting point…

What can wait
   • …grounded, reassuring…

Where I'd start
   • one specific, human suggestion

— George
```

**Rotating openers** — small warm library, no opener repeats within 7 days:
1. *"Good morning, Garry. Hope you had a good evening."*
2. *"Good morning, Garry. Hope you're doing well."*
3. *"Morning, Garry. Ready for another day?"*
4. *"Morning, Garry. It's a fresh one."*
5. *"Good morning, Garry. Nice and quiet overnight."* *(only used when overnight was actually quiet)*
6. *"Good morning, Garry."* *(the plain one — used at least once a week so nothing feels performative)*

Rotation is deterministic (hash of `date + admin_id % library_size`) with a "recent openers" guard so we never repeat within 7 days.

**Delivery** (matrix — same content, no duplication):
- Bridge: pinned card until acknowledged. **Source of truth.**
- Email (Resend): only if Bridge card hasn't been marked seen at delivery time.
- Push (Emergent push key): if notifications enabled and Bridge not yet seen.

### 2. Midday Pulse (exception-based, silent by default)

Evaluated at **12:30** AEST (admin-configurable). Fires *only* if something meaningful has changed since the Morning Briefing:
- New P0 or P1 Signal
- Approvals queue crosses threshold (default 5)
- A Milestone Signal has landed
- Anomaly detector at High confidence

**Delivery**: Bridge first. Push *only* if genuinely important. **No routine emails.** Silence is a feature.

### 3. End-of-Day Wrap-up (considerate, not scheduled)

Target: **18:00** AEST weekdays.

**Considerate rules** (this is the big one):
- If Garry is still actively using MCGS at 18:00, **do not interrupt.**
- Wait until he's been inactive for **~30 min**, then deliver.
- If he stays active into the evening, **skip entirely** — silence beats interruption.
- Inactivity signal = no MCGS API calls from Garry's session in the trailing window.

**Structure**:
```
Before you go — here's your day.

   • things approved / decided / cleared today (grounded)
   • community moments worth naming (grounded, people over numbers)
   • anything left for tomorrow

Sleep well. I'll keep watch overnight.
```

**Delivery**: Bridge + optional email (admin toggle). No push unless urgent or explicitly enabled.

### 4. Milestone Recognition (NEW — quiet, ambient)

Milestones are moments worth naming, not events to celebrate. George watches for meaningful thresholds and folds them into whichever Rhythm is next, or surfaces them inline on the Bridge.

**Tracked (v1)**:
- First organisation to reach 100 events.
- Total members cross a round threshold: 100, 500, 1k, 5k, 10k, 50k, 100k.
- Total friendships cross a round threshold: 100, 1k, 10k, 100k.
- Every open support ticket cleared (first time in ≥7 days).
- No safeguarding incidents for 30 consecutive days.

**Delivery pattern**:
- Landed as a `Milestone` Signal, priority P3, `category=Milestone`.
- Rendered inline on the Bridge with quiet styling.
- Woven into the next Morning Briefing or EOD Wrap-up: *"Before we finish today… I thought you'd like to know we've just welcomed our 1,000th member. That's a lovely milestone."*
- **Idempotent** by `(milestone_key, period)` — a threshold is only recognised once.
- **Never** celebrated during a safety-sensitive window (open P0 safety Signal in the last 24h → skip until safe).

### 5. Weekly Review / Monthly Retro
Deferred to Phase 8 in the architecture doc — not implemented in Phase 2.

## Design principles carried over from Phase 1

All Phase 1 locks apply verbatim to every Rhythm:
- **Grounded only.** Every fact traces to a tool result. If a value can't be grounded, George says so warmly.
- **Warm colleague voice.** Never a database read-out.
- **Confidence as labels.** High / Moderate / Low, never percentages.
- **Emotional continuity.** Tone respects the arc of the day.
- **Celebrate people, not numbers.**
- **Graceful failure.** If a Rhythm can't compute, it says so warmly and offers what it does know.
- **Reduce cognitive load.** If a Rhythm becomes noisy, it gets tightened or paused.
- **Long-term familiarity.** George becomes more familiar over time without becoming casual. Familiarity accrues from shared history, never from cheekiness.

## Architecture additions

- New collection `mcgs_briefings` — one row per Rhythm output.
  - Fields: `_id`, `rhythm_type` (morning|midday|eod|milestone), `admin_id`, `scheduled_for`, `delivered_at`, `channels_delivered` (bridge/email/push), `content_markdown`, `content_html`, `opener_used`, `grounded_sources` (list of tool calls used), `bridge_seen_at`, `bridge_acknowledged_at`, `status` (queued|delivered|seen|acknowledged|skipped), `skip_reason` (if skipped), `date_key` (YYYY-MM-DD for idempotency).
  - Unique index on `(admin_id, rhythm_type, date_key)` → idempotent.
- New collection `mcgs_milestones_awarded` — records recognised milestones.
  - Fields: `_id`, `milestone_key`, `period_key`, `value_at_award`, `awarded_at`, `signal_id`, `folded_into_briefing_id`.
  - Unique index on `(milestone_key, period_key)`.
- New collection `mcgs_admin_activity` — heartbeat of admin activity for EOD deferral logic.
  - Fields: `admin_id`, `last_seen_at`, `last_route`, `session_started_at`. Updated on every authenticated MCGS API call.
- New collection `mcgs_rhythm_settings` — per-admin schedule + channel preferences.
  - Fields: `admin_id`, `timezone` (default `Australia/Melbourne`), `morning_weekday_at` (default `07:00`), `morning_weekend_at` (default `08:30`), `midday_at` (default `12:30`), `eod_at` (default `18:00`), `email_channel_enabled` (default true), `push_channel_enabled` (default true), `eod_email_enabled` (default true), `midday_push_enabled` (default true), `quiet_hours_start`, `quiet_hours_end`, `vacation_mode` (bool), `updated_at`.
- New service `services/mcgs/rhythms/` package:
  - `composer.py` — builds each Rhythm from George tools (grounded).
  - `openers.py` — the warm-opener library + deterministic rotation.
  - `milestones.py` — milestone detection.
  - `delivery.py` — channel delivery + dedup rules.
  - `scheduler.py` — APScheduler wiring; per-admin timezone-aware cron.
- New settings surface: `GET/PUT /api/mcgs/rhythms/settings`.
- New Bridge card component surfacing the current Rhythm output with acknowledgement.
- Email template via Resend — same content, no different-version divergence.
- Prompt-injection regression suite still passes 12/12 (no changes to safeguards).

## Non-goals for Phase 2

- No new modules or dashboards.
- No new integrations beyond APScheduler for cron and Resend for email (already wired in Phase 1 backlog).
- No interruptible speech (Phase 3+).
- No Weekly Review / Monthly Retro yet — deferred.
- No SMS.

## Milestones (implementation order)

**Milestone A — Data layer + settings**
- Create the 4 new collections + indexes.
- Implement `GET/PUT /api/mcgs/rhythms/settings` with defaults.
- Admin activity heartbeat middleware.

**Milestone B — Morning Briefing composer + Bridge delivery**
- `composer.morning()` grounded on existing George tools.
- Rotating openers with 7-day repeat guard.
- Bridge card component + `GET /api/mcgs/rhythms/today`.
- Idempotent by `(admin_id, morning, date_key)`.

**Milestone C — Scheduler + email + push channels**
- APScheduler wiring in `server.py` startup.
- Per-admin timezone-aware cron.
- Resend email template (only if Bridge not yet seen).
- Push channel (Emergent push key) — if enabled and Bridge not yet seen.

**Milestone D — Midday Pulse (exception-based)**
- `composer.midday()` with material-change gate.
- Silent by default. Push only if genuinely important.

**Milestone E — End-of-Day Wrap-up + inactivity deferral**
- `composer.eod()`.
- Inactivity-aware delivery: defer while active, wait 30 min inactive, skip if still active into evening.

**Milestone F — Milestone Recognition**
- `milestones.py` scanner (runs on a light interval + on Signal ingestion).
- Awarded once via `mcgs_milestones_awarded` idempotency.
- Folded into the next Morning/EOD Rhythm ("Before we finish today…").

**Milestone G — Regression + prompt-injection guard**
- Re-run `test_prompt_injection.py` (must still pass 12/12).
- New tests for idempotency, dedup across channels, inactivity deferral, opener rotation.

## Success criteria for Phase 2

1. Every morning at 07:00 AEST (or 08:30 weekends), Garry receives a warm Morning Briefing on the Bridge. Same content re-uses on email/push only if Bridge unread. Delivery within ±60s of the target time.
2. Openers rotate. No opener repeats within 7 days. Structure never changes.
3. Every fact traces to a tool call recorded in `mcgs_activity_log`.
4. Midday Pulse fires only when exception rules are met. On a calm afternoon, no push, no email.
5. EOD Wrap-up lands considerately — defers while Garry is active, waits 30 min inactive, skips if he stays active into the evening.
6. Milestone Recognition surfaces quietly, is idempotent, and is folded into the next Rhythm.
7. `python /app/backend/tests/mcgs/test_prompt_injection.py` still passes 12/12.
8. Idempotent — if the backend restarts mid-morning, the day's briefing isn't re-sent.
9. Vacation mode holds P1/P2/P3/P4 for the next Morning Briefing and only interrupts on P0.
10. Timezone, schedule, and channel preferences are admin-editable from day one.
