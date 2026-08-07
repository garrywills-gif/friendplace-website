/**
 * Site mode — the single switch between pre-launch and launched.
 *
 * The `/meet` experience is the permanent front door of FriendPlace.
 * The butterfly flight, the pause, the greeting, the audio, the
 * choice of companion — none of that changes at launch. Only what
 * George or Georgia offers at the end changes.
 *
 * Modes:
 *   • pre-launch: "I'd like to know more" (→ /register-interest)
 *                 "I have a question"     (→ /contact)
 *   • launched:   Download on the App Store / Google Play / Scan QR
 *
 * The mode is decided by the `NEXT_PUBLIC_FRIENDPLACE_SITE_MODE`
 * environment variable so it can be flipped without a code change.
 * Defaults to 'pre-launch' — safest before launch, and it also means
 * a preview branch never accidentally advertises store links that
 * don't exist yet.
 *
 * Read `/app/website/PUBLIC_EXPERIENCE_PRINCIPLES.md#the-permanent-front-door`
 * before touching this file. Especially: the choreography above the
 * CTAs must never know which mode we're in.
 */

export type SiteMode = 'pre-launch' | 'launched';

export function getSiteMode(): SiteMode {
  const raw = (process.env.NEXT_PUBLIC_FRIENDPLACE_SITE_MODE || '').trim().toLowerCase();
  return raw === 'launched' ? 'launched' : 'pre-launch';
}

/**
 * Companion follow-up line. Spoken (in future) and shown on-screen
 * beneath the three-line greeting once launch flips this switch.
 *
 * Pre-launch we say nothing extra — the CTAs speak for themselves.
 *
 * Launched: a single line, "FriendPlace is ready now.", introduces
 * the download step. Deliberately spare — Garry's direction: "Only
 * the next step changes."
 */
export function launchedFollowUp(): { line1: string } {
  return {
    line1: 'FriendPlace is ready now.',
  };
}

/**
 * Store links. Kept centrally so we only ever change one file when
 * the App Store and Play Store listings go live.
 */
export const storeLinks = {
  apple: process.env.NEXT_PUBLIC_APPLE_APP_STORE_URL || '',
  google: process.env.NEXT_PUBLIC_GOOGLE_PLAY_URL || '',
} as const;
