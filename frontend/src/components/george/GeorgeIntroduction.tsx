import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, Dimensions, Platform,
} from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withSequence, Easing, runOnJS,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GeorgeButterflyMark } from './GeorgeButterflyMark';

/**
 * George's first-meeting introduction on FriendPlace mobile.
 *
 * Locked with Garry, 19 July 2026 (principle #17):
 *   "A conversation with George never truly ends. It simply pauses
 *    until the member chooses to continue."
 *
 * The three buttons are not "actions that trigger workflows" — they
 * are the member's replies. George continues in the same conversation,
 * gives a warm acknowledgement, then steps back with the settling
 * animation. Nothing about the transition should feel like a modal
 * closing.
 *
 * Sequenced messages appear with human-like pauses (400–1200 ms) and a
 * soft typing indicator between each turn.
 */

export type IntroChoice = 'yes_begin' | 'chat_first' | 'maybe_later';

interface Message { text: string; pauseAfterMs: number; }

const MESSAGES: Message[] = [
  { text: "Hi, I\u2019m George.",                                                                                                                                                                                                                                                          pauseAfterMs: 550 },
  { text: "It\u2019s lovely to meet you.",                                                                                                                                                                                                                                                 pauseAfterMs: 700 },
  { text: "Welcome to FriendPlace.",                                                                                                                                                                                                                                                        pauseAfterMs: 950 },
  { text: "I\u2019m here to help you get the most out of FriendPlace. I can help you find people, discover groups and events, organise activities \u2014 or if you\u2019d simply like someone to chat with, I\u2019m here for that too.",                                                    pauseAfterMs: 900 },
  { text: "Whenever you need me\u2026",                                                                                                                                                                                                                                                     pauseAfterMs: 550 },
  { text: "Just tap the butterfly. \ud83e\udd8b",                                                                                                                                                                                                                                           pauseAfterMs: 1200 },
  { text: "Before we begin\u2026",                                                                                                                                                                                                                                                          pauseAfterMs: 600 },
  { text: "Why don\u2019t we get to know each other?",                                                                                                                                                                                                                                       pauseAfterMs: 400 },
];

const USER_REPLY: Record<IntroChoice, string> = {
  yes_begin:   "Yes, let\u2019s begin",
  chat_first:  "Let\u2019s just have a chat first",
  maybe_later: "Maybe later",
};

// George's warm follow-up. Locked verbatim with Garry, 19 July 2026.
const FOLLOW_UP: Record<IntroChoice, string> = {
  yes_begin:   "Wonderful. I\u2019ll ask you a few questions so I can help you find the right people and activities. We can take it one step at a time.",
  chat_first:  "That\u2019s absolutely fine. What\u2019s on your mind today?",
  maybe_later: "No problem at all. Whenever you\u2019re ready, just tap the butterfly. I\u2019ll be here.",
};

interface Props {
  /** Called after the settling animation completes, so the parent can
   *  dismiss the surface (or open the next screen, in future). */
  onSettled: (choice: IntroChoice) => void;
}

type Phase = 'sequencing' | 'awaiting_choice' | 'user_replied' | 'george_followup' | 'settling';

export function GeorgeIntroduction({ onSettled }: Props) {
  const insets = useSafeAreaInsets();
  const [visibleCount, setVisibleCount] = useState(0);
  const [showTyping, setShowTyping] = useState(true);
  const [phase, setPhase] = useState<Phase>('sequencing');
  const [userReply, setUserReply] = useState<string | null>(null);
  const [georgeReply, setGeorgeReply] = useState<string | null>(null);

  // Content fades away as George "steps back". Butterfly does one soft
  // flutter, then glides down to the resting corner.
  const contentOpacity = useSharedValue(1);
  const modalTint     = useSharedValue(1);   // 1 = solid bg, 0 = transparent (Home shows through)
  const butterflyX    = useSharedValue(0);
  const butterflyY    = useSharedValue(0);
  const butterflyScale = useSharedValue(1);
  const wingFlap      = useSharedValue(1);

  const scrollRef = useRef<ScrollView | null>(null);

  // ---- Sequenced reveal --------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    async function play() {
      await sleep(700);
      for (let i = 0; i < MESSAGES.length; i++) {
        if (cancelled) return;
        setShowTyping(false);
        setVisibleCount(i + 1);
        requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
        const isLast = i === MESSAGES.length - 1;
        if (!isLast) {
          setShowTyping(true);
          await sleep(MESSAGES[i].pauseAfterMs);
        }
      }
      if (cancelled) return;
      setShowTyping(false);
      await sleep(650);
      if (!cancelled) setPhase('awaiting_choice');
    }
    void play();
    return () => { cancelled = true; };
  }, []);

  // ---- Handle a member's choice ------------------------------------------
  function handleChoice(choice: IntroChoice) {
    if (phase !== 'awaiting_choice') return;
    setUserReply(USER_REPLY[choice]);
    setPhase('user_replied');

    // Small pause, typing indicator, then George's follow-up.
    setTimeout(() => {
      setShowTyping(true);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }, 250);
    setTimeout(() => {
      setShowTyping(false);
      setGeorgeReply(FOLLOW_UP[choice]);
      setPhase('george_followup');
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }, 1400);

    // After George's follow-up sits for a moment, begin the settling.
    setTimeout(() => beginSettling(choice), 1400 + 1600);
  }

  // ---- Settling ----------------------------------------------------------
  //
  // Choreography (locked with Garry):
  //   1. Pause ~1s on the last message.
  //   2. Speech gently fades away.
  //   3. Butterfly gives one soft flutter.
  //   4. Butterfly glides down to its permanent home (bottom-right).
  //   5. Once landed, the parent tears down this surface and the
  //      Home-screen resting butterfly is revealed underneath.
  function beginSettling(choice: IntroChoice) {
    setPhase('settling');

    // Compute target position for the butterfly. Its current spot is the
    // header at the top of the screen; the resting spot sits above the
    // tab bar (mirrors the coordinates used by GeorgeButterfly.tsx).
    const restBottomFromBottom = Math.max(insets.bottom + 88, 108);
    const targetY = SCREEN_H - restBottomFromBottom - insets.top - 40 - 22; // vertical delta from header center to resting center
    const targetX = SCREEN_W - 20 - 24 - 16;   // right rest anchor minus current left padding of header

    // 2) Speech fades.
    contentOpacity.value = withTiming(0, { duration: 550, easing: Easing.out(Easing.cubic) });

    // 3) One soft flutter on the wings.
    wingFlap.value = withSequence(
      withTiming(0.72, { duration: 240, easing: Easing.inOut(Easing.quad) }),
      withTiming(1.06, { duration: 260, easing: Easing.inOut(Easing.quad) }),
      withTiming(1,    { duration: 240, easing: Easing.inOut(Easing.quad) }),
    );

    // 4) Glide down to the resting spot. Slight scale-down as it settles.
    butterflyX.value = withTiming(targetX, { duration: 1500, easing: Easing.inOut(Easing.cubic) });
    butterflyY.value = withTiming(targetY, { duration: 1500, easing: Easing.inOut(Easing.cubic) });
    butterflyScale.value = withTiming(0.94, { duration: 1500, easing: Easing.inOut(Easing.cubic) });

    // Make the modal background see-through mid-glide so the Home
    // screen fades in underneath — no visible "pop".
    modalTint.value = withTiming(0, { duration: 900, easing: Easing.inOut(Easing.cubic) },
      () => { /* no-op; wait for glide to end */ },
    );

    // 5) Tell the parent to tear down after the whole sequence.
    setTimeout(() => runOnJS(onSettled)(choice), 1700);
  }

  // ---- Animated styles --------------------------------------------------
  const contentStyle = useAnimatedStyle(() => ({ opacity: contentOpacity.value }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: 0.02 + modalTint.value * 0.98 }));
  const butterflyStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: butterflyX.value },
      { translateY: butterflyY.value },
      { scale: butterflyScale.value },
    ],
  }));
  const wingStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: wingFlap.value }] }));

  return (
    <View style={styles.wrap}>
      {/* Background layer that fades out during settling so the Home
          screen underneath can show through seamlessly. */}
      <Animated.View style={[styles.backdrop, backdropStyle]} pointerEvents="none" />

      {/* Header + chat content — fades out during settling. */}
      <Animated.View style={[styles.contentWrap, contentStyle, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]} pointerEvents={phase === 'settling' ? 'none' : 'auto'}>
        <View style={styles.header}>
          <View style={styles.headerButterflySlot} />
          <Text style={styles.headerName}>George</Text>
          <View style={styles.presenceDot} />
        </View>
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {MESSAGES.slice(0, visibleCount).map((m, i) => (
            <GeorgeBubble key={`g-${i}`} text={m.text} isFirst={i === 0} />
          ))}
          {userReply && <UserBubble text={userReply} />}
          {phase === 'george_followup' && georgeReply && (
            <GeorgeBubble text={georgeReply} isFirst={false} />
          )}
          {showTyping && <TypingBubble />}
          <View style={{ height: 12 }} />
        </ScrollView>

        {phase === 'awaiting_choice' && (
          <ChoicesRow onChoice={handleChoice} />
        )}
      </Animated.View>

      {/* Butterfly rendered in its OWN layer so it can survive the
          content fade and glide down to the resting spot. Position
          starts in the header slot; animated during settling. */}
      <Animated.View
        style={[styles.butterflyLayer, {
          top: insets.top + 8 + 3,
          left: 16 + 3,
        }, butterflyStyle]}
        pointerEvents="none"
      >
        <Animated.View style={wingStyle}>
          <GeorgeButterflyMark size={44} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

// ---- Sub-components -----------------------------------------------------

function GeorgeBubble({ text, isFirst }: { text: string; isFirst: boolean }) {
  const opacity = useSharedValue(0);
  const translate = useSharedValue(6);
  useEffect(() => {
    opacity.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) });
    translate.value = withTiming(0, { duration: 340, easing: Easing.out(Easing.cubic) });
  }, [opacity, translate]);
  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translate.value }],
  }));
  return (
    <Animated.View style={[styles.bubbleRow, style]}>
      {isFirst ? (
        <View style={styles.avatarSlot}>
          <GeorgeButterflyMark size={28} />
        </View>
      ) : (
        <View style={styles.avatarSlot} />
      )}
      <View style={styles.bubble}>
        <Text style={styles.bubbleText}>{text}</Text>
      </View>
    </Animated.View>
  );
}

function UserBubble({ text }: { text: string }) {
  const opacity = useSharedValue(0);
  const translate = useSharedValue(6);
  useEffect(() => {
    opacity.value = withTiming(1, { duration: 260 });
    translate.value = withTiming(0, { duration: 300, easing: Easing.out(Easing.cubic) });
  }, [opacity, translate]);
  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translate.value }],
  }));
  return (
    <Animated.View style={[styles.bubbleRow, styles.bubbleRowRight, style]}>
      <View style={styles.userBubble}>
        <Text style={styles.userBubbleText}>{text}</Text>
      </View>
    </Animated.View>
  );
}

function TypingBubble() {
  const a = useSharedValue(0.3);
  const b = useSharedValue(0.3);
  const c = useSharedValue(0.3);
  useEffect(() => {
    const loop = (v: any, delay: number) => {
      v.value = withSequence(
        withTiming(0.3, { duration: delay }),
        withTiming(1,   { duration: 350 }),
        withTiming(0.3, { duration: 350 }),
      );
    };
    const id = setInterval(() => { loop(a, 0); loop(b, 120); loop(c, 240); }, 900);
    loop(a, 0); loop(b, 120); loop(c, 240);
    return () => clearInterval(id);
  }, [a, b, c]);
  const s1 = useAnimatedStyle(() => ({ opacity: a.value }));
  const s2 = useAnimatedStyle(() => ({ opacity: b.value }));
  const s3 = useAnimatedStyle(() => ({ opacity: c.value }));
  return (
    <View style={styles.bubbleRow}>
      <View style={styles.avatarSlot} />
      <View style={[styles.bubble, styles.typingBubble]}>
        <Animated.View style={[styles.typingDot, s1]} />
        <Animated.View style={[styles.typingDot, s2]} />
        <Animated.View style={[styles.typingDot, s3]} />
      </View>
    </View>
  );
}

function ChoicesRow({ onChoice }: { onChoice: (c: IntroChoice) => void }) {
  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) });
  }, [enter]);
  const wrapStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 12 }],
  }));
  return (
    <Animated.View style={[styles.choicesWrap, wrapStyle]}>
      <Pressable
        onPress={() => onChoice('yes_begin')}
        style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Yes, let's begin"
      >
        <Text style={styles.primaryBtnText}>Yes, let&rsquo;s begin</Text>
      </Pressable>
      <Pressable
        onPress={() => onChoice('chat_first')}
        style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Let's just have a chat first"
      >
        <Text style={styles.secondaryBtnText}>Let&rsquo;s just have a chat first</Text>
      </Pressable>
      <Pressable
        onPress={() => onChoice('maybe_later')}
        style={({ pressed }) => [styles.tertiaryBtn, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Maybe later"
      >
        <Text style={styles.tertiaryBtnText}>Maybe later</Text>
      </Pressable>
    </Animated.View>
  );
}

function sleep(ms: number) { return new Promise<void>(res => setTimeout(res, ms)); }

// ---- Styles -------------------------------------------------------------

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const BUBBLE_MAX = Math.min(SCREEN_W - 92, 320);

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FAFAFA',
  },
  contentWrap: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  headerButterflySlot: {
    width: 46, height: 46,
    borderRadius: 23,
    backgroundColor: '#F0FDFA',
  },
  headerName: {
    fontSize: 17, fontWeight: '800', color: '#0F172A',
    flex: 1, marginLeft: 6,
  },
  presenceDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: '#14B8A6',
    shadowColor: '#14B8A6',
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  butterflyLayer: {
    position: 'absolute',
    width: 44, height: 44,
    alignItems: 'center', justifyContent: 'center',
    zIndex: 20,
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 12,
    paddingTop: 20,
    paddingBottom: 6,
  },
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 8,
  },
  bubbleRowRight: {
    justifyContent: 'flex-end',
  },
  avatarSlot: {
    width: 32, height: 32,
    marginRight: 8, marginBottom: 4,
    alignItems: 'center', justifyContent: 'center',
  },
  bubble: {
    maxWidth: BUBBLE_MAX,
    backgroundColor: '#CCFBF1',
    borderColor: '#5EEAD4',
    borderWidth: 1,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    paddingVertical: 10,
    paddingHorizontal: 14,
    ...Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOpacity: 0.06,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 1 },
    }),
  },
  bubbleText: {
    fontSize: 15,
    color: '#0F172A',
    lineHeight: 22,
  },
  userBubble: {
    maxWidth: BUBBLE_MAX,
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 18,
    borderBottomRightRadius: 4,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginRight: 4,
  },
  userBubbleText: {
    fontSize: 15,
    color: '#0F172A',
    lineHeight: 22,
    fontWeight: '500',
  },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 4,
  },
  typingDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: '#0F766E',
    marginHorizontal: 1,
  },
  choicesWrap: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 10,
  },
  primaryBtn: {
    backgroundColor: '#14B8A6',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: '#14B8A6',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    ...Platform.select({ android: { elevation: 3 } }),
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 14,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '700',
  },
  tertiaryBtn: {
    backgroundColor: 'transparent',
    paddingVertical: 10,
    alignItems: 'center',
  },
  tertiaryBtnText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  pressed: { opacity: 0.75 },
});
