import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, Dimensions, Platform,
} from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withSequence, Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GeorgeButterflyMark } from './GeorgeButterflyMark';

/**
 * George's first-meeting introduction on FriendPlace mobile.
 *
 * Locked with Garry, 19 July 2026:
 *   - Not a form. Not a tutorial. A conversation.
 *   - Messages appear in sequence with human-like pauses — "a few
 *     hundred milliseconds. Almost like a real person."
 *   - Only three choices at the end. `Yes, let's begin` leads directly
 *     into the shared conversation.
 *   - Never re-shown once the actor has acknowledged.
 */

export type IntroChoice = 'yes_begin' | 'chat_first' | 'maybe_later';

interface Message { text: string; pauseAfterMs: number; }

/**
 * The introduction messages, sequenced. Pause values are locked with
 * Garry: a soft cadence that feels like someone thinking, not typing.
 */
const MESSAGES: Message[] = [
  { text: "Hi, I\u2019m George.",                              pauseAfterMs: 550 },
  { text: "It\u2019s lovely to meet you.",                     pauseAfterMs: 700 },
  { text: "Welcome to FriendPlace.",                            pauseAfterMs: 950 },
  { text: "I\u2019m here to help you get the most out of FriendPlace. I can help you find people, discover groups and events, organise activities \u2014 or if you\u2019d simply like someone to chat with, I\u2019m here for that too.", pauseAfterMs: 900 },
  { text: "Whenever you need me\u2026",                        pauseAfterMs: 550 },
  { text: "Just tap the butterfly. \ud83e\udd8b",              pauseAfterMs: 1200 },
  { text: "Before we begin\u2026",                             pauseAfterMs: 600 },
  { text: "Why don\u2019t we get to know each other?",         pauseAfterMs: 400 },
];

interface Props {
  onChoice: (choice: IntroChoice) => void;
}

export function GeorgeIntroduction({ onChoice }: Props) {
  const insets = useSafeAreaInsets();
  const [visibleCount, setVisibleCount] = useState(0);
  const [showChoices, setShowChoices] = useState(false);
  const [showTyping, setShowTyping] = useState(true);
  const scrollRef = useRef<ScrollView | null>(null);

  // Sequenced reveal with human-like pauses. We show a soft typing
  // indicator during each pause, then land the message.
  useEffect(() => {
    let cancelled = false;
    async function play() {
      // Small initial "George is thinking about how to greet you" beat.
      await sleep(700);
      for (let i = 0; i < MESSAGES.length; i++) {
        if (cancelled) return;
        setShowTyping(false);
        setVisibleCount(i + 1);
        // Auto-scroll so the newest message is always in view.
        requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
        const isLast = i === MESSAGES.length - 1;
        if (!isLast) {
          setShowTyping(true);
          await sleep(MESSAGES[i].pauseAfterMs);
        }
      }
      if (cancelled) return;
      setShowTyping(false);
      // Small breath, then the choices bloom.
      await sleep(650);
      if (!cancelled) setShowChoices(true);
    }
    void play();
    return () => { cancelled = true; };
  }, []);

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
      <Header />
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {MESSAGES.slice(0, visibleCount).map((m, i) => (
          <MessageBubble key={i} text={m.text} isFirst={i === 0} />
        ))}
        {showTyping && <TypingBubble />}
        <View style={{ height: 12 }} />
      </ScrollView>

      {showChoices && (
        <ChoicesRow onChoice={onChoice} />
      )}
    </View>
  );
}

// ---- Sub-components -----------------------------------------------------

function Header() {
  return (
    <View style={styles.header}>
      <View style={styles.headerButterfly}>
        <GeorgeButterflyMark size={44} />
      </View>
      <Text style={styles.headerName}>George</Text>
      <View style={styles.presenceDot} />
    </View>
  );
}

function MessageBubble({ text, isFirst }: { text: string; isFirst: boolean }) {
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
    const id = setInterval(() => {
      loop(a, 0); loop(b, 120); loop(c, 240);
    }, 900);
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

// ---- Helpers ------------------------------------------------------------

function sleep(ms: number) {
  return new Promise<void>(res => setTimeout(res, ms));
}

// ---- Styles -------------------------------------------------------------

const { width: SCREEN_W } = Dimensions.get('window');
const BUBBLE_MAX = Math.min(SCREEN_W - 92, 320);

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
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
  headerButterfly: {
    width: 46, height: 46,
    borderRadius: 23,
    backgroundColor: '#F0FDFA',
    alignItems: 'center', justifyContent: 'center',
  },
  headerName: {
    fontSize: 17, fontWeight: '800', color: '#0F172A',
    flex: 1,
  },
  presenceDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: '#14B8A6',
    shadowColor: '#14B8A6',
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
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
  avatarSlot: {
    width: 32, height: 32,
    marginRight: 8, marginBottom: 4,
    alignItems: 'center', justifyContent: 'center',
  },
  bubble: {
    maxWidth: BUBBLE_MAX,
    backgroundColor: '#FFFFFF',
    borderColor: '#CCFBF1',
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
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 4,
  },
  typingDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: '#14B8A6',
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
