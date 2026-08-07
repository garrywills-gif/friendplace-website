'use client';

/**
 * LeadingButterfly — George/Georgia's final journey in the onboarding.
 *
 * DESIGN NOTE (31 Jul 2026, locked with Garry):
 *   After the introduction ends with "Come in… let me show you around."
 *   the butterfly must actually LEAD the visitor into FriendPlace. It's
 *   the visual equivalent of a host saying "This way…" and walking
 *   ahead. No dramatic swoops. No long flight. Subtle, calm, elegant —
 *   the same rhythm as the concierge overlay's arrival, but in reverse:
 *
 *     1. The butterfly lifts off its landed position (small stir).
 *     2. A fraction of a second's pause.
 *     3. It flies gracefully up-and-to-the-top-left of the screen.
 *     4. The route transitions to the first tour page beneath it.
 *     5. It lands in that page's FriendPlace logo — the same butterfly
 *        that guided the visitor is now the logo they'll see everywhere.
 *
 * Triggered from ANY surface with:
 *   window.dispatchEvent(new CustomEvent('friendplace:lead-to-tour', {
 *     detail: { destination: '/about' }
 *   }));
 *
 * At root layout so it survives the route change from /meet → /about.
 */

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { brandAssets } from '@/lib/brand-assets';

// ─── Timing (subtle by design) ─────────────────────────────────────────
const STIR_MS      = 380;   // "one moment before we go" pause
const STIR_LIFT_PX = 10;
const FLIGHT_MS    = 1100;  // centre → logo. Unhurried but not slow.
const NAV_AT_MS    = 260;   // ms into the flight when router.push fires
const LAND_HOLD_MS = 240;   // pause at logo before revealing real logo

// Size of the flyer in the "landed at greeting centre" state (matches
// /meet's flyer), and the size it lands as (matches the SiteHeader
// logo butterfly). It shrinks during flight.
const ORIGIN_SIZE = 55;
const LOGO_SIZE   = 40;

interface FlightState {
  top: number;
  left: number;
  width: number;
  rotation: number;
}

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

export function LeadingButterfly() {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<'entering' | 'stirring' | 'flying' | 'landed' | 'leaving'>('entering');
  const [flight, setFlight] = useState<FlightState | null>(null);
  const router = useRouter();
  const reduced = useReducedMotion();

  // Body-class helper (same mechanism used by the concierge overlay to
  // hide the real logo butterfly on the destination page — so the
  // flying butterfly IS the logo it lands into).
  const setLogoHidden = useCallback((hidden: boolean) => {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('fp-butterfly-away', hidden);
  }, []);

  // Where /meet's butterfly lives in the "greeting complete" state —
  // exactly matches the target position the concierge overlay lands
  // at, so this flight begins from the same visual anchor.
  const readOrigin = useCallback((): FlightState => {
    const vw = typeof window !== 'undefined' ? window.innerWidth  : 1440;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
    // Concierge landed target: centre X, centre Y - 88 - size/2.
    // /meet's flyer is at vh * 0.42 - FLYER_SIZE/2. We use the /meet
    // position because that's where the visitor's eye actually is
    // when the CTA is clicked.
    return {
      top:  vh * 0.42 - ORIGIN_SIZE / 2,
      left: vw / 2    - ORIGIN_SIZE / 2,
      width: ORIGIN_SIZE,
      rotation: 0,
    };
  }, []);

  // The logo target — approximate SiteHeader butterfly position. Reading
  // the DOM would be ideal, but destination hydration lags the flight
  // by ~700ms. We use a fixed value that matches the measured position
  // of #fp-brand-butterfly on marketing pages (x≈160, y≈16, 40×40).
  const readLogoTarget = useCallback((): FlightState => {
    // On mobile the header padding is smaller — the wordmark's butterfly
    // sits closer to the left edge. Approximate both.
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
    const mobile = vw < 720;
    return {
      top:  mobile ? 14 : 16,
      left: mobile ? 20 : 160,
      width: LOGO_SIZE,
      rotation: 0,
    };
  }, []);

  // ── Listener: opens when a page dispatches the "lead to tour" event ──
  const destinationRef = useRef<string>('/about');
  useEffect(() => {
    const onLead = (e: Event) => {
      const detail = (e as CustomEvent).detail as { destination?: string } | undefined;
      destinationRef.current = detail?.destination || '/about';

      setFlight(readOrigin());
      setLogoHidden(true);
      setOpen(true);
      setPhase(reduced ? 'flying' : 'stirring');

      // Prefetch the destination — it's likely to be visited by
      // clickable link too, but a prefetch here makes the route
      // change happen as fast as the browser can.
      try { router.prefetch(destinationRef.current); } catch { /* best-effort */ }
    };
    window.addEventListener('friendplace:lead-to-tour', onLead);
    return () => window.removeEventListener('friendplace:lead-to-tour', onLead);
  }, [readOrigin, reduced, router, setLogoHidden]);

  // ── Stir → Flying ─────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'stirring') return;
    const raf = requestAnimationFrame(() => {
      setFlight((prev) => prev ? {
        ...prev,
        top: prev.top - STIR_LIFT_PX,
        width: prev.width * 1.05,
        rotation: 2,   // a gentle "this way" tilt to the right
      } : prev);
    });
    const t = setTimeout(() => setPhase('flying'), STIR_MS);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [phase]);

  // ── Flying → Landed ───────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'flying') return;
    const target = readLogoTarget();
    const raf = requestAnimationFrame(() => setFlight(target));
    // Route push part-way through the flight so the destination is
    // hydrated by the time the butterfly settles into the logo.
    const nav = setTimeout(() => {
      router.push(destinationRef.current);
    }, reduced ? 40 : NAV_AT_MS);
    const done = setTimeout(() => setPhase('landed'), (reduced ? 240 : FLIGHT_MS) + 30);
    return () => { cancelAnimationFrame(raf); clearTimeout(nav); clearTimeout(done); };
  }, [phase, readLogoTarget, reduced, router]);

  // ── Landed → Leaving → unmount ───────────────────────────────
  useEffect(() => {
    if (phase !== 'landed') return;
    // A beat of stillness at the logo — the butterfly has just
    // arrived home. In this beat we reveal the REAL logo butterfly
    // underneath the flyer (same PNG, same size, same position — the
    // swap is invisible). Then we fade the canvas: the tour is
    // revealed BENEATH the still-visible flying butterfly, so the
    // butterfly rides the reveal rather than flashing on top of it.
    const t1 = setTimeout(() => {
      setLogoHidden(false); // real logo appears beneath our flyer
    }, LAND_HOLD_MS);
    const t2 = setTimeout(() => {
      // Now start the "curtain lift" — canvas fades out, revealing
      // /about behind. Flying butterfly fades in tandem, ending on
      // top of the (already-visible) real logo.
      setPhase('leaving');
    }, LAND_HOLD_MS + 80);
    const t3 = setTimeout(() => {
      setOpen(false);
      setPhase('entering');
      setFlight(null);
    }, LAND_HOLD_MS + 80 + 560); // wait for canvas fade to complete
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [phase, setLogoHidden]);

  if (!open || !flight) return null;

  // Persistent navy canvas during the flight — the same soft blue the
  // butterfly took off from. Because it stays visible from stir
  // through landing, the visitor never sees /about's cream body
  // paint underneath. When the butterfly settles into the logo, this
  // canvas fades out and the destination page is revealed. That's the
  // "one continuous space" — the room the butterfly leads them into.
  const canvasOpacity =
    phase === 'leaving' ? 0 :
    phase === 'entering' ? 0 :
    1;

  return (
    <>
      <div
        aria-hidden
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1000,
          background: '#0A2540',
          opacity: canvasOpacity,
          pointerEvents: 'none',
          // Slow fade OUT on 'leaving' so the tour reveal feels like a
          // curtain lifting, not a flash. No fade in — the canvas is
          // present from the moment the butterfly lifts off, matching
          // /meet's own navy so there's no visible boundary.
          transition: 'opacity 520ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      />
      <div
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
              : phase === 'flying'
                ? `top ${FLIGHT_MS}ms cubic-bezier(0.38, 0.02, 0.28, 1), left ${FLIGHT_MS}ms cubic-bezier(0.38, 0.02, 0.28, 1), width ${FLIGHT_MS}ms cubic-bezier(0.38, 0.02, 0.28, 1), transform ${FLIGHT_MS}ms ease, opacity 220ms ease`
                : phase === 'leaving'
                  ? 'opacity 300ms ease'
                  : 'top 400ms ease, left 400ms ease, width 400ms ease',
          opacity: phase === 'leaving' ? 0 : 1,
          filter: 'drop-shadow(0 8px 18px rgba(56, 189, 248, 0.35))',
        }}
      >
        <Image
          src={brandAssets.butterfly.src}
          alt=""
          width={LOGO_SIZE}
          height={LOGO_SIZE}
          priority
          style={{ width: '100%', height: 'auto', display: 'block' }}
        />
      </div>
    </>
  );
}
