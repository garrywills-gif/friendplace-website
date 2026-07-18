# Mission Control George System (MCGS) — Architecture Proposal

**Status:** Draft v2 — designed from first principles, awaiting Garry's approval.
**Date:** 18 July 2026.
**Guiding principles (locked by Garry):**
1. George is central, not an add-on.
2. MCGS is an operations centre, not an admin panel.
3. It surfaces what needs attention proactively.
4. It scales from launch to hundreds of thousands of members.

---

## 1. Vision

Think of MCGS as **the bridge of a ship**. Garry is the captain; George is the navigator. The bridge shows the sea state, the crew reports, and where trouble might be — all filtered through a navigator who's been paying attention while the captain slept.

Everything Garry needs to *decide* rises to the top; everything else is one drill-down away. There is no landing page of empty CRUD tables. When MCGS is calm, the bridge should read like *"quiet morning — nothing needs you right now."* When it's not calm, it should read like a triage nurse — never a burst of red alerts.

---

## 2. The four architectural primitives

The whole system is built from four building blocks. Every module reads from and writes to these — nothing else.

| # | Primitive | Role |
|---|-----------|------|
| **1** | **Signals** | Attention-worthy events. The atom of MCGS. |
| **2** | **George** | The intelligence layer. Reads state, drafts language, triages Signals. |
| **3** | **Studios** | Deep-work spaces for content, records, safety, ops. |
| **4** | **Rhythms** | Scheduled patterns that keep Garry ahead of the platform. |

Everything below is either a producer of Signals, a consumer of Signals, a Studio, or a Rhythm.

---

## 3. Signals — the atom of MCGS

A **Signal** is any moment where a human needs to look, decide, or feel proud.

### Signal categories (six)
| Category | Producer | Examples |
|---|---|---|
| **Attention** | George insights, safety, ops queues | New event submission, unread ticket, unresolved report |
| **Anomaly** | Metric watchers | Lounge activity ↓ 40% today, retention drop, unusual sign-up burst |
| **Risk** | Safety + moderation systems | 3rd report on a user, self-harm keyword triggered, fraud pattern |
| **Milestone** | Growth watchers | 1,000th member, first event to fill in < 24h, first business partnership |
| **Question** | Users + admins | Garry asked George a question; ticket sender asked something specific |
| **Housekeeping** | Content decay + tech health | Draft sitting 3 days, image never linked, API error rate up |

### Priority ladder (five levels)
| Level | Name | Delivery | Wake-worthy |
|---|---|---|---|
| **P0** | Critical | Phone push + email + SMS (future) + toast | ✅ Any time |
| **P1** | High | Phone push + email + toast | ⏰ 06:00–23:00 AEST |
| **P2** | Medium | Toast + Signal Feed only | Business hours |
| **P3** | Info | Signal Feed only | In-app |
| **P4** | Ambient | Faded row in Feed, groups with peers | In-app |

Escalation is a rule, not code: any P0 not acknowledged in 10 min repeats; any P1 in 60 min repeats once; P2 in 8 h asks George to draft a suggested action.

### Signal schema (Mongo)

```
signals: {
  id, category, priority, subject, body,
  source: "george" | "system" | "user_report" | "scheduled",
  entity_ref: { kind, id },          # deep-link target
  george_read: {                     # produced by George on ingestion
    tldr, suggested_action, confidence
  },
  status: "new" | "seen" | "snoozed" | "resolved" | "delegated",
  assignee_id, snoozed_until, acked_at, resolved_at, resolved_by,
  channels_fired: [...],
  created_at
}
```

Everything downstream — Alerts inbox, Daily Briefing, Health Pulse annotations — is a *view* over this collection.

---

## 4. George's operating model

George is not a chat feature. **George is the substrate.** Every screen reads through him; every write can be driven by him.

### Two personas, one soul
| Persona | Where | System prompt |
|---|---|---|
| **Public George** | Mobile app, marketing site | Warm, patient, no jargon — locked in `george-spec.md` |
| **Chief-of-Staff George** | MCGS | Same voice, tighter, comfortable with operator language and metrics |

Same Emergent LLM key. Same memory model. Just a different opening prompt and a broader knowledge scope.

### Four things Chief-of-Staff George does

1. **Reads state.** Any query Garry asks — *"How many events did we run in June?"*, *"Who are the top three most-reported users this quarter?"* — is answered from live data via a small allow-list of read tools.

2. **Triages Signals.** Every Signal that lands is annotated by George before Garry ever sees it: a 1-sentence TL;DR, a suggested action, and a confidence score.

3. **Drafts language.** Support replies, event moderation notes, warning messages, FAQ updates, event descriptions, member celebrations. Every draft has a **Show reasoning** toggle and a 30-second undo after execute.

4. **Composes Rhythms.** The Daily Briefing, Weekly Review, and Monthly Retro are all written by George from the same underlying data.

### What George never does (the guardrails)

- Never sends an email autonomously.
- Never approves an event, warns a user, or publishes content without a human click.
- Never invents numbers — every metric in a briefing is traced back to a computed value.
- Never uses "AI" language publicly (the `george-spec.md` framing rule holds inside MCGS too).

### Ask George bar (persistent UI)

At the top of every MCGS screen sits a slim address-bar-style Ask George input.

```
🦋 Ask George…                     [ ⌘K ]
```

Typing or speaking anything opens a bottom-sheet with George's answer. This is the primary navigation mechanism. The sidebar exists, but Garry should be able to run MCGS all day without touching it.

Examples:
- *"Show me events happening this weekend."*
- *"Draft a reply to Dot's ticket."*
- *"Who's earned the most kindness points this month?"*
- *"Are there any users I should keep an eye on?"*

---

## 5. The Bridge — MCGS's landing surface

Everything the operations metaphor promises lands here. This is Garry's home when he opens MCGS.

```
┌─────────────────────────────────────────────────────────────┐
│  🦋 Ask George…                                    ⌘K       │  ← persistent
├──────────────────────────────────────────────┬──────────────┤
│  MORNING BRIEFING                             │              │
│  George's 5-line summary of the day          │  HEALTH      │
│  ▸ Read the full briefing                     │  PULSE       │
│                                               │              │
├──────────────────────────────────────────────┤  🟢 Belonging │
│  SIGNAL FEED                          filter │  🟢 Kindness │
│  ─────────────────────────────────────       │  🟡 Safety   │
│  🔴 P1  New report on user "roy73"           │  🟢 Growth   │
│         George: 3rd report in 12 days.       │              │
│         [Review] [Warn]  [Snooze 1h]         │  ▸ Details    │
│  ─────────────────────────────────────       │              │
│  🟠 P2  6 events awaiting review              │              │
│         George: 4 look approvable.            │  QUIET       │
│         [Open queue]  [Auto-approve verified] │  RHYTHM      │
│  ─────────────────────────────────────       │              │
│  🟢 P3  Milestone — 1,000th member today 🎉  │  Weekly      │
│         [Draft welcome post]                  │  review      │
│                                               │  Sunday 6pm  │
└──────────────────────────────────────────────┴──────────────┘
```

Three regions, one principle: **the thing that needs you is already in front of you.**

- **Morning Briefing:** the top 5 lines of the day, sourced from Rhythm §7.
- **Signal Feed:** the whole triaged inbox, priority-sorted, filterable by category. Empty state reads *"Nothing needs you right now. Nicely done."*
- **Health Pulse:** four vitals, always visible in the right rail. Detail in §8.

---

## 6. Studios — deep-work spaces

Studios are only reached by drilling from Signals or by intentional navigation. They exist to hold the CRUD work, not to be the front door.

The eleven modules from a traditional CMS collapse into **five studios**, each with a coherent purpose.

| Studio | Contains | Owner mental model |
|---|---|---|
| **People** | Members · Organisations · Safety records (reports, warnings, moderation log) | "Who is on the platform, and how are they doing?" |
| **Program** | Events (CMS + submissions) · Coffee Lounge admin · community programs · sponsorships (future) | "What's happening on the platform?" |
| **Voice** | Support inbox · George scripts (safety-net + daily-limit) · broadcast messages · in-app notices | "How is FriendPlace speaking to members?" |
| **Story** | Home, About, FAQs, Success Stories, Founding Members · media library | "What does FriendPlace look like to the world?" |
| **Systems** | Settings · team & roles · integrations · billing · audit / activity feed · dev tools | "How is the machine running?" |

Advantages:
- The sidebar is short: **Bridge · People · Program · Voice · Story · Systems** (plus the Ask George bar above).
- New features slot into an existing Studio without adding sidebar clutter.
- Delegation maps cleanly: a future Safety Moderator gets **People (Safety)** only.

---

## 7. Rhythms — the proactive layer

Rhythms are how MCGS earns "proactive". They are scheduled jobs that convert state into narrative and push it to Garry.

| Rhythm | Cadence | Channel | Purpose |
|---|---|---|---|
| **Morning Briefing** | Weekdays 07:00 AEST · Weekends 08:30 AEST | Email + phone push + Bridge card | Yesterday, today, one thing to notice |
| **Afternoon Pulse** *(opt-in)* | 15:30 AEST | Phone push only | 1-line status: queues, tickets, hot Signals |
| **Weekly Review** | Sunday 18:00 AEST | Email + Bridge card | Health rings trend, top 3 wins, top 3 concerns, 3 suggested actions |
| **Monthly Retro** | 1st of month 09:00 AEST | Email + Bridge card | Cohort retention, revenue signals (once FP+ ships), narrative "state of the community" |
| **Vacation mode** | Manual toggle | — | Downgrades all channels one level, keeps email only |

Every Rhythm output is a Signal (`category: "attention"` or `"milestone"`), which means it lives in the Feed and the Activity Log too.

### Daily Briefing template (locked)

```
🦋 Morning, Garry. Here's your Friday briefing.

Yesterday
   • 12 new signups (↑ 3), 4 events published, 26 lounge conversations.
   • Margaret hit her 100th kindness point — feels like a moment.

Today's plan
   • 3 events today; Rosanna coffee catch-up at 10am is nearly full.
   • 2 organisations awaiting review; one warm and clear, one thin.
   • 1 support ticket, 4h old.

One thing to notice
   • Lounge activity dipped 18% Wednesday night. My guess: local footy final.
     Not a red flag, but worth a glance if it continues.

Suggested for you
   • Approve "Preston Pilates" event.
   • Reply to Dot's ticket — draft ready.
   • Send a warm note to Margaret? I've drafted one.

Have a lovely day.
   — George
```

---

## 8. Health Pulse — four vitals

Not a dashboard of vanity metrics. Four **living gauges** that map directly to FriendPlace's mission words.

| Vital | 0–100 index composed of | Colour bands |
|---|---|---|
| **Belonging** | WAU/MAU · median friends per member · profile completion | 🟢 80+ · 🟡 60 · 🟠 40 · 🔴 <40 |
| **Kindness** | Lounge positive-reaction ratio · Butterfly Points earned/day · low report ratio | same |
| **Safety** | Open reports · time-to-first-action · % moderation closed <24h | same |
| **Growth** | Weekly signups · D7 retention · event attendance rate · organisations onboarded | same |

Each gauge shows:
- Current index, colour band, delta vs 7-day mean
- A one-sentence **George's read** (regenerated in the 06:55 cron)
- Sparkline on hover

Full drill-down (chart + 90/180/365-day toggle) is one click away in **Systems → Analytics**. Not on the Bridge — the Bridge is for *now*.

### Ring composition is editable in Settings
Rings should adapt as the platform grows. At 1,000 members the mix that matters is different from 100,000. Weights live in `mcgs_settings`.

---

## 9. Scalability plan

Designed to hold from day one through hundreds of thousands of members. Four levers.

### Lever 1 — Event bus (Signals as first-class)
Every mutation in the platform emits an event to an internal bus. Signal producers subscribe. This decouples Signal generation from feature code and keeps the Bridge quick regardless of platform size.

- **Now:** Mongo Change Streams (already available, zero deps).
- **~50k members:** move to Redis Streams for higher throughput.
- **~500k members:** consider NATS or Kafka if event volume warrants; interface unchanged.

### Lever 2 — Precompute over live-scan
Nothing on the Bridge is live-scanned. All aggregates come from precomputed rollups:

- **Nightly cron (03:00 AEST):** rebuilds 30/90/365-day rollups.
- **06:55 cron:** rebuilds daily rollups, composes briefing, refreshes rings.
- **Every 15 min:** anomaly detector rescans deltas against 7-day mean.
- **Every 60 min:** pattern detector sweeps for repeated reports and content gaps.
- **Every 5 min:** hot counts (submissions, tickets, reports) via a single cached document `mcgs_counts`.

### Lever 3 — Regional sharding-ready
Every member record already carries `suburb`, `suburb_postcode`, `suburb_state`. Every Signal is tagged with a region derived from its entity. When FriendPlace expands beyond Melbourne, regional Bridges filter the Signal Feed and Health Pulse by region for free. Existing data model needs no migration.

### Lever 4 — Delegation & routing
The Signal schema already has `assignee_id`. When Garry hires a second human, a rules engine (simple JSON, edited in Systems → Team) routes Signals to the right person:
- Safety P0/P1 → on-call moderator
- Support tickets → support lead
- Content drafts → editor
Garry always retains override authority via the Ask George bar (*"reassign to me"*).

### AI-scale nuances
- **Sampling for insights.** Sentiment reads run over a deterministic 5% sample of lounge posts; deterministic hashing means the sample overlaps day-over-day for continuity without full-corpus cost.
- **Model tiering.** Haiku for triage annotation of Signals (cheap, sub-second). Sonnet only for long-form briefings and insight reasoning. Emergent LLM key handles both.
- **Cache Ask George read-tools.** Queries like *"how many events this month"* cache for 5 minutes so operator questions don't blow up costs.

---

## 10. Cross-cutting concerns

### Roles (v1 keep simple)
- **Owner** (Garry) — everything.
- **Editor** — Story + Program (drafting/publishing content and events).
- **Moderator** — People (Safety) + Voice (Support).
- **Read-only** — for accountant / advisor / investor viewing.

Row-level checks server-side via a `require_role()` FastAPI dependency. Bit-flag `roles[]` on the admin doc.

### Activity Feed (audit log)
Every mutation → one row in `mcgs_activity_log` (actor, entity, before/after, george_involved bool). Retention: forever. Displayed under **Systems → Activity**.

### Notifications delivery
Push via existing `EMERGENT_PUSH_KEY` (scaffolded — needs deploy + `google-services.json`). Email via Resend (already wired). SMS via Twilio deferred to Phase 3+ and only for P0.

### New Mongo collections
```
signals                # §3 schema
george_chats           # per george-spec.md
george_admin_prompts   # editable Chief-of-Staff persona
george_scripts         # safety-net + daily-limit + welcome scripts
george_insights        # produced by nightly + hourly insight jobs
mcgs_activity_log      # audit
mcgs_briefings         # one per Rhythm output, idempotency + audit
mcgs_settings          # ring weights, cron times, escalation rules, roles
mcgs_counts            # single-doc cache of hot counts (for badges)
organisations          # verified orgs, tier, trust score
member_signals         # per-user rolling engagement composite
```

No breaking migrations required against existing collections.

---

## 11. Roadmap — phased build

Each phase produces a working, testable slice. Every phase strengthens the four primitives.

### Phase 0 — Approve this document
Deliverable: this file, agreed. No code.

### Phase 1 — Signals + Ask George bar (foundation)
- `signals` collection + producer/consumer contract
- Signal Feed on the Bridge (replaces current Dashboard)
- Ask George bar (top of every MCGS screen)
- Chief-of-Staff George prompt + `george_chats`
- Two Signal producers to prove the pattern: **event submissions** (existing badge becomes a Signal) and **support tickets** (existing table becomes Signals)
**Success test:** Garry can ask George *"what needs me?"* and get the same answer the Bridge shows visually.

### Phase 2 — Rhythms (Daily Briefing)
- APScheduler at 06:55 AEST
- Briefing composer using George (Sonnet)
- Delivery via email + phone push + Bridge card
- Editable schedule in Systems → Settings
**Success test:** Garry receives an accurate, warm briefing daily for one week unattended.

### Phase 3 — Alerts routing (real-time)
- Priority ladder wired to push + email
- Escalation rules (10-min P0, 60-min P1)
- In-app toast subscription (SSE)
**Success test:** A test P0 reaches Garry's phone in <30s.

### Phase 4 — Health Pulse
- Nightly ring computation
- Right-rail Bridge widget
- Drill-down chart page in Systems → Analytics
**Success test:** Rings render <300ms on the Bridge.

### Phase 5 — Studios consolidation
- Sidebar restructured into the five Studios
- Existing pages moved without breaking URLs (301-style aliases inside Next.js)
- Support Inbox lands inside Voice Studio (new)
**Success test:** No admin URL breaks; navigation feels calmer.

### Phase 6 — George Insights + Suggested Actions
- Pattern detector, anomaly detector, sentiment sampler, content-gap generator
- Every insight becomes a Signal with a `george_read` annotation
- Suggested-action UI pattern (draft + execute + undo)
**Success test:** ≥70% "useful" thumbs-up rate on weekly insights.

### Phase 7 — Organisations + trust scoring
- Verified orgs bypass event review queue
- Trust score visible on submission rows
- Bulk actions ("approve all events from verified orgs")

### Phase 8 — Weekly Review + Monthly Retro Rhythms
- Sunday review email + Bridge card
- 1st-of-month retro with cohort analysis

### Phase 9 — Delegation & multi-user
- Roles enforced end-to-end
- Signal assignment rules
- On-call rotation UI

### Phase 10 — Regional Bridges
- Region filter on Signal Feed and Health Pulse
- Regional briefings for state expansion

### Later parking-lot
- Voice Chief-of-Staff George (*"read me today's briefing"*)
- Sponsor read-only dashboards
- Predictive alerts ("this event is under-booked, want to nudge?")
- MCGS API for iOS Shortcuts
- Cross-app George memory ("have I spoken to a user about this before?")

---

## 12. What this design says *no* to

Just as important as what's in.

- **No landing dashboard of tiles.** The Bridge is the Signal Feed; if there's nothing to signal, it's quiet.
- **No sidebar with 14 items.** Five Studios plus the Bridge.
- **No autonomous AI actions.** Every write behind a human click, always.
- **No live-scan on page load.** Anything expensive precomputes on a schedule.
- **No public "AI" language.** Chief-of-Staff George keeps the same brand rules as public George — he's a navigator, not a bot.
- **No permanent notifications-with-red-dots-everywhere.** Priority ladder decides delivery; nothing quiet ever gets a badge.

---

## 13. Open questions for Garry

1. **Naming.** *"Bridge"* vs *"Command Centre"* vs *"Today"* for the landing surface — which lands best?
2. **Afternoon Pulse.** Nice-to-have or noise? Default on or default off?
3. **SMS for P0.** Twilio Phase 3, or defer?
4. **Ask George bar as primary nav.** Are you comfortable running MCGS mostly by asking George, or would you rather the sidebar stay the primary UI?
5. **Vacation mode.** Downgrade all channels one level, or just email-only?
6. **Ring weights.** Happy for me to pick sensible defaults for launch, or want to hand-tune before Phase 4?

---

## 14. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-07-18 | Signals are the atom of MCGS | Ops-centre metaphor made real; scales into event bus |
| 2026-07-18 | George is substrate not feature | Central-to-experience principle |
| 2026-07-18 | Studios collapse 14 modules to 5 | Sidebar as calm as the Bridge |
| 2026-07-18 | Bridge shows Signal Feed + Health Pulse + Briefing | Proactive-attention principle |
| 2026-07-18 | Precompute + event bus from day one | Scale principle without over-engineering |
