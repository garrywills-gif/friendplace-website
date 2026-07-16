/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
