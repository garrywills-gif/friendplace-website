'use client';

/**
 * /butterfly-lab — Phase B (v2). The opening scene of FriendPlace.
 *
 * This is not an animation. It's a shot list.
 *
 *   The butterfly rests inside the FriendPlace logo. It notices
 *   someone has arrived. It stirs \u2014 not a wake-up so much as a
 *   softening. It steps off the logo, hesitates in the air for a
 *   moment as if catching a current, and drifts across. It does not
 *   travel to the plate. It simply decides to come over. The path is
 *   never straight and never rushed. It arrives. It settles. It
 *   looks left, looks right, sees you, and holds the moment. Then it
 *   speaks: "Hello." A small pause. "I'm George." Another. "I'm
 *   really pleased you found us." Its wings, from the moment it
 *   lands, never fully still \u2014 the smallest breath, just barely
 *   perceptible, so it always looks alive.
 *
 * Locked with Garry (Jul 2026):
 *   \u2022 We would rather this take longer than arrive too quickly.
 *   \u2022 The tiny pause before speaking may be the most memorable
 *     part of the whole experience.
 *   \u2022 Speech comes first, then the text follows.
 *   \u2022 We are chasing "that felt strangely real", not "nice
 *     animation".
 *
 * Timing is one source of truth in `const T` below. Motion is CSS
 * keyframes so `prefers-reduced-motion` collapses the whole scene to
 * a single dignified fade for anyone who can't take movement.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { brandAssets } from '@/lib/brand-assets';

// ─── Shot timing ──────────────────────────────────────────────────────
//
// Values in milliseconds. Deliberately unrushed \u2014 the entire scene
// runs ~7 seconds before George/Georgia even finishes speaking. Think
// of this as the opening beat of a film, not a page loader.

const T = {
  // Phase 1 \u2014 the butterfly notices someone.
  NOTICE_END:      600,   // small, slow softening in the logo
  // Phase 2 \u2014 lifts off. Hesitant. Almost changes its mind.
  LIFTOFF_END:     1600,
  // Phase 3 \u2014 drifts across, catches the air, wanders a little.
  //           The travel time itself matters less than the *feel*.
  DRIFT_END:       4600,
  // Phase 4 \u2014 approaches its landing. Slows into it.
  APPROACH_END:    5100,
  // Phase 5 \u2014 settles. Tiny final adjustment.
  SETTLE_END:      5400,
  // Phase 6 \u2014 looks around. Left, right, centre.
  LOOK_END:        6100,
  // Phase 7 \u2014 EYE CONTACT. Nothing happens. This is on purpose.
  //           The pause is the moment. Do not shorten this.
  EYE_CONTACT_END: 6900,
  // Phase 8 \u2014 speaks.
  SAY_HELLO:       6900,   // audio: "Hello."
  TEXT_HELLO:      7100,   // text of "Hello." fades in a hair after
  SAY_NAME:        7900,   // audio + text: "I'm George / Georgia."
  SAY_CLOSING:     9100,   // audio + text: "I'm really pleased you found us."
} as const;

// ─── Component ────────────────────────────────────────────────────────

export default function ButterflyLabPage() {
  const [runId, setRunId] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'noticing' | 'flying' | 'landed' | 'looked' | 'eye-contact' | 'greeting'>('idle');
  const [textStage, setTextStage] = useState<0 | 1 | 2 | 3>(0);
  const [audioOn, setAudioOn] = useState(true);
  const [companion, setCompanion] = useState<'george' | 'georgia'>('george');

  // Anchor points \u2014 measured live from the DOM so it works at any width.
  const originRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const [geom, setGeom] = useState<{ dx: number; dy: number } | null>(null);

  // The audio elements. Two clips per companion \u2014 the first "Hello."
  // and the rest, so the beats between sentences are OUR beats, not
  // whatever OpenAI decided to space them at.
  const helloAudioRef = useRef<HTMLAudioElement | null>(null);
  const introAudioRef = useRef<HTMLAudioElement | null>(null);

  const measure = useCallback(() => {
    const o = originRef.current?.getBoundingClientRect();
    const t = targetRef.current?.getBoundingClientRect();
    if (!o || !t) return;
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

  // Sequence the whole scene.
  useEffect(() => {
    if (!geom) return;
    setPhase('noticing');
    setTextStage(0);
    const t1 = window.setTimeout(() => setPhase('flying'),      T.NOTICE_END);
    const t2 = window.setTimeout(() => setPhase('landed'),      T.SETTLE_END);
    const t3 = window.setTimeout(() => setPhase('looked'),      T.LOOK_END);
    const t4 = window.setTimeout(() => setPhase('eye-contact'), T.LOOK_END + 100);
    const t5 = window.setTimeout(() => {
      setPhase('greeting');
      if (audioOn && helloAudioRef.current) {
        helloAudioRef.current.currentTime = 0;
        helloAudioRef.current.play().catch(() => { /* autoplay blocked \u2014 silent fall-through */ });
      }
    }, T.SAY_HELLO);
    const t6 = window.setTimeout(() => setTextStage(1), T.TEXT_HELLO);
    const t7 = window.setTimeout(() => {
      setTextStage(2);
      if (audioOn && introAudioRef.current) {
        introAudioRef.current.currentTime = 0;
        introAudioRef.current.play().catch(() => { /* silent */ });
      }
    }, T.SAY_NAME);
    const t8 = window.setTimeout(() => setTextStage(3), T.SAY_CLOSING);
    return () => { [t1,t2,t3,t4,t5,t6,t7,t8].forEach(clearTimeout); };
  }, [runId, geom, audioOn]);

  const replay = () => {
    setPhase('idle');
    setTextStage(0);
    setGeom(null);
    // Stop any playing audio from the previous run.
    [helloAudioRef.current, introAudioRef.current].forEach(a => { if (a) { a.pause(); a.currentTime = 0; } });
    setRunId(r => r + 1);
    setTimeout(measure, 20);
  };

  const companionName = companion === 'george' ? 'George' : 'Georgia';

  return (
    <div style={pageBg}>
      <div className="container" style={{ paddingTop: 40, paddingBottom: 80 }}>

        {/* Fake header row \u2014 mimics the logo location. */}
        <div style={fakeHeader}>
          <div ref={originRef} style={fakeLogo}>
            <img
              src={brandAssets.butterfly.src}
              alt=""
              aria-hidden
              style={{ ...butterflyStill, opacity: phase === 'idle' ? 1 : 0.15, transition: 'opacity 900ms ease' }}
            />
            <span style={{ fontWeight: 800, color: '#0A2540', fontSize: 20 }}>FriendPlace</span>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <label style={dirCtrl}>
              <input type="radio" checked={companion === 'george'}  onChange={() => setCompanion('george')}  /> George
            </label>
            <label style={dirCtrl}>
              <input type="radio" checked={companion === 'georgia'} onChange={() => setCompanion('georgia')} /> Georgia
            </label>
            <label style={dirCtrl}>
              <input type="checkbox" checked={audioOn} onChange={e => setAudioOn(e.target.checked)} /> Sound
            </label>
            <button type="button" onClick={replay} style={replayBtn}>
              {phase === 'idle' ? 'Start' : 'Replay'}
            </button>
          </div>
        </div>

        {/* Landing plate \u2014 the greeting appears here. */}
        <div style={plate}>
          <div ref={targetRef} style={targetSlot} aria-hidden />
          <div style={greetingStack}>
            <LineOfSpeech text="Hello."                                             visible={textStage >= 1} />
            <LineOfSpeech text={`I\u2019m ${companionName}.`}                       visible={textStage >= 2} />
            <LineOfSpeech text={'I\u2019m really pleased you found us.'}             visible={textStage >= 3} />
          </div>
        </div>

        {/* The butterfly overlay. Keyed on runId to restart cleanly. */}
        {geom && (
          <div
            key={runId}
            className="flyer-outer"
            data-landed={phase === 'landed' || phase === 'looked' || phase === 'eye-contact' || phase === 'greeting' ? 'true' : 'false'}
            style={{
              ...flyerWrap,
              left: (originRef.current?.getBoundingClientRect().left ?? 0)
                    + (originRef.current?.offsetWidth ?? 0) / 2 - 24,
              top:  (originRef.current?.getBoundingClientRect().top ?? 0)
                    + (originRef.current?.offsetHeight ?? 0) / 2 - 24,
              ['--dx' as any]: `${geom.dx}px`,
              ['--dy' as any]: `${geom.dy}px`,
            }}
          >
            <div className="flyer-inner">
              <img src={brandAssets.butterfly.src} alt="" aria-hidden style={butterflyFlying} />
            </div>
          </div>
        )}

        {/* Audio \u2014 real Ash / Nova clips. Preload so the first "Hello."
            fires the instant the audio.play() call happens. */}
        <audio ref={helloAudioRef} src={`/audio/hello-${companion}.mp3`} preload="auto" />
        <audio ref={introAudioRef} src={`/audio/intro-${companion}.mp3`} preload="auto" />

        <div style={notesBox}>
          <div style={{ fontWeight: 800, marginBottom: 8, color: '#0A2540' }}>Director&rsquo;s notes</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.65, color: '#334155' }}>
            <li>Flight is longer, less deliberate. The butterfly hesitates, drifts, catches the air.</li>
            <li>After landing, wings are never fully still &mdash; a slow &ldquo;breath&rdquo; loop is always running.</li>
            <li>Look left, look right, then <strong>pause</strong>. That pause is on purpose &mdash; hold it.</li>
            <li>Speech comes first (&ldquo;Hello.&rdquo;) &mdash; text follows a beat later.</li>
            <li>Total pre-speech: ~6.9 seconds. Full greeting complete: ~10 seconds.</li>
            <li>Reduced-motion visitors get a dignified single fade &mdash; no flight, no shake.</li>
          </ul>
        </div>

      </div>

      <style>{`
        /* -------------------------------------------------------------
           FLIGHT KEYFRAMES
           The whole path is one keyframe animation \u2014 easier to
           reason about than chaining transitions, and hardware-composed.
           The butterfly path uses the CSS custom properties --dx/--dy
           set on the element, so the same keyframes work at any width.
           Percentages here map onto the 6.4-second animation duration
           (WAKE + LIFTOFF + DRIFT + APPROACH + SETTLE + LOOK).
           ------------------------------------------------------------- */
        @keyframes flightArc {
          /* Phase 1: Notice. Small soften in place. Not a wake, more a
             widening of attention. Wings do NOT flap harder here \u2014
             just a heartbeat. */
          0%     { transform: translate(0px, 0px) rotate(0deg); }
          6.5%   { transform: translate(0px, -3px) rotate(-2deg); }
          9.4%   { transform: translate(0px, -1px) rotate(-1deg); }

          /* Phase 2: Lift-off. Hesitant. Rises, drifts a little, thinks
             about it, then goes. */
          12%    { transform: translate(-4px, -14px) rotate(-6deg); }
          17%    { transform: translate(-6px, -22px) rotate(-4deg); }
          20%    { transform: translate(-2px, -30px) rotate(-8deg); }
          25%    { transform: translate(6px, -34px) rotate(-6deg); }

          /* Phase 3: Drift. This is the meat. The butterfly does not
             head straight to the plate. It wanders. It bobs. It comes
             close to slowing down entirely at ~50% before continuing.
             Small negative dx offsets create the "catches the air"
             feel \u2014 briefly moves backwards, then continues. */
          30%    { transform: translate(calc(var(--dx) * 0.10 - 4px), calc(var(--dy) * 0.05 - 40px)) rotate(-3deg); }
          38%    { transform: translate(calc(var(--dx) * 0.24 + 6px), calc(var(--dy) * 0.12 - 52px)) rotate(2deg); }
          46%    { transform: translate(calc(var(--dx) * 0.36 - 2px), calc(var(--dy) * 0.24 - 60px)) rotate(-4deg); }
          52%    { transform: translate(calc(var(--dx) * 0.42 + 8px), calc(var(--dy) * 0.34 - 58px)) rotate(1deg); }
          58%    { transform: translate(calc(var(--dx) * 0.50 - 4px), calc(var(--dy) * 0.46 - 52px)) rotate(-2deg); }
          64%    { transform: translate(calc(var(--dx) * 0.60 + 4px), calc(var(--dy) * 0.58 - 44px)) rotate(3deg); }
          70%    { transform: translate(calc(var(--dx) * 0.72 - 2px), calc(var(--dy) * 0.70 - 34px)) rotate(-1deg); }

          /* Phase 4: Approach. Decelerates. Slight overshoot to feel
             like a landing, not a stop. */
          78%    { transform: translate(calc(var(--dx) * 0.88), calc(var(--dy) * 0.86 - 18px)) rotate(2deg); }
          82%    { transform: translate(calc(var(--dx) * 0.96), calc(var(--dy) * 0.95 - 6px))  rotate(1deg); }
          84%    { transform: translate(calc(var(--dx) * 1.02), calc(var(--dy) * 1.02 + 2px))  rotate(-1deg); }

          /* Phase 5: Settle. Micro-adjustment to centre. */
          86%    { transform: translate(var(--dx), calc(var(--dy) + 1px)) rotate(0deg); }
          87%    { transform: translate(var(--dx), var(--dy))             rotate(0deg); }

          /* Phase 6: Look around. Not eager. Considered. */
          91%    { transform: translate(var(--dx), var(--dy)) rotate(-7deg); }
          95%    { transform: translate(var(--dx), var(--dy)) rotate(6deg); }
          98%    { transform: translate(var(--dx), var(--dy)) rotate(-1deg); }
          100%   { transform: translate(var(--dx), var(--dy)) rotate(0deg); }
        }

        /* Wing flutter DURING flight \u2014 fast, small, slightly irregular. */
        @keyframes wingFlutterActive {
          0%,100% { transform: scaleX(1); }
          38%     { transform: scaleX(0.82); }
          62%     { transform: scaleX(1.03); }
        }

        /* Wing "breath" AFTER landing \u2014 slow, imperceptible, always on.
           This is Garry's favourite note: real butterflies are never
           still. Almost like breathing. */
        @keyframes wingBreath {
          0%,100% { transform: scaleX(1)    scaleY(1); }
          30%     { transform: scaleX(0.985) scaleY(1.005); }
          62%     { transform: scaleX(1.008) scaleY(0.995); }
        }
        /* Occasional micro-flutter woven into the breath \u2014 randomised
           by a long animation cycle so it feels stochastic even though
           it's periodic. */
        @keyframes wingMicroFlutter {
          0%,   96%, 100% { transform: scaleX(1); }
          97%             { transform: scaleX(0.92); }
          98%             { transform: scaleX(1.02); }
          99%             { transform: scaleX(0.96); }
        }

        .flyer-outer {
          animation: flightArc 6400ms cubic-bezier(0.36, 0.05, 0.30, 0.98) forwards;
          will-change: transform;
        }
        .flyer-outer .flyer-inner {
          animation: wingFlutterActive 210ms ease-in-out infinite;
          transform-origin: center;
          will-change: transform;
        }
        /* Once landed, swap the fast flutter for the slow breath +
           very-occasional micro-flutter. Two animations on one element,
           combined via the browser's transform composition. */
        .flyer-outer[data-landed="true"] .flyer-inner {
          animation:
            wingBreath        6500ms ease-in-out infinite,
            wingMicroFlutter 11000ms ease-in-out infinite 4200ms;
        }

        /* Reduced motion: no flight, no flutter. The butterfly appears
           at the target position and the greeting fades in. */
        @media (prefers-reduced-motion: reduce) {
          .flyer-outer         { animation: none; transform: translate(var(--dx), var(--dy)); }
          .flyer-outer .flyer-inner { animation: none; }
        }
      `}</style>
    </div>
  );
}

// ─── Line of speech ─────────────────────────────────────────────────
//
// Each line fades in on its own beat so the text feels like it's being
// spoken, not pasted. The word rhythm matters here \u2014 do not merge
// these into one paragraph.

function LineOfSpeech({ text, visible }: { text: string; visible: boolean }) {
  return (
    <div
      style={{
        ...lineStyle,
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(4px)',
      }}
    >{text}</div>
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
  marginBottom: 32, flexWrap: 'wrap', gap: 10,
};

const fakeLogo: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 10,
  position: 'relative', padding: '4px 8px',
};

const butterflyStill: React.CSSProperties = {
  width: 40, height: 'auto', display: 'block',
};

const dirCtrl: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  fontSize: 13, color: '#334155', cursor: 'pointer',
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
  padding: '96px 40px 96px',
  textAlign: 'center',
  position: 'relative',
  minHeight: 360,
};

const targetSlot: React.CSSProperties = {
  width: 1, height: 1, margin: '0 auto',
};

const greetingStack: React.CSSProperties = {
  marginTop: 56,
  display: 'flex', flexDirection: 'column', gap: 8,
  alignItems: 'center',
};

const lineStyle: React.CSSProperties = {
  fontSize: 34, lineHeight: 1.25, fontWeight: 800,
  color: '#0A2540', letterSpacing: '-0.02em',
  transition: 'opacity 700ms cubic-bezier(0.4, 0, 0.2, 1), transform 700ms cubic-bezier(0.4, 0, 0.2, 1)',
};

const flyerWrap: React.CSSProperties = {
  position: 'fixed', zIndex: 10, pointerEvents: 'none',
  width: 48, height: 48,
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
