/**
 * /founders/info — Founding Member opt-in page.
 *
 * The gateway that non-founders see when they tap any "Founding Members"
 * entry point (welcome banner, profile tile, etc.). Shows the benefits of
 * joining the cohort and gates access to the Founders Wall + Lounge
 * behind a conscious "Become a Founding Member (Free)" tap.
 *
 * Routing rules (enforced by callers, but defended here too):
 *   - Existing Founders → router replaces straight to /founders (Wall)
 *   - Unauthenticated visitors → see the page; the CTA redirects to signup
 *   - Cohort full → CTA is disabled and copy explains the programme is closed
 *
 * On successful claim:
 *   1. Shows a celebratory "Welcome, Founding Member #N 🦋" toast
 *   2. Refreshes the auth user so badges/points update everywhere
 *   3. Pushes the user to /founders (Wall) where they see their own crest
 */
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Modal,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";

type Benefit = { icon: string; title: string; body: string };

const BENEFITS: Benefit[] = [
  { icon: "🌟", title: "Founder badge",        body: "A permanent crest displayed on your profile so people know you were here from the start." },
  { icon: "🛋️", title: "Founders Lounge",      body: "Exclusive private group + Coffee Lounge table just for Founding Members." },
  { icon: "🦋", title: "Founders Wall",        body: "A permanent place on the wall, numbered in the order you joined." },
  { icon: "💬", title: "Direct line to the team", body: "Your feedback shapes what we build next. We read every message." },
  { icon: "🎁", title: "Early access",          body: "New features land in your app first, before the wider community." },
  { icon: "💛", title: "Free forever",          body: "You'll never be charged once you join. Founders keep their benefits for life." },
];

export default function FounderInfo() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user, token, refresh } = useAuth();
  const { show } = useToast();
  const insets = useSafeAreaInsets();

  const [status, setStatus] = useState<{ taken: number; cap: number; remaining: number; open: boolean } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [claiming, setClaiming] = useState(false);

  // If the visitor is already a Founder, hop them straight to the Wall —
  // they should never see this page (the entry-point router decides this
  // first, but we defend here for deep-links and back-navigation too).
  useEffect(() => {
    if ((user as any)?.is_founder) {
      router.replace("/founders" as any);
    }
  }, [user, router]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s: any = await api.founderStatus();
        if (!cancelled) setStatus(s);
      } catch {
        /* page still works without the live counter */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const isAuthed = !!user && !!token;
  const cohortFull = !!status && !status.open;
  const ctaDisabled = claiming || cohortFull;

  const onPrimaryPress = () => {
    if (!isAuthed) {
      // Visitor hit this page without signing in (e.g. from the welcome
      // screen banner). Send them to signup with a hint that they came
      // here to become a founder so the flow can post-process accordingly.
      router.push("/auth/welcome" as any);
      return;
    }
    if (cohortFull) {
      show("All Founding Member places have been claimed.");
      return;
    }
    setConfirming(true);
  };

  const onConfirmClaim = async () => {
    if (!token) return;
    setClaiming(true);
    try {
      const r: any = await api.claimFounder(token);
      // Pull a fresh user document so badges/points/founder_number
      // propagate across every screen (profile, header, etc.).
      await refresh();
      setConfirming(false);
      show(`Welcome, Founding Member #${r?.founder_number ?? ""} 🦋`);
      router.replace("/founders" as any);
    } catch (e: any) {
      setConfirming(false);
      const msg = String(e?.message || "");
      if (msg.includes("409")) {
        // Already a founder — refresh + go to wall.
        await refresh();
        show("You're already a Founding Member 🦋");
        router.replace("/founders" as any);
      } else if (msg.includes("410")) {
        show("All Founding Member places have been claimed.");
        // refresh status so the page reflects the closed state
        try { const s: any = await api.founderStatus(); setStatus(s); } catch {}
      } else {
        show("Could not join right now. Please try again.");
      }
    } finally {
      setClaiming(false);
    }
  };

  const ctaLabel = (() => {
    if (claiming) return "Joining…";
    if (cohortFull) return "Cohort full";
    if (!isAuthed) return "Sign up & become a Founding Member";
    return "Become a Founding Member (Free)";
  })();

  return (
    <View style={{ flex: 1, backgroundColor: c.surfaceBase }}>
      <Header title="Founding Members" />
      <ScrollView
        contentContainerStyle={{
          padding: 18,
          paddingTop: 12,
          paddingBottom: insets.bottom + 120, // leave room for the sticky CTA
          gap: 16,
        }}
        showsVerticalScrollIndicator={false}
        testID="founder-info-scroll"
      >
        {/* Hero — what is a Founding Member? */}
        <View style={[styles.hero, { backgroundColor: c.brandTertiary, borderColor: "#D4A017" }]}>
          <Text style={{ fontSize: 44, textAlign: "center" }}>🦋</Text>
          <Text
            style={{ color: "#3C2A06", fontWeight: "900", fontSize: 24 * scale, textAlign: "center", marginTop: 6 }}
            testID="founder-info-title"
          >
            Become a Founding Member
          </Text>
          <Text style={{ color: "#5B3F08", fontSize: 15 * scale, textAlign: "center", marginTop: 8, lineHeight: 22 }}>
            Help shape YouBelong from the very beginning. Founding Members are the heart of our community — recognised, celebrated and rewarded.
          </Text>
          {status ? (
            <View style={styles.counterPill}>
              <Text style={{ color: "#7C5300", fontWeight: "900", fontSize: 14 * scale, letterSpacing: 0.3 }}>
                {status.open
                  ? `${status.remaining.toLocaleString()} of ${status.cap.toLocaleString()} places left`
                  : `${status.cap.toLocaleString()} Founding Members — cohort full`}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Benefits list */}
        <View style={{ gap: 10 }}>
          <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 18 * scale, marginTop: 4 }}>
            What you get
          </Text>
          {BENEFITS.map((b, i) => (
            <View
              key={b.title}
              style={[styles.benefit, { backgroundColor: c.surface, borderColor: c.border }]}
              testID={`founder-benefit-${i}`}
            >
              <Text style={{ fontSize: 28 }}>{b.icon}</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 16 * scale }}>{b.title}</Text>
                <Text style={{ color: c.muted, fontSize: 14 * scale, marginTop: 2, lineHeight: 20 }}>{b.body}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Reassurance footer */}
        <View style={{ alignItems: "center", marginTop: 4, paddingHorizontal: 8 }}>
          <Text style={{ color: c.muted, fontSize: 13 * scale, textAlign: "center", lineHeight: 20 }}>
            Joining is free and takes a second. Your Founder benefits never expire.
          </Text>
        </View>
      </ScrollView>

      {/* Sticky CTA — floats over the scroll so it's always within thumb reach. */}
      <View
        pointerEvents="box-none"
        style={[styles.ctaBar, { paddingBottom: insets.bottom + 12, backgroundColor: c.surface, borderTopColor: c.border }]}
      >
        <Pressable
          testID="founder-claim-cta"
          disabled={ctaDisabled}
          onPress={onPrimaryPress}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
          style={({ pressed }) => [
            styles.cta,
            {
              backgroundColor: cohortFull ? c.surfaceTertiary : "#1B7A8A",
              opacity: ctaDisabled ? 0.65 : (pressed ? 0.85 : 1),
            },
          ]}
        >
          {claiming ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              <Ionicons name={cohortFull ? "lock-closed" : "sparkles"} size={20} color={cohortFull ? c.muted : "#FFFFFF"} />
              <Text style={{ color: cohortFull ? c.muted : "#FFFFFF", fontWeight: "900", fontSize: 17 * scale }}>
                {ctaLabel}
              </Text>
            </>
          )}
        </Pressable>
        <Pressable
          testID="founder-info-wall-peek"
          onPress={() => router.push("/founders" as any)}
          accessibilityRole="link"
          style={({ pressed }) => [styles.secondary, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={{ color: c.brand, fontWeight: "800", fontSize: 14 * scale }}>
            Peek at the Founders Wall →
          </Text>
        </Pressable>
      </View>

      {/* Confirmation modal — small friction so the choice feels considered. */}
      <Modal
        visible={confirming}
        animationType="fade"
        transparent
        onRequestClose={() => !claiming && setConfirming(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => !claiming && setConfirming(false)}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={[styles.modalCard, { backgroundColor: c.surface, borderColor: c.border }]}
            testID="founder-claim-modal"
          >
            <Text style={{ fontSize: 38, textAlign: "center" }}>🦋</Text>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 20 * scale, textAlign: "center", marginTop: 6 }}>
              Join {status?.taken ? `${status.taken.toLocaleString()} other ` : ""}Founding Member{status?.taken === 1 ? "" : "s"}?
            </Text>
            <Text style={{ color: c.muted, fontSize: 14 * scale, textAlign: "center", marginTop: 8, lineHeight: 20 }}>
              Help shape YouBelong. Free forever — you&apos;ll never be charged once you join.
            </Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
              <Pressable
                testID="founder-claim-cancel"
                disabled={claiming}
                onPress={() => setConfirming(false)}
                style={({ pressed }) => [styles.modalBtn, { borderWidth: 1.5, borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}
              >
                <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 * scale }}>Maybe later</Text>
              </Pressable>
              <Pressable
                testID="founder-claim-confirm"
                disabled={claiming}
                onPress={onConfirmClaim}
                style={({ pressed }) => [styles.modalBtn, { backgroundColor: "#1B7A8A", opacity: claiming ? 0.7 : (pressed ? 0.85 : 1) }]}
              >
                {claiming ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 16 * scale }}>Yes, join</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 22,
    alignItems: "center",
    gap: 2,
  },
  counterPill: {
    marginTop: 14,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: "rgba(212, 160, 23, 0.18)",
    borderWidth: 1,
    borderColor: "#D4A017",
  },
  benefit: {
    flexDirection: "row",
    gap: 14,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
  },
  ctaBar: {
    position: "absolute",
    left: 0, right: 0, bottom: 0,
    paddingHorizontal: 18,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  cta: {
    minHeight: 60,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 22,
  },
  secondary: {
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 22,
  },
  modalCard: {
    width: "100%",
    maxWidth: 460,
    borderRadius: 20,
    borderWidth: 1,
    padding: 22,
  },
  modalBtn: {
    flex: 1,
    minHeight: 52,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
});
