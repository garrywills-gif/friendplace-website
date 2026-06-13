import React, { useEffect } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, useWindowDimensions } from "react-native";
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
const BRAND_LOGO = require("../assets/brand/youbelong-logo.png");

export default function Welcome() {
  const router = useRouter();
  const { scale } = useTheme();
  const { user, loading, demoLogin } = useAuth();
  const { show } = useToast();
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  // Logo card sized in PIXELS (aspectRatio is unreliable on web)
  const cardW = Math.round(Math.min(winW - 44, 360) * 0.75); // -25%
  const cardH = Math.round((cardW * 853) / 1272); // preserve official aspect

  useEffect(() => {
    if (!loading && user) router.replace("/(tabs)/home");
  }, [loading, user]);

  if (loading) {
    return (
      <View style={[styles.full, { backgroundColor: "#0D2A57", justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator size="large" color="#FFFFFF" />
      </View>
    );
  }

  const handleSocial = async (provider: string) => {
    try {
      show(`Continuing with ${provider}… (demo)`);
      await demoLogin("maggie");
      router.replace("/(tabs)/home");
    } catch {
      show("Try Sign Up instead");
    }
  };

  return (
    <View style={styles.full}>
      {/* Watermark photo behind everything */}
      <Image source={COMMUNITY_BG} style={StyleSheet.absoluteFillObject} contentFit="cover" />

      {/* Navy → bright-teal diagonal brand gradient (semi-transparent so the photo
          shows through as a subtle watermark, matching the brand sample) */}
      <LinearGradient
        colors={[
          "rgba(13, 42, 87, 0.72)",   // deep navy, top-left
          "rgba(30, 58, 127, 0.66)",  // navy
          "rgba(46, 158, 226, 0.58)", // bright blue
          "rgba(45, 212, 191, 0.66)", // teal
          "rgba(64, 209, 124, 0.74)", // green-teal, bottom-right
        ]}
        locations={[0, 0.28, 0.55, 0.82, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        {/* Hero — official logo card */}
        <View style={styles.hero}>
          <View style={[styles.logoCard, { width: cardW, height: cardH }]} testID="welcome-brand">
            <Image
              source={BRAND_LOGO}
              style={{ width: cardW, height: cardH }}
              contentFit="contain"
              transition={150}
            />
          </View>

          <Text style={[styles.tag1, { fontSize: 30.4 * scale }]} testID="welcome-tag-primary">Find Your People.</Text>
          <Text style={[styles.tag2, { fontSize: 19 * scale }]} testID="welcome-tag-secondary">Because You Belong Too.</Text>
          <Text style={[styles.welcomeMsg, { fontSize: 18 * scale }]} testID="welcome-message">
            A friendly place to meet people, join conversations and feel connected.
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
  logoCard: {
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
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
  tag2: { color: "#CCFBF1", textAlign: "center", marginTop: 6, fontWeight: "700" },
  welcomeMsg: {
    color: "rgba(255,255,255,0.96)",
    textAlign: "center",
    marginTop: 14,
    paddingHorizontal: 8,
    lineHeight: 26,
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
