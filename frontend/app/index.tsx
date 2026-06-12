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
import Button from "@/src/components/Button";

const LOGO = "https://customer-assets.emergentagent.com/job_c6e73a4e-7434-496a-a98e-aa042fe1d5e5/artifacts/k75xx68h_image.png";

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
      <View style={[styles.full, { backgroundColor: c.surface, justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator size="large" color={c.brand} />
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
    <View style={[styles.full, { backgroundColor: "#F0FDFA" }]}>
      <LinearGradient
        colors={["#CCFBF1", "#E0F2FE", "#FFFFFF"]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.logoWrap}>
          <Image source={LOGO} style={styles.logo} contentFit="contain" />
          <Text style={[styles.tag1, { color: "#0F766E", fontSize: 28 * scale }]} testID="welcome-tag-primary">Find Your People.</Text>
          <Text style={[styles.tag2, { color: "#475569", fontSize: 18 * scale }]} testID="welcome-tag-secondary">Because You Belong Too.</Text>
        </View>

        <View style={styles.actions}>
          <Button testID="welcome-signup" label="Sign Up" onPress={() => router.push("/auth/signup")} />
          <Button testID="welcome-login" label="Log In" variant="outline" onPress={() => router.push("/auth/login")} />

          <View style={styles.divider}>
            <View style={[styles.line, { backgroundColor: "#CBD5E1" }]} />
            <Text style={{ color: "#64748B", fontWeight: "700", fontSize: 14 * scale }}>or</Text>
            <View style={[styles.line, { backgroundColor: "#CBD5E1" }]} />
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
  content: { paddingHorizontal: 24, flexGrow: 1, justifyContent: "space-between" },
  logoWrap: { alignItems: "center", marginTop: 32 },
  logo: { width: 280, height: 140, marginBottom: 4 },
  tag1: { fontWeight: "900", textAlign: "center", marginTop: 8, letterSpacing: 0.2 },
  tag2: { textAlign: "center", marginTop: 6, fontWeight: "600" },
  actions: { gap: 12, marginTop: 32, marginBottom: 24 },
  divider: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 8 },
  line: { flex: 1, height: 1 },
  social: {
    minHeight: 60, borderRadius: 999, flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 10,
  },
  socialText: { fontWeight: "700" },
});
