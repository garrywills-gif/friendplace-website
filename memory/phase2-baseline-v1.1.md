# MCGS Phase 2 — v1.1 Baseline (frozen)

**Signed off:** Garry, 19 July 2026
**Status:** FROZEN. Rhythms are now feature-complete. Any change to their
scheduling, delivery, or composer prompts requires an explicit product-level
decision — not a routine implementation change.
**Purpose:** Regression baseline alongside v1.0 for all future MCGS work.

---

## 1. What shipped in Phase 2 (Rhythms)

- **Morning Briefing** — rotating 6-opener library, 7-day repeat guard, time-of-day-aware greeting, LOCAL_NOW passed to composer, "One thing that caught my eye" (`noticed_line`), adaptive `recommendation_heading` (rotating), concision guardrails (30–60s / <150 words), one-briefing-per-day rule enforced by unique index, continuity across days.

- **Midday Pulse** — silent by default. Material-change gate: new P0/P1, milestone landed, approvals queue crossed threshold, or high-confidence anomaly. Rotating conversational heading ("Since this morning…" / "A quick update" / "George checked in" / "One thing worth flagging" / "Just so you know…"). Optional `reassurance_line` when scope is narrow. Bridge + push (only if genuinely important). No routine emails.

- **End-of-Day Wrap-up** — considerate-deferral: fires every 15 minutes from `eod_at` through the 22:00 local cutoff. Delivers only when Garry has been inactive ≥ `eod_inactivity_wait_minutes` (default 30). Skips entirely if he stays active past cutoff. Rotating 6-opener library. Optional `acknowledgment_line` recognising completed work (grounded, never flattery). `open_line` stored top-level as `unresolved_carryover` — carried into tomorrow's Morning Briefing continuity.

- **Milestone Recognition** — ambient scanner runs every 30 minutes. Five detectors: member thresholds, friendship thresholds, first org to 100 events, weekly all-clear support queue, 30-day safeguarding streak. Idempotent by `(milestone_key, period_key)`. Safety-sensitive window pauses celebration entirely. Awards land as P3 `category=milestone` Signals, folded into next Rhythm's celebrated moments.

- **Rhythm settings surface** — per-admin, admin-configurable from day one (timezone, weekday/weekend morning times, midday, EOD, inactivity wait, channel enables, quiet hours, vacation mode).

- **APScheduler** — one process-singleton scheduler. Per-admin, timezone-aware cron jobs. `PUT /rhythms/settings` triggers reschedule live. `GET /rhythms/scheduler` returns job table snapshot.

- **Multi-channel delivery** with per-rhythm policy:
    - Morning = Bridge + email + push
    - Midday = Bridge + push (only if genuinely important)
    - EOD = Bridge + optional email
    - Milestone = Bridge only
  Same content across channels. Dedup rule: skip email/push if `bridge_seen_at` set.

- **Bridge — three emotional temperatures**: morning (teal) / midday (amber) / evening (dusk indigo). Silent surfaces stay silent. Rotating closing acknowledgements after "Got it, thanks".

## 2. Frozen files (do not edit without a product-level decision)

**Backend**
- `/app/backend/services/mcgs/rhythms/__init__.py`
- `/app/backend/services/mcgs/rhythms/models.py`
- `/app/backend/services/mcgs/rhythms/settings.py`
- `/app/backend/services/mcgs/rhythms/activity.py`
- `/app/backend/services/mcgs/rhythms/openers.py`
- `/app/backend/services/mcgs/rhythms/facts.py`
- `/app/backend/services/mcgs/rhythms/composer.py`  (Morning)
- `/app/backend/services/mcgs/rhythms/midday.py`
- `/app/backend/services/mcgs/rhythms/eod.py`
- `/app/backend/services/mcgs/rhythms/milestones.py`
- `/app/backend/services/mcgs/rhythms/delivery.py`
- `/app/backend/services/mcgs/rhythms/scheduler.py`

**Frontend**
- `/app/website/components/mcgs/MorningBriefing.tsx`
- `/app/website/components/mcgs/MiddayPulse.tsx`
- `/app/website/components/mcgs/EndOfDay.tsx`
- `/app/website/app/admin/bridge/page.tsx`  (Bridge layout)
- `/app/website/lib/mcgs-api.ts`  (`rhythmsApi`)

## 3. Locked design rules (Garry, 19 July 2026)

1. **Grounded only** — no invented counts, names, or trends.
2. **Silence is a feature** — silent surfaces stay silent.
3. **Same briefing across channels** — never generate different versions.
4. **Dedup by bridge_seen_at** — don't re-send what's been read.
5. **Considerate, not scheduled** — EOD defers while active, skips past cutoff.
6. **Continuity across days** — EOD sign-off + open_line seed tomorrow's morning.
7. **Celebrate humans not statistics** — "our thousandth member", never "1000 members".
8. **Never templated** — react to reality; skip empty sections.
9. **One briefing per day** — Ask George composing early counts as today's briefing.
10. **George feels present** — quietly looking after FriendPlace while Garry is away.

## 4. Regression suite

- **Prompt-injection classifier + behaviour**: 12/12 (unchanged from v1.0).
- **Backend rhythm smoke tests** (verified this session):
    - Settings CRUD with validation
    - Heartbeat + inactivity detection
    - Morning compose idempotent + force-recompose
    - Midday gate silent-by-default and fire path
    - EOD compose + carry-forward
    - Delivery dedup + per-rhythm channel policy
    - Milestone scan idempotent + safety-window guard

## 5. Data model additions

- `mcgs_briefings` — one row per Rhythm output. Unique on `(admin_id, rhythm_type, date_key)`.
- `mcgs_milestones_awarded` — one row per awarded milestone. Unique on `(milestone_key, period_key)`.
- `mcgs_admin_activity` — heartbeat per admin.
- `mcgs_rhythm_settings` — schedule + channel preferences per admin.

## 6. New API endpoints

**Settings + activity**
- `GET/PUT /api/mcgs/rhythms/settings`
- `POST /api/mcgs/rhythms/heartbeat`
- `GET /api/mcgs/rhythms/scheduler`

**Rhythm briefings**
- `GET /api/mcgs/rhythms/today`
- `POST /api/mcgs/rhythms/morning/compose[?force=true]`
- `POST /api/mcgs/rhythms/morning/deliver`
- `POST /api/mcgs/rhythms/midday/evaluate[?force=true]`
- `POST /api/mcgs/rhythms/midday/deliver`
- `POST /api/mcgs/rhythms/eod/compose[?force=true]`
- `POST /api/mcgs/rhythms/eod/deliver`
- `POST /api/mcgs/rhythms/briefings/{id}/seen`
- `POST /api/mcgs/rhythms/briefings/{id}/acknowledge`

**Milestones**
- `POST /api/mcgs/rhythms/milestones/scan`

## 7. What Phase 2 does NOT include (by design)

- No Weekly Review / Monthly Retro (deferred to a later phase).
- No SMS delivery.
- No interruptible speech.
- No vacation-mode holding logic beyond the boolean flag (Phase 3+).

## 8. Sign-off

> "Phase 2 is feature-complete. Rhythms feel complete: Morning prepares me,
>  Midday only interrupts when something genuinely changes, Evening helps
>  me close the day. Milestones are recognised quietly and appropriately.
>  George now carries context across days rather than treating each briefing
>  as a separate event."
>
> — Garry, 19 July 2026
