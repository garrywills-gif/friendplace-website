# Segments — captured future ideas

Garry's ideas for the Segments feature that we've deliberately *not*
built yet, but want to remember when we come back.

## 🫀 Heartbeat / trend indicators (captured 1 Aug 2026)

Show each segment card with a small delta:

    🌱 Gardeners
    5 members
    ⬆️ +2 this month

or:

    ☕ Coffee Lovers
    143 members
    ⬇️ −3 this week

**Why we're not building it now**: needs historical snapshots we don't
yet capture. Garry: *"Seeing communities grow or shrink over time
would be really interesting. No need to build that now — I just
wanted to capture the idea while it was fresh."*

### Implementation sketch (for future us)

1. Add a nightly job (or on-demand refresh) that inserts into
   `segment_count_history`:

       { segment_id, at, count }

   One row per segment per day. Cheap (12 segments × 365 days ≈ 4380
   docs/year).

2. On the segment card, compute the delta at N days ago:

       last_count - count_at(now - Nd)

   Show ⬆️ / ⬇️ / → based on sign; hide entirely if we don't yet
   have a snapshot from N days ago.

3. Windows to surface: week / month / quarter. Probably just show
   the most recent notable one on the card, with all three visible
   in the segment detail view.

4. George tool: `get_segment_trend(name_or_id, window_days)` — so
   admins can ask *"which segment has grown the most this month?"*
   and George can answer from real historical data.

## Other captured ideas

Ideas Garry has floated but we haven't scheduled yet:

- **Suggest segments** during campaign creation: *"This looks like a
  good campaign for the Gardening segment"* — needs an LLM step that
  reads the campaign body and matches against saved segments'
  descriptions / predicates.
- **"Members like these"** — sample-of-6 → semantic expansion to a
  larger group. Would need per-user embeddings on top of the KB
  embeddings we already have via fastembed.
