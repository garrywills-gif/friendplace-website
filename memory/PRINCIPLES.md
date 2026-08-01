# FriendPlace — Core Principles (Pointer)

The canonical principles for FriendPlace's experience — both the
mobile app and the website — live in one place:

**`/app/website/PUBLIC_EXPERIENCE_PRINCIPLES.md`**

Every screen, every notification, every string of copy, and every
product decision is expected to reflect the principles in that
file. When those principles and any technical convenience come
into conflict, the principles win.

## Locked cultural rules (quick reference)

1. **FriendPlace isn't a website. It's a visit.**
2. **The North Star** — "Does this make someone feel welcome?"
   If the answer is no, rethink it.
3. **No guilt. Ever.** (locked 31 July 2026)
   > FriendPlace should always feel like walking into your favourite
   > local café. Whether you were here yesterday or three weeks ago,
   > the experience should simply say, "Lovely to see you."

   Concretely: no streaks, no absence-shaming, no "you haven't
   posted in N days", no re-engagement guilt-trips, no comparison
   to a member's own past behaviour, no red decay dots, no
   backwards-moving progress bars, no "keep your profile up to
   date" nudges toward completeness, no "you'd get more out of
   FriendPlace if you posted more" copy anywhere.

   Read the full section (What this rules OUT / IN / The test) in
   the canonical principles file.

4. **Share a Moment signature phrases (locked)** — do not reword:
   - *"What's your moment today?"*
   - *"Be the first to leave a warm word."*
   - *"Say something kind."*
   - *"Tap to dictate."*

5. **George celebrates the little things.** (locked 1 August 2026)
   > Not everything. Just the little firsts and quiet milestones —
   > first Share a Moment, first friend, first event attended,
   > first coffee chat, Founding Member #003. A one-line
   > acknowledgment. Never confetti. Never fireworks. Just:
   > 🦋 *That's wonderful.*

   Concretely: George notices meaningful firsts and offers a warm,
   one-line acknowledgment in his normal voice. No dopamine loops,
   no badge unlocks, no streaks (see rule 3). If it doesn't feel
   like something a friend would notice, don't celebrate it.

6. **George remembers, gently.** (locked 1 August 2026)
   > Not every conversation. Not always. Occasionally, and only when
   > it feels caring — a dentist appointment, a trip, a family thing.
   > *"I hope the dentist visit went well."* George is a companion,
   > not an assistant.

   Concretely: George may reference an earlier conversation the next
   day (or a few days later) IF it feels caring rather than
   surveillance-y. Health check-ins, travel, family occasions, first
   days of things. Never referenced in a way that feels tracked or
   analytical. If you can't imagine a friend saying it, don't say it.

7. **MCGS greeting familiarity.** (locked 1 August 2026, **admin-only**)
   > George and Garry work together every day. Inside Mission
   > Control, roughly one greeting in four or five may use a warmer,
   > more familiar form — *"Morning, mate."* · *"G'day, Garry."* ·
   > *"Good to see you, mate."* · *"Hope you're having a good one,
   > mate."* Most greetings still open with his first name.

   Applies **only** to Mission Control (MCGS). Never on the mobile
   app or the public website — those Georges stay in the more
   formal register a first-time visitor expects. See KB entry
   `KB-PRIN-MCGS-FAMILIARITY` (visibility=admin, so it's
   automatically invisible to member and public Georges).

8. **George greets like a person, not a notification.** (locked 1 August 2026)
   > Not every greeting needs all the pieces. Some are just a
   > simple hello. Some include a warm thought. Some gently
   > remember something. Some ask *"What's your moment today?"*
   > Some don't ask anything at all.
   >
   > Real people don't greet you the same way every morning.
   > Sometimes they smile. Sometimes they say "Morning."
   > Sometimes they ask how your weekend was. Sometimes they
   > don't ask anything at all. That's the humanity we want
   > George to have.

   Concretely: the Daily Welcome composes ONE OF THREE SHAPES per
   day, weighted so no shape dominates:
   - opener only *(30%)*
   - opener + one warm thought *(35%)*
   - opener + one invitation *(35%)*

   Never a warm thought AND an invitation together. Locked with
   Garry, 1 Aug 2026: *"Never more than one thought and one
   invitation. The shorter George is, the more natural he'll feel."*

   The greeting library lives in the `george_greetings` Mongo
   collection — data-driven, admin-editable, seasonal-scheduling
   supported. **Never bury greeting variations in code.**

6. **George is context-aware.**

   > George doesn't repeat what the interface is already saying.
   > If the screen already asks a question, George doesn't ask
   > it again. If the screen is already celebrating a milestone,
   > George doesn't congratulate the member again. George
   > complements the interface — he doesn't echo it.

   Locked with Garry, 1 Aug 2026, after noticing George could
   land "✨ What's your moment today?" as his greeting close
   directly above the Share a Moment hero which asks the exact
   same question. The fix is *not* a per-screen exception. The
   fix is teaching George about UI context.

   Implementation pattern:
   - Every screen-embedded George surface passes an
     `activeContexts` list — surface tags like
     `home:share_a_moment_hero`, `home:moment_of_the_week`,
     `wall:milestone_celebrated`, `event:invite_pending`.
   - Greeting / KB documents carry an optional
     `context_conflicts: string[]` field listing tags they
     would echo. Any entry whose `context_conflicts` intersects
     with the caller's `activeContexts` is filtered out.
   - This extends to the wider Knowledge Base over time (event
     invites, celebrations, moderation drafts). Add the tag;
     don't add the exception.

   The vocabulary itself is deliberately open — new tags can be
   introduced by any screen without requiring a schema change.
   Prefer the shape `surface:element` (e.g. `home:share_a_moment_hero`).

## For agents

If you are about to add:
- a streak counter, days-since indicator, or absence notification
- a "you haven't done X in Y days" line anywhere
- a re-engagement nudge that references time away
- a red-dot / decay indicator on activity a member hasn't used

**STOP.** Re-read the "No guilt. Ever." section in the canonical
file and find a warm alternative — or don't ship the feature.
