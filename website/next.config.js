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
  // Post-launch (Aug 2026): skip the X-Robots-Tag: noindex header on
  // Vercel production and when explicitly opted-in. Preview /
  // development deploys still receive the header (VERCEL_ENV=preview
  // or development). Explicit FRIENDPLACE_INDEXABLE=false forces the
  // header on as an emergency killswitch even in production.
  async headers() {
    const flag = process.env.FRIENDPLACE_INDEXABLE;
    const indexable =
      flag === 'true' ||
      (flag !== 'false' && process.env.VERCEL_ENV === 'production');
    if (indexable) return [];
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
