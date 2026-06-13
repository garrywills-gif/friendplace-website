import React, { useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Dimensions } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { api } from "@/src/lib/api";
import SpeakButton from "@/src/components/SpeakButton";

const { width: SCREEN_W } = Dimensions.get("window");

const STEPS = [
  { icon: "\uD83E\uDD8B", title: "Welcome to YouBelong", body: "A warm place to meet new friends, share a chat over coffee, and have a little fun every day. Built for grown-ups who value real connection.", tint: "#0F766E" },
  { icon: "\u2615\uFE0F", title: "The Coffee Lounge", body: "Our virtual living room. Pull up a chair at any open table and join a friendly conversation. No pressure \u2014 leave whenever you like.", tint: "#B45309" },
  { icon: "\uD83E\uDD8B", title: "Flutters", body: "A Flutter is a gentle wave. Send one to say hello to a friend, or to cheer them on when they finish a tough game.", tint: "#7C3AED" },
  { icon: "\u2728", title: "Community Points", body: "Earn Community Points for joining in \u2014 playing games, sharing notices, helping others. Collect them to unlock fun badges on your profile.", tint: "#2563EB" },
  { icon: "\uD83D\uDCDD", title: "Community Notice Board", body: "Share local news, ask a question, give a wave, or celebrate a moment. Everyone's welcome. Be kind \u2014 it's our only rule.", tint: "#DB2777" },
  { icon: "\uD83C\uDFAE", title: "Games Hub", body: "Jigsaw, Trivia, Bingo and more. Play at your own pace with four difficulty levels and a Daily Challenge every day.", tint: "#0EA5E9" },
  { icon: "\u267F", title: "Made for everyone", body: "Tap Accessibility Settings any time to make the text bigger, turn on Read Aloud, or switch to High Contrast. Your account, your way.", tint: "#16A34A" },
];

export default function Onboarding() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user, refresh } = useAuth();
  const scrollRef = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const last = page === STEPS.length - 1;

  const goTo = (p: number) => {
    const next = Math.max(0, Math.min(STEPS.length - 1, p));
    setPage(next);
    scrollRef.current?.scrollTo({ x: next * SCREEN_W, animated: true });
  };

  const finish = () => {
    // Navigate FIRST so the user never feels stuck waiting on a network call.
    if (!user?.id) {
      router.replace("/");
    } else {
      router.replace("/home");
    }
    // Mark onboarding complete + refresh auth state in the background.
    if (user?.id) {
      api.completeOnboarding(user.id).catch(() => {});
      refresh?.().catch(() => {});
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", padding: 14, paddingTop: 50 }}>
        <Pressable testID="onboarding-skip" onPress={finish} hitSlop={10} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: c.border }}>
          <Text style={{ color: c.muted, fontWeight: "800", fontSize: 14 * scale }}>Skip</Text>
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / SCREEN_W))}
        contentContainerStyle={{ flexGrow: 1 }}
      >
        {STEPS.map((s, i) => (
          <View key={i} style={[styles.slide, { width: SCREEN_W, paddingHorizontal: 26 }]}>
            <View style={[styles.iconWrap, { backgroundColor: `${s.tint}22`, borderColor: s.tint }]}>
              <Text style={{ fontSize: 92 }}>{s.icon}</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 28 }}>
              <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 28 * scale, textAlign: "center" }}>{s.title}</Text>
              <SpeakButton text={`${s.title}. ${s.body}`} color={c.brand} size={22} testID={`onboarding-speak-${i}`} />
            </View>
            <Text style={{ color: c.muted, fontSize: 17 * scale, lineHeight: 26, textAlign: "center", marginTop: 16 }}>{s.body}</Text>
          </View>
        ))}
      </ScrollView>

      {/* Dots */}
      <View style={styles.dots}>
        {STEPS.map((_, i) => (
          <Pressable key={i} testID={`onboarding-dot-${i}`} onPress={() => goTo(i)} hitSlop={6}>
            <View style={{ width: i === page ? 22 : 10, height: 10, borderRadius: 5, marginHorizontal: 4, backgroundColor: i === page ? c.brand : c.border }} />
          </Pressable>
        ))}
      </View>

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: 30 }]}>
        <Pressable testID="onboarding-back" disabled={page === 0} onPress={() => goTo(page - 1)} hitSlop={10} style={[styles.footBtn, { borderColor: c.border, opacity: page === 0 ? 0.4 : 1 }]}>
          <Ionicons name="chevron-back" size={20} color={c.onSurface} />
          <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 15 * scale, marginLeft: 4 }}>Back</Text>
        </Pressable>
        <Pressable testID={last ? "onboarding-finish" : "onboarding-next"} onPress={() => last ? finish() : goTo(page + 1)} style={[styles.footBtnPrimary, { backgroundColor: c.brand }]}>
          <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 16 * scale }}>{last ? "Let’s go" : "Next"}</Text>
          {!last && <Ionicons name="chevron-forward" size={20} color="#FFF" style={{ marginLeft: 4 }} />}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  slide: { flex: 1, alignItems: "center", justifyContent: "center" },
  iconWrap: { width: 160, height: 160, borderRadius: 80, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  dots: { flexDirection: "row", justifyContent: "center", alignItems: "center", paddingVertical: 16 },
  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingTop: 6 },
  footBtn: { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1 },
  footBtnPrimary: { flexDirection: "row", alignItems: "center", paddingVertical: 14, paddingHorizontal: 28, borderRadius: 999 },
});
