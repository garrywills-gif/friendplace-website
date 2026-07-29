# Deploying FriendPlace Website to Vercel

> **Status: V1 launch candidate.** Backend confirmed live at `https://belong-together.emergent.host` (FastAPI + MongoDB Atlas). Website code is deploy-ready.

## What's in this folder

A production-ready Next.js 14 marketing site + Mini-CMS + MCGS admin surfaces for FriendPlace. Every public page pre-renders to static HTML for SEO and speed. All content is fetched from the FriendPlace FastAPI backend at request time so the website and mobile app stay perfectly in sync.

## Backend production URL

The live FastAPI backend (already deployed by Emergent) is:

```
https://belong-together.emergent.host
```

Every API path in this codebase is composed as `${API_BASE}/api/…` — so the base URL you set in Vercel is the **origin only**, without `/api`. `api-base.ts` and `next.config.js` fall back to this same origin if the env var is missing, so the site cannot accidentally same-origin itself.

## Pre-launch privacy — ON by default

Until you set `FRIENDPLACE_INDEXABLE=true` in Vercel, the site is:
- Blocked in `robots.txt` (`Disallow: /`)
- Served with `X-Robots-Tag: noindex, nofollow, noarchive` header
- Every page carries `<meta name="robots" content="noindex, nofollow">`

Safe to share the Vercel preview URL privately for feedback. Flip the switch only when you're ready for Google.

## Environment variables to set in Vercel

| Name | Value | Required at launch |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://belong-together.emergent.host` | ✅ Yes |
| `FRIENDPLACE_INDEXABLE` | *(leave unset until launch, then set to `true`)* | ⚪ Later |

> That's it — the website itself doesn't need MongoDB or Resend keys. The backend at `belong-together.emergent.host` already has all of those configured (`MONGO_URL`, `EMERGENT_LLM_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `JWT_SECRET`, `APPLE_SIWA_*`). The website only ever talks to the backend over HTTPS.

## Simplest deploy path (recommended — 10 minutes, no GitHub)

1. **Create a free Vercel account** at https://vercel.com/signup (use your Apple/Google login for speed).

2. **Install the Vercel CLI on your Mac**:
   ```
   npm i -g vercel
   ```

3. **Deploy from this folder**:
   ```
   cd /app/website
   vercel
   ```
   - When it asks "Set up and deploy?" → **Y**
   - "Which scope?" → your personal account
   - "Link to existing project?" → **N**
   - "What's your project's name?" → `friendplace` (or accept the default)
   - "In which directory is your code located?" → **./** (just press Enter)
   - It will auto-detect Next.js and deploy.

4. **Add the env var** (in the Vercel dashboard):
   - Go to your new project → Settings → Environment Variables
   - Add: `NEXT_PUBLIC_API_URL` = `https://belong-together.emergent.host`
   - Apply to: **Production, Preview, Development** (all three)
   - **Redeploy** (Deployments tab → click the latest → Redeploy) — this bakes the env var into the build.

5. **Smoke test the Vercel preview URL** (something like `friendplace-abc123.vercel.app`):
   ```
   curl -sL -o /dev/null -w "%{http_code}\n" https://<your-vercel-url>/meet
   curl -sL -o /dev/null -w "%{http_code}\n" https://<your-vercel-url>/register-interest
   ```
   Both should return **200**. If yes, proceed to domain attachment.

## Attach `friendplace.com.au`

1. In the Vercel dashboard: Project → **Settings** → **Domains**.
2. Add `friendplace.com.au` — Vercel will show you the DNS records to add.
3. In your domain registrar's DNS panel (wherever `friendplace.com.au` is registered — GoDaddy, Namecheap, Crazy Domains, etc.), update:
   - `A` record on `@` → `76.76.21.21`
   - `CNAME` on `www` → `cname.vercel-dns.com`
4. Also add `www.friendplace.com.au` in Vercel Domains and set it to redirect to the apex.
5. DNS propagation typically takes 5–30 minutes. Vercel auto-issues an SSL certificate once verified.

## When you're ready to go public

1. In Vercel env vars, set `FRIENDPLACE_INDEXABLE=true`.
2. Redeploy.
3. Confirm on the live domain:
   ```
   curl -sL -o /dev/null -w "%{http_code}\n" https://friendplace.com.au/meet
   curl -sL -o /dev/null -w "%{http_code}\n" https://friendplace.com.au/register-interest
   ```
   Both must be **200**.
4. Submit sitemap to Google Search Console: `https://friendplace.com.au/sitemap.xml`.
5. Test end-to-end: submit the RYI form with a real email → confirm you receive the Resend welcome email.
6. Now safe to generate iOS + Android builds — they link to routes that finally exist.

## Rollback plan

Vercel keeps every deployment. If anything looks wrong after publish:
1. Deployments tab → find the previous good deployment.
2. Click the "…" menu → **Promote to Production**.
3. Instant rollback, no downtime.

## Alternate deploy paths (if you prefer)

- **GitHub import**: push `/app/website` to a private GitHub repo, then Vercel → New Project → Import. Same env var setup applies. Bonus: every future `git push` auto-deploys.
- **Vercel Deploy Token**: create a token in Vercel (Settings → Tokens) and I can deploy for you from this environment via API.
