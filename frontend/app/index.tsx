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

const LOGO = "https://customer-assets.emergentagent.com/job_belong-together/artifacts/8yzov3na_image.png";

export default function Welcome() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user, loading, login } = useAuth();
  const { show } = useToast();
  const insets = useSafeAreaInsets();
  const screenW = Dimensions.get("window").width;
  const logoW = Math.min(screenW - 24, 560);
  const logoH = logoW * 0.55;

  useEffect(() => {
    if (!loading && user) router.replace("/(tabs)/home");
  }, [loading, user]);

  if (loading) {
    return (
      <View style={[styles.full, { backgroundColor: "#000000", justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator size="large" color="#5EEAD4" />
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
    <View style={[styles.full, { backgroundColor: "#000000" }]}>
      {/* Gradient starts at pure BLACK at the top so the logo's black bg blends in seamlessly,
          then flows through deep navy → blue → teal */}
      <LinearGradient
        colors={["#000000", "#000000", "#0B1F3A", "#0E3A6E", "#0E7490", "#0F766E"]}
        locations={[0, 0.30, 0.42, 0.62, 0.82, 1]}
        style={StyleSheet.absoluteFill}
      />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 28 }]}>
        <View style={styles.logoWrap}>
          <Image
            source={LOGO}
            style={{ width: logoW, height: logoH }}
            contentFit="contain"
            testID="welcome-logo"
          />
          <Text style={[styles.tag1, { fontSize: 28 * scale }]} testID="welcome-tag-primary">Find Your People.</Text>
          <Text style={[styles.tag2, { fontSize: 17 * scale }]} testID="welcome-tag-secondary">Because You Belong Too.</Text>
        </View>

        <View style={styles.actions}>
          <Pressable testID="welcome-signup" onPress={() => router.push("/auth/signup")} style={({ pressed }) => [styles.btnPrimary, { opacity: pressed ? 0.85 : 1 }]}>
            <Text style={[styles.btnPrimaryText, { fontSize: 20 * scale }]}>Sign Up</Text>
          </Pressable>
          <Pressable testID="welcome-login" onPress={() => router.push("/auth/login")} style={({ pressed }) => [styles.btnOutline, { opacity: pressed ? 0.85 : 1 }]}>
            <Text style={[styles.btnOutlineText, { fontSize: 20 * scale }]}>Log In</Text>
          </Pressable>

          <View style={styles.divider}>
            <View style={styles.line} />
            <Text style={[styles.orText, { fontSize: 14 * scale }]}>or</Text>
            <View style={styles.line} />
          </View>

          <Pressable testID="welcome-apple" onPress={() => handleSocial("Apple")} style={({ pressed }) => [styles.social, { backgroundColor: "#000", borderColor: "rgba(255,255,255,0.18)", borderWidth: 1, opacity: pressed ? 0.85 : 1 }]}>
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
  content: { paddingHorizontal: 20, flexGrow: 1, justifyContent: "space-between", gap: 16 },
  logoWrap: { alignItems: "center", justifyContent: "center", marginTop: 12, marginBottom: 24 },
  tag1: { fontWeight: "900", textAlign: "center", marginTop: 4, letterSpacing: 0.3, color: "#5EEAD4" },
  tag2: { textAlign: "center", marginTop: 6, fontWeight: "600", color: "#CBD5E1" },
  actions: { gap: 12, marginTop: 16, marginBottom: 8 },
  btnPrimary: { minHeight: 60, borderRadius: 999, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  btnPrimaryText: { color: "#0B1F3A", fontWeight: "800" },
  btnOutline: { minHeight: 60, borderRadius: 999, borderWidth: 2, borderColor: "#5EEAD4", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.06)" },
  btnOutlineText: { color: "#FFFFFF", fontWeight: "800" },
  divider: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 4 },
  line: { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.35)" },
  orText: { color: "rgba(255,255,255,0.85)", fontWeight: "700" },
  social: { minHeight: 60, borderRadius: 999, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  socialText: { fontWeight: "700" },
});
