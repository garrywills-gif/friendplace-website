import React, { useEffect } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Dimensions } from "react-native";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";

const LOGO = "https://customer-assets.emergentagent.com/job_belong-together/artifacts/lwy8fnnd_image.png";

export default function Welcome() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user, loading, login } = useAuth();
  const { show } = useToast();
  const insets = useSafeAreaInsets();
  const screenW = Dimensions.get("window").width;
  const logoW = Math.min(screenW - 16, 560);
  const logoH = logoW * 0.46; // matches the uploaded logo aspect

  useEffect(() => {
    if (!loading && user) router.replace("/(tabs)/home");
  }, [loading, user]);

  if (loading) {
    return (
      <View style={[styles.full, { backgroundColor: "#FFFFFF", justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator size="large" color="#0F766E" />
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
    <View style={[styles.full, { backgroundColor: "#FFFFFF" }]}>
      {/* Soft pale teal → white gradient so the white logo plate
          blends seamlessly into the page */}
      <LinearGradient
        colors={["#FFFFFF", "#FFFFFF", "#F0FDFA", "#CCFBF1"]}
        locations={[0, 0.45, 0.75, 1]}
        style={StyleSheet.absoluteFill}
      />

      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}>
        {/* Hero — uploaded logo on white. Contains "YouBelong" + butterfly + "Find your people." */}
        <View style={styles.hero}>
          <Image
            source={LOGO}
            style={{ width: logoW, height: logoH }}
            contentFit="contain"
            testID="welcome-logo"
          />
          <Text style={[styles.tag2, { fontSize: 18 * scale }]} testID="welcome-tag-secondary">
            Because You Belong Too.
          </Text>
          <Text style={[styles.welcomeMsg, { fontSize: 16 * scale }]} testID="welcome-message">
            A friendly place to meet people, join conversations and feel connected.
          </Text>
          <Text style={[styles.featureLine, { fontSize: 15 * scale }]} testID="welcome-features">
            Join conversations, make friends and discover local events.
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
          <Pressable testID="welcome-google" onPress={() => handleSocial("Google")} style={({ pressed }) => [styles.social, { backgroundColor: "#FFFFFF", borderColor: "#CBD5E1", borderWidth: 1, opacity: pressed ? 0.85 : 1 }]}>
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
  content: { paddingHorizontal: 22, flexGrow: 1, justifyContent: "flex-start", gap: 18 },
  hero: { alignItems: "center", marginTop: 6 },
  tag2: {
    color: "#0F766E",
    textAlign: "center",
    marginTop: 10,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  welcomeMsg: {
    color: "#1E293B",
    textAlign: "center",
    marginTop: 16,
    paddingHorizontal: 8,
    lineHeight: 24,
    fontWeight: "500",
  },
  featureLine: {
    color: "#0F766E",
    textAlign: "center",
    marginTop: 6,
    paddingHorizontal: 8,
    lineHeight: 22,
    fontWeight: "700",
  },
  actions: { gap: 12, marginTop: 18, marginBottom: 8 },
  btnPrimary: {
    minHeight: 62, borderRadius: 999, backgroundColor: "#0E3A6E",
    alignItems: "center", justifyContent: "center",
    shadowColor: "#0E3A6E", shadowOpacity: 0.25, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 5,
  },
  btnPrimaryText: { color: "#FFFFFF", fontWeight: "900", letterSpacing: 0.3 },
  btnOutline: {
    minHeight: 62, borderRadius: 999, borderWidth: 2, borderColor: "#0E3A6E",
    alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF",
  },
  btnOutlineText: { color: "#0E3A6E", fontWeight: "900" },
  divider: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 4 },
  line: { flex: 1, height: 1, backgroundColor: "#CBD5E1" },
  orText: { color: "#64748B", fontWeight: "700" },
  social: {
    minHeight: 58, borderRadius: 999, flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 10,
  },
  socialText: { fontWeight: "700" },
});
