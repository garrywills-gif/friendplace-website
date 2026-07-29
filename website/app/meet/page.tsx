'use client';

/**
 * /meet — the centrepiece of FriendPlace.
 *
 * This is where the butterfly lives.
 *
 *   A visitor arrives. The butterfly, resting inside the FriendPlace
 *   logo up in the header, notices. It stirs, steps off the logo,
 *   drifts across the page, and settles at the middle of the screen
 *   — not on any button or box, but at the visitor themselves. It
 *   holds the moment. Then, in George's or Georgia's voice:
 *
 *      "Hello. I'm George. I'm really pleased you found us."
 *
 *   No play button. No permission dialog. If the browser blocks
 *   audio the words still land as text on their own beats. From the
 *   moment it lands the wings never fully still — the smallest
 *   breath, so it always looks alive.
 *
 * Locked with Garry (Jul 2026):
 *   • The butterfly flies to the visitor, not to a UI destination.
 *   • It arrives before it speaks — arrival is its own beat.
 *   • Speech first, text a beat behind.
 *   • Never rushed. The pauses ARE the experience.
 *   • Reduced-motion visitors get a single dignified fade.
 *
 * Read `/app/JOURNEY_CONTINUITY.md` + `/app/website/PUBLIC_EXPERIENCE_PRINCIPLES.md`
 * before touching. The north star:
 *
 *   > Does this make someone feel welcome?
 *
 * If any word or button reads like software or a form, it's the
 * wrong word. Rewrite it.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { brandAssets } from '@/lib/brand-assets';
import { useCompanion, COMPANIONS, type CompanionId } from '@/lib/companion-context';
import { getSiteMode, launchedFollowUp, storeLinks } from '@/lib/site-mode';
import { getActiveWelcome, resolveAudio } from '@/lib/welcomes';

// ─── Shot timing ─────────────────────────────────────────────────────
//
// Values in milliseconds. Unrushed on purpose — the whole scene runs
// ~10.5s before the closing line lands, plus another comfortable pause
// before the CTAs fade in. Think opening beat of a film, not a page
// loader. All timing MUST route through this table so shot notes can
// be adjusted in one place.

const T = {
  NOTICE_END:      600,   // butterfly softens in place, notices someone
  LIFTOFF_END:    1600,   // hesitant lift-off
  DRIFT_END:      4600,   // wanders across, catches the air
  APPROACH_END:   5100,   // decelerates
  SETTLE_END:     5500,   // settles — final micro-adjustment
  ARRIVED_HOLD:   6000,   // BEING at the destination. Do not speak yet.
  LOOK_END:       6900,   // considered look left/right
  EYE_CONTACT:    8000,   // held eye contact. Do not shorten.
  SAY_HELLO:      8000,   // audio: "Hello."
  TEXT_HELLO:     8250,   // text: "Hello."
  SAY_NAME:       9100,   // audio: "I'm George/Georgia."
  SAY_CLOSING:   10500,   // text: "I'm really pleased you found us."
  CTAS_APPEAR:   12800,   // comfortable pause, then the way forward
} as const;

// ─── Component ────────────────────────────────────────────────────────

type Phase =
  | 'awaiting-choice'  // no companion picked yet — show cards, no flight
  | 'idle'             // pre-flight, geometry not yet measured
  | 'noticing'         // butterfly stirs on its perch
  | 'flying'           // in the air
  | 'landed'           // touched down, wings breathing, silent
  | 'looked'           // has looked around
  | 'eye-contact'      // holding the visitor's gaze
  | 'greeting'         // has begun speaking
  | 'complete';        // greeting fully delivered, CTAs visible

/**
 * Where does the butterfly fly *from*?
 *
 *   'header'       — the FriendPlace butterfly in the site header.
 *                    Used for returning visitors who already have a
 *                    companion in localStorage.
 *   'george-card'  — the butterfly on the George choice card.
 *   'georgia-card' — the butterfly on the Georgia choice card.
 *
 * When a first-time visitor clicks a card, the butterfly literally
 * lifts off that card and flies over — the unchosen card stays
 * put with its butterfly still there, "smiling from its perch".
 */
type FlightOrigin = 'header' | 'george-card' | 'georgia-card';

export default function MeetPage() {
  const { companion, choose, ready } = useCompanion();

  // Wait for hydration so SSR and first client render match — otherwise
  // React complains and the flight can start against the wrong DOM.
  const bootPhase: Phase = !ready ? 'idle' : (companion ? 'idle' : 'awaiting-choice');
  const [phase, setPhase] = useState<Phase>(bootPhase);
  const [textStage, setTextStage] = useState<0 | 1 | 2 | 3>(0);
  const [runId, setRunId] = useState(0);

  // Which butterfly is doing the flying? Returning visitors get the
  // header logo as the origin (arrival from "the front door"). First
  // visitors get the card they clicked — the chosen butterfly LITERALLY
  // lifts off that card and comes over. The unchosen card stays.
  const [flightOrigin, setFlightOrigin] = useState<FlightOrigin>('header');

  // Which companion did the visitor click just now, if any? We hold
  // this locally until the butterfly is airborne so the choice plate
  // can stay visible during lift-off (Georgia keeps smiling on her
  // card while George flies over). The persistent choice is committed
  // to context/localStorage the moment the visitor clicks — this
  // separate state only drives the transient UI states.
  const [pendingCompanion, setPendingCompanion] = useState<CompanionId | null>(null);

  // Effective companion for the greeting. If the visitor hasn't chosen
  // one yet (deep link, or "meet the other one" affordance), we default
  // to George so the automatic greeting can still play naturally
  // — matches Garry's directive: "George or Georgia should simply
  // greet visitors naturally".
  const effectiveCompanion: CompanionId = companion || pendingCompanion || 'george';
  const effectiveMeta = COMPANIONS[effectiveCompanion];

  // Living homepage — pick the active welcome variant (default,
  // Christmas, New Year, milestone, etc.) once per mount. See
  // `/app/website/lib/welcomes.ts` and the "Living Homepage" section
  // of PUBLIC_EXPERIENCE_PRINCIPLES.md. `useMemo` locks it in so a
  // date change mid-session (crossing midnight) doesn't swap the
  // words halfway through a greeting.
  const welcome = useMemo(() => getActiveWelcome(), []);
  const audioSrcs = useMemo(
    () => resolveAudio(welcome, effectiveCompanion),
    [welcome, effectiveCompanion],
  );
  const speechLines = useMemo(
    () => ({
      hello: welcome.lines.hello,
      name: welcome.lines.name(effectiveCompanion),
      closing: welcome.lines.closing,
    }),
    [welcome, effectiveCompanion],
  );

  // Geometry — measured live from the DOM so it works at any width /
  // any header layout. Origin = the butterfly inside the site header
  // (id="fp-brand-butterfly"). Target = ~42% viewport height, centred.
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const [geom, setGeom] = useState<{ dx: number; dy: number } | null>(null);

  // Audio elements — real Ash / Nova clips. Preloaded so the "Hello."
  // fires the instant we call play(). We keep three separate clips
  // per companion so the beats between sentences are OUR beats, not
  // whatever OpenAI decided to space them at.
  const helloAudioRef = useRef<HTMLAudioElement | null>(null);
  const introAudioRef = useRef<HTMLAudioElement | null>(null);
  // Audio consent — modern browsers will only let us play audio after
  // a user gesture. Choosing a companion IS the gesture on first visit;
  // for returning visitors we surface a soft "Play greeting" affordance
  // only if the autoplay actually got blocked.
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [audioConsent, setAudioConsent] = useState(false);

  // First-time visitors click a choice card — the butterfly on that
  // card lifts off and comes over. Georgia stays smiling on her card,
  // and vice versa. Committing the choice to storage happens right
  // away (so if they refresh mid-flight nothing is lost), but the
  // transient `pendingCompanion` + `flightOrigin` states are what
  // drive the visual "flies off THIS card" moment. The measure effect
  // will re-fire because `flightOrigin` is in `measure`'s useCallback
  // dependency list — no manual setTimeout(measure) required.
  const onChooseFromCard = useCallback((id: CompanionId) => {
    setPendingCompanion(id);
    setFlightOrigin(id === 'george' ? 'george-card' : 'georgia-card');
    choose(id);
    setGeom(null);
    setTextStage(0);
    setPhase('idle');
  }, [choose]);

  // Sync phase with hydration + companion changes.
  useEffect(() => {
    if (!ready) return;
    if (!companion) {
      setPhase('awaiting-choice');
    }
    // NOTE: we intentionally do NOT auto-advance out of awaiting-choice
    // when a companion is chosen — that is driven by onChooseFromCard
    // which needs to synchronise the flightOrigin + measure() timing.
    // Depending on `phase` here would cause the choreography to reset
    // on every phase transition.
  }, [ready, companion]);

  // Measure the flight vector. The origin element depends on
  // `flightOrigin`:
  //   • 'header'       → id="fp-brand-butterfly" in the site header.
  //   • 'george-card'  → id="fp-choice-btf-george"  on the choice card.
  //   • 'georgia-card' → id="fp-choice-btf-georgia" on the choice card.
  // Target = the geometric centre of the viewport, lifted a touch
  // above true centre so there's breathing room for the greeting.
  const measure = useCallback(() => {
    if (typeof window === 'undefined') return;
    const originElId =
      flightOrigin === 'george-card'  ? 'fp-choice-btf-george'  :
      flightOrigin === 'georgia-card' ? 'fp-choice-btf-georgia' :
                                        'fp-brand-butterfly';
    const el = document.getElementById(originElId);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const originX = r.left + r.width / 2;
    const originY = r.top + r.height / 2;
    const targetX = window.innerWidth / 2;
    const targetY = window.innerHeight * 0.42;
    setOrigin({ x: originX - 24, y: originY - 24 }); // -24 for 48px flyer half-size
    setGeom({ dx: targetX - originX, dy: targetY - originY });
  }, [flightOrigin]);

  useEffect(() => {
    if (phase === 'awaiting-choice') return;
    // Measure once after mount + on resize. Deliberately does NOT
    // depend on `phase` — otherwise every state transition inside
    // the choreography would re-measure and reset the timeline.
    const t = window.setTimeout(measure, 30);
    window.addEventListener('resize', measure);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('resize', measure);
    };
  }, [measure, runId, phase === 'awaiting-choice']);

  // The choreography timer. Runs once per (runId, geom).
  useEffect(() => {
    if (phase === 'awaiting-choice') return;
    if (!geom) return;

    setPhase('noticing');
    setTextStage(0);

    const timers: number[] = [];
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));

    at(T.NOTICE_END,     () => setPhase('flying'));
    at(T.SETTLE_END,     () => setPhase('landed'));
    at(T.LOOK_END,       () => setPhase('looked'));
    at(T.LOOK_END + 100, () => setPhase('eye-contact'));
    at(T.SAY_HELLO, () => {
      setPhase('greeting');
      const el = helloAudioRef.current;
      if (el) {
        el.currentTime = 0;
        el.play().catch(() => {
          // Autoplay blocked — the visitor will still see the text on
          // its intended beats. We surface a small "play greeting"
          // affordance so they can hear it if they'd like.
          setAudioBlocked(true);
        });
      }
    });
    at(T.TEXT_HELLO, () => setTextStage(1));
    at(T.SAY_NAME, () => {
      setTextStage(2);
      const el = introAudioRef.current;
      if (el) {
        el.currentTime = 0;
        el.play().catch(() => { setAudioBlocked(true); });
      }
    });
    at(T.SAY_CLOSING,    () => setTextStage(3));
    at(T.CTAS_APPEAR,    () => setPhase('complete'));

    return () => { timers.forEach(clearTimeout); };
  }, [runId, geom, phase === 'awaiting-choice']);

  // Re-run the choreography — used after "meet the other one" so the
  // new companion arrives freshly. Flies from the header this time
  // (the choice cards are gone by now).
  const replay = useCallback(() => {
    // Stop any playing audio from the previous run.
    [helloAudioRef.current, introAudioRef.current].forEach(a => {
      if (a) { a.pause(); a.currentTime = 0; }
    });
    setFlightOrigin('header');
    setPendingCompanion(null);
    setGeom(null);
    setPhase('idle');
    setTextStage(0);
    setRunId(r => r + 1);
  }, []);

  // "Meet the other one" — swap companion and restart the sequence.
  const meetOther = useCallback(() => {
    const other: CompanionId = effectiveCompanion === 'george' ? 'georgia' : 'george';
    choose(other);
    // The audio elements are keyed on companion (see JSX below), so a
    // remount happens automatically. We just need to re-run.
    replay();
  }, [effectiveCompanion, choose, replay]);

  // Compute derived UI signals for the render.
  // The choice plate stays MOUNTED for every phase — even after the
  // butterfly has flown and the greeting is speaking — because the
  // "Come in. / Who would you like to show you around today?" moment
  // is a permanent feature of the front door (locked with Garry,
  // Nov 2026: "Come in. deserves to stay forever"). We fade its
  // opacity down while the butterfly speaks so the greeting has the
  // stage, then fade it back in once the greeting is complete so
  // returning visitors (or someone who scrolled away and back) see
  // the invitation again.
  const choicePlateOpacity =
    (phase === 'landed' || phase === 'looked' || phase === 'eye-contact'
     || phase === 'greeting') ? 0
     : phase === 'complete' ? 1
     : 1;

  // The chosen card's butterfly image is hidden the moment we
  // transition out of awaiting-choice, so the visitor sees the
  // butterfly literally lift off THAT card. It comes back once the
  // sequence is fully complete so the card looks whole again.
  const chosenCardBtfHidden = phase !== 'awaiting-choice' && phase !== 'complete';
  const georgeCardBtfHidden  = chosenCardBtfHidden && flightOrigin === 'george-card';
  const georgiaCardBtfHidden = chosenCardBtfHidden && flightOrigin === 'georgia-card';

  return (
    <div style={pageBg}>
      {/* Ambient wash under the greeting — a very soft warm glow so
          the middle of the screen feels like a lit spot in the room,
          not an empty page. Purely decorative, aria-hidden. */}
      <div style={ambientGlow} aria-hidden />

      {/* Choice plate — "Come in. Who would you like to show you
          around today?" — is a PERMANENT feature of the front door,
          not a pre-launch step. It stays mounted through every phase
          so (a) the layout height never jumps under the visitor's
          feet, and (b) the invitation is right there again the
          moment the greeting completes. Locked with Garry (Nov 2026):
          "Come in. deserves to stay forever." */}
      <div
        style={{
          ...choiceOuter,
          opacity: choicePlateOpacity,
          pointerEvents: phase === 'awaiting-choice' || phase === 'complete' ? 'auto' : 'none',
        }}
      >
          <div style={choicePlate}>
            <img
              src={brandAssets.butterfly.src}
              alt=""
              aria-hidden
              style={{ width: 96, height: 'auto', margin: '0 auto 20px', display: 'block' }}
            />
            <h1 style={openingLine}>Come in.</h1>
            <p style={leadCopy}>Who would you like to show you around today?</p>

            <div style={choiceRow}>
              <ChoiceCard
                companionId="george"
                onChoose={onChooseFromCard}
                butterflyHidden={georgeCardBtfHidden}
              />
              <ChoiceCard
                companionId="georgia"
                onChoose={onChooseFromCard}
                butterflyHidden={georgiaCardBtfHidden}
              />
            </div>

            <p style={footNote}>
              George and Georgia are the same person &mdash; same warmth, same
              honesty, same voice. The choice is simply what feels right to you.
            </p>
          </div>
        </div>

      {/* Visitor-mode greeting stack — sits beneath where the butterfly
          lands. No card, no border. The page IS the conversation.
          Copy is data-driven from `getActiveWelcome()` so seasonal
          moments (Christmas, New Year, milestones) can flow through
          without touching the choreography. */}
      <div style={greetingWrap} aria-live="polite">
        <div style={greetingStack}>
          <LineOfSpeech text={speechLines.hello}   visible={textStage >= 1} />
          <LineOfSpeech text={speechLines.name}    visible={textStage >= 2} />
          <LineOfSpeech text={speechLines.closing} visible={textStage >= 3} />
        </div>

        {/* CTAs — fade in only after the greeting is fully delivered
            and a comfortable pause has passed. Behind a site-mode
            switch so the launch transition is a one-line config flip,
            never a rewrite. The choreography above is IDENTICAL in
            both modes. */}
        <NextSteps phase={phase} />

        {/* Soft "meet the other one" affordance — very small, no
            competing colour. Only shown after the greeting completes
            so it doesn't distract from the arrival itself. */}
        <div
          style={{
            ...meetOtherWrap,
            opacity: phase === 'complete' ? 1 : 0,
            transform: phase === 'complete' ? 'translateY(0)' : 'translateY(6px)',
          }}
        >
          <button type="button" onClick={meetOther} style={meetOtherBtn}>
            Actually, I&rsquo;d rather meet {effectiveCompanion === 'george' ? 'Georgia' : 'George'}.
          </button>
        </div>
      </div>

      {/* Small "play greeting" affordance — only shown if the browser
          silenced our audio. Never pushed at the visitor; sits quietly
          in a corner for anyone who notices they didn't hear anything. */}
      {audioBlocked && !audioConsent && (
        <button
          type="button"
          onClick={() => {
            setAudioConsent(true);
            setAudioBlocked(false);
            const h = helloAudioRef.current;
            const i = introAudioRef.current;
            if (h) { h.currentTime = 0; h.play().catch(() => {}); }
            // Fire the intro clip on the same natural cadence as the
            // scripted timing (~1.1s after "Hello.").
            window.setTimeout(() => {
              if (i) { i.currentTime = 0; i.play().catch(() => {}); }
            }, 1100);
          }}
          style={playGreetingBtn}
          aria-label={`Play ${effectiveMeta.name}\u2019s greeting`}
        >
          <span style={{ marginRight: 6 }} aria-hidden>&#9654;</span>
          Hear {effectiveMeta.name}
        </button>
      )}

      {/* The butterfly overlay. Positioned fixed so it can cross the
          site chrome. Keyed on runId so we always start fresh. */}
      {origin && geom && (
        <div
          key={`flyer-${runId}`}
          className="fp-flyer"
          data-landed={
            phase === 'landed' || phase === 'looked' || phase === 'eye-contact'
            || phase === 'greeting' || phase === 'complete' ? 'true' : 'false'
          }
          style={{
            ...flyerWrap,
            left: origin.x,
            top:  origin.y,
            ['--dx' as any]: `${geom.dx}px`,
            ['--dy' as any]: `${geom.dy}px`,
          }}
          aria-hidden
        >
          <div className="fp-flyer-inner">
            <img
              src={brandAssets.butterfly.src}
              alt=""
              style={{ width: 48, height: 'auto', display: 'block' }}
            />
          </div>
        </div>
      )}

      {/* Audio — real Ash / Nova clips. Sources come from the
          welcomes catalog + companion so seasonal welcomes can point
          at their own recordings. Keyed on companion+variant so
          switching either swaps the source cleanly. `preload="auto"`
          so the first play() call fires immediately with no wait.
          `onError` handler: if a seasonal clip 404s (e.g. the mp3
          hasn't been recorded yet), we silently fall back to the
          permanent /audio/{hello|intro}-{companion}.mp3 so the
          greeting never dies mid-sentence. */}
      <audio
        key={`hello-${effectiveCompanion}-${welcome.id}`}
        ref={helloAudioRef}
        src={audioSrcs.hello}
        preload="auto"
        onError={(e) => {
          const el = e.currentTarget;
          const fallback = `/audio/hello-${effectiveCompanion}.mp3`;
          if (el.src !== fallback && !el.src.endsWith(fallback)) el.src = fallback;
        }}
      />
      <audio
        key={`intro-${effectiveCompanion}-${welcome.id}`}
        ref={introAudioRef}
        src={audioSrcs.intro}
        preload="auto"
        onError={(e) => {
          const el = e.currentTarget;
          const fallback = `/audio/intro-${effectiveCompanion}.mp3`;
          if (el.src !== fallback && !el.src.endsWith(fallback)) el.src = fallback;
        }}
      />

      <style dangerouslySetInnerHTML={{ __html: `
        /* ────────────────────────────────────────────────────────────
           FLIGHT CHOREOGRAPHY
           One keyframe animation for the whole arc — easier to reason
           about than chaining transitions, and hardware-composed.
           The path uses CSS custom properties --dx/--dy set on the
           element so the same keyframes work at any viewport width.
           ──────────────────────────────────────────────────────────── */
        @keyframes fpFlightArc {
          /* Notice. Wings do NOT flap harder — just a heartbeat. */
          0%     { transform: translate(0px, 0px)  rotate(0deg); }
          6.5%   { transform: translate(0px, -3px) rotate(-2deg); }
          9.4%   { transform: translate(0px, -1px) rotate(-1deg); }

          /* Lift-off. Hesitant. Rises, drifts a little, thinks about it. */
          12%    { transform: translate(-4px, -14px) rotate(-6deg); }
          17%    { transform: translate(-6px, -22px) rotate(-4deg); }
          20%    { transform: translate(-2px, -30px) rotate(-8deg); }
          25%    { transform: translate(6px,  -34px) rotate(-6deg); }

          /* Drift. Wanders. Doesn't head straight to the target. Small
             negative dx offsets create the "catches the air" feel — a
             butterfly does not fly in straight lines. */
          30%    { transform: translate(calc(var(--dx) * 0.10 - 4px), calc(var(--dy) * 0.05 - 40px)) rotate(-3deg); }
          38%    { transform: translate(calc(var(--dx) * 0.24 + 6px), calc(var(--dy) * 0.12 - 52px)) rotate(2deg);  }
          46%    { transform: translate(calc(var(--dx) * 0.36 - 2px), calc(var(--dy) * 0.24 - 60px)) rotate(-4deg); }
          52%    { transform: translate(calc(var(--dx) * 0.42 + 8px), calc(var(--dy) * 0.34 - 58px)) rotate(1deg);  }
          58%    { transform: translate(calc(var(--dx) * 0.50 - 4px), calc(var(--dy) * 0.46 - 52px)) rotate(-2deg); }
          64%    { transform: translate(calc(var(--dx) * 0.60 + 4px), calc(var(--dy) * 0.58 - 44px)) rotate(3deg);  }
          70%    { transform: translate(calc(var(--dx) * 0.72 - 2px), calc(var(--dy) * 0.70 - 34px)) rotate(-1deg); }

          /* Approach. Decelerates. Small overshoot to feel like a
             landing, not a stop. */
          78%    { transform: translate(calc(var(--dx) * 0.88), calc(var(--dy) * 0.86 - 18px)) rotate(2deg);  }
          82%    { transform: translate(calc(var(--dx) * 0.96), calc(var(--dy) * 0.95 - 6px))  rotate(1deg);  }
          84%    { transform: translate(calc(var(--dx) * 1.02), calc(var(--dy) * 1.02 + 2px))  rotate(-1deg); }

          /* Settle. Micro-adjustment. */
          86%    { transform: translate(var(--dx), calc(var(--dy) + 1px)) rotate(0deg); }
          /* Arrived hold — do NOT merge with the look phase.
             This is the "arrive before you speak" beat. */
          88%    { transform: translate(var(--dx), var(--dy)) rotate(0deg); }
          92%    { transform: translate(var(--dx), var(--dy)) rotate(0deg); }

          /* Look around. Not eager. Considered. */
          94.5%  { transform: translate(var(--dx), var(--dy)) rotate(-7deg); }
          97%    { transform: translate(var(--dx), var(--dy)) rotate(6deg);  }
          99%    { transform: translate(var(--dx), var(--dy)) rotate(-1deg); }
          100%   { transform: translate(var(--dx), var(--dy)) rotate(0deg);  }
        }

        /* Wing flutter DURING flight — fast, small, slightly irregular. */
        @keyframes fpWingFlutter {
          0%,100% { transform: scaleX(1); }
          38%     { transform: scaleX(0.82); }
          62%     { transform: scaleX(1.03); }
        }

        /* Wing "breath" AFTER landing — slow, imperceptible, always on.
           Real butterflies are never fully still. */
        @keyframes fpWingBreath {
          0%,100% { transform: scaleX(1)     scaleY(1); }
          30%     { transform: scaleX(0.985) scaleY(1.005); }
          62%     { transform: scaleX(1.008) scaleY(0.995); }
        }
        /* Occasional micro-flutter — layered on top of the breath so
           the wing motion never feels perfectly periodic. */
        @keyframes fpWingMicroFlutter {
          0%, 96%, 100% { transform: scaleX(1); }
          97%           { transform: scaleX(0.92); }
          98%           { transform: scaleX(1.02); }
          99%           { transform: scaleX(0.96); }
        }

        .fp-flyer {
          animation: fpFlightArc 6900ms cubic-bezier(0.36, 0.05, 0.30, 0.98) forwards;
          will-change: transform;
        }
        .fp-flyer .fp-flyer-inner {
          animation: fpWingFlutter 210ms ease-in-out infinite;
          transform-origin: center;
          will-change: transform;
        }
        .fp-flyer[data-landed="true"] .fp-flyer-inner {
          animation:
            fpWingBreath        6500ms ease-in-out infinite,
            fpWingMicroFlutter 11000ms ease-in-out infinite 4200ms;
        }

        /* Reduced motion — no flight, no flutter. The butterfly appears
           at the target position and the greeting fades in on the same
           beats. Dignity for everyone. */
        @media (prefers-reduced-motion: reduce) {
          .fp-flyer         { animation: none; transform: translate(var(--dx), var(--dy)); }
          .fp-flyer .fp-flyer-inner { animation: none; }
        }
      ` }} />
    </div>
  );
}

// ─── Next steps (mode-aware CTAs) ────────────────────────────────────
//
// The "next step" changes between pre-launch and launched, but the
// arrival, the pause and the greeting above are IDENTICAL. This is
// the only piece of `/meet` that knows about site mode — the
// choreography must never know.
//
//   pre-launch  →  "I'd like to know more" / "I have a question"
//   launched    →  "FriendPlace is ready now." + store buttons
//
// Read `/app/website/PUBLIC_EXPERIENCE_PRINCIPLES.md#the-permanent-front-door`
// before changing anything here.

function NextSteps({ phase }: { phase: Phase }) {
  const mode = getSiteMode();
  const visible = phase === 'complete';
  const baseWrap: React.CSSProperties = {
    ...ctasWrap,
    opacity: visible ? 1 : 0,
    transform: visible ? 'translateY(0)' : 'translateY(6px)',
    pointerEvents: visible ? 'auto' : 'none',
  };

  if (mode === 'launched') {
    const followUp = launchedFollowUp();
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
        {/* Spoken-in-voice bridge to the download. Fades in on the
            same beat as the CTAs so it reads as "the same
            conversation continuing", not a marketing panel. */}
        <div
          style={{
            ...launchedFollowUpWrap,
            opacity: visible ? 1 : 0,
            transform: visible ? 'translateY(0)' : 'translateY(6px)',
          }}
        >
          <div style={launchedLine1}>{followUp.line1}</div>
        </div>
        <div style={baseWrap}>
          {storeLinks.apple && (
            <a href={storeLinks.apple} style={primaryCta} rel="noopener noreferrer">
              &#63743;&nbsp;&nbsp;Download on the App Store
            </a>
          )}
          {storeLinks.google && (
            <a href={storeLinks.google} style={secondaryCta} rel="noopener noreferrer">
              &#9654;&nbsp;&nbsp;Get it on Google Play
            </a>
          )}
          <Link href="/download" style={secondaryCta}>
            &#x1F4F1;&nbsp;&nbsp;Scan the QR code
          </Link>
        </div>
      </div>
    );
  }

  // Pre-launch — the default.
  return (
    <div style={baseWrap}>
      <Link href="/register-interest" style={primaryCta}>
        I&rsquo;d like to know more
      </Link>
      <Link href="/contact" style={secondaryCta}>
        I have a question
      </Link>
    </div>
  );
}

// ─── Line of speech ─────────────────────────────────────────────────
//
// Each line fades in on its own beat so the text feels spoken, not
// pasted. Do not merge these into one paragraph.

function LineOfSpeech({ text, visible }: { text: string; visible: boolean }) {
  return (
    <div
      style={{
        ...speechLine,
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(4px)',
      }}
    >{text}</div>
  );
}

// ─── Choice card ─────────────────────────────────────────────────────
//
// The "Come in. Who would you like to show you around today?" plate
// is now rendered inline in MeetPage so the flying butterfly and the
// choice cards can share the same viewport during lift-off. This
// helper renders one card. See the parent for the full plate.

function ChoiceCard({ companionId, onChoose, butterflyHidden }: {
  companionId: CompanionId;
  onChoose: (id: CompanionId) => void;
  butterflyHidden?: boolean;
}) {
  const meta = COMPANIONS[companionId];
  return (
    <button
      type="button"
      onClick={() => onChoose(companionId)}
      style={choiceCard}
      aria-label={`Choose ${meta.name}`}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'; }}
    >
      {/* Brand butterfly on the card. The id lets the /meet
          choreography measure its position so, on click, the flying
          butterfly can lift off THIS card — not a generic corner.
          When the flight starts we hide this img via `opacity:0` so
          the visitor sees the butterfly leave the card. The
          unchosen card is untouched — Georgia keeps smiling. */}
      <img
        id={`fp-choice-btf-${companionId}`}
        src={brandAssets.butterfly.src}
        alt=""
        aria-hidden
        style={{
          width: 48, height: 'auto', display: 'block',
          opacity: butterflyHidden ? 0 : 1,
          transition: 'opacity 240ms ease',
        }}
      />
      <span style={choiceName}>{meta.name}</span>
    </button>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────
//
// Community-centre feel: warm cream, generous space, gentle shadows.
// No hard corners. No gradients that shout. Motion is 240ms with a
// soft ease — the same pace as a hand opening a door.

const pageBg: React.CSSProperties = {
  minHeight: 'calc(100vh - 200px)',
  background: '#FEFCF8',
  position: 'relative',
  overflow: 'hidden',
};

// The soft warm glow behind the greeting. Deliberately huge and blurred
// so it reads as ambient lighting, not a shape.
const ambientGlow: React.CSSProperties = {
  position: 'fixed',
  left: '50%',
  top: '42vh',
  width: 720,
  height: 720,
  transform: 'translate(-50%, -50%)',
  background: 'radial-gradient(circle at center, rgba(255, 209, 132, 0.18) 0%, rgba(255, 209, 132, 0.08) 40%, rgba(255, 209, 132, 0) 72%)',
  filter: 'blur(6px)',
  pointerEvents: 'none',
  zIndex: 0,
};

// The greeting stack sits fixed at ~55vh so it lands under the butterfly.
const greetingWrap: React.CSSProperties = {
  position: 'fixed',
  top: '55vh',
  left: 0,
  right: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 24,
  zIndex: 5,
  pointerEvents: 'none', // pass-through — only interactive children set pointer-events
  padding: '0 24px',
};

const greetingStack: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  alignItems: 'center',
  maxWidth: 640,
  textAlign: 'center',
};

const speechLine: React.CSSProperties = {
  fontSize: 34, lineHeight: 1.25, fontWeight: 800,
  color: '#0A2540', letterSpacing: '-0.02em',
  transition: 'opacity 700ms cubic-bezier(0.4, 0, 0.2, 1), transform 700ms cubic-bezier(0.4, 0, 0.2, 1)',
};

const ctasWrap: React.CSSProperties = {
  display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center',
  marginTop: 24,
  transition: 'opacity 900ms ease, transform 900ms ease',
  pointerEvents: 'auto',
};

const primaryCta: React.CSSProperties = {
  display: 'inline-block',
  padding: '14px 26px',
  background: 'linear-gradient(135deg,#14B8A6,#0EA5A0)',
  color: '#FFFFFF',
  fontSize: 15, fontWeight: 800, textDecoration: 'none',
  borderRadius: 12,
  boxShadow: '0 6px 20px rgba(20,184,166,0.28)',
};

const secondaryCta: React.CSSProperties = {
  display: 'inline-block',
  padding: '14px 26px',
  background: '#FFFFFF',
  color: '#0F766E',
  fontSize: 15, fontWeight: 700, textDecoration: 'none',
  border: '1.5px solid #99F6E4',
  borderRadius: 12,
};

const meetOtherWrap: React.CSSProperties = {
  marginTop: 4,
  transition: 'opacity 900ms ease, transform 900ms ease',
  pointerEvents: 'auto',
};

const meetOtherBtn: React.CSSProperties = {
  background: 'transparent',
  border: 0,
  color: '#64748B',
  fontSize: 14,
  fontFamily: 'inherit',
  cursor: 'pointer',
  padding: '4px 8px',
  textDecoration: 'underline',
  textDecorationColor: 'rgba(100, 116, 139, 0.35)',
  textUnderlineOffset: 4,
};

const playGreetingBtn: React.CSSProperties = {
  position: 'fixed',
  right: 24, bottom: 24,
  padding: '10px 16px',
  background: '#FFFFFF',
  color: '#0F766E',
  border: '1.5px solid #99F6E4',
  borderRadius: 999,
  fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
  cursor: 'pointer',
  boxShadow: '0 6px 18px rgba(15, 23, 42, 0.10)',
  zIndex: 20,
};

const flyerWrap: React.CSSProperties = {
  position: 'fixed', zIndex: 10, pointerEvents: 'none',
  width: 48, height: 48,
};

// ── Choice scene styles ──

// ── Choice plate styles ──
//
// The choice plate sits centred at the top-ish of the page while the
// butterfly is being chosen, and fades out gracefully during flight.
// `choiceOuter` handles the outer positioning + fade transition;
// `choicePlate` is the cream card itself.

const choiceOuter: React.CSSProperties = {
  position: 'relative',
  zIndex: 3,
  maxWidth: 720,
  margin: '0 auto',
  padding: '72px 24px 24px',
  transition: 'opacity 1200ms cubic-bezier(0.4, 0, 0.2, 1)',
  willChange: 'opacity',
};

const choicePlate: React.CSSProperties = {
  maxWidth: 720, margin: '0 auto',
  background: '#FFFFFF',
  borderRadius: 24,
  border: '1px solid #F1E9DC',
  boxShadow: '0 10px 40px rgba(15,23,42,0.06)',
  padding: '56px 40px 48px',
  textAlign: 'center',
};

const openingLine: React.CSSProperties = {
  fontSize: 40, lineHeight: 1.15, fontWeight: 800,
  color: '#0A2540', margin: '0 0 16px', letterSpacing: '-0.02em',
};

const leadCopy: React.CSSProperties = {
  fontSize: 19, lineHeight: 1.55, color: '#334155',
  margin: '0 auto 32px', maxWidth: 520,
};

const choiceRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'center', gap: 20,
  flexWrap: 'wrap', margin: '4px 0 24px',
};

const choiceCard: React.CSSProperties = {
  display: 'inline-flex', flexDirection: 'column', alignItems: 'center',
  gap: 12,
  padding: '24px 28px', minWidth: 180,
  background: '#F0FDFA',
  border: '1.5px solid #99F6E4',
  borderRadius: 20,
  cursor: 'pointer',
  fontFamily: 'inherit',
  transition: 'transform 200ms ease, box-shadow 200ms ease, background 200ms ease',
};

const choiceName: React.CSSProperties = {
  fontSize: 20, fontWeight: 800, color: '#0F766E',
  letterSpacing: '-0.01em',
};

const footNote: React.CSSProperties = {
  fontSize: 14, color: '#64748B',
  margin: '24px auto 0', maxWidth: 480, lineHeight: 1.55,
};

// ── Launched-mode follow-up bridge ──
// Only visible once NEXT_PUBLIC_FRIENDPLACE_SITE_MODE === 'launched'.
// Sits between the three-line greeting and the download buttons so the
// transition reads as "the same conversation, continuing" rather than
// a marketing panel switching on.

const launchedFollowUpWrap: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  alignItems: 'center',
  maxWidth: 620,
  textAlign: 'center',
  transition: 'opacity 900ms ease, transform 900ms ease',
};

const launchedLine1: React.CSSProperties = {
  fontSize: 22, lineHeight: 1.35, fontWeight: 700,
  color: '#0A2540', letterSpacing: '-0.01em',
};
