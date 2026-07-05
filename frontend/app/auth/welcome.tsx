/**
 * /auth/welcome — the friendly interstitial that sits BEFORE Create Account.
 *
 * Why this exists:
 *   New visitors who tap "Sign Up" from the main welcome screen previously
 *   went straight into an 8-field form. That's overwhelming for the older-
 *   adult audience YouBelong serves. This page softens the landing with a
 *   warm value-prop, a "this only takes ~2 minutes" promise, and a single
 *   clear CTA — *then* routes into the (now 2-step) signup form.
 *
 *   Copy is intentionally short and reassuring, matching the welcome-page
 *   tone. If the visitor arrived via a personal invite (handled by the
 *   /invite/[id] route which stashes a referrer id in AsyncStorage), we
 *   surface a small "You were invited by …" note on this page too so the
 *   warmth carries through.
 */
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ImageBackground,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { api } from "@/src/lib/api";
import AvatarBubble from "@/src/components/AvatarBubble";

export default function AuthWelcome() {
  const router = useRouter();
  const { scale } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, loading } = useAuth();
  const [inviter, setInviter] = useState<any | null>(null);

  // Defense in depth: if a signed-in user lands here (e.g. via browser
  // Back / history.back()), don't strand them on the sign-up interstitial.
  // Bounce straight to Home so it never feels like they've been logged out.
  useEffect(() => {
    if (!loading && user) {
      router.replace("/home" as any);
    }
  }, [loading, user, router]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ref = await AsyncStorage.getItem("youbelong.invite.ref");
        if (!ref) return;
        const u: any = await api.getUser(ref).catch(() => null);
        if (!cancelled && u?.id) setInviter(u);
      } catch { /* no-op */ }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <ImageBackground
      source={require("@/assets/brand/youbelong-logo.png")}
      style={{ flex: 1, backgroundColor: "#0E1B3D" }}
      imageStyle={{ resizeMode: "cover", opacity: 0.18 }}
    >
      <View style={[styles.overlay, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 28 }]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.brandRow}>
            <Text style={[styles.brand, { fontSize: 26 * scale }]}>🦋 YouBelong</Text>
          </View>

          {inviter ? (
            <View style={styles.inviterStripe}>
              <View style={styles.inviterAvatar}>
                <AvatarBubble value={inviter.avatar} size={42} textSize={28} />
              </View>
              <Text style={[styles.inviterText, { fontSize: 14 * scale }]}>
                You were invited by <Text style={{ fontWeight: "900", color: "#FBBF24" }}>{inviter.first_name || inviter.username}</Text>
              </Text>
            </View>
          ) : null}

          <View style={{ alignItems: "center", marginTop: 10 }}>
            <Text style={[styles.hero, { fontSize: 38 * scale }]}>Welcome to YouBelong 🦋</Text>
            <Text style={[styles.tagline, { fontSize: 17 * scale }]}>
              Find new friends, join local events, chat in the Coffee Lounge and connect with people who share your interests.
            </Text>
          </View>

          <View style={styles.timeChip}>
            <Ionicons name="time" size={16} color="#FBBF24" />
            <Text style={[styles.timeChipText, { fontSize: 13 * scale }]}>Creating your profile takes about 2 minutes</Text>
          </View>

          <View style={{ flex: 1 }} />

          <Pressable
            testID="auth-welcome-create"
            onPress={() => router.replace("/auth/signup" as any)}
            style={({ pressed }) => [styles.primaryBtn, { opacity: pressed ? 0.85 : 1 }]}
            accessibilityRole="button"
          >
            <Text style={[styles.primaryBtnText, { fontSize: 19 * scale }]}>Create My Profile</Text>
            <Ionicons name="arrow-forward" size={22} color="#1E3A7F" />
          </Pressable>

          <Pressable
            testID="auth-welcome-login"
            onPress={() => router.replace("/auth/login" as any)}
            style={({ pressed }) => [styles.secondaryBtn, { opacity: pressed ? 0.7 : 1 }]}
            accessibilityRole="link"
          >
            <Text style={[styles.secondaryBtnText, { fontSize: 15 * scale }]}>I already have an account</Text>
          </Pressable>
        </ScrollView>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, paddingHorizontal: 22, backgroundColor: "rgba(15,23,42,0.78)" },
  content: { flexGrow: 1, paddingBottom: 16 },
  brandRow: { alignItems: "center", marginBottom: 4 },
  brand: { color: "#FFFFFF", fontWeight: "900", letterSpacing: 0.5 },

  inviterStripe: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderColor: "rgba(251,191,36,0.55)",
    borderWidth: 1,
    borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14,
    marginTop: 8,
  },
  inviterAvatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center" },
  inviterText: { color: "#FFFFFF", flex: 1, lineHeight: 20 },

  hero: { color: "#FFFFFF", fontWeight: "900", textAlign: "center", lineHeight: 44, marginTop: 20 },
  tagline: { color: "rgba(255,255,255,0.92)", textAlign: "center", lineHeight: 24, marginTop: 14 },

  timeChip: {
    alignSelf: "center",
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(251,191,36,0.15)",
    borderColor: "#FBBF24", borderWidth: 1,
    borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14,
    marginTop: 20,
  },
  timeChipText: { color: "#FBBF24", fontWeight: "800", letterSpacing: 0.3 },

  primaryBtn: {
    backgroundColor: "#FFFFFF",
    minHeight: 62, borderRadius: 999,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    marginTop: 18,
  },
  primaryBtnText: { color: "#1E3A7F", fontWeight: "900" },
  secondaryBtn: {
    minHeight: 48, borderRadius: 999, alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: "rgba(255,255,255,0.55)", marginTop: 12,
  },
  secondaryBtnText: { color: "#FFFFFF", fontWeight: "800" },
});
