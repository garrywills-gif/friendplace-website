import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  StyleSheet, Pressable, Modal, Dimensions, Platform,
} from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withSequence, withRepeat,
  Easing, runOnJS,
} from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { GeorgeButterflyMark } from './GeorgeButterflyMark';
import { GeorgeWelcomeBubble } from './GeorgeWelcomeBubble';
import { GeorgeOnboarding } from './GeorgeOnboarding';
import { GeorgeEventCreation } from './GeorgeEventCreation';
import { useGeorge } from '@/src/lib/george-context';
import { georgeApi, type Presence } from '@/src/lib/george-api';

/**
 * George's butterfly on FriendPlace mobile.
 *
 * The signature interaction. Mount this once, on the Home screen, and
 * it will handle:
 *   - The arrival animation (once per calendar day per actor, or on
 *     first meeting).
 *   - The first-time introduction (never re-shown).
 *   - Returning greetings with name personalisation and continuity.
 *   - The persistent resting butterfly in the top-right corner near the
 *     FriendPlace logo (per Garry's B5 beta feedback #1 — "George should
 *     live near the logo, as though he lives there").
 *   - Tap → tiny flutter → chat sheet (Slice B3 will replace the
 *     placeholder sheet with the full shared conversation).
 *
 * Reads from `/api/mcgs/george/presence` and calls
 * `/api/mcgs/george/introduced` after any introduction acknowledgement.
 * All state that survives app restart lives server-side; only the
 * daily-arrival gate uses AsyncStorage.
 */

const STORAGE_KEY = 'george.lastArrival';

// ---- Session-level greeting gate --------------------------------------
// Locked with Garry 1 Aug 2026 as a permanent behaviour principle:
//   "George welcomes members when they arrive, not every time they
//    navigate."
// Module-level singleton so the flag survives every GeorgeButterfly
// unmount/remount cycle within the same app process. The flag resets
// only when the app is fully killed and relaunched — which is what a
// "session" is for the member. Never persisted to storage, deliberately,
// so a real cold-start greets George once again. This is DIFFERENT
// from the daily gate (`STORAGE_KEY` above) — the daily gate limits
// arrivals to once per calendar day even across app restarts, and
// this session gate limits them to once per app process on top.
let _sessionGreetingConsumed = false;
/** For tests only — resets the module-level session flag. */
export function _resetSessionGreetingForTests() {
  _sessionGreetingConsumed = false;
}
const DAYS_ABSENCE_FOR_WARM_WELCOME = 3;
// Bubble persistence (Garry, 8 Aug 2026 — TestFlight iter143, "the
// Welcome Back is behaving like a toast"). The greeting bubble is
// George's front door: a conversation card, not a notification. It
// stays on screen until the member CHOOSES [Chat to George] or
// [Dismiss / Not now]. No auto-fade, first-meeting or returning.
// This supersedes the 1 Aug 2026 "let it auto-dismiss after a few
// seconds" direction after real-device testing showed the auto-fade
// making the Welcome Back feel like a transient notification instead
// of George genuinely being there to welcome the member back.

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

type Phase = 'idle' | 'arriving' | 'landed' | 'resting' | 'intro';

export function GeorgeButterfly() {
  const insets = useSafeAreaInsets();
  const { landedFrom, consumeLanded, currentScreen, openRequested, currentPathname } = useGeorge();
  const [phase, setPhase] = useState<Phase>('idle');
  const [, setPresence] = useState<Presence | null>(null);
  const [greeting, setGreeting] = useState<string | null>(null);
  const [showBubble, setShowBubble] = useState(false);
  const [showChat, setShowChat] = useState(false);
  // Milestone B5 — event creation & its (now inline) celebration.
  const [showEvent, setShowEvent] = useState(false);
  const [resumeSessionId, setResumeSessionId] = useState<string | null>(null);

  // ---- Reanimated values -------------------------------------------------
  // Position of the butterfly relative to the bottom-right corner.
  // `x` and `y` are offsets from the resting spot; 0/0 = resting.
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const opacity = useSharedValue(0);
  const rotate = useSharedValue(0);
  const wingFlap = useSharedValue(1);          // horizontal scale of the wings
  const idleBreathe = useSharedValue(1);       // small resting scale

  const bubbleOpacity = useSharedValue(0);
  const bubbleTranslate = useSharedValue(8);

  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // First-meeting persistence gate (Garry, 4 Aug 2026 TestFlight polish):
  //   On a member's very first introduction to George, the welcome
  //   bubble MUST stay visible until the member chooses either
  //   "Dismiss" (tap ✕) or "Chat with George" (tap the butterfly). We
  //   never auto-fade the introduction — first impressions matter.
  //   All subsequent visits keep the standard 3.2s auto-fade so the
  //   bubble stays a warm hello, not a lingering panel.
  //
  // Uses a ref (not state) because the value is read inside effect
  // callbacks that shouldn't re-run when it flips.
  const isFirstMeetingRef = useRef<boolean>(false);

  // ---- Boot: fetch presence + decide what to do --------------------------
  useEffect(() => {
    let cancelled = false;
    async function boot() {
      // Session gate — see `_sessionGreetingConsumed` above.
      // Once George has said hello this app session, he stays quietly
      // perched no matter how many times this component mounts (e.g.
      // brief butterflyVisible toggles during navigation, warm reload
      // of the tab layout, etc.). Cold-start resets the flag.
      if (_sessionGreetingConsumed) {
        setPhase('resting');
        opacity.value = 1;
        return;
      }

      let pres: Presence | null = null;
      try { pres = await georgeApi.presence(); }
      catch { /* silent — he'll just say a generic hello */ }
      if (cancelled) return;
      setPresence(pres);

      const gate = await shouldArriveToday(pres?.actor_id || 'anonymous');
      const firstMeeting = !!pres?.first_meeting;
      isFirstMeetingRef.current = firstMeeting;

      // First meeting always plays; otherwise honour the daily gate.
      if (!firstMeeting && !gate.allowed) {
        // Land straight into the resting state without an animation.
        setPhase('resting');
        opacity.value = 1;
        // Consume the session flag anyway — subsequent mounts today
        // shouldn't even hit the presence fetch. Belt and braces.
        _sessionGreetingConsumed = true;
        return;
      }

      // Start the arrival.
      setPhase('arriving');
      // Consume the "just onboarded" hint at boot-time so George
      // slips in a mention of Georgia on his very first returning
      // greeting. The flag is one-shot — we clear it as soon as we
      // read it so subsequent sessions get the normal rotation.
      let georgiaHint = false;
      try {
        const flag = await AsyncStorage.getItem(GEORGIA_HINT_FLAG);
        if (flag) {
          georgiaHint = true;
          await AsyncStorage.removeItem(GEORGIA_HINT_FLAG);
        }
      } catch { /* non-fatal */ }
      playArrival(() => {
        if (cancelled) return;
        // First-meeting used to open the dedicated "Hi, I'm George"
        // modal — that's gone now (Garry, 23 Jul 2026). George
        // introduces himself in the onboarding wizard instead, so on
        // his very first appearance here he plays the standard
        // returning-greeting flow and settles into his resting spot.
        setPhase('landed');
        setGreeting(pickReturningGreeting(pres, gate.warmWelcome, georgiaHint));
        setShowBubble(true);
        // Consume the session flag ONLY once George has actually
        // arrived + greeted. If arrival was skipped (daily gate above)
        // the flag is already set; if the whole boot failed silently
        // it will retry on the next mount — which is what we want.
        _sessionGreetingConsumed = true;
      });
      await markArrivedToday(pres?.actor_id || 'anonymous');
    }
    void boot();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Flutter-in on George-led navigation (C1 Slice 3 v3) --------------
  // When the "Take me to X" chip fires, `landedFrom` is set to the
  // destination screen key. The moment the member lands on that screen,
  // George plays a distinct arrival animation so it feels like he
  // travelled there with them. Only triggers once per landing; never
  // on manual navigation or re-renders.
  //
  // Design (Garry, 22 July 2026 v3): starts well above the header
  // (offscreen top), curves in from top-right, wings flap the whole
  // way, settles in the header. Total ~900ms so it's noticeable but
  // doesn't block the page.
  useEffect(() => {
    if (!landedFrom) return;
    if (currentScreen !== landedFrom) return; // wait until we're actually on the destination
    // Slice 3 v6 (Garry, 22 July 2026): more visible arc. George
    // flutters in from the direction of the FriendPlace logo /
    // just off-screen top-left, arcs across, and settles into the
    // header spot. ~1s total so the animation reads as an arrival
    // rather than a pop-in.
    const startX = -(insets.top + 200); // well off-screen to the LEFT
    const startY = -(insets.top + 180); // and above
    x.value = startX;
    y.value = startY;
    opacity.value = 0;
    rotate.value = -8;

    // Wings flapping steadily during the entire flight.
    wingFlap.value = withRepeat(
      withSequence(
        withTiming(0.72, { duration: 140, easing: Easing.inOut(Easing.quad) }),
        withTiming(1,    { duration: 140, easing: Easing.inOut(Easing.quad) }),
      ),
      7, // ~2s of flapping, tapers off with the withTiming to rest below
      false,
    );

    // Fade in during the first third of the flight.
    opacity.value = withTiming(1, { duration: 400, easing: Easing.out(Easing.quad) });

    // Arc: sweep across (X moves from left-offscreen to right-of-rest,
    // then settles) and dip (Y moves from above to below-rest, then
    // settles up). Two-phase timing gives the visible curve.
    x.value = withSequence(
      withTiming(28,  { duration: 720, easing: Easing.inOut(Easing.cubic) }),
      withTiming(0,   { duration: 320, easing: Easing.out(Easing.cubic) }),
    );
    y.value = withSequence(
      withTiming(18,  { duration: 720, easing: Easing.inOut(Easing.cubic) }),
      withTiming(0,   { duration: 320, easing: Easing.out(Easing.cubic) }),
    );
    rotate.value = withSequence(
      withTiming(6,  { duration: 560, easing: Easing.inOut(Easing.cubic) }),
      withTiming(0,  { duration: 480, easing: Easing.out(Easing.cubic) }, (finished) => {
        if (finished) {
          wingFlap.value = withTiming(1, { duration: 240 });
        }
      }),
    );

    // Clear the flag once the animation has fully completed so it
    // never replays on re-renders or subsequent manual navigation.
    const t = setTimeout(() => consumeLanded(), 1150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landedFrom, currentScreen]);

  // ---- Arrival animation ------------------------------------------------
  // We move from the top-right edge (offscreen) down to the bottom-right
  // corner. Values are offsets from the resting spot: negative x = to the
  // left of resting; negative y = above resting.
  const playArrival = useCallback((onDone: () => void) => {
    const restX = 0;
    const restY = 0;
    // Start offscreen top-right (~a butterfly's-width to the right of the
    // resting spot, and ~SCREEN_H away above it).
    const startX = 60;
    const startY = -(SCREEN_H - insets.top - 120);

    x.value = startX;
    y.value = startY;
    opacity.value = 0;
    rotate.value = 8;

    // Wing flap during flight — fast, subtle horizontal squash.
    wingFlap.value = withRepeat(
      withSequence(
        withTiming(0.72, { duration: 230, easing: Easing.inOut(Easing.quad) }),
        withTiming(1,    { duration: 230, easing: Easing.inOut(Easing.quad) }),
      ),
      -1, false,
    );

    opacity.value = withTiming(1, { duration: 600 });

    // Two-phase glide: sweep down-and-left, then settle. A cubic-bezier
    // approximation via chained withTiming.
    x.value = withSequence(
      withTiming(-30, { duration: 1800, easing: Easing.inOut(Easing.cubic) }),
      withTiming(restX,  { duration: 1500, easing: Easing.out(Easing.cubic) }),
    );
    y.value = withSequence(
      withTiming(-(SCREEN_H * 0.35), { duration: 1800, easing: Easing.inOut(Easing.cubic) }),
      withTiming(restY, { duration: 1500, easing: Easing.out(Easing.cubic) }),
    );
    rotate.value = withSequence(
      withTiming(-6, { duration: 1400 }),
      withTiming(2,  { duration: 900 }),
      withTiming(0,  { duration: 700, easing: Easing.out(Easing.cubic) },
        (finished) => {
          if (finished) {
            // Stop the flight-flap; start the ambient breathe.
            wingFlap.value = withTiming(1, { duration: 240 });
            idleBreathe.value = withRepeat(
              withSequence(
                withTiming(1.04, { duration: 2000, easing: Easing.inOut(Easing.quad) }),
                withTiming(1,    { duration: 2000, easing: Easing.inOut(Easing.quad) }),
              ),
              -1, false,
            );
            runOnJS(onDone)();
          }
        },
      ),
    );
  }, [x, y, opacity, rotate, wingFlap, idleBreathe, insets.top]);

  // ---- Bubble bloom (persistent — no auto-fade) -------------------------
  //
  // The bubble is George's front door: the first thing a returning
  // member sees when the app opens. It's a conversation card, not a
  // notification. It stays on screen until the member chooses one of
  // the affordances that dismiss it:
  //   • [Chat to George]     — tap the butterfly or the CTA
  //   • [Dismiss / Not now]  — tap the ✕, tap-away, or the CTA
  //
  // TestFlight iter143 (Garry, 8 Aug 2026 — "the Welcome Back is
  // behaving like a toast"): the bubble previously auto-faded after
  // ~3.2 seconds for RETURNING members (first-meeting was already
  // persistent). That regressed the Welcome Back to a transient
  // notification — members reported it flashing up and disappearing
  // before they could read it. Fixed by removing the auto-fade
  // entirely: every bubble is now persistent, first-meeting or
  // returning, exactly the same way.
  //
  // If any future surface needs a genuinely transient toast for
  // George, it should be a separate component, not this bubble.
  useEffect(() => {
    if (!showBubble) return;
    bubbleOpacity.value = withTiming(1, { duration: 320 });
    bubbleTranslate.value = withTiming(0, { duration: 340, easing: Easing.out(Easing.cubic) });
    // Cancel any legacy timer that a stale render may have queued
    // (belt-and-braces during upgrades — no timer is scheduled below).
    if (bubbleTimerRef.current) {
      clearTimeout(bubbleTimerRef.current);
      bubbleTimerRef.current = null;
    }
    // Persistent — waits for the member. No setTimeout, no auto-fade.
    return undefined;
  }, [showBubble, bubbleOpacity, bubbleTranslate]);

  // ---- Tap the butterfly ------------------------------------------------
  const flutterAndOpenChat = useCallback(() => {
    // Cancel any lingering greeting bubble.
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    bubbleOpacity.value = withTiming(0, { duration: 180 });
    setTimeout(() => setShowBubble(false), 200);

    // First-meeting persistence: as soon as the member chose an action
    // (chat) we retire the flag server-side so we never re-play the
    // introduction. Best-effort — a network blip must never block the
    // chat from opening.
    if (isFirstMeetingRef.current) {
      isFirstMeetingRef.current = false;
      void georgeApi.introduced().catch(() => {});
    }

    // Tiny flutter — a scale wobble on the wings.
    wingFlap.value = withSequence(
      withTiming(0.68, { duration: 120 }),
      withTiming(1.08, { duration: 140 }),
      withTiming(1,    { duration: 160 }),
    );

    // Route by presence:
    //   - Onboarding hasn't finished yet → resume the profile chat.
    //   - Onboarding complete → open Milestone B5 event creation. George
    //     always leads with an open-ended warmth line — Principle #18.
    // Presence is refreshed opportunistically on every tap so the router
    // stays honest.
    //
    // TestFlight iter142 (Garry, 8 Aug 2026 — "George is inventing
    // previous conversations"): completed members were being auto-
    // dropped back into onboarding if a stale `onboarding_sessions`
    // doc existed (has_active_onboarding=true), and completed members
    // were being auto-resumed into paused event drafts — which is where
    // "we were planning a get-together…" came from. That was George
    // resuming a week-old draft, not inventing history. Both auto-
    // pulls now removed for launch:
    //   • `needsOnboarding` is derived from `onboarding_complete` ONLY,
    //     never from a stale session doc. If profile is complete, the
    //     member always lands on the completed-member surface — even
    //     if a paused onboarding session still exists on the server.
    //   • Event creation opens FRESH by default. The paused event
    //     draft is no longer silently resumed. When we ship an
    //     explicit "Continue draft" affordance (post-launch), it will
    //     be an opt-in action, not a hidden auto-open.
    // The full architectural fix (single unified George engine across
    // member + admin) is captured in
    // `/app/memory/unified-george-engine-post-launch.md`.
    setTimeout(async () => {
      try {
        const fresh = await georgeApi.presence();
        setPresence(fresh);
        const needsOnboarding =
          fresh.actor_type === 'member' && !fresh.onboarding_complete;
        if (needsOnboarding) {
          setResumeSessionId(null);
          setShowChat(true);
        } else {
          // Always start fresh — no silent resume of stale drafts.
          setResumeSessionId(null);
          setShowEvent(true);
        }
      } catch {
        // If we can't check, fall back to onboarding (safer default —
        // it's a resume, and it always exists).
        setResumeSessionId(null);
        setShowChat(true);
      }
    }, 320);
  }, [wingFlap, bubbleOpacity]);

  // ---- Animated styles ---------------------------------------------------
  const butterflyStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { rotate: `${rotate.value}deg` },
      { scale: idleBreathe.value },
    ],
    opacity: opacity.value,
  }));
  const wingStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: wingFlap.value }],
  }));
  const bubbleStyle = useAnimatedStyle(() => ({
    opacity: bubbleOpacity.value,
    transform: [{ translateY: bubbleTranslate.value }],
  }));

  // TestFlight feedback #6 (Garry, 27 July 2026): "George feels too
  // static." A very subtle 3-flap wing flutter + 3px hop every ~10s
  // while at rest. Understated — a soft heartbeat that reminds the
  // member George is there without ever pulling attention away.
  useEffect(() => {
    if (phase !== 'resting' && phase !== 'landed') return;
    const tick = () => {
      wingFlap.value = withSequence(
        withTiming(0.82, { duration: 130, easing: Easing.inOut(Easing.quad) }),
        withTiming(1.08, { duration: 150, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.9,  { duration: 130, easing: Easing.inOut(Easing.quad) }),
        withTiming(1,    { duration: 180, easing: Easing.out(Easing.quad) }),
      );
      y.value = withSequence(
        withTiming(-3, { duration: 220, easing: Easing.out(Easing.quad) }),
        withTiming(0,  { duration: 300, easing: Easing.inOut(Easing.quad) }),
      );
    };
    // First tick after ~10s so the arrival animation has time to finish.
    const timer = setInterval(tick, 10000);
    return () => clearInterval(timer);
  }, [phase, wingFlap, y]);

  // ---- Render ------------------------------------------------------------

  // Resting position: INSIDE the white header strip on tab screens
  // (Garry, C1 Slice 3 v6 — v5's `+140` was still floating over the
  // teal action button on FP Café). +108 lifts him up so his
  // body sits inside the header area, wings just kissing the blue
  // divider line below, aligned with the same y as the shared
  // `<GeorgeHeaderMark />` on secondary screens. He is now truly
  // part of the header, not placed on top of the page.
  // TestFlight round-2 v2 (Garry, 28 July 2026): give the greeting
  // bubble a bit more room by pushing George a few pt further down
  // — combined with the shorter georgiaHint greeting, the bubble now
  // sits comfortably below any Dynamic Island / notch.
  // Batch B / iter156 (Aug 2026 — P1 #1): on devices with a Dynamic
  // Island (iPhone 14 Pro / 15 / 16 family — safe-area top ≥ 55pt)
  // give George an extra 40pt below the top so the greeting bubble
  // extending upward from him stays clear of the Island cutout. On
  // notch-only or homescreen-only devices this collapses to the
  // previous +116 offset — visually unchanged.
  const hasDynamicIsland = insets.top >= 55;
  // Batch B iter156 (Garry, Aug 2026 — P1 #3): on the Friends tab the
  // header packs a title row, search field AND a horizontally-scrolling
  // filter chip row (Near Me + km radius options). At the default rest
  // position George was landing on top of those filter chips. Push him
  // ~96pt further down on Friends only so his body clears the chip
  // row without changing his position on Home / Chats / Lounge /
  // Profile. Value chosen empirically: chip row bottom ~= safe.top +
  // ~208 on Dynamic Island devices; George's body at safe.top + 156 +
  // 96 = safe.top + 252 sits comfortably below.
  const friendsExtraOffset = currentScreen === 'friends' ? 96 : 0;
  const restTop = insets.top + (hasDynamicIsland ? 156 : 116) + friendsExtraOffset;
  const restRight = 16;

  const canTap = phase === 'resting' || phase === 'landed';

  // C1 Slice 3 v5 — When George is tapped INLINE via the Header
  // component on a secondary screen, the inline mark calls
  // `openGeorge()` from the context, which bumps `openRequested`.
  // We watch that counter here and open the chat modal exactly as
  // if the resting butterfly had been tapped.
  useEffect(() => {
    if (openRequested === 0) return;
    if (!canTap) return;
    flutterAndOpenChat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequested]);

  // C1 Slice 3 v5 — On screens that use the shared `<Header />` component
  // (Groups, Notice Board, Recipes, Events, Games, Founders, Help,
  // Settings, Notifications, Profile-edit, admin, and 45 other pages),
  // George now lives INLINE in the header (see `Header.tsx`
  // `<GeorgeHeaderMark />`). We hide the floating overlay on those
  // screens so there's only ONE George on screen at a time.
  //
  // We keep the overlay on the 5 root tab screens whose custom
  // On some screens George LIVES inline in the header — the extra
  // floating overlay would be a duplicate, so hide it there. The
  // white-list stays on the primary tab screens where the header
  // doesn't yet embed George: home, chats, friends, lounge, profile.
  // TestFlight round-2 (Garry, 28 July 2026 #7): member profile
  // pages (`/user/[id]`) render the floating George too because
  // they alias to the `friends` screen key. That's confusing — the
  // extra butterfly hovers above the profile hero and has no
  // purpose there. Suppress the overlay whenever we're on a
  // secondary user profile route.
  const FLOATING_OK: readonly string[] = ['home', 'chats', 'friends', 'lounge', 'profile'];
  const isSecondaryUserRoute = typeof currentPathname === 'string' && /^\/user(\/|$)/.test(currentPathname);
  const showFloatingButterfly = FLOATING_OK.includes(currentScreen) && !isSecondaryUserRoute;

  return (
    <>
      {/* Butterfly overlay — hidden on secondary screens where George
          lives inline in the shared `<Header />` instead. */}
      {showFloatingButterfly && (
        <Animated.View
          pointerEvents="box-none"
          style={[styles.butterflyLayer, { top: restTop, right: restRight }]}
        >
        <Animated.View style={butterflyStyle}>
          <Pressable
            onPress={canTap ? flutterAndOpenChat : undefined}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Chat to George"
            style={styles.butterflyPress}
          >
            <Animated.View style={wingStyle}>
              {/* 44px — the minimum iOS touch target (Apple HIG) and
                  a comfortable size for the header strip. Was 56px
                  when he lived below the header (Slice 2). */}
              <GeorgeButterflyMark size={44} />
            </Animated.View>
          </Pressable>
        </Animated.View>

        {/* Returning-user greeting bubble. TestFlight round-2 v2 —
         *  cap the bubble's height so its top edge can never slide
         *  behind the Dynamic Island / notch on any device. Combined
         *  with the shortened georgiaHint greeting text, the bubble
         *  sits comfortably below the status bar.
         *
         *  Garry, 2 Aug 2026: `pointerEvents="box-none"` on the wrap
         *  so touches pass through the EMPTY area around the bubble
         *  and reach the pinned cards / buttons underneath. Only the
         *  bubble itself remains tappable (to dismiss on tap). This
         *  is what makes George feel present without ever *blocking*
         *  the member's next tap. */}
        {showBubble && greeting && (
          <Animated.View
            pointerEvents="box-none"
            style={[
              styles.bubbleWrap,
              // The bubble now carries actions in EVERY case (first-
              // meeting AND returning), so we always widen and anchor
              // slightly closer to the butterfly. (iter144 unification —
              // Garry, 8 Aug 2026.)
              { bottom: 4, width: Math.min(280, SCREEN_W - 90) },
              bubbleStyle,
            ]}
          >
            {/* Single Welcome Back UI — see components/george/
                GeorgeWelcomeBubble.tsx. Previously this file forked into
                a full-card variant (first meeting) and a plain-bubble
                variant (returning member) — that inconsistency was the
                iter144 regression Garry flagged (Frank vs Eileen). The
                unified component always renders the card with [Chat to
                George] + [Dismiss] so every member gets the same
                Welcome Back experience. */}
            <GeorgeWelcomeBubble
              greeting={greeting}
              onChat={flutterAndOpenChat}
              onDismiss={() => {
                bubbleOpacity.value = withTiming(0, { duration: 160 });
                setTimeout(() => setShowBubble(false), 180);
                setPhase('resting');
                // First-meeting-only: retire the intro flag server-side
                // so the introduction never plays again for this actor.
                // Returning-member dismisses are a no-op server-side.
                if (isFirstMeetingRef.current) {
                  isFirstMeetingRef.current = false;
                  void georgeApi.introduced().catch(() => {});
                }
              }}
            />
          </Animated.View>
        )}
        </Animated.View>
      )}

      {/* Onboarding conversation — opens when the resting butterfly
       *  is tapped and the member hasn't completed their profile yet.
       *  This is George picking up exactly where he paused after the
       *  introduction: "Let's start with something easy…"
       */}
      <Modal
        visible={showChat}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setShowChat(false)}
      >
        <GeorgeOnboarding
          onDone={(destination) => {
            setShowChat(false);
            // After profile is complete, refresh presence so a
            // subsequent tap opens event creation rather than
            // re-opening onboarding.
            georgeApi.presence().then(setPresence).catch(() => {});
            // TestFlight refinement (Garry, 3 Aug 2026): the closing
            // CTA now offers TWO natural starting points. Route to
            // whichever the member picked — Share a Moment or FP Café.
            // Both are equally valid ways to start on FriendPlace.
            try {
              if (destination === 'moment') {
                router.push('/moments/new' as any);
              } else {
                router.push('/(tabs)/lounge');
              }
            } catch { /* noop */ }
          }}
          onFinishLater={() => setShowChat(false)}
        />
      </Modal>

      {/* Event creation — Milestone B5. The continuous conversation
       *  continues: George opens with an open-ended warmth line, the
       *  event emerges naturally, and only once George understands the
       *  idea does he confirm it back. Principle #18 in every turn.
       *
       *  TestFlight feedback #1/#2 (Garry, 27 July 2026): approval
       *  no longer jumps to a separate celebration modal — the
       *  conversation stays in place and celebration is rendered
       *  inline. `onDone` is a no-op (kept for API stability).
       */}
      <Modal
        visible={showEvent}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setShowEvent(false)}
      >
        <GeorgeEventCreation
          key={resumeSessionId || 'fresh'}
          resumeSessionId={resumeSessionId}
          onLeave={() => {
            setShowEvent(false);
            setResumeSessionId(null);
          }}
          onDone={() => { /* inline celebration — no-op */ }}
        />
      </Modal>
    </>
  );
}

// ---- Greeting logic -----------------------------------------------------

function pickReturningGreeting(pres: Presence | null, warmWelcome: boolean, georgiaHint: boolean = false): string {
  const rawName = pres?.name || '';
  const first = firstName(rawName);
  const hour = new Date().getHours();
  const partOfDay =
    hour < 5 ? 'Hi' :
    hour < 12 ? 'Morning' :
    hour < 17 ? 'Afternoon' :
    hour < 21 ? 'Evening' : 'Hi';

  // First greeting after onboarding — the ONLY moment we treat a
  // member as genuinely new. `georgiaHint` is set exactly once by the
  // onboarding wizard on tour completion (server.py flips
  // `onboarding_completed=true` at the same moment; see
  // `GEORGIA_HINT_FLAG` below and `pickReturningGreeting` callers).
  // Returning members never re-enter this branch — they fall through
  // to `rotations` — and a reinstall or device change does NOT
  // resurrect the flag, so an established member cannot be
  // incorrectly greeted as new (Session 2 launch-polish 2026-08-14).
  //
  // Copy corrected 2026-08-14 (Garry launch-polish #4): the previous
  // "Lovely to see you again" line read as returning-member language
  // to a genuinely new member. First-time members now hear "Nice to
  // meet you"; the Georgia introduction still slips in warmly at the
  // end of the same sentence.
  if (georgiaHint) {
    return `${partOfDay}${first ? ', ' + first : ''}. Nice to meet you \u2014 tap Settings anytime to chat with Georgia instead.`;
  }

  const unfinished = pres?.unfinished?.[0];
  if (unfinished && unfinished.title) {
    return `Welcome back${first ? ', ' + first : ''}. Your ${unfinished.title.toLowerCase()} draft is still here whenever you\u2019d like to continue.`;
  }
  if (warmWelcome) {
    return `${partOfDay}${first ? ', ' + first : ''}. It\u2019s been a little while \u2014 nice to see you. What can I help with today?`;
  }
  const rotations = [
    `${partOfDay}${first ? ', ' + first : ''}. Welcome back. What would you like to do today? I\u2019m here to help \u2014 or we can just have a chat.`,
    `${partOfDay}${first ? ', ' + first : ''}. Nice to see you. Anything you\u2019d like a hand with?`,
    `Hi${first ? ' ' + first : ''}. I\u2019m around if you need me \u2014 no rush.`,
  ];
  return rotations[Math.floor(Math.random() * rotations.length)];
}

function firstName(name: string): string {
  if (!name) return '';
  const clean = name.trim().split(/\s+/)[0];
  return clean.includes('@') ? '' : clean;
}

// ---- Daily gate ---------------------------------------------------------

// Fired once by the onboarding wizard on completion. When present,
// George's next returning-greeting slips in a warm mention of Georgia.
const GEORGIA_HINT_FLAG = 'george.needs_georgia_hint';

// C1 (Garry, 22 July 2026): the daily gate is per-actor and stored in
// AsyncStorage. Exported so the auth layer can clear it on every fresh
// login — otherwise a returning member sees no welcome-back from George
// because the gate was still set from earlier that day.
//
// Updated (Garry, 6 Aug 2026): also resets the in-memory session flag
// so that on LOGOUT → LOGIN within the same app process, George greets
// the new login session again. Welcome is once per LOGIN SESSION, not
// once per calendar day. The auth layer calls this on both login AND
// logout for symmetry.
export async function clearArrivalGates(): Promise<void> {
  _sessionGreetingConsumed = false;
  try {
    const keys = await AsyncStorage.getAllKeys();
    const ours = keys.filter(k => k.startsWith(`${STORAGE_KEY}.`));
    if (ours.length) await AsyncStorage.multiRemove(ours);
  } catch {
    // Non-fatal — worst case the greeting doesn't play on this login.
  }
}

async function shouldArriveToday(actorId: string): Promise<{ allowed: boolean; warmWelcome: boolean }> {
  try {
    const raw = await AsyncStorage.getItem(`${STORAGE_KEY}.${actorId}`);
    const last = raw ? Number(raw) : 0;
    if (!last) return { allowed: true, warmWelcome: false };
    const now = Date.now();
    const daysSince = (now - last) / (1000 * 60 * 60 * 24);
    const lastDate = new Date(last), nowDate = new Date(now);
    const sameDay =
      lastDate.getFullYear() === nowDate.getFullYear() &&
      lastDate.getMonth() === nowDate.getMonth() &&
      lastDate.getDate() === nowDate.getDate();
    if (sameDay) return { allowed: false, warmWelcome: false };
    return { allowed: true, warmWelcome: daysSince >= DAYS_ABSENCE_FOR_WARM_WELCOME };
  } catch {
    return { allowed: true, warmWelcome: false };
  }
}

async function markArrivedToday(actorId: string) {
  try {
    await AsyncStorage.setItem(`${STORAGE_KEY}.${actorId}`, String(Date.now()));
  } catch { /* ignore */ }
}

// ---- Styles -------------------------------------------------------------

const styles = StyleSheet.create({
  butterflyLayer: {
    position: 'absolute',
    zIndex: 900,
    alignItems: 'flex-end',
  },
  butterflyPress: {
    // Slice 3 v6 (Garry, 22 July 2026): softer halo. Was 88% opacity in
    // v2; reduced to ~55% so George feels integrated with the header
    // rather than floating on top of the page. Padding trimmed slightly
    // so the halo hugs him more tightly.
    padding: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
    ...Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOpacity: 0.08,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 2 },
    }),
  },
  bubbleWrap: {
    position: 'absolute',
    right: 60,
    // Garry, 2 Aug 2026: hang the bubble UP-and-LEFT of the butterfly
    // instead of overlapping his height range. This keeps the top of
    // the scroll area (where pinned cards like "Notes to Myself" and
    // notification banners live) clear of George's speech while still
    // leaving the tail visibly connected to him. Combined with the
    // shorter 3.2 s auto-fade and `pointerEvents="box-none"` above,
    // George now feels present without ever *blocking* a member's
    // next tap.
    bottom: 44,
    width: Math.min(240, SCREEN_W - 120),
  },
  bubble: {
    // Locked with Garry 1 Aug 2026: George's signature voice. Soft
    // FriendPlace blue with a matching border and navy text so
    // members instantly recognise "George is speaking" wherever the
    // bubble appears. Palette matches the master butterfly.
    backgroundColor: '#DBEAFE',
    borderWidth: 1,
    borderColor: '#93C5FD',
    borderRadius: 16,
    padding: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#1E40AF',
        shadowOpacity: 0.18,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 4 },
    }),
  },
  bubbleTail: {
    position: 'absolute',
    // Tail sits at the BOTTOM-RIGHT of the bubble now that the bubble
    // is anchored above the butterfly — the diamond points DOWN toward
    // George's landing spot. (Garry, 2 Aug 2026.)
    right: 12,
    bottom: -6,
    width: 12, height: 12,
    backgroundColor: '#DBEAFE',
    borderBottomWidth: 1, borderBottomColor: '#93C5FD',
    borderRightWidth: 1, borderRightColor: '#93C5FD',
    transform: [{ rotate: '45deg' }],
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#0A2540',
    fontWeight: '500',
  },
  bubbleHint: {
    fontSize: 11,
    lineHeight: 15,
    color: '#1E3A8A',
    fontWeight: '600',
    marginTop: 8,
    opacity: 0.7,
  },
  // First-meeting action row (Garry, 4 Aug 2026). Primary + secondary
  // sit side-by-side inside the bubble so the two choices are always
  // visible; wording is locked to "Chat to George" / "Dismiss" — the
  // app-wide standard for any George welcome bubble.
  bubbleActions: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  bubbleBtnPrimary: {
    backgroundColor: '#2563EB',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    minHeight: 36,
    justifyContent: 'center',
  },
  bubbleBtnPrimaryText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.2,
  },
  bubbleBtnSecondary: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#93C5FD',
    minHeight: 36,
    justifyContent: 'center',
  },
  bubbleBtnSecondaryText: {
    color: '#1E3A8A',
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.2,
  },
  chatBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.24)',
    justifyContent: 'flex-end',
  },
  chatSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 14,
    minHeight: 320,
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E2E8F0',
  },
  chatHeaderText: {
    flex: 1, fontSize: 15, fontWeight: '800', color: '#0F172A',
  },
  chatCloseX: {
    fontSize: 20, color: '#64748B',
  },
  chatBody: {
    paddingVertical: 32,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 12,
  },
  chatPlaceholder: {
    fontSize: 15, lineHeight: 22, color: '#0F172A',
    textAlign: 'center',
  },
  chatPlaceholderSmall: {
    fontSize: 12, color: '#94A3B8',
    textAlign: 'center',
  },
});
