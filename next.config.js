/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // basePath defaults to '' so the site is served at the domain root
  // in production (Vercel + friendplace.com.au). Set NEXT_BASE_PATH
  // to '/website' locally if you ever want to co-host with the Expo
  // dev server on the same port. Empty in prod = correct behaviour.
  basePath: process.env.NEXT_BASE_PATH || '',
  assetPrefix: process.env.NEXT_BASE_PATH || '',
  devIndicators: { appIsrStatus: false, buildActivity: false },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'https://belong-together.emergent.host',
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  // Pre-launch: keep the site OUT of search engines until we're ready.
  // Flipping FRIENDPLACE_INDEXABLE=true in Vercel env makes the site
  // discoverable. Layered defence: X-Robots-Tag header + robots.txt
  // + meta robots (in <head>).
  async headers() {
    // iter157 Safari hardening (Garry, 7 Aug 2026): after a Vercel
    // deploy, Safari sometimes serves an OLD cached HTML that still
    // references the previous build's JS chunk hashes — those
    // chunks still work but the sticky-header GPU composited-layer
    // regression compounds. We hint every marketing HTML entry as
    // `no-store` so Safari always re-fetches the HTML (which points
    // to the correct fingerprinted chunk); the chunks themselves
    // stay long-cached because Next.js fingerprints their filenames
    // and Vercel serves them with `immutable` by default. Applied
    // to top-level marketing routes only — admin/api paths keep
    // their own semantics. `X-Accel-Buffering: no` also stops
    // some intermediate proxies from stitching stale HTML fragments.
    const marketingHtmlHeaders = [
      { key: 'Cache-Control', value: 'no-store, must-revalidate' },
      { key: 'X-Accel-Buffering', value: 'no' },
    ];
    const marketingRoutes = [
      '/', '/about', '/how-it-works', '/features',
      '/events', '/events/:slug*',
      '/success-stories', '/success-stories/:slug*',
      '/faqs', '/contact', '/meet',
      '/register-interest', '/list-your-event',
      '/privacy', '/terms', '/butterfly-lab',
    ].map((src) => ({ source: src, headers: marketingHtmlHeaders }));

    const noindex = process.env.FRIENDPLACE_INDEXABLE === 'true'
      ? []
      : [{
          source: '/:path*',
          headers: [
            { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive, nosnippet' },
          ],
        }];

    return [...noindex, ...marketingRoutes];
  },
};

module.exports = nextConfig;
