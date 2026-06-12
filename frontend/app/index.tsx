import React, { useEffect } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import PeopleO from "@/src/components/PeopleO";

// A warm photo of people sharing coffee and conversation
const COMMUNITY_BG =
  "https://images.unsplash.com/photo-1543269664-7eef42226a21?auto=format&fit=crop&w=1400&q=80";

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
      <View style={[styles.full, { backgroundColor: "#5EEAD4", justifyContent: "center", alignItems: "center" }]}>
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

  // word "YouBelong" — replace the 'o' in "long" with the PeopleO mark
  const wordmarkSize = 52 * scale;
  const oSize = wordmarkSize * 0.62;

  return (
    <View style={styles.full}>
      {/* Warm photo of people sharing coffee & conversation */}
      <Image source={COMMUNITY_BG} style={StyleSheet.absoluteFillObject} contentFit="cover" />
      {/* Blue → teal overlay matching the requested look */}
      <LinearGradient
        colors={[
          "rgba(30, 64, 175, 0.86)",
          "rgba(14, 116, 144, 0.80)",
          "rgba(20, 184, 166, 0.78)",
          "rgba(45, 212, 191, 0.84)",
        ]}
        locations={[0, 0.35, 0.7, 1]}
        style={StyleSheet.absoluteFill}
      />

      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        {/* Hero */}
        <View style={styles.hero}>
          {/* Wordmark — two people form the 'o' in long */}
          <View style={styles.wordmark} testID="welcome-brand">
            <Text style={[styles.wordmarkText, { fontSize: wordmarkSize }]}>YouBel</Text>
            <View style={{ marginHorizontal: 1, alignItems: "center", justifyContent: "center", height: wordmarkSize }}>
              <PeopleO size={oSize} leftColor="#FFFFFF" rightColor="#CCFBF1" />
            </View>
            <Text style={[styles.wordmarkText, { fontSize: wordmarkSize }]}>ng</Text>
          </View>

          {/* Underline accent */}
          <View style={styles.brandRule} />

          <Text style={[styles.tag1, { fontSize: 24 * scale }]} testID="welcome-tag-primary">Find Your People.</Text>
          <Text style={[styles.tag2, { fontSize: 17 * scale }]} testID="welcome-tag-secondary">Because You Belong Too.</Text>
          <Text style={[styles.welcomeMsg, { fontSize: 16 * scale }]} testID="welcome-message">
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
            <Ionicons name="logo-google" size={24} color="#1E40AF" />
            <Text style={[styles.socialText, { color: "#1E40AF", fontSize: 18 * scale }]}>Continue with Google</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: "#14B8A6" },
  content: { paddingHorizontal: 22, flexGrow: 1, justifyContent: "flex-start", gap: 14 },
  hero: { alignItems: "center", marginTop: 8 },
  butterfly: { color: "#FFFFFF", letterSpacing: 6, opacity: 0.95, textAlign: "center" },
  wordmark: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 4,
  },
  wordmarkText: {
    color: "#FFFFFF",
    fontWeight: "900",
    letterSpacing: 0.5,
    textShadowColor: "rgba(0,0,0,0.18)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  brandRule: { width: 64, height: 3, borderRadius: 2, backgroundColor: "#FFFFFF", marginTop: 14, opacity: 0.9 },
  tag1: {
    fontWeight: "900",
    color: "#FFFFFF",
    textAlign: "center",
    marginTop: 14,
    letterSpacing: 0.3,
  },
  tag2: { color: "#CCFBF1", textAlign: "center", marginTop: 6, fontWeight: "700" },
  welcomeMsg: {
    color: "rgba(255,255,255,0.96)",
    textAlign: "center",
    marginTop: 14,
    paddingHorizontal: 8,
    lineHeight: 24,
    fontWeight: "500",
  },
  actions: { gap: 12, marginTop: 22, marginBottom: 12 },
  btnPrimary: {
    minHeight: 62, borderRadius: 999, backgroundColor: "#FFFFFF",
    alignItems: "center", justifyContent: "center",
    shadowColor: "#0F766E", shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  btnPrimaryText: { color: "#0F766E", fontWeight: "900", letterSpacing: 0.3 },
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
