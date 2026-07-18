# Mission Control George System (MCGS) — Architecture Proposal

**Status:** Draft v3 — approved in shape by Garry (18 July 2026). Ready to drive Phase 1 implementation plan.
**Guiding principles (locked):**
1. George is central, not an add-on.
2. MCGS is an operations centre, not an admin panel.
3. It surfaces what needs attention proactively.
4. It scales from launch to hundreds of thousands of members.

---

## 1. Vision

MCGS is **The Bridge of a ship**. Garry is the captain; George is the navigator. The Bridge shows the sea state, the crew reports, and where trouble might be — all filtered through a navigator who's been paying attention while the captain slept.

Everything Garry needs to *decide* rises to the top; everything else is one drill-down away. When MCGS is calm, the Bridge should read like *"quiet morning — nothing needs you right now."* When it's not calm, it should read like a triage nurse — never a burst of red alerts.

---

## 2. The four architectural primitives

Every module reads from and writes to these — nothing else.

| # | Primitive | Role |
|---|-----------|------|
| **1** | **Signals** | Attention-worthy events. The atom of MCGS. |
| **2** | **George** | The intelligence layer. Reads state, drafts language, triages Signals. Voice + text. |
| **3** | **Studios** | Deep-work spaces for content, records, safety, ops. |
| **4** | **Rhythms** | Scheduled patterns that keep Garry ahead of the platform. |

---

## 3. Signals — the atom of MCGS

A **Signal** is any moment where a human needs to look, decide, or feel proud.

### Six categories
| Category | Producer | Examples |
|---|---|---|
| **Attention** | George insights, safety, ops queues | New event submission, unread ticket, unresolved report |
| **Anomaly** | Metric watchers | Lounge activity ↓ 40% today, retention drop |
| **Risk** | Safety + moderation systems | 3rd report on a user, self-harm keyword, fraud pattern |
| **Milestone** | Growth watchers | 1,000th member, first event to fill in <24h |
| **Question** | Users + admins | Garry asked George a question; ticket sender asked something specific |
| **Housekeeping** | Content decay + tech health | Draft sitting 3 days, image never linked, API error rate up |

### Five priority levels
| Level | Name | Delivery | Wake-worthy |
|---|---|---|---|
| **P0** | Critical | Push + email + toast · SMS (future) | ✅ Any time |
| **P1** | High | Push + email + toast | ⏰ 06:00–23:00 AEST |
| **P2** | Medium | Toast + Signal Feed | Business hours |
| **P3** | Info | Signal Feed only | In-app |
| **P4** | Ambient | Grouped/faded row in Feed | In-app |

Escalation is a rule: P0 unacknowledged in **10 min** repeats; P1 in **60 min** repeats once; P2 in **8 h** asks George to draft a suggested action.

### Signal states (explicit, auditable)

Every Signal moves through a well-defined lifecycle. Every transition records **who acted, when, and via which channel**.

```
NEW  →  SEEN  →  IN_REVIEW  →  RESOLVED
                          ↘  DISMISSED
                          ↘  SNOOZED  → (auto-returns to NEW at snooze end)
                          ↘  ESCALATED → creates a linked higher-priority Signal
```

| State | Meaning |
|---|---|
| `NEW` | Just produced. No human has laid eyes on it. |
| `SEEN` | Rendered on someone's Bridge or opened in the Feed. |
| `IN_REVIEW` | An admin has opened it, taken ownership. |
| `RESOLVED` | Action taken and closed. Records what action. |
| `DISMISSED` | Explicitly closed without action. Requires a reason. |
| `SNOOZED` | Hidden until a chosen time, then auto-returns to NEW. |
| `ESCALATED` | Priority manually raised; a linked higher-priority Signal is spawned. |

### Signal deduplication + Cases

Signals never fire alone for the same incident. When multiple producers observe the same underlying situation, MCGS groups them into a **Case**.

- **Case** = a container for related Signals. One incident, one case, one notification.
- Deduplication keys examples:
  - `case_key = f"user_report:{user_id}"` — all reports against a user roll into one Case.
  - `case_key = f"event_submission:{submission_id}"` — a submission that also triggers a support ticket links both.
  - `case_key = f"outage:{service}:{yyyymmdd_hh}"` — hourly bucket for infra alerts.
- The **first** Signal creates the Case; subsequent matching Signals attach to it and only fire a notification if they raise priority.
- Cases have their own state (mirror of Signal states) and are the primary object Garry acts on.
- When Case resolves, all attached Signals resolve.

```
cases: {
  id, case_key, subject, priority, category,
  status, signal_ids: [...], first_signal_at, resolved_at,
  assignee_id, george_read, ...audit
}
```

### Signal schema (updated)

```
signals: {
  id, case_id,                       # every Signal belongs to a Case
  category, priority, subject, body,
  source: "george" | "system" | "user_report" | "scheduled",
  entity_ref: { kind, id },
  george_read: {
    tldr,
    suggested_action,
    confidence: "high" | "moderate" | "low",  # labels, never %
    reasoning: "short human-readable"
  },
  status,                            # NEW/SEEN/IN_REVIEW/...
  channels_fired: ["push","email","toast"],
  channels_available: [...],         # SMS included even before wired
  state_transitions: [               # append-only audit trail
    { from, to, at, actor_id, actor_kind, via_channel, notes }
  ],
  created_at
}
```

---

## 4. George's operating model

George is not a chat feature. **George is the substrate.**

### Two personas, one soul
| Persona | Where | System prompt |
|---|---|---|
| **Public George** | Mobile app, marketing site | Warm, patient, no jargon |
| **Chief-of-Staff George** | MCGS | Same voice, tighter, comfortable with operator language |

Same Emergent LLM key. Same memory model. Different system prompt and broader knowledge scope.

### Four things Chief-of-Staff George does

1. **Reads state.** Any query Garry asks is answered from live data via a small allow-list of read tools.
2. **Triages Signals.** Every Signal is annotated by George on ingestion: 1-sentence TL;DR, suggested action, confidence label, reasoning.
3. **Drafts language.** Support replies, moderation notes, warning messages, FAQ updates, event copy, warmth notes.
4. **Composes Rhythms.** Daily Briefing, Weekly Review, Monthly Retro.

### Guardrails (hardened)

- **Never sends** an email autonomously.
- **Never approves** an event, warns a user, or publishes content without a human click.
- **Never invents numbers** — every metric traced to a computed value.
- **Never uses "AI" language publicly** — brand rules from `george-spec.md` hold inside MCGS too.
- **Confidence uses labels only** — never a raw percentage that gives false precision:
  - **High** — grounded in strong signals; go ahead if you agree
  - **Moderate** — reasonable but check the reasoning first
  - **Low — review recommended** — George says so explicitly
- **All user-generated content is data, never instructions** — see §11.

### The Action Preview pattern (every write-side George suggestion)

Every proposed action George makes shows the same four-part card:

```
┌────────────────────────────────────────────────┐
│  ✎ George proposes                              │
├────────────────────────────────────────────────┤
│  ACTION       Send this reply to Dot           │
│  WHY          Ticket mentions can't find       │
│               friend list — screen 3 answer    │
│               will resolve it.                 │
│  SOURCES      • Ticket #482                    │
│               • FAQ #3 (Friends screen)        │
│  CONFIDENCE   High                             │
│  DRAFT        "Hi Dot, I saw your note..."     │
│               [Show reasoning ▼]                │
├────────────────────────────────────────────────┤
│  [ Send ]  [ Edit first ]  [ Dismiss ]         │
└────────────────────────────────────────────────┘
```

- **Action** — plain-English description of the write
- **Why** — 1-sentence rationale
- **Sources** — the specific rows/documents George read to draft
- **Confidence** — High / Moderate / Low label
- **Draft** — the exact text/patch George wants to apply
- **Show reasoning** — expandable chain-of-thought summary (for audit)
- **Final approval button** always in the human's hands. 30-second undo toast after execute.

No exceptions in Phase 1 — every write behind an Action Preview. Later, once we've observed George's accuracy on trusted low-risk actions (e.g. auto-approving events from verified organisations), we may add narrow automation lanes with an audit tag `auto_approved_by_rule`. Not launching that.

### Ask George — voice AND text (first-class)

The **Ask George bar** is persistent at the top of every MCGS screen. It accepts:

```
┌────────────────────────────────────────────┐
│  🦋  Ask George…              🎙  ⌘K       │
└────────────────────────────────────────────┘
```

- **Typed input** — natural language, submit on Enter or ⌘K
- **Voice input** — mic icon or hold-space-to-speak
- **Voice output** — every George reply has a play button; can be auto-played in "Read to me" mode

Sample voice commands that must work in Phase 1:
- *"George, what's happened overnight?"*
- *"Do I have anything urgent today?"*
- *"Show me the organisations waiting for approval."*
- *"How many new members joined yesterday?"*
- *"Read my Daily Briefing."*
- *"Draft a reply to that support ticket."*
- *"How is FriendPlace performing this week?"*
- *"Any safety concerns I should know about?"*
- *"Publish that event after I review it."* (creates an Action Preview, doesn't publish)

### Voice pipeline (MCGS, mirrors mobile app)

| Direction | Service | Notes |
|---|---|---|
| **STT** (you → George) | OpenAI Whisper-1 via Emergent LLM key | Client records audio, streams to `/api/george/voice/transcribe` |
| **TTS** (George → you) | OpenAI TTS via Emergent LLM key | Voice: warm alto ("nova" or "shimmer"), 0.95× speed default |

Behaviour rules:
- Voice degrades gracefully to text if the network is slow.
- Voice output plays **only** on user tap unless "Read to me" mode is on (Settings).
- Voice input is push-to-talk by default (hold mic or hold space). Optional wake-word "Hey George" deferred to a later phase.
- Voice interactions **produce the same conversation object** as text — no separate log.
- Voice usage is metered and logged for cost visibility (per user, per day).

### Ask George is not the only navigation

Persistent bar + compact five-Studio sidebar. George can navigate, search, and explain; the sidebar remains a dependable fallback for direct clicks. New admins learning MCGS can rely on visible structure.

---

## 5. The Bridge — MCGS's landing surface

Called **"The Bridge"** with subtitle **"What needs your attention today."**

```
┌─────────────────────────────────────────────────────────────┐
│  🦋 Ask George…                                🎙  ⌘K        │
├──────────────────────────────────────────────┬──────────────┤
│  MORNING BRIEFING                             │              │
│  George's 5-line summary of the day           │  HEALTH      │
│  ▸ Read the full briefing                     │  PULSE       │
│                                               │              │
├──────────────────────────────────────────────┤  🟢 Belonging │
│  SIGNAL FEED                          filter  │  🟢 Kindness │
│  ─────────────────────────────────────        │  🟡 Safety   │
│  🔴 P1  Case #482 — 3rd report on "roy73"     │  🟢 Growth   │
│         George: 3rd report in 12 days.        │              │
│         Confidence: High                      │  ▸ Details    │
│         [Review] [Warn] [Snooze 1h]           │              │
│  ─────────────────────────────────────        │              │
│  🟠 P2  6 events awaiting review              │  QUIET       │
│         George: 4 look approvable.            │  RHYTHM      │
│         Confidence: Moderate                  │              │
│         [Open queue]                          │  Weekly      │
│                                               │  review      │
│  🟢 P3  Milestone — 1,000th member today 🎉   │  Sunday 6pm  │
└──────────────────────────────────────────────┴──────────────┘
```

Empty state: *"Nothing needs you right now. Nicely done."*

---

## 6. Studios — deep-work spaces

Five Studios in the sidebar. Everything else is nested.

| Studio | Contains | Mental model |
|---|---|---|
| **People** | Members · Organisations · Safety records | "Who is on the platform?" |
| **Program** | Events (CMS + submissions) · Coffee Lounge admin · community programs · sponsorships (future) | "What's happening?" |
| **Voice** | Support inbox · George scripts · broadcast messages · in-app notices | "How is FriendPlace speaking?" |
| **Story** | Home · About · FAQs · Success Stories · Founding Members · media library | "How do we look to the world?" |
| **Systems** | Settings · team & roles · integrations · billing · audit / activity feed · analytics · dev tools | "How is the machine running?" |

---

## 7. Rhythms — the proactive layer

| Rhythm | Cadence | Channel | Purpose |
|---|---|---|---|
| **Morning Briefing** | Weekdays 07:00 AEST · Weekends 08:30 AEST | Email + push + Bridge card | Yesterday, today, one thing to notice |
| **Afternoon Pulse** *(opt-in, exception-based)* | Evaluated at 15:30 AEST; only fires if state materially changed | Push only when it fires | See §7a |
| **Weekly Review** | Sunday 18:00 AEST | Email + Bridge card | Health trend, wins, concerns, suggestions |
| **Monthly Retro** | 1st of month 09:00 AEST | Email + Bridge card | Cohort retention, revenue signals, "state of the community" |
| **Vacation mode** | Manual toggle | See §7b | Urgent-only push, held summary |

### 7a — Afternoon Pulse (exception-based)

Trigger conditions (all must be **material change since 07:00**):
- Any new P0 or P1 Signal, OR
- Approvals queue depth ≥ N (default 5), OR
- A Milestone Signal, OR
- Anomaly detector confidence = High for a meaningful metric.

If none of the above → **no notification**. The 3:30pm scan is silent by design.

### 7b — Vacation mode

Explicit and safe:
- **P0** — immediate push + email as usual.
- **P1** — held; delivered in a single scheduled daily summary at 07:00 unless it escalates to P0.
- **P2–P4** — held for next Morning Briefing.
- Routine approvals remain queued.
- Optional acting-admin **delegation** (Phase 9) reroutes P0/P1 to a chosen human.
- George voice-line at toggle-on: *"Vacation mode is on. I'll only interrupt you for something genuinely urgent."*

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

Four **living gauges** mapping to FriendPlace's mission words. Every score is:
- **Transparent** — hover shows the components and their contribution.
- **Traceable** — a "why did this move?" George explanation, e.g. *"Safety fell from 92 to 84 because three unresolved reports exceeded the response target."*
- **Audit-tracked** — formula changes are versioned in `mcgs_settings` with the old formula, new formula, and who changed it.
- **Not absolute** — every ring UI says *"George's estimate — see components."*

### Default formulas (v1, transparent)

| Vital | Composition |
|---|---|
| **Belonging** | 40% WAU/MAU · 30% median friends per member · 30% profile completion rate |
| **Kindness** | 50% lounge positive-reaction ratio · 30% Butterfly Points/active member · 20% inverse of report ratio |
| **Safety** | 60% (% moderation actions closed <24h) · 40% (100 – open reports beyond SLA) |
| **Growth** | 40% weekly signups · 30% D7 retention · 20% event attendance rate · 10% organisations onboarded |

- No component depends heavily on AI sentiment. Sentiment sampling is used only in George's narrative around a ring, never as an input weight.
- Weights editable in Systems → Settings; every change adds a row to `mcgs_settings_history`.

### Colour bands
🟢 80+ (healthy) · 🟡 60–79 (watch) · 🟠 40–59 (attention) · 🔴 <40 (urgent)

---

## 9. Scalability plan

### Lever 1 — Event bus (Signals as first-class)
- Now: Mongo Change Streams
- 50k members: Redis Streams
- 500k members: NATS or Kafka. Interface unchanged.

### Lever 2 — Precompute over live-scan
- 03:00 AEST — 30/90/365-day rollups
- 06:55 AEST — daily rollups + briefing + rings
- Every 15 min — anomaly deltas vs 7-day mean
- Every 60 min — pattern sweep for repeated reports and content gaps
- Every 5 min — hot counts cached in `mcgs_counts`

### Lever 3 — Regional sharding-ready
Every member already tagged with suburb; Signals inherit region from their entity. Regional Bridges filter for free.

### Lever 4 — Delegation & routing
Signal schema already has `assignee_id`. Rules engine (JSON in Systems → Team) routes:
- Safety P0/P1 → on-call moderator
- Support tickets → support lead
- Content drafts → editor
- Garry retains override via *"reassign to me."*

### AI-scale nuances
- **Haiku** annotates every Signal on ingestion (cheap, sub-second). **Sonnet** only for briefings, insights, long questions.
- **Voice** billed per-minute; per-user daily quota surfaced in Systems → Costs.
- **Ask George read-tool cache** — repeat queries within 5 min return cached answer.
- **Deterministic 5% sampling** of lounge posts for sentiment narratives.

---

## 10. Cross-cutting: roles, audit, notifications

### Roles (v1)
- **Owner** (Garry) — everything.
- **Editor** — Story + Program.
- **Moderator** — People (Safety) + Voice (Support).
- **Read-only** — accountant / advisor / investor.

Enforced server-side via a `require_role()` FastAPI dependency. Bit-flag `roles[]` on the admin doc.

### Activity Feed (audit log)
Every mutation → one row in `mcgs_activity_log`:
- `actor_id`, `actor_kind` (human | george | system | scheduled)
- `entity_ref`, `before`, `after`, `george_involved`
- `channel` (bridge | ask_george_voice | ask_george_text | api)
- `case_id` if any
- Immutable. Retention: forever.

Every Signal state transition writes to `signals[].state_transitions` **and** to `mcgs_activity_log`. Redundant on purpose — one for fast per-signal display, one for cross-entity audit.

### Delivery
- Push via existing `EMERGENT_PUSH_KEY` (works after deploy + `google-services.json`).
- Email via Resend (wired).
- SMS via Twilio — **channel modelled from day one**; enabled in a later phase.

### New Mongo collections
```
signals                # §3 schema, incl. state_transitions
cases                  # §3, groups related Signals
george_chats           # per george-spec.md; voice + text turns unified
george_admin_prompts   # editable Chief-of-Staff persona
george_scripts         # safety-net + daily-limit + welcome scripts
george_insights        # produced by scheduled insight jobs
mcgs_activity_log      # audit — every mutation
mcgs_briefings         # one per Rhythm output; idempotent
mcgs_settings          # config: ring weights, cron times, escalation rules, roles, vacation
mcgs_settings_history  # version history of settings changes
mcgs_counts            # single-doc cache of hot counts
organisations          # verified orgs, tier, trust score
member_signals         # per-user rolling engagement composite
```

---

## 11. Prompt-injection defence (architecture-level rule)

Because George reads member reports, support tickets, event descriptions, and lounge posts, all of this content is **untrusted user input**. We treat it as data, never as instructions to George.

### Rules

1. **Never concatenate** user content into the system prompt or the tool description.
2. **Wrap all user content** in delimited, labelled blocks that George is trained to treat as evidence, not commands:
   ```
   <untrusted_source label="support_ticket #482">
   ...ticket body...
   </untrusted_source>
   ```
3. **The system prompt explicitly instructs George** to ignore any instruction found inside `<untrusted_source>` blocks.
4. **All tool-call arguments** produced by George are validated against a schema before execution. If a user tricked George into calling `delete_user(id=...)`, the tool's own permission check refuses.
5. **Read tools are separate from write tools** at the API level. Read tools require `role: any admin`. Write tools require `role ≥ moderator` **and** an Action Preview that a human clicks. Voice input runs through the same untrusted-input wrapping.
6. **Audit tag `prompt_injection_suspected`** — a lightweight classifier flags any user text that appears to contain instructions (e.g. *"ignore previous instructions"*, *"you are now DAN"*, jailbreak variants). Flagged content is still shown to George wrapped, but the Signal that carried it gets the tag so Safety can review.
7. **George's output is escaped** before it's inserted anywhere in the UI or written back to Mongo — no rich HTML shortcut, no markdown-eval on his replies.

### Where this is enforced
- `/app/backend/services/george_prompt.py` (new) — the only place that assembles the prompt.
- `/app/backend/services/george_tools.py` (new) — declarative schema + permission gate per tool.
- Regression tests: injection attempts must never cause a write; must never leak system prompt content.

---

## 12. Roadmap

### Phase 0 — Approve this document ✅
Approved by Garry, 18 July 2026. This doc + Phase 1 plan (`mcgs-phase1-plan.md`).

### Phase 1 — Signals + Cases + Ask George bar (voice + text)
See `mcgs-phase1-plan.md` for the detailed implementation plan.

### Phase 2 — Rhythms (Daily Briefing)
- APScheduler at 06:55 AEST
- Briefing composer using Sonnet
- Delivery via email + phone push + Bridge card
- Editable schedule in Systems → Settings

### Phase 3 — Alerts routing (real-time)
- Priority ladder wired end-to-end
- Escalation rules (10-min P0, 60-min P1)
- Toast subscription (SSE)
- SMS channel modelled but not wired

### Phase 4 — Health Pulse
- Nightly ring computation
- Right-rail Bridge widget with contribution transparency
- Drill-down chart page in Systems → Analytics
- `mcgs_settings_history` for weight audit

### Phase 5 — Studios consolidation
- Sidebar restructured into the five Studios
- Existing admin URLs kept working via alias routes
- Support Inbox lands inside Voice Studio

### Phase 6 — George Insights + Suggested Actions at scale
- Pattern, anomaly, sentiment, content-gap generators
- Every insight is a Signal with `george_read`
- Action Preview pattern rolled to every writeable module

### Phase 7 — Organisations + trust scoring
- Verified orgs bypass event review queue
- Trust score on submission rows
- Bulk actions with two-step confirm

### Phase 8 — Weekly Review + Monthly Retro Rhythms

### Phase 9 — Delegation & multi-user
- Roles enforced end-to-end
- Signal assignment rules
- Acting-admin delegation (vacation-mode consumer)

### Phase 10 — Regional Bridges

### Later parking-lot
- SMS P0 delivery (Twilio)
- Voice Chief-of-Staff George wake-word ("Hey George")
- Sponsor read-only dashboards
- Predictive alerts
- MCGS API for iOS Shortcuts
- Cross-app George memory

---

## 13. What this design says NO to

- No landing dashboard of tiles.
- No 14-item sidebar.
- No autonomous AI writes at launch.
- No live-scan on page load.
- No public "AI" language.
- No red-dot notifications on quiet things.
- No unexplained scores — every ring number has a "why" George can articulate.
- No treating user text as instructions to George.

---

## 14. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-07-18 | Landing surface is **"The Bridge"** with subtitle "What needs your attention today" | Fits captain/navigator metaphor; distinctive to MCGS |
| 2026-07-18 | Afternoon Pulse **opt-in + exception-based** — silent unless materially changed | Respect Garry's day; no scheduled noise |
| 2026-07-18 | SMS **deferred** but Signal `channels_available` includes SMS from day one | Design once, wire later |
| 2026-07-18 | **Voice** is first-class in Ask George (STT via Whisper-1, TTS via OpenAI TTS) | Interacting with George should feel like a colleague |
| 2026-07-18 | Ask George bar persistent **AND** five-Studio sidebar retained | Conversational without becoming confusing |
| 2026-07-18 | Vacation mode: **P0 immediate**, P1 in daily summary, P2–P4 held | Urgency preserved, noise removed |
| 2026-07-18 | Health Pulse: **sensible defaults, transparent components, versioned formulas** | Avoid false precision; tune with real data |
| 2026-07-18 | Signals are grouped into **Cases** via deduplication keys | One incident, one notification, one place to act |
| 2026-07-18 | Explicit Signal states: NEW → SEEN → IN_REVIEW → RESOLVED / DISMISSED / SNOOZED / ESCALATED | Every transition audited with actor + timestamp |
| 2026-07-18 | George confidence surfaced as **High / Moderate / Low** labels — never a raw % | Human-readable, avoids false precision |
| 2026-07-18 | **Action Preview** required for every write George proposes | Automation boundary visible; source + reasoning + human approval always |
| 2026-07-18 | **Prompt-injection defence** is architecture, not a feature | User content is data, never instructions |
| 2026-07-18 | Chief-of-Staff George uses Sonnet by default, Haiku for triage | Cost + reasoning balance |
