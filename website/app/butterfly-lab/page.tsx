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
//
// Garry's directives (Jul 2026):
//   1. Don't be afraid of silence. The pauses are on purpose.
//   2. Let the companion arrive BEFORE speaking. Arrive. Settle.
//      Notice you. Then speak.
//   3. Version B extends the sequence with a small smile and a
//      soft follow-up: "Would you like me to show you around?"

const T = {
  // Phase 1 \u2014 the butterfly notices someone.
  NOTICE_END:      600,
  // Phase 2 \u2014 lifts off. Hesitant. Almost changes its mind.
  LIFTOFF_END:     1600,
  // Phase 3 \u2014 drifts across, catches the air, wanders a little.
  DRIFT_END:       4600,
  // Phase 4 \u2014 approaches its landing. Slows into it.
  APPROACH_END:    5100,
  // Phase 5 \u2014 settles. Tiny final adjustment.
  SETTLE_END:      5500,
  // Phase 5b \u2014 arrived. Just being. A moment of stillness before
  //             even looking around. This is the "arrive before you
  //             speak" beat Garry asked for.
  ARRIVED_HOLD:    6000,
  // Phase 6 \u2014 looks around. Not eager. Considered.
  LOOK_END:        6900,
  // Phase 7 \u2014 EYE CONTACT. Held. Do not shorten.
  EYE_CONTACT_END: 8000,
  // Phase 8 \u2014 speaks. Audio first, text a beat behind.
  SAY_HELLO:       8000,
  TEXT_HELLO:      8250,
  SAY_NAME:        9100,
  SAY_CLOSING:    10500,
  // ── Version B only \u2014 the follow-up.
  // Comfortable pause after the closing line before doing anything.
  SMILE_START:    12800,   // a soft, small "smile" moment (wing shimmer + tiny lift)
  SMILE_END:      13600,
  ASK_SILENCE:    14400,   // another brief comfortable pause
  ASK_AUDIO:      14400,   // "Would you like me to show you around?"
  ASK_TEXT:       14650,
} as const;

// ─── Component ────────────────────────────────────────────────────────

export default function ButterflyLabPage() {
  const [runId, setRunId] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'noticing' | 'flying' | 'landed' | 'looked' | 'eye-contact' | 'greeting' | 'complete' | 'smiling' | 'asking'>('idle');
  const [textStage, setTextStage] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [audioOn, setAudioOn] = useState(true);
  const [companion, setCompanion] = useState<'george' | 'georgia'>('george');
  // Version A = original ending (just the three-line greeting).
  // Version B = adds a comfortable pause, a small smile, another
  //             comfortable pause, then a soft follow-up question.
  const [version, setVersion] = useState<'A' | 'B'>('A');
  // Destination model \u2014 what the butterfly is flying towards:
  //   'plate'   \u2014 lands at the top of a card, greeting fills the card
  //   'visitor' \u2014 lands at the geometric centre of the viewport,
  //               greeting grows beneath. The whole screen is the
  //               conversation space. Garry's brief: "the butterfly
  //               isn't flying to a destination on the interface \u2014
  //               it's flying to greet you."
  const [destination, setDestination] = useState<'plate' | 'visitor'>('visitor');
  // Smile visual state \u2014 toggled during the smile beat.
  const [smiling, setSmiling] = useState(false);

  // Anchor points \u2014 measured live from the DOM so it works at any width.
  const originRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const [geom, setGeom] = useState<{ dx: number; dy: number } | null>(null);

  // The audio elements. Three clips per companion \u2014 the first
  // "Hello.", the introduction, and (Version B only) the follow-up
  // "Would you like me to show you around?" so the beats between
  // sentences are OUR beats, not whatever OpenAI decided to space
  // them at.
  const helloAudioRef      = useRef<HTMLAudioElement | null>(null);
  const introAudioRef      = useRef<HTMLAudioElement | null>(null);
  const showAroundAudioRef = useRef<HTMLAudioElement | null>(null);

  const measure = useCallback(() => {
    const o = originRef.current?.getBoundingClientRect();
    if (!o) return;
    // Where is the butterfly heading?
    //   \u2022 'plate'   \u2014 top of the greeting card (targetRef).
    //   \u2022 'visitor' \u2014 the geometric centre of the visible viewport,
    //                 lifted a touch above true centre so there's
    //                 breathing room for the greeting to grow beneath.
    let targetX: number, targetY: number;
    if (destination === 'plate') {
      const t = targetRef.current?.getBoundingClientRect();
      if (!t) return;
      targetX = t.left + t.width / 2;
      targetY = t.top  + t.height/ 2;
    } else {
      targetX = window.innerWidth  / 2;
      targetY = window.innerHeight * 0.42;
    }
    setGeom({
      dx: targetX - (o.left + o.width / 2),
      dy: targetY - (o.top  + o.height/ 2),
    });
  }, [destination]);

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
    setSmiling(false);

    const timers: number[] = [];
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));

    // ── Shared shots (A + B).
    at(T.NOTICE_END,      () => setPhase('flying'));
    at(T.SETTLE_END,      () => setPhase('landed'));
    at(T.ARRIVED_HOLD,    () => { /* just holding, no state change */ });
    at(T.LOOK_END,        () => setPhase('looked'));
    at(T.LOOK_END + 100,  () => setPhase('eye-contact'));
    at(T.SAY_HELLO, () => {
      setPhase('greeting');
      if (audioOn && helloAudioRef.current) {
        helloAudioRef.current.currentTime = 0;
        helloAudioRef.current.play().catch(() => { /* autoplay blocked \u2014 silent */ });
      }
    });
    at(T.TEXT_HELLO,  () => setTextStage(1));
    at(T.SAY_NAME, () => {
      setTextStage(2);
      if (audioOn && introAudioRef.current) {
        introAudioRef.current.currentTime = 0;
        introAudioRef.current.play().catch(() => { /* silent */ });
      }
    });
    at(T.SAY_CLOSING,   () => setTextStage(3));
    at(T.SAY_CLOSING + 2200, () => setPhase('complete'));

    // ── Version B tail \u2014 pause, small smile, pause, soft question.
    if (version === 'B') {
      at(T.SMILE_START,      () => { setPhase('smiling'); setSmiling(true); });
      at(T.SMILE_END,        () => { setSmiling(false); });
      at(T.ASK_AUDIO, () => {
        setPhase('asking');
        if (audioOn && showAroundAudioRef.current) {
          showAroundAudioRef.current.currentTime = 0;
          showAroundAudioRef.current.play().catch(() => { /* silent */ });
        }
      });
      at(T.ASK_TEXT,         () => setTextStage(4));
    }

    return () => { timers.forEach(clearTimeout); };
  }, [runId, geom, audioOn, version]);

  const replay = () => {
    setPhase('idle');
    setTextStage(0);
    setSmiling(false);
    setGeom(null);
    // Stop any playing audio from the previous run.
    [helloAudioRef.current, introAudioRef.current, showAroundAudioRef.current]
      .forEach(a => { if (a) { a.pause(); a.currentTime = 0; } });
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
            <span style={{ opacity: 0.4 }}>|</span>
            <label style={dirCtrl}>
              <input type="radio" checked={destination === 'plate'}   onChange={() => setDestination('plate')}   /> To the plate
            </label>
            <label style={dirCtrl}>
              <input type="radio" checked={destination === 'visitor'} onChange={() => setDestination('visitor')} /> To the visitor
            </label>
            <span style={{ opacity: 0.4 }}>|</span>
            <label style={dirCtrl}>
              <input type="radio" checked={version === 'A'} onChange={() => setVersion('A')} /> A (greeting)
            </label>
            <label style={dirCtrl}>
              <input type="radio" checked={version === 'B'} onChange={() => setVersion('B')} /> B (+ smile &amp; question)
            </label>
            <span style={{ opacity: 0.4 }}>|</span>
            <label style={dirCtrl}>
              <input type="checkbox" checked={audioOn} onChange={e => setAudioOn(e.target.checked)} /> Sound
            </label>
            <button type="button" onClick={replay} style={replayBtn}>
              {phase === 'idle' ? 'Start' : 'Replay'}
            </button>
          </div>
        </div>

        {/* Landing plate \u2014 rendered only when the destination is
            the interface ('plate'). In 'visitor' mode the butterfly
            flies to the geometric centre of the viewport and the
            greeting grows beneath it, without a card frame. */}
        {destination === 'plate' && (
          <div style={plate}>
            <div ref={targetRef} style={targetSlot} aria-hidden />
            <div style={greetingStack}>
              <LineOfSpeech text="Hello."                                             visible={textStage >= 1} />
              <LineOfSpeech text={`I\u2019m ${companionName}.`}                       visible={textStage >= 2} />
              <LineOfSpeech text={'I\u2019m really pleased you found us.'}             visible={textStage >= 3} />
              {version === 'B' && (
                <div style={{ marginTop: 24 }}>
                  <LineOfSpeech
                    text={'Would you like me to show you around?'}
                    visible={textStage >= 4}
                    softer
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Visitor mode: greeting floats in the viewport, below where
            the butterfly landed. No card, no border, no chrome. The
            page IS the conversation space. */}
        {destination === 'visitor' && (
          <>
            <div style={visitorGreetingWrap} aria-live="polite">
              <div style={visitorGreetingStack}>
                <LineOfSpeech text="Hello."                                             visible={textStage >= 1} />
                <LineOfSpeech text={`I\u2019m ${companionName}.`}                       visible={textStage >= 2} />
                <LineOfSpeech text={'I\u2019m really pleased you found us.'}             visible={textStage >= 3} />
                {version === 'B' && (
                  <div style={{ marginTop: 20 }}>
                    <LineOfSpeech
                      text={'Would you like me to show you around?'}
                      visible={textStage >= 4}
                      softer
                    />
                  </div>
                )}
              </div>
            </div>
            {/* Spacer so the director's notes stay below the fold and
                don't clash with the butterfly's landing spot. Lab
                artefact only \u2014 won't exist in the real /meet page. */}
            <div style={{ height: '80vh' }} aria-hidden />
          </>
        )}

        {/* The butterfly overlay. Keyed on runId to restart cleanly. */}
        {geom && (
          <div
            key={runId}
            className={`flyer-outer${smiling ? ' flyer-smiling' : ''}`}
            data-landed={phase === 'landed' || phase === 'looked' || phase === 'eye-contact' || phase === 'greeting' || phase === 'complete' || phase === 'smiling' || phase === 'asking' ? 'true' : 'false'}
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
            {/* The soft "smile" glow \u2014 sits behind the butterfly during
                the smile beat only. Warm, soft, brief. */}
            <div className={`smile-glow${smiling ? ' on' : ''}`} aria-hidden />
            <div className="flyer-inner">
              <img src={brandAssets.butterfly.src} alt="" aria-hidden style={butterflyFlying} />
            </div>
          </div>
        )}

        {/* Audio \u2014 real Ash / Nova clips. Preload so the first "Hello."
            fires the instant the audio.play() call happens. */}
        <audio ref={helloAudioRef}      src={`/audio/hello-${companion}.mp3`}      preload="auto" />
        <audio ref={introAudioRef}      src={`/audio/intro-${companion}.mp3`}      preload="auto" />
        <audio ref={showAroundAudioRef} src={`/audio/showaround-${companion}.mp3`} preload="auto" />

        <div style={notesBox}>
          <div style={{ fontWeight: 800, marginBottom: 8, color: '#0A2540' }}>Director&rsquo;s notes</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.65, color: '#334155' }}>
            <li>
              <strong>To the plate</strong>: butterfly flies to a designated slot on the interface.
              Feels like the animation ends at a UI element.
            </li>
            <li>
              <strong>To the visitor</strong>: butterfly flies to the geometric centre of the viewport.
              Feels like someone walked over to greet you. The whole screen is the conversation space.
            </li>
            <li>Flight is longer, less deliberate. The butterfly hesitates, drifts, catches the air.</li>
            <li>Arrives, settles, then <strong>holds</strong> before looking around. Arrival is its own beat.</li>
            <li>Look left, look right, then <strong>pause</strong>. Eye contact is held for a full second.</li>
            <li>After landing, wings are never fully still &mdash; a slow &ldquo;breath&rdquo; loop is always running.</li>
            <li>Speech comes first (&ldquo;Hello.&rdquo;) &mdash; text follows a beat later.</li>
            <li>
              <strong>Version A</strong>: three-line greeting, then silence.<br />
              <strong>Version B</strong>: adds a comfortable pause &rarr; a soft smile &rarr; another pause
              &rarr; &ldquo;Would you like me to show you around?&rdquo;
            </li>
            <li>Full scene: Version A &asymp; 12s. Version B &asymp; 16s.</li>
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
          /* Phase 5b: Arrived hold. Just BEING at the destination, no
             rotation, no drift. This is the "arrive before you speak"
             beat \u2014 don't merge it into the look phase. */
          88%    { transform: translate(var(--dx), var(--dy)) rotate(0deg); }
          92%    { transform: translate(var(--dx), var(--dy)) rotate(0deg); }

          /* Phase 6: Look around. Not eager. Considered. */
          94.5%  { transform: translate(var(--dx), var(--dy)) rotate(-7deg); }
          97%    { transform: translate(var(--dx), var(--dy)) rotate(6deg); }
          99%    { transform: translate(var(--dx), var(--dy)) rotate(-1deg); }
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
          animation: flightArc 6900ms cubic-bezier(0.36, 0.05, 0.30, 0.98) forwards;
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

        /* The "smile" \u2014 a soft warm halo behind the butterfly for
           less than a second. Not an emoticon, not a wink. Just a
           quiet moment of warmth. Combined with a very gentle upward
           lift on the flyer itself so the whole butterfly seems to
           breathe in for a second. */
        .smile-glow {
          position: absolute; inset: -18px;
          border-radius: 50%;
          background: radial-gradient(circle at center,
            rgba(255, 209, 132, 0.55) 0%,
            rgba(255, 209, 132, 0.22) 45%,
            rgba(255, 209, 132, 0) 78%);
          opacity: 0;
          transform: scale(0.85);
          transition: opacity 900ms ease-in-out, transform 900ms ease-in-out;
          pointer-events: none;
          filter: blur(2px);
        }
        .smile-glow.on {
          opacity: 1;
          transform: scale(1);
        }
        /* A very small upward "breath" the butterfly does during the
           smile beat \u2014 layered on top of the breath animation via a
           CSS custom property translation. Kept tiny on purpose. */
        .flyer-outer.flyer-smiling {
          animation-play-state: paused; /* freeze the arc animation \u2014 already at destination */
          transform: translate(var(--dx), calc(var(--dy) - 2px)) rotate(0deg) !important;
          transition: transform 900ms cubic-bezier(0.4, 0, 0.2, 1);
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

function LineOfSpeech({ text, visible, softer }: { text: string; visible: boolean; softer?: boolean }) {
  return (
    <div
      style={{
        ...lineStyle,
        ...(softer ? softerLine : null),
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

// A slightly softer variant for the follow-up line so it reads as a
// separate thought spoken after a pause, not another headline stacked
// on top of the greeting.
const softerLine: React.CSSProperties = {
  fontSize: 24, fontWeight: 600, color: '#334155', letterSpacing: '-0.01em',
};

const flyerWrap: React.CSSProperties = {
  position: 'fixed', zIndex: 10, pointerEvents: 'none',
  width: 48, height: 48,
};

const butterflyFlying: React.CSSProperties = {
  width: '100%', height: 'auto', display: 'block',
};

// ── Visitor-mode layout ────────────────────────────────────────────
//
// When the destination is "the visitor" (not the interface), the
// greeting isn't in a card. It floats in the viewport, roughly
// beneath where the butterfly landed (~55% viewport height). The
// clean cream background does the work of "the room".

const visitorGreetingWrap: React.CSSProperties = {
  position: 'fixed',
  top: '55vh',
  left: 0,
  right: 0,
  display: 'flex', justifyContent: 'center',
  zIndex: 5,
  pointerEvents: 'none',   // greeting text is passive \u2014 the butterfly is the interaction
};
const visitorGreetingStack: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8,
  alignItems: 'center',
  maxWidth: 640,
  padding: '0 24px',
  textAlign: 'center',
};

const notesBox: React.CSSProperties = {
  maxWidth: 720, margin: '32px auto 0',
  padding: '16px 20px',
  background: '#F8FAFC', border: '1px solid #E2E8F0',
  borderRadius: 12,
};
