import { NextRequest, NextResponse } from 'next/server';

/**
 * Canonical-domain enforcement.
 *
 * The Vercel project is aliased to BOTH:
 *   - friendplace.com.au (canonical, cookies scoped here)
 *   - friendplace-website.vercel.app (Vercel auto-assigned production URL)
 *
 * Admin JWT cookies are Domain=friendplace.com.au — so any admin
 * session opened on the .vercel.app host cannot see the token and
 * gets bounced to /admin/login, which then can't reach the API from
 * the wrong origin and shows "Unable to reach the admin API".
 *
 * This middleware redirects ONLY the exact production Vercel host
 * (`friendplace-website.vercel.app`) to the canonical domain,
 * preserving pathname, query string, method, and body.
 *
 * Preview deployments (friendplace-website-<hash>.vercel.app) and
 * every other host are passed through untouched, so branch previews
 * continue to work normally.
 */
const CANONICAL_HOST = 'www.friendplace.com.au';
const TRAPPED_HOST = 'friendplace-website.vercel.app';

export function middleware(req: NextRequest) {
  const host = req.headers.get('host') || '';
  if (host === TRAPPED_HOST) {
    const url = req.nextUrl.clone();
    url.host = CANONICAL_HOST;
    url.protocol = 'https:';
    // 308 preserves method + body, unlike 301/302.
    return NextResponse.redirect(url, 308);
  }
  return NextResponse.next();
}

export const config = {
  // Cover every route — this is a domain-level rule. Exclude Next.js
  // internals and static assets so we don't add redirect hops to
  // every image / chunk request.
  matcher: [
    '/((?!_next/static|_next/image|favicon|brand-assets|robots.txt|sitemap.xml).*)',
  ],
};
