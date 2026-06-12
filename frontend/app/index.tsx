import React, { useEffect } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Dimensions, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";

const LOGO = "https://customer-assets.emergentagent.com/job_belong-together/artifacts/8yzov3na_image.png";

export default function Welcome() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user, loading, login } = useAuth();
  const { show } = useToast();
  const insets = useSafeAreaInsets();
  const screenW = Dimensions.get("window").width;
  // hero-sized — fills the upper third of the screen
  const logoW = screenW - 8;
  const logoH = logoW * 0.6;
  const glowSize = logoW * 0.95;

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
      {/* Full-screen blue → teal gradient — NO black anywhere */}
      <LinearGradient
        colors={["#1E3A8A", "#1E5DAA", "#0EA5E9", "#0E7490", "#14B8A6"]}
        locations={[0, 0.28, 0.55, 0.8, 1]}
        style={StyleSheet.absoluteFill}
      />

      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 36, paddingBottom: insets.bottom + 28 }]}>
        <View style={styles.hero}>
          {/* Soft mint glow behind the logo */}
          <View
            pointerEvents="none"
            style={[
              styles.glow,
              { width: glowSize, height: glowSize, borderRadius: glowSize / 2, top: -glowSize * 0.18 },
            ]}
          />
          <View
            pointerEvents="none"
            style={[
              styles.glowInner,
              { width: glowSize * 0.7, height: glowSize * 0.7, borderRadius: (glowSize * 0.7) / 2, top: -glowSize * 0.05 },
            ]}
          />

          {/* Hero logo — mixBlendMode:'screen' removes the logo's black background
              over the gradient, so it reads as a transparent treatment */}
          <Image
            source={LOGO}
            style={[
              { width: logoW, height: logoH },
              // @ts-ignore — mixBlendMode is supported on RN 0.76+ and web
              Platform.OS === "web" ? { mixBlendMode: "screen" } : { mixBlendMode: "screen" as any },
            ]}
            contentFit="contain"
            testID="welcome-logo"
          />

          <Text style={[styles.tag1, { fontSize: 30 * scale }]} testID="welcome-tag-primary">Find Your People.</Text>
          <Text style={[styles.tag2, { fontSize: 18 * scale }]} testID="welcome-tag-secondary">Because You Belong Too.</Text>
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
            <Ionicons name="logo-google" size={24} color="#0F172A" />
            <Text style={[styles.socialText, { color: "#0F172A", fontSize: 18 * scale }]}>Continue with Google</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1 },
  content: { paddingHorizontal: 20, flexGrow: 1, justifyContent: "space-between", gap: 20 },
  hero: { alignItems: "center", justifyContent: "center", marginTop: 8 },
  glow: {
    position: "absolute",
    backgroundColor: "rgba(94, 234, 212, 0.28)",
    ...(Platform.OS === "web" ? ({ filter: "blur(48px)" } as any) : null),
  },
  glowInner: {
    position: "absolute",
    backgroundColor: "rgba(186, 230, 253, 0.35)",
    ...(Platform.OS === "web" ? ({ filter: "blur(32px)" } as any) : null),
  },
  tag1: {
    fontWeight: "900",
    textAlign: "center",
    marginTop: 4,
    letterSpacing: 0.4,
    color: "#FFFFFF",
    textShadowColor: "rgba(0,0,0,0.25)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  tag2: { textAlign: "center", marginTop: 8, fontWeight: "600", color: "#CCFBF1" },
  actions: { gap: 14, marginTop: 8, marginBottom: 8 },
  btnPrimary: {
    minHeight: 64, borderRadius: 999, backgroundColor: "#FFFFFF",
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  btnPrimaryText: { color: "#0E3A6E", fontWeight: "900", letterSpacing: 0.3 },
  btnOutline: {
    minHeight: 64, borderRadius: 999, borderWidth: 2, borderColor: "rgba(255,255,255,0.85)",
    alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)",
  },
  btnOutlineText: { color: "#FFFFFF", fontWeight: "900" },
  divider: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 6 },
  line: { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.35)" },
  orText: { color: "rgba(255,255,255,0.85)", fontWeight: "700" },
  social: {
    minHeight: 60, borderRadius: 999, flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 10,
  },
  socialText: { fontWeight: "700" },
});
