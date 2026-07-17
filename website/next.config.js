/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Serve the website under /website so it can co-exist with the Expo
  // mobile-app preview on the same domain in dev. In production
  // (Vercel + friendplace.com.au) we override this with NEXT_BASE_PATH
  // set to '' so the site is served at the domain root as expected.
  basePath: process.env.NEXT_BASE_PATH === '' ? '' : (process.env.NEXT_BASE_PATH || '/website'),
  assetPrefix: process.env.NEXT_BASE_PATH === '' ? '' : (process.env.NEXT_BASE_PATH || '/website'),
  devIndicators: { appIsrStatus: false, buildActivity: false },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'https://belong-together.preview.emergentagent.com',
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
};

module.exports = nextConfig;
