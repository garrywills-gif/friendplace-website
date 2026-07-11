/**
 * FriendPlace Welcome Tour
 *
 * Five-slide onboarding tour shown the first time a new member lands
 * after finishing profile setup. Introduces the core sections of the
 * app in the order a new user is most likely to explore them:
 *
 *   1. Find Friends
 *   2. Groups & Events
 *   3. Coffee Lounge
 *   4. Games
 *   5. Founders Wall
 *
 * (A sixth Accessibility slide will be added once the voice-input and
 * text-to-speech features are implemented — we deliberately do not tease
 * features that aren't shippable today.)
 *
 * Behaviour:
 * - "Skip" on any slide dismisses the tour and lands on /home.
 * - "Next" advances through the slides. The final slide's CTA is
 *   "Take me to FriendPlace" and also lands on /home.
 * - Once the tour is completed or skipped, we flip an AsyncStorage flag
 *   so it never appears again for this device/account. On subsequent
 *   sign-ins the user goes straight to /home.
 * - Accessed via `/welcome-tour` — pushed after onboarding.tsx completes.
 */
import React, { useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Image,
  ScrollView,
  Dimensions,
  useWindowDimensions,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTheme } from "@/src/lib/theme";

// Flag remembered per-device so the tour only shows once per install.
// Kept namespaced under the legacy `youbelong` prefix to match the rest
// of the codebase's AsyncStorage keys (internal branding is unchanged).
export const WELCOME_TOUR_SEEN_KEY = "youbelong.welcomeTour.seen";

/** Mark the tour as complete. Exported so other screens can bump the
 *  flag if they need to skip it (e.g. login of an existing user). */
export async function markWelcomeTourSeen() {
  try {
    await AsyncStorage.setItem(WELCOME_TOUR_SEEN_KEY, "1");
  } catch { /* no-op */ }
}

/** Has the current device already seen the tour? */
export async function hasSeenWelcomeTour(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(WELCOME_TOUR_SEEN_KEY);
    return v === "1";
  } catch {
    return false;
  }
}

// Tour slide content — the copy is the exact wording the product owner
// requested. Keep punctuation warm and short so the older audience can
// read a slide at a glance without leaning in.
type Slide = {
  key: string;
  emoji: string;
  title: string;
  body: string;
  gradient: [string, string];
};

const SLIDES: Slide[] = [
  {
    key: "friends",
    emoji: "👋",
    title: "Find Friends",
    body: "Find people nearby who share your interests.",
    gradient: ["#1E3A7F", "#3B82C4"],
  },
  {
    key: "groups",
    emoji: "🎉",
    title: "Groups & Events",
    body: "Discover local groups, activities and events.",
    gradient: ["#0EA5A2", "#38BDB0"],
  },
  {
    key: "lounge",
    emoji: "☕",
    title: "Coffee Lounge",
    body: "Drop in anytime for a friendly chat.",
    gradient: ["#B45309", "#D97706"],
  },
  {
    key: "games",
    emoji: "🎲",
    title: "Games",
    body: "Play games together and meet new people.",
    gradient: ["#7C3AED", "#9F67F1"],
  },
  {
    key: "founders",
    emoji: "🦋",
    title: "Founders Wall",
    body: "As one of our first members, you'll always have a special place in FriendPlace.",
    gradient: ["#B08800", "#F5C242"],
  },
];

const BUTTERFLY_LOGO = require("../assets/brand/friendplace-app-icon.png");

export default function WelcomeTourScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { c, scale } = useTheme();
  const { width: winW } = useWindowDimensions();
  // The tour is optimised for a comfortable phone width. On tablets we
  // cap the slide width so the copy stays readable and doesn't sprawl.
  const slideWidth = Math.min(winW, 520);

  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);

  const isLast = index === SLIDES.length - 1;

  const goTo = (i: number) => {
    setIndex(i);
    scrollRef.current?.scrollTo({ x: i * slideWidth, animated: true });
  };

  const finish = async () => {
    await markWelcomeTourSeen();
    if (Platform.OS === "web") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).location.assign("/home");
    } else {
      router.replace("/home" as any);
    }
  };

  const onScroll = (e: any) => {
    const x = e?.nativeEvent?.contentOffset?.x ?? 0;
    const i = Math.round(x / slideWidth);
    if (i !== index && i >= 0 && i < SLIDES.length) setIndex(i);
  };

  const brandBar = useMemo(
    () => (
      <View style={styles.brandBar}>
        <Image source={BUTTERFLY_LOGO} style={styles.brandLogo} resizeMode="contain" />
        <View style={{ flexDirection: "row", alignItems: "baseline" }}>
          <Text style={styles.brandFriend}>Friend</Text>
          <Text style={styles.brandPlace}>Place</Text>
        </View>
      </View>
    ),
    []
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.surface, paddingTop: insets.top }}>
      {/* Top bar — brand mark on the left, Skip on the right so it's
          always one tap away regardless of which slide the user is on. */}
      <View style={styles.topBar}>
        {brandBar}
        <View style={{ flex: 1 }} />
        <Pressable
          testID="welcome-tour-skip"
          accessibilityLabel="Skip welcome tour"
          onPress={finish}
          hitSlop={10}
          style={styles.skipPill}
        >
          <Text style={{ color: c.muted, fontWeight: "800", fontSize: 14 * scale, letterSpacing: 0.3 }}>Skip</Text>
        </Pressable>
      </View>

      {/* Horizontal slide pager — snap-scrolling so each slide sits
          perfectly on-screen when swiped. Keeping ScrollView (not
          FlatList) so all 5 slides render up-front and Skip/Next never
          hits a virtual-list loading state. */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        onScrollEndDrag={onScroll}
        contentContainerStyle={{ alignItems: "center" }}
        style={{ flex: 1 }}
        testID="welcome-tour-pager"
      >
        {SLIDES.map((s, i) => (
          <View key={s.key} style={{ width: slideWidth, alignItems: "center", paddingHorizontal: 24 }}>
            <SlideView slide={s} scale={scale} testID={`welcome-tour-slide-${i}`} />
          </View>
        ))}
      </ScrollView>

      {/* Dots — tap to jump; also visually communicates progress. */}
      <View style={styles.dots}>
        {SLIDES.map((s, i) => (
          <Pressable
            key={s.key}
            testID={`welcome-tour-dot-${i}`}
            onPress={() => goTo(i)}
            hitSlop={8}
            style={[
              styles.dot,
              {
                backgroundColor: i === index ? c.brand : c.border,
                width: i === index ? 22 : 8,
              },
            ]}
          />
        ))}
      </View>

      {/* Footer CTA — "Next" on slides 1-4, "Take me to FriendPlace" on
          the final slide (as requested by the product owner). */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16), borderTopColor: c.border }]}>
        <Pressable
          testID="welcome-tour-next"
          onPress={() => (isLast ? finish() : goTo(index + 1))}
          style={({ pressed }) => [
            styles.cta,
            {
              backgroundColor: c.brand,
              opacity: pressed ? 0.85 : 1,
              paddingHorizontal: isLast ? 28 : 40,
            },
          ]}
        >
          <Text style={{ color: c.onBrandPrimary, fontWeight: "900", fontSize: 18 * scale, letterSpacing: 0.3 }}>
            {isLast ? "Take me to FriendPlace" : "Next"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function SlideView({ slide, scale, testID }: { slide: Slide; scale: number; testID: string }) {
  const { c } = useTheme();
  return (
    <View style={styles.slide} testID={testID}>
      {/* Colour-blocked hero — each section gets its own signature
          gradient so users start to associate the colour with the
          destination when they arrive on Home. */}
      <View style={[styles.heroBadge, { backgroundColor: slide.gradient[0] }]}>
        <Text style={styles.heroEmoji}>{slide.emoji}</Text>
      </View>
      <Text style={[styles.slideTitle, { color: c.onSurface, fontSize: 30 * scale }]}>
        {slide.title}
      </Text>
      <Text style={[styles.slideBody, { color: c.muted, fontSize: 17 * scale }]}>
        {slide.body}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 10,
  },
  brandBar: { flexDirection: "row", alignItems: "center", gap: 8 },
  brandLogo: { width: 32, height: 32, borderRadius: 8 },
  brandFriend: { color: "#1E3A7F", fontWeight: "900", fontSize: 20, letterSpacing: -0.3 },
  brandPlace: { color: "#0F766E", fontWeight: "900", fontSize: 20, letterSpacing: -0.3 },
  skipPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },

  slide: {
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
    paddingVertical: 24,
    width: "100%",
    maxWidth: 480,
  },
  heroBadge: {
    width: 168,
    height: 168,
    borderRadius: 84,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0D2A57",
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
    marginBottom: 8,
  },
  heroEmoji: { fontSize: 96 },
  slideTitle: {
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: 0.3,
  },
  slideBody: {
    textAlign: "center",
    lineHeight: 26,
    fontWeight: "500",
    paddingHorizontal: 12,
  },

  dots: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    paddingVertical: 16,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },

  footer: {
    paddingHorizontal: 24,
    paddingTop: 14,
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cta: {
    minHeight: 60,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 240,
    shadowColor: "#0D2A57",
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
});

// Suppress unused import warning on native (Dimensions is a fallback
// reference for future full-screen resize handling on Android).
void Dimensions;
