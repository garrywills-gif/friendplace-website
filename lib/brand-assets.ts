/**
 * FriendPlace Brand Assets — the single source of truth.
 *
 * Every page + component on the website MUST reference these master
 * files. No recreated / stretched / renamed versions anywhere.
 *
 * Physical files live in /public/brand-assets/ so they are cache-
 * fingerprintable by Vercel and reusable across the mobile app,
 * this website, and future Mission Control.
 *
 * Aspect ratios:
 *   • app-icon.png — 1024×1024  (1:1)
 *   • banner.png   — 1774×887   (2:1)
 *   • favicon.png  — 256×256
 *
 * When rendering, ALWAYS pass either width OR height, not both, so
 * the browser preserves the intrinsic aspect ratio.
 */

export const brandAssets = {
  // The full app icon (dark navy background baked in). Use this ONLY
  // where you're showing "what the icon looks like on your phone" —
  // e.g., the App Store download section. For every other brand
  // presentation on the site, use `butterfly` below (transparent bg).
  appIcon: {
    src: '/brand-assets/app-icon.png',
    width: 1024,
    height: 1024,
    aspectRatio: 1, // 1:1 — always render as a square
    alt: 'FriendPlace app icon',
  },
  // The butterfly on its own — transparent background, tightly cropped
  // to the wings + antennae. This is the default brand mark for hero
  // sections, closing CTAs and anywhere the butterfly needs to sit on
  // top of a coloured surface without a competing square around it.
  butterfly: {
    src: '/brand-assets/butterfly.png',
    width: 512,
    height: 503,
    aspectRatio: 512 / 503, // preserve exact intrinsic proportion
    alt: 'FriendPlace butterfly',
  },
  // The wide brand banner from the invite flyer.
  banner: {
    src: '/brand-assets/banner.png',
    width: 1774,
    height: 887,
    aspectRatio: 2, // 2:1 landscape
    alt: 'FriendPlace — Because you belong too. Finding your people, one friendship at a time.',
  },
  // Favicon (also the source for the browser tab icon).
  favicon: {
    src: '/brand-assets/favicon.png',
    width: 256,
    height: 256,
    aspectRatio: 1,
    alt: 'FriendPlace',
  },
} as const;

/**
 * Convenience: render an <img> that is guaranteed to preserve the
 * master aspect ratio. Pass `size` in pixels and the height is derived
 * automatically. Prevents accidental non-uniform scaling that would
 * distort the logo.
 */
export function assetSize(
  asset: { aspectRatio: number },
  size: number,
): { width: number; height: number } {
  return {
    width: size,
    height: Math.round(size / asset.aspectRatio),
  };
}
