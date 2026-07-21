/**
 * FriendPlace onboarding wizard — simplified 4-step first-run flow.
 *
 * Redesigned to get people using the app within a minute. Instead of
 * asking for profile data upfront, we introduce what FriendPlace is,
 * cover accessibility + privacy expectations, then collect a single
 * light-touch personalisation (interests). Everything else — suburb,
 * avatar, group joins — moves to an optional "Complete Your Profile"
 * card on the /profile tab.
 *
 * Steps:
 *   0  Welcome — full feature showcase (Coffee Lounge, Find Friends,
 *      Groups, Events, Recipes, Games, Notice Board, Founders Wall).
 *      Uses the teal butterfly logo, older-audience-friendly type.
 *   1  Accessibility — Large text, Speak Instead of Type, and Listen
 *      Instead of Read (all three shipped and available today).
 *   2  Privacy & Safety — blocking, reporting, privacy controls.
 *   3  Choose your interests — tap-to-toggle chips.
 *   4  Celebration — brief "You're all set" screen, auto-redirects to
 *      /home after ~1.5s (or on tap).
 *
 * Submits selected interests via POST /api/onboarding/complete on the
 * final step. Skipping interests just sends an empty list.
 */
import React, { useEffect, useRef, useState } from "react";
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withSequence, withDelay, Easing,
} from "react-native-reanimated";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Platform,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTheme } from "@/src/lib/theme";
import { GeorgeButterflyMark } from "@/src/components/george/GeorgeButterflyMark";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";

// FriendPlace teal butterfly — the primary brand mark for every step
// header. Using the app icon so the artwork stays consistent with the
// splash/home screens.
const BUTTERFLY_LOGO = require("../assets/brand/friendplace-app-icon-v5.png");

// Retained for reference — the original feature-showcase list. Not
// rendered any more; the George-narrated tour below replaces it.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const FEATURES: { emoji: string; title: string; body: string }[] = [
  { emoji: "☕", title: "Coffee Lounge",         body: "Drop into live conversations and chat with friendly faces anytime." },
  { emoji: "🤝", title: "Find Friends",          body: "Browse member profiles and connect with people who share your interests." },
  { emoji: "👥", title: "Friendship Groups",     body: "Join groups based on your interests and meet like-minded people." },
  { emoji: "📅", title: "Local Events",          body: "Discover walks, lunches, meet-ups and community events near you." },
  { emoji: "🍲", title: "Recipes",               body: "Share your favourite recipes and discover new ones from other members." },
  { emoji: "🧩", title: "Games Hub",             body: "Enjoy bingo, crosswords, solitaire, puzzles and more." },
  { emoji: "📌", title: "Community Notice Board", body: "Buy, sell, give away items, ask for help or share community news." },
  { emoji: "🦋", title: "Founders Wall",         body: "Celebrate our founding members — and become one while places remain." },
];

// George-narrated feature tour (Garry, 23 July 2026). Six pages,
// user-paced, before the existing accessibility / privacy / interests /
// groups steps. Copy sits in George's voice — one short sentence in
// the speech bubble, one warm paragraph in the body.
type TourPage = {
  icon: string;
  title: string;
  bubble: string;
  body: string;
  /** Background tint of the illustration hero — makes each page feel
   *  visually distinct at a glance. */
  heroBg: string;
  /** Border colour of the illustration hero. Matches the tint family. */
  heroBorder: string;
  /** Secondary decorations scattered behind the primary icon, so the
   *  page reads as more than "big emoji in a rectangle". */
  decorations: string[];
};
const TOUR_STEPS: TourPage[] = [
  {
    icon: "\u2615", title: "Coffee Lounge",
    bubble: "Let\u2019s start with the Coffee Lounge.",
    body: "It\u2019s a bit like walking into your local caf\u00e9 \u2014 drop in anytime and chat with people who are online.",
    heroBg: "#FEF3E2", heroBorder: "#F5C99B",
    decorations: ["\u2615", "\uD83E\uDD50", "\uD83C\uDF75", "\uD83E\uDDC1"],
  },
  {
    icon: "\uD83E\uDD1D", title: "Find Friends",
    bubble: "Next, let\u2019s look at Find Friends.",
    body: "Discover members with similar interests and send them a friend request. No pressure \u2014 take your time.",
    heroBg: "#E8F3FD", heroBorder: "#93C5FD",
    decorations: ["\uD83D\uDC4B", "\uD83D\uDC96", "\uD83D\uDCAC", "\uD83E\uDD73"],
  },
  {
    icon: "\uD83D\uDC65", title: "Friendship Groups",
    bubble: "Now, Friendship Groups.",
    body: "Groups bring people together around what they love \u2014 walking, books, cooking, gardening, faith, and more.",
    heroBg: "#EFE8FD", heroBorder: "#C4B5FD",
    decorations: ["\uD83D\uDCDA", "\uD83C\uDF31", "\uD83D\uDEB6", "\uD83E\uDD50"],
  },
  {
    icon: "\uD83D\uDCC5", title: "Local Events",
    bubble: "Local Events.",
    body: "Find walks, lunches, meet-ups and community gatherings near you \u2014 and RSVP straight from the app.",
    heroBg: "#E8F7EC", heroBorder: "#86EFAC",
    decorations: ["\uD83D\uDCCD", "\uD83C\uDF7D\uFE0F", "\uD83C\uDF3F", "\u2600\uFE0F"],
  },
  {
    icon: "\uD83C\uDFB2", title: "Games Hub",
    bubble: "The Games Hub.",
    body: "When you feel like a quiet moment, play bingo, crosswords, solitaire or a puzzle. Some you can play with other members too.",
    heroBg: "#FCE7F3", heroBorder: "#F9A8D4",
    decorations: ["\uD83E\uDDE9", "\u2660\uFE0F", "\uD83C\uDFB0", "\uD83C\uDFAF"],
  },
  {
    icon: "\uD83D\uDCCC", title: "Community Notice Board",
    bubble: "And the Community Notice Board.",
    body: "Share news, ask for a hand, or offer something to your community \u2014 like the notice board at your local hall.",
    heroBg: "#FEF9C3", heroBorder: "#FDE047",
    decorations: ["\uD83D\uDCC4", "\uD83D\uDD8A\uFE0F", "\uD83D\uDCE2", "\uD83C\uDFF7\uFE0F"],
  },
];

// Accessibility features — all three are shipped and available today.
// The "Coming Soon" badges used to sit next to the voice features while
// they were stubs; removed once tap-to-dictate landed via whisper-1 and
// tap-to-listen landed via expo-speech + our per-user Accessibility toggles.
const ACCESSIBILITY: { emoji: string; title: string; body: string; badge?: string }[] = [
  { emoji: "🔍", title: "Large text everywhere",    body: "The whole app uses generous type sizes so it's easy to read." },
  { emoji: "🎤", title: "Speak Instead of Type",     body: "Tap the mic in any message box to dictate — your speech is turned into text automatically." },
  { emoji: "🔊", title: "Listen Instead of Read",    body: "Tap the speaker icon on any message or post to have it read aloud." },
];

// Privacy & Safety controls — real features already shipped in the app.
const PRIVACY: { emoji: string; title: string; body: string }[] = [
  { emoji: "🛡️", title: "Privacy controls",   body: "Choose who can see you — Everyone, Friends only, or Invisible. Change it any time." },
  { emoji: "🚫", title: "Block anyone",       body: "Block a member instantly. They can't message you or see your posts." },
  { emoji: "🚨", title: "Report a concern",   body: "Report any post or message. Our team reviews every report." },
  { emoji: "🔒", title: "Your data is safe",  body: "Your email address is never shown to other members. Your location is optional." },
];

// Interest chip set — kept friendly and Australia-leaning to match the
// seed data. 16 keeps the grid balanced on phone widths.
const INTERESTS = [
  "Coffee chats", "Walking & fitness", "Books & films", "Cooking",
  "Gardening", "Travel", "Games & puzzles", "Music",
  "Arts & crafts", "Faith & spirituality", "Volunteering", "Tech help",
  "Pets", "Classic cars", "History", "Local meetups",
];

// Step map — Welcome, six George tour pages, then the existing four.
// Keeping the numeric-index model so we don't need to touch the
// wizard's navigation / progress plumbing.
//   0     George welcome
//   1..6  George feature tour (TOUR_STEPS[step - 1])
//   7     Accessibility
//   8     Privacy
//   9     Interests
//   10    Suggested Groups
const STEP_COUNT = 1 + TOUR_STEPS.length + 4;
const STEP_ACCESSIBILITY = 1 + TOUR_STEPS.length;      // 7
const STEP_PRIVACY       = STEP_ACCESSIBILITY + 1;      // 8
const STEP_INTERESTS     = STEP_ACCESSIBILITY + 2;      // 9
const STEP_GROUPS        = STEP_ACCESSIBILITY + 3;      // 10

// AsyncStorage flag set on onboarding completion; consumed once on the
// next George greeting so he can slip in a warm mention of Georgia.
const GEORGIA_HINT_FLAG = 'george.needs_georgia_hint';

export default function OnboardingWizard() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { c, scale } = useTheme();
  const { user, refresh } = useAuth() as any;
  const { show } = useToast();

  const [step, setStep] = useState(0);
  const [interests, setInterests] = useState<string[]>([]);
  // Suggested groups step — fetched lazily the first time we enter step 4
  // so the endpoint runs against the interests the user just picked.
  // `groupsLoading` shows a spinner while fetching; `selectedGroupIds`
  // tracks which pre-suggested groups the user has ticked for auto-join
  // on completion.
  const [suggestedGroups, setSuggestedGroups] = useState<any[] | null>(null);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Scroll to top whenever the step changes so long steps don't leave
  // the user mid-scroll on the next screen.
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [step]);

  const toggleInterest = (label: string) => {
    setInterests((prev) => (prev.includes(label) ? prev.filter((x) => x !== label) : [...prev, label]));
  };

  const toggleGroup = (id: string) => {
    setSelectedGroupIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // Lazily fetch suggested groups the first time we enter the groups
  // step. We do it inside an effect (not in the button handler) so it
  // also fires when the user navigates back-then-forward, and so the
  // interests-based ranking uses the LATEST interest selection.
  useEffect(() => {
    if (step === STEP_GROUPS && !suggestedGroups && !groupsLoading && user?.id) {
      setGroupsLoading(true);
      // First push the freshly-picked interests up to the backend so the
      // suggested-groups scorer can rank against them. We don't await
      // failure — the endpoint is idempotent and the ranker falls back
      // gracefully to the stored interests if the sync races.
      (async () => {
        try {
          await api.updateProfile(user.id, { interests });
        } catch {}
        try {
          const r: any = await api.onboardingSuggestedGroups(user.id);
          const list = (r?.groups || []) as any[];
          setSuggestedGroups(list);
          // Pre-tick the top 3 great-matches so the user has a
          // sensible default and can just tap "Continue".
          const preSelected = list
            .filter((g: any) => (g.match || 0) > 0)
            .slice(0, 3)
            .map((g: any) => g.id);
          setSelectedGroupIds(preSelected);
        } catch {
          setSuggestedGroups([]);
        } finally {
          setGroupsLoading(false);
        }
      })();
    }
  }, [step, user?.id, interests, suggestedGroups, groupsLoading]);

  const goHome = () => {
    if (Platform.OS === "web") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).location.assign("/home");
    } else {
      router.replace("/home" as any);
    }
  };

  const finishWizard = async () => {
    if (!user?.id) {
      router.replace("/" as any);
      return;
    }
    setBusy(true);
    try {
      await api.onboardingFinish({
        user_id: user.id,
        interests,
        // Suburb / avatar are still optional post-signup — omit them.
        suburb: "",
        suburb_postcode: "",
        suburb_state: "",
        location_visibility: "private",
        avatar: "",
        // Pass through any suggested groups the user ticked. The backend
        // joins them in one atomic $addToSet operation.
        group_ids: selectedGroupIds,
        joined_all: false,
      });
      try { await refresh?.(); } catch {}
    } catch {
      show("Couldn't save your choices. You can update them later from Profile.");
    } finally {
      setBusy(false);
    }
    // Always transition to the celebration screen — even on API error
    // the user gets a warm hand-off and can retry from Profile.
    setCelebrating(true);
    // Set a one-shot flag so George can casually mention Georgia the
    // very first time the member opens the app after onboarding.
    // See `GeorgeButterfly.pickReturningGreeting`.
    AsyncStorage.setItem(GEORGIA_HINT_FLAG, '1').catch(() => {});
    // Auto-redirect after a short beat so the "You're all set" screen
    // feels like a rewarding moment rather than another button-tap.
    setTimeout(goHome, 1600);
  };

  const canNext = step < STEP_COUNT - 1 ? true : true; // interests step allows 0-selected
  const isLast = step === STEP_COUNT - 1;

  // Button copy varies by phase — the tour needs a warm invitation on
  // the welcome step, then a plain "Next" through the six feature pages,
  // then "Continue" through the settings, then a final CTA.
  const primaryLabel =
    step === 0                          ? "Let\u2019s take a quick tour" :
    step >= 1 && step <= TOUR_STEPS.length ? "Next" :
    isLast                              ? "Take me to FriendPlace" :
                                          "Continue";

  // ------- Celebration screen -------
  if (celebrating) {
    return (
      <View style={[styles.celebrateWrap, { backgroundColor: c.brand, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 }}>
          <View style={styles.celebrateBadge}>
            <Text style={{ fontSize: 88 }}>🎉</Text>
          </View>
          <Text style={[styles.celebrateHero, { fontSize: 34 * scale }]}>You&apos;re all set!</Text>
          <Text style={[styles.celebrateHeadline, { fontSize: 22 * scale, marginTop: 12 }]}>Welcome to FriendPlace.</Text>
          <Text style={[styles.celebrateSub, { fontSize: 17 * scale, marginTop: 14 }]}>
            Let&apos;s find your people.
          </Text>
          <ActivityIndicator size="small" color="#FFFFFF" style={{ marginTop: 28 }} />
        </View>
        <Pressable
          onPress={goHome}
          accessibilityLabel="Continue to Home"
          hitSlop={12}
          style={{ alignSelf: "center", paddingVertical: 12 }}
        >
          <Text style={{ color: "rgba(255,255,255,0.75)", fontWeight: "700", fontSize: 14 * scale }}>Tap to continue</Text>
        </Pressable>
      </View>
    );
  }

  // ------- Regular wizard shell -------
  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      {/* Top header — teal butterfly + FriendPlace wordmark + a slim
          progress bar under the wordmark so users always see where they
          are in the flow. Progress excludes the celebration screen. */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={styles.brandBar}>
          <Image source={BUTTERFLY_LOGO} style={styles.brandLogo} resizeMode="contain" />
          <View style={{ flexDirection: "row", alignItems: "baseline" }}>
            <Text style={styles.brandFriend}>Friend</Text>
            <Text style={styles.brandPlace}>Place</Text>
          </View>
        </View>
        <View style={[styles.progressTrack, { backgroundColor: c.border }]}>
          <View
            style={[
              styles.progressFill,
              { backgroundColor: c.brand, width: `${((step + 1) / STEP_COUNT) * 100}%` },
            ]}
          />
        </View>
        <Text style={[styles.progressLabel, { color: c.muted, fontSize: 12 * scale }]}>
          {step === 0
            ? "Welcome \u00b7 About a minute"
            : `Step ${step + 1} of ${STEP_COUNT} \u00b7 About a minute`}
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, paddingTop: 6 }}
        keyboardShouldPersistTaps="handled"
      >
        {step === 0 ? <StepWelcome scale={scale} c={c} /> : null}
        {step >= 1 && step <= TOUR_STEPS.length ? (
          <StepFeatureTour scale={scale} c={c} page={TOUR_STEPS[step - 1]} />
        ) : null}
        {step === STEP_ACCESSIBILITY ? <StepAccessibility scale={scale} c={c} /> : null}
        {step === STEP_PRIVACY       ? <StepPrivacy       scale={scale} c={c} /> : null}
        {step === STEP_INTERESTS ? (
          <StepInterests
            scale={scale}
            c={c}
            interests={interests}
            toggle={toggleInterest}
          />
        ) : null}
        {step === STEP_GROUPS ? (
          <StepGroups
            scale={scale}
            c={c}
            groups={suggestedGroups}
            loading={groupsLoading}
            selectedIds={selectedGroupIds}
            toggle={toggleGroup}
          />
        ) : null}
      </ScrollView>

      {/* Footer — Back / Skip / Continue. Skip is only shown on the
          interests step (opt-out is fine); all other steps are
          quick-read and always want a Continue tap. */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 14), borderTopColor: c.border }]}>
        {step > 0 ? (
          <Pressable
            testID="onb-back"
            onPress={() => setStep((s) => Math.max(0, s - 1))}
            hitSlop={10}
            style={styles.backLink}
          >
            <Ionicons name="chevron-back" size={20} color={c.muted} />
            <Text style={{ color: c.muted, fontWeight: "800", fontSize: 14 * scale }}>Back</Text>
          </Pressable>
        ) : (
          <View style={{ width: 60 }} />
        )}

        {step === STEP_INTERESTS || step === STEP_GROUPS ? (
          <Pressable
            testID="onb-skip"
            onPress={finishWizard}
            hitSlop={10}
            style={{ paddingHorizontal: 12, paddingVertical: 8 }}
          >
            <Text style={{ color: c.muted, fontWeight: "800", fontSize: 14 * scale }}>Skip</Text>
          </Pressable>
        ) : (
          <View style={{ width: 44 }} />
        )}

        <Pressable
          testID="onb-next"
          onPress={() => (isLast ? finishWizard() : setStep((s) => Math.min(STEP_COUNT - 1, s + 1)))}
          disabled={busy || !canNext}
          style={({ pressed }) => [
            styles.cta,
            {
              backgroundColor: c.brand,
              opacity: pressed || busy ? 0.85 : 1,
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={c.onBrandPrimary} />
          ) : (
            <Text style={{ color: c.onBrandPrimary, fontWeight: "900", fontSize: 17 * scale, letterSpacing: 0.3 }}>
              {primaryLabel}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

// ---------- Step 0 — George welcomes you ----------
//
// A companion-first welcome. On mount, George flies out of the brand
// logo at the top-left and settles into the top-right corner — the
// same spot he lives in on every other screen — so members meet him
// exactly where they'll find him later. His speech bubble carries the
// intro copy (Garry, 23 July 2026) and a small info card teaches
// members where he lives and when to tap him.
function StepWelcome({ scale, c }: { scale: number; c: any }) {
  // Reanimated: George flies out of the FriendPlace logo, curves down
  // to the top-right edge of the speech bubble, and perches there —
  // half-off the card so he feels like a companion who's just landed,
  // not a UI element inside a rectangle.
  const tx = useSharedValue(-140);
  const ty = useSharedValue(-90);
  const op = useSharedValue(0);
  const rot = useSharedValue(-18);
  const wingScale = useSharedValue(1);
  const bob = useSharedValue(0);
  const [bubble, setBubble] = useState(false);

  useEffect(() => {
    // Delay so members read "Welcome to FriendPlace" first, THEN
    // George arrives. ~700ms feels warm without being sluggish.
    op.value = withDelay(700, withTiming(1, { duration: 500 }));
    tx.value = withDelay(700, withTiming(0, { duration: 900, easing: Easing.out(Easing.cubic) }));
    ty.value = withDelay(700, withTiming(0, { duration: 900, easing: Easing.out(Easing.cubic) }));
    rot.value = withDelay(700, withTiming(0, { duration: 900, easing: Easing.out(Easing.cubic) }));
    // Wing-flap while flying, then a slow perched breathing.
    wingScale.value = withSequence(
      withDelay(700, withTiming(1.15, { duration: 220 })),
      withTiming(0.85, { duration: 220 }),
      withTiming(1.10, { duration: 220 }),
      withTiming(0.95, { duration: 220 }),
      withTiming(1.02, { duration: 900 }),
      withTiming(0.98, { duration: 900 }),
      withTiming(1.02, { duration: 900 }),
      withTiming(0.98, { duration: 900 }),
    );
    // Once he's landed, a tiny vertical bob so he feels alive.
    bob.value = withDelay(1600,
      withSequence(
        withTiming(-2, { duration: 900 }),
        withTiming(0,  { duration: 900 }),
        withTiming(-2, { duration: 900 }),
        withTiming(0,  { duration: 900 }),
        withTiming(-2, { duration: 900 }),
        withTiming(0,  { duration: 900 }),
      ),
    );
    const t = setTimeout(() => setBubble(true), 1650);
    return () => clearTimeout(t);
  }, [op, tx, ty, rot, wingScale, bob]);

  const flyStyle = useAnimatedStyle(() => ({
    opacity: op.value,
    transform: [
      { translateX: tx.value },
      { translateY: ty.value + bob.value },
      { rotate: `${rot.value}deg` },
      { scaleX: wingScale.value },
    ],
  }));

  return (
    <View style={{ gap: 14, paddingTop: 6 }}>
      {/* Welcome hero — brand logo + title. George doesn't animate
          up here anymore; he flies straight down onto the bubble
          so his final resting spot reads as "he just landed to talk
          to you", not "he's in the corner of the screen". */}
      <View style={{ alignItems: "center", paddingTop: 4 }}>
        <Image source={BUTTERFLY_LOGO} style={styles.stepHero} resizeMode="contain" />
      </View>
      <Text style={[styles.stepTitle, { color: c.onSurface, fontSize: 28 * scale }]}>
        Welcome to FriendPlace
      </Text>
      <Text style={[styles.stepBody, { color: c.muted, fontSize: 17 * scale, textAlign: "center" }]}>
        A warm, friendly place for friendship, connection and community.
      </Text>

      {/* George speech bubble with him perched on the top-right edge.
          The wrapper is `overflow: 'visible'` so his little butterfly
          hangs half-off the card like a bird on a windowsill. */}
      {bubble ? (
        <View style={{ position: "relative", overflow: "visible", marginTop: 12 }} testID="onb-george-bubble-wrap">
          <View
            style={[
              styles.georgeBubble,
              { backgroundColor: c.brandTertiary, borderColor: c.brand, paddingTop: 22 },
            ]}
          >
            <View style={styles.georgeBubbleHead}>
              <Text style={{ color: c.brand, fontWeight: "900", letterSpacing: 0.6, fontSize: 13 * scale }}>
                GEORGE
              </Text>
            </View>
            <Text
              testID="onb-george-bubble"
              style={[styles.georgeBubbleText, { color: c.onSurface, fontSize: 16 * scale }]}
            >
              {"Hi, I\u2019m George \uD83D\uDC4B\n\nWelcome to FriendPlace! I\u2019ll be your guide while you\u2019re getting started.\n\nI\u2019ll show you around, answer questions and help you find your way whenever you need me.\n\nYou\u2019ll also meet Georgia. We know the same things \u2014 we just have different personalities, so you can chat with whichever of us feels right for you."}
            </Text>
          </View>
          {/* George perches half-off the top-right edge of the bubble */}
          <Animated.View
            testID="onb-george-butterfly"
            pointerEvents="none"
            style={[
              {
                position: "absolute",
                top: -28,
                right: 12,
                shadowColor: "#000",
                shadowOpacity: 0.15,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 3 },
              },
              flyStyle,
            ]}
          >
            <GeorgeButterflyMark size={64} />
          </Animated.View>
        </View>
      ) : null}

      {/* Info card — separate from George's bubble, teaches members
          where to find the butterfly in day-to-day use. */}
      <View
        testID="onb-need-help-card"
        style={[styles.helpCard, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}
      >
        <Text style={[styles.helpCardTitle, { color: c.onSurface, fontSize: 16 * scale }]}>
          {"\uD83E\uDD8B Need a hand?"}
        </Text>
        <Text style={[styles.helpCardBody, { color: c.muted, fontSize: 14 * scale }]}>
          {"You\u2019ll usually find me (or Georgia) in the top corner of your screen. Just tap the butterfly whenever you\u2019d like some help, aren\u2019t sure where to go, or simply feel like a chat."}
        </Text>
      </View>

      <Text style={[styles.footerCopy, { color: c.muted, fontSize: 13 * scale }]}>
        Setup only takes a couple of minutes. You can change anything later from your Profile.
      </Text>
    </View>
  );
}

// ---------- Steps 1..6 — George-narrated feature tour ----------
//
// User-paced tour (Garry, 23 July 2026): one page per feature, George
// in the corner with a short speech bubble, then a big illustration
// and one warm paragraph. Explicit Next tap — never auto-advances.
function StepFeatureTour({ scale, c, page }: { scale: number; c: any; page: TourPage }) {
  return (
    <View style={{ gap: 14, paddingTop: 6 }}>
      {/* George bubble — anchored top-right so he feels like a companion
          reading over the member's shoulder. */}
      <View style={styles.tourGeorgeRow}>
        <View style={[styles.georgeBubbleTight, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
          <View style={styles.georgeBubbleHead}>
            <GeorgeButterflyMark size={26} />
            <Text style={{ color: c.brand, fontWeight: "900", letterSpacing: 0.6, fontSize: 12 * scale }}>
              GEORGE
            </Text>
          </View>
          <Text style={{ color: c.onSurface, fontSize: 15 * scale, fontWeight: "700", lineHeight: 21 }}>
            {page.bubble}
          </Text>
        </View>
      </View>

      {/* Feature illustration — per-page tint + scattered secondary
          emoji decorations so each page has its own visual signature.
          Members should immediately feel they've moved to a new page. */}
      <View style={[styles.tourHero, { backgroundColor: page.heroBg, borderColor: page.heroBorder }]}>
        {/* Absolute-positioned decorations. Reproducible positions per
            index so the layout is stable, not random. */}
        {page.decorations.map((glyph, i) => (
          <Text
            key={`${i}-${glyph}`}
            style={[
              styles.tourDecoration,
              _decorationPositions[i] ?? { top: 12, left: 12 },
            ]}
          >
            {glyph}
          </Text>
        ))}
        <Text style={{ fontSize: 88 }}>{page.icon}</Text>
      </View>

      <Text style={[styles.stepTitle, { color: c.onSurface, fontSize: 28 * scale }]}>
        {page.title}
      </Text>
      <Text style={[styles.stepBody, { color: c.onSurface, fontSize: 17 * scale, textAlign: "center" }]}>
        {page.body}
      </Text>

      <Text style={[styles.footerCopy, { color: c.muted, fontSize: 13 * scale }]}>
        {"Take your time \u2014 tap Next when you\u2019re ready."}
      </Text>
    </View>
  );
}

// Fixed decoration positions inside the hero card — corners + a couple
// on the inner edges. Rotations add a hand-scattered feel.
const _decorationPositions: { top?: number; left?: number; right?: number; bottom?: number; transform?: { rotate: string }[] }[] = [
  { top: 14,   left: 18,  transform: [{ rotate: "-14deg" }] },
  { top: 18,   right: 22, transform: [{ rotate: "12deg" }] },
  { bottom: 18, left: 22, transform: [{ rotate: "18deg" }] },
  { bottom: 14, right: 18, transform: [{ rotate: "-8deg" }] },
];

// Small helper — a single-line George intro that sits at the top of
// the settings-style steps (Accessibility / Privacy / Interests /
// Groups). Keeps the personality of the tour without repeating the
// full-size bubble on every screen.
function StepGeorgeLine({ text, c, scale }: { text: string; c: any; scale: number }) {
  return (
    <View style={[styles.georgeLine, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
      <GeorgeButterflyMark size={22} />
      <Text style={{ color: c.onSurface, fontSize: 14 * scale, fontWeight: "700", flex: 1, lineHeight: 19 }}>
        {text}
      </Text>
    </View>
  );
}

// ---------- Step 7 — Accessibility ----------
function StepAccessibility({ scale, c }: { scale: number; c: any }) {
  return (
    <View style={{ gap: 14, paddingTop: 6 }}>
      <StepGeorgeLine c={c} scale={scale} text={"Let\u2019s make FriendPlace comfortable for you."} />
      <View style={{ alignItems: "center", paddingTop: 4 }}>
        <Text style={{ fontSize: 72 }}>{"\u267F"}</Text>
      </View>
      <Text style={[styles.stepTitle, { color: c.onSurface, fontSize: 28 * scale }]}>Made for everyone</Text>
      <Text style={[styles.stepBody, { color: c.muted, fontSize: 17 * scale, textAlign: "center" }]}>
        FriendPlace is designed to be easy to use — whatever your comfort level with technology.
      </Text>
      <View style={{ gap: 10, marginTop: 4 }}>
        {ACCESSIBILITY.map((a) => (
          <View
            key={a.title}
            style={[styles.featureRow, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}
          >
            <Text style={styles.featureEmoji}>{a.emoji}</Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 16 * scale }}>{a.title}</Text>
                {a.badge ? (
                  <View style={styles.comingSoon}>
                    <Text style={{ color: "#7C5300", fontWeight: "900", fontSize: 10 * scale, letterSpacing: 0.6 }}>
                      {a.badge.toUpperCase()}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text style={{ color: c.muted, fontSize: 14 * scale, marginTop: 3, lineHeight: 19 }}>{a.body}</Text>
            </View>
          </View>
        ))}
      </View>
      <Text style={[styles.footerCopy, { color: c.muted, fontSize: 13 * scale }]}>
        These features will be available anywhere in the app — not hidden away in Settings.
      </Text>
    </View>
  );
}

// ---------- Step 8 — Privacy & Safety ----------
function StepPrivacy({ scale, c }: { scale: number; c: any }) {
  return (
    <View style={{ gap: 14, paddingTop: 6 }}>
      <StepGeorgeLine c={c} scale={scale} text={"You decide what other members can see."} />
      <View style={{ alignItems: "center", paddingTop: 4 }}>
        <Text style={{ fontSize: 72 }}>{"\uD83D\uDEE1\uFE0F"}</Text>
      </View>
      <Text style={[styles.stepTitle, { color: c.onSurface, fontSize: 28 * scale }]}>You&apos;re in control</Text>
      <Text style={[styles.stepBody, { color: c.muted, fontSize: 17 * scale, textAlign: "center" }]}>
        FriendPlace is a friendly space. You choose who sees you, who can reach you, and what you share.
      </Text>
      <View style={{ gap: 10, marginTop: 4 }}>
        {PRIVACY.map((p) => (
          <View
            key={p.title}
            style={[styles.featureRow, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}
          >
            <Text style={styles.featureEmoji}>{p.emoji}</Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 16 * scale }}>{p.title}</Text>
              <Text style={{ color: c.muted, fontSize: 14 * scale, marginTop: 3, lineHeight: 19 }}>{p.body}</Text>
            </View>
          </View>
        ))}
      </View>
      <Text style={[styles.footerCopy, { color: c.muted, fontSize: 13 * scale }]}>
        All of these controls live under your Profile → Privacy settings.
      </Text>
    </View>
  );
}

// ---------- Step 9 — Choose interests ----------
function StepInterests({
  scale,
  c,
  interests,
  toggle,
}: {
  scale: number;
  c: any;
  interests: string[];
  toggle: (label: string) => void;
}) {
  return (
    <View style={{ gap: 14, paddingTop: 6 }}>
      <StepGeorgeLine c={c} scale={scale} text={"Tell me what you\u2019re interested in."} />
      <View style={{ alignItems: "center", paddingTop: 4 }}>
        <Text style={{ fontSize: 72 }}>{"\uD83D\uDC9B"}</Text>
      </View>
      <Text style={[styles.stepTitle, { color: c.onSurface, fontSize: 28 * scale }]}>What do you love?</Text>
      <Text style={[styles.stepBody, { color: c.muted, fontSize: 17 * scale, textAlign: "center" }]}>
        Tap anything that interests you — we&apos;ll use these to suggest friends, groups and events.
        You can add more or remove any later.
      </Text>
      <View style={styles.chipGrid}>
        {INTERESTS.map((label) => {
          const on = interests.includes(label);
          return (
            <Pressable
              key={label}
              testID={`onb-int-${label}`}
              onPress={() => toggle(label)}
              style={[
                styles.chip,
                {
                  backgroundColor: on ? c.brand : c.surfaceSecondary,
                  borderColor: on ? c.brand : c.border,
                },
              ]}
            >
              <Text style={{ color: on ? c.onBrandPrimary : c.onSurface, fontWeight: "800", fontSize: 15 * scale }}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.footerCopy, { color: c.muted, fontSize: 13 * scale }]}>
        {interests.length ? `${interests.length} picked · Skip is fine too.` : "Pick a few or skip — up to you."}
      </Text>
    </View>
  );
}

// ---------- Step 4 — Suggested Groups ----------
// Shown right after the interests step. Uses the backend's
// /onboarding/suggested-groups endpoint which ranks groups by
// interest-tag overlap so the "great match" ones bubble to the top.
// Great-matches (match > 0) get a green badge and are pre-selected by
// default so a user who taps "Continue" without touching anything still
// lands in FriendPlace with a small starter set of communities.
function StepGroups({
  scale,
  c,
  groups,
  loading,
  selectedIds,
  toggle,
}: {
  scale: number;
  c: any;
  groups: any[] | null;
  loading: boolean;
  selectedIds: string[];
  toggle: (id: string) => void;
}) {
  return (
    <View style={{ gap: 14, paddingTop: 6 }}>
      <StepGeorgeLine c={c} scale={scale} text={"Here are a few groups I think you\u2019ll like."} />
      <View style={{ alignItems: "center", paddingTop: 4 }}>
        <Text style={{ fontSize: 72 }}>{"\uD83D\uDC65"}</Text>
      </View>
      <Text style={[styles.stepTitle, { color: c.onSurface, fontSize: 28 * scale }]}>Join some groups</Text>
      <Text style={[styles.stepBody, { color: c.muted, fontSize: 17 * scale, textAlign: "center" }]}>
        Based on what you love, here are some communities we think you&apos;ll enjoy. Tap any to join —
        you can always leave later.
      </Text>
      {loading ? (
        <View style={{ alignItems: "center", paddingVertical: 30 }}>
          <ActivityIndicator color={c.brand} size="large" />
          <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 10 }}>
            Finding your best matches…
          </Text>
        </View>
      ) : !groups || groups.length === 0 ? (
        <Text style={[styles.footerCopy, { color: c.muted, fontSize: 14 * scale }]}>
          No groups to suggest just yet — you can browse and join from the Friends tab any time.
        </Text>
      ) : (
        <View style={{ gap: 10, marginTop: 4 }}>
          {groups.map((g: any) => {
            const on = selectedIds.includes(g.id);
            const great = (g.match || 0) > 0;
            return (
              <Pressable
                key={g.id}
                testID={`onb-group-${g.id}`}
                onPress={() => toggle(g.id)}
                style={[
                  styles.featureRow,
                  {
                    backgroundColor: on ? c.brandTertiary : c.surfaceSecondary,
                    borderColor: on ? c.brand : c.border,
                    borderWidth: on ? 2 : 1,
                  },
                ]}
              >
                <Text style={styles.featureEmoji}>{g.emoji || "👥"}</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 16 * scale }}>{g.name}</Text>
                    {great ? (
                      <View style={styles.matchBadge}>
                        <Text style={{ color: "#065F46", fontWeight: "900", fontSize: 10 * scale, letterSpacing: 0.6 }}>
                          GREAT MATCH
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  {g.description ? (
                    <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 3, lineHeight: 18 }} numberOfLines={2}>
                      {g.description}
                    </Text>
                  ) : null}
                  <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 4 }}>
                    {g.member_count || 0} member{(g.member_count || 0) === 1 ? "" : "s"}
                  </Text>
                </View>
                {/* Check circle indicates selection status. Big enough
                    for older-user fingers, always visible so the state
                    reads at a glance. */}
                <Ionicons
                  name={on ? "checkmark-circle" : "add-circle-outline"}
                  size={30}
                  color={on ? c.brand : c.muted}
                />
              </Pressable>
            );
          })}
        </View>
      )}
      <Text style={[styles.footerCopy, { color: c.muted, fontSize: 13 * scale }]}>
        {selectedIds.length
          ? `You'll join ${selectedIds.length} group${selectedIds.length === 1 ? "" : "s"} · you can leave anytime.`
          : "Tap any group to join — or skip and browse later from Friends."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 10,
  },
  brandBar: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandLogo: { width: 38, height: 38, borderRadius: 10 },
  brandFriend: { color: "#1E3A7F", fontWeight: "900", fontSize: 22, letterSpacing: -0.3 },
  brandPlace: { color: "#14B8A6", fontWeight: "900", fontSize: 22, letterSpacing: -0.3 },

  progressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    marginTop: 8,
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },
  progressLabel: {
    fontWeight: "700",
    letterSpacing: 0.2,
  },

  stepHero: {
    width: 128,
    height: 128,
    borderRadius: 28,
    marginBottom: 6,
    // Prominent brand mark for every step's hero position.
    shadowColor: "#0D2A57",
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  stepTitle: {
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: 0.2,
  },
  stepBody: {
    lineHeight: 24,
    paddingHorizontal: 4,
  },
  sectionLabel: {
    fontWeight: "900",
    letterSpacing: 0.3,
    marginTop: 4,
  },

  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  featureEmoji: {
    fontSize: 32,
    width: 42,
    textAlign: "center",
  },
  comingSoon: {
    backgroundColor: "#FDE68A",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  // "GREAT MATCH" pill shown on interest-matched suggested groups so the
  // top picks read as an obvious highlight.
  matchBadge: {
    backgroundColor: "#A7F3D0",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },

  chipGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "center",
  },
  chip: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1.5,
  },

  footerCopy: {
    textAlign: "center",
    fontStyle: "italic",
    marginTop: 8,
    marginBottom: 4,
    lineHeight: 19,
  },

  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  backLink: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  cta: {
    minHeight: 54,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    minWidth: 190,
    shadowColor: "#0D2A57",
    shadowOpacity: 0.24,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },

  // ----- George welcome + feature-tour surfaces (Voice-narrated onboarding, Garry, 23 Jul 2026) -----
  georgeBubble: {
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 16,
    marginTop: 4,
    gap: 10,
  },
  georgeBubbleTight: {
    borderRadius: 18,
    borderWidth: 1.5,
    padding: 12,
    gap: 8,
  },
  georgeBubbleHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  georgeBubbleText: {
    fontWeight: "500",
    lineHeight: 23,
  },
  helpCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    gap: 4,
  },
  helpCardTitle: {
    fontWeight: "900",
  },
  helpCardBody: {
    lineHeight: 20,
    marginTop: 2,
  },
  tourGeorgeRow: {
    alignItems: "flex-end",
    paddingRight: 4,
  },
  tourHero: {
    height: 200,
    borderRadius: 22,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    overflow: "hidden",
    position: "relative",
  },
  tourDecoration: {
    position: "absolute",
    fontSize: 28,
    opacity: 0.45,
  },
  georgeLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 14,
    borderWidth: 1,
  },

  // ----- Celebration screen -----
  celebrateWrap: { flex: 1 },
  celebrateBadge: {
    width: 168,
    height: 168,
    borderRadius: 84,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  celebrateHero: { color: "#FFFFFF", fontWeight: "900", textAlign: "center", letterSpacing: 0.5 },
  celebrateHeadline: { color: "#FFFFFF", fontWeight: "800", textAlign: "center" },
  celebrateSub: { color: "rgba(255,255,255,0.9)", textAlign: "center", fontWeight: "600", lineHeight: 24 },
});
