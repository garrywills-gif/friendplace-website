/**
 * FriendPlace brand tokens — the SINGLE source of truth for colours,
 * typography, spacing and radii used across the website.
 *
 * All values mirror the mobile app so switching between the two feels
 * completely seamless. Any brand tweak lives here — don't hardcode.
 */

export const brand = {
  // Core palette
  navy: '#0A2540',          // Deep navy — primary background / dark surfaces
  navyDeep: '#061826',      // Almost-black navy for footers, elevated dark UI
  navyMuted: '#12365B',     // Softer navy used behind cards on dark sections
  teal: '#14B8A6',          // Primary brand accent (buttons, CTAs, links)
  tealDark: '#0F9488',      // Hover state / pressed teal
  tealSoft: '#5EEAD4',      // Soft teal wash / illustration highlight
  sky: '#38BDF8',           // Sky-blue accent — secondary CTAs & icons
  skySoft: '#7DD3FC',       // Soft sky for gradients & badges

  // Neutrals
  cream: '#FEFCF8',         // Warm off-white background (never pure white)
  paper: '#F8FAFC',         // Slightly cooler paper for card backgrounds
  border: '#E2E8F0',        // Soft border across light surfaces
  ink: '#0F172A',           // Primary body text on light backgrounds
  inkSoft: '#475569',       // Secondary text, captions
  mute: '#94A3B8',          // Tertiary meta text, disabled state

  // Semantic
  success: '#10B981',
  warn: '#F59E0B',
  danger: '#EF4444',
};

export const font = {
  // Public Sans is the free Google font closest to the mobile app's
  // Plus Jakarta Sans; using system stack fallback so first paint is
  // instant even before the font loads.
  sans: `'Public Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`,
};

export const radius = {
  sm: '8px',
  md: '12px',
  lg: '18px',
  xl: '28px',
  pill: '999px',
};

export const shadow = {
  soft: '0 4px 24px rgba(10, 37, 64, 0.06)',
  card: '0 8px 32px rgba(10, 37, 64, 0.08)',
  lift: '0 14px 48px rgba(10, 37, 64, 0.14)',
};

// Site-wide constants also lifted out of components so they're editable
// in one place. When the CMS lands these get replaced by DB values.
export const site = {
  name: 'FriendPlace',
  tagline: 'Because you belong too.',
  description:
    'A warm community for making real friendships in your local area — events, coffee catch-ups and everyday belonging, minus the awkward.',
  emailContact: 'hello@friendplace.com.au',
  urlProduction: 'https://friendplace.com.au',
};
