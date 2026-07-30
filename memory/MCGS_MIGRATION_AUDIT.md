# MCGS Migration Audit — Phase 1

**Author:** Neo (agent)  
**Purpose:** Establish exact feature parity between the mobile-app admin tools and MCGS (the Next.js Mission Control) before adding new functionality.

**Live status:** Slice 0 ✅ complete · Slice 1 (Member Management) — up next

---

## 🚦 Slice status board

| Slice | Domain | Status |
|---|---|---|
| **0** | Foundation (sidebar refresh · `admin_log` · Ask George component · placeholder routes) | ✅ **Done** |
| 1 | Member Management | ⚪ Not started |
| 2 | Reports & Moderation | ⚪ Not started |
| 3 | Feedback / Support | ⚪ Not started |
| 4 | Events (extend controls) | ⚪ Not started |
| 5 | Groups (pending queue) | ⚪ Not started |
| 6 | Announcements | ⚪ Not started |
| 7 | Website Content polish | ⚪ Not started |
| 8 | Administration | ⚪ Not started |
| 9 | Settings | ⚪ Not started |
| 10 | Analytics | ⚪ Not started |

---

## Legend

- **Location** — Mobile = `/app/frontend/app/admin/*` · MCGS = `/app/website/app/admin/*` · Backend = `/app/backend/*`
- **Migrated?** — Full = already in MCGS · Partial = some coverage but missing UI/actions · No = mobile-only
- **Complexity** — Low = < 1 day (form + list + API bind) · Medium = 1–3 days (stateful workflows, permissions) · High = 3+ days (multi-model workflows, real-time state, moderation rules)
- **Priority** — Critical = safety/legal/blocks admins · Important = daily-ops · Nice-to-have = occasional
- **Improvements** — What we should upgrade *while* migrating, so we don't just port screens 1:1.

---

## 🛡️  DOMAIN 1 — MEMBER MANAGEMENT

| # | Feature | Mobile Location | Backend Route | MCGS Equivalent | Migrated? | Complexity | Priority | Improvements |
|---|---|---|---|---|---|---|---|---|
| 1.1 | Search members by name/email/handle | `admin/promote.tsx` | `GET /api/admin/users/search` | — | **No** | Low | **Critical** | Add filters (banned / suspended / demo / founding). Show avatar + join date + last-active. |
| 1.2 | Set/unset admin flag | `admin/promote.tsx` | `POST /api/admin/users/admin-flag` | — | **No** | Low | Critical | Audit-log every flag change with `set_by` + timestamp. Confirm dialog for demotion. |
| 1.3 | List existing admins | `admin/promote.tsx` | `GET /api/admin/admins` | — | **No** | Low | Critical | Show last-login + last-action per admin. |
| 1.4 | View member detail (moderation history, notes) | `admin/user/[id].tsx` | `GET /api/admin/users/{id}/moderation` | — | **No** | Medium | **Critical** | Full profile view: content history, reports filed *against*, reports filed *by*, warns/suspensions timeline, admin notes with author. |
| 1.5 | Warn member | `admin/user/[id].tsx` · `admin/report/[id].tsx` | `POST /api/admin/users/warn` | — | **No** | Low | Critical | Templated warning reasons; auto-log to member timeline. |
| 1.6 | Suspend member | same | `POST /api/admin/users/suspend` | — | **No** | Low | Critical | Duration picker (24h / 7d / 30d / custom) with auto-expiry. |
| 1.7 | Ban member | same | `POST /api/admin/users/ban` | — | **No** | Low | Critical | Optional appeal-window flag. |
| 1.8 | Restore banned/suspended member | same | `POST /api/admin/users/restore` | — | **No** | Low | Critical | Require restore reason for the log. |
| 1.9 | Delete member (hard delete) | *(implicit)* | `DELETE /api/admin/users/{id}` | — | **No** | Medium | Important | GDPR/right-to-erasure flow. Log the request, cascade to content, keep audit stub. |
| 1.10 | Add moderation note | `admin/user/[id].tsx` | `POST /api/admin/users/{id}/notes` | — | **No** | Low | Important | Rich-text; @-mention other admins. |
| 1.11 | Clear repeat-offender restriction | `admin/index.tsx` | `POST /api/admin/users/clear-restriction` | — | **No** | Low | Important | Requires "why" note. |
| 1.12 | Repeat-offender list | `admin/index.tsx` (tab) | `GET /api/admin/repeat-offenders` | — | **No** | Low | Important | Sort by severity; show all filed reports inline. |
| 1.13 | Waitlist management | *(no UI — API only)* | `GET /api/admin/waitlist` · `POST .../mark-invited` | — | **No** | Low | Nice-to-have | Merge with `interest_registrations` (already in MCGS?) — de-duplicate. |
| 1.14 | Founding Member CRUD | — | `GET/POST/PATCH/DELETE /api/cms/founding-members` | `/admin/founding-members` | **Full** | — | — | Nothing missing. |

---

## 🚩  DOMAIN 2 — REPORTS & MODERATION

| # | Feature | Mobile Location | Backend Route | MCGS Equivalent | Migrated? | Complexity | Priority | Improvements |
|---|---|---|---|---|---|---|---|---|
| 2.1 | Report inbox (list, filter by status) | `admin/index.tsx` (Reports tab) | `GET /api/admin/reports?status=` | *(Signal Feed shows some)* | **Partial** | Medium | **Critical** | Dedicated `/admin/reports` route with status tabs (new / reviewing / urgent / resolved). Link each row into the Signal Feed so reports and MCGS signals stay unified. |
| 2.2 | Report detail (evidence, reporter, target) | `admin/report/[id].tsx` | `GET /api/admin/reports/{id}` | — | **No** | Medium | Critical | Show target content inline; show reporter's own moderation history; one-click actions (warn / suspend / ban / remove). |
| 2.3 | Update report status | same | `POST /api/admin/reports/{id}/status` | — | **No** | Low | Critical | Automatic MCGS case-state change when report is resolved. |
| 2.4 | Remove offending content | `admin/report/[id].tsx` | `POST /api/admin/content/remove` | — | **No** | Low | Critical | Reason-tag required; content shadow-kept for audit. |
| 2.5 | Moderation policy view | *(no UI — API only)* | `GET /api/admin/policy` | — | **No** | Low | Important | Simple settings page: flag threshold, restrict threshold, window days, auto-ban toggle. |
| 2.6 | Signal Feed (MCGS-native) | — | `GET /api/mcgs/signals` + WebSocket `/mcgs/stream` | `/admin/bridge` | **Full** | — | — | Already the modern replacement layer; just needs report-inbox alignment (2.1). |
| 2.7 | Cases (grouped signals) | — | `GET /api/mcgs/cases` | `/admin/bridge` (partial) | **Partial** | Medium | Important | Full case-detail view with linked signals + timeline. |

---

## 💬  DOMAIN 3 — FEEDBACK / SUPPORT

| # | Feature | Mobile Location | Backend Route | MCGS Equivalent | Migrated? | Complexity | Priority | Improvements |
|---|---|---|---|---|---|---|---|---|
| 3.1 | Support ticket inbox | `admin/index.tsx` (Tickets tab) | `GET /api/admin/support/tickets` | — | **No** | Low | **Critical** | Filter by status/assignee; SLA hint. |
| 3.2 | Resolve ticket | same | `POST .../tickets/{id}/resolve` | — | **No** | Low | Critical | Also auto-close linked MCGS signal. |
| 3.3 | George drafts ticket reply | — | `POST /api/mcgs/proposals/ticket-reply` · `POST /api/mcgs/actions/ticket-reply` | Available in Signal Feed action panel | **Full** | — | — | Just needs surfacing on a dedicated Tickets page. |
| 3.4 | Contact form submissions | *(no UI)* | `GET /api/admin/contact-submissions` · `PATCH .../{id}` | — | **No** | Low | Important | Merge with tickets; convert to ticket automatically. |
| 3.5 | Interest registrations (RYI) | — | `GET /api/admin/interest-registrations` | `/admin/*` — via George | **Partial** | Low | Important | Add dedicated `/admin/interest-registrations` list + status update page. |

---

## 📅  DOMAIN 4 — EVENTS

| # | Feature | Mobile Location | Backend Route | MCGS Equivalent | Migrated? | Complexity | Priority | Improvements |
|---|---|---|---|---|---|---|---|---|
| 4.1 | List all events (admin view) | `admin/events.tsx` | `GET /api/admin/events` | `/admin/events` | **Partial** | Low | **Important** | MCGS route currently is CMS-events (paid/promoted) — mobile has *all* events. Unify. |
| 4.2 | Archive event | `admin/events.tsx` | `POST /api/admin/events/{id}/archive` | — | **No** | Low | Important | Add to CMS event editor. |
| 4.3 | Unarchive event | same | `POST .../unarchive` | — | **No** | Low | Important | — |
| 4.4 | Hard-delete event | same | `DELETE /api/admin/events/{id}` | — | **No** | Low | Important | Confirmation gate + audit log. |
| 4.5 | Cancel event (soft) | same | `api.cancelEvent` | — | **No** | Low | Important | Notify attendees automatically (post-launch). |
| 4.6 | Restore event | same | `api.restoreEvent` | — | **No** | Low | Important | — |
| 4.7 | CMS Events CRUD (public paid events) | — | `GET/POST/PATCH/DELETE /api/cms/events` | `/admin/events` + `/admin/events/[id]` | **Full** | — | — | Full RSVP mgmt already present. |
| 4.8 | Event submissions (public listing) | — | `GET /api/cms/event-submissions` + approve/reject | `/admin/event-submissions` | **Full** | — | — | Nothing missing. |
| 4.9 | George drafts event submission decision | — | `POST /api/mcgs/proposals/submission-decision` | Signal Feed action panel | **Full** | — | — | — |
| 4.10 | George drafts new event | — | `POST /api/mcgs/george/event/start` | `/admin/george/new-event` | **Full** | — | — | — |

---

## 👥  DOMAIN 5 — GROUPS

| # | Feature | Mobile Location | Backend Route | MCGS Equivalent | Migrated? | Complexity | Priority | Improvements |
|---|---|---|---|---|---|---|---|---|
| 5.1 | Pending groups queue | `admin/pending-groups.tsx` | `GET /api/admin/groups/pending` | — | **No** | Medium | **Important** | Show member count, creator profile, similar-groups check. |
| 5.2 | Approve group | same | `POST /api/admin/groups/{id}/approve` | — | **No** | Low | Important | Auto-generate welcome post + seat creator as owner. |
| 5.3 | Reject group | same | `POST /api/admin/groups/{id}/reject` | — | **No** | Low | Important | Rejection reason emailed to creator. |
| 5.4 | Full group management (edit, archive, disband) | *(none — only creator/mobile)* | *(no API)* | — | **No** | High | Nice-to-have | New capability. Post-parity work. |

---

## 📣  DOMAIN 6 — ANNOUNCEMENTS / NOTICES

| # | Feature | Mobile Location | Backend Route | MCGS Equivalent | Migrated? | Complexity | Priority | Improvements |
|---|---|---|---|---|---|---|---|---|
| 6.1 | Delete notice | *(implicit)* | `DELETE /api/admin/notices/{id}` | — | **No** | Low | Important | Add CRUD list `/admin/announcements`. |
| 6.2 | Create/edit notice | *(none — code-only)* | *(no API)* | — | **No** | Medium | Important | Compose UI + schedule + audience selector (all / founding / group-specific). |

---

## 🌐  DOMAIN 7 — WEBSITE CONTENT (already MCGS-native)

| # | Feature | MCGS Route | Backend Route | Status |
|---|---|---|---|---|
| 7.1 | Home page content | `/admin/home` | `PATCH /api/cms/content` | ✅ **Full** |
| 7.2 | About page | `/admin/about` | same | ✅ **Full** |
| 7.3 | FAQs | `/admin/faqs` | same | ✅ **Full** |
| 7.4 | Success stories CRUD | `/admin/success-stories/*` | `GET/POST/PATCH/DELETE /api/cms/success-stories` | ✅ **Full** |
| 7.5 | Founding Member wall CRUD | `/admin/founding-members/*` | `.../founding-members` | ✅ **Full** |
| 7.6 | Media library | `/admin/media` | `.../media` | ✅ **Full** |

---

## ⚙️  DOMAIN 8 — ADMINISTRATION / IDENTITY

| # | Feature | MCGS Route | Backend Route | Status | Improvements |
|---|---|---|---|---|---|
| 8.1 | Admin login | `/admin/login` | `POST /api/cms/auth/login` | ✅ **Full** | — |
| 8.2 | Setup first admin | `/admin/setup` | `.../auth/setup` | ✅ **Full** | — |
| 8.3 | Forgot / reset password | `/admin/forgot` · `/admin/reset` | `.../auth/forgot` · `.../auth/reset` | ✅ **Full** | — |
| 8.4 | My account (change password, display name) | `/admin/account` | `.../auth/me` · `.../auth/change-password` | ✅ **Full** | — |
| 8.5 | List / add / remove admins | `(none)` | `GET/POST/DELETE /api/cms/admins` | **Partial (API only)** | Add `/admin/admins` UI — unify with mobile's `promote.tsx` (item 1.1–1.3). |

---

## 📊  DOMAIN 9 — ANALYTICS & SETTINGS

| # | Feature | Mobile Location | Backend Route | MCGS Equivalent | Migrated? | Complexity | Priority | Improvements |
|---|---|---|---|---|---|---|---|---|
| 9.1 | Admin summary numbers (reports, users, tickets) | `admin/index.tsx` header | `GET /api/admin/summary` | Bridge sidebar (partial) | **Partial** | Low | Important | Wire summary tiles into MCGS dashboard properly (not just Bridge cards). |
| 9.2 | Growth analytics (signups, DAU) | *(none)* | `GET /api/admin/analytics/growth` | — | **No** | Medium | Important | Nice charts on `/admin/analytics`. |
| 9.3 | Engagement analytics | *(none)* | `GET /api/admin/analytics/engagement` | — | **No** | Medium | Important | — |
| 9.4 | Analytics summary | *(none)* | `GET /api/admin/analytics/summary` | — | **No** | Low | Important | — |
| 9.5 | Moderation policy settings | *(no UI)* | `GET /api/admin/policy` | — | **No** | Low | Nice-to-have | Simple form → save via new PATCH route. |
| 9.6 | MCGS rhythms settings (briefings) | — | `GET/PUT /api/mcgs/rhythms/settings` | *(no UI — API only)* | **Partial (API only)** | Low | Nice-to-have | Add `/admin/settings/rhythms` UI. |
| 9.7 | Invite flyer generator (legacy) | `admin/flyer.tsx` | `GET /api/admin/invite-flyer` | — | **No** | Low | Nice-to-have | Superseded by our new V3 flyer artwork; can be retired. |

---

## 🦋  DOMAIN 10 — MCGS-NATIVE (no mobile counterpart)

These are the newer capabilities that already live *only* in MCGS — no migration needed, listed here for completeness so we don't accidentally rebuild them.

| # | Feature | MCGS Route | Notes |
|---|---|---|---|
| 10.1 | The Bridge dashboard | `/admin/bridge` | Central command surface |
| 10.2 | Morning Briefing / Midday Pulse / End-of-Day | Bridge cards | Rhythms scheduler |
| 10.3 | George Presence + Ask George bar | Global AdminShell | Always-available chat |
| 10.4 | George Suggestion Card | Bridge sidebar | Proactive nudges |
| 10.5 | George event-creation session | `/admin/george/new-event` | Voice + multi-turn |
| 10.6 | George Remembers (inbox) | Global bell | Reminders queue |
| 10.7 | Milestones scan | Rhythms | Achievements |
| 10.8 | Signal → Case → Action pipeline | Signal Feed | Central triage |

---

## Summary tally

- **Fully migrated already**: 12 features (all website-content + admin identity + George/MCGS proposals)
- **Partial (needs UI polish or wiring)**: 8 features
- **Not migrated at all**: **31 features** — biggest gaps are Member Management (13 items), Reports & Moderation core screens (5), Groups (4), Announcements (2), Analytics (4), Settings (3)

---

# Phase 2 — Recommended migration order

Following your prioritisation exactly. Each row lists the concrete deliverable and rough estimate.

| Order | Slice | What ships | Est. | Depends on |
|---|---|---|---|---|
| **1** | **Member Management (foundation)** | `/admin/members` search + profile view + admin-flag toggles + moderation actions (warn / suspend / ban / restore) + notes + repeat-offender panel. | 3–4 days | AdminShell (done) |
| **2** | **Reports & Moderation** | `/admin/reports` list (with tabs) + `/admin/reports/[id]` detail with inline actions, content preview, and content-remove. Wire report resolution to auto-close MCGS signals. | 3 days | slice 1 |
| **3** | **Feedback / Support** | `/admin/support` unified ticket + contact-form inbox with George-drafted reply integration. `/admin/interest-registrations`. | 2 days | slice 2 |
| **4** | **Events** | Expand `/admin/events` from "CMS events only" to "all events" — add archive/unarchive/cancel/restore/delete controls to the existing editor. | 2 days | — |
| **5** | **Groups** | `/admin/groups/pending` approve/reject queue with similar-group hint. | 1.5 days | slice 1 |
| **6** | **Announcements** | New `/admin/announcements` CRUD with audience selector + schedule. Requires new backend endpoints. | 2 days | — |
| **7** | **Website Content polish** | Already fully migrated — small enhancements only (analytics tiles, activity log). | 0.5 day | — |
| **8** | **Administration** | `/admin/admins` UI merging mobile's promote screen. Audit-log page. | 1 day | slice 1 |
| **9** | **Settings** | `/admin/settings/rhythms` UI + `/admin/settings/moderation-policy` form. | 1 day | — |
| **10** | **Analytics** | `/admin/analytics` with growth + engagement + summary tiles. | 2 days | — |

**Total feature-parity effort: ~18–20 build days** before starting Mission Control 2.0.

## Cross-cutting recommendations (do once at the start of slice 1)

1. **Unified `AdminShell` sidebar refresh** — add Members / Reports / Support / Groups / Announcements / Settings nav items now so each slice just plugs into an existing chrome.
2. **Shared audit log** — every write action (warn, ban, delete, approve/reject) writes to a single `admin_log` collection with `{admin_id, action, target, reason, ts}`. Foundation for accountability + Mission Control 2.0 analytics.
3. **Consistent "Ask George about this" affordance** — every list row + detail page gets a small "Ask George" button that prefills the AdminShell chat bar with contextual query (e.g. `Tell me about @user`, `Why was this reported?`).
4. **Optimistic UI + real-time refresh** — piggyback on the existing MCGS WebSocket stream so newly-filed reports / tickets appear without a manual refresh.
5. **Retire mobile admin screens** once each domain is fully migrated. Replace with a single "Open Mission Control" link on the mobile app (like today's Bridge link) — no half-and-half admin split.

---

# Phase 3 (deferred) — Mission Control 2.0

Not building now. Listed so the parity work anchors toward it:

- **Mission Control Dashboard** — unified home replacing `/admin/dashboard` + `/admin/bridge`.
- **George as primary administrator** — routing every list, action and search through George's suggestion layer.
- **Morning Briefing v2** — live data, personalised to admin.
- **System Health Centre** — replaces the placeholder "Health Pulse" card with real rings (Belonging, Kindness, Safety, Growth).
- **Analytics 2.0** — visual charts, cohort views, community trend spotting.
- **Live Community Activity** — real-time member map / active-groups panel.
- **Community Insights** — themes George detects (e.g. "safety concerns rising in Group X").
- **Smarter Admin Tools** — bulk actions, saved filters, keyboard shortcuts, natural-language search ("show me every user @user reported last week").

---

**Sign-off requested**: is this the audit + order you want? Once confirmed I'll open **Slice 1 (Member Management)** and start building.

---

# Member Identity & Moderation Safeguards — non-negotiable contract

This contract applies to every slice that touches a member record (Slices 1, 2, 3, 5). It's honoured by the existing mobile app and MUST be preserved in Mission Control.

## What the current codebase already does (verified)

**Reports collection (`db.reports`)** persists both parties by unique account id:

| Field | Meaning |
|---|---|
| `reporter_id` | Unique account ID of the member who filed the report |
| `target_user_id` | Unique account ID of the reported member |
| `target_type` | `notice` \| `message` \| `dm` \| `user` |
| `target_id` | ID of the specific offending content (notice/message id) |
| `status` | `new` \| `reviewing` \| `resolved` \| `dismissed` |
| `urgent` | boolean |
| `outcome` | `warned` \| `suspended_Nh` \| `banned` \| `dismissed` |
| `admin_note`, `updated_at` | Resolution metadata |

When a member is hard-deleted for GDPR / right-to-erasure, `target_user_id` is anonymised to `"[deleted]"` — the historical report record survives; the identity is scrubbed.

**Report list endpoint** (`GET /api/admin/reports`) already enriches every row with the full reporter + target user objects looked up by their unique IDs (`first_name`, `username`, `avatar`, `restricted`, `is_admin`).

**Report detail endpoint** (`GET /api/admin/reports/{id}`) already returns `{report, reporter, target_user, related, target_history}` — including every previous report filed against the same `target_user_id`.

**Moderation action endpoints** all key off `user_id` (the unique Member ID), never a name:
- `POST /api/admin/users/warn`
- `POST /api/admin/users/suspend`
- `POST /api/admin/users/ban`
- `POST /api/admin/users/restore`
- `POST /api/admin/users/clear-restriction`

Every action writes an entry to the moderation history via `_log_moderation_action()`. If `report_id` is supplied, the report is auto-resolved with the outcome and `admin_note`.

## What MCGS MUST do (Slice 1 & Slice 2)

1. **Never store or act on a name alone.** Every report, member card, list row, action button and confirmation dialog must carry the target's unique `id` in its payload. The `user_id` in the API call is the source of truth; names are display-only.

2. **Report → Member profile in one click.** The report detail page must show a prominent "Open member profile →" link that navigates to `/admin/members/{target_user_id}` (never a search-by-name).

3. **All moderation actions originate from the member profile.** The report page can offer *shortcuts* (Warn / Suspend / Ban / Remove content) but every such shortcut opens the same confirmation dialog described below.

4. **Confirmation dialog — required for every suspend, ban and hard-delete.** Shows:
   - Member's **avatar** (fall back to initials if none)
   - **Full name** (as stored) + **display name** if different
   - **Member ID** (small, monospaced) — the unique account ID
   - **Email address**
   - **Join date** and **last active** timestamp
   - **Any current restriction flags** (banned, suspended-until, flagged-for-review, profile-hidden)
   - The intended action, in plain English ("You are about to **suspend Jane Doe for 24 hours**")
   - A **reason** input (required for suspend/ban)
   - Two-step confirmation: primary button starts disabled until the admin has read the identifiers, then a second click actually fires the API call
   - Cancel is the default and always available

5. **Warn is single-step but still shows the identity card** — no confirmation gate, but the same identity block renders in the compose panel so the admin can spot the wrong-person case before they hit Send.

6. **Restore is single-step** — the identity block renders but no reason is required beyond an optional note.

7. **Hard-delete requires typed confirmation** — admin must type the member's Member ID into the confirmation input before the delete button enables. This matches GitHub-style safe deletes.

8. **Every action writes to admin_log** (Slice 0 foundation) with `target_type: "member"`, `target_id: <member id>`, and full reason/before/after metadata.

## What the UI must never do

- ❌ Show a member's name without their avatar+ID within reach
- ❌ Offer "Ban this user" from a search-result row (only from the profile)
- ❌ Auto-focus or default the confirmation button (opt-in click required)
- ❌ Persist an admin's action if the JWT admin doesn't match the `admin_id` field in the body (server already enforces this — MCGS just needs to send it correctly)
- ❌ Show two members with the same name in a list without their Member ID and join-date visible

## Verified backend fields available for the identity card

From `db.users` — every field already stored today:

```
id, first_name, last_name, display_name, username, email,
avatar (or profile_image), created_at, last_active,
restricted, restricted_reason, restricted_at,
banned, suspended_until, flagged_for_review,
profile_hidden, is_admin
```

Nothing extra needs to be added to the User model. The safeguard is 100% a UI-and-workflow guarantee, enforced in the MCGS shell.

## Member profile = single source of truth (SSOT)

Wherever possible, **moderation actions begin from the member's profile**. No matter how an admin arrives at a member — from a report, search result, members list, audit log, notification, or another Mission Control surface — the workflow always routes through `/admin/members/{id}` before any consequential action.

Concretely:

- **Report detail** offers a big "Open member profile →" button. Inline shortcut buttons (Warn / Suspend / Ban) are cosmetic — clicking them navigates to the profile with the intended action pre-selected in the URL (e.g. `?action=suspend`) and the confirmation dialog opens on arrival, already populated.
- **Search results** never offer inline action buttons. Each row is a link to the profile.
- **Members list** never offers inline action buttons. Each row is a link to the profile.
- **Audit log** entries link back to the profile via the `target_id`.
- **George's suggestions** that reference a member always deep-link to the profile with the suggested action pre-selected.

Rationale: every moderation decision is made with the identity, moderation summary, timeline and full context in view. There is exactly one screen where a warn / suspend / ban / restore / delete is triggered, and that screen always shows the person you're about to affect.

The member profile is the central hub for everything relating to that member — history, notes, current restrictions, Ask George prompts, and every action button.

---

# Member Moderation History — preserve & enhance

The mobile app already ships a full moderation-history endpoint. Slice 1 MUST wire this into the MCGS member profile so every moderation decision is made with the member's full history visible on one screen.

## What the current backend already returns (verified)

**`GET /api/admin/users/{user_id}/moderation`** returns a single payload:

| Section | Contents |
|---|---|
| `user` | Full member object (avatar, name, ID, email, join date, last active, all restriction flags) — password/attempt fields stripped |
| `reports` | Every report ever filed against this member, newest first (up to 200) with reporter/target/target_content refs |
| `warnings` | Informal warnings stored on the user record itself (`user.warnings[]`) |
| `moderation_log` | Complete action timeline (warn / suspend / ban / restore / note / auto-hide / content-removal / clear-restriction) — each entry enriched with the **acting admin's** name and avatar so "who did this" is instant |
| `counts` | `reports_total`, `reports_open`, `actions_total` |

Each `moderation_log` entry contains:

```
{
  id, user_id, by (admin id | "system"),
  action, reason, target_type, target_id, report_id,
  created_at,
  # for suspensions: duration_hours, until
  by_user: { id, first_name, username, avatar }   # enriched by the endpoint
}
```

**`POST /api/admin/users/{user_id}/notes`** — free-form moderator notes are stored *in the same moderation_log collection* with `action: "note"`. That means the "notes" the user asked about are already threaded chronologically alongside warnings/suspensions/bans — one unified timeline. No separate collection to migrate.

## Slice 1 — Member profile MUST include

The MCGS `/admin/members/[id]` page will hit `GET /api/admin/users/{user_id}/moderation` and render the whole payload as a single scannable page:

1. **Identity card** at the top — everything the safeguard contract above requires (avatar, full name, Member ID, email, join date, last active, active restriction flags).
2. **"If we're here from a report" banner** — when the profile is opened from a report detail, a sticky pill at the top of the page shows *"Reviewing report R-1234 · Open report"* so the admin never loses context.
3. **Moderation Summary card** — the "headline" that sits above the timeline so an admin can size up the member in one glance, before diving into detail. Four small stat blocks in one row:

   | Reports | Actions | Notes | Last action |
   |---|---|---|---|
   | Total: N<br/>Open: N | Warnings: N<br/>Suspensions: N<br/>Bans: N | Moderator notes: N | Last action label<br/>(relative, e.g. "3 days ago") + absolute date on hover |

   All numbers are derived client-side from the same `GET /api/admin/users/{user_id}/moderation` payload — no extra endpoint, no drift possible. Clicking any stat scopes the timeline filter to match. Zero counts render in muted grey so busy members are visually distinct. Serves as the counts strip too — no separate row.

4. **Unified moderation timeline** — reports and moderation_log merged into a single reverse-chronological feed. Each row shows:
   - date & time (relative + absolute on hover)
   - action icon + label (Warned / Suspended 24h / Banned / Restored / Note / Report filed / Content removed)
   - acting admin's avatar + name (or "System" for automated actions)
   - reason / note text
   - link to the source (report card / removed content) when applicable
   - outcome badge for reports (`warned`, `suspended_24h`, `banned`, `dismissed`)
5. **Filter chips**: All · Reports · Actions · Notes · Auto-actions
6. **Add note** — inline compose at the top of the timeline. Uses `POST /api/admin/users/{user_id}/notes`. Appears immediately in the feed.
7. **Action rail** on the right side — Warn / Suspend / Ban / Restore / Delete buttons. Every one opens the confirmation dialog described in the safeguard contract. `report_id` is automatically forwarded when the profile was opened from a report so the report auto-resolves with the outcome.
8. **"Ask George about this member"** — pre-composed prompts. George helps admins understand and remain consistent; George never decides:
   - *Summarise this member's moderation history.*
   - *Compare this member's previous reports and suggest a proportional action.*
   - *Are there any patterns in the reports against this member?*
   - *Is there anything unusual about this member's account activity?*
   - *Have we treated similar cases consistently?* (fairness lens — compares outcomes across members with comparable report profiles so admins can spot drift or over-correction)

## Enhancements while migrating (do not redesign — layer on)

- **Timeline density toggle** (Compact / Comfortable) — desktop can afford richer rows than mobile.
- **Keyboard shortcuts** on the profile: `w` warn, `s` suspend, `b` ban, `r` restore, `n` add note, `?` show cheatsheet. Every shortcut still opens the confirmation dialog.
- **Report ↔ Profile stays in the URL** — visiting `/admin/members/{id}?from=report:R-1234` keeps the report ref sticky through page reloads.
- **Automatic linking** — when a report references a target content id, the timeline entry becomes a clickable card that expands the removed/hidden content inline for context.
- **Audit-log crosswalk** — every action taken from this screen writes both to `moderation_log` (existing, for the member's timeline) AND `admin_log` (Slice 0, for the cross-cutting admin activity view). Same event, two lenses.

## Verified — nothing to add on the backend

- `_log_moderation_action()` already writes to `moderation_log` on every warn / suspend / ban / restore / note / clear-restriction / auto-action.
- `moderation_log` entries are enriched with acting-admin details before they're returned to the UI.
- The `report_id` field on each moderation_log entry lets the UI cross-link a moderator's action back to the originating report and vice-versa.

Slice 1 will faithfully consume this endpoint. No backend changes needed for the profile timeline. Backend work in Slice 1 is limited to adding search + list endpoints (which don't exist as convenient shapes yet) and the `admin_log` writes on top of the existing `moderation_log` writes.

---

# Appendix — Slice 0 (Foundation) delivered

Completed in the same session as Phase 1 sign-off.

### Backend
- `services/audit.py` — `log_admin_action()`, `list_admin_log()`, `count_admin_log()`, `KNOWN_ACTIONS` catalogue. Writes to Mongo collection `admin_log` (append-only, never mutated). All write failures swallowed so audit-log outages can never break a moderator's action.
- `cms_module.py` — `GET /api/cms/admin-log` (paginated, filter by `action_prefix` / `target_type` / `target_id` / `admin_id`) and `GET /api/cms/admin-log/actions` (returns the well-known action catalogue for filter dropdowns).

### Frontend (Next.js)
- `components/admin/AdminShell.tsx` — sidebar refreshed into 5 grouped sections (Mission Control / Community / Website / Insights / System). Placeholder routes marked with a small "Soon" pill so admins can see the roadmap without leaving the app.
- `components/admin/ComingSoon.tsx` — reusable Slice-preview page. Every unfinished slice ships as a real route explaining what's coming, so the sidebar never 404s and Garry can see progress at a glance.
- `components/mcgs/AskGeorgeAboutThis.tsx` — reusable "Ask George about this" button + `useAskGeorge()` hook. Dispatches `mcgs:ask-george` custom event picked up by the existing AskGeorgeBar. Supports single-prompt (immediate) and multi-prompt (disclosure menu). Never renders without meaningful context.
- Placeholder routes: `/admin/members`, `/admin/reports`, `/admin/support`, `/admin/groups/pending`, `/admin/announcements`, `/admin/admins`, `/admin/settings`, `/admin/analytics`.
- `/admin/audit-log` — first fully-functional Slice 0 page. Filter by action namespace or target type, ask George to summarise the log. Serves as the reference implementation for future list pages.

### Verified
- All 17 admin routes return 200 locally.
- `GET /api/cms/admin-log` returns 401 when unauthenticated (JWT guard working) and 200 with paginated results when authenticated.

