# Milestone B5 — Mobile Event Creation (June 2026)

## 🧭 North Star reminder
FriendPlace mobile is the destination. Mission Control consumes the same shared George engine. Every George experience is designed for members opening their phones.

## What this iteration adds
- **Principle #18 (locked)**: *George earns trust before collecting information.* Added to both `/app/memory/mcgs-architecture.md` and `/app/memory/george-platform.md` and pinned in the composer system prompt.
- **Milestone B5 — Mobile Event Creation**: Members can now tap the resting butterfly and have George help them plan a new get-together via a continuous, warm conversation. George opens with the exact benchmark line:
  > *"I'd love to help with that. Tell me about the kind of get-together you're hoping to create."*
  He never asks about a field first. The event emerges from the chat. When ready, George says:
  > *"Here's what I've put together from what you've told me. Have I captured it properly?"*
  Buttons: **That looks right** / **Let's change something** / **Save for later**.
- Event routing is permission-aware: `publish_events` → immediate publish; otherwise → `events_pending_approval` moderation queue.
- Presence now returns `onboarding_complete` and `has_active_onboarding` so the butterfly tap routes correctly (onboarding chat vs event creation).
- Event endpoints (`/api/mcgs/george/event/*`) now accept BOTH admin and member bearer tokens (previously admin-only). The actor's role is derived from the token, not the body.
- Empty `text` accepted on `/mcgs/george/event/start` — enables the mobile "bare opener" flow where the member taps the butterfly and George speaks first.

## Test credentials
- Mobile member (for Milestone B5): `member@friendplace.com.au` / `TestPass2026!` (Alex). Has `profile_complete: true` and no active onboarding session — tapping the butterfly opens the B5 event creation flow.
- To rewind to onboarding testing: `db.users.updateOne({username:"member_first"}, {$set:{profile_complete:false}})` and reopen the onboarding session.
- CMS admin: `hello@friendplace.com.au` / `TestPass2026!`
- Website / mobile web: `http://localhost:3000`
- Backend: `http://localhost:8001` (mapped to `/api` via nginx)

## What to test

### P0 — B5 backend
1. `POST /api/mcgs/george/event/start` with `{ "text": "" }` and a member bearer must return `status: "in_progress"`, `field_being_asked: "idea"` (or similar non-field like `title`), and a warm opener like *"Tell me about the kind of get-together you're hoping to create."* George MUST NOT begin with *"What's the title of your event?"*.
2. Multi-turn: send *"I'd like to organise a coffee morning at the community hall on Saturday 12 December at 10am. Room for 15, free."* George should reply warmly, note details, and ask *one* open question at most.
3. Reply *"Let's call it the December Coffee Morning."* — status should flip to `drafted`, `draft` populated, `sources` array carries every inferred source, message opens with *"Here's what I've put together from what you've told me. Have I captured it properly?"* (or a close warm variant).
4. `POST /approve` (as member, who lacks `publish_events`) returns `outcome: "submitted_for_review"` and creates a row in `events_pending_approval` with `sources` preserved.
5. `POST /approve` (as admin, who has `publish_events`) returns `outcome: "published"` and creates a row in `events`.
6. Editing outside scope: if the user says *"I want to edit my last event"*, George should politely defer (*"Editing existing events is something I'll be able to help with soon…"*). B5 is create-only.

### P0 — B5 mobile UI
7. Sign in as Alex on the mobile home. Wait for the greeting bubble to fade. Tap the resting butterfly.
8. A slide-up modal opens. Header shows "George" + butterfly mark + "Save for later" link.
9. George's opener appears within ~6 seconds: **"I'd love to help with that."** (excitement, teal, bold) followed by **"Tell me about the kind of get-together you're hoping to create."**
10. Placeholder in composer reads *"Tell George about your idea…"*.
11. Send an idea like *"I'd like a lawn bowls afternoon at the club on Saturday at 2pm."*. George replies warmly with excitement + working line + a single open question.
12. Complete the conversation (add a title). The Action Preview card appears with:
    - Header *"Here's what I've put together"* + subheader *"Have I captured it properly?"*
    - Rows: Get-together, Date (formatted), Time (formatted 12h), Where, Room for, Cost, For, About it. Inferred rows tagged *(George pencilled this in)*.
    - Three buttons: **That looks right** (primary teal), **Let's change something** (secondary), **Save for later** (tertiary underline).
13. Tap **That looks right**. Since Alex lacks `publish_events`, the celebration screen renders *"Off to the FriendPlace team."* with the emoji, and a **Wonderful — thank you, George** primary button.
14. Tapping **Wonderful — thank you, George** dismisses the celebration and returns to the home with the butterfly resting again.
15. Tap **Let's change something** in another run — George should say *"Of course — what would you like to change?"* and the composer reopens.
16. Tap **Save for later** — the modal closes, the session is `cancelled` server-side, and the resting butterfly is back on home.

### P0 — Router (butterfly tap)
17. Onboarding-complete member (Alex) tapping the butterfly → opens **event creation**, NOT the onboarding chat.
18. If the member has an active onboarding session or `profile_complete=false`, tapping the butterfly → opens **onboarding** (Milestone B4). Rewind Alex with the SQL note above to verify.

## Recent regressions to guard against
- Milestone B4 (Conversational Onboarding) must still work if `profile_complete=false`.
- First-time introduction (once forever) still fires on a brand-new member's first login.
- Butterfly arrival animation still plays once per day.

## Testing notes
- Sonnet turns take 4–10 seconds; wait accordingly.
- The composer uses `EMERGENT_LLM_KEY` — do not modify.
- The mobile home already surfaces George's resting butterfly with a personalised greeting bubble ("Morning, Alex..."); do not replace this.
