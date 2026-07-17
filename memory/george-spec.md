# George — the FriendPlace AI guide

**Status:** Approved for build (confirmed by Garry, 17 July 2026)
**Vision:** The butterfly becomes both FriendPlace's brand mark *and*
the way people ask for help. Tap the butterfly anywhere → "Ask George."

---

## What George is (and isn't)

George is a **friendly guide**, not a chatbot.

**Public framing (marketing copy MUST use):**
- "Your friend in the app"
- "Ask George anything"
- "The butterfly that helps you belong"

**Public framing NEVER uses (Garry's explicit ask):**
- ❌ "AI for older adults"
- ❌ "AI assistant for seniors"
- ❌ Any age-band language

FriendPlace's public branding is for **everyone**. Accessibility
features (voice, plain language, patience) benefit older users most,
but George is presented as universally welcoming.

---

## Personality (system-prompt gospel)

George is:
- **Kind** — always leads with warmth
- **Patient** — never rushes, never sighs
- **Calm** — steady voice even when the user is anxious
- **Encouraging** — celebrates small wins ("Great, you found it!")
- **Never judgmental** — "no such thing as a silly question here"
- Uses **simple, everyday Australian English** — no jargon, no
  americanisms, no emoji-spam
- Comfortable saying: *"I'm not sure about that, but let's work it
  out together."*

George is NOT:
- A comedian
- Formal or corporate
- Overly cheerful
- A search engine that rattles off facts
- Somebody who calls the user "buddy", "pal", "champ", or "friend"
  in a hollow way. He uses their actual name when known.

---

## Model plan (Garry's choice: 1c)

| Situation                          | Model                        | Why                            |
| ---------------------------------- | ---------------------------- | ------------------------------ |
| Greetings, small talk, most Q&A    | **Claude Haiku 4.5**         | Fast, cheap, warm enough       |
| Long or nuanced questions          | **Claude Sonnet 4.5**        | Better reasoning + tone        |
| Safety topics (see below)          | **Neither — scripted lookup** | Zero-latency, zero-risk        |

Routing logic (server-side, hidden from user):
- Length of user turn > 200 chars **OR** context memory > 3 turns
  **OR** classified as "how do I…" — route to Sonnet
- Everything else → Haiku
- Sensitive keyword match → skip LLM, return scripted response

Both models via the **Emergent LLM key** (no separate billing).

---

## Voice pipeline (Garry's choice: 2a)

- **Tap-to-speak (STT):** OpenAI Whisper-1 via Emergent LLM key
- **Tap-to-listen (TTS):** OpenAI TTS via Emergent LLM key
  - Voice: warm alto ("nova" or "shimmer" — A/B test with Garry)
  - Speed: 0.95x default (slower helps everyone, not just older users)

Fallback: if the network is slow, degrade gracefully to text-only.

---

## Where George lives (Garry's choice: 3c)

**Mobile app:**
- **Floating butterfly bubble** in the top-right during:
  - Onboarding flow
  - First 7 days after signup
- **After day 7:** butterfly disappears from the floating bubble and
  lives only as a dedicated **tab bar button** (5th tab, matching the
  Chats tab pattern shipped last session)
- Long-press the floating bubble = mute for the current session
- The tap always opens a **bottom-sheet** ("Ask George") — never a
  full-screen takeover — so the user keeps context of where they were

**Mission Control (website admin):**
- Small butterfly button in the top-right of the sidebar header
- Same conversation UI, but with an admin system prompt that
  understands the CMS (see below)

---

## Memory (Garry's choice: 4b)

**Short-term:** keep the last 5 chats per user, stored in a new
`george_chats` collection:

```
{
  id,
  user_id,
  started_at,
  last_active_at,
  turns: [{ role: "user" | "george", content, ts }],
  ended: bool,
}
```

- Rolling window: when the 6th chat starts, evict the oldest.
- User can wipe history from Settings → "Forget George's memory".
- Privacy: nothing is used for training. Ever.

---

## Safety net (Garry's choice: 5b — the smart middle path)

George answers **naturally** for everyday questions. But when the
user's turn contains any of a curated list of **sensitive keywords /
intents**, we bypass the LLM and return a **FriendPlace-approved
scripted response** — edited by Garry inside Mission Control.

**Sensitive intent categories (v1):**
1. Meeting people in person
2. Personal safety / feeling unsafe
3. Sharing addresses or personal contact info
4. Money / gifts / financial requests
5. Scams / suspicious behaviour
6. Self-harm / mental-health crisis (highest-priority — always shows
   Lifeline 13 11 14 and a "talk to a real person" button)
7. Legal / medical advice

**CMS surface:** new "George scripts" section in Mission Control,
one row per intent, with a rich-text answer + a "handoff" toggle
(e.g. Category 6 always includes the human handoff button).

Every triggered safety response is logged so Garry can audit them.

---

## Handoff phrase (editable in Mission Control)

Default: *"That's a good question. Let me put you in touch with a
real person from the FriendPlace team — they'll be able to help
properly."*

Triggered by any of:
- Sensitive intent category 6 (always)
- User explicitly asks for a human
- George has said "I'm not sure" twice in a row

---

## Build plan (phased)

### Phase 1 — George in Mission Control (foundation)
Smallest surface area, safest place to iterate the personality.
- [ ] Backend: `/api/george/chat` (stream), `/api/george/history`
- [ ] Prompt engineering — personality doc as system prompt
- [ ] Routing between Haiku ↔ Sonnet
- [ ] Sensitive-keyword classifier (regex + small allow-list first,
      LLM-classified in phase 3)
- [ ] Butterfly button in AdminShell sidebar header
- [ ] Ask George bottom-sheet modal (same design pattern the mobile
      app will use)
- [ ] Admin system prompt with knowledge of the CMS
- [ ] Store history in `george_chats`

### Phase 2 — George in the mobile app (text)
- [ ] Floating butterfly bubble component (7-day auto-fade)
- [ ] Tab bar button (permanent from day 8)
- [ ] Same bottom-sheet UI
- [ ] Uses the user's display name

### Phase 3 — Voice pipeline
- [ ] Mic button in the bottom-sheet — records → Whisper STT → sends
- [ ] Play button on every George reply — TTS → plays with waveform
      visualisation
- [ ] Auto-play toggle in Settings (default: off)

### Phase 4 — Mission Control script editor
- [ ] "George scripts" section with sensitive-topic rows
- [ ] Rich-text answers, per-topic handoff toggle
- [ ] Trigger log: table of every triggered safety response with
      user_id (or anonymous), topic, timestamp

### Phase 5 — Polish
- [ ] Voice A/B test between "nova" and "shimmer"
- [ ] Waveform animation on speak & listen
- [ ] Onboarding intro: "Hi, I'm George. Tap the butterfly any time."
- [ ] Emergency card design (Lifeline etc.) for mental-health topics

---

## Success metrics (post-launch)

- % of new users who open George in their first 3 days
- Median turns per George session (target: 3–5)
- % of George sessions that end in a human handoff (target: <5%)
- Sensitive-topic trigger rate by category
- Voice usage rate (STT and TTS separately)
- User "forget my history" clicks (privacy signal)

---


---

## 💰 Cost model — LOCKED (17 July 2026, Garry's decision)

**Framing rule (must never be violated):** FriendPlace+ is a
**membership that includes benefits**. George is one of those
benefits. George MUST NOT be described, marketed, or presented as
"a paid feature" or "premium AI".

### Free FriendPlace (default for everyone)

Every user gets a genuinely useful experience with no pressure to pay:

- **~50 George messages per day** (starting figure; tune with real usage)
- **Voice support included** within that allowance (STT + TTS count as messages)
- **Full access** to finding friends, groups and events
- **RSVP to events** (subject to individual event capacity)
- The complete core FriendPlace experience

### FriendPlace+ (~AU$5/month)

A membership, not a paywall. Includes:

- **Unlimited George** conversations
- **Unlimited voice** conversations
- **Priority event RSVP** where appropriate (auto-jumps waitlist)
- **Larger photo uploads**
- **Early access** to new features
- **Additional premium features** as FriendPlace evolves

### Founding Members

**FriendPlace+ free for life.** Promise already made — honour indefinitely.
Being a Founding Member becomes genuinely valuable and reinforces the
appreciation for early supporters.

---

## 🗣 George's daily-limit copy (verbatim, editable in Mission Control)

When a free-tier user reaches their daily allowance, George says
**exactly this** (or a close variant preserving the warmth):

> **You've had lots of great chats with me today!**
>
> I'll be here again tomorrow, or if you'd like to keep chatting
> whenever you want, FriendPlace+ includes unlimited conversations,
> along with a range of other member benefits.

**Copy George MUST NEVER use:**
- ❌ "You've reached your limit."
- ❌ "You've used all your free messages."
- ❌ "Upgrade to keep chatting."
- ❌ Any variant that centres the *user's failure* or the *paid gate*
  rather than the natural end of a lovely day of chats.

Continues George's personality: warm, patient, encouraging, never
judgmental.

### Editable in Mission Control (Settings → George scripts)

Same pattern as Safety Net scripted responses. Per-context copy:
- Reached daily limit (above)
- Voice quota exhausted (if we ever separate STT/TTS from text)
- FriendPlace+ member fallback (should never trigger, but sanity)
- Something's broken on our end (graceful degradation)

---

## ☕ Phase 6 — George as Coffee Lounge host (added 17 July 2026)

**Requested by:** Garry
**Status:** Roadmap — deferred (not built now)
**Why it matters:** Changes "waiting alone" to "we're doing something
together until everyone gets here." Fits FriendPlace's icebreaker DNA
perfectly.

### The core interaction

When a user enters the Coffee Lounge and is **alone**, or is
**waiting for specific friends** who haven't arrived yet, George
gently offers to keep them company:

**Alone in the lounge:**
> 🦋 Looks like you're the first one here!
>
> While we're waiting for others to join, would you like to play
> a quick game together?
>
> 🎲 Spot the Difference   🧩 Jigsaw Puzzle   📝 Word Search
> 🎯 Trivia Quiz          🔤 Word Challenge
>
> As more people arrive, they can jump in too.

**Waiting for specific friends:**
> 🦋 While you're waiting for your friends to join, would you like
> to play a game together?
>
> It's a fun way to pass the time, and others can join in as they arrive.

### Design principles (Garry's ask)

- **Never pressure.** George offers once, gracefully. If declined,
  he sits back — doesn't nag every 30 seconds.
- **Games are social, not solo.** Every game supports "Join Game"
  once started. New arrivals see an in-progress game and tap in.
- **Icebreaker over competition.** No aggressive scoring or leader-
  boards on the lounge variant. The game is a conversation-starter,
  not a contest.
- **Zero learning curve.** Games George suggests are things anyone
  can join mid-round without reading rules.

### What we already have (from `/app/backend/`)

Solo versions of some games already exist:
- `trivia_data.py` — trivia question bank
- `word_search.py` — word search generator
- `sudoku.py` — sudoku boards
- `suburbs.py` — suburb-guessing game (Aussie-specific 🎯)
- Spot the Difference has backdrops at `/app/backend/static/spot_bg/`

### What Phase 6 adds

- **Multiplayer game room state** — a new `coffee_lounge_games`
  collection tracking who's playing what, whose turn it is, and
  a Join Game invite link
- **WebSockets or SSE for realtime sync** (already have websockets
  in requirements.txt from earlier work)
- **George's game-suggestion prompts** — small system-prompt
  variant that lets him choose which game to suggest based on
  time of day, lounge size, and what's already in progress
- **"Join Game" button** appears on the lounge for anyone who
  walks in while a game is running
- Mission Control section to **edit George's game-suggestion copy**
  and toggle which games are enabled per lounge/time

### Rough phasing when we return to it

1. Pick one game to prototype the multiplayer pattern (Trivia is
   easiest — turn-based, low state)
2. Add George's suggestion prompt + accept/decline flow
3. Add Join Game for late arrivals
4. Roll pattern out to remaining games
5. Long-term: leaderboards *at Coffee Lounge level*, not
   per-user (so it's celebratory, not competitive)

### Cross-refs

- Depends on George Phase 2 (mobile) — needs the butterfly
  bubble in the Coffee Lounge screen
- Sits alongside the future Events module Sponsorships work
  (a local business could sponsor "Wednesday Trivia Night")
