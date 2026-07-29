/**
 * Central source of truth for the FastAPI backend URL used by every
 * client-side and server-side data fetch in the Next.js website.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Historically each caller had:
 *
 *   const BASE = process.env.NEXT_PUBLIC_API_URL || '';
 *
 * That "|| ''" fallback was silently corrupting deployed builds: on
 * Vercel deployments where NEXT_PUBLIC_API_URL wasn't set in the
 * dashboard, every client-side fetch became a same-origin request
 * (e.g. `https://your-site.vercel.app/api/cms/auth/login`) and returned
 * a 404 from Vercel's edge — exactly the Mission Control CMS login
 * failure we were seeing.
 *
 * By putting the real production URL as a literal string here, the
 * build's bundler inlines the correct backend even when the env var
 * is missing. Any explicit NEXT_PUBLIC_API_URL still wins (useful
 * for staging / local overrides). Server-side callers use the same
 * constant so /events, /success-stories, RSS, etc. stay consistent.
 *
 * WHERE TO CHANGE
 * ---------------
 * When we cut over to api.friendplace.com.au, update
 * DEFAULT_API_BASE below and redeploy. That's the only edit.
 */

const DEFAULT_API_BASE = 'https://george-mcgs-cms.preview.emergentagent.com';

export const API_BASE: string =
  process.env.NEXT_PUBLIC_API_URL && process.env.NEXT_PUBLIC_API_URL.trim().length > 0
    ? process.env.NEXT_PUBLIC_API_URL
    : DEFAULT_API_BASE;
