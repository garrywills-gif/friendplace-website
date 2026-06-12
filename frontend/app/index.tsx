import React, { useEffect } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";

// Warm community photo — older adults sharing coffee and conversation
const COMMUNITY_BG =
  "https://images.unsplash.com/photo-1764173039543-f9f197744e1b?auto=format&fit=crop&w=1200&q=80";

export default function Welcome() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user, loading, login } = useAuth();
  const { show } = useToast();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!loading && user) router.replace("/(tabs)/home");
  }, [loading, user]);

  if (loading) {
    return (
      <View style={[styles.full, { backgroundColor: "#0E7490", justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator size="large" color="#FFFFFF" />
      </View>
    );
  }

  const handleSocial = async (provider: string) => {
    try {
      show(`Continuing with ${provider}…`);
      await login("maggie");
      router.replace("/(tabs)/home");
    } catch {
      show("Try Sign Up instead");
    }
  };

  return (
    <View style={styles.full}>
      {/* Warm community photo background */}
      <Image source={COMMUNITY_BG} style={StyleSheet.absoluteFillObject} contentFit="cover" />
      {/* Stronger blue → teal overlay (+20% opacity) so text reads cleanly
          and the photo softens behind it */}
      <LinearGradient
        colors={[
          "rgba(30, 58, 138, 1.0)",
          "rgba(14, 116, 144, 0.98)",
          "rgba(20, 184, 166, 0.96)",
          "rgba(15, 118, 110, 1.0)",
        ]}
        locations={[0, 0.4, 0.75, 1]}
        style={StyleSheet.absoluteFill}
      />

      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 24 }]}>
        {/* Hero */}
        <View style={styles.hero}>
          {/* Modern flat butterfly — layered teal + blue wings for depth */}
          <View style={styles.butterflyWrap}>
            <MaterialCommunityIcons
              name="butterfly"
              size={104 * scale}
              color="#3B82F6"
              style={styles.butterflyShadow}
            />
            <MaterialCommunityIcons
              name="butterfly"
              size={104 * scale}
              color="#5EEAD4"
              style={styles.butterflyTop}
            />
          </View>
          <Text style={[styles.brand, { fontSize: 48 * scale }]} testID="welcome-brand">YouBelong</Text>
          <Text style={[styles.tag1, { fontSize: 24 * scale }]} testID="welcome-tag-primary">Find Your People.</Text>
          <Text style={[styles.tag2, { fontSize: 17 * scale }]} testID="welcome-tag-secondary">Because You Belong Too.</Text>
          <Text style={[styles.welcomeMsg, { fontSize: 16 * scale }]} testID="welcome-message">
            A friendly place to meet people, join conversations and feel connected.
          </Text>
          <Text style={[styles.featureLine, { fontSize: 15 * scale }]} testID="welcome-features">
            Join conversations, make friends and discover local events.
          </Text>
        </View>

        {/* Actions — sized for older adults, brought up close to the hero */}
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
            <Ionicons name="logo-google" size={24} color="#0F172A" />
            <Text style={[styles.socialText, { color: "#0F172A", fontSize: 18 * scale }]}>Continue with Google</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: "#0E7490" },
  content: { paddingHorizontal: 22, flexGrow: 1, justifyContent: "flex-start", gap: 18 },
  hero: { alignItems: "center", marginTop: 12 },
  butterflyWrap: { width: 110, height: 110, alignItems: "center", justifyContent: "center" },
  butterflyShadow: { position: "absolute", left: 6, top: 4, opacity: 0.7 },
  butterflyTop: { position: "absolute" },
  brand: {
    fontWeight: "900",
    color: "#FFFFFF",
    textAlign: "center",
    letterSpacing: 0.5,
    marginTop: 4,
    textShadowColor: "rgba(0,0,0,0.3)",
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 12,
  },
  tag1: {
    fontWeight: "800",
    color: "#FFFFFF",
    textAlign: "center",
    marginTop: 14,
    letterSpacing: 0.4,
    textShadowColor: "rgba(0,0,0,0.25)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  tag2: { color: "#CCFBF1", textAlign: "center", marginTop: 6, fontWeight: "700" },
  welcomeMsg: {
    color: "rgba(255,255,255,0.94)",
    textAlign: "center",
    marginTop: 18,
    paddingHorizontal: 8,
    lineHeight: 24,
    fontWeight: "500",
  },
  featureLine: {
    color: "#CCFBF1",
    textAlign: "center",
    marginTop: 8,
    paddingHorizontal: 8,
    lineHeight: 22,
    fontWeight: "700",
  },
  actions: { gap: 12, marginTop: 24, marginBottom: 12 },
  btnPrimary: {
    minHeight: 62, borderRadius: 999, backgroundColor: "#FFFFFF",
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  btnPrimaryText: { color: "#0E3A6E", fontWeight: "900", letterSpacing: 0.3 },
  btnOutline: {
    minHeight: 62, borderRadius: 999, borderWidth: 2, borderColor: "rgba(255,255,255,0.9)",
    alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.1)",
  },
  btnOutlineText: { color: "#FFFFFF", fontWeight: "900" },
  divider: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 4 },
  line: { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.4)" },
  orText: { color: "rgba(255,255,255,0.9)", fontWeight: "700" },
  social: {
    minHeight: 58, borderRadius: 999, flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 10,
  },
  socialText: { fontWeight: "700" },
});
