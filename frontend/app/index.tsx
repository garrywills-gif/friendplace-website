import React, { useEffect } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, useWindowDimensions, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";

// Warm photo of 3 adults talking & smiling — sits behind the gradient as a soft watermark
const COMMUNITY_BG =
  "https://images.unsplash.com/photo-1543269865-cbf427effbad?auto=format&fit=crop&w=1400&q=80";

// Official YouBelong brand mark (butterfly + wordmark + people-in-O + tagline)
const BRAND_LOGO = require("../assets/brand/youbelong-logo-tight.png");

export default function Welcome() {
  const router = useRouter();
  const { scale } = useTheme();
  const { user, loading, demoLogin } = useAuth();
  const { show } = useToast();
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  // Logo card sized in PIXELS (aspectRatio is unreliable on web)
  // Logo sizing — butterfly stays in colour, YOUBELONG is now white, and the
  // small "Find your people." subtitle has been cropped out so the headline
  // below does the talking. The cropped logo aspect is roughly 3.7:1.
  const LOGO_ASPECT = 1010 / 270;
  const cardW = Math.round(Math.min(winW - 36, 460));
  const cardH = Math.round(cardW / LOGO_ASPECT);

  useEffect(() => {
    // Capture an invitation token (?ref=<user_id>) into AsyncStorage so the
    // signup screen can attribute the new user back to their inviter. Runs
    // on web only — the QR / link share flow doesn't apply to native deep
    // links here (those would go through a different scheme).
    if (Platform.OS === "web") {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w: any = window;
        const params = new URLSearchParams(w?.location?.search || "");
        const ref = params.get("ref");
        if (ref && /^[A-Za-z0-9_-]{6,64}$/.test(ref)) {
          AsyncStorage.setItem("youbelong.invite.ref", ref).catch(() => {});
        }
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (!loading && user) {
      // Same workaround as /auth/login — router.replace silently no-ops on
      // iPad Safari for tab destinations.
      if (Platform.OS === "web") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).location.assign("/home");
      } else {
        router.replace("/home" as any);
      }
    }
  }, [loading, user]);

  if (loading) {
    return (
      <View style={[styles.full, { backgroundColor: "#0D2A57", justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator size="large" color="#FFFFFF" />
      </View>
    );
  }

  const handleSocial = async (provider: string) => {
    show(`${provider} sign-in is coming soon. Please sign up with email or use Log In for now.`);
  };

  return (
    <View style={styles.full}>
      {/* Watermark photo behind everything */}
      <Image source={COMMUNITY_BG} style={StyleSheet.absoluteFillObject} contentFit="cover" />

      {/* Navy → bright-teal diagonal brand gradient (semi-transparent so the photo
          shows through as a subtle watermark, matching the brand sample) */}
      <LinearGradient
        colors={[
          "rgba(7, 22, 50, 0.86)",    // very deep navy, top-left
          "rgba(18, 41, 92, 0.82)",   // dark navy
          "rgba(28, 95, 142, 0.78)",  // dim blue-teal
          "rgba(20, 120, 110, 0.82)", // muted teal
          "rgba(15, 90, 75, 0.88)",   // deep teal-green, bottom-right
        ]}
        locations={[0, 0.28, 0.55, 0.82, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        {/* Hero — official logo card */}
        <View style={styles.hero}>
          <View style={[styles.logoWrap, { width: cardW, height: cardH }]} testID="welcome-brand">
            <Image
              source={BRAND_LOGO}
              style={{ width: cardW, height: cardH }}
              contentFit="contain"
              transition={150}
            />
          </View>

          <Text style={[styles.miniTag, { fontSize: 12 * scale }]} testID="welcome-mini-tag">
            Friendship  ·  Community  ·  Connection
          </Text>

          <Text style={[styles.tag1, { fontSize: 30.4 * scale }]} testID="welcome-tag-primary">Find Your People.</Text>
          <Text style={[styles.tag2, { fontSize: 22 * scale }]} testID="welcome-tag-secondary">Because You Belong Too.</Text>
          <Text style={[styles.welcomeMsg, { fontSize: 14 * scale }]} testID="welcome-message">
            Meet new friends, join local events and chat with people who share your interests.
          </Text>
        </View>

        <View style={styles.actions}>
          <Pressable testID="welcome-signup" onPress={() => router.push("/auth/signup")} style={({ pressed }) => [styles.btnPrimary, { opacity: pressed ? 0.85 : 1 }]}>
            <Text style={[styles.btnPrimaryText, { fontSize: 22 * scale }]}>Sign Up</Text>
          </Pressable>
          <Pressable testID="welcome-login" onPress={() => router.push("/auth/login")} style={({ pressed }) => [styles.btnOutline, { opacity: pressed ? 0.85 : 1 }]}>
            <Text style={[styles.btnOutlineText, { fontSize: 22 * scale }]}>Log In</Text>
          </Pressable>

          <View style={styles.divider}>
            <View style={styles.line} />
            <Text style={[styles.orText, { fontSize: 14 * scale }]}>or</Text>
            <View style={styles.line} />
          </View>

          <Pressable testID="welcome-apple" onPress={() => handleSocial("Apple")} style={({ pressed }) => [styles.social, { backgroundColor: "#000", opacity: pressed ? 0.85 : 1 }]}>
            <Ionicons name="logo-apple" size={26} color="#FFF" />
            <Text style={[styles.socialText, { color: "#FFF", fontSize: 18 * scale }]}>Continue with Apple</Text>
          </Pressable>
          <Pressable testID="welcome-google" onPress={() => handleSocial("Google")} style={({ pressed }) => [styles.social, { backgroundColor: "#FFFFFF", opacity: pressed ? 0.85 : 1 }]}>
            <Ionicons name="logo-google" size={24} color="#1E3A7F" />
            <Text style={[styles.socialText, { color: "#1E3A7F", fontSize: 18 * scale }]}>Continue with Google</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: "#0D2A57" },
  content: { paddingHorizontal: 22, flexGrow: 1, justifyContent: "flex-start", gap: 14 },
  hero: { alignItems: "center", marginTop: 4 },
  miniTag: {
    color: "rgba(255,255,255,0.78)",
    textAlign: "center",
    marginTop: 12,
    fontWeight: "700",
    letterSpacing: 2.4,
    textTransform: "uppercase",
  },
  logoWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  tag1: {
    fontWeight: "900",
    color: "#FFFFFF",
    textAlign: "center",
    marginTop: 22,
    letterSpacing: 0.3,
    textShadowColor: "rgba(0,0,0,0.25)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  tag2: {
    color: "#CCFBF1",
    textAlign: "center",
    marginTop: 6,
    fontWeight: "700",
    fontStyle: "italic",
    letterSpacing: 0.3,
  },
  welcomeMsg: {
    color: "rgba(255,255,255,0.92)",
    textAlign: "center",
    marginTop: 10,
    paddingHorizontal: 14,
    lineHeight: 19,
    fontWeight: "500",
  },
  actions: { gap: 12, marginTop: 28, marginBottom: 16 },
  btnPrimary: {
    minHeight: 62, borderRadius: 999, backgroundColor: "#FFFFFF",
    alignItems: "center", justifyContent: "center",
    shadowColor: "#0D2A57", shadowOpacity: 0.32, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  btnPrimaryText: { color: "#1E3A7F", fontWeight: "900", letterSpacing: 0.3 },
  btnOutline: {
    minHeight: 62, borderRadius: 999, borderWidth: 2, borderColor: "#FFFFFF",
    alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)",
  },
  btnOutlineText: { color: "#FFFFFF", fontWeight: "900" },
  divider: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 4 },
  line: { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.5)" },
  orText: { color: "#FFFFFF", fontWeight: "700" },
  social: {
    minHeight: 58, borderRadius: 999, flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 10,
  },
  socialText: { fontWeight: "700" },
});
