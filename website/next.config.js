/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Suppress the yellow "N" badge + red error overlay in dev preview so
  // the marketing screenshots we send to the client aren't cluttered.
  // Production build is completely unaffected.
  devIndicators: { appIsrStatus: false, buildActivity: false },
  // The website consumes the same FastAPI backend as the mobile app.
  // Env-driven so we can point at localhost during dev and
  // production API in Vercel.
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
