# MCGS Phase 1 — v1.0 Baseline (frozen)

**Signed off:** Garry, 19 July 2026
**Status:** FROZEN. Any change to George's personality, tone, groundedness rules, safeguards, or Action Preview pattern requires an explicit product-level decision — not a routine implementation change.
**Purpose:** Regression baseline for all future MCGS work.

---

## 1. What shipped in Phase 1

- **Signals + Cases + state machine** with deduplication by `case_key`
- **Channel-agnostic Signal event bus** (SSE today, push/email/mobile plug in later without refactor)
- **Chief-of-Staff George** — grounded two-pass chat (Haiku planner + Sonnet synthesizer)
- **11 read-only tools** + 2 write-proposal tools, all with strict arg schema validation
- **Ask George bar** — persistent on every MCGS screen, ⌘K global focus, voice + text
- **The Bridge** landing page with Signal Feed, George Presence Card, Rhythm placeholders
- **Action Preview pattern** — WHAT / WHY / SOURCES / CONFIDENCE / DRAFT · Send / Edit / Dismiss · 30s undo · voice safeguard
- **Voice pipeline** — Whisper-1 STT + OpenAI TTS via Emergent LLM key, tap-to-toggle, silence auto-stop, 60s cap, transcript review before send, TTS playback with graceful failure
- **Prompt-injection defence** — 12-string regression suite passing 12/12 on both classifier and George's behavioural refusal

## 2. What George *is* — locked personality

Frozen text in `/app/backend/services/george/prompt.py` (`CHIEF_OF_STAFF_PERSONA` and `ANSWER_STYLE`) at commit-time of Phase 1 sign-off. Behavioural summary:

- Warm, optimistic, gentle sense of humour. Kind, never sarcastic, never at a member's expense.
- Knows when NOT to joke (safety, mental health, hard news → straight care, no levity).
- **Grounded answers only.** Every fact must come from tool_results. If missing, says *"I don't have enough information to answer that yet."*
- **Never uses "AI" language.** He is simply George.
- **Never executes consequential actions.** Everything writeable lands as an Action Preview requiring an explicit tapped or written confirmation.
- **Confidence as labels**, never percentages: High / Moderate / Low.
- **Celebrate people, not numbers.** Prefer *"Twelve more people have found FriendPlace this week"* over *"twelve new signups"*.
- **Emotional continuity.** Carries tone across turns — no reset to breezy after a hard topic.
- **Restraint before drafting.** Comfortable saying *"I'd rather not draft that yet"* or asking a clarifying question first.
- **Introduces proposals conversationally.** Warm sentence before an Action Preview so it feels like a colleague handing you work, not a form.
- **Graceful failure.** Voice errors surface in human language, never technical detail.

**North Star:** *"Morning, George." → "Morning, Garry. Hope you had a good evening. It was fairly quiet overnight…"*

**Goal:** People say *"George made me smile today"* — not *"the AI was good."*

## 3. Voice safeguard (locked absolute)

No voice command may execute a consequential action. Voice can *create* a proposal but every send / publish / warn / suspend / approve / reject requires an explicit tapped or written confirmation. The write-tool "propose" pattern is invoked identically regardless of input channel — there is no voice shortcut.

## 4. Frozen files (do not alter without product review)

| Path | Role |
|---|---|
| `/app/backend/services/george/prompt.py` | Persona + Operating Rules + Answer Style |
| `/app/backend/services/george/chat.py` | Two-pass grounded chat |
| `/app/backend/services/george/tools.py` | Read-tool allow-list + arg validation |
| `/app/backend/services/george/proposals.py` | Ticket-reply + submission-decision drafters |
| `/app/backend/services/george/triage.py` | Haiku triage |
| `/app/backend/services/mcgs/signals.py` | Signal + Case state machine · injection classifier · dedup |
| `/app/backend/services/mcgs/events.py` | Channel-agnostic event bus |
| `/app/backend/services/mcgs/actions.py` | Ticket-reply + submission-decision execution |
| `/app/backend/services/mcgs/audit.py` | Append-only activity log |
| `/app/backend/mcgs_module.py` | API surface `/api/mcgs/*` and `/api/george/*` |
| `/app/backend/tests/mcgs/test_prompt_injection.py` | 12-string regression suite |
| `/app/website/components/mcgs/AskGeorgeBar.tsx` | Persistent bar (voice-first) |
| `/app/website/components/mcgs/AskGeorgeSheet.tsx` | Chat sheet + Action Preview render |
| `/app/website/components/mcgs/ActionPreview.tsx` | Draft-and-confirm surface |
| `/app/website/components/mcgs/SignalFeed.tsx` | Bridge feed + SSE refresh |
| `/app/website/components/mcgs/SignalCard.tsx` | Case rows |
| `/app/website/components/mcgs/GeorgePresenceCard.tsx` | Right-rail George |
| `/app/website/app/admin/bridge/page.tsx` | The Bridge |
| `/app/website/lib/use-voice-recorder.ts` | Voice recording hook |
| `/app/website/lib/mcgs-api.ts` | Client API |

## 5. Regression baseline — must pass on every future release

1. `python /app/backend/tests/mcgs/test_prompt_injection.py` — **12/12 on classifier, 12/12 on George behaviour, no system-prompt leakage.**
2. `testing_agent` full sweep against the 15 Phase 1 items in `/app/memory/mcgs-phase1-plan.md §13` — **15/15 pass.**
3. Live check on The Bridge: *"How many events are awaiting review?"* returns a warm, grounded, colleague-toned reply weaving the number into a sentence.
4. Live check: *"What is our current Belonging score?"* returns an honest *"I don't have enough information to answer that yet"* (Health Pulse Phase 4).
5. Any voice error path produces calm human wording, never a raw error string.
6. Any consequential action without `confirmed: true` returns 400 (voice safeguard).

## 6. Phase 1 sign-off record

- Milestones A → F, each approved after live demonstration
- Final `testing_agent` sweep: 15/15 PASS, 33s
- Prompt-injection regression: 12/12 PASS
- Report: `/app/test_reports/iteration_68.json`
- Pytest: `/app/test_reports/pytest/iter68_mcgs_phase1.xml`
