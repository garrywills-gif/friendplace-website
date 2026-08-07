import type { MetadataRoute } from 'next';
import { site } from '@/lib/brand';

/**
 * Programmatic robots.txt.
 *
 * Two-mode operation:
 *   • `FRIENDPLACE_INDEXABLE=true` (LAUNCH) — allow the whole public
 *     site to be crawled, block /admin/* explicitly, and point crawlers
 *     at the generated /sitemap.xml.
 *   • Anything else (PRE-LAUNCH DEFAULT) — disallow everything so
 *     search engines don't index the staging build.
 *
 * Flip via the Vercel / Emergent env var. No code changes needed to
 * go live.
 */
export default function robots(): MetadataRoute.Robots {
  const indexable = process.env.FRIENDPLACE_INDEXABLE === 'true';
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
