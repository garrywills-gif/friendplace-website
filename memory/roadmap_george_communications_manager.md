# George — Future Capability: Communications Manager

**Requested by:** Garry (Batch-4 QA, Jul 2026)
**Status:** Roadmap. Not for the current polish phase.
**Bundle with:** Larger George capability phase (L1–L6, drafts + approvals).

---

## Principle

Whenever George investigates something, he should also be able to draft the
communication that goes with it. He is not just an oracle — he is a
Chief of Staff who prepares the work and leaves review + approval to
Garry.

## Scope of drafts

- Support ticket replies
- Event approval / rejection emails
- Moderation and safety responses
- Member enquiries
- Welcome emails
- Founding Member emails
- Newsletters
- Release notes
- Website copy
- Social media announcements

## Non-negotiable rule

**George never sends external communications automatically.**
Every draft goes through:

```
Investigate  →  Draft  →  Review  →  Approve & Send
```

The final "Send" is always a human click.

## Design implications

- Every "investigate X" flow must produce (a) findings + (b) a matching
  draft in a review queue.
- The Action Preview surface (Phase-1 Milestone D) is the right home
  for these drafts — it already supports review, edit, approve, send.
- Drafts should carry the same grounding metadata as George's spoken
  answers (tool results, sources), so the reviewer sees *why* the
  wording is the wording.
- Tone presets should be a first-class input on drafts (formal,
  reassuring, warm-and-brief, apologetic, celebratory, etc.).
- A Batch-4-style test-data flag (`is_test: true`) must be honoured by
  the Communications Manager too — drafts generated during automated
  test runs must never be sendable.

## Where this integrates with today's work

- **Support tickets** — closest to shovel-ready. Investigate ticket →
  draft reply → admin reviews → sends via Resend. Blocked only on the
  `/admin/support` web page (L1 of the deferred capability work).
- **Event submissions** — approval / rejection emails already have a
  template surface; George just needs to draft the body.
- **Safety signals** — moderation responses are the highest-stakes
  category and should ship last, with the tightest review UX.

---

_Filed by Neo, Batch 4, Jul 2026._
