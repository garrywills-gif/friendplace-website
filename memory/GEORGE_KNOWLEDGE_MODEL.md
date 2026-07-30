# George's Institutional Knowledge — Design Contract

**Status:** designed, not yet built. Awaiting sign-off.
**Aspiration (Garry):** *"George should become the living knowledge base for FriendPlace. Not because he's pretending to be me, but because he understands the platform and shares the same goal: helping FriendPlace succeed."*

## The four honesties George must maintain

Non-negotiable behaviours that keep the system trustworthy:

1. **Cite or admit.** Every substantive answer either grounds itself in a knowledge-base entry (with the source shown) or explicitly says: *"I don't have a documented decision on this yet."* No confident guesses.
2. **Superseded over deleted.** When a decision changes, we *supersede* the old entry (kept for history) rather than overwriting it. George can then explain "we used to do X; we changed to Y in March because Z."
3. **Currency awareness.** Every entry has `updated_at` and George notes when he's drawing on something older than 90 days without recent confirmation.
4. **Learn, don't invent.** When a user tells George new information ("we decided last week that Coffee Lounge posts auto-expire"), George offers to record it as a fresh KB entry — but only after human confirmation. He never silently absorbs new state.

## Architecture — hybrid, not just embeddings

Pure semantic search hallucinates on nuance ("why did we NOT list members publicly?" needs to match a decision *against* something). Pure keyword search misses paraphrase. We combine:

```
Every George turn:
  1. Fast intent classifier picks up "why", "how", "when did we", "what's still",
     "explain", "current state of", etc. → triggers KB retrieval.
  2. Hybrid retrieve: BM25 (Mongo text index) + vector cosine, then RRF-fuse.
  3. Top 5 entries prepended to the LLM prompt with source markers.
  4. LLM answers ONLY from those markers; if none matches, answers "unknown."
  5. Citations rendered in the reply as small footnotes ("KB-042 · Coffee Lounge design").
```

Embeddings via the existing Emergent LLM key (OpenAI `text-embedding-3-small` — same key already used for TTS/chat). No new integration.

## Data model — one collection, five entry types

`knowledge_base` collection:

```
{
  id, type, title, body_md, tags: [], sources: [{label, url|path}],
  status: "active" | "superseded" | "draft",
  superseded_by: id | null,
  authored_by, updated_at, updated_by,
  embedding: [float, …],   # OpenAI text-embedding-3-small (1536 dim)
  confidence: "canonical" | "working" | "provisional",
  effective_from, effective_to
}
```

Entry types (`type`):

| Type | What it captures | Example |
|---|---|---|
| **story** | The identity, origin, and emotional truth of FriendPlace | *"Why George is a butterfly · Why we don't chase engagement · The meaning behind 'Because you belong too.'"* |
| **principle** | Foundational values that shape everything | *"Public site is a Visit to a Quiet Host, not a marketing brochure."* |
| **decision** | ADR — an architectural / product decision + why | *"KB-042 · Coffee Lounge posts don't cross-post to Groups. Reason: preserves the ambient, low-pressure tone."* |
| **feature** | How a specific feature works today | *"Register Your Interest form fields, endpoint, email flow."* |
| **roadmap** | Planned / in-progress work | *"Slice 1 Member Management — status: in progress, ETA…"* |
| **philosophy** | Higher-order guidance for judgement calls | *"Moderation is a conversation, not enforcement — start with the smallest intervention that could work."* |

**`story` is distinct from `principle` and `philosophy`.** Principles are the values we act by; philosophy is how to think when the values conflict; story is *why any of this exists at all*. When someone asks "why does FriendPlace exist" or "why is George a butterfly", the answer comes from the story — not the architecture.

## Connections — George synthesises, not just retrieves

The MVP hybrid-retrieval returns entries independently. That's not enough. George should occasionally *connect* the entries into a fuller answer:

> "The moderation philosophy you're asking about comes from the **Community Principles** we wrote in May [KB-018] and was reinforced again during the **Member Management redesign** [KB-072]."

> "This decision **superseded the earlier approach** [KB-011] because we later decided George should behave more like a **companion than an assistant** [KB-034]."

Implementation, layered onto the retrieval step:

1. **Explicit `related_ids: []` field** on every KB entry. Populated when an entry is authored (author picks related entries from a dropdown) OR when an entry supersedes another (auto-link).
2. **When George retrieves the top-5**, we also pull each hit's `related_ids` and include their titles (not full bodies — just titles + one-line summary) so the LLM has the *shape* of the wider context.
3. **Supersede chain always surfaces.** If any retrieved hit has `superseded_by`, we also fetch the newer version. George explains both, in that order.
4. **Instruction in the system prompt:**
   > *"When multiple entries relate to the question, connect them explicitly. Say things like 'this reinforces…', 'this superseded…', 'this stems from…' when the sources genuinely tie together. Never invent connections that aren't in the entries."*

That last sentence keeps the fourth honesty (*learn, don't invent*) intact.

The MCGS Knowledge page shows a small **"See related"** area on every entry — clicking any related title jumps to that entry. Same data, both audiences.

## Seeding — start with what already exists

FriendPlace has months of decisions crystallised across the repo. First seed doesn't require Garry to write anything new — it harvests documents we already have:

| Source doc | Ingested as |
|---|---|
| `/app/website/PUBLIC_EXPERIENCE_PRINCIPLES.md` | principles + philosophy |
| `/app/JOURNEY_CONTINUITY.md` | decisions + roadmap |
| `/app/memory/MCGS_MIGRATION_AUDIT.md` | roadmap (per slice) + decisions (safeguard contracts) |
| `/app/memory/MCGS_SECURITY_MODEL.md` | decisions + features |
| `/app/website/DEPLOY.md` | features + roadmap |
| Slice 0 / 0.5 completion notes | decisions with `effective_from` set |

A one-shot script `/app/backend/scripts/seed_george_kb.py` chunks these into KB entries, tags them, embeds them, and writes to the collection. Idempotent — re-running updates entries whose source `mtime` is newer.

## MCGS Knowledge library (`/admin/knowledge`)

Sixth tab in the sidebar (System group, alongside Security). Two roles:

1. **Browse** — search by keyword, filter by type / tag / status. Every entry shows its full markdown, sources, when it was last updated, when it becomes stale.
2. **Author** — three inline flows:
   - **Add entry** — Garry writes a decision or principle directly. George can suggest tags + a title from the body.
   - **Confirm George's proposal** — when George detects new information in chat ("we decided last week…"), he creates a `draft` entry. Draft entries appear in a top-of-page "Awaiting your confirmation" strip. Garry hits **Confirm** or **Discard**. Only confirmed entries influence future answers.
   - **Supersede** — replace an existing entry with a newer version. Old entry stays visible in the timeline of that topic.

Every write hits `admin_log` (Slice 0) with `action: "kb.entry.create|update|supersede|discard"`.

## George's presence — how retrieval reaches him

Existing George infrastructure already prepends context (memory, tools, milestones). We add one more step to `services/george/chat.py`:

```python
# Existing pre-prompt assembly:
system = base_system + memory_snapshot + tool_catalogue

# NEW step — add before user message:
if _classify_needs_kb(user_message):
    hits = await kb.retrieve(user_message, k=5)
    if hits:
        kb_block = "\n\n## Institutional knowledge you should draw from:\n"
        for h in hits:
            kb_block += f"\n[{h.id} · {h.title}]\n{h.body_md}\n(source: {h.sources[0].label})\n"
        kb_block += (
            "\nRules:\n"
            "- Answer ONLY from these entries and prior chat memory.\n"
            "- If none of the entries fully answer the question, say so explicitly.\n"
            "- Cite the entry id when you use one, in the form [KB-042]."
        )
        system += kb_block
```

The system prompt also carries the four honesties above so George never drifts.

## Concrete answers to Garry's example questions

Once seeded, these become instant:

- *"Why did we design Coffee Lounge this way?"* → matches `decision` KB-Coffee-Lounge-Design.
- *"Why don't we publicly list members?"* → matches `principle` "The visit is quiet" + `decision` "No public member directory".
- *"How does moderation work?"* → matches `philosophy` "Moderation is a conversation" + `feature` "Moderation history model".
- *"What's still outstanding before launch?"* → matches `roadmap` entries with status ≠ done, ordered by ETA.

For each, George's reply lands with `[KB-XXX]` citations Garry can click to open the source entry.

## What we're NOT building yet

- **Auto-ingestion of every file change.** Manual re-seed (or a "Refresh KB from docs" button on the Knowledge page) is enough for now.
- **Multi-hop reasoning across many entries.** MVP shows top-5 and lets George summarise; deeper synthesis waits until we see the quality gap.
- **Public/member-visible KB.** This is strictly for admins.
- **Automatic 2FA-style write authority.** All KB writes remain confirmed by an admin.

## Known follow-ups from Phase 1 build

- **Embeddings gateway URL.** The current `_embed()` tries `api.emergent-integrations.com/v1` and falls back to direct OpenAI. Emergent LLM keys don't authenticate at OpenAI's endpoint, so embeddings currently fail silently and retrieval falls back to keyword-only (via Mongo text index). This is fine for the seeded 17-entry KB — every canonical question resolves to the correct top hit — but should be fixed before the KB grows to hundreds of entries. Options:
  1. Use the Emergent embeddings gateway URL (unconfirmed — needs playbook consult).
  2. Ship a small ONNX embedding model locally (e.g. `sentence-transformers/all-MiniLM-L6-v2`) — no external dependency, ~90 MB.
  3. Route embedding calls via emergentintegrations' `LlmChat` if it exposes an embeddings method.
- **Admin UI (`/admin/knowledge`).** Read endpoints exist; browse/author/supersede UI still to build.
- **Write endpoints.** create / update / supersede / discard-draft still to add.
- **Draft-from-chat flow.** George detecting new info and proposing a draft entry still to wire.

## Build plan (2–3 focused steps)

1. **Backend** — `services/knowledge.py` (retrieve, embed, ingest, chunk); `knowledge_base` collection + Mongo text index + embedding field; endpoints under `/api/cms/knowledge/*` (list, get, create, update, supersede, discard).
2. **Ingestion** — `scripts/seed_george_kb.py` for the six source docs above. Prints how many entries were created / updated.
3. **George integration** — hook `_classify_needs_kb` + retrieval into `services/george/chat.py` right before the LLM call; add citation formatting.
4. **MCGS UI** — `/admin/knowledge` page (browse + author + supersede + confirm draft flow) and sidebar entry.
5. **Test** — seed → ask George three example questions → verify each cites the correct entry → author one new entry from chat → confirm it → verify subsequent answers use it.

Estimated: 1–1.5 build days for a solid MVP.

---

## Sign-off requested

Before I open the build, please confirm:

1. **Approach OK?** Hybrid retrieval (BM25 + embeddings), unified KB collection, five entry types, cite-or-admit answers.
2. **Seeding scope?** Six existing docs listed above — good first pass, or add / remove any?
3. **Draft-entry confirmation flow?** George proposes drafts from chat; you confirm before they influence future answers. Or would you rather George never author drafts, and you write every entry?
4. **Where does this sit in the queue?**
   - **A.** Immediately after Slice 0.5 (before finishing Slice 1). Adds ~1.5 days, but every remaining slice benefits from George knowing more.
   - **B.** After Slice 1 (Member Management) completes. Keeps focus on the migration.
   - **C.** After all 10 slices — Mission Control 2.0 timing.
