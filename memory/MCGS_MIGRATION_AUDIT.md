# MCGS Migration Audit — Phase 1

**Author:** Neo (agent)  
**Purpose:** Establish exact feature parity between the mobile-app admin tools and MCGS (the Next.js Mission Control) before adding new functionality.

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
