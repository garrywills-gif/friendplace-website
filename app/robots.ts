import type { MetadataRoute } from 'next';
import { site } from '@/lib/brand';

/**
 * Programmatic robots.txt.
 *
 * Production is indexable by default.
 * Preview/development builds remain blocked from search engines.
 *
 * FRIENDPLACE_INDEXABLE=true  forces indexing.
 * FRIENDPLACE_INDEXABLE=false blocks indexing as an emergency override.
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
        disallow: ['/admin', '/admin/*'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
