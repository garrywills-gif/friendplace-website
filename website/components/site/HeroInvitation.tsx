'use client';

/**
 * HeroInvitation — the hero-level "Meet George or Georgia" pill.
 *
 * Sits under the primary hero CTAs (Get the App / See how it works).
 * The invitation waits ~1.3s so visitors can read "Find your people."
 * and the intro paragraph BEFORE George steps forward — the pause is
 * a design decision, not a load delay. Two staggered beats:
 *
 *   • Pill fades + rises into place at ~1.3s
 *   • Caption follows a breath later at ~1.7s
 *
 * Clicking the pill dispatches `friendplace:meet-george`, summoning
 * the ConciergeOverlay (mounted globally in the root layout). The
 * anchor `href="/meet"` remains as a JS-off fallback so keyboard
 * / no-JS navigation still works.
 *
 * Respects prefers-reduced-motion — the invitation still lands, but
 * without the rise and with a shorter delay.
 *
 * Locked with Garry (30 Jul 2026):
 *   > George isn't another navigation item. He's part of the
 *   > FriendPlace experience. Positioning him within the hero
 *   > makes the invitation feel intentional and personal.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';

// Two-beat timing. Kept in one place so we can fine-tune the rhythm.
// Reduced-motion visitors get shorter delays (still intentional, but
// no long wait for people who've asked for less motion).
const PILL_DELAY_MS    = 1300;
const CAPTION_DELAY_MS = 1700;
const PILL_DELAY_REDUCED_MS    = 320;
const CAPTION_DELAY_REDUCED_MS = 500;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

export default function HeroInvitation() {
  const reduced = useReducedMotion();
  const [pillIn, setPillIn] = useState(false);
  const [captionIn, setCaptionIn] = useState(false);

  useEffect(() => {
    const pillT = setTimeout(
      () => setPillIn(true),
      reduced ? PILL_DELAY_REDUCED_MS : PILL_DELAY_MS,
    );
    const capT = setTimeout(
      () => setCaptionIn(true),
      reduced ? CAPTION_DELAY_REDUCED_MS : CAPTION_DELAY_MS,
    );
    return () => { clearTimeout(pillT); clearTimeout(capT); };
  }, [reduced]);

  // Fires the concierge overlay from ConciergeOverlay.tsx. Modified
  // clicks (Cmd/Ctrl/middle) still open /meet directly, as expected.
  const summon = (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('friendplace:meet-george'));
  };

  return (
    <div className="hero-invitation" style={{ marginTop: 24 }}>
      <Link
        href="/meet"
        onClick={summon}
        className="hero-invitation-pill"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          width: '100%',
          maxWidth: 480,
          padding: '15px 26px',
          background: 'rgba(94, 234, 212, 0.12)',
          color: '#5EEAD4',
          border: '1.5px solid rgba(94, 234, 212, 0.55)',
          borderRadius: 999,
          fontSize: 16,
          fontWeight: 800,
          textDecoration: 'none',
          boxShadow:
            'inset 0 0 0 1px rgba(94,234,212,0.15), 0 8px 22px rgba(5,25,44,0.28)',
          opacity: pillIn ? 1 : 0,
          transform: reduced ? 'none' : (pillIn ? 'translateY(0)' : 'translateY(10px)'),
          transition: reduced
            ? 'opacity 500ms ease'
            : 'opacity 900ms ease, transform 900ms cubic-bezier(0.22, 1, 0.36, 1), background 160ms ease, border-color 160ms ease',
          pointerEvents: pillIn ? 'auto' : 'none',
          cursor: 'pointer',
        }}
        aria-label="Meet George or Georgia — the FriendPlace welcome host"
      >
        <span aria-hidden style={{ fontSize: 18 }}>🦋</span>
        <span>Meet George or Georgia</span>
      </Link>

      <div
        style={{
          marginTop: 10,
          fontSize: 14,
          color: '#94A3B8',
          fontStyle: 'italic',
          lineHeight: 1.5,
          maxWidth: 480,
          opacity: captionIn ? 1 : 0,
          transform: reduced ? 'none' : (captionIn ? 'translateY(0)' : 'translateY(6px)'),
          transition: reduced
            ? 'opacity 500ms ease'
            : 'opacity 800ms ease, transform 800ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        Take a friendly guided tour, or simply say hello.
      </div>

      {/* Subtle hover polish — a warmer wash on the pill, slight lift.
          Kept small so it complements the arrival, not competes. */}
      <style>{`
        .hero-invitation-pill:hover {
          background: rgba(94, 234, 212, 0.18) !important;
          border-color: rgba(94, 234, 212, 0.75) !important;
        }
        .hero-invitation-pill:focus-visible {
          outline: 2px solid #5EEAD4;
          outline-offset: 3px;
        }
      `}</style>
    </div>
  );
}
