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
 *   - The persistent resting butterfly in the bottom-right corner.
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
const BUBBLE_LIFETIME_MS = 6500;

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

type Phase = 'idle' | 'arriving' | 'landed' | 'resting' | 'intro';

export function GeorgeButterfly() {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>('idle');
  const [, setPresence] = useState<Presence | null>(null);
  const [greeting, setGreeting] = useState<string | null>(null);
  const [showBubble, setShowBubble] = useState(false);
  const [showChat, setShowChat] = useState(false);

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
    // Open the chat after the flutter completes.
    setTimeout(() => setShowChat(true), 320);
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

  const restBottom = Math.max(insets.bottom + 88, 108); // above tab bar
  const restRight = 20;

  const canTap = phase === 'resting' || phase === 'landed';

  return (
    <>
      {/* Butterfly — always in the corner regardless of phase */}
      <Animated.View
        pointerEvents="box-none"
        style={[styles.butterflyLayer, { bottom: restBottom, right: restRight }]}
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
              <GeorgeButterflyMark size={56} />
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

      {/* Placeholder floating chat — Slice B3 replaces with the shared engine */}
      <Modal
        visible={showChat}
        animationType="slide"
        transparent
        onRequestClose={() => setShowChat(false)}
      >
        <View style={styles.chatBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowChat(false)} />
          <View style={[styles.chatSheet, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.chatHeader}>
              <GeorgeButterflyMark size={28} />
              <Text style={styles.chatHeaderText}>Talking with George</Text>
              <Pressable onPress={() => setShowChat(false)} hitSlop={10}>
                <Text style={styles.chatCloseX}>✕</Text>
              </Pressable>
            </View>
            <View style={styles.chatBody}>
              <Text style={styles.chatPlaceholder}>
                We&rsquo;ll bring the full conversation here next —
                same George, same warmth, right on your phone.
              </Text>
              <Text style={styles.chatPlaceholderSmall}>
                Slice B3 will mount the shared conversation engine.
              </Text>
            </View>
          </View>
        </View>
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
    padding: 6,
  },
  bubbleWrap: {
    position: 'absolute',
    right: 60,
    bottom: 6,
    width: Math.min(280, SCREEN_W - 100),
  },
  bubble: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CCFBF1',
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
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1, borderTopColor: '#CCFBF1',
    borderRightWidth: 1, borderRightColor: '#CCFBF1',
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
