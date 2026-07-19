# Mission Control George System (MCGS) — Architecture Proposal

**Status:** Draft v3 — approved in shape by Garry (18 July 2026). Ready to drive Phase 1 implementation plan.
**Guiding principles (locked):**
1. George is central, not an add-on.
2. MCGS is an operations centre, not an admin panel.
3. It surfaces what needs attention proactively.
4. It scales from launch to hundreds of thousands of members.
5. **George should reduce cognitive load, not increase it.** Every new feature must answer *"Does this help the administrator think less while staying better informed?"* If yes, it belongs. If it just adds another dashboard or notification, it doesn't.

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

### Voice interaction rules

- **Tap-to-toggle by default** — tap mic once to start, tap again to stop. Hold-to-talk available as a settings switch.
- **Recording UI must always show:**
  - A very clear recording indicator (pulsing red glyph)
  - A visible timer counting up
  - Live/partial transcription streaming into the input as you speak (where the pipeline supports it; otherwise a subtle "listening…" hint)
  - A prominent Stop and a separate Cancel/discard control
  - Automatic stop after **3 seconds of silence** (configurable in Settings, min 2s, max 10s)
  - A hard **maximum recording length of 60 seconds** per clip (goes to text if longer needed)
- **Transcript review before send.** After stop, the transcript sits in the input for edit — nothing sent until you tap Send (or press ⌘↵).
- Audio recorded via `expo-audio` on mobile (Phase 2 for member app), and via `MediaRecorder` API on web (Phase 1, in-CMS).
- Streamed to `/api/george/voice/transcribe`; transcript pre-filled in input; user can edit before send.
- TTS: on-demand only unless "Read to me" toggled. Voice: `nova` default (A/B `shimmer` later). Speed 0.95×.
- Voice usage logged to `george_chats.turns[]` with `input_kind` / `output_kind`.
- Cost telemetry: `voice_seconds_today` incremented per admin.

### Voice safeguard (locked — Garry 18 July 2026)

**George never executes a consequential action solely from a spoken command.**

Voice can *create* the proposed action, but anything that:
- sends a message, email, or ticket reply
- publishes or unpublishes content
- warns, suspends, restricts, or bans a member
- approves or rejects an event or organisation
- edits member-visible content

…must **still surface an Action Preview** and require an **explicit written or tapped confirmation** by the admin. The spoken command *"George, draft a reply and approve the event"* opens two Action Preview cards for review — it does not send or publish.

Enforcement: the write-tool "propose" pattern (see §4.3 of the Phase 1 plan) is invoked identically regardless of input channel. Voice never has a shortcut path.

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

Rhythms make MCGS feel like a conversation with George across the whole day, not a set of scheduled reports. Every Rhythm output is written by George with the same warmth as Ask George — no dashboards, just a colleague checking in.

| Rhythm | Cadence | Channel | Feel |
|---|---|---|---|
| **Morning Briefing** | Weekdays 07:00 AEST · Weekends 08:30 AEST | Email + push + Bridge card | Warm rotating opener → what changed overnight → what needs attention → what can wait → where George recommends starting. Conversational, not a report. |
| **Midday Pulse** *(opt-in, exception-based)* | Evaluated at 15:30 AEST; fires only if state materially changed | Push only when it fires (Bridge always) | See §7a. Silence is a feature. |
| **End-of-Day Wrap-up** | Weekdays 18:00 AEST · deferred while Garry is active (waits ~30 min inactivity, skips if he stays active into the evening) | Bridge + optional email (no push unless urgent) | *"Before you go — today we approved five new events, twenty-one more people found FriendPlace, you cleared every support ticket. Nothing urgent left for tomorrow. Sleep well; I'll keep watch overnight."* |
| **Milestone Recognition** | Ambient; surfaces when a milestone lands | Bridge inline + folded into next Rhythm | *"Before we finish today… I thought you'd like to know we've just welcomed our 1,000th member. That's a lovely milestone."* No confetti — just quiet acknowledgement. See §7c. |
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

### 7c — Milestone Recognition

Milestones aren't reports — they're moments worth naming. George watches for meaningful community achievements and folds them into whichever Rhythm is next (or as an ambient Bridge inline). Never a push, never confetti — just quiet acknowledgement in a colleague's voice.

Tracked milestones (v1):
- First organisation reaches 100 events.
- Total members cross a round threshold (100, 500, 1k, 5k, 10k…).
- Total friendships created cross a round threshold (100, 1k, 10k…).
- Every open support ticket cleared for the first time in a week.
- No safeguarding incidents for 30 consecutive days.

Delivery pattern:
- Landed as a `Milestone` Signal, category `Milestone`, priority P3.
- Surfaced inline on the Bridge and woven into the next Morning/EOD Rhythm ("Before we finish today…").
- Never repeated for the same threshold — idempotent by `(milestone_key, period)`.
- Never celebrated during safety-sensitive windows.

### 7d — Rhythm timing & delivery matrix

| Rhythm | Bridge | Email | Push |
|---|---|---|---|
| Morning Briefing | ✅ pinned card | ✅ if not yet read on Bridge | ✅ if notifications enabled |
| Midday Pulse | ✅ (silent unless material change) | ❌ (no routine emails) | ✅ *only* if genuinely important |
| End-of-Day Wrap-up | ✅ | Optional | ❌ unless urgent or explicitly enabled |
| Milestone Recognition | ✅ inline + folded into next Rhythm | Folded, never separate | ❌ |
| Weekly Review / Monthly Retro | ✅ | ✅ | ❌ |

**Principles**:
- **Same briefing across channels.** Never generate different versions per channel. The Bridge is the source of truth; email and push simply bring Garry back into FriendPlace.
- **No duplication.** If Garry has already read today's briefing on the Bridge, George doesn't email him the same information later.
- **Inactivity-aware.** EOD wrap-up defers if Garry is still active in MCGS — waits until ~30 min inactivity, then delivers. If he stays active into the evening, skip it. George should feel considerate, not scheduled.
- **Timezone & schedule are admin-configurable** from day one (default Australia/Melbourne, weekday/weekend split, quiet hours).

### 7b — Vacation mode
Explicit and safe:
- **P0** — immediate push + email as usual.
- **P1** — held; delivered in a single scheduled daily summary at 07:00 unless it escalates to P0.
- **P2–P4** — held for next Morning Briefing.
- Routine approvals remain queued.
- Optional acting-admin **delegation** (Phase 9) reroutes P0/P1 to a chosen human.
- George voice-line at toggle-on: *"Vacation mode is on. I'll only interrupt you for something genuinely urgent."*

### Morning Briefing template (structure locked · opener rotates)

The **structure** is locked so Garry can scan it in seconds. The **opener** rotates from a small library of warm phrases so it never feels scripted:

- *"Good morning, Garry. Hope you had a good evening."*
- *"Good morning, Garry. Hope you're doing well."*
- *"Morning, Garry. Ready for another day?"*
- *"Morning, Garry. It's a fresh one."*
- *"Good morning, Garry. Nice and quiet overnight."* *(only if that's true)*

Never scripted, never over-familiar. George rotates deterministically per day so no opener repeats twice in a week.

```
🦋 [Rotating opener], Garry. Here's your Friday briefing.

What changed overnight
   • …grounded facts…

What needs your attention
   • …grounded, prioritised…

What can wait
   • …grounded, reassuring…

Where I'd start
   • one specific, human suggestion

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

### Phase 4 — Health Pulse + Conversational Event Creation
**Health Pulse**
- Nightly ring computation
- Right-rail Bridge widget with contribution transparency
- Drill-down chart page in Systems → Analytics
- `mcgs_settings_history` for weight audit

**Conversational Event Creation (Garry, 19 July 2026)**
> *"Most platforms make people fill in forms. FriendPlace could simply let people talk to George."*

Instead of a create-event form, an organiser (or Garry on their behalf) can describe an event in natural language — voice or text — and George extracts every field, infers sensible defaults, and produces a **fully completed event draft as an Action Preview**. Nothing is created until a human taps *Approve*.

- Input: free-form conversation ("we're running a coffee morning next Tuesday at the community hall from 10 to noon, £3 per head, open to over-60s").
- Extractor tool: `george.tools.event_extractor` — deterministic schema extraction with confidence per field.
- Inferred defaults: George fills gaps from org profile, venue history, past events, and current season (never invented).
- Missing critical fields: George asks *one warm question at a time* to complete the draft (no wall of form fields).
- Output: standard event draft in the existing pipeline — same review queue, same publish flow, same audit trail. No new admin path.
- Voice-first: the whole flow works over the Ask George bar; the microphone is the primary create-event affordance.
- Safety: same Action Preview lock as every other George write — the draft is visible, editable, and requires human approval.
- Grounded: every inferred value shows its source ("start time from previous events at this venue"), never invented.

This turns event creation from data entry into conversation — the defining test that FriendPlace treats organisers as humans, not form-fillers.

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

**North star vision (Garry, 19 July 2026):**
> Garry walks into the office, taps the microphone, and says: *"Morning, George."*
> George replies: *"Morning, Garry. Hope you had a good evening. It was fairly quiet overnight..."* and reads the Daily Briefing aloud, warm and calm.
>
> Milestone E delivers the voice half; Phase 2 delivers the Briefing half; together they make this real. Every design choice in Ask George and Rhythms should protect this experience.

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
| 2026-07-18 | Butterfly is the leading glyph on the Ask George bar | Consistency between MCGS and mobile George |
| 2026-07-18 | Voice input default = **tap-to-toggle**; hold-to-talk optional | Natural for longer conversations and briefings |
| 2026-07-18 | Voice recording UX: clear recording state, live timer, partial transcription, prominent stop/cancel, silence auto-stop (3s default), 60s max, transcript review before send | Predictability and admin control |
| 2026-07-18 | Signal Feed sort = priority-first, then recency; P0 always top | Ops-centre principle — most urgent visible first |
| 2026-07-18 | Undo window = 30 s for reply-type actions; no undo for simple state changes (which remain reversible manually with full audit trail) | Balances safety and workflow speed |
| 2026-07-18 | Signals always render as Cases in the Feed, even when only one Signal is attached | Consistent UI; additional Signals can attach without visual reflow |
| 2026-07-18 | **Voice safeguard:** George never executes a consequential action from voice alone — always surfaces an Action Preview requiring an explicit written/tapped confirmation | Trust, safety, brand promise |
| 2026-07-19 | George's tone protected: colleague not database; celebrate milestones; state "everything's smooth" when it is; remember context across follow-ups | Trust and warmth are FriendPlace's defining characteristics |
| 2026-07-19 | "Morning, George" recorded as North Star for MCGS voice + Rhythms | Guides every design choice in voice UX and Daily Briefing |
| 2026-07-19 | **George's personality is product architecture** — not prompt wording. Adds emotional continuity across turns and "celebrate people not numbers" (e.g. *"Twelve more people have found FriendPlace this week"*). | Personality is one of FriendPlace's defining assets |
| 2026-07-19 | **Graceful failure for voice**: any uncertainty (low-confidence transcription, mic permission, network hiccup) is explained in calm human language. Never expose technical errors. | Trust and warmth extend to error moments |
| 2026-07-19 | **Interruptible speech** captured as a Phase 2 roadmap item — if George is speaking and Garry starts talking, George stops and listens. | Makes conversations feel truly natural |
| 2026-07-19 | **George's personality locked**: warm, optimistic, gentle sense of humour. Kind never sarcastic. Never joking during safety/mental-health/hard-news moments. Goal: "George made me smile today." | People should enjoy talking to George, not just use him. Personality is a defining FriendPlace differentiator. |
| 2026-07-19 | **Long-term familiarity principle**: George should become more familiar over time without becoming casual. Always professional, but as months and years pass he can naturally sound more like someone Garry has worked alongside for a long time — never over-familiar, never robotic, just naturally comfortable. Familiarity accrues from shared history (past decisions, recurring people, seasonal patterns), not from cheekiness. | George is a colleague, and colleagues get more comfortable with each other over years. This locks the growth arc so we never trade professionalism for warmth or vice versa. |
| 2026-07-19 | **Morning Briefing opener rotates** from a small warm library so it never feels scripted; structure remains locked. | Predictable structure, unscripted human voice. |
| 2026-07-19 | **Milestone Recognition** added as a first-class Rhythm — quiet, ambient, no push, no confetti. Folded into the next Rhythm as *"Before we finish today…"*. | Milestones aren't reports; they're moments worth naming. |
| 2026-07-19 | **EOD is considerate, not scheduled** — defers while Garry is active, waits ~30 min inactivity, skips entirely if he stays active into the evening. | George should feel considerate. He isn't a scheduler. |
| 2026-07-19 | **Rhythm delivery matrix**: Bridge is source of truth. Morning = Bridge + email + push. Midday = Bridge + push only if truly important, no routine email. EOD = Bridge + optional email, push only if urgent. Same content across channels. No duplication if already read on the Bridge. | Channels work together, they don't duplicate each other. |
| 2026-07-19 | **Rhythm schedule & timezone are admin-configurable from day one** (default Australia/Melbourne, weekday/weekend split, quiet hours). | Rhythms must fit Garry's life, not the other way around. |
| 2026-07-19 | **Conversational Event Creation** added to Phase 4: George drafts a complete event from natural conversation (voice or text), infers defaults from grounded sources, asks one warm question at a time for missing critical fields, produces an Action Preview — never creates without human approval. Voice-first via Ask George bar. | Most platforms make people fill in forms. FriendPlace lets people talk to George. |
| 2026-07-19 | **Morning Briefing ages with the day** — the opener adapts to LOCAL_NOW. Same briefing content, different arrival time: "Good morning" / "Good late morning" / "Afternoon" / "Evening — here's how the day looked." | An 11:30am open should not still greet you as if it's 7am. |
| 2026-07-19 | **"One thing that caught my eye"** — optional `noticed_line` on every Rhythm output. George names the unexpected in one warm sentence, only when something genuinely stands out. Never invented. | Makes briefings feel personal and observant, not scripted. |
| 2026-07-19 | **Recommendation adapts to reality** — never a fixed phrase. Busy days point to the queue; quiet days suggest "checking in with organisations"; smooth days say "everything is running smoothly, keep an eye on new activity". | Reduces decision fatigue while staying honest about the day. |
| 2026-07-19 | **Briefing concision** — target read time 30–60 seconds, under ~150 words when possible. Always leave Garry wanting more. If he wants detail, he asks. | A brief that overwhelms defeats its purpose. |
| 2026-07-19 | **One briefing per day rule** — if Garry asks Ask George for his briefing before the scheduled cron fires, that becomes today's official briefing. The scheduler will not generate a second version later. Enforced by the unique `(admin_id, rhythm_type, date_key)` index. | There is exactly one Morning Briefing per day. |
| 2026-07-19 | **Rhythm delivery dedup** — email/push skip when `bridge_seen_at` is set. "If I've already read it on the Bridge, don't email me the same thing later." | Channels work together; they don't duplicate each other. |
| 2026-07-19 | **Push channel graceful degrade** — MCGS pushes are best-effort. If the admin's email isn't linked to a mobile-app user account, push is skipped cleanly with `skipped_no_linked_mobile_user`. Bridge + email continue to cover the admin. | Never dead-end because one channel isn't wired. |
| 2026-07-19 | **Recommendation heading rotates** — George chooses per briefing from "If I were in your shoes…" / "My suggestion" / "What I'd tackle first" / "Where I'd start" / "One thing I'd do". Advice, not a report. | Reinforces that George is giving advice, not presenting a report. |
| 2026-07-19 | **Rotating closing acknowledgements** — after Garry taps "Got it, thanks", George sometimes (~65%) replies with a warm one-liner: "I'll keep an eye on things." / "Have a great day." / "Just call if you need me." / "I'll let you know if anything important changes." / "I'll be here." / "Enjoy your morning." Deterministic per briefing id — never repeats within the same briefing view. | Feels present without being performative. |
| 2026-07-19 | **Midday Pulse gate** — fires only on material change since morning: new P0/P1, milestone landed, approvals depth crossed threshold, or high-confidence anomaly. Otherwise silent (no row persisted, no delivery). | Silence is a feature. |
| 2026-07-19 | **Midday push = "genuinely important" only** — push fires on P0/P1/milestone signals since morning. Approvals-queue-depth alone stays Bridge-only, no push, no email. | Midday should never interrupt for routine things. |
| 2026-07-19 | **Per-rhythm channel policy** locked into `delivery.py`: morning = Bridge + email + push, midday = Bridge + push, EOD = Bridge + optional email, milestone = Bridge only. Same content across channels. | Channels play different roles by design. |
