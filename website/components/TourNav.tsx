/**
 * Tour navigation for the FriendPlace public tour.
 *
 * The tour is: /meet → /about → /how-it-works → /features → /register-interest
 *
 * TWO patterns live in this file, one for each role:
 *
 *   1. <TourNext>       — small, page-owned "next" link at the bottom
 *                         of an INTERMEDIATE tour page. Deliberately
 *                         written in the page's own voice, NOT in
 *                         George's. The tour pages are where George
 *                         has stepped back and let FriendPlace speak
 *                         for itself.
 *
 *   2. <TourEnding>     — the LAST tour page (Features) ends with
 *                         George's voice returning for exactly one
 *                         line — the closing of the whole journey.
 *                         His silence through the tour is what makes
 *                         this line land.
 *
 * Read the "Quiet Host" section in
 * `/app/website/PUBLIC_EXPERIENCE_PRINCIPLES.md` before touching
 * either of these components.
 */

import Link from 'next/link';
import { brandAssets } from '@/lib/brand-assets';

// ─── Intermediate tour "next" ────────────────────────────────────────

/**
 * A small, quiet transition at the bottom of an intermediate tour
 * page. The label is written in the PAGE's own voice — no George,
 * no butterfly reappearing, no "come with me" — because during the
 * tour he is intentionally quiet and the pages carry the story.
 *
 * Two lines: a soft eyebrow ("Continue the tour"), and the link
 * itself as the primary action.
 */
export function TourNext({
  href,
  label,
  hint = 'Continue the tour',
}: {
  href: string;
  label: string;
  hint?: string;
}) {
  return (
    <section style={wrapNext}>
      <div className="container" style={{ textAlign: 'center' }}>
        <div style={eyebrow}>{hint}</div>
        <Link href={href} style={nextLink}>
          {label}
          <span aria-hidden style={{ marginLeft: 10, fontSize: 22 }}>&rarr;</span>
        </Link>
      </div>
    </section>
  );
}

// ─── Final tour ending — George's voice returns ─────────────────────

/**
 * The closing beat of the whole journey. Rendered only at the
 * bottom of the LAST tour page (currently /features). This is the
 * only place George's voice returns during the tour — and it's the
 * only line he says between /meet and /register-interest.
 *
 * The three-line closing (Garry, iter147, locked):
 *
 *   You're all set.
 *   FriendPlace is yours to explore now.
 *   And remember… if you ever need me, just tap the butterfly. 🦋
 *
 * The final line is the whole point. It tells every new member that
 * George never disappears — he is not the onboarding guide, he is
 * part of FriendPlace. That reassurance is the emotional payoff of
 * the entire Meet → Welcome → Begin → You're all set journey and
 * MUST NOT be optimised away, shortened past recognition, or
 * downgraded to a subtitle.
 *
 * For the pre-launch site we still need a quiet path to register
 * interest, so a small secondary link sits below George's closing
 * beat — never above it, never as a primary action, so it doesn't
 * step on the moment. Once we're live, that link naturally becomes
 * a no-op (nothing to register for) and can be removed without
 * disturbing the composition.
 *
 * Locked with Garry (Aug 2026):
 *   "That final line tells every new member that George never
 *    disappears. He isn't just the onboarding guide. He's part of
 *    FriendPlace."
 */
export function TourEnding() {
  return (
    <section style={wrapEnding}>
      <div className="container" style={{ maxWidth: 640, textAlign: 'center' }}>
        <img
          src={brandAssets.butterfly.src}
          alt=""
          aria-hidden
          style={{ width: 64, height: 'auto', display: 'block', margin: '0 auto 24px' }}
        />

        {/* George returning — three calm beats, one after the other,
            each with room to land. The 🦋 sits inside the third
            line because it IS the "just tap the butterfly" that the
            line describes — the emoji makes the instruction
            self-referential and warm. */}
        <p style={endingHeadline}>You&rsquo;re all set.</p>
        <p style={endingLine}>FriendPlace is yours to explore now.</p>
        <p style={endingReassurance}>
          And remember&hellip; if you ever need me, just tap the butterfly. <span aria-hidden>🦋</span>
        </p>

        {/* Pre-launch fallback. Quiet, secondary, positioned so it
            does not compete with the emotional beat above. Once
            FriendPlace is live this whole block can be deleted
            without touching George's closing line. */}
        <Link href="/register-interest" style={endingSecondaryLink}>
          Not opened yet? Let me know when we do &rarr;
        </Link>
      </div>
    </section>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────

const wrapNext: React.CSSProperties = {
  background: '#FEFCF8',
  padding: '0 0 96px',
  borderTop: '1px solid rgba(20, 184, 166, 0.10)',
  paddingTop: 56,
};

const eyebrow: React.CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: '0.15em',
  fontSize: 12,
  fontWeight: 800,
  color: '#14B8A6',
  marginBottom: 12,
};

const nextLink: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  color: '#0A2540',
  fontSize: 22,
  fontWeight: 800,
  textDecoration: 'none',
  letterSpacing: '-0.01em',
  transition: 'transform 220ms ease, color 220ms ease',
};

const wrapEnding: React.CSSProperties = {
  background: 'linear-gradient(180deg, #FEFCF8 0%, #FFF9EC 100%)',
  padding: '96px 24px 120px',
  textAlign: 'center',
};

// "You're all set." — the primary emotional beat. Larger and heavier
// than the surrounding lines so it lands with the weight of a
// conversation-ending statement, not a subtitle.
const endingHeadline: React.CSSProperties = {
  fontSize: 40,
  lineHeight: 1.15,
  fontWeight: 900,
  color: '#0A2540',
  letterSpacing: '-0.02em',
  maxWidth: 560,
  margin: '0 auto 12px',
};

// "FriendPlace is yours to explore now." — the supporting line,
// softer and calmer, extending the moment without competing with it.
const endingLine: React.CSSProperties = {
  fontSize: 22,
  lineHeight: 1.45,
  fontWeight: 500,
  color: '#0A2540',
  maxWidth: 560,
  margin: '0 auto 28px',
  letterSpacing: '-0.005em',
};

// "And remember… if you ever need me, just tap the butterfly."
// The reassurance. Italic to sound like George speaking directly,
// slightly softer colour so it reads as an aside — a kind promise
// rather than a headline. This line is the whole point of the
// journey's closing moment and MUST remain.
const endingReassurance: React.CSSProperties = {
  fontSize: 18,
  lineHeight: 1.55,
  fontWeight: 500,
  fontStyle: 'italic',
  color: '#334155',
  maxWidth: 560,
  margin: '0 auto 36px',
};

// Pre-launch secondary link. Quiet on purpose — never competing
// with George's closing beat. Once we're live, this whole element
// can be removed without touching George's lines above.
const endingSecondaryLink: React.CSSProperties = {
  display: 'inline-block',
  fontSize: 14,
  fontWeight: 700,
  color: '#14B8A6',
  textDecoration: 'none',
  padding: '10px 20px',
  borderRadius: 999,
  border: '1px solid rgba(20, 184, 166, 0.4)',
  background: 'rgba(20, 184, 166, 0.05)',
  transition: 'background 180ms ease, border-color 180ms ease',
};
