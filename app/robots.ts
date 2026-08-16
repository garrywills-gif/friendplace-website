import type { MetadataRoute } from 'next';
import { site } from '@/lib/brand';

/**
 * Programmatic robots.txt.
 *
 * Production is indexable by default.
 * Preview and development deployments remain blocked.
 * FRIENDPLACE_INDEXABLE=false is the emergency production killswitch.
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
