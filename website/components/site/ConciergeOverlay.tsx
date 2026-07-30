'use client';

/**
 * ConciergeOverlay — the FriendPlace "concierge" welcome experience.
 *
 * DESIGN NOTE (30 Jul 2026, locked with Garry): The butterfly that
 * arrives in the concierge overlay IS the FriendPlace logo butterfly.
 * When the visitor invites George or Georgia, the real logo butterfly
 * quietly disappears and a "flying" butterfly begins at that exact
 * position, gracefully drifts to the centre of the card, and grows to
 * its full presence. The overlay card materialises AROUND the arriving
 * butterfly, so the composition reads as one continuous moment:
 *
 *   "The butterfly you've been looking at all along noticed you were
 *    here… and came over to say hello."
 *
 * On dismissal ("Look around first" / Escape / backdrop / ×) the
 * butterfly flies back to the logo and the logo butterfly is restored.
 * The visitor never sees a "poof-in / poof-out" of a separate mascot —
 * the FriendPlace butterfly IS the host, and it behaves that way.
 *
 * IMPLEMENTATION
 * ──────────────
 *   • We read the DOM position of `#fp-brand-butterfly` (rendered by
 *     SiteHeader) on open and use it as the flight origin. If it isn't
 *     available (e.g. tests, headless SSR), we skip the flight and
 *     fall back to the previous fade-in overlay.
 *   • The real logo butterfly is faded to opacity 0 by adding the
 *     class `fp-butterfly-away` to <html>. The complementary CSS lives
 *     in app/globals.css or is injected inline (see below).
 *   • The flying butterfly is `position: fixed` and transitions its
 *     `top`, `left`, and `width` between logo state and centre state.
 *     A gentle rotation adds character; the transition curve gives the
 *     flight a purposeful, unhurried feel.
 *   • Reduced-motion visitors skip the flight entirely — the overlay
 *     fades in with the butterfly already at centre, no logo swap.
 *
 * The overlay is triggered from anywhere via:
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

// ─── Timing ───────────────────────────────────────────────────────────
const STIR_MS         = 420;   // "did the butterfly just move?" pause
const FLIGHT_MS       = 950;   // stirred → centre
const FLIGHT_BACK_MS  = 780;   // centre → logo (slightly quicker — "goodbye")
const CARD_APPEAR_MS  = 320;   // card fades in around the arriving butterfly
const CARD_APPEAR_AT  = STIR_MS + 620; // ms into open when card starts appearing
const HANDOFF_HOLD_MS = 650;
const HANDOFF_FADE_MS = 380;

// Target dimensions inside the overlay card.
const TARGET_BUTTERFLY_W = 76;

// How far the butterfly rises off the logo during the stir moment.
// Small enough that a distracted visitor might miss it — which is
// exactly the point. "Did it just move?"
const STIR_LIFT_PX = 12;

// A single flight snapshot — the position/size the butterfly is animating TO.
interface FlightState {
  top: number;
  left: number;
  width: number;
  rotation: number;
  opacity: number;
}

export function ConciergeOverlay() {
  const [open, setOpen] = useState(false);
  // Extended phase machine. Notably:
  //   • 'flying-in'   — real logo butterfly hidden; flying butterfly is
  //                     mid-flight from logo to centre. Card not yet
  //                     interactive.
  //   • 'ready'       — landed, card interactive.
  //   • 'handoff'     — visitor picked a companion; route in progress;
  //                     card fading, butterfly still visible for
  //                     continuity into /meet.
  //   • 'flying-back' — dismissed; card gone, butterfly on the return
  //                     trip to the logo.
  //   • 'leaving'     — final fade / unmount step.
  const [phase, setPhase] = useState<
    'entering' | 'stirring' | 'flying-in' | 'ready' | 'handoff' | 'flying-back' | 'leaving'
  >('entering');
  const [pending, setPending] = useState<CompanionId | null>(null);
  const [flight, setFlight] = useState<FlightState | null>(null);
  const [flightSupported, setFlightSupported] = useState(true);

  const router = useRouter();
  const reduced = useReducedMotion();
  const { companion, choose } = useCompanion();
  const companionRef = useRef<CompanionId | null>(companion);
  useEffect(() => { companionRef.current = companion; }, [companion]);
  const [snapshotCompanion, setSnapshotCompanion] = useState<CompanionId | null>(null);

  const previouslyFocused = useRef<HTMLElement | null>(null);
  const georgeBtnRef = useRef<HTMLButtonElement | null>(null);
  const georgiaBtnRef = useRef<HTMLButtonElement | null>(null);
  const secondaryBtnRef = useRef<HTMLButtonElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const defaultFocusRef = snapshotCompanion === 'georgia' ? georgiaBtnRef : georgeBtnRef;

  // ── Position calculators ──────────────────────────────────────
  // Where the logo butterfly currently is (viewport coords).
  const readLogo = useCallback((): FlightState | null => {
    if (typeof window === 'undefined') return null;
    const el = document.getElementById('fp-brand-butterfly');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      top: r.top,
      left: r.left,
      width: r.width,
      rotation: 0,
      opacity: 1,
    };
  }, []);

  // Where the butterfly should LAND — top-centre of the overlay card
  // slot. Card is flex-centred and max-width 520, padding 32px top,
  // butterflyBox height 90px, butterfly height 74. So butterfly top
  // ≈ (viewport centre) - 130 (rough card top offset) + 32 + 8.
  const readTarget = useCallback((): FlightState => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Butterfly is inside a card that flex-centres vertically. Its
    // top edge sits roughly (card top + 32 padding + 8 aura offset).
    // We can approximate by treating the target centre as being ~40 px
    // above viewport centre — this keeps the butterfly nicely at the
    // top of the card regardless of card height (which grows/shrinks
    // slightly with responsive font wrap on mobile).
    const targetCentreY = vh / 2 - 88;
    const targetCentreX = vw / 2;
    return {
      top: targetCentreY - TARGET_BUTTERFLY_W / 2,
      left: targetCentreX - TARGET_BUTTERFLY_W / 2,
      width: TARGET_BUTTERFLY_W,
      rotation: 0,
      opacity: 1,
    };
  }, []);

  // ── Body class to hide/show the real logo butterfly ────────────
  // Injects a one-shot <style> tag the first time the overlay opens
  // (idempotent). We only apply the class while a flight is in
  // progress OR the overlay is fully open — the logo comes back the
  // moment the butterfly lands on the logo again after dismiss.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const id = 'fp-concierge-butterfly-away-style';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      html.fp-butterfly-away #fp-brand-butterfly {
        opacity: 0;
        transition: opacity 160ms ease;
      }
      #fp-brand-butterfly { transition: opacity 260ms ease; }
    `;
    document.head.appendChild(style);
  }, []);

  const setLogoHidden = useCallback((hidden: boolean) => {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('fp-butterfly-away', hidden);
  }, []);

  // ── Open the overlay ─────────────────────────────────────────
  useEffect(() => {
    const openConcierge = () => {
      previouslyFocused.current = document.activeElement as HTMLElement | null;
      setSnapshotCompanion(companionRef.current);
      setPending(null);

      const logo = readLogo();
      if (reduced || !logo) {
        // Reduced-motion or logo not measurable: skip the flight,
        // land the butterfly straight at the target position and
        // fade the overlay in.
        setFlightSupported(false);
        setFlight(readTarget());
        setLogoHidden(false); // no need to hide the logo in fallback
        setOpen(true);
        setPhase('entering');
        return;
      }

      // Normal path: butterfly starts at the logo, STIRS for a beat
      // (lifts a hair off the logo), then flies to the target. That
      // pause is what makes the visitor almost do a double-take —
      // "did the butterfly just move?" — before it commits to
      // coming over.
      setFlightSupported(true);
      setFlight(logo);
      setLogoHidden(true); // fade the real logo butterfly out
      setOpen(true);
      setPhase('stirring');
    };
    window.addEventListener('friendplace:meet-george', openConcierge);
    return () => window.removeEventListener('friendplace:meet-george', openConcierge);
  }, [readLogo, readTarget, reduced, setLogoHidden]);

  // ── Prefetch /meet as soon as we open, so the handoff lands
  //    on a warm route (no visible loading state). ──────────────
  useEffect(() => {
    if (!open) return;
    try { router.prefetch('/meet?from=concierge'); } catch { /* best-effort */ }
  }, [open, router]);

  // ── Flight advancement: stir → fly → ready ─────────────────
  //
  //   1. 'stirring' (STIR_MS): the butterfly lifts a hair off the
  //      logo. Almost imperceptible, but enough to catch the eye.
  //   2. 'flying-in' (FLIGHT_MS): the butterfly gracefully travels
  //      to the centre of the screen, growing to full presence.
  //   3. 'ready': landed, breath animation begins, card is
  //      interactive.
  useEffect(() => {
    if (phase !== 'stirring') return;
    const raf = requestAnimationFrame(() => {
      // Rise off the logo with a whisper of scale. The whole card is
      // still invisible at this point, so nothing else moves — the
      // eye lands on this tiny motion.
      setFlight((prev) => prev ? {
        ...prev,
        top: prev.top - STIR_LIFT_PX,
        // A gentle 1.06x during the stir so the butterfly feels alive,
        // not lifting like a floating png.
        width: prev.width * 1.06,
        rotation: -3,
      } : prev);
    });
    // After the stir, begin the flight to centre.
    const t = setTimeout(() => setPhase('flying-in'), STIR_MS);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [phase]);

  useEffect(() => {
    if (phase !== 'flying-in') return;
    // Butterfly is currently in the "stirred" pose — commit the flight
    // to the target on the next frame so CSS can transition.
    const raf = requestAnimationFrame(() => setFlight(readTarget()));
    // Promote to 'ready' shortly after landing so the card's final
    // interactive state kicks in.
    const t = setTimeout(() => setPhase('ready'), FLIGHT_MS + 30);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [phase, readTarget]);

  // ── Reduced-motion / fallback path: 'entering' → 'ready' via a
  //    single RAF so CSS transitions run. ─────────────────────
  useEffect(() => {
    if (phase !== 'entering') return;
    const raf = requestAnimationFrame(() => setPhase('ready'));
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  // ── Close politely — the butterfly flies BACK to the logo, then
  //    everything unmounts. ─────────────────────────────────────
  const close = useCallback(() => {
    if (flightSupported && flight) {
      // Card fades out first (fast), then butterfly flies home.
      setPhase('flying-back');
      const logo = readLogo();
      if (logo) setFlight(logo);
      setTimeout(() => setPhase('leaving'), FLIGHT_BACK_MS);
      setTimeout(() => {
        // Restore the real logo butterfly right as the flying one
        // reaches home — creates a visual "settle" with no swap.
        setLogoHidden(false);
      }, FLIGHT_BACK_MS - 60);
      setTimeout(
        () => {
          setOpen(false);
          setPhase('entering');
          setPending(null);
          setFlight(null);
          previouslyFocused.current?.focus?.({ preventScroll: true });
        },
        FLIGHT_BACK_MS + 260,
      );
    } else {
      // Fallback: just fade the overlay out.
      setPhase('leaving');
      setTimeout(
        () => {
          setOpen(false);
          setPhase('entering');
          setPending(null);
          setFlight(null);
          previouslyFocused.current?.focus?.({ preventScroll: true });
        },
        reduced ? 160 : 300,
      );
    }
  }, [flight, flightSupported, readLogo, reduced, setLogoHidden]);

  // ── Focus, focus-trap, escape, scroll-lock ────────────────────
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the default button only AFTER the flight has landed —
    // hitting a button before that would break the illusion.
    const focusDelay = flightSupported ? STIR_MS + FLIGHT_MS + 60 : 260;
    const focusTimer = setTimeout(() => {
      defaultFocusRef.current?.focus({ preventScroll: true });
    }, focusDelay);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
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
      clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, close, defaultFocusRef, flightSupported]);

  // ── Companion pick — persist choice, keep the butterfly visible
  //    through the route change, fade the card. The flying butterfly
  //    lingers briefly then dissolves as /meet mounts underneath. ──
  const pickCompanion = useCallback((id: CompanionId) => {
    if (phase !== 'ready') return;
    setPending(id);
    setPhase('handoff');
    choose(id);
    router.push('/meet?from=concierge');
    setTimeout(() => {
      setPhase('leaving');
      setTimeout(
        () => {
          setOpen(false);
          setPhase('entering');
          setPending(null);
          setFlight(null);
          // Restore the logo — /meet has its OWN header and its own
          // choreography will use #fp-brand-butterfly again.
          setLogoHidden(false);
        },
        HANDOFF_FADE_MS + 60,
      );
    }, reduced ? 200 : HANDOFF_HOLD_MS);
  }, [phase, router, choose, reduced, setLogoHidden]);

  if (!open) return null;

  const cardVisible = phase === 'ready' || phase === 'handoff';
  const isHandoffOrLeaving = phase === 'handoff' || phase === 'leaving';

  // Card fade-in timing: begins as the flight is nearing its
  // landing so it materialises AROUND the arriving butterfly.
  const cardOpacity =
    phase === 'flying-back' ? 0 :
    phase === 'leaving'     ? 0 :
    phase === 'handoff'     ? 1 :
    phase === 'ready'       ? 1 :
    // Start the card fade-in DURING the flight (with a delay via
    // transitionDelay below), so the card materialises AROUND the
    // arriving butterfly rather than popping in after it lands.
    phase === 'flying-in'   ? 1 :
    phase === 'stirring'    ? 0 :
    0;

  const cardTransform =
    reduced
      ? 'none'
      : phase === 'ready'
        ? 'translateY(0) scale(1)'
        : phase === 'handoff'
          ? 'translateY(-3px) scale(1.005)'
          : phase === 'leaving'
            ? 'translateY(-3px) scale(1.01)'
            : 'translateY(10px) scale(0.985)';

  const backdropOpacity =
    phase === 'ready'       ? 1    :
    phase === 'handoff'     ? 0.75 :
    phase === 'flying-back' ? 0.15 :
    phase === 'leaving'     ? 0    :
    phase === 'stirring'    ? 0.15 : // barely dim during the stir — visitors still see the site
    phase === 'flying-in'   ? 0.5  : // dim rises as butterfly commits
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
        backdropFilter: phase === 'ready' || phase === 'handoff' ? 'blur(14px) saturate(1.05)' : 'blur(4px)',
        WebkitBackdropFilter: phase === 'ready' || phase === 'handoff' ? 'blur(14px) saturate(1.05)' : 'blur(4px)',
        transition: `opacity ${isHandoffOrLeaving ? HANDOFF_FADE_MS : 500}ms ease, backdrop-filter 500ms ease`,
      }}
      onClick={(e) => {
        if (phase !== 'ready') return; // guard during flights + handoff
        if (e.target === overlayRef.current) close();
      }}
    >
      {/* ── Flying butterfly ─────────────────────────────────────
          Rendered outside the card so it can travel from the logo to
          the card's butterfly slot independently. `position: fixed`
          so it sits in viewport coordinates regardless of scroll. */}
      {flight && (
        <div
          data-concierge-flyer
          aria-hidden
          style={{
            position: 'fixed',
            top: flight.top,
            left: flight.left,
            width: flight.width,
            height: 'auto',
            zIndex: 1002,
            pointerEvents: 'none',
            transform: `rotate(${flight.rotation}deg)`,
            transition: reduced
              ? 'opacity 240ms ease'
              : phase === 'stirring'
                ? `top ${STIR_MS}ms cubic-bezier(0.22, 1, 0.36, 1), width ${STIR_MS}ms ease, transform ${STIR_MS}ms ease`
                : phase === 'flying-in'
                  ? `top ${FLIGHT_MS}ms cubic-bezier(0.34, 1.15, 0.36, 1), left ${FLIGHT_MS}ms cubic-bezier(0.34, 1.15, 0.36, 1), width ${FLIGHT_MS}ms cubic-bezier(0.34, 1.15, 0.36, 1), transform ${FLIGHT_MS}ms cubic-bezier(0.34, 1.15, 0.36, 1), opacity 220ms ease`
                  : phase === 'flying-back'
                    ? `top ${FLIGHT_BACK_MS}ms cubic-bezier(0.55, 0, 0.65, 1), left ${FLIGHT_BACK_MS}ms cubic-bezier(0.55, 0, 0.65, 1), width ${FLIGHT_BACK_MS}ms cubic-bezier(0.55, 0, 0.65, 1), transform ${FLIGHT_BACK_MS}ms ease, opacity 220ms ease`
                    : phase === 'leaving'
                      ? `opacity ${HANDOFF_FADE_MS}ms ease, transform ${HANDOFF_FADE_MS}ms ease`
                      : `top 500ms ease, left 500ms ease, width 500ms ease`,
            opacity:
              phase === 'leaving' ? 0 :
              phase === 'flying-back' ? 0.9 :
              1,
            // Soft glow that intensifies once landed.
            filter: `drop-shadow(0 8px 22px rgba(56, 189, 248, ${
              phase === 'ready' || phase === 'handoff' ? 0.5 : 0.28
            }))`,
            // Gentle breath animation once landed, so the butterfly
            // doesn't sit statically like a clip-art image.
            animation: phase === 'ready' && !reduced
              ? 'concierge-breath 5.2s ease-in-out 200ms infinite'
              : 'none',
          }}
        >
          <Image
            src={brandAssets.butterfly.src}
            alt=""
            width={TARGET_BUTTERFLY_W}
            height={TARGET_BUTTERFLY_W}
            priority
            style={{ width: '100%', height: 'auto', display: 'block' }}
          />
        </div>
      )}

      {/* ── The card materialises AROUND the arriving butterfly ─ */}
      <div
        style={{
          ...card,
          transform: cardTransform,
          opacity: cardOpacity,
          transitionDelay: phase === 'flying-in' ? `${CARD_APPEAR_AT - STIR_MS}ms` : '0ms',
          transition: `transform 380ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${
            isHandoffOrLeaving ? HANDOFF_FADE_MS : CARD_APPEAR_MS
          }ms ease`,
        }}
      >
        {/* Discreet close (×) — only shown once we're ready. */}
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

        {/* Aura + spacer for the butterfly slot. The flying butterfly
            visually occupies this space; the spacer reserves layout
            so the card composition looks the same whether or not the
            flight is in progress. */}
        <div style={butterflyBox} aria-hidden>
          <div
            style={{
              ...butterflyAura,
              opacity: cardVisible ? (phase === 'handoff' ? 1 : 0.85) : 0,
              transform: phase === 'handoff' ? 'scale(1.15)' : 'scale(1)',
              transition: 'opacity 500ms ease, transform 500ms ease',
            }}
          />
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
          0%, 100% { transform: rotate(-1deg) translateY(0); }
          50%      { transform: rotate(1.5deg) translateY(-4px); }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-concierge-flyer] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}

// ─── CompanionChoice: one of the two picker pills ─────────────────────
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
  minHeight: 48,
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
