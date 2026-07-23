# Presence & Status — Commit 2 (Frontend)

## Context
Commit 1 (backend) shipped last session — `member_status` collection,
`/api/status/*` endpoints, auto-clear hooks. See
`/app/memory/design-presence-and-status.md` for the LOCKED spec and
`/app/backend/services/status/` for implementation. Backend was
already verified by testing_agent in iterations 91–98.

## What just shipped (frontend)
- `src/lib/status-context.tsx` — global `StatusProvider` mounted in
  `app/_layout.tsx` (wraps AuthProvider + ToastProvider). Handles the
  60 s heartbeat, foreground/background AppState transitions, and a
  200 ms-debounced batched lookup for other users' statuses
  (`useUserBadgeStatus` / `useUserBadgeStatuses`).
- `src/components/status/AvatarWithBadge.tsx` — wraps existing
  `AvatarBubble` with a bottom-right status glyph.
- `src/components/status/MyStatusCard.tsx` — Home "My Status" card
  (design §5.1). 🦋 primary button, Happy/Busy pills side-by-side,
  Clear pill, effective status header chip.
- `src/components/status/CafeLookingBanner.tsx` — FP Café banner
  (design §5.2). Single- vs multi-member layout, tap-action sheet
  with Join-table + PM (or PM only), 30 s polling.
- `src/lib/api.ts` — 5 new methods: `statusMe`, `statusSetManual`,
  `statusHeartbeat`, `statusLooking`, `statusForUsers` (all silent
  variants where appropriate so background pollers don't nuke the
  session on transient 401s).
- Home screen (`app/(tabs)/home.tsx`) — `MyStatusCard` slotted
  directly under the greeting.
- Table screen (`app/table/[id].tsx`) — `CafeLookingBanner` slotted
  above the seating diagram.
- Profile screen (`app/(tabs)/profile.tsx`) — removed the OLD status
  chip row, "Send a chat alert" button, and the audience-picker
  modal. Kept the Nearby Opt-In checkbox (renamed section to
  "🔔 Nearby chats").
- `AvatarWithBadge` applied on: Chats tab (replaces the old green
  "online dot"), Friends tab (Find Friends list), Table screen's
  compact seated strip.

## What to test — frontend

### P0 — My Status card (Home)
1. **First-visit render** — after login, the Home screen shows a
   "MY STATUS" card between the greeting and Today's Thought. The
   header chip is HIDDEN when effective status is `online`. The
   primary 🦋 button shows "Looking for a chat" (unfilled state).
   The two half-width pills are 😊 Happy to connect · 🟡 Busy right
   now. Footer: "☕ In the FP Café and ⚫ Offline are set
   automatically."
2. **Toggle "Looking for a chat"** — tap `my-status-looking`. Button
   fills brand blue and label becomes "✓ Looking for a chat · 1h
   left". Effective chip appears with "🦋 Looking for a chat".
   Clear pill (`my-status-clear`) appears below.
3. **Toggle "Happy to connect"** — from the online state, tap
   `my-status-happy`. Pill lights up. Effective chip becomes "😊
   Happy to connect". No time-left suffix (24 h TTL is too long to
   show).
4. **Toggle "Busy"** — same as #3 for `my-status-busy` (4 h TTL).
   Effective chip becomes "🟡 Busy right now".
5. **Mutually exclusive** — activating Happy clears Looking and vice
   versa. Activating Busy while Happy is on → only Busy shows.
6. **Clear pill** — visible ONLY when manual status is set. Tapping
   clears back to `online` and hides the effective chip.
7. **Precedence** — with `manual_status = "busy"` set, effective
   shows `busy` (design §2). With `manual_status = "looking"` set,
   effective shows `looking` regardless of café state.
8. **Optimistic update + revert** — flakey network: the toggle
   should flip immediately then reconcile with the server response
   without flicker.

### P0 — Café banner
Because the seed only has one member logged in, seed a second user's
status manually:
```python
import asyncio, sys, os
sys.path.insert(0, "/app/backend")
from motor.motor_asyncio import AsyncIOMotorClient
from services.status import service as svc
async def main():
    c = AsyncIOMotorClient(os.environ.get("MONGO_URL","mongodb://localhost:27017"))
    db = c["test_database"]
    # Pick any demo user (e.g. Maggie) that is NOT the viewer.
    u = await db.users.find_one({"username": "maggie"})
    await svc.set_manual(db, u["id"], "looking")
    await svc.heartbeat(db, u["id"])
    # Also flip nearby_opt_in + same suburb so nearby scope matches:
    await db.users.update_one({"id": u["id"]}, {"$set": {"nearby_opt_in": True, "suburb": (await db.users.find_one({"username":"member_first"}))["suburb"]}})
asyncio.run(main())
```
9. **Banner renders** — visit any table (`/table/{id}`). The banner
   `cafe-looking-banner` should appear ABOVE the seating diagram
   with "🦋 Maggie would love a chat · Tap to start chatting."
10. **Multi-member layout** — repeat the seed for a 2nd user. Banner
    heading becomes "People looking for a chat" with each row
    prefixed 🦋 and chevron on the right.
11. **Tap → action sheet** — tap a row. Modal slides up. If the
    tapped member has `in_cafe_table_id` set AND it's not the current
    table, `[Join their table]` primary + `[Send a private message]`
    secondary. Else, only `[Send a private message]` primary.
12. **PM action** — tap `looking-sheet-pm`. Deep-links to `/dm/{id}?
    other_id=...` after `api.startDm` succeeds.
13. **Cancel** — tap `looking-sheet-cancel` or the backdrop → sheet
    dismisses without side effects.
14. **Auto-clear on DM message** — after tapping PM and sending a
    message, the target member's `manual_status` clears server-side
    (Commit 1's DM auto-clear hook). Refetch `/api/status/for-users`
    for that id — should return `online`.
15. **Auto-hide when empty** — clear the seeded users' looking status
    (`svc.set_manual(db, uid, None)`). Refresh the table view within
    30 s; banner disappears cleanly.
16. **Self-excluded** — set the LOGGED-IN user's own status to
    looking. Their name must NOT appear in the banner.

### P1 — AvatarWithBadge across surfaces
17. **Chats tab** — DM list rows show a status badge on the other
    party's avatar (corner glyph). Old solid-green "online dot" is
    gone. `chat-online-*` test-id no longer present.
18. **Friends tab** — Find Friends list avatars show the badge.
19. **Café compact strip** — while the keyboard is open at a table,
    the compact seated strip shows badges on avatars. Signed-in user
    (self) shows NO badge (design §5.4 refinement).
20. **Offline members** — offline users show no badge (design §2
    refinement: ⚫ only shown when known-offline in explicit contexts).

### P1 — Profile cleanup
21. **Nearby chats section** — old "My status" chip row + "Send a
    chat alert" primary button + audience picker modal are all
    GONE. The Nearby Opt-In checkbox remains, now under a "🔔
    Nearby chats" section header. Toggling it still hits
    `updatePreferences` with `nearby_chat_alerts`.

### P0 — Heartbeat + presence
22. **Heartbeat on foreground** — from a cold start, network log
    shows `POST /api/status/heartbeat` fires immediately and then
    every 60 s while the app is foregrounded.
23. **Background pause** — putting the app in the background stops
    heartbeats. Returning to foreground fires one immediately and
    then resumes the interval.
24. **/api/status/me on login** — fires ONCE right after the initial
    heartbeat. Sets the initial state of the My Status card.

### P0 — Non-regression checks
25. **`/preview/status-mockups` route still renders** — DO NOT
    delete this route. User wants it retained as visual reference
    until the whole feature is approved.
26. **VoiceInputButton unchanged** — mic/send toggle in the table
    composer and George's composer must still work exactly as
    before (STT baseline is LOCKED).
27. **Existing table/dm/notifications flows untouched** — sending a
    photo, editing an event, sending a flutter etc. must all still
    work as they did before Commit 2.

## Test credentials
- Mobile member: `member@friendplace.com.au` / `TestPass2026!` (Alex)
- Additional users (demo — no password, use "Try a demo account"):
  `maggie`, `frankie`, `joycey`, `billdo`, `dot`
- Mission Control admin: `hello@friendplace.com.au` / `TestPass2026!`

## Files touched / created in this session
- **New**:
  - `/app/frontend/src/lib/status-context.tsx`
  - `/app/frontend/src/components/status/AvatarWithBadge.tsx`
  - `/app/frontend/src/components/status/MyStatusCard.tsx`
  - `/app/frontend/src/components/status/CafeLookingBanner.tsx`
- **Modified**:
  - `/app/frontend/app/_layout.tsx` (StatusProvider wired in)
  - `/app/frontend/src/lib/api.ts` (5 new methods)
  - `/app/frontend/app/(tabs)/home.tsx` (MyStatusCard slotted)
  - `/app/frontend/app/table/[id].tsx` (banner slotted + badge on compact strip)
  - `/app/frontend/app/(tabs)/profile.tsx` (removed old chat-alert flow, kept Nearby Opt-In)
  - `/app/frontend/app/(tabs)/chats.tsx` (AvatarWithBadge replaces onlineDot)
  - `/app/frontend/app/(tabs)/friends.tsx` (AvatarWithBadge on Find Friends list)

## Non-goals for Commit 2 (deferred to Commit 3)
- Live WebSocket status_change / looking_list_update broadcast wiring
  (currently 30 s polling on the banner). Server broadcasts are ready
  per Commit 1; we deliberately kept the client on polling until we
  can prove UX first.
- AvatarWithBadge on group members list and event attendees (need
  those screens to expose the batched-fetch pattern too — small work
  but held for Commit 3 cleanup pass).
- LRU/pruning of the batched cache (currently unbounded per session;
  it's small — an object per unique user id — so this is fine for the
  TestFlight builds).

## Known good state to protect
- STT (`VoiceInputButton.tsx`) — DO NOT alter.
- George event creation prompt logic — DO NOT alter.
- Nearby Opt-In checkbox behaviour — unchanged from TestFlight
  round-7 fix #18.
