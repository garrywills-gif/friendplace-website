# MCGS Phase 1 — E2E test scope

## Original problem statement
Build the Mission Control George System (MCGS) — an operations centre for FriendPlace with grounded AI assistant George, live Signal Feed, Action Preview pattern, and voice input.

## Testing scope for this sweep (backend focus)
Phase 1 of MCGS, feature complete except Rhythms/Insights/Studios consolidation. Test the following backend flows.

## Existing test credentials
- CMS admin: `hello@friendplace.com.au` / `TestPass2026!` (see /app/memory/test_credentials.md)
- Backend URL: `http://localhost:8001`
- Route base for MCGS: `/api/mcgs/*` and `/api/george/*`
- All /api/mcgs and /api/george routes require `Authorization: Bearer <token>` obtained from `POST /api/cms/auth/login`.
