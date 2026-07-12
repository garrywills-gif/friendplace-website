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
 *   1  Accessibility — Large text (available), Speak Instead of Type
 *      + Listen Instead of Read marked "Coming Soon".
 *   2  Privacy & Safety — blocking, reporting, privacy controls.
 *   3  Choose your interests — tap-to-toggle chips.
 *   4  Celebration — brief "You're all set" screen, auto-redirects to
 *      /home after ~1.5s (or on tap).
 *
 * Submits selected interests via POST /api/onboarding/complete on the
 * final step. Skipping interests just sends an empty list.
 */
import React, { useEffect, useRef, useState } from "react";
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
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";

// FriendPlace teal butterfly — the primary brand mark for every step
// header. Using the app icon so the artwork stays consistent with the
// splash/home screens.
const BUTTERFLY_LOGO = require("../assets/brand/friendplace-app-icon-v3.png");

// Feature showcase — the elevator pitch for FriendPlace. Kept short so
// the whole list is scannable at a glance, and larger body type so
// members with reduced vision can read it comfortably.
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

// Accessibility features — Large Text is available today; voice
// features are on the roadmap so we're transparent about that.
const ACCESSIBILITY: { emoji: string; title: string; body: string; badge?: string }[] = [
  { emoji: "🔍", title: "Large text everywhere",    body: "The whole app uses generous type sizes so it's easy to read." },
  { emoji: "🎤", title: "Speak Instead of Type",     body: "Dictate messages, posts and searches with the microphone.", badge: "Coming Soon" },
  { emoji: "🔊", title: "Listen Instead of Read",    body: "Tap the speaker icon to have messages and content read aloud.", badge: "Coming Soon" },
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

const STEP_COUNT = 4; // 4 real steps; the celebration screen is separate.

export default function OnboardingWizard() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { c, scale } = useTheme();
  const { user, refresh } = useAuth() as any;
  const { show } = useToast();

  const [step, setStep] = useState(0);
  const [interests, setInterests] = useState<string[]>([]);
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
        // Suburb / avatar / groups are now optional post-signup — omit them.
        suburb: "",
        suburb_postcode: "",
        suburb_state: "",
        location_visibility: "private",
        avatar: "",
        group_ids: [],
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
    // Auto-redirect after a short beat so the "You're all set" screen
    // feels like a rewarding moment rather than another button-tap.
    setTimeout(goHome, 1600);
  };

  const canNext = step < STEP_COUNT - 1 ? true : true; // interests step allows 0-selected
  const isLast = step === STEP_COUNT - 1;

  const primaryLabel = step === 0 ? "Get Started"
    : isLast ? "Take me to FriendPlace"
    : "Continue";

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
          Step {step + 1} of {STEP_COUNT} · About a minute
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, paddingTop: 6 }}
        keyboardShouldPersistTaps="handled"
      >
        {step === 0 ? <StepWelcome scale={scale} c={c} /> : null}
        {step === 1 ? <StepAccessibility scale={scale} c={c} /> : null}
        {step === 2 ? <StepPrivacy scale={scale} c={c} /> : null}
        {step === 3 ? (
          <StepInterests
            scale={scale}
            c={c}
            interests={interests}
            toggle={toggleInterest}
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

        {step === 3 ? (
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

// ---------- Step 0 — Welcome + Feature Showcase ----------
function StepWelcome({ scale, c }: { scale: number; c: any }) {
  return (
    <View style={{ gap: 14, paddingTop: 6 }}>
      <View style={{ alignItems: "center", paddingTop: 4 }}>
        <Image source={BUTTERFLY_LOGO} style={styles.stepHero} resizeMode="contain" />
      </View>
      <Text style={[styles.stepTitle, { color: c.onSurface, fontSize: 28 * scale }]}>
        Welcome to FriendPlace
      </Text>
      <Text style={[styles.stepBody, { color: c.muted, fontSize: 17 * scale, textAlign: "center" }]}>
        A warm, friendly place for friendship, connection and community.
      </Text>
      <Text style={[styles.sectionLabel, { color: c.onSurface, fontSize: 15 * scale, marginTop: 8 }]}>
        Here&apos;s what you&apos;ll discover:
      </Text>
      <View style={{ gap: 10 }}>
        {FEATURES.map((f) => (
          <View
            key={f.title}
            style={[styles.featureRow, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}
          >
            <Text style={styles.featureEmoji}>{f.emoji}</Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 16 * scale }}>{f.title}</Text>
              <Text style={{ color: c.muted, fontSize: 14 * scale, marginTop: 2, lineHeight: 19 }}>{f.body}</Text>
            </View>
          </View>
        ))}
      </View>
      <Text style={[styles.footerCopy, { color: c.muted, fontSize: 13 * scale }]}>
        Setup only takes about a minute. You can change anything later from your Profile.
      </Text>
    </View>
  );
}

// ---------- Step 1 — Accessibility ----------
function StepAccessibility({ scale, c }: { scale: number; c: any }) {
  return (
    <View style={{ gap: 14, paddingTop: 6 }}>
      <View style={{ alignItems: "center", paddingTop: 4 }}>
        <Text style={{ fontSize: 72 }}>♿</Text>
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

// ---------- Step 2 — Privacy & Safety ----------
function StepPrivacy({ scale, c }: { scale: number; c: any }) {
  return (
    <View style={{ gap: 14, paddingTop: 6 }}>
      <View style={{ alignItems: "center", paddingTop: 4 }}>
        <Text style={{ fontSize: 72 }}>🛡️</Text>
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

// ---------- Step 3 — Choose interests ----------
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
      <View style={{ alignItems: "center", paddingTop: 4 }}>
        <Text style={{ fontSize: 72 }}>💛</Text>
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

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 10,
  },
  brandBar: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandLogo: { width: 38, height: 38, borderRadius: 10 },
  brandFriend: { color: "#1E3A7F", fontWeight: "900", fontSize: 22, letterSpacing: -0.3 },
  brandPlace: { color: "#0F766E", fontWeight: "900", fontSize: 22, letterSpacing: -0.3 },

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
