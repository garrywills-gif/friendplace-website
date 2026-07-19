# MCGS Phase 2 — Rhythms

**Baseline:** Phase 1 v1.0 (see `/app/memory/phase1-baseline-v1.0.md`)
**Goal:** Make George feel like a colleague who starts, punctuates, and closes each day with you — not a scheduled reporting engine.

---

## Guiding line

> George should reduce cognitive load, not increase it.

Every Rhythm ships only if it helps Garry think less while staying better informed. If it just adds noise, it doesn't ship.

## What Phase 2 delivers

### 1. Morning Briefing (07:00 AEST weekdays, 08:30 weekends)
The signature feature. Not a report — a conversation.

Structure George writes to (locked template, but wording is his):
```
Good morning, Garry. Hope you had a good evening.

What changed overnight
   • …grounded facts…

What needs your attention
   • …grounded, prioritised, with recommended starting point…

What can wait
   • …grounded, reassuring…

Where I'd start
   • one specific, human suggestion
```

Delivery: email (Resend), phone push (Emergent push key), Bridge card pinned until acknowledged.

### 2. Midday Pulse (opt-in, exception-based)
Evaluated at 15:30 AEST. Fires *only* if something meaningful has changed since the Morning Briefing:
- New P0 or P1 Signal
- Approvals queue crosses threshold (default 5)
- A Milestone Signal
- Anomaly detector at High confidence

Silent by default. Respects Garry's day.

### 3. End-of-Day Wrap-up (18:00 AEST weekdays)
Skips if Garry is still actively in MCGS. Structure:

```
Before you go — here's your day.

   • …things approved / decided / cleared today (grounded)…
   • …the community moments worth naming (grounded, people over numbers)…
   • …anything left for tomorrow…

Sleep well. I'll keep watch overnight.
```

### 4. Weekly Review (Sunday 18:00 AEST)
Health rings trend + wins + concerns + 3 suggested actions.

### 5. Monthly Retro (1st of month 09:00 AEST)
Cohort retention, revenue signals once FriendPlace+ ships, "state of the community" narrative.

## Non-goals for Phase 2

- No new modules or dashboards.
- No new integrations beyond APScheduler for cron.
- No interruptible speech (Phase 3+).
- Rhythms do not add new sidebar entries — every Rhythm output lands as a Signal in the existing Feed AND as its dedicated card at the top of the Bridge.

## Design principles carried over from Phase 1

All Phase 1 locks apply verbatim to every Rhythm:
- **Grounded only.** Every fact traces to a tool result.
- **Warm colleague voice.** Never a database read-out.
- **Confidence as labels.** High / Moderate / Low, never percentages.
- **Emotional continuity.** Tone respects the arc of the day.
- **Celebrate people, not numbers.**
- **Graceful failure.** If a Rhythm can't compute, it says so warmly and offers what it does know.
- **Reduce cognitive load.** If a Rhythm becomes noisy, it gets tightened or paused. The North Star is *fewer thoughts to hold in Garry's head*, not more.

## Architecture additions

- New collection `mcgs_briefings` — one row per Rhythm output (idempotent, audit-ready)
- New service `services/mcgs/rhythms.py` — composer + delivery
- New scheduler in `server.py` startup: APScheduler configured with an Australia/Melbourne timezone-aware cron
- Health Pulse ring computation is deferred to Phase 3 — Rhythms don't wait for rings, they use the same tool allow-list George uses in Ask George

## Success criteria for Phase 2 (draft — awaiting Garry's approval)

1. Every morning at 07:00 AEST (or 08:30 weekends), Garry receives a warm Morning Briefing across email + push + Bridge card. Delivery within ±60s of the target time.
2. The briefing is grounded — every number traces to a tool call recorded in `mcgs_activity_log`.
3. It reads like a conversation, not a report. Colleague tone locked to Phase 1 baseline.
4. Midday Pulse fires only when the exception rules are met. On a calm afternoon, no push.
5. End-of-Day Wrap-up lands at 18:00 AEST weekdays unless Garry is active in MCGS.
6. `python /app/backend/tests/mcgs/test_prompt_injection.py` still passes 12/12. No regression on George's Phase 1 personality or safeguards.
7. Idempotent — if the backend restarts mid-morning, the day's briefing isn't re-sent.
8. Vacation mode holds P1/P2/P3/P4 for the next Morning Briefing and only interrupts on P0.
