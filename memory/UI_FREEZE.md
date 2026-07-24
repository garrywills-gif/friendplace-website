# UI FREEZE — 24 June 2026

Locked-in by Garry on 24 June 2026 immediately after Round-8 polish
(Presence & Status Commit 2 + composer parity with George).

## The rule

From this build onward, cosmetic UI changes are **frozen**. UI is only
allowed to change when a change is:

1. Fixing a **genuine bug** (broken layout, wrong colour token, crash).
2. Resolving a **usability issue** surfaced during testing (testing
   agent findings, TestFlight member feedback, accessibility audits).
3. **Required** for a new feature (e.g. a new screen or new control
   the current layout genuinely can't host).

Anything else — spacing tweaks, colour shuffles, typography changes,
copy polish, iconography swaps — requires **explicit user approval**
before it ships.

## The scoreboard

| Category                          | Status |
|-----------------------------------|--------|
| UI Freeze                         | ✅     |
| Bug fixes                         | ✅     |
| Performance improvements          | ✅     |
| New features                      | ✅     |
| Cosmetic tweaks (uninvited)       | ❌     |

## What "frozen" specifically means

- The **design tokens** (`/app/frontend/src/lib/theme.tsx`) stay put.
  Don't add new palette entries or shift existing ones.
- The **composer** (mic teal `#0F766E`, send teal `#14B8A6`, rounded
  pill wrapper, photo attach outside) is the canonical pattern —
  every future composer follows it.
- **Home** ("My Status" card under greeting + Today's Thought +
  Welcome checklist) and **Café Looking banner** layouts are canon.
- **AvatarWithBadge** placement rules stay per the LOCKED design at
  `/app/memory/design-presence-and-status.md`.

## What we're focussing on instead

1. **Stability** — reproducing edge-case bug reports from TestFlight,
   defensive error handling.
2. **Testing** — coverage on the new Presence & Status paths, DM
   auto-clear hooks, background-heartbeat semantics on iOS backgrounding.
3. **Performance** — batched status cache LRU pruning, WebSocket
   `status_change` broadcast (replaces the 30 s café banner polling).
4. **New functionality** — the outstanding backlog: FP Café welcome
   header refresh, Apple Speech STT investigation, CMS rotating
   welcome backgrounds, Mission Control expansion, Commit 3 Presence &
   Status (WebSocket + roster/attendee badges), Push notifications
   (Emergent-managed), Events Module Session B.

## Guardrails for future agents

- Do **NOT** silently change spacing, colours, radii, typography, or
  copy in an existing screen while implementing an unrelated feature.
- When adding a new component that needs UI, **reuse existing
  components** (`AvatarWithBadge`, `MyStatusCard`, `CafeLookingBanner`,
  the composer pattern above, etc.).
- Any UI touch outside the three allowed categories → **STOP and
  ask** via `ask_human` before making the change.
- This file is authoritative. Reference it in the plan summary at the
  start of every fork.
