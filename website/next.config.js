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
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'https://george-mcgs-cms.preview.emergentagent.com',
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
    if (process.env.FRIENDPLACE_INDEXABLE === 'true') return [];
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive, nosnippet' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
