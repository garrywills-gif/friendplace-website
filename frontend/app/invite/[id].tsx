/**
 * /invite/[id] — personal invite landing page.
 *
 * Why this exists:
 *   When someone receives a share link from a friend it currently arrives
 *   as `https://youbelong.app/?ref=<friend_id>` and drops them on the
 *   generic welcome screen. The new flow routes invite links through
 *   `/invite/[friend_id]` so the visitor sees a warm, personalised page —
 *   their friend's name, avatar, Founding Member badge (if applicable) —
 *   BEFORE the generic sign-up screen. That single context-switch lifts
 *   word-of-mouth conversion measurably (per consumer-onboarding research).
 *
 * What it does:
 *   1. Look up the inviter via GET /api/users/{id}.
 *   2. Stash the inviter id in AsyncStorage under "youbelong.invite.ref"
 *      so the existing signup + waitlist screens can read it and credit
 *      the inviter at account creation time. (Same key the welcome screen
 *      already writes — keeps the contract consistent.)
 *   3. Render a warm hero: "Margaret invited you to join YouBelong" with
 *      their avatar + Founder badge + the live "X spots remaining" copy.
 *   4. Surface the two next-steps: "Create my profile" (primary) and
 *      "I already have an account" (secondary → /auth/login).
 *   5. If the inviter id is invalid or the user has been deleted, the
 *      page degrades gracefully to a friendly generic welcome rather than
 *      showing a scary "User not found" error.
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  ImageBackground,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import AvatarBubble from "@/src/components/AvatarBubble";
import FounderBadge from "@/src/components/FounderBadge";

type Inviter = {
  id: string;
  first_name?: string;
  username?: string;
  avatar?: string;
  is_founder?: boolean;
  founder_number?: number | null;
  suburb?: string;
};

export default function InviteLanding() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, scale } = useTheme();
  const insets = useSafeAreaInsets();

  const [inviter, setInviter] = useState<Inviter | null>(null);
  const [loading, setLoading] = useState(true);
  // Founder counter — adds social-proof scarcity to the invite page so the
  // invited friend immediately understands they're joining as part of a
  // small, intentional founding cohort (not a generic free-for-all).
  const [founder, setFounder] = useState<{ taken: number; cap: number; remaining: number; open: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const refId = (Array.isArray(id) ? id[0] : id) || "";
      if (!refId) {
        if (!cancelled) setLoading(false);
        return;
      }
      // Persist the referrer attribution so /auth/signup picks it up later.
      try {
        await AsyncStorage.setItem("youbelong.invite.ref", refId);
      } catch { /* best-effort */ }
      try {
        const [u, f]: any[] = await Promise.all([
          api.getUser(refId).catch(() => null),
          api.founderStatus().catch(() => null),
        ]);
        if (cancelled) return;
        if (u && u.id) setInviter(u as Inviter);
        if (f) setFounder(f as any);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const displayName = useMemo(() => {
    if (!inviter) return "";
    return inviter.first_name?.trim() || inviter.username || "A friend";
  }, [inviter]);

  const headline = inviter ? `${displayName} invited you to join YouBelong` : "Welcome to YouBelong";
  // Founder-aware tagline — if the inviter is a Founder it makes the
  // pitch much warmer ("join us as we shape this together").
  const tagline = useMemo(() => {
    if (inviter?.is_founder) {
      return `${displayName} is one of the first Founding Members helping shape YouBelong — and they thought you'd love it too.`;
    }
    if (inviter) {
      return `${displayName} thought you'd love YouBelong — a warm, friendly place to meet new people and stay connected.`;
    }
    return "A warm, friendly place to meet new people and stay connected — built especially for adults living alone.";
  }, [inviter, displayName]);

  function goSignup() {
    // Welcome interstitial coming in the next batch — for now route straight
    // to /auth/signup so the invite flow always lands somewhere real.
    router.replace("/auth/signup" as any);
  }
  function goLogin() {
    router.replace("/auth/login" as any);
  }

  return (
    <ImageBackground
      // Match the main welcome's hero treatment so users feel they've
      // landed somewhere real, not a side-page.
      source={require("@/assets/brand/youbelong-logo.png")}
      style={{ flex: 1, backgroundColor: "#0E1B3D" }}
      imageStyle={{ resizeMode: "cover", opacity: 0.18 }}
    >
      <View style={[styles.overlay, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {loading ? (
            <View style={styles.loader}>
              <ActivityIndicator color="#FFFFFF" />
              <Text style={{ color: "#FFFFFF", marginTop: 10, opacity: 0.85 }}>Loading your invite…</Text>
            </View>
          ) : (
            <>
              <View style={styles.brandRow}>
                <Text style={[styles.brand, { fontSize: 28 * scale }]}>🦋 YouBelong</Text>
              </View>

              {/* Inviter card — the heart of this page. Big avatar + name +
                  Founder crest when relevant. Skipped gracefully when the
                  inviter lookup failed (renders just the headline). */}
              {inviter ? (
                <View style={[styles.card, styles.inviterCard]}>
                  <View style={styles.avatarRing}>
                    <AvatarBubble value={inviter.avatar} size={84} textSize={56} />
                  </View>
                  <View style={{ alignItems: "center", marginTop: 10, gap: 6 }}>
                    <FounderBadge user={inviter as any} variant="chip" />
                    {inviter.suburb ? (
                      <Text style={{ color: "rgba(255,255,255,0.75)", fontSize: 13 * scale, fontWeight: "600" }}>
                        📍 {inviter.suburb}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ) : null}

              <Text style={[styles.headline, { fontSize: 30 * scale }]}>
                {headline}
              </Text>
              <Text style={[styles.tagline, { fontSize: 16 * scale }]}>
                {tagline}
              </Text>

              {/* Live Founder counter — same component logic as the main
                  welcome banner, but inside the invite context it doubles as
                  proof to the invited friend that they're joining a small,
                  intentional cohort. */}
              {founder && founder.open && founder.cap > 0 ? (
                <View style={styles.founderBanner}>
                  {founder.taken > 0 ? (
                    <Text style={[styles.founderBannerBody, { fontSize: 15 * scale }]}>
                      🦋 <Text style={{ fontWeight: "900", color: "#FBBF24" }}>{founder.remaining.toLocaleString()}</Text> Founding Member places remaining.
                    </Text>
                  ) : (
                    <Text style={[styles.founderBannerBody, { fontSize: 15 * scale }]}>
                      🦋 You&apos;d join as one of the first <Text style={{ fontWeight: "900", color: "#FBBF24" }}>{founder.cap.toLocaleString()}</Text> Founding Members.
                    </Text>
                  )}
                  <Text style={[styles.founderBannerNote, { fontSize: 12 * scale }]}>
                    Free during testing.
                  </Text>
                </View>
              ) : null}

              <View style={{ height: 8 }} />

              <Pressable
                testID="invite-cta-signup"
                onPress={goSignup}
                style={({ pressed }) => [styles.primaryBtn, { opacity: pressed ? 0.85 : 1 }]}
                accessibilityRole="button"
              >
                <Text style={[styles.primaryBtnText, { fontSize: 18 * scale }]}>
                  {inviter ? `Continue with ${displayName}'s invite` : "Create my profile"}
                </Text>
                <Ionicons name="arrow-forward" size={22} color="#1E3A7F" />
              </Pressable>

              <Pressable
                testID="invite-cta-login"
                onPress={goLogin}
                style={({ pressed }) => [styles.secondaryBtn, { opacity: pressed ? 0.7 : 1 }]}
                accessibilityRole="button"
              >
                <Text style={[styles.secondaryBtnText, { fontSize: 16 * scale }]}>I already have an account</Text>
              </Pressable>

              <Text style={[styles.footer, { fontSize: 12 * scale }]}>
                By continuing you agree to YouBelong&apos;s Community Guidelines. Your invite credit will be linked to {inviter ? `${displayName}` : "your inviter"} after you create your profile.
              </Text>
            </>
          )}
        </ScrollView>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, paddingHorizontal: 20, backgroundColor: "rgba(15,23,42,0.78)" },
  content: { gap: 14, paddingBottom: 16 },
  loader: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80 },
  brandRow: { alignItems: "center", marginBottom: 4 },
  brand: { color: "#FFFFFF", fontWeight: "900", letterSpacing: 0.5 },

  card: { borderRadius: 20, padding: 18, alignItems: "center" },
  inviterCard: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
  },
  avatarRing: {
    width: 110, height: 110, borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderColor: "#FBBF24",
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },

  headline: { color: "#FFFFFF", fontWeight: "900", textAlign: "center", marginTop: 6, lineHeight: 36 },
  tagline: { color: "rgba(255,255,255,0.88)", textAlign: "center", lineHeight: 22 },

  founderBanner: {
    backgroundColor: "rgba(255,255,255,0.10)",
    borderColor: "#FBBF24",
    borderWidth: 1.5,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 18,
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  founderBannerBody: { color: "#FFFFFF", fontWeight: "700", textAlign: "center", lineHeight: 22 },
  founderBannerNote: { color: "#FBBF24", fontWeight: "800", letterSpacing: 0.4, marginTop: 2 },

  primaryBtn: {
    backgroundColor: "#FFFFFF",
    minHeight: 58,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 6,
  },
  primaryBtnText: { color: "#1E3A7F", fontWeight: "900" },
  secondaryBtn: {
    minHeight: 50,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.55)",
  },
  secondaryBtnText: { color: "#FFFFFF", fontWeight: "800" },

  footer: {
    color: "rgba(255,255,255,0.65)",
    textAlign: "center",
    marginTop: 8,
    lineHeight: 18,
  },
});
