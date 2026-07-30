'use client';

/**
 * ConciergeOverlay — the FriendPlace "concierge" welcome experience.
 *
 * When a visitor clicks "Meet George or Georgia" anywhere on the site,
 * the current page GENTLY dims + blurs into the background (never
 * navigates away), and the FriendPlace butterfly appears in the
 * foreground as a welcoming host. Two paths:
 *
 *   • "Say hello"        → begins the full arrival scene (routes to
 *                           /meet, where George or Georgia flies to
 *                           the visitor and speaks).
 *   • "Look around first" → butterfly gently lifts back off, the
 *                           overlay fades away, and the visitor is
 *                           exactly where they left off on the page
 *                           (scroll position preserved).
 *
 * Design contract locked with Garry (30 Jul 2026):
 *   • George is a *host*, not a gatekeeper — nobody is forced into
 *     onboarding.
 *   • The current page never disappears — it dims + blurs behind.
 *   • The dismiss path is warm, not hidden. Escape / backdrop / ×
 *     all close politely.
 *   • The concierge NEVER steals George's arrival line at /meet.
 *     That first "Hello. I'm George. I'm really pleased you found
 *     us." belongs to the /meet scene. Here we only welcome them
 *     and offer a choice.
 *   • Focus is trapped inside the overlay while open (accessibility).
 *   • Reduced-motion visitors get a fade-only version — no float,
 *     no transform on the card, no sway on the butterfly.
 *
 * The overlay is triggered by dispatching a `friendplace:meet-george`
 * custom event so ANY surface can invite the visitor in without
 * prop-drilling.
 *
 *   window.dispatchEvent(new CustomEvent('friendplace:meet-george'))
 *
 * If the visitor has already chosen a companion previously (e.g. they
 * returned tomorrow), the CTA reads "Say hello to {George|Georgia}"
 * so it feels like the same host greeting them again.
 */

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { brandAssets } from '@/lib/brand-assets';
import { useCompanion } from '@/lib/companion-context';

// ─── Reduced-motion hook ───────────────────────────────────────────────
// Reads (and reacts to) the OS-level "reduce motion" preference. We
// use this to STRIP transforms + float animation for people who need
// stillness. Fade + opacity are always allowed.
function useReducedMotion(): boolean {
  const [prefersReduced, setPrefersReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setPrefersReduced(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return prefersReduced;
}

export function ConciergeOverlay() {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<'entering' | 'ready' | 'leaving'>('entering');
  const router = useRouter();
  const reduced = useReducedMotion();
  const { meta } = useCompanion(); // null on first visit, or George/Georgia
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const primaryBtnRef = useRef<HTMLButtonElement | null>(null);
  const secondaryBtnRef = useRef<HTMLButtonElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // Companion-aware copy. On return visits we address the visitor as
  // if the same host is greeting them again. On first visits we stay
  // ambiguous — the George/Georgia choice happens over at /meet.
  const primaryLabel = useMemo(
    () => (meta ? `Say hello to ${meta.name}` : 'Say hello'),
    [meta],
  );

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

  // ── Close the overlay — fades, restores focus, unmounts. ────────
  const close = useCallback(() => {
    setPhase('leaving');
    // Match the CSS transition duration (see .concierge-* keyframes).
    setTimeout(
      () => {
        setOpen(false);
        setPhase('entering');
        // Return focus to the element that opened the overlay so the
        // visitor lands back where they came from.
        previouslyFocused.current?.focus?.({ preventScroll: true });
      },
      reduced ? 160 : 300,
    );
  }, [reduced]);

  // ── When open, focus the primary CTA, trap focus, lock scroll ──
  useEffect(() => {
    if (!open) return;
    // 1) advance from "entering" to "ready" on the next tick so CSS
    //    transitions can play.
    const raf = requestAnimationFrame(() => setPhase('ready'));

    // 2) lock body scroll so the page doesn't move behind the overlay.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // 3) focus the FIRST button (Say hello) but keep it non-
    //    aggressive: use preventScroll so we don't jerk the page.
    const focusTimer = setTimeout(() => {
      primaryBtnRef.current?.focus({ preventScroll: true });
    }, 220);

    // 4) simple focus trap — Tab cycles through the three focusable
    //    elements (primary, secondary, close ×).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      const focusable = [
        primaryBtnRef.current,
        secondaryBtnRef.current,
        closeBtnRef.current,
      ].filter(Boolean) as HTMLElement[];
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
  }, [open, close]);

  const sayHello = useCallback(() => {
    // Close first, then route — feels more natural than routing under
    // a still-visible overlay.
    setPhase('leaving');
    setTimeout(
      () => {
        setOpen(false);
        setPhase('entering');
        router.push('/meet?from=concierge');
      },
      reduced ? 140 : 240,
    );
  }, [router, reduced]);

  if (!open) return null;

  // Transform amounts respect reduced-motion. Everything falls back to
  // opacity-only so the arrival still feels intentional without motion.
  const cardTransform = reduced
    ? 'none'
    : phase === 'ready'
      ? 'translateY(0) scale(1)'
      : 'translateY(14px) scale(0.985)';

  const butterflyTransform = reduced
    ? 'none'
    : phase === 'ready'
      ? 'translateY(0) rotate(0deg)'
      : 'translateY(-28px) rotate(-8deg)';

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="concierge-heading"
      aria-describedby="concierge-welcome"
      style={{
        ...backdropBase,
        opacity: phase === 'ready' ? 1 : 0,
        backdropFilter: phase === 'ready' ? 'blur(14px) saturate(1.05)' : 'blur(0px)',
        WebkitBackdropFilter: phase === 'ready' ? 'blur(14px) saturate(1.05)' : 'blur(0px)',
      }}
      // Clicks on the backdrop (not the card) close politely — same
      // semantics as "Look around first".
      onClick={(e) => { if (e.target === overlayRef.current) close(); }}
    >
      <div
        style={{
          ...card,
          transform: cardTransform,
          opacity: phase === 'ready' ? 1 : 0,
        }}
      >
        {/* Discreet close (×) — muted, top-right. Present for
            discoverability; Escape and the secondary CTA still work. */}
        <button
          ref={closeBtnRef}
          type="button"
          onClick={close}
          aria-label="Close welcome"
          style={closeBtn}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#05192C'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#94A3B8'; }}
        >
          ×
        </button>

        {/* Butterfly — the FriendPlace brand mark, arriving. It floats
            in from just above the card and settles. A soft aqua aura
            sits behind it for warmth. */}
        <div style={butterflyBox} aria-hidden>
          <div style={butterflyAura} />
          <div
            data-concierge-butterfly
            style={{
              width: 76,
              height: 74,
              position: 'relative',
              transform: butterflyTransform,
              transition: reduced
                ? 'none'
                : 'transform 620ms cubic-bezier(0.22, 1.2, 0.36, 1)',
              animation: phase === 'ready' && !reduced
                ? 'concierge-breath 5.2s ease-in-out 620ms infinite'
                : 'none',
              filter: 'drop-shadow(0 8px 18px rgba(56, 189, 248, 0.35))',
            }}
          >
            <Image
              src={brandAssets.butterfly.src}
              alt=""
              width={76}
              height={74}
              priority
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          </div>
        </div>

        <h2 id="concierge-heading" style={heading}>
          Hello. Welcome to FriendPlace.
        </h2>

        <p id="concierge-welcome" style={welcome}>
          If you&apos;d like, I can come over and say hello properly.
          Or take a look around first — I&apos;ll be here whenever
          you&apos;re ready.
        </p>

        <div style={buttonRow}>
          <button
            ref={primaryBtnRef}
            type="button"
            onClick={sayHello}
            style={primaryBtn}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = '#0B2A4A';
              (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = '#05192C';
              (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
            }}
          >
            {primaryLabel}
          </button>
          <button
            ref={secondaryBtnRef}
            type="button"
            onClick={close}
            style={secondaryBtn}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = '#94A3B8';
              (e.currentTarget as HTMLButtonElement).style.background = '#F8FAFC';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = '#CBD5E1';
              (e.currentTarget as HTMLButtonElement).style.background = '#FFFFFF';
            }}
          >
            Look around first
          </button>
        </div>
      </div>

      {/* Butterfly "breath" (subtle rise/fall) + reduced-motion opt-out.
          Inlined so the overlay stays a single-file, portable component. */}
      <style>{`
        @keyframes concierge-breath {
          0%, 100% { transform: translateY(0) rotate(-1deg); }
          50%      { transform: translateY(-4px) rotate(1.5deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-concierge-butterfly] { animation: none !important; transform: none !important; }
        }
      `}</style>
    </div>
  );
}

// ─── styles ────────────────────────────────────────────────────────────
// Backdrop: soft navy tint. The blur (applied inline so we can toggle
// it per-phase) does the heavy lifting for depth.
const backdropBase: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  background:
    'radial-gradient(ellipse at center, rgba(5, 25, 44, 0.35) 0%, rgba(5, 25, 44, 0.52) 70%)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 20,
  transition: 'opacity 300ms ease, backdrop-filter 300ms ease',
};

// The card. Slightly warmer top gradient so it doesn't read as a
// clinical "modal" — this is George arriving, not a form popup.
const card: React.CSSProperties = {
  position: 'relative',
  background: 'linear-gradient(180deg, #FFFFFF 0%, #F6FBFF 100%)',
  borderRadius: 24,
  padding: '32px 30px 28px',
  maxWidth: 520,
  width: '100%',
  boxShadow:
    '0 32px 80px rgba(5, 25, 44, 0.32), 0 4px 12px rgba(5, 25, 44, 0.08), 0 0 0 1px rgba(94, 234, 212, 0.22)',
  transition:
    'transform 380ms cubic-bezier(0.22, 1, 0.36, 1), opacity 300ms ease',
  textAlign: 'center',
};

const closeBtn: React.CSSProperties = {
  position: 'absolute',
  top: 10,
  right: 12,
  width: 34,
  height: 34,
  border: 0,
  background: 'transparent',
  color: '#94A3B8',
  fontSize: 24,
  lineHeight: 1,
  cursor: 'pointer',
  borderRadius: 999,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'color 160ms ease, background 160ms ease',
};

// A soft aqua "aura" behind the butterfly — a resting halo, not a
// spotlight. Position: absolute inside butterflyBox (which is
// position: relative).
const butterflyAura: React.CSSProperties = {
  position: 'absolute',
  width: 150,
  height: 150,
  borderRadius: '50%',
  background:
    'radial-gradient(circle, rgba(94, 234, 212, 0.28) 0%, rgba(94, 234, 212, 0.08) 45%, rgba(94, 234, 212, 0) 70%)',
  filter: 'blur(4px)',
  pointerEvents: 'none',
};

const butterflyBox: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  marginBottom: 16,
  height: 90,
};

const heading: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 800,
  color: '#05192C',
  margin: '0 0 10px',
  lineHeight: 1.28,
  letterSpacing: '-0.015em',
};

const welcome: React.CSSProperties = {
  fontSize: 15.5,
  color: '#334155',
  lineHeight: 1.6,
  margin: '0 0 24px',
  maxWidth: 440,
  marginInline: 'auto',
};

const buttonRow: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  justifyContent: 'center',
};

const primaryBtn: React.CSSProperties = {
  padding: '13px 24px',
  background: '#05192C',
  color: '#FFFFFF',
  border: 0,
  borderRadius: 999,
  fontSize: 15,
  fontWeight: 700,
  cursor: 'pointer',
  minWidth: 172,
  transition: 'transform 160ms ease, background 160ms ease',
  boxShadow: '0 6px 18px rgba(5, 25, 44, 0.18)',
};

const secondaryBtn: React.CSSProperties = {
  padding: '13px 24px',
  background: '#FFFFFF',
  color: '#05192C',
  border: '1px solid #CBD5E1',
  borderRadius: 999,
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
  minWidth: 172,
  transition: 'border-color 160ms ease, background 160ms ease',
};
