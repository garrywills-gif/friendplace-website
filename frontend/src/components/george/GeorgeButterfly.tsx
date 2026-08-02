import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, Modal, Dimensions, Platform,
} from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withSequence, withRepeat,
  Easing, runOnJS,
} from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { GeorgeButterflyMark } from './GeorgeButterflyMark';
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
const DAYS_ABSENCE_FOR_WARM_WELCOME = 3;
// Bubble auto-dismiss (Garry, 1 Aug 2026 — "Let it auto-dismiss after
// a few seconds"). Down from 12s to 6s so the bubble reads as a short
// warm hello rather than a lingering panel. Tap-to-dismiss still works.
// Longer welcome copy (thoughts, callbacks, invitations) belongs on a
// separate Home card, not in the bubble.
const BUBBLE_LIFETIME_MS = 6000;

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

  // ---- Boot: fetch presence + decide what to do --------------------------
  useEffect(() => {
    let cancelled = false;
    async function boot() {
      let pres: Presence | null = null;
      try { pres = await georgeApi.presence(); }
      catch { /* silent — he'll just say a generic hello */ }
      if (cancelled) return;
      setPresence(pres);

      const gate = await shouldArriveToday(pres?.actor_id || 'anonymous');
      const firstMeeting = !!pres?.first_meeting;

      // First meeting always plays; otherwise honour the daily gate.
      if (!firstMeeting && !gate.allowed) {
        // Land straight into the resting state without an animation.
        setPhase('resting');
        opacity.value = 1;
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

  // ---- Bubble bloom + auto-fade -----------------------------------------
  useEffect(() => {
    if (!showBubble) return;
    bubbleOpacity.value = withTiming(1, { duration: 320 });
    bubbleTranslate.value = withTiming(0, { duration: 340, easing: Easing.out(Easing.cubic) });
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    bubbleTimerRef.current = setTimeout(() => {
      bubbleOpacity.value = withTiming(0, { duration: 260 });
      bubbleTranslate.value = withTiming(6, { duration: 260 });
      setTimeout(() => setShowBubble(false), 280);
      setPhase('resting');
    }, BUBBLE_LIFETIME_MS);
    return () => { if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current); };
  }, [showBubble, bubbleOpacity, bubbleTranslate]);

  // ---- Tap the butterfly ------------------------------------------------
  const flutterAndOpenChat = useCallback(() => {
    // Cancel any lingering greeting bubble.
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    bubbleOpacity.value = withTiming(0, { duration: 180 });
    setTimeout(() => setShowBubble(false), 200);

    // Tiny flutter — a scale wobble on the wings.
    wingFlap.value = withSequence(
      withTiming(0.68, { duration: 120 }),
      withTiming(1.08, { duration: 140 }),
      withTiming(1,    { duration: 160 }),
    );

    // Route by presence:
    //   - Onboarding hasn't finished yet (either never started or paused
    //     mid-conversation) → resume the profile chat.
    //   - Onboarding complete → open Milestone B5 event creation. George
    //     always leads with an open-ended warmth line — Principle #18.
    // Presence is refreshed opportunistically on every tap so the router
    // stays honest.
    setTimeout(async () => {
      try {
        const fresh = await georgeApi.presence();
        setPresence(fresh);
        const needsOnboarding =
          fresh.actor_type === 'member' &&
          (!fresh.onboarding_complete || fresh.has_active_onboarding);
        if (needsOnboarding) {
          setResumeSessionId(null);
          setShowChat(true);
        } else {
          // If the member has a paused event conversation, we open the
          // event surface in RESUME mode. George picks up with a warm,
          // age-aware welcome-back and offers Carry on / Start new.
          // Otherwise we start fresh.
          const paused = fresh.paused_event_session || null;
          setResumeSessionId(paused ? paused.session_id : null);
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
  const restTop = insets.top + 116;
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
            accessibilityLabel="Talk to George"
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
         *  sits comfortably below the status bar. */}
        {showBubble && greeting && (
          <Animated.View style={[styles.bubbleWrap, bubbleStyle]}>
            <Pressable onPress={() => {
              bubbleOpacity.value = withTiming(0, { duration: 160 });
              setTimeout(() => setShowBubble(false), 180);
              setPhase('resting');
            }}>
              <View style={styles.bubble}>
                <Text style={styles.bubbleText} numberOfLines={4}>{greeting}</Text>
              </View>
              <View style={styles.bubbleTail} />
            </Pressable>
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
          onDone={() => {
            setShowChat(false);
            // After profile is complete, refresh presence so a
            // subsequent tap opens event creation rather than
            // re-opening onboarding.
            georgeApi.presence().then(setPresence).catch(() => {});
            // TestFlight round-3 v3 (Garry, 29 July 2026 #14): the
            // onboarding closing CTA is now "☕ Head to FP Café" —
            // route the member straight there as their first
            // destination.
            try { router.push('/(tabs)/lounge'); } catch { /* noop */ }
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

  // First greeting after onboarding — take the chance to gently
  // introduce Georgia so members know they can switch anytime.
  // This overrides the standard rotations for exactly one session.
  // TestFlight round-2 v2 (Garry, 28 July 2026): the original one-
  // paragraph greeting rendered ~6 lines high and its top edge slid
  // beneath the iPhone Dynamic Island. Trimmed to 2 short lines so
  // the bubble stays well below the notch area on every device.
  if (georgiaHint) {
    return `${partOfDay}${first ? ', ' + first : ''}. Lovely to see you again \u2014 tap Settings anytime to chat with Georgia instead.`;
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
export async function clearArrivalGates(): Promise<void> {
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
    bottom: 6,
    width: Math.min(280, SCREEN_W - 100),
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
    right: -6,
    bottom: 14,
    width: 12, height: 12,
    // Blue tail matched to the bubble so the pointer to the perched
    // butterfly stays visually part of George's voice.
    backgroundColor: '#DBEAFE',
    borderTopWidth: 1, borderTopColor: '#93C5FD',
    borderRightWidth: 1, borderRightColor: '#93C5FD',
    transform: [{ rotate: '45deg' }],
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#0A2540',
    fontWeight: '500',
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
