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

## 💰 Cost model — outstanding decision (17 July 2026)

Garry's point: "if they want to use George more than the allocation should
they pay? Which means it's not free." Fair — a soft cap turns silently into
"George is a paid feature after N messages."

**Three options I've drafted for Garry to choose from:**

### Option A — George is completely free (all users, all the time)
- Pros: simplest, warmest, no billing infrastructure, on-brand
- Cons: LLM costs scale with usage; a single power user could burn
  significant credit; abuse potential
- Mitigation: hard per-user daily cap of ~150 msg with a warm
  "come back tomorrow" message. Anti-abuse rate limit at 20 msg/hour.

### Option B — Free tier + "FriendPlace+" subscription (my lean)
- Free: 50 messages/day + tap-to-listen limited to 20/day
- **FriendPlace+ (~AU$5/month)**:
  - Unlimited George conversations
  - Unlimited voice
  - Priority event RSVPs (skip the waitlist)
  - Bigger media upload limits (avatar / video)
  - Founding Members get FriendPlace+ FREE for life (already promised)
- Pros: sustainable, warm framing (not "buy more of George"),
  bundled value beyond just AI, keeps free tier generous
- Cons: needs Stripe integration + subscription lifecycle handling

### Option C — Day-pass top-ups
- Free 50/day. When you hit it: "You've had a lovely chat with George
  today. Want a Day Pass? AU$1.50 for unlimited today."
- Pros: pay-as-you-need, no commitment
- Cons: more transactional feel; more billing events; still needs Stripe

**Garry's implicit preference from earlier conversations:**
- Founding Members = free unlimited forever ✓ (all options honour this)
- "For everyone" branding ✓ (avoid framing George as premium-only)

**Waiting on Garry's decision before Session A of George build begins.**
My recommendation: **Option B (FriendPlace+ subscription)** because it
naturally extends into other perks and avoids per-message money anxiety.
