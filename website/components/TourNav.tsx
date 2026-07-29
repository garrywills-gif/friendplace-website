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
 * The line and the button are quiet; the emotional weight is doing
 * the work. The button is written as the visitor's REPLY, not as an
 * action label — so the whole thing reads as a conversation:
 *
 *   George:   "I'd love to let you know when we open."
 *   Visitor:  "Yes, please."
 *
 * Locked with Garry (Dec 2026): "It doesn't feel like navigating a
 * website anymore — it feels like two people talking."
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
        {/* George returning. One line, no more. His silence through
            the tour is what makes this land — do not add a second
            paragraph, a subheading, or a supporting line. */}
        <p style={endingLine}>
          If this feels like somewhere you&rsquo;d like to belong, I&rsquo;d love to
          let you know when we open.
        </p>
        <Link href="/register-interest" style={endingCta}>
          Yes, please
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

const endingLine: React.CSSProperties = {
  fontSize: 24,
  lineHeight: 1.45,
  fontWeight: 500,
  color: '#0A2540',
  fontStyle: 'italic',
  maxWidth: 560,
  margin: '0 auto 36px',
  letterSpacing: '-0.005em',
};

const endingCta: React.CSSProperties = {
  display: 'inline-block',
  padding: '16px 32px',
  background: 'linear-gradient(135deg,#14B8A6,#0EA5A0)',
  color: '#FFFFFF',
  fontSize: 16,
  fontWeight: 800,
  textDecoration: 'none',
  borderRadius: 14,
  boxShadow: '0 6px 20px rgba(20, 184, 166, 0.32)',
};
