# George Platform — canonical contract

## 🧭 North Star

> **You are not building an admin AI. You are building the FriendPlace companion.**
>
> **FriendPlace is where George lives. Mission Control is where we perfect him.**
>
> The primary George experience belongs to members opening the FriendPlace mobile app. Mission Control is a development and administration surface that consumes the same platform — nothing more. Every design decision is checked against *"how does this feel on a member's phone?"* — not *"how does this look in the admin dashboard?"*

**Priority order** (in force from 19 July 2026):
1. Native FriendPlace mobile implementation.
2. Butterfly arrival animation.
3. George greeting members (including the once-in-a-lifetime introduction).
4. Floating conversation.
5. Event creation and everything that follows.

---

> **George is a platform, not a feature.** One conversation engine, one personality, one set of principles, many surfaces. This document is the platform contract every surface reads before mounting George.

_Locked with Garry, 19 July 2026._

---

## Table of contents

1. [Guiding principle](#guiding-principle)
2. [Surfaces that consume George](#surfaces-that-consume-george)
3. [The shared conversation engine](#the-shared-conversation-engine)
4. [Permission model](#permission-model)
5. [Backend contract](#backend-contract)
6. [Adding a new capability to George](#adding-a-new-capability-to-george)
7. [What George is **not**](#what-george-is-not)

---

## Guiding principle

> *"People shouldn't have to decide where George lives. They should simply know they can ask George wherever they are in FriendPlace."*

The interface may have multiple entry points, but there is always:

- **One George.** One personality, one voice, one set of architectural principles.
- **One conversation.** Mid-conversation, someone should be able to switch surfaces and the conversation continues.
- **One outcome contract.** Whatever the surface, `Confirm & Create` produces a stable, permission-aware outcome; only the *wording* of the success line varies by role.

### Principle #18 — George earns trust before collecting information

> *"George isn't helping people create events. He's helping people create opportunities for others to belong."*

George never assumes someone owes him information. Every conversation begins with curiosity, earns trust through listening, and only asks for information when it genuinely helps the member.

- **George listens first.**
- **George remembers.**
- **George gently confirms.**
- **George never interrogates.**
- **George never rushes.**

Trust is earned one conversation at a time. Every capability that mounts the shared engine — onboarding, event creation, group formation, invitations — must satisfy this principle. If a proposed exchange feels like a form being filled in, it fails the principle and must be redesigned.

**Practical rules for every capability:**
1. Open with warmth, not a question about a field. *"Tell me about the kind of get-together you're hoping to create."* — not *"What's the title of your event?"*
2. Let the idea emerge from the conversation. George extracts as he listens.
3. Only ask when something is genuinely missing and genuinely useful. If it can be inferred with a trusted source, don't ask.
4. Confirm gently before committing. *"Here's what I've put together from what you've told me. Have I captured it properly?"*
5. Celebrate the intention behind the action, not the completion of the form.

---

## Surfaces that consume George

| Surface | Mount point | Status (June 2026) | Role |
|---|---|---|---|
| **FriendPlace mobile app** (member) | Native Expo screen — up next | ⏳ **PRIMARY DESTINATION** | Where George lives |
| FriendPlace website (member/organisation) | Deferred until member web login lands | ⏳ planned | Secondary member surface |
| Mission Control (admin) | `/app/website/app/admin/george/new-event/page.tsx` | ✅ live | Development & administration surface |

Every surface renders **exactly the same** component (`GeorgeConversation`) and passes a `GeorgeConversationChrome` describing:

- where the "Leave" link sends you;
- what buttons appear on the success screen; and
- (optionally) a `successLine` override for surface-native wording.

Everything else — the voice, the tone rules, the Action Preview, the mind-change handling — is inside the engine and shared.

---

## The shared conversation engine

Component: `/app/website/components/george/GeorgeConversation.tsx`

Contract (props):

```ts
interface GeorgeConversationProps {
  seedMessage?: string;             // optional pre-fill (e.g. from a URL param)
  chrome: GeorgeConversationChrome; // surface-specific bits, see below
}

interface GeorgeConversationChrome {
  onLeave: () => void;
  leaveLabel?: string;
  successActions?: Array<{ label: string; onSelect: () => void }>;
  successLine?: (result: EventApprovalResult) => string;
}
```

The engine internally handles:

- calling `POST /api/mcgs/george/event/start`, `/turn`, `/approve`, `/cancel`;
- rendering warm chat turns, the optimistic user message, the "working" row;
- surfacing `excitement_line` / `working_line` from George;
- the Action Preview with `Confirm & Create` / `Make Changes` / hidden `Advanced edit`;
- the role-aware success screen driven by `outcome`.

**Do not fork this component.** Add capabilities inside it; do not build a parallel one for a new surface.

---

## Permission model

Source of truth: `/app/backend/services/george/permissions.py`.

Publishing is a **permission**, not a role. The known capabilities today are:

| Capability | What it gates | Default (admin) | Default (org) | Default (member) |
|---|---|---|---|---|
| `publish_events` | George's approve endpoint writes to `events` directly | `true` | `false` | `false` |
| `create_groups` | *(reserved)* | `true` | `false` | `false` |
| `message_members` | *(reserved)* | `true` | `false` | `false` |
| `manage_volunteers` | *(reserved)* | `true` | `false` | `false` |

An actor's effective permissions are computed by `actor_permissions(db, actor_id, actor_role)`:

1. Role default (from `default_permissions`).
2. Overrides on the actor's own record (`organisations.permissions.*` or `users.permissions.*`).

Only the four keys above are honoured; unknown keys are ignored.

**Verification ≠ permission.** An organisation may be verified for identity purposes without being granted `publish_events`. Trust is granted per-capability.

---

## Backend contract

All endpoints live under `/api/mcgs/george/event/*` and require the caller's bearer session.

| Method | Path | Purpose |
|---|---|---|
| POST | `/mcgs/george/event/start` | Begin a new conversation. Body: `{ text }`. |
| POST | `/mcgs/george/event/session/{id}/turn` | Continue the conversation. Body: `{ text }`. |
| GET  | `/mcgs/george/event/session/{id}` | Fetch the current state (used to rehydrate). |
| POST | `/mcgs/george/event/session/{id}/approve` | Commit the draft. Body: `{ edits: null \| Partial<EventDraft> }`. Returns `{ session_id, routed_to, outcome, target }`. |
| POST | `/mcgs/george/event/session/{id}/cancel` | Warm cancel (also called by `Leave`). |

`outcome` is either `"published"` (the actor had `publish_events`) or `"submitted_for_review"` (the actor did not — the item is now on the FriendPlace team's queue).

### Moderation queue (for actors without publish permission)

| Method | Path | Purpose |
|---|---|---|
| GET  | `/mcgs/events/pending-approval` | List all pending items (admin only for now). |
| POST | `/mcgs/events/pending-approval/{id}/approve` | Approve → creates a real event in `events`. |
| POST | `/mcgs/events/pending-approval/{id}/decline` | Decline with optional note. |

Pending items live in the `events_pending_approval` collection. They carry the full George draft (including `sources`) so a reviewer can see *why* George suggested each detail.

### Success-screen wording (already in the shared component)

- `outcome="published"` → *"Your event is live."* / *"I've added <Title> to today's activity."*
- `outcome="submitted_for_review"` → *"Off to the FriendPlace team."* / *"I've sent <Title> to the FriendPlace team for a quick look. I'll let you know as soon as it's live."*

Both are overridable per-surface via `chrome.successLine`.

---

## Adding a new capability to George

When we graduate a new capability from concept to real behaviour (e.g. `create_groups`), the checklist is:

1. Add the capability key to `KNOWN_CAPABILITIES` in `services/george/permissions.py`.
2. Set sensible role defaults inside `default_permissions`.
3. Write the capability-specific extractor + composer + service under `services/george/<capability_name>/`.
4. Add API endpoints under `/mcgs/george/<capability>/*` following the same start/turn/approve/cancel shape.
5. Extend the shared engine only if a **new kind of Action Preview** is needed — do not fork.
6. Add a new row to the surfaces table above.
7. Update this document.

**One conversation engine, many capabilities.** Every new capability plugs into the same conversational architecture, not a new standalone feature.

---

## What George is **not**

- **Not an admin feature.** Mission Control consumes George; it does not own him. Files under `/app/website/components/mcgs/` are *admin chrome*; the George engine lives under `/components/george/`.
- **Not a form generator.** The Action Preview is a conversation artefact, not a form. People edit by talking to George.
- **Not role-hardcoded.** Publishing is a permission. Any role can, in principle, be granted any capability.
- **Not a per-surface implementation.** There is exactly one engine. Any new surface *mounts* it; it does not re-implement it.
