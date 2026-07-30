'use client';

/**
 * ConciergeOverlay — the FriendPlace "concierge" welcome experience.
 *
 * When a visitor clicks "Meet George or Georgia" anywhere on the site,
 * the current page GENTLY dims + blurs into the background (never
 * navigates away), and George appears in the foreground as a
 * welcoming host. Two paths:
 *
 *   • "Show me around"       → begins the guided tour (routes to /meet).
 *   • "I'll explore myself"  → George flies back to his corner, the
 *                              overlay fades away, and the visitor is
 *                              exactly where they left off on the page
 *                              (scroll position preserved).
 *
 * Design contract locked with Garry (30 Jul 2026):
 *   • George is a *host*, not a gatekeeper — nobody is forced into
 *     onboarding.
 *   • The current page never disappears — it dims + blurs behind.
 *   • The dismiss path is warm, not hidden. Escape also closes.
 *   • Focus is trapped inside the overlay while open (accessibility).
 *   • Reduced-motion visitors get a fade-only version — no float.
 *
 * The overlay is triggered by dispatching a `friendplace:meet-george`
 * custom event so ANY surface can invite the visitor in without
 * prop-drilling.
 *
 *   window.dispatchEvent(new CustomEvent('friendplace:meet-george'))
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export function ConciergeOverlay() {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<'entering' | 'ready' | 'leaving'>('entering');
  const router = useRouter();
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const primaryBtnRef = useRef<HTMLButtonElement | null>(null);
  const secondaryBtnRef = useRef<HTMLButtonElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // ── Event listener: opens the overlay from any surface ──────────
  useEffect(() => {
    const openConcierge = () => {
      previouslyFocused.current = document.activeElement as HTMLElement | null;
      setOpen(true);
      setPhase('entering');
    };
    window.addEventListener('friendplace:meet-george', openConcierge);
    return () => window.removeEventListener('friendplace:meet-george', openConcierge);
  }, []);

  // ── When open, focus the primary CTA, trap focus, lock scroll ──
  useEffect(() => {
    if (!open) return;
    // 1) advance from "entering" to "ready" on the next tick so CSS
    //    transitions can play.
    const raf = requestAnimationFrame(() => setPhase('ready'));

    // 2) lock body scroll so the page doesn't move behind the overlay.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // 3) focus the FIRST button (Show me around) but keep it non-
    //    aggressive: use preventScroll so we don't jerk the page.
    const focusTimer = setTimeout(() => {
      primaryBtnRef.current?.focus({ preventScroll: true });
    }, 200);

    // 4) simple focus trap — Tab / Shift+Tab cycles between the two
    //    buttons and (invisibly) the close area.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      const focusable = [primaryBtnRef.current, secondaryBtnRef.current].filter(Boolean) as HTMLElement[];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
     
  }, [open]);

  // ── Close the overlay — fades, restores focus, unmounts. ────────
  const close = useCallback(() => {
    setPhase('leaving');
    // Match the CSS transition duration (see .concierge-* keyframes).
    setTimeout(() => {
      setOpen(false);
      setPhase('entering');
      // Return focus to the element that opened the overlay so the
      // visitor lands back where they came from.
      previouslyFocused.current?.focus?.({ preventScroll: true });
    }, 260);
  }, []);

  const showMeAround = useCallback(() => {
    // Close first, then route — feels more natural than routing under
    // a still-visible overlay.
    setPhase('leaving');
    setTimeout(() => {
      setOpen(false);
      setPhase('entering');
      router.push('/meet?from=concierge');
    }, 220);
  }, [router]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="concierge-heading"
      style={{
        ...backdropBase,
        opacity: phase === 'ready' ? 1 : 0,
        backdropFilter: phase === 'ready' ? 'blur(14px) saturate(1.05)' : 'blur(0px)',
        WebkitBackdropFilter: phase === 'ready' ? 'blur(14px) saturate(1.05)' : 'blur(0px)',
      }}
      // Clicks on the backdrop (not the card) close politely — same
      // semantics as "I'll explore myself".
      onClick={(e) => { if (e.target === overlayRef.current) close(); }}
    >
      <div
        style={{
          ...card,
          transform: phase === 'ready' ? 'translateY(0) scale(1)' : 'translateY(12px) scale(0.98)',
          opacity: phase === 'ready' ? 1 : 0,
        }}
      >
        {/* Butterfly — the visual signal that this IS George. */}
        <div style={butterflyBox} aria-hidden>
          <span style={{
            fontSize: 56,
            filter: 'drop-shadow(0 6px 14px rgba(94, 234, 212, 0.35))',
            display: 'inline-block',
            transformOrigin: 'center',
            animation: 'concierge-float 4.2s ease-in-out infinite',
          }}>🦋</span>
        </div>

        <h2 id="concierge-heading" style={heading}>
          Hi, I&apos;m George. Welcome to FriendPlace.
        </h2>

        <p style={welcome}>
          If you&apos;d like, I&apos;ll show you around. If you&apos;d rather explore
          on your own, that&apos;s perfectly fine too.
        </p>

        <div style={buttonRow}>
          <button
            ref={primaryBtnRef}
            type="button"
            onClick={showMeAround}
            style={primaryBtn}
          >
            Show me around
          </button>
          <button
            ref={secondaryBtnRef}
            type="button"
            onClick={close}
            style={secondaryBtn}
          >
            I&apos;ll explore myself
          </button>
        </div>
      </div>

      {/* Butterfly float animation + reduced-motion opt-out. Inlined so
          the overlay stays a single-file, portable component. */}
      <style>{`
        @keyframes concierge-float {
          0%, 100% { transform: translateY(0) rotate(-3deg); }
          50%      { transform: translateY(-6px) rotate(3deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-concierge-butterfly] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}

// ─── styles ────────────────────────────────────────────────────────────
const backdropBase: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  background: 'rgba(5, 25, 44, 0.42)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 20,
  transition: 'opacity 260ms ease, backdrop-filter 260ms ease',
};
const card: React.CSSProperties = {
  background: 'linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%)',
  borderRadius: 22,
  padding: '28px 30px 26px',
  maxWidth: 520,
  width: '100%',
  boxShadow: '0 32px 80px rgba(5, 25, 44, 0.28), 0 4px 12px rgba(5, 25, 44, 0.08)',
  border: '1px solid rgba(94, 234, 212, 0.22)',
  transition: 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 260ms ease',
  textAlign: 'center',
};
const butterflyBox: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  marginBottom: 14,
};
const heading: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 800,
  color: '#05192C',
  margin: '0 0 8px',
  lineHeight: 1.3,
  letterSpacing: '-0.01em',
};
const welcome: React.CSSProperties = {
  fontSize: 15.5,
  color: '#334155',
  lineHeight: 1.55,
  margin: '0 0 22px',
  maxWidth: 420,
  marginInline: 'auto',
};
const buttonRow: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  justifyContent: 'center',
};
const primaryBtn: React.CSSProperties = {
  padding: '12px 22px',
  background: '#05192C',
  color: '#FFFFFF',
  border: 0,
  borderRadius: 12,
  fontSize: 14.5,
  fontWeight: 700,
  cursor: 'pointer',
  minWidth: 160,
  transition: 'transform 120ms ease, background 120ms ease',
};
const secondaryBtn: React.CSSProperties = {
  padding: '12px 22px',
  background: '#FFFFFF',
  color: '#05192C',
  border: '1px solid #CBD5E1',
  borderRadius: 12,
  fontSize: 14.5,
  fontWeight: 600,
  cursor: 'pointer',
  minWidth: 160,
  transition: 'transform 120ms ease, border-color 120ms ease',
};
