'use client';

/**
 * ConciergeOverlay — the FriendPlace "concierge" welcome experience.
 *
 * When a visitor clicks "Meet George or Georgia" anywhere on the site,
 * the current page GENTLY dims + blurs into the background (never
 * navigates away first), and the FriendPlace butterfly appears in the
 * foreground as a warm host. The overlay:
 *
 *   1. Fulfils the promise of the button — the visitor really does
 *      get to pick GEORGE or GEORGIA. Two side-by-side choice pills.
 *   2. Preserves visual continuity when a choice is made. The overlay
 *      does NOT unmount on click. Instead:
 *        a. The chosen companion is persisted via CompanionContext.
 *        b. The overlay enters a soft "handoff" phase — buttons dim,
 *           the butterfly leans forward, and the aura brightens as if
 *           the companion is stepping toward the visitor.
 *        c. In parallel, we `router.push('/meet?from=concierge')`. The
 *           destination is prefetched on overlay open, so it is
 *           already warm in memory — the browser does NOT paint a
 *           blank/loading state.
 *        d. Because the overlay lives at the root layout (outside the
 *           route boundary), it stays visible OVER /meet while /meet
 *           mounts underneath. We then cross-fade the overlay out
 *           after ~650 ms so the visitor never sees a gap.
 *   3. Respects a dismissive visitor. "Look around first", Escape,
 *      backdrop click, and the × button all close politely with focus
 *      restored — no navigation, no scroll jump.
 *
 * The overlay is triggered by dispatching a `friendplace:meet-george`
 * custom event so ANY surface can invite the visitor in without
 * prop-drilling. See components/site/HeroInvitation.tsx.
 *
 *   window.dispatchEvent(new CustomEvent('friendplace:meet-george'))
 */

import Image from 'next/image';
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { brandAssets } from '@/lib/brand-assets';
import { useCompanion, COMPANIONS, type CompanionId } from '@/lib/companion-context';

// ─── Reduced-motion hook ───────────────────────────────────────────────
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

// ─── Handoff timing ───────────────────────────────────────────────────
// The whole point of the handoff is that /meet is READY UNDERNEATH the
// overlay before we cross-fade. HANDOFF_HOLD_MS is the delay between
// pushing the route and starting the overlay fade — long enough for
// Next.js to hydrate the prefetched destination, short enough that the
// visitor doesn't feel a stall. HANDOFF_FADE_MS is the fade itself.
const HANDOFF_HOLD_MS = 650;
const HANDOFF_FADE_MS = 380;

export function ConciergeOverlay() {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<'entering' | 'ready' | 'handoff' | 'leaving'>('entering');
  const [pending, setPending] = useState<CompanionId | null>(null);
  const router = useRouter();
  const reduced = useReducedMotion();
  const { companion, choose } = useCompanion();
  // Snapshot the previously-chosen companion at the moment the overlay
  // OPENS, so labels like "Say hello again to George" stay stable
  // through the handoff. Without this, the moment we call `choose()`
  // during handoff, the context updates and BOTH buttons would flip
  // their labels — visually jarring during the transition. We store
  // the latest `companion` in a ref so the openConcierge listener
  // (registered once in a []-deps effect) always sees the CURRENT
  // value, not the stale one from mount.
  const [snapshotCompanion, setSnapshotCompanion] = useState<CompanionId | null>(null);
  const companionRef = useRef<CompanionId | null>(companion);
  useEffect(() => { companionRef.current = companion; }, [companion]);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const georgeBtnRef = useRef<HTMLButtonElement | null>(null);
  const georgiaBtnRef = useRef<HTMLButtonElement | null>(null);
  const secondaryBtnRef = useRef<HTMLButtonElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // We pre-select the previously-chosen companion (if any) so a
  // returning visitor's default focus lands on their host. First-time
  // visitors get George on the left simply by DOM order — either
  // choice is equally valid.
  const defaultFocusRef = snapshotCompanion === 'georgia' ? georgiaBtnRef : georgeBtnRef;

  // ── Open handler: listens on the window for the summons event ──
  useEffect(() => {
    const openConcierge = () => {
      previouslyFocused.current = document.activeElement as HTMLElement | null;
      setOpen(true);
      setPhase('entering');
      setPending(null);
      // Snapshot the previously-chosen companion when the overlay opens
      // so button labels stay stable through the handoff. Read from a
      // ref so we always see the CURRENT context value, not the stale
      // one captured at first mount.
      setSnapshotCompanion(companionRef.current);
    };
    window.addEventListener('friendplace:meet-george', openConcierge);
    return () => window.removeEventListener('friendplace:meet-george', openConcierge);
  }, []);

  // ── Prefetch /meet as soon as the overlay opens so the handoff
  //    lands on a warm route — no blank/loading paint. ─────────────
  useEffect(() => {
    if (!open) return;
    try { router.prefetch('/meet?from=concierge'); } catch { /* prefetch is best-effort */ }
  }, [open, router]);

  // ── Close politely — fade, restore focus, unmount. ─────────────
  const close = useCallback(() => {
    setPhase('leaving');
    setTimeout(
      () => {
        setOpen(false);
        setPhase('entering');
        setPending(null);
        previouslyFocused.current?.focus?.({ preventScroll: true });
      },
      reduced ? 160 : 300,
    );
  }, [reduced]);

  // ── Focus, focus-trap, escape, scroll-lock ─────────────────────
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => setPhase('ready'));

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTimer = setTimeout(() => {
      defaultFocusRef.current?.focus({ preventScroll: true });
    }, 220);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      // Focus trap across all interactive elements in the card.
      const focusable = [
        georgeBtnRef.current,
        georgiaBtnRef.current,
        secondaryBtnRef.current,
        closeBtnRef.current,
      ].filter((el): el is HTMLElement => Boolean(el));
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
  }, [open, close, defaultFocusRef]);

  // ── Choice handler: persist companion, keep the overlay visible
  //    THROUGH the route change, then cross-fade to /meet. This is
  //    the seamless "he/she is coming over" moment. ────────────────
  const pickCompanion = useCallback((id: CompanionId) => {
    if (phase !== 'ready') return; // ignore double-clicks during handoff
    setPending(id);
    setPhase('handoff');
    choose(id);
    // Kick off the navigation immediately. The overlay stays mounted
    // over /meet because it lives at the root layout, so the visitor
    // does NOT see a blank page while Next.js swaps the route.
    router.push('/meet?from=concierge');
    // After /meet has had a chance to hydrate + paint its opening
    // frame underneath, fade the overlay out. The visitor experiences
    // one continuous moment: overlay softens, butterfly steps forward,
    // /meet is already there behind the fade.
    setTimeout(() => {
      setPhase('leaving');
      setTimeout(
        () => {
          setOpen(false);
          setPhase('entering');
          setPending(null);
        },
        HANDOFF_FADE_MS + 20,
      );
    }, reduced ? 200 : HANDOFF_HOLD_MS);
  }, [phase, router, choose, reduced]);

  if (!open) return null;

  const isHandoff = phase === 'handoff' || phase === 'leaving';
  const showAsReady = phase === 'ready' || phase === 'handoff';

  // Card + butterfly transforms respect reduced-motion + phase.
  const cardTransform = reduced
    ? 'none'
    : phase === 'entering'  ? 'translateY(14px) scale(0.985)'
    : phase === 'handoff'   ? 'translateY(-3px) scale(1.005)'  // subtle lean-in
    : phase === 'leaving'   ? 'translateY(-3px) scale(1.01)'
    :                          'translateY(0) scale(1)';

  const butterflyTransform = reduced
    ? 'none'
    : phase === 'entering'  ? 'translateY(-28px) rotate(-8deg)'
    : phase === 'handoff'   ? 'translateY(-6px) scale(1.1)'   // steps forward
    : phase === 'leaving'   ? 'translateY(-10px) scale(1.15)'
    :                          'translateY(0) rotate(0deg)';

  const cardOpacity =
    phase === 'ready'    ? 1 :
    phase === 'handoff'  ? 1 :
    phase === 'leaving'  ? 0 :
    0;

  const backdropOpacity =
    phase === 'ready'    ? 1 :
    phase === 'handoff'  ? 0.75 : // begin softening the backdrop early
    phase === 'leaving'  ? 0 :
    0;

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="concierge-heading"
      aria-describedby="concierge-welcome"
      style={{
        ...backdropBase,
        opacity: backdropOpacity,
        backdropFilter: showAsReady ? 'blur(14px) saturate(1.05)' : 'blur(0px)',
        WebkitBackdropFilter: showAsReady ? 'blur(14px) saturate(1.05)' : 'blur(0px)',
        transition: `opacity ${isHandoff ? HANDOFF_FADE_MS : 300}ms ease, backdrop-filter 300ms ease`,
      }}
      onClick={(e) => {
        // Backdrop dismiss is disabled during handoff — we don't want
        // an accidental click to interrupt the transition.
        if (phase !== 'ready') return;
        if (e.target === overlayRef.current) close();
      }}
    >
      <div
        style={{
          ...card,
          transform: cardTransform,
          opacity: cardOpacity,
          transition: `transform 380ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${isHandoff ? HANDOFF_FADE_MS : 300}ms ease`,
        }}
      >
        {/* Discreet close (×). Hidden during handoff. */}
        {phase === 'ready' && (
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
        )}

        {/* Brand butterfly — arrives from above, settles, then leans
            forward during handoff. Soft aqua aura for warmth. */}
        <div style={butterflyBox} aria-hidden>
          <div
            style={{
              ...butterflyAura,
              opacity: phase === 'handoff' || phase === 'leaving' ? 1 : 0.7,
              transform: phase === 'handoff' || phase === 'leaving' ? 'scale(1.15)' : 'scale(1)',
              transition: 'opacity 500ms ease, transform 500ms ease',
            }}
          />
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
              filter: `drop-shadow(0 8px 18px rgba(56, 189, 248, ${isHandoff ? 0.55 : 0.35}))`,
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
          {phase === 'handoff' || phase === 'leaving'
            ? <>{pending ? COMPANIONS[pending].name : 'Someone'} is coming over…</>
            : <>Two of us can show you around. Choose whoever feels
              right — you can switch anytime.</>
          }
        </p>

        <div style={choiceRow}>
          <CompanionChoice
            ref={georgeBtnRef}
            companion="george"
            disabled={phase !== 'ready'}
            isPending={pending === 'george'}
            wasChosenBefore={snapshotCompanion === 'george'}
            onPick={pickCompanion}
          />
          <CompanionChoice
            ref={georgiaBtnRef}
            companion="georgia"
            disabled={phase !== 'ready'}
            isPending={pending === 'georgia'}
            wasChosenBefore={snapshotCompanion === 'georgia'}
            onPick={pickCompanion}
          />
        </div>

        {phase === 'ready' && (
          <button
            ref={secondaryBtnRef}
            type="button"
            onClick={close}
            style={dismissLink}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#0F172A'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#64748B'; }}
          >
            Look around first
          </button>
        )}
      </div>

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

// ─── CompanionChoice: one of the two picker pills ─────────────────────
// A ref-forwarded pill so the parent can trap focus on it. Shows a warm
// hover, a "pending" state while the handoff runs, and a subtle mark on
// the companion the visitor picked previously (so returning feels like
// coming home).

interface CompanionChoiceProps {
  companion: CompanionId;
  disabled: boolean;
  isPending: boolean;
  wasChosenBefore: boolean;
  onPick: (id: CompanionId) => void;
}

const CompanionChoice = forwardRef<HTMLButtonElement, CompanionChoiceProps>(
  function CompanionChoice({ companion, disabled, isPending, wasChosenBefore, onPick }, ref) {
    const meta = COMPANIONS[companion];
    return (
      <button
        ref={ref}
        type="button"
        onClick={() => onPick(companion)}
        disabled={disabled}
        style={{
          ...choiceBtn,
          background: isPending ? '#0B2A4A' : '#05192C',
          borderColor: wasChosenBefore ? '#5EEAD4' : 'transparent',
          transform: isPending ? 'translateY(-1px) scale(1.01)' : 'translateY(0) scale(1)',
          opacity: disabled && !isPending ? 0.55 : 1,
          cursor: disabled ? 'default' : 'pointer',
        }}
        onMouseEnter={(e) => {
          if (disabled) return;
          (e.currentTarget as HTMLButtonElement).style.background = '#0B2A4A';
          (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
        }}
        onMouseLeave={(e) => {
          if (disabled || isPending) return;
          (e.currentTarget as HTMLButtonElement).style.background = '#05192C';
          (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
        }}
      >
        <span style={{ display: 'block', fontSize: 12.5, opacity: 0.7, letterSpacing: '0.04em', fontWeight: 600 }}>
          {wasChosenBefore ? 'Say hello again to' : 'Say hello to'}
        </span>
        <span style={{ display: 'block', fontSize: 17, fontWeight: 800, marginTop: 2 }}>
          {meta.name}
        </span>
      </button>
    );
  },
);

// ═══ styles ═══════════════════════════════════════════════════════════
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
};

const card: React.CSSProperties = {
  position: 'relative',
  background: 'linear-gradient(180deg, #FFFFFF 0%, #F6FBFF 100%)',
  borderRadius: 24,
  padding: '32px 30px 22px',
  maxWidth: 520,
  width: '100%',
  boxShadow:
    '0 32px 80px rgba(5, 25, 44, 0.32), 0 4px 12px rgba(5, 25, 44, 0.08), 0 0 0 1px rgba(94, 234, 212, 0.22)',
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
  fontSize: 15,
  color: '#334155',
  lineHeight: 1.6,
  margin: '0 0 22px',
  maxWidth: 440,
  marginInline: 'auto',
  minHeight: 48, // reserve space so the copy swap during handoff doesn't jump the layout
};

const choiceRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 10,
  marginBottom: 14,
};

const choiceBtn: React.CSSProperties = {
  padding: '14px 18px',
  color: '#FFFFFF',
  border: '1.5px solid transparent',
  borderRadius: 16,
  fontSize: 15,
  fontWeight: 700,
  transition:
    'transform 200ms cubic-bezier(0.22, 1, 0.36, 1), background 160ms ease, border-color 160ms ease, opacity 200ms ease',
  boxShadow: '0 6px 18px rgba(5, 25, 44, 0.18)',
};

const dismissLink: React.CSSProperties = {
  display: 'inline-block',
  padding: '10px 14px',
  background: 'transparent',
  color: '#64748B',
  border: 0,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  textDecoration: 'underline',
  textDecorationColor: 'rgba(100,116,139,0.35)',
  textUnderlineOffset: 4,
  transition: 'color 160ms ease',
};
