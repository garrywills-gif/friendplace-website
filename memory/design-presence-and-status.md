# FriendPlace Presence & Status — Design Document

**Author**: Neo (E1 agent) for Garry
**Status**: **LOCKED — Feb 2026 (post-refinement round).** Ready for implementation. Any further design changes require an explicit new round.
**Date**: Feb 2026, TestFlight round-9 planning
**Scope**: Items 2, 3, 4 from Garry's Feb 2026 review — combined into one coherent feature because they share the same underlying data.

## LOCKED DECISIONS

**Q1 — Banner scope**: Globally-scoped. Everyone `looking` appears in the FP Café banner regardless of whether they're currently at a café table. Tap action varies: `in_cafe` → **Join table** + **Private message**; else → **Private message** only.

**Q2 — Flutter option removed.** Only Join-table + Private-message on the tap sheet. Someone who's `looking` has already invited contact; a third choice adds noise.

**Q3 — Status precedence (locked, `Busy` now above `Happy`):**
```
Offline > Looking > In FP Café > Busy right now > Happy to connect > Online
```

**Q4 — Emoji glyphs** for TestFlight. Can be upgraded to branded SVG later without schema change.

**Q5 — Heartbeat cadence**: 60 seconds.

**Additional refinements from Garry's Feb 2026 review:**
- **"My Status" card**: no "🟢 Online" header line (Online is the automatic default; no need to announce it).
- **"My Status" layout**: Happy + Busy pills sit **side-by-side** (each taking half the row) rather than stacked, so the card stays compact.
- **Wording**: "Busy" → "**Busy right now**". "Happy" → "**Happy to connect**".
- **Single-member café banner**: "🦋 Susan is looking for a chat" → "**🦋 Susan would love a chat**" (warmer, more conversational). Subtitle: "**Tap to start chatting.**"
- **Multi-member café banner**: heading is "**People looking for a chat**". Each row prefixed with 🦋.
- **Badge placement**: `<AvatarWithBadge>` used EVERYWHERE an avatar is visible (Find Friends, café seats, DM headers, group members list, event attendees). The name shown beside the avatar is JUST the name — no icon repeat, no status label.
- **No text-only `<MemberBadge>` variant.** Retired.
- **Auto-off on conversation start (LOCKED, Garry Feb 2026)**: When a member has `manual_status = "looking"` and one of the following happens, the server automatically clears `manual_status` back to `null` (member becomes `online` / `in_cafe` per precedence):
  1. Any private message thread with them becomes non-empty for the first time in this "looking" session (they receive OR send a message).
  2. Another member joins the café table where they're currently seated.
  3. They join a café table where another member is seated.

  Reasoning: the butterfly's job is to signal "please make contact with me". Once contact has been made, keeping the badge on would mis-signal to third parties that they're still available. Backend server implements this because the client can't reliably observe all three trigger events. The auto-clear fires a `status_change` WebSocket broadcast so any café banner they're in visibly disappears within ~1s.

---

## 1. Goals

1. **Move "Looking for a chat" out of Profile** and into a discoverable one-tap action on the Home screen. Profile keeps only settings/preferences.
2. **Make "Looking for a chat" visible to other members** in FP Café via a live banner, so opting-in is a real social signal, not a hidden preference.
3. **Show a small status glyph beside every member's name** across the app so members can instantly see who is available, in the café, or looking for chat.
4. Preserve every existing behaviour outside this scope. No prompts, no other flows, no other components changed.

---

## 2. Status types & rules

| Status         | Glyph | Set by       | Cleared by                                                    |
|----------------|:-----:|--------------|---------------------------------------------------------------|
| **Offline**    | ⚫     | Auto         | App comes to foreground → transitions to `online`             |
| **Online**     | 🟢    | Auto         | App backgrounded > 5 min OR logout → `offline`                |
| **In FP Café** | ☕     | Auto         | Leaving the café table screen → back to prior status          |
| **Looking**    | 🦋    | Manual toggle| Toggle off · leaving FP Café · going offline · **conversation started** · 60 min timeout |
| **Happy to connect** | 😊 | Manual toggle | Toggle off · going offline · 24 h timeout               |
| **Busy**       | 🟡    | Manual toggle| Toggle off · going offline · 4 h timeout                      |

**Precedence** (when multiple could apply, which one displays beside the name — **LOCKED per Garry Feb 2026**):
```
Offline > Looking > In FP Café > Busy right now > Happy to connect > Online
```
Reasoning: offline is a hard "cannot reach me" signal. Looking is the strongest positive social invite so it beats everything reachable. Café-presence beats Busy because "I'm here right now" is a more actionable positional signal than "generally busy". Busy beats Happy because if someone has actively said Busy, that overrides the passive Happy setting. Plain online is the fallback.

**Automatic statuses (Café + Offline) are always computed server-side** so we don't rely on the client sending them. This prevents inconsistencies when the app crashes or a device goes offline abruptly.

---

## 3. Data model

### 3.1 New collection: `member_status`

One document per user:

```json
{
  "user_id": "d8ef0bc1-...",         // Primary key
  "manual_status": "looking",         // one of: null | "looking" | "happy" | "busy"
  "manual_status_set_at": ISODate,    // for timeout enforcement
  "manual_status_expires_at": ISODate,// server-computed (set_at + type's TTL)
  "presence": "online",               // computed field: "online" | "offline"
  "last_seen_at": ISODate,            // heartbeat / app foreground timestamp
  "in_cafe_table_id": "fp-cafe-...",  // set while sitting at a table; null otherwise
  "in_cafe_since": ISODate,           // for analytics; nullable
  "updated_at": ISODate
}
```

Indexes:
- `user_id` (unique)
- `manual_status` (partial: not null) — for the "who's looking" query
- `manual_status_expires_at` — for periodic cleanup sweeps
- `in_cafe_table_id` (partial: not null) — for café roster queries

### 3.2 Derived `effective_status`

Computed by a single function `compute_effective_status(doc)` on the server, applied at read time:
```
if last_seen_at older than 5 min → "offline"
elif manual_status == "busy" AND not expired → "busy"
elif manual_status == "looking" AND not expired → "looking"
elif in_cafe_table_id != null → "in_cafe"
elif manual_status == "happy" AND not expired → "happy"
else → "online"
```

Never stored — always computed. This means expiry is enforced automatically without a cron.

---

## 4. Backend API surface

### 4.1 New endpoints

| Method | Path                                       | Body / Query                       | Response                                                                             | Auth |
|--------|--------------------------------------------|------------------------------------|--------------------------------------------------------------------------------------|------|
| GET    | `/api/status/me`                           | —                                  | `{ effective, manual, manual_expires_at, in_cafe_table_id, last_seen_at }`           | User |
| PATCH  | `/api/status/me`                           | `{ manual_status: "looking"\|"happy"\|"busy"\|null }` | Same as GET                                                       | User |
| POST   | `/api/status/heartbeat`                    | —                                  | `{ ok: true }` — bumps `last_seen_at`                                                | User |
| GET    | `/api/status/looking`                      | `?scope=nearby\|friends\|all` (default nearby) | `[ { user_id, name, avatar, since }, ... ]` (sorted newest first, capped at 30) | User |
| GET    | `/api/status/for-users`                    | `?ids=uuid1,uuid2,...` (max 50)    | `{ [user_id]: "online"\|"offline"\|"in_cafe"\|"looking"\|"happy"\|"busy" }`          | User |

### 4.2 Existing endpoints extended (backwards-compatible)

- `GET /api/tables/{id}` — response now includes `status` for each seated member. Callers unaware of the field ignore it.
- `GET /api/friends` — likewise adds `status` to each entry.
- `GET /api/community/find-friends` — likewise.
- `GET /api/dm/threads` — likewise for the "other party" in each thread.
- `GET /api/groups/{id}/members` — likewise.
- `GET /api/events/{id}/attendees` — likewise.

Legacy consumers of these endpoints continue to work — the new `status` field is additive.

### 4.3 WebSocket broadcasts

The existing café WebSocket (`/ws/table/{id}`) already broadcasts seat/leave events. Extend the message vocabulary:

- `status_change` — `{ type: "status_change", user_id, status: "looking" }`. Broadcast to café subscribers when any member the café UI is currently showing changes status. Debounced 250 ms server-side to avoid flooding.
- `looking_list_update` — `{ type: "looking_list_update", added: [...], removed: [...] }`. Broadcast to café subscribers when the "who's looking" list changes. Enables the banner to update live without polling.

No new WebSocket connection introduced. If we later need presence outside the café, we can promote to a dedicated `/ws/presence` channel — deferred until needed.

### 4.4 Removed endpoints

- The existing `POST /api/community/chat-alert` endpoint (used by the current Profile "Send a chat alert" modal) is **kept** for the manual "send a Flutter" flow described in §5.3. But its role narrows: it becomes only a notification-sender when a member taps someone's "Looking for chat" banner and chooses "Send a Flutter". The audience picker moves to the new banner-tap sheet. The existing Profile-based invocation is removed.

---

## 5. Frontend — screens & UI

### 5.1 Home screen — new "My Status" section

Placed just below the greeting, above existing widgets. A card with:

```
┌───────────────────────────────────────────┐
│  My status                                │
│                                           │
│  ● Online                                 │
│                                           │
│  ┌─────────────────────────────────┐      │
│  │ 🦋  Looking for a chat          │ ←── primary CTA
│  └─────────────────────────────────┘      │
│                                           │
│  😊 Happy to connect   🟡 Busy   ✕ Clear  │
└───────────────────────────────────────────┘
```

**Behaviour**:
- Header shows the current effective status: e.g. "● Online", "☕ In FP Café", "🦋 Looking for a chat (35 min left)".
- Big 🦋 button is the primary one-tap toggle. If already on, it becomes "✓ Looking for a chat — tap to stop" with a different visual state (filled brand colour).
- Smaller pills below let members set 😊 Happy or 🟡 Busy. Tapping the currently-active one clears it.
- Café badge (☕) is informational only — no button — because being in the café is automatic.
- Every state change fires `PATCH /api/status/me` and optimistically updates the UI.

### 5.2 FP Café — new "Looking for a chat" banner

Placed **above** the "Pull up a chair" card in `app/table/[id].tsx`. Only rendered when at least one non-self member has `effective_status === "looking"` (café-scoped list).

**Single-member state**:
```
┌──────────────────────────────────────────────────┐
│  🦋 Garry is looking for a chat                  │
│  Tap to say hello.                        ›      │
└──────────────────────────────────────────────────┘
```

**Multi-member state (2+)**:
```
┌──────────────────────────────────────────────────┐
│  🦋 Looking for a chat                           │
│  • Garry                                    ›    │
│  • Susan                                    ›    │
│  • Bill                                     ›    │
└──────────────────────────────────────────────────┘
```

**Behaviour**:
- Live-updates via WebSocket `looking_list_update` events — no polling.
- Auto-hides (fades out over 300 ms) when the list becomes empty.
- Tapping a name opens a **contextual action sheet** per Garry's specification:
  - If the tapped member's `effective_status === "in_cafe"` AND they're at a currently-visible café table: **[Join their table] [Send a private message]**
  - Else (looking but not currently in café — e.g. from Home): **[Send a private message]**
- Never sends a Flutter/notification silently from a tap — the member always chooses the outgoing action.

### 5.3 Profile — "Send a chat alert" removed

- The 🦋 "Looking to chat" button on Profile → deleted.
- The `<Modal>` audience picker on Profile → deleted.
- The `Nearby Opt-In` checkbox → **stays** (that's a separate notification preference — "Am I willing to receive Flutters from nearby strangers?"). We don't tangle it with the new status feature.

### 5.4 Member badges everywhere

New shared component: `frontend/src/components/MemberBadge.tsx`.

```tsx
<MemberBadge
  name="Kaya"
  status="looking"          // one of the 6 status types
  size="sm" | "md" | "lg"   // default md
  layout="row" | "avatar-corner"
/>
```

Two layouts:
- `row` (default): Renders `[name] [glyph]` inline — used in text-heavy lists like DM headers, event attendee lists, group members.
- `avatar-corner`: Renders a tiny glyph in the bottom-right corner of a nearby `<Avatar>` — used in café tables and Find Friends where the avatar is prominent.

Callers that don't have `status` pre-populated fetch it via `GET /api/status/for-users?ids=...` in a single batched request (client-side debounce 200 ms → coalesces sequential renders into one call).

**Surfaces receiving the badge**:
- FP Café tables (avatar-corner)
- Find Friends list (avatar-corner)
- Friends list on Profile (avatar-corner)
- DM thread list (row, next to the other party's name)
- DM chat header (row, subtly small under the name)
- Group member roster (row)
- Event attendee list (row)

**Surfaces intentionally NOT receiving the badge** (keeps them uncluttered):
- Message bubbles (name already implicit from the bubble side)
- Notifications feed (already time-based and quite dense)
- Notices / thoughts of the day (community broadcasts, not person-to-person)

### 5.5 App-lifecycle → heartbeat & presence

- On foreground: `POST /api/status/heartbeat` immediately, then every 60 s while foreground.
- On background: stop heartbeat. Server marks the member `offline` after 5 min of no heartbeat.
- On login: send heartbeat + fetch `/api/status/me`.
- On sitting at a café table (`POST /api/tables/{id}/join`): server sets `in_cafe_table_id`. On leaving (`POST /api/tables/{id}/leave`) or on unmount of the café screen: `in_cafe_table_id = null`.

---

## 6. Migration & rollout

1. **Database**: The `member_status` collection is created on first API hit per user (upsert-pattern). No batch migration needed.
2. **Backwards-compat**: All existing endpoints continue to work unchanged. New `status` field is additive. Old client versions ignore it.
3. **Feature flag**: Wrap the FP Café banner and the Home "My Status" card in a `features.status.enabled` client-side check (default true). If we discover a problem in TestFlight, we can flip the flag off without a redeploy of the backend.
4. **Analytics** (non-blocking): Emit `status_changed` events server-side (existing analytics rail) so we can see adoption of the "Looking for a chat" toggle in the first 2 weeks.

---

## 7. Privacy & safety

- The `/api/status/looking` list defaults to `scope=nearby` (same suburb / geohash as the requesting member) so a member's "looking" state is not broadcast globally. Members with the Nearby Opt-In OFF do NOT appear in this list, even when looking — their status shows only to friends.
- No status is ever shown to blocked/reported members. Existing block relationships are honoured in every status query.
- Status changes are not written to any shared audit log or activity feed.
- The 60-minute auto-expiry on "looking" is deliberately short so a forgotten toggle can't leave someone visibly-inviting for hours.

---

## 8. Non-goals for this build

Explicitly OUT of scope:
- Custom status text ("Watching cricket").
- Scheduled statuses ("Busy tomorrow 9-5").
- Group-level statuses.
- Push notifications when someone starts looking for chat.
- Cross-device sync of the manual toggle (single-device semantics for now).
- Any change to George's own composer or to George Chat's presence indicator.
- Any change to the Nearby Opt-In checkbox behaviour (already correct).

---

## 9. Estimated size

- **Backend**: 1 new collection, 5 new endpoints, 6 existing endpoints extended (additive), WebSocket message vocabulary extended by 2 message types. ~450 lines of Python, mostly in a new `backend/services/status/` module + small edits to existing endpoints. New pytest file covering: manual toggle, timeout, café-auto, offline-detection, precedence, scope filter, badge batch.
- **Frontend**: 1 new component (`MemberBadge`), 1 new Home card, 1 new café banner, ~7 caller-screen edits to wire in the badge, 1 removed Profile modal + button, new lifecycle heartbeat wired into the root `_layout.tsx`. ~350 lines of TSX + a new `src/lib/status-api.ts` client wrapper (~80 lines).
- **Testing**: Backend contract fully testable by `testing_agent`. Frontend static & bundle-level testable. Live presence + WebSocket updates require your physical-device verification because presence semantics involve real backgrounding.

---

## 10. Rollout order (once you approve the design)

Because presence is a "many little wires" feature, I'd split the implementation into 3 small commits so each can be verified independently:

**Commit 1 — Backend + data model.** New collection, all API endpoints, WebSocket message vocabulary. Zero frontend impact. Verify with backend testing agent.

**Commit 2 — Home status card + Profile clean-up.** Members can set/toggle status but nothing else displays it yet. Verify Home card via screenshot + preview.

**Commit 3 — Café banner + `MemberBadge` badges everywhere + WebSocket wiring.** Members see other members' status. Full end-to-end feature live.

Each commit is small enough for isolated device verification before the next lands.

---

## 11. Open questions for Garry

1. **Café-membership scope for the banner**: The FP Café banner shows a list of members currently `looking`. Should this list be **café-scoped** (only members who are ALSO sitting at a café table) or **globally-scoped** (anyone looking, regardless of whether they're in the café)?
   - **My default: globally-scoped**, because the whole point of the feature is discovery — members might set "Looking for a chat" from the Home screen without yet being in the café.
2. **"Send a Flutter" — retained?** The current Profile-based flow lets you send a notification to a specific audience. In this new design, the primary action is Join table / Private message. Do you want a "Send a Flutter" option retained on the banner tap sheet as a third choice, or is that legacy?
   - **My default: retained as a third choice for the "not currently reachable" case** (member is looking but offline or blocked from DM).
3. **Café auto-status precedence over Happy**: I currently rank ☕ In FP Café ABOVE 😊 Happy to connect. If a member is both happy AND in the café, the café glyph shows. Is that the right precedence? Alternative: happy always beats café-presence.
   - **My default: café-presence wins**, because it's the more actionable signal (you can literally join them right now).
4. **Colour language for the glyphs**: Should the six statuses use pure emoji (🟢 🦋 ☕ 😊 🟡 ⚫) or coloured SVG icons matched to the FriendPlace palette? Pure emoji is easier and reads consistently on every device but slightly less brand-styled. SVG icons are more polished but need a mini-icon set.
   - **My default: pure emoji** for TestFlight simplicity; can upgrade to SVG later without changing the data model.
5. **Heartbeat cadence**: 60 s is my default. Aggressive enough to feel live; gentle enough to avoid battery drain. Would you prefer 30 s (livelier presence, more battery) or 120 s (calmer, more delay to "offline")?
   - **My default: 60 s**.

---

## 12. What I want you to do next

Please respond with:

**A. Approval or edits on this design**, specifically covering the five open questions above.
**B. Which of the 3 commit chunks (§10) you'd like as the FIRST implementation build.**
- I recommend starting with **Commit 1 (backend + data model)** because it has zero visible impact and gives us a clean, testable foundation. If we discover the shape is wrong, no user-facing rework.

Then I'll implement one commit, invoke the testing agent, deliver you a build for TestFlight verification, and pause for your approval before touching the next commit.
