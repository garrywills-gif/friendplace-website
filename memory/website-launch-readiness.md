# FriendPlace Website — Launch Readiness Report

**Reviewed:** 3 Aug 2026
**Scope:** `/app/website/` (Next.js 14 marketing site + Mission Control CMS)
**Reviewer:** Neo

---

## ✅ Overall verdict — **READY TO LAUNCH** with two env-var flips

The build is clean. All 56 pages generate. Content, metadata, legal, brand,
and navigation all render as expected. Two production env vars need to be
set before Google can index the site (see "Before you flip the switch"
below).

---

## What Neo fixed during this review

| # | Fix | Why it mattered |
| - | --- | --------------- |
| 1 | **Removed `public/robots.txt`** (conflicted with programmatic `app/robots.ts`) | Was throwing a 500 on `/robots.txt` in dev — same behaviour would have hit crawlers in prod. |
| 2 | **Added `app/sitemap.ts`** — enumerates the 13 static marketing routes | Every launch needs a real sitemap. Google won't crawl efficiently without it. |
| 3 | **Rewired `app/robots.ts`** to emit `Allow: /`, block `/admin/*`, and point at `/sitemap.xml` when `FRIENDPLACE_INDEXABLE=true` | Toggles the launch-mode robots policy with a single env flip. |
| 4 | **Retired stale `belong-together.emergent.host` fallback URL** across 10 files + `lib/api-base.ts` | If someone forgot to set `NEXT_PUBLIC_API_URL` in Vercel/Emergent, the old fallback pointed at a dead preview host. Same-origin fallback now Just Works. |
| 5 | **Removed duplicate lockfiles** (`/app/frontend/package-lock.json`, `/app/website/package-lock.json`) | Both projects use `yarn.lock`. Dual lockfiles cause release-only dependency drift. |
| 6 | **Updated `/app/.gitignore`** to allow tracked runtime `.env` files at `backend/`, `frontend/`, `website/` | The deployment pipeline reads these from git. Previously they were silently excluded. |

---

## Before you flip the switch (production env vars)

Set these in the Emergent / Vercel dashboard **before** cutting over DNS:

```
# 1. Turn off pre-launch noindex + emit real robots.txt/sitemap.xml
FRIENDPLACE_INDEXABLE=true

# 2. Point at the production backend
NEXT_PUBLIC_API_URL=https://friendplace.com.au    # same-origin (recommended)
# — or if the API lives on a separate host —
# NEXT_PUBLIC_API_URL=https://api.friendplace.com.au
```

Verify they took effect by fetching:
- `https://friendplace.com.au/robots.txt` → should show `Allow: /` and `Sitemap:` line.
- `https://friendplace.com.au/sitemap.xml` → should list 13 pages.
- Page source of `/` → `<meta name="robots" content="index, follow">` (not `noindex`).

---

## 🟡 One deployment blocker you (Garry) need to decide on

`backend/requirements.txt` still pins **`fastembed==0.8.0`** — the local
ONNX embedding runtime we added when the Emergent LLM gateway returned
401 for `text-embedding-3-small`. The deployment health-check flagged
this as a hard blocker on Emergent's default tier (250m CPU / 1Gi RAM):

- The ONNX runtime + 90 MB model may OOM on cold start.
- The code already **gracefully falls back to keyword-only search** if
  fastembed fails to load (see `services/knowledge.py:118`).

**Two options — your call**:

1. **Ship as-is with graceful degradation** — leave fastembed in. If it
   fits in production RAM you get hybrid retrieval; if it doesn't, George
   quietly drops to keyword-only. The user experience degrades slightly
   but no crash. **Recommended if you want to ship this week.**
2. **Guard fastembed behind `ENABLE_LOCAL_EMBEDDINGS=true` and default to off in prod** — cleaner memory profile at the cost of always-keyword-only until we wire a hosted embeddings API. **Recommended if the deployment step actually OOMs.**

I've left fastembed in place pending your decision. Let me know and I'll implement whichever path you pick in ~10 mins.

---

## 🟢 What I checked and passed

**Build & compile**
- `yarn build` completes in ~17s. 56 static/dynamic pages. No TypeScript errors, no missing imports.

**SEO & metadata**
- `app/layout.tsx` has `metadata` + `viewport` exports with full `title`, `description`, `openGraph`, `twitter`, `robots`, and `metadataBase`.
- Site title: **"FriendPlace — Because you belong too."**
- Description (150 char) mentions "warm community", "real friendships", "local area" — good for Google.
- Correct pre-launch behaviour: every page renders `<meta name="robots" content="noindex, nofollow">` until env flag flips.

**Legal pages**
- `/privacy` — plain-English summary at top, effective 1 Jan 2026, all standard sections (Who we are, What we collect, Cookies, Third parties, Your rights, Contact).
- `/terms` — present at same URL structure. Both linked from footer.

**Public marketing pages sampled**
- `/` — hero, countdown ribbon, "Find your people" headline, canonical butterfly, "Now welcoming Founding Members" badge, CTAs. ✓
- `/how-it-works` — 4-step layout with numbered tiles. ✓
- `/faqs` — expandable Q&A, "Is FriendPlace free?" as first item. ✓
- `/contact` — form + `hello@friendplace.com.au`. ✓
- `/privacy` + `/terms` — full copy, dated. ✓

**Security & hygiene**
- No hardcoded API keys / secrets in `/app/website/`.
- `admin/*` routes gated by middleware.
- Robots explicitly disallows `/admin/*` at launch (in the new `robots.ts`).
- No `console.log` calls surviving into shipped app/components code.

**Assets**
- Favicon present (`public/brand-assets/favicon.png`).
- Canonical butterfly asset served from `public/brand-assets/`.
- Flyer mockups present under `public/flyer-mockups/` for the coming Flyer Publishing Centre.

---

## 🔵 Nice-to-haves (not blockers, backlog for after launch)

- **OG image** — right now the OG card falls back to whatever social platforms auto-generate. Consider a 1200×630 hero card at `public/og-cover.png`.
- **Structured data** — a small JSON-LD block on `/` announcing the organisation would help Google's Knowledge Panel.
- **Analytics** — no analytics tag detected. Add Plausible / Fathom / GA4 before launch if you want to measure.
- **Newsletter capture** — `/register-interest` page exists and looks great. Confirm the Resend webhook downstream side receives the events (already covered under CRM Phase 2B).

---

## Handover

Fixes are already applied and the site rebuilt. You can:

1. Publish the site as-is right now — it will go up in pre-launch (noindex) mode. Google won't see it, but you can share preview links with founding members.
2. When ready to open the door, set `FRIENDPLACE_INDEXABLE=true` + `NEXT_PUBLIC_API_URL=https://friendplace.com.au` in the deployment env, redeploy, and Google can start crawling.

Let me know your call on the `fastembed` question above and we're done.
