import type { MetadataRoute } from 'next';
import { site } from '@/lib/brand';

/**
 * Programmatic robots.txt.
 *
 * Post-launch behaviour (Aug 2026):
 *   • Vercel PRODUCTION (VERCEL_ENV=production) → indexable by default.
 *     Emits Allow: / plus Disallow: /admin, /admin/*, and points at
 *     the generated /sitemap.xml.
 *   • Vercel PREVIEW / DEVELOPMENT → disallow everything so branch
 *     deploys and local builds never leak into search indexes.
 *
 * Explicit overrides (belt-and-braces):
 *   • FRIENDPLACE_INDEXABLE=true  — force indexable (any environment).
 *   • FRIENDPLACE_INDEXABLE=false — emergency killswitch on prod.
 *
 * Admin/MCGS, member-only routes and the FastAPI backend
 * (api.friendplace.com.au / *.k8s ingress) are either behind auth or on
 * a different hostname, so they are not covered by this file.
 */
export default function robots(): MetadataRoute.Robots {
  const flag = process.env.FRIENDPLACE_INDEXABLE;
  const indexable =
    flag === 'true' ||
    (flag !== 'false' && process.env.VERCEL_ENV === 'production');
  const base = site.urlProduction.replace(/\/$/, '');
  if (!indexable) {
    return {
      rules: [{ userAgent: '*', disallow: '/' }],
    };
  }
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Never crawl the CMS. It's authenticated anyway but keeping
        // it out of the crawl budget is polite to Google.
        disallow: ['/admin', '/admin/*'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
