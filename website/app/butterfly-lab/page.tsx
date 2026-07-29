'use client';

/**
 * /butterfly-lab — Phase B prototyping surface.
 *
 * Purpose: iterate the butterfly-steps-out-of-the-logo choreography
 * in isolation, before wiring it into /meet. This is a working
 * sketchpad, not a public page \u2014 the nav doesn't link to it and
 * there's no SEO. Once the motion feels right, we lift-and-shift
 * the CSS + timing constants into /meet and delete this page.
 *
 * Design intent (locked with Garry, Jul 2026):
 *
 *   > The butterfly should fly naturally from the logo, land, look
 *   > around briefly and then say: "Hello. I'm George. I'm really
 *   > pleased you found us."
 *
 * Motion phases (v1 baseline \u2014 refine from here):
 *
 *   1. Wake       (0 - 300ms)     small flutter, hint of attention.
 *   2. Lift-off   (300 - 700ms)   climbs out of the "logo" spot.
 *   3. Cruise     (700 - 2200ms)  arcs across, subtle bob + rotate.
 *   4. Approach   (2200 - 2500ms) decelerates into landing.
 *   5. Settle     (2500 - 2700ms) tiny final adjustment.
 *   6. Look       (2700 - 3200ms) gentle tilt left, tilt right.
 *   7. Speak      (3200 ms +)     greeting text fades in below.
 *
 * Total pre-greeting: ~3.2s. Not rushed, not laboured.
 *
 * Read /app/JOURNEY_CONTINUITY.md and
 * /app/website/PUBLIC_EXPERIENCE_PRINCIPLES.md before changing timing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { brandAssets } from '@/lib/brand-assets';

// ─── Phase timings ────────────────────────────────────────────────────
// One source of truth. Tuning these here changes the whole flight.

const T = {
  WAKE_END:      300,
  LIFTOFF_END:   700,
  CRUISE_END:  2200,
  APPROACH_END:2500,
  SETTLE_END:  2700,
  LOOK_END:    3200,
  SPEAK_FADE:   500, // greeting fade-in duration
} as const;

// ─── Component ────────────────────────────────────────────────────────

export default function ButterflyLabPage() {
  // A "run id" so we can replay from the start by incrementing it \u2014
  // React remounts the flyer, keyframes reset.
  const [runId, setRunId] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'flying' | 'landed' | 'looked' | 'spoken'>('idle');

  // Position of the "logo" spot the butterfly leaves from, and the
  // "landing" spot it arrives at. Measured live from the DOM so this
  // works at any viewport width without magic numbers.
  const originRef  = useRef<HTMLDivElement>(null);
  const targetRef  = useRef<HTMLDivElement>(null);
  const [geom, setGeom] = useState<{ dx: number; dy: number } | null>(null);

  const measure = useCallback(() => {
    const o = originRef.current?.getBoundingClientRect();
    const t = targetRef.current?.getBoundingClientRect();
    if (!o || !t) return;
    // dx / dy is the travel vector from origin centre to target centre.
    setGeom({
      dx: (t.left + t.width / 2) - (o.left + o.width / 2),
      dy: (t.top  + t.height/ 2) - (o.top  + o.height/ 2),
    });
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  // Sequence the phases when a new run starts.
  useEffect(() => {
    if (!geom) return;
    setPhase('flying');
    const t1 = window.setTimeout(() => setPhase('landed'), T.APPROACH_END);
    const t2 = window.setTimeout(() => setPhase('looked'), T.LOOK_END);
    const t3 = window.setTimeout(() => setPhase('spoken'), T.LOOK_END + T.SPEAK_FADE);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [runId, geom]);

  const replay = () => { setPhase('idle'); setGeom(null); setRunId(r => r + 1); setTimeout(measure, 20); };

  return (
    <div style={pageBg}>
      <div className="container" style={{ paddingTop: 40, paddingBottom: 80 }}>

        {/* Top row \u2014 mimics the header + logo location. */}
        <div style={fakeHeader}>
          <div ref={originRef} style={fakeLogo}>
            {/* Ghost butterfly in the logo spot. Kept always visible so
                the "same butterfly" feel is preserved: the flyer sits
                on top and animates away, while this rests dimly here. */}
            <img
              src={brandAssets.butterfly.src}
              alt=""
              aria-hidden
              style={{ ...butterflyStill, opacity: phase === 'idle' ? 1 : 0.15, transition: 'opacity 600ms ease' }}
            />
            <span style={{ fontWeight: 800, color: '#0A2540', fontSize: 20 }}>FriendPlace</span>
          </div>
          <button type="button" onClick={replay} style={replayBtn}>
            {phase === 'idle' ? 'Start' : 'Replay'}
          </button>
        </div>

        {/* Landing plate \u2014 where the butterfly will settle. */}
        <div style={plate}>
          <div ref={targetRef} style={targetSlot} aria-hidden />
          <h1
            style={{
              ...openingLine,
              opacity: phase === 'spoken' || phase === 'looked' ? 1 : 0,
              transform: phase === 'spoken' || phase === 'looked' ? 'translateY(0)' : 'translateY(6px)',
              transition: `opacity ${T.SPEAK_FADE}ms ease, transform ${T.SPEAK_FADE}ms ease`,
            }}
          >
            Hello. I&rsquo;m George.
            <br />
            I&rsquo;m really pleased you found us.
          </h1>
        </div>

        {/* Flying butterfly overlay \u2014 the star of the show.
            Keyed on runId so a "Replay" fully remounts and restarts
            the keyframes from time zero. */}
        {geom && (
          <div
            key={runId}
            className="flyer-outer"
            style={{
              ...flyerWrap,
              // Position at origin. CSS anim then moves via translate.
              left: (originRef.current?.getBoundingClientRect().left ?? 0)
                    + (originRef.current?.offsetWidth ?? 0) / 2 - 24,
              top:  (originRef.current?.getBoundingClientRect().top ?? 0)
                    + (originRef.current?.offsetHeight ?? 0) / 2 - 24,
              // CSS variables consumed by the keyframes below.
              ['--dx' as any]: `${geom.dx}px`,
              ['--dy' as any]: `${geom.dy}px`,
            }}
          >
            <div className="flyer-inner" style={flutterInner}>
              <img
                src={brandAssets.butterfly.src}
                alt=""
                aria-hidden
                style={butterflyFlying}
              />
            </div>
          </div>
        )}

        <div style={notesBox}>
          <div style={{ fontWeight: 800, marginBottom: 8, color: '#0A2540' }}>Choreography notes</div>
          <div style={{ fontSize: 13, lineHeight: 1.55, color: '#334155' }}>
            Butterfly rests in the logo, wakes with a small flutter, arcs
            across, decelerates, settles, tilts once each way to say hello,
            then the greeting fades in beneath. Total pre-greeting: ~3.2s.
            Tune the timings in <code>const T</code> at the top of this file.
          </div>
        </div>

      </div>

      {/* All motion lives in CSS so we don't rely on external libraries
          or JS animation loops \u2014 keeps the moment lightweight and
          respects prefers-reduced-motion in one place. */}
      <style>{`
        @keyframes flightArc {
          /* Wake: small hover, no travel. */
          0%     { transform: translate(0, 0) rotate(0deg); }
          9.4%   { transform: translate(0, -6px) rotate(-4deg); }
          /* Lift-off: begin moving. */
          21.9%  { transform: translate(calc(var(--dx) * 0.05), calc(var(--dy) * 0.05 - 18px)) rotate(-8deg); }
          /* Cruise midpoint: the arc peaks above the straight line. */
          46%    { transform: translate(calc(var(--dx) * 0.42), calc(var(--dy) * 0.30 - 46px)) rotate(-2deg); }
          /* Cruise late: heading down toward the target. */
          68.75% { transform: translate(calc(var(--dx) * 0.78), calc(var(--dy) * 0.72 - 20px)) rotate(4deg); }
          /* Approach: nearly there, decelerating. */
          78.13% { transform: translate(calc(var(--dx) * 0.94), calc(var(--dy) * 0.94 - 4px)) rotate(2deg); }
          /* Settle: gentle overshoot then centre. */
          84.38% { transform: translate(calc(var(--dx) * 1.00), calc(var(--dy) * 1.00 + 2px)) rotate(-1deg); }
          /* Look around: tilt left. */
          89%    { transform: translate(var(--dx), var(--dy)) rotate(-6deg); }
          /* Look around: tilt right. */
          94%    { transform: translate(var(--dx), var(--dy)) rotate(5deg); }
          /* Settled centre. */
          100%   { transform: translate(var(--dx), var(--dy)) rotate(0deg); }
        }
        @keyframes wingFlutter {
          0%,100% { transform: scaleX(1); }
          50%     { transform: scaleX(0.86); }
        }
        .flyer-outer {
          animation: flightArc 3200ms cubic-bezier(0.32, 0.06, 0.28, 1) forwards;
          will-change: transform;
        }
        .flyer-inner {
          animation: wingFlutter 220ms ease-in-out infinite;
          transform-origin: center;
        }
        /* Once settled, wings still \u2014 same butterfly at rest. */
        .flyer-outer[data-settled="true"] .flyer-inner {
          animation: none;
        }
        @media (prefers-reduced-motion: reduce) {
          .flyer-outer  { animation: none; transform: translate(var(--dx), var(--dy)); }
          .flyer-inner  { animation: none; }
        }
      `}</style>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────

const pageBg: React.CSSProperties = {
  minHeight: '100vh', background: '#FEFCF8', position: 'relative',
};

const fakeHeader: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '20px 24px', background: '#FFFFFF',
  border: '1px solid #F1E9DC', borderRadius: 16,
  marginBottom: 32,
};

const fakeLogo: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 10,
  position: 'relative', padding: '4px 8px',
};

const butterflyStill: React.CSSProperties = {
  width: 40, height: 'auto', display: 'block',
};

const replayBtn: React.CSSProperties = {
  padding: '10px 18px', borderRadius: 12,
  background: '#F0FDFA', color: '#0F766E',
  border: '1.5px solid #99F6E4',
  fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
  cursor: 'pointer',
};

const plate: React.CSSProperties = {
  maxWidth: 720, margin: '0 auto',
  background: '#FFFFFF',
  borderRadius: 24, border: '1px solid #F1E9DC',
  boxShadow: '0 10px 40px rgba(15,23,42,0.06)',
  padding: '96px 40px 64px',
  textAlign: 'center',
  position: 'relative',
  minHeight: 320,
};

const targetSlot: React.CSSProperties = {
  width: 1, height: 1, margin: '0 auto',
  // Invisible; used only to measure the landing point.
};

const openingLine: React.CSSProperties = {
  fontSize: 34, lineHeight: 1.22, fontWeight: 800,
  color: '#0A2540', margin: '48px auto 0', letterSpacing: '-0.02em',
  maxWidth: 520,
};

const flyerWrap: React.CSSProperties = {
  position: 'fixed', zIndex: 10, pointerEvents: 'none',
  width: 48, height: 48,
};

const flutterInner: React.CSSProperties = {
  width: '100%', height: '100%',
};

const butterflyFlying: React.CSSProperties = {
  width: '100%', height: 'auto', display: 'block',
};

const notesBox: React.CSSProperties = {
  maxWidth: 720, margin: '32px auto 0',
  padding: '16px 20px',
  background: '#F8FAFC', border: '1px solid #E2E8F0',
  borderRadius: 12,
};
