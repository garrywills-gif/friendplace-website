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
import { GeorgeButterflyMark } from './GeorgeButterflyMark';
import { GeorgeIntroduction, type IntroChoice } from './GeorgeIntroduction';
import { GeorgeOnboarding } from './GeorgeOnboarding';
import { GeorgeEventCreation } from './GeorgeEventCreation';
import { GeorgeEventCelebration } from './GeorgeEventCelebration';
import { useGeorge } from '@/src/lib/george-context';
import { georgeApi, type Presence, type EventApprovalResult } from '@/src/lib/george-api';

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
// Bumped 22 July 2026 (Garry's C1 feedback): longer greetings need more
// dwell time so older members have room to finish reading before the
// bubble tucks itself away. 12s covers the longest returning-user line
// without feeling long-winded. Tap-to-dismiss still works.
const BUBBLE_LIFETIME_MS = 12000;

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

type Phase = 'idle' | 'arriving' | 'landed' | 'resting' | 'intro';

export function GeorgeButterfly() {
  const insets = useSafeAreaInsets();
  const { landedFrom, consumeLanded, currentScreen } = useGeorge();
  const [phase, setPhase] = useState<Phase>('idle');
  const [, setPresence] = useState<Presence | null>(null);
  const [greeting, setGreeting] = useState<string | null>(null);
  const [showBubble, setShowBubble] = useState(false);
  const [showChat, setShowChat] = useState(false);
  // Milestone B5 — event creation & its celebration surface.
  const [showEvent, setShowEvent] = useState(false);
  const [resumeSessionId, setResumeSessionId] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<EventApprovalResult | null>(null);

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
      playArrival(() => {
        if (cancelled) return;
        if (firstMeeting) {
          setPhase('intro');
        } else {
          setPhase('landed');
          setGreeting(pickReturningGreeting(pres, gate.warmWelcome));
          setShowBubble(true);
        }
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
    // Start well above the header, slightly to the right of resting.
    const startX = 60;
    const startY = -(insets.top + 260);
    x.value = startX;
    y.value = startY;
    opacity.value = 0;
    rotate.value = -6;

    // Wings flapping fast during the flight — same rhythm as daily arrival.
    wingFlap.value = withRepeat(
      withSequence(
        withTiming(0.72, { duration: 150, easing: Easing.inOut(Easing.quad) }),
        withTiming(1,    { duration: 150, easing: Easing.inOut(Easing.quad) }),
      ),
      6, // ~1.8s of flapping (covers the whole flight)
      false,
    );

    // Fade in as he flies in.
    opacity.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.quad) });

    // Curved path: sweep down-and-left, with a tiny overshoot then
    // settle at the resting spot. Two-phase timing gives that
    // "arriving, then landing" feel Garry described.
    x.value = withSequence(
      withTiming(-14, { duration: 640, easing: Easing.inOut(Easing.cubic) }),
      withTiming(0,   { duration: 260, easing: Easing.out(Easing.cubic) }),
    );
    y.value = withSequence(
      withTiming(-24, { duration: 640, easing: Easing.inOut(Easing.cubic) }),
      withTiming(0,   { duration: 260, easing: Easing.out(Easing.cubic) }),
    );
    rotate.value = withSequence(
      withTiming(4,  { duration: 500, easing: Easing.inOut(Easing.cubic) }),
      withTiming(0,  { duration: 400, easing: Easing.out(Easing.cubic) }, (finished) => {
        if (finished) {
          // Wing flap tapers to rest.
          wingFlap.value = withTiming(1, { duration: 220 });
        }
      }),
    );

    // Clear the flag after the animation completes so it doesn't
    // replay on any subsequent re-render. Guard with a slightly
    // longer timeout than the animation itself to be safe.
    const t = setTimeout(() => consumeLanded(), 1000);
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

  // ---- Handle introduction choice ---------------------------------------
  const onIntroChoice = useCallback(async (choice: IntroChoice) => {
    // Principle #17 — the conversation never ends, so we do NOT open
    // a placeholder sheet here. George has already spoken his warm
    // follow-up inside the intro surface and settled his butterfly
    // down to its resting corner. We simply retire the first-meeting
    // flag on the server and hand control back to the Home screen,
    // where the resting butterfly is now the member's constant
    // companion — waiting to be tapped whenever they're ready.
    try { await georgeApi.introduced(); } catch { /* silent — cosmetic */ }
    setPhase('resting');
  }, []);

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

  // ---- Render ------------------------------------------------------------

  // Resting position: JUST BELOW the header on the right edge (Garry,
  // C1 Slice 3 v4 revision — v3's "in the header row" position was
  // colliding with notification/settings icons on Home, info icons on
  // Lounge, "Post Recipe" on Recipes, etc. Different FriendPlace
  // screens have wildly different header layouts, so no single "in
  // the header" position works universally without a per-screen
  // header component refactor. Sitting just under the header row at
  // the right edge is the sweet spot that clears every screen's
  // header controls whilst still reading as a header companion.
  //
  // A future Slice 4 could embed George inline into each screen's
  // header component for a truly bespoke "beside the title" layout;
  // for now this position is the safe universal spot.
  const restTop = insets.top + 88;
  const restRight = 16;

  const canTap = phase === 'resting' || phase === 'landed';

  return (
    <>
      {/* Butterfly — always in the corner regardless of phase */}
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

        {/* Returning-user greeting bubble */}
        {showBubble && greeting && (
          <Animated.View style={[styles.bubbleWrap, bubbleStyle]}>
            <Pressable onPress={() => {
              bubbleOpacity.value = withTiming(0, { duration: 160 });
              setTimeout(() => setShowBubble(false), 180);
              setPhase('resting');
            }}>
              <View style={styles.bubble}>
                <Text style={styles.bubbleText}>{greeting}</Text>
              </View>
              <View style={styles.bubbleTail} />
            </Pressable>
          </Animated.View>
        )}
      </Animated.View>

      {/* First-meeting introduction as a continuous conversation.
       *  The intro handles its own settling animation before calling
       *  back — see GeorgeIntroduction. We use a transparent modal so
       *  the butterfly can appear to glide *through* the boundary and
       *  land on the Home screen without a visible seam.
       */}
      <Modal
        visible={phase === 'intro'}
        animationType="fade"
        transparent
        onRequestClose={() => onIntroChoice('maybe_later')}
      >
        <GeorgeIntroduction onSettled={onIntroChoice} />
      </Modal>

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
          }}
          onFinishLater={() => setShowChat(false)}
        />
      </Modal>

      {/* Event creation — Milestone B5. The continuous conversation
       *  continues: George opens with an open-ended warmth line, the
       *  event emerges naturally, and only once George understands the
       *  idea does he confirm it back. Principle #18 in every turn.
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
          onDone={(result) => {
            setShowEvent(false);
            setResumeSessionId(null);
            setCelebration(result);
          }}
        />
      </Modal>

      {/* Warm celebration once an event is created. */}
      <Modal
        visible={!!celebration}
        animationType="fade"
        transparent={false}
        onRequestClose={() => setCelebration(null)}
      >
        {celebration ? (
          <GeorgeEventCelebration
            result={celebration}
            onDone={() => setCelebration(null)}
          />
        ) : <View />}
      </Modal>
    </>
  );
}

// ---- Greeting logic -----------------------------------------------------

function pickReturningGreeting(pres: Presence | null, warmWelcome: boolean): string {
  const rawName = pres?.name || '';
  const first = firstName(rawName);
  const hour = new Date().getHours();
  const partOfDay =
    hour < 5 ? 'Hi' :
    hour < 12 ? 'Morning' :
    hour < 17 ? 'Afternoon' :
    hour < 21 ? 'Evening' : 'Hi';

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
    // Slice 3 v2 (Garry, 22 July 2026): give the butterfly a subtle
    // white halo so he stays visible against every backdrop across
    // FriendPlace — including the teal buttons on Coffee Lounge and
    // the coloured group cards. The halo is a soft rounded background
    // that fades into the page whilst keeping George legible. Cheap
    // to render; no perf impact.
    padding: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    ...Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOpacity: 0.14,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
      },
      android: { elevation: 4 },
    }),
  },
  bubbleWrap: {
    position: 'absolute',
    right: 60,
    bottom: 6,
    width: Math.min(280, SCREEN_W - 100),
  },
  bubble: {
    backgroundColor: '#CCFBF1',
    borderWidth: 1,
    borderColor: '#5EEAD4',
    borderRadius: 16,
    padding: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOpacity: 0.12,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 3 },
    }),
  },
  bubbleTail: {
    position: 'absolute',
    right: -6,
    bottom: 14,
    width: 12, height: 12,
    backgroundColor: '#CCFBF1',
    borderTopWidth: 1, borderTopColor: '#5EEAD4',
    borderRightWidth: 1, borderRightColor: '#5EEAD4',
    transform: [{ rotate: '45deg' }],
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#0F172A',
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
