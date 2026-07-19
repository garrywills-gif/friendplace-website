# Milestone B — Bringing George into the FriendPlace mobile app

> *"I don't want members to feel like they're opening another app. I want them to feel like someone has welcomed them into a community."* — Garry, 19 July 2026

---

## North Star for this milestone

Milestone A proved the shared platform in Mission Control. **Milestone B is the moment George moves into members' hands.** Every design decision is measured against a member opening their phone for the very first time. Mission Control is a reference implementation; the mobile experience is the real thing.

---

## Priority order (locked)

1. **George arrives** with the butterfly.
2. **George introduces himself** — the same welcome script as Mission Control, adapted to a phone screen.
3. **George welcomes the member** on returning sessions with a warm familiar greeting.
4. **George begins a conversation** — tap the butterfly, floating chat opens.
5. **George helps organise an event** — the same shared engine, hitting the same backend endpoints.
6. **George remains quietly present** through the butterfly, forever in the corner.

Everything after this (proactive noticing, groups, announcements, invitations, volunteering, newsletters, games, community activities) grows from the same platform and can wait.

---

## Success test

A new member downloads FriendPlace, taps in, and — without ever reading a tutorial — walks away thinking:

> *"Someone welcomed me. That was surprisingly enjoyable."*

---

## Technical shape (proposed — to be locked with Garry at the start of the mobile session)

### Native components to build (Expo, React Native)

| Component | Role | Reference |
|---|---|---|
| `GeorgeButterfly` (RN) | Same interaction as the web version | `/app/website/components/george/GeorgeButterfly.tsx` |
| `GeorgeButterflyMark` (RN) | Same SVG, using `react-native-svg` | `/app/website/components/george/GeorgeButterflyMark.tsx` |
| `GeorgeConversation` (RN) | Same conversation engine, native chrome | `/app/website/components/george/GeorgeConversation.tsx` |
| `GeorgeFloatingChat` (RN) | Bottom-sheet chat surface | `/app/website/components/george/GeorgeFloatingChat.tsx` |

### Animation approach

- `react-native-reanimated` v3 worklets for the butterfly path (matching the web keyframes but with the native performance headroom to feel truly gentle).
- `react-native-svg` for the butterfly mark (same shape, same gradients).
- `Animated.spring` for the greeting bubble bloom to match the *bloom, don't slide* feel.

### Backend contract (no changes)

The mobile app uses the same endpoints:

- `GET  /api/mcgs/george/presence` — returns `first_meeting` too, so mobile picks up the introduction flag automatically.
- `POST /api/mcgs/george/introduced` — retires the introduction.
- `POST /api/mcgs/george/event/start` / `/turn` / `/session/{id}/approve` / `/cancel` — conversation.
- `GET  /api/mcgs/george/event/session/{id}` — rehydrate.

**One change required for mobile:** the `george_first_met_at` field currently lives on `cms_admins`. For mobile members it must live on `users` — the presence endpoint should read from whichever collection matches the caller's auth type. This is a small backend refactor at the start of Milestone B.

### Where the butterfly lives on mobile

- **On every authenticated screen** — Home, Events, Groups, Profile, etc.
- **Arrival fires once per calendar day per actor** — same storage semantics as web, but using `SecureStore` / `AsyncStorage`.
- **First launch after install → introduction plays.** Regardless of the daily gate.

### Entry points on mobile

1. **Persistent butterfly button** bottom-right of every authenticated screen.
2. **"Talk to George"** entry from the Events tab (matches principle #9 — reduce effort to bring people together).
3. **"Talk to George"** entry from the Groups tab (planned; not blocking mobile Milestone B).

---

## What NOT to do in Milestone B

- Do not build capabilities beyond event creation. Groups, announcements, games etc. wait for Milestone C.
- Do not introduce a mobile-specific George voice or personality. He is one George.
- Do not fork the conversation engine. If mobile needs something the web version doesn't, add it to the shared engine and update both.
- Do not build proactive companion behaviours yet. That is a future milestone; the room for it is already reserved in the architecture.

---

## Definition of done

1. On a new install, opening the app → butterfly flutters in → introduction plays → member can choose to start a conversation or dismiss.
2. On a returning session, the butterfly rests quietly; tapping opens the floating chat.
3. A member can create an event by tapping the butterfly and having a natural conversation. The event lands in `events_pending_approval` (because members default to `publish_events=false`) with `submitted_for_review` as the outcome, and the success screen reads: *"Off to the FriendPlace team."*
4. Mission Control now shows this pending item in its moderation queue. An admin can approve or decline; approval publishes to `events`.
5. Every animation feels intentional; every greeting warm; every moment feels like *someone welcomed you*, not *you opened an app*.

---

## First question for the next session

Do we introduce George in the app *before* the member has completed their profile, or *after*? Both have merit:

- **Before**: George is the first person they meet, and the profile-building itself becomes a conversation with George.
- **After**: The introduction is the very first “welcome home” moment once they've settled in.

Garry to decide at the start of the mobile session.
