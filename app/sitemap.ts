import type { MetadataRoute } from 'next';
import { site } from '@/lib/brand';

/**
 * Programmatic sitemap. Only enumerates the STATIC public marketing
 * pages — /admin/* is authenticated CMS and must never appear here,
 * and event / member detail pages are generated dynamically (the
 * public event routes are dynamic and would need a live-data call
 * to enumerate; Google can still discover them via internal links
 * from /events).
 *
 * Kept intentionally small so it stays trustworthy at launch. When
 * we ship long-form content (blog, moment gallery, event archive)
 * add entries here so search engines see them promptly.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = site.urlProduction.replace(/\/$/, '');
  const lastModified = new Date();
  const staticPaths: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[0]['changeFrequency'] }[] = [
    { path: '/',                    priority: 1.0, changeFrequency: 'weekly'  },
    { path: '/about',               priority: 0.8, changeFrequency: 'monthly' },
    { path: '/features',            priority: 0.8, changeFrequency: 'monthly' },
    { path: '/how-it-works',        priority: 0.8, changeFrequency: 'monthly' },
    { path: '/meet',                priority: 0.7, changeFrequency: 'weekly'  },
    { path: '/events',              priority: 0.7, changeFrequency: 'daily'   },
    { path: '/success-stories',     priority: 0.6, changeFrequency: 'weekly'  },
    { path: '/faqs',                priority: 0.6, changeFrequency: 'monthly' },
    { path: '/list-your-event',     priority: 0.5, changeFrequency: 'monthly' },
    { path: '/register-interest',   priority: 0.5, changeFrequency: 'monthly' },
    { path: '/contact',             priority: 0.4, changeFrequency: 'monthly' },
    { path: '/privacy',             priority: 0.3, changeFrequency: 'yearly'  },
    { path: '/terms',               priority: 0.3, changeFrequency: 'yearly'  },
  ];
  return staticPaths.map((s) => ({
    url: `${base}${s.path}`,
    lastModified,
    changeFrequency: s.changeFrequency,
    priority: s.priority,
  }));
}
