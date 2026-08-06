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
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  NOTICE_END:      500,   // butterfly stirs in the logo, notices someone
  LIFTOFF_END:    1300,   // clean lift-off, no hesitation
  DRIFT_END:      4400,   // arc across the room
  APPROACH_END:   5400,   // decelerates in
  SETTLE_END:     6000,   // touches down at target
  ARRIVED_HOLD:   6400,   // BEING at the destination. Do not speak yet.
  LOOK_END:       7200,   // considered look left/right
  EYE_CONTACT:    7900,   // held eye contact. Do not shorten.

  // ─── The three emotional moments (Garry, iter147, locked) ────────
  // The visitor has just chosen George or Georgia only seconds ago.
  // We do NOT re-introduce the host — that would repeat what they
  // already know. The chosen host speaks one warm greeting delivered
  // in three calm beats, then the "Come inside…" button appears.
  //
  //   Welcome.                                       ← SAY_WELCOME
  //   Hi… I'm so glad you found us.                  ← SAY_GLAD  (1.4s later)
  //   Come inside and let me show you around.        ← SAY_SHOW  (3.0s later)
  //   [Come inside…]                                 ← CTAS_APPEAR (3.8s later)
  //
  // The pauses after landing are DELIBERATELY BRIEF (0.8s between
  // landing and the first word) — Garry (iter147, feedback from
  // real-device testing): "There is too much blank time after
  // choosing. The butterfly should begin its movement much sooner
  // and the pauses should sit after meaningful moments, not before
  // anything happens."
  //
  // BUT — the pause BETWEEN "I'm so glad you found us." and
  // "Come inside and let me show you around." must be given room to
  // breathe. Garry (iter150): "It should feel as though George is
  // smiling at the visitor before warmly inviting them inside, not
  // reading one continuous sentence." The gladfound clip is ~1.7s
  // long, so SAY_SHOW must sit at least ~1.7s + a full held beat
  // (~1.3s) after SAY_GLAD. That places SAY_SHOW at 8200 + 3000 =
  // 11200ms. CTAS_APPEAR is then delayed so the button still lands
  // naturally ~1.4s AFTER the comeinside clip (~2.4s) has finished
  // playing — i.e. 11200 + 2400 + 1400 = 15000ms. Do not compress.
  //
  // Meet → Welcome → Begin. Each moment complete before the next.
  SAY_WELCOME:    6800,   // "Welcome."                       (0.8s after landing)
  SAY_GLAD:       8200,   // "Hi… I'm so glad you found us."  (1.4s later)
  SAY_SHOW:      11200,   // "Come inside and let me show you around." (3.0s later — held smile beat)
  CTAS_APPEAR:   15000,   // "Come inside…" button fades in — Begin (3.8s later, ~1.4s after comeinside clip ends)
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
  | 'complete'         // greeting fully delivered, CTAs visible
  | 'leading';         // visitor has accepted — butterfly is leading them into the site

// Next.js 14 static-render safety: `useSearchParams()` (used inside
// MeetPageContent below) requires a Suspense boundary or the build
// fails on the /meet page. Wrapping keeps this route statically
// pre-renderable while allowing the concierge handoff to read
// `?from=concierge` on the client.
export default function MeetPage() {
  return (
    <Suspense fallback={null}>
      <MeetPageContent />
    </Suspense>
  );
}

function MeetPageContent() {
  const { companion, choose, ready } = useCompanion();
  // "?from=concierge" — the visitor is arriving from the concierge
  // welcome overlay. The overlay has ALREADY brought the butterfly to
  // the centre of the screen, so /meet must not fly it in again. We
  // start directly at 'landed', suppress the flight animation, and
  // begin the greeting a beat later. This is the seamless handoff
  // Garry described (30 Jul 2026): "one continuous welcome — the
  // visitor should never feel like they've gone to another page."
  const searchParams = useSearchParams();
  const fromConcierge = searchParams?.get('from') === 'concierge';

  // Wait for hydration so SSR and first client render match — otherwise
  // React complains and the flight can start against the wrong DOM.
  //
  // /meet is the CHOICE moment. Every visit must show the choice
  // screen — even if the visitor previously picked George or Georgia
  // on an earlier visit and the choice is still in the companion
  // context. Garry (iter147): "The Meet moment is the visitor's
  // decision to invite a guide in. It is not a page they can be
  // routed past on a subsequent visit."
  //
  // The only route that skips the choice is the concierge overlay —
  // when a visitor picks their guide inside the overlay, `?from=
  // concierge` is passed and we start the greeting with the butterfly
  // already landed (the flight happened inside the overlay).
  const bootPhase: Phase = !ready
    ? 'idle'
    : (fromConcierge && companion)
      ? 'landed'
      : 'awaiting-choice';
  const [phase, setPhase] = useState<Phase>(bootPhase);
  const [textStage, setTextStage] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [runId, setRunId] = useState(0);

  // The butterfly lives in the FriendPlace logo. It always starts nestled
  // there and always leaves from there — for first-time visitors and
  // returning ones alike. Locked with Garry (Nov 2026): "It feels like
  // it leaves the logo to welcome the visitor."
  //
  // The choice cards still carry small butterfly marks as visual
  // representations of George and Georgia, but the actual entity is
  // the one nestled in the logo. There is one butterfly, and it comes
  // over when a visitor arrives.

  // Which companion did the visitor click just now, if any? We hold
  // this locally so the greeting can start immediately (with the right
  // voice) without waiting for CompanionContext to hydrate.
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
      invite: welcome.lines.invite,
    }),
    [welcome, effectiveCompanion],
  );

  // Geometry — measured live from the DOM so it works at any width /
  // any header layout. Origin = the butterfly inside the site header
  // (id="fp-brand-butterfly"). Target = ~42% viewport height, centred.
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const [geom, setGeom] = useState<{ dx: number; dy: number } | null>(null);

  // Stable geom setter — bails out if values are unchanged so React
  // effect deps don't fire on every re-measure. Prevents the
  // choreography restart loop on iPhone Safari that surfaced as
  // "Georgia restarts when I try to scroll" (Garry, iter146). Even
  // the CSS custom properties don't need to re-emit if the target
  // didn't move.
  const setGeomIfChanged = useCallback((next: { dx: number; dy: number }) => {
    setGeom(prev => {
      if (prev && prev.dx === next.dx && prev.dy === next.dy) return prev;
      return next;
    });
  }, []);
  const setOriginIfChanged = useCallback((next: { x: number; y: number }) => {
    setOrigin(prev => {
      if (prev && prev.x === next.x && prev.y === next.y) return prev;
      return next;
    });
  }, []);

  // Choreography guard — ensures the timeline runs EXACTLY ONCE per
  // (runId, fromConcierge) tuple. Without this, any downstream geom
  // update (from a re-measure, a StrictMode double-invoke, or an
  // iOS Safari visualViewport re-emit) would re-run the choreography
  // effect and reset the phase to 'noticing' mid-flight. This is the
  // true root cause of the iOS scroll-restarts-Georgia symptom Garry
  // reported at iter146. Locked with Garry (Aug 2026).
  const choreoStartedRunKeyRef = useRef<string | null>(null);
  // Timers must live in a ref (NOT in the effect closure) so a
  // React StrictMode double-invoke doesn't clear them between the
  // first run's cleanup and the second run's early-return. Without
  // this, the whole greeting timeline was silently cancelled in dev
  // (and — likely — in production too under React 18's aggressive
  // effect batching) so textStage never advanced past 0.
  const choreoTimersRef = useRef<number[]>([]);
  // Snapshot phase into a ref so the resize handler can read the
  // current phase without forcing the measure effect to re-run on
  // every phase transition (which was creating fresh geom objects
  // and cascading into the restart loop above).
  const phaseRef = useRef<Phase>(bootPhase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Audio elements — real Ash / Nova clips generated via OpenAI TTS
  // by /app/backend/scripts/generate_welcome_journey_audio.py. One
  // clip per beat per companion so the pauses between beats are OUR
  // pauses, not whatever the model decided to space them at.
  //
  // The three beats of the Welcome moment (Garry, iter147):
  //   welcome:     "Welcome."
  //   gladfound:   "Hi… I'm so glad you found us."
  //   comeinside:  "Come inside and let me show you around."
  const welcomeAudioRef    = useRef<HTMLAudioElement | null>(null);
  const gladfoundAudioRef  = useRef<HTMLAudioElement | null>(null);
  const comeInsideAudioRef = useRef<HTMLAudioElement | null>(null);
  // Audio consent — Safari (and Chrome, on some settings) will only
  // let us play audio after a user gesture. Choosing a companion IS
  // the gesture on first visit; for returning visitors any pointer
  // interaction on the page unlocks it. If autoplay actually gets
  // blocked we surface a warm "Hear George" affordance so the visitor
  // can catch the greeting.
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [audioConsent, setAudioConsent] = useState(false);
  const primedRef = useRef(false);

  /**
   * Prime the audio elements on a user gesture — Safari (and Chrome
   * with some settings) require a synchronous play() call within a
   * user-gesture event loop tick before any subsequent programmatic
   * play() is allowed. We start each element muted so the visitor
   * hears nothing during the unlock, then pause and unmute — the
   * elements are now "primed" for later timed play() calls to
   * actually make a sound.
   *
   * Safe to call multiple times; only the first call does the work.
   * All errors are swallowed silently — a failed unlock just means
   * the visitor sees the "Hear George" fallback instead.
   */
  const primeAudio = useCallback(() => {
    if (primedRef.current) return;
    primedRef.current = true;
    const els = [welcomeAudioRef.current, gladfoundAudioRef.current, comeInsideAudioRef.current];
    els.forEach((a) => {
      if (!a) return;
      try {
        a.muted = true;
        const p = a.play();
        if (p && typeof (p as Promise<void>).then === 'function') {
          (p as Promise<void>)
            .then(() => {
              try {
                a.pause();
                a.currentTime = 0;
                a.muted = false;
              } catch { /* silent */ }
            })
            .catch(() => {
              try { a.muted = false; } catch { /* silent */ }
            });
        }
      } catch { /* silent */ }
    });
  }, []);

  // Defensive: if the ConciergeOverlay was open on a previous route
  // and its scroll-lock cleanup didn't fire cleanly (rare, but seen
  // during hot-reloads and back/forward cache restores), `body.style
  // .overflow` can be left as 'hidden' — which on iOS Safari makes
  // /meet feel like the page won't scroll at all. Explicitly reset
  // it on mount so nothing further up the tree keeps us locked.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.body.style.overflow === 'hidden') {
      document.body.style.overflow = '';
    }
  }, []);

  // First user gesture anywhere on the page primes the audio. This
  // covers the returning-visitor case (no card click) — the moment
  // they scroll, tap or press a key, we unlock. In Safari this is
  // the ONLY reliable way to make later programmatic play() work.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onGesture = () => primeAudio();
    document.addEventListener('pointerdown', onGesture, { once: true, capture: true });
    document.addEventListener('keydown', onGesture, { once: true, capture: true });
    document.addEventListener('touchstart', onGesture, { once: true, capture: true });
    return () => {
      document.removeEventListener('pointerdown', onGesture, { capture: true } as any);
      document.removeEventListener('keydown', onGesture, { capture: true } as any);
      document.removeEventListener('touchstart', onGesture, { capture: true } as any);
    };
  }, [primeAudio]);

  /** Play an audio element defensively. Rejections are silenced,
   *  and if the browser blocked the play we surface the fallback.
   *  Never bubbles a media error to the console — Safari logs
   *  NotAllowedError even when the promise is caught, so we also
   *  temporarily set `muted` on failure to keep the element quiet
   *  and prevent it from cascading further errors. */
  const playSafely = useCallback((el: HTMLAudioElement | null) => {
    if (!el) return;
    try {
      el.currentTime = 0;
      const p = el.play();
      if (p && typeof (p as Promise<void>).then === 'function') {
        (p as Promise<void>).catch(() => {
          setAudioBlocked(true);
          try { el.muted = true; } catch { /* silent */ }
        });
      }
    } catch {
      setAudioBlocked(true);
    }
  }, []);

  // First-time visitors click a choice card — the butterfly stirs in
  // the logo, then leaves it and flies over. Both card butterflies
  // stay in place as visual "identity marks" for the two companions;
  // the actual flying butterfly is the one in the header logo.
  //
  // We call primeAudio() SYNCHRONOUSLY inside this click handler so
  // Safari treats it as a user gesture — that unlocks the audio
  // elements for the later programmatic play() calls in the
  // choreography timeline. Without this, Safari blocks the greeting
  // and Garry sees only the "Hear George" fallback.
  const onChooseFromCard = useCallback((id: CompanionId) => {
    primeAudio();
    setPendingCompanion(id);
    choose(id);
    setGeom(null);
    // Fresh choice = fresh choreography run.
    choreoStartedRunKeyRef.current = null;
    setTextStage(0);
    setPhase('idle');
  }, [choose, primeAudio]);

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

  // Measure the flight vector. Origin = the butterfly nestled in the
  // FriendPlace logo (SiteHeader gives it id="fp-brand-butterfly").
  // Target = the geometric centre of the viewport, lifted a touch
  // above true centre so there's breathing room for the greeting to
  // grow beneath it. Larger butterfly footprint (~15% up from the
  // previous 48px) — George/Georgia are the host of FriendPlace and
  // deserve a little more presence.
  const FLYER_SIZE = 55;
  const measure = useCallback(() => {
    if (typeof window === 'undefined') return;
    const targetX = window.innerWidth / 2;
    // Use the *visible* viewport height for the butterfly landing
    // point when available. On iOS Safari, `window.innerHeight`
    // reports the LARGE viewport (URL bar hidden state), which makes
    // the butterfly land ~55% down the visible viewport when the URL
    // bar is showing — pushing the greeting + primary CTA off the
    // bottom of the screen. visualViewport.height reflects the
    // ACTUAL visible viewport, so 42% of it puts the butterfly at a
    // consistent, comfortable position on every device.
    const viewportH = window.visualViewport?.height ?? window.innerHeight;
    // Butterfly landing height. On mobile the butterfly used to land
    // at 42% of the viewport, which visually overlapped the "Hello."
    // line of speech starting at 40svh (Garry, iter147). Moving the
    // landing point higher on narrow viewports gives the greeting
    // text room to breathe and reads much more cleanly. Desktop
    // keeps 42% because the composition is drawn for that.
    const isMobile = window.innerWidth < 720;
    const targetY = viewportH * (isMobile ? 0.30 : 0.42);

    // Arrival-from-concierge: butterfly is ALREADY at the target
    // position (the concierge overlay just brought it there). Set
    // origin = target and geom = {0,0} so the flyer renders at centre
    // with no motion. The flight animation is CSS-driven from
    // `--dx/--dy` translation, so 0/0 means "no flight."
    if (fromConcierge) {
      setOriginIfChanged({ x: targetX - FLYER_SIZE / 2, y: targetY - FLYER_SIZE / 2 });
      setGeomIfChanged({ dx: 0, dy: 0 });
      return;
    }

    // Standard flight origin — the FriendPlace logo butterfly in the
    // header. The visitor sees the butterfly leave the logo and
    // travel across the room to meet them.
    const el = document.getElementById('fp-brand-butterfly');
    if (!el) return;
    const r = el.getBoundingClientRect();
    const originX = r.left + r.width / 2;
    const originY = r.top + r.height / 2;
    setOriginIfChanged({ x: originX - FLYER_SIZE / 2, y: originY - FLYER_SIZE / 2 });
    setGeomIfChanged({ dx: targetX - originX, dy: targetY - originY });
  }, [fromConcierge, setGeomIfChanged, setOriginIfChanged]);

  const isAwaitingChoice = phase === 'awaiting-choice';

  useEffect(() => {
    if (isAwaitingChoice) return;
    //
    // CRITICAL: we intentionally do NOT depend on `phase` here. If we
    // did, every choreography transition (noticing → flying → landed
    // → …) would re-run this effect, re-schedule measure(), and even
    // with stable setters the churn cascades into iOS Safari
    // re-renders that made Georgia restart when the visitor tried to
    // scroll (Garry, iter146). We read the live phase via `phaseRef`
    // inside the resize handler instead so the effect subscribes to
    // (measure, runId) only and stays quiet during the timeline.
    //
    // Launch-blocker fix (iPhone Safari): the previous handler fired
    // on every `resize` event. On iOS Safari, scrolling collapses/
    // expands the URL bar and dispatches `resize` even though the
    // *width* hasn't changed. We now:
    //   (a) only re-measure when the *width* has actually changed,
    //   (b) freeze once the flight/greeting is under way,
    //   (c) prefer visualViewport when available for extra filtering.
    const t = window.setTimeout(measure, 30);
    let lastWidth = window.innerWidth;
    // Phases at or after which we STOP re-measuring — the butterfly
    // is already in flight or has landed, and the visitor is watching
    // or reading. Restarting the timeline would be jarring.
    const FROZEN_PHASES = new Set<Phase>([
      'flying', 'landed', 'looked', 'eye-contact', 'greeting', 'complete', 'leading',
    ]);
    const onResize = () => {
      const w = window.innerWidth;
      if (w === lastWidth) return;   // Safari URL-bar collapse — ignore
      lastWidth = w;
      if (FROZEN_PHASES.has(phaseRef.current)) return;   // don't restart mid-arrival
      measure();
    };
    window.addEventListener('resize', onResize);
    // Prefer the visualViewport when available — it filters out the
    // URL-bar animations on iOS Safari before they even reach us.
    window.visualViewport?.addEventListener?.('resize', onResize);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener?.('resize', onResize);
    };
  }, [measure, runId, isAwaitingChoice]);

  // The choreography timer. Runs once per (runId, fromConcierge).
  useEffect(() => {
    if (phase === 'awaiting-choice') return;
    if (!geom) return;

    // Choreography gate — guarantees the timeline runs exactly once
    // per (runId, fromConcierge). Even if `geom` re-emits (StrictMode
    // double-invoke, an iOS Safari re-measure, or any downstream
    // update), we do NOT reset the phase back to 'noticing' mid-
    // flight. This is the true root cause of the iPhone Safari
    // "Georgia restarts when I scroll" symptom (Garry, iter146).
    const runKey = `${runId}:${fromConcierge}`;
    if (choreoStartedRunKeyRef.current === runKey) return;
    choreoStartedRunKeyRef.current = runKey;

    // Clear any leftover timers from a previous run (e.g. after
    // `replay()` bumped runId). Do this only INSIDE the gate-passing
    // branch so a StrictMode double-invoke can't accidentally
    // cancel a healthy timeline.
    choreoTimersRef.current.forEach(clearTimeout);
    choreoTimersRef.current = [];

    // Arrival-from-concierge: butterfly is already at target. Skip
    // NOTICE → FLYING and start the "arrived, looking around, saying
    // hello" beats immediately, offset so the visitor gets ~1.4s of
    // stillness (breathing) before the greeting begins.
    const offset = fromConcierge ? -T.ARRIVED_HOLD : 0;

    if (!fromConcierge) {
      setPhase('noticing');
    }
    setTextStage(0);

    const at = (ms: number, fn: () => void) => {
      const delay = ms + offset;
      // Don't schedule timers that would fire "in the past" — they'd
      // fire immediately in a jarring flurry when arriving from concierge.
      if (delay < 0) return;
      choreoTimersRef.current.push(window.setTimeout(fn, delay));
    };

    if (!fromConcierge) {
      at(T.NOTICE_END,     () => setPhase('flying'));
      at(T.SETTLE_END,     () => setPhase('landed'));
    }
    at(T.LOOK_END,       () => setPhase('looked'));
    at(T.LOOK_END + 100, () => setPhase('eye-contact'));

    // ─── Welcome moment ────────────────────────────────────────────
    // The host has already been chosen. We do NOT re-introduce them
    // by name — the visitor knows exactly who they picked seconds
    // ago (Garry, iter147, locked). Instead the host simply arrives,
    // takes a breath, and welcomes the visitor with one warm
    // greeting delivered in three calm beats.
    //
    // Each spoken beat plays its matching Ash/Nova clip in perfect
    // sync with the on-screen text (Garry, iter147 P0). Silent
    // fallback if audio was blocked — the Hear-George link handles
    // recovery so the visitor never misses the greeting.
    at(T.SAY_WELCOME, () => {
      setPhase('greeting');
      setTextStage(1);
      playSafely(welcomeAudioRef.current);
    });
    at(T.SAY_GLAD, () => {
      setTextStage(2);
      playSafely(gladfoundAudioRef.current);
    });
    at(T.SAY_SHOW, () => {
      setTextStage(3);
      playSafely(comeInsideAudioRef.current);
    });

    // ─── Begin moment ──────────────────────────────────────────────
    // A considered pause after the invitation, then the "Come
    // inside…" button fades in on its own. The visitor now has time
    // to feel the welcome before being invited to step inside.
    at(T.CTAS_APPEAR, () => setPhase('complete'));

    // Flight #2 (Welcome \u2192 Tour) is triggered by the visitor
    // pressing the CTA \u2014 not automatically. The butterfly waits
    // for the visitor to say "yes, show me around." Locked with
    // Garry (1 Aug 2026): "This gives the visitor control over the
    // pace while preserving the butterfly's role as their guide."
    // See `NextSteps.onLead` \u2192 dispatches `friendplace:lead-to-tour`
    // which the LeadingButterfly component picks up.

    // NOTE: intentionally NO cleanup function returned. Cleanup for
    // real unmounts happens in the dedicated effect below. If we
    // returned a cleanup here, StrictMode's double-invoke would
    // cancel our own timers between run 1 and run 2 — which is
    // exactly what happened at iter146 and silently killed the
    // greeting (textStage never advanced past 0).
  }, [runId, geom, fromConcierge, phase === 'awaiting-choice']);

  // Dedicated unmount cleanup so timers don't outlive the page.
  useEffect(() => {
    return () => {
      choreoTimersRef.current.forEach(clearTimeout);
      choreoTimersRef.current = [];
    };
  }, []);

  // Re-run the choreography — used after "meet the other one" so the
  // new companion arrives freshly. Flies from the logo (as always).
  const replay = useCallback(() => {
    // Stop any playing audio from the previous run.
    [welcomeAudioRef.current, gladfoundAudioRef.current, comeInsideAudioRef.current].forEach(a => {
      if (a) { a.pause(); a.currentTime = 0; }
    });
    setPendingCompanion(null);
    setGeom(null);
    // Reset the choreography gate so the new run is allowed to
    // execute the timeline from scratch.
    choreoStartedRunKeyRef.current = null;
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
  //
  // The choice plate — "Come in. / Who would you like to show you
  // around today?" — is a permanent feature of the front door BUT
  // only for first-time visitors, and only up to the moment the
  // butterfly has landed. From landing onwards the middle of the
  // screen belongs to George: no competing plate, no visual clutter.
  // The choice plate must fade out the moment the visitor makes
  // their choice — otherwise it visually covers the butterfly's
  // flight and the whole "tap → butterfly responds" cause-and-effect
  // is invisible. Garry (iter147): "Tap George or Georgia, and
  // almost immediately the butterfly lifts off. The plate should
  // never be in the way of that response."
  //
  // 'idle' is the ~30-100ms bridge between the tap and the first
  // choreography frame — we keep the plate up during that brief
  // window so the choice feels acknowledged before it slides away.
  // From 'noticing' onward the butterfly is on stage and the plate
  // is out of the way.
  //
  // Kept mounted (opacity 0) rather than unmounted so the layout
  // height never jumps under the visitor's feet during the flight.
  const showPlate =
    phase === 'awaiting-choice' ||
    (pendingCompanion !== null && phase === 'idle');
  const choicePlateOpacity = showPlate ? 1 : 0;

  // Note (Dec 2026, locked with Garry): the FriendPlace logo remains
  // visually complete throughout the choreography. The butterfly in
  // the header is the brand mark; the character butterfly flying to
  // the visitor is a separate manifestation. Both coexist.

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
        className="meet-choice-outer"
        style={{
          ...choiceOuter,
          opacity: choicePlateOpacity,
          pointerEvents: phase === 'awaiting-choice' || phase === 'complete' ? 'auto' : 'none',
        }}
      >
          <div className="meet-choice-plate" style={choicePlate}>
            <img
              src={brandAssets.butterfly.src}
              alt=""
              aria-hidden
              className="meet-hero-butterfly"
              style={{ width: 110, height: 'auto', margin: '0 auto 20px', display: 'block' }}
            />
            <h1 className="meet-opening-line" style={openingLine}>Meet George or Georgia</h1>
            <p className="meet-lead-copy" style={leadCopy}>Who would you like to show you around today?</p>

            <div className="meet-choice-row" style={choiceRow}>
              <ChoiceCard companionId="george"  onChoose={onChooseFromCard} />
              <ChoiceCard companionId="georgia" onChoose={onChooseFromCard} />
            </div>

            <p className="meet-foot-note" style={footNote}>
              George and Georgia are the same person &mdash; same warmth, same
              honesty, same voice. Simply choose whichever feels right to you.
            </p>
          </div>
        </div>

      {/* Visitor-mode greeting stack — sits beneath where the butterfly
          lands. No card, no border. The page IS the conversation.
          Copy is data-driven from `getActiveWelcome()` so seasonal
          moments (Christmas, New Year, milestones) can flow through
          without touching the choreography. Four beats, on their own
          timing:
             1. "Hello."
             2. "I'm George / Georgia."
             3. "I'm really pleased you found us."
             4. "Come in\u2026 let me show you around."
          Beat 4 has no audio clip \u2014 the silence between it and
          beat 3 is the invitation. See PUBLIC_EXPERIENCE_PRINCIPLES.md
          \u2192 "The One Principle". */}
      <div
        className="meet-greeting-wrap"
        style={{
          ...greetingWrap,
          opacity: phase === 'leading' ? 0 : 1,
          transition: 'opacity 500ms ease',
        }}
        aria-live="polite"
      >
        <div style={greetingStack}>
          {/* ─── Welcome moment ─────────────────────────────────────
              One warm greeting delivered in three calm beats. The
              visitor knows who they picked — the host does not
              re-introduce themselves. Locked with Garry (iter147). */}
          <LineOfSpeech text="Welcome."                                        visible={textStage >= 1 && phase !== 'leading'} isLead />
          <LineOfSpeech text={'Hi\u2026 I\u2019m so glad you found us.'}       visible={textStage >= 2 && phase !== 'leading'} />
          <LineOfSpeech text="Come inside and let me show you around."         visible={textStage >= 3 && phase !== 'leading'} />
        </div>

        {/* CTAs — fade in only after the greeting is fully delivered
            and a comfortable pause has passed. Behind a site-mode
            switch so the launch transition is a one-line config flip,
            never a rewrite. The choreography above is IDENTICAL in
            both modes. */}
        <NextSteps phase={phase} onLead={() => {
          // The visitor said "yes, show me around." The butterfly
          // stops being the greeter and becomes the guide — it lifts
          // off, flies to the top of the screen, and lands in the
          // FriendPlace logo of the destination page. See
          // components/site/LeadingButterfly.tsx. Meanwhile /meet
          // itself fades everything except the flyer, so the visitor
          // only sees the butterfly leading them onward.
          setPhase('leading');
          window.dispatchEvent(new CustomEvent('friendplace:lead-to-tour', {
            detail: { destination: '/about' },
          }));
        }} />

        {/* Two small secondary options on the SAME row \u2014 kept
            visually quiet, always fitting on shorter viewports, and
            deliberately not styled as buttons. The row appears only
            after the greeting completes so it never competes with
            the arrival itself. Locked with Garry (Dec 2026): "The
            button was falling off the screen \u2014 give me one soft
            row instead of two stacked affordances." */}
        <div
          style={{
            ...meetOtherWrap,
            opacity: phase === 'complete' ? 1 : 0,
            transform: phase === 'complete' ? 'translateY(0)' : 'translateY(6px)',
            // Only interactive when actually visible — otherwise this
            // invisible row could intercept touches over the choice
            // cards on mobile viewports (iter146).
            pointerEvents: phase === 'complete' ? 'auto' : 'none',
            display: 'flex',
            gap: 14,
            alignItems: 'center',
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          {/* "Hear George again" (or "Would you like to hear George?"
              if autoplay was blocked). Same underlying handler as
              before \u2014 restarts the whole sequence in the same
              cadence as the timeline. */}
          <button
            type="button"
            onClick={() => {
              setAudioConsent(true);
              setAudioBlocked(false);
              const h = welcomeAudioRef.current;
              const i = gladfoundAudioRef.current;
              const v = comeInsideAudioRef.current;
              [h, i, v].forEach((a) => { if (a) a.muted = false; });
              // Replay the three-beat Welcome. Timings match the
              // choreography gaps (T.SAY_GLAD - T.SAY_WELCOME = 1.4s,
              // T.SAY_SHOW - T.SAY_GLAD = 3.0s — the held "smile beat"
              // that lets "…I'm so glad you found us." land before
              // "Come inside…" begins) so the replay lands at the
              // same cadence as the first hearing.
              playSafely(h);
              window.setTimeout(() => playSafely(i), 1400);
              window.setTimeout(() => playSafely(v), 4400);
            }}
            style={meetOtherBtn}
            aria-label={
              audioBlocked
                ? `Hear ${effectiveMeta.name} say hello`
                : `Hear ${effectiveMeta.name} again`
            }
          >
            {audioBlocked
              ? `Would you like to hear ${effectiveMeta.name}?`
              : `Hear ${effectiveMeta.name} again.`}
          </button>
          <span aria-hidden style={dotSep}>&middot;</span>
          <button type="button" onClick={meetOther} style={meetOtherBtn}>
            Actually, I&rsquo;d rather meet {effectiveCompanion === 'george' ? 'Georgia' : 'George'}.
          </button>
        </div>
      </div>

      {/* Old corner "hear George" pill removed — replaced by the
          inline invitation inside the greeting stack above, which
          feels less like an error banner and more like a natural
          next step for anyone whose browser silenced the audio. */}

      {/* The butterfly overlay. Positioned fixed so it can cross the
          site chrome. Keyed on runId so we always start fresh.
          Slightly larger (55px) than the earlier 48px — George and
          Georgia are the host of FriendPlace and deserve a touch
          more presence. */}
      {origin && geom && (
        <div
          key={`flyer-${runId}`}
          className="fp-flyer"
          data-landed={
            phase === 'landed' || phase === 'looked' || phase === 'eye-contact'
            || phase === 'greeting' || phase === 'complete' ? 'true' : 'false'
          }
          data-skip-flight={fromConcierge ? 'true' : 'false'}
          style={{
            ...flyerWrap,
            left: origin.x,
            top:  origin.y,
            ['--dx' as any]: `${geom.dx}px`,
            ['--dy' as any]: `${geom.dy}px`,
            // In the 'leading' phase, LeadingButterfly takes over from
            // the same position with the same butterfly. Fading this
            // one out ensures the visitor never sees two butterflies.
            opacity: phase === 'leading' ? 0 : 1,
            transition: 'opacity 200ms ease',
          }}
          aria-hidden
        >
          <div className="fp-flyer-inner">
            <img
              src={brandAssets.butterfly.src}
              alt=""
              style={{ width: 55, height: 'auto', display: 'block' }}
            />
          </div>
        </div>
      )}

      {/* Audio — real Ash / Nova clips. Sources come from the
          welcomes catalog + companion so seasonal welcomes can point
          at their own recordings. Keyed on companion+variant so
          switching either swaps the source cleanly. `preload="auto"`
          so the first play() call fires immediately with no wait.
          onError is a NO-OP by design: Safari (and some Chrome
          configurations) will log a red "1 error" to the console for
          any bubbled media error, even ones we've handled. We swallow
          them silently. If a seasonal clip is genuinely missing, the
          greeting simply lands as text on beat — no sound, no error.
          The visitor never sees a broken UI. */}
      <audio
        key={`welcome-${effectiveCompanion}`}
        ref={welcomeAudioRef}
        src={`/audio/welcome-${effectiveCompanion}.mp3`}
        preload="auto"
        onError={(e) => { try { e.stopPropagation(); } catch { /* silent */ } }}
      />
      <audio
        key={`gladfound-${effectiveCompanion}`}
        ref={gladfoundAudioRef}
        src={`/audio/gladfound-${effectiveCompanion}.mp3`}
        preload="auto"
        onError={(e) => { try { e.stopPropagation(); } catch { /* silent */ } }}
      />
      {/* Beat 3 audio — George/Georgia actually SAYING the invitation
          in the same Ash/Nova voice as the earlier lines. Generated
          server-side by
          /app/backend/scripts/generate_welcome_journey_audio.py
          and dropped into /public/audio/comeinside-{companion}.mp3.
          Locked with Garry (iter147). */}
      <audio
        key={`comeinside-${effectiveCompanion}`}
        ref={comeInsideAudioRef}
        src={`/audio/comeinside-${effectiveCompanion}.mp3`}
        preload="auto"
        onError={(e) => { try { e.stopPropagation(); } catch { /* silent */ } }}
      />

      <style dangerouslySetInnerHTML={{ __html: `
        /* ────────────────────────────────────────────────────────────
           FLIGHT CHOREOGRAPHY
           One keyframe animation for the whole arc. Path uses CSS
           custom properties --dx/--dy set on the element so the same
           keyframes work at any viewport width.

           Refined for a smoother, more PURPOSEFUL flight (Nov 2026):
           fewer keyframes, cleaner lateral motion, less zigzag. A real
           butterfly still catches the air a little — but it knows
           where it's going, and it takes George and Georgia to the
           middle of the room without dithering.
           ──────────────────────────────────────────────────────────── */
        @keyframes fpFlightArc {
          /* Immediate lift-off — the visitor's tap must be
             acknowledged visually within ~150ms. Garry (iter147):
             "The butterfly should begin its movement almost
             instantly. There shouldn't be a moment where the
             visitor wonders whether anything happened."
             The old 0→5% "breath forward" hover has been removed
             so the butterfly commits to the flight from the
             instant the flyer mounts (~30ms after the tap). */
          0%     { transform: translate(0px, 0px)   rotate(0deg); }
          2%     { transform: translate(0px, -12px) rotate(-3deg); }
          5%     { transform: translate(2px, -22px) rotate(-4deg); }
          10%    { transform: translate(6px, -30px) rotate(-3deg); }
          15%    { transform: translate(10px, -32px) rotate(-2deg); }

          /* Airborne. One gentle arc from lift-off to the visitor.
             Small rotation shifts keep it alive without making it
             feel like it's dodging obstacles. */
          28%    { transform: translate(calc(var(--dx) * 0.16), calc(var(--dy) * 0.10 - 34px)) rotate(-2deg); }
          44%    { transform: translate(calc(var(--dx) * 0.36), calc(var(--dy) * 0.30 - 32px)) rotate(1deg);  }
          60%    { transform: translate(calc(var(--dx) * 0.58), calc(var(--dy) * 0.55 - 24px)) rotate(-1deg); }
          74%    { transform: translate(calc(var(--dx) * 0.78), calc(var(--dy) * 0.78 - 12px)) rotate(1deg);  }

          /* Approach. Glides in — smooth deceleration, no overshoot. */
          85%    { transform: translate(calc(var(--dx) * 0.94), calc(var(--dy) * 0.96 - 2px))  rotate(0deg); }
          90%    { transform: translate(var(--dx), var(--dy)) rotate(0deg); }

          /* Arrived hold — do NOT merge with the look phase.
             This is the "arrive before you speak" beat. */
          93%    { transform: translate(var(--dx), var(--dy)) rotate(0deg); }

          /* Look around. Subtle. Considered. Not a swivel. */
          95.5%  { transform: translate(var(--dx), var(--dy)) rotate(-5deg); }
          97.5%  { transform: translate(var(--dx), var(--dy)) rotate(4deg);  }
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

        /* Very subtle wing "breath" for the butterfly nestled in the
           header logo — so it looks alive when a visitor arrives,
           not painted-on. Runs slower and smaller than the airborne
           flutter — a resting butterfly. NOTE (Dec 2026, locked with
           Garry): the logo butterfly is a permanent part of the
           FriendPlace brand mark. It stays visible AT ALL TIMES,
           even while the character butterfly is flying to greet the
           visitor. Think Disney logo + Tinkerbell: the castle stays
           whole, the fairy is a separate manifestation. Do not hide
           it during flight — that reads as a broken brand, not a
           metaphor. */
        @keyframes fpLogoBreath {
          0%, 100% { transform: scaleX(1)     scaleY(1); }
          50%      { transform: scaleX(0.985) scaleY(1.008); }
        }
        #fp-brand-butterfly {
          transform-origin: center;
          animation: fpLogoBreath 5200ms ease-in-out infinite;
        }

        .fp-flyer {
          animation: fpFlightArc 6600ms cubic-bezier(0.38, 0.02, 0.28, 1.0) forwards;
          will-change: transform;
        }
        /* Skip-flight: butterfly is already at the target position
           (arrived from the concierge overlay). No arc, no rotation
           translation — it simply IS there, breathing. The inner
           wing element still gets the landed-breath animation via
           data-landed="true" below. */
        .fp-flyer[data-skip-flight="true"] {
          animation: none;
          transform: translate(0, 0);
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
          #fp-brand-butterfly { animation: none; }
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

function NextSteps({ phase, onLead }: { phase: Phase; onLead: () => void }) {
  const mode = getSiteMode();
  const visible = phase === 'complete';
  const baseWrap: React.CSSProperties = {
    ...ctasWrap,
    opacity: phase === 'leading' ? 0 : visible ? 1 : 0,
    transform: visible ? 'translateY(0)' : 'translateY(6px)',
    pointerEvents: visible ? 'auto' : 'none',
    transition: 'opacity 500ms ease, transform 500ms ease',
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

  // Pre-launch — the default. One invitation, not two. George welcomes
  // the visitor and offers to show them around. No secondary "I have
  // a question" button — that role belongs to the small "Tap me if
  // you'd like to chat." butterfly on the tour pages. Locked with
  // Garry (Dec 2026): "one invitation, not a menu."
  //
  // The CTA is a button (not a Link) because tapping it doesn't just
  // navigate — it triggers the leading-butterfly flight which handles
  // the route change itself. See LeadingButterfly.tsx. Cmd/Ctrl-click
  // still opens /about in a new tab via the underlying anchor.
  return (
    <div style={baseWrap}>
      <a
        href="/about"
        style={primaryCta}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          onLead();
        }}
      >
        Come inside…
      </a>
    </div>
  );
}

// ─── Line of speech ─────────────────────────────────────────────────
//
// Each line fades in on its own beat so the text feels spoken, not
// pasted. Do not merge these into one paragraph.
//
// `isLead` marks the primary line of the moment (e.g. "Welcome.") —
// slightly larger and heavier so it lands with weight before the
// softer supporting line follows. Locked with Garry (iter147).

function LineOfSpeech({ text, visible, isLead = false }: { text: string; visible: boolean; isLead?: boolean }) {
  return (
    <div
      className={`meet-speech-line${isLead ? ' meet-speech-line--lead' : ''}`}
      style={{
        ...speechLine,
        ...(isLead ? { fontSize: 44, fontWeight: 900, marginBottom: 4 } : null),
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

function ChoiceCard({ companionId, onChoose }: {
  companionId: CompanionId;
  onChoose: (id: CompanionId) => void;
}) {
  const meta = COMPANIONS[companionId];
  return (
    <button
      type="button"
      onClick={e => {
        // Immediate tactile acknowledgement of the tap — the card
        // scales down for a heartbeat as the choice locks in. No
        // setTimeout gate: the button visual and onChoose fire in
        // the same tick so the butterfly's lift-off begins on the
        // very next frame. Garry (iter147): "The tap must be
        // recognised almost instantly."
        const btn = e.currentTarget as HTMLButtonElement;
        btn.style.transform = 'scale(0.96)';
        onChoose(companionId);
      }}
      className="meet-choice-card"
      style={choiceCard}
      aria-label={`Choose ${meta.name}`}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'; }}
    >
      {/* Small brand butterfly mark on the card. This is a visual
          "identity mark" for the companion \u2014 the actual butterfly
          entity lives in the FriendPlace logo and flies from there.
          Both card marks stay in place at all times. Sized ~15%
          larger than before so the host feels present. */}
      <img
        src={brandAssets.butterfly.src}
        alt=""
        aria-hidden
        style={{ width: 55, height: 'auto', display: 'block' }}
      />
      <span className="meet-choice-card-label" style={choiceName}>{meta.name}</span>
    </button>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────
//
// Community-centre feel: warm cream, generous space, gentle shadows.
// No hard corners. No gradients that shout. Motion is 240ms with a
// soft ease — the same pace as a hand opening a door.

const pageBg: React.CSSProperties = {
  // Full-viewport minHeight (rather than the earlier `100vh - 200px`)
  // so the site footer NEVER encroaches into the fixed greeting
  // stack. Locked with Garry (Dec 2026) after a shorter viewport
  // showed the greeting overlapping the "Because you belong too."
  // masthead. The 120px bottom padding gives the "Hear George again /
  // meet the other one" row breathing room below the primary CTA on
  // any reasonable screen size.
  minHeight: '100vh',
  paddingBottom: 120,
  // Deep FriendPlace navy — matches the concierge overlay's darkened
  // backdrop, so a visitor coming from the concierge sees ZERO visible
  // page change. The homepage fades away underneath the overlay and
  // this soft blue is what remains for the introduction. Locked with
  // Garry (30 Jul 2026): "One continuous welcome — the visitor should
  // never feel like they've gone to another page."
  background: '#0A2540',
  position: 'relative',
  // overflow-x only — vertical MUST scroll natively on mobile so the
  // ChoiceCards below the fold are reachable. The previous
  // `overflow: 'hidden'` was intended to clip the ambient glow but
  // was also swallowing vertical pan gestures on iPhone Safari (Garry,
  // launch-blocker iter145 — "attempting to scroll causes Georgia to
  // restart"). Trapping the vertical axis is what turned every scroll
  // into a resize/measure loop; the ambient glow only overflows
  // horizontally so we clip that axis alone.
  overflowX: 'hidden',
  // Explicitly permit vertical panning on touch devices so Safari
  // never treats the section as "no scroll here". This is redundant
  // with browsers' defaults but belt-and-braces on iOS where a bug
  // in older iOS versions can prevent panning when nested transforms
  // are present higher in the tree.
  touchAction: 'pan-y',
};

// The soft ambient glow behind the greeting. On the deep-navy stage
// it reads as a gentle cool-light halo — the atmosphere of the
// introduction, not a shape. Original warm-amber version was designed
// for the cream background and clashed with the navy world.
const ambientGlow: React.CSSProperties = {
  position: 'fixed',
  left: '50%',
  top: '42vh',
  width: 780,
  height: 780,
  transform: 'translate(-50%, -50%)',
  background: 'radial-gradient(circle at center, rgba(94, 234, 212, 0.14) 0%, rgba(94, 234, 212, 0.06) 40%, rgba(94, 234, 212, 0) 72%)',
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
  // On the navy stage the greeting sits in almost-white. A hair of
  // warmth ("#F5FBFF") keeps it from feeling clinical. Subtle glow
  // reinforces the "ambient light" feel of the room.
  color: '#F5FBFF', letterSpacing: '-0.02em',
  textShadow: '0 2px 20px rgba(94, 234, 212, 0.15)',
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
  background: 'rgba(94, 234, 212, 0.08)',
  color: '#5EEAD4',
  fontSize: 15, fontWeight: 700, textDecoration: 'none',
  border: '1.5px solid rgba(94, 234, 212, 0.4)',
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
  color: '#94A3B8',
  fontSize: 14,
  fontFamily: 'inherit',
  cursor: 'pointer',
  padding: '4px 8px',
  textDecoration: 'underline',
  textDecorationColor: 'rgba(148, 163, 184, 0.35)',
  textUnderlineOffset: 4,
};

const dotSep: React.CSSProperties = {
  color: '#64748B',
  fontSize: 14,
  userSelect: 'none',
};

// (inlineHearBtn removed \u2014 the "Hear George again" affordance
// now sits inline with "Actually, I'd rather meet Georgia." on a
// single row of secondary options, so nothing falls off the viewport
// on shorter screens.)

const flyerWrap: React.CSSProperties = {
  position: 'fixed', zIndex: 10, pointerEvents: 'none',
  width: 55, height: 55,
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
  // Tightened on narrow viewports so the George/Georgia choice cards
  // are visible without scrolling on standard iPhone widths (Garry,
  // launch-blocker iter145 — iPhone Safari testing). The earlier
  // 72px top padding pushed the cards below the fold on 390×750-ish
  // screens. The full 72px is preserved on ≥720px viewports via the
  // media query in globals.css.
  padding: '24px 20px 24px',
  // Fade out quickly the moment the visitor makes their choice so the
  // butterfly's flight is visible almost immediately — 400ms feels
  // responsive without being abrupt (Garry, iter147).
  transition: 'opacity 400ms cubic-bezier(0.4, 0, 0.2, 1)',
  willChange: 'opacity',
};

const choicePlate: React.CSSProperties = {
  maxWidth: 720, margin: '0 auto',
  background: '#FFFFFF',
  borderRadius: 24,
  border: '1px solid #F1E9DC',
  boxShadow: '0 10px 40px rgba(15,23,42,0.06)',
  // Compressed inner padding on narrow viewports (iter145). The
  // desktop-friendly 56/40/48 padding stays on ≥720px via the
  // media query — the compression is mobile-only.
  padding: '32px 20px 28px',
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
  color: '#F5FBFF', letterSpacing: '-0.01em',
};
