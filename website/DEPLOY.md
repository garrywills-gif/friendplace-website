# Deploying FriendPlace Website to Vercel

## What's in this folder

A production-ready Next.js 14 marketing site for FriendPlace. Every
page pre-renders to static HTML for optimal SEO + speed. Content is
fetched from the FriendPlace FastAPI backend at request time so the
website + mobile app stay perfectly in sync.

## Pre-launch privacy — ON by default

Until you set the env var `FRIENDPLACE_INDEXABLE=true`, the site is:
- Blocked in `robots.txt` (`Disallow: /`)
- Served with `X-Robots-Tag: noindex, nofollow, noarchive` header
- Every page carries `<meta name="robots" content="noindex, nofollow">`

Search engines will not list your site until you explicitly flip the
switch. Safe to share the Vercel URL privately for feedback.

## Environment variables to set in Vercel

| Name                     | Value                                                        | Notes                              |
| ------------------------ | ------------------------------------------------------------ | ---------------------------------- |
| `NEXT_PUBLIC_API_URL`    | `https://belong-together.preview.emergentagent.com`          | Your live FastAPI + MongoDB URL    |
| `FRIENDPLACE_INDEXABLE`  | *(leave unset for now)*                                      | Set to `true` at official launch   |

## Deploying — three options

### Option A — Vercel CLI drag-and-drop (simplest, no GitHub needed)
1. Create a free account at https://vercel.com/signup
2. On your Mac, install the CLI: `npm i -g vercel`
3. From THIS folder, run `vercel` and follow the prompts
4. Vercel gives you a URL like `friendplace-abc123.vercel.app`

### Option B — GitHub import (recommended if you want auto-deploy on future changes)
1. Create a GitHub repo (private is fine)
2. Push the `/app/website` folder as its own repo
3. Go to https://vercel.com/new → Import from GitHub
4. Add the env vars in the "Environment Variables" section
5. Click Deploy

### Option C — Have Neo deploy for you
Give me a **Vercel Deploy Token** (Vercel → Settings → Tokens → Create)
and I'll deploy directly using the API. Token can be scoped to just
this project.

## After deployment

- Vercel URL is now live (still noindex-protected)
- Share it privately for feedback
- When ready to launch:
  1. Point `friendplace.com.au` DNS at Vercel:
     - `A` record on `@` → `76.76.21.21`
     - `CNAME` on `www` → `cname.vercel-dns.com`
  2. In Vercel dashboard: Project → Settings → Domains → add
     `friendplace.com.au` and `www.friendplace.com.au`
  3. In Vercel env vars: set `FRIENDPLACE_INDEXABLE=true`
  4. Redeploy (one click)
  5. Submit sitemap to Google Search Console
