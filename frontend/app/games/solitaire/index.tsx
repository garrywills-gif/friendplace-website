import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import { ButterflyCardBack } from "@/src/components/ButterflyCardBack";
import { getCurrentSeason } from "@/src/lib/seasons";

// AsyncStorage key for the Draw 1 vs Draw 3 preference. Persisted so
// the choice sticks across sessions without cluttering server state.
const DRAW_PREF_KEY = "friendplace.solitaire.drawCount";
type DrawCount = 1 | 3;

/**
 * Solitaire landing — the signature "never resets" game per the launch
 * spec. Shows a full-bleed themed card back preview, lifetime wins/plays,
 * and a big "Play now" primary. Season theme flavours the whole screen.
 */
export default function SolitaireHub() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const [stats, setStats] = useState<{ lifetime_wins: number; lifetime_played: number }>({ lifetime_wins: 0, lifetime_played: 0 });
  const [drawCount, setDrawCount] = useState<DrawCount>(3);
  const season = getCurrentSeason();

  // Load the persisted draw preference on mount so the toggle reflects
  // the player's last choice. Default is Draw 3 (the "classic" mode).
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(DRAW_PREF_KEY);
        if (raw === "1") setDrawCount(1);
        else if (raw === "3") setDrawCount(3);
      } catch { /* AsyncStorage rarely fails; just keep the default */ }
    })();
  }, []);

  const chooseDraw = async (n: DrawCount) => {
    setDrawCount(n);
    try { await AsyncStorage.setItem(DRAW_PREF_KEY, String(n)); } catch {}
  };

  useEffect(() => {
    if (!user) return;
    api.solitaireStats(user.id).then((s: any) => setStats({
      lifetime_wins: s.lifetime_wins || 0,
      lifetime_played: s.lifetime_played || 0,
    })).catch(() => {});
  }, [user?.id]);

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Solitaire" emoji="🦋" subtitle={`Klondike · Draw ${drawCount}`} backHref="/games" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        {/* Seasonal hero */}
        <View style={[styles.hero, { backgroundColor: season.felt, borderColor: season.outline }]}>
          <View style={styles.heroBackWrap}>
            {/* Themed butterfly card back preview — branded FriendPlace
                teal + navy with a seasonal accent stripe. */}
            <ButterflyCardBack width={78} height={112} season={season} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: season.outline, fontWeight: "900", letterSpacing: 0.6, fontSize: 12 * scale }}>
              {season.emoji} {season.label.toUpperCase()} · SIGNATURE GAME
            </Text>
            <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 26 * scale, marginTop: 6 }}>Klondike Solitaire</Text>
            <Text style={{ color: "#E2E8F0", fontSize: 14 * scale, marginTop: 4 }}>{season.tagline}</Text>
          </View>
        </View>

        {/* Lifetime counters */}
        <View style={[styles.statCard, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <View style={styles.statBox}>
            <Text style={{ color: c.brand, fontWeight: "900", fontSize: 32 * scale }}>{stats.lifetime_wins}</Text>
            <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 2 }}>Games won</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={{ color: c.brand, fontWeight: "900", fontSize: 32 * scale }}>{stats.lifetime_played}</Text>
            <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 2 }}>Games played</Text>
          </View>
        </View>

        {/* Butterfly Points chip */}
        <View style={[styles.pointsChip, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
          <Text style={{ fontSize: 20 }}>🦋</Text>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 15 * scale }}>Earn Butterfly Points</Text>
            <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 2 }}>+2 for every game played · +10 for every win</Text>
          </View>
        </View>

        {/* Features list */}
        <View style={[styles.featureCard, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 16 * scale, marginBottom: 8 }}>What&apos;s in the game</Text>
          {[
            { icon: "layers", label: `Classic Klondike · Draw ${drawCount} cards` },
            { icon: "arrow-undo", label: "Unlimited Undo — take your time" },
            { icon: "bulb", label: "Hint button when you get stuck" },
            { icon: "sparkles", label: "Auto-complete when you're nearly there" },
            { icon: "leaf", label: `Seasonal card backs — currently ${season.label}` },
          ].map((f) => (
            <View key={f.label} style={styles.featureRow}>
              <Ionicons name={f.icon as any} size={18} color={c.brand} />
              <Text style={{ color: c.onSurface, fontSize: 14 * scale, marginLeft: 10 }}>{f.label}</Text>
            </View>
          ))}
        </View>

        {/* Draw 1 vs Draw 3 toggle — segmented control that persists to
            AsyncStorage. Draw 1 is easier (higher win rate); Draw 3 is
            the "classic" spec. Small helper text explains the trade-off. */}
        <View style={[styles.drawCard, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 15 * scale }}>Draw style</Text>
          <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 2 }}>
            Draw 1 is a bit easier · Draw 3 is the classic mode
          </Text>
          <View style={styles.drawRow}>
            {([1, 3] as DrawCount[]).map((n) => {
              const active = drawCount === n;
              return (
                <Pressable
                  key={n}
                  testID={`solitaire-draw-${n}`}
                  onPress={() => chooseDraw(n)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [
                    styles.drawPill,
                    {
                      backgroundColor: active ? c.brand : c.surface,
                      borderColor: active ? c.brand : c.border,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <Text style={{
                    color: active ? "#FFFFFF" : c.onSurface,
                    fontWeight: "900",
                    fontSize: 15 * scale,
                  }}>
                    Draw {n}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Play button */}
        <Pressable
          testID="solitaire-play"
          onPress={() => router.push(`/games/solitaire/play?draw=${drawCount}` as any)}
          style={({ pressed }) => [styles.playBtn, { backgroundColor: c.brand, opacity: pressed ? 0.85 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Play Klondike Solitaire"
        >
          <Ionicons name="play" size={22} color="#FFFFFF" />
          <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 17 * scale, marginLeft: 8 }}>Deal a new game</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: 22,
    borderWidth: 1.5,
    minHeight: 128,
  },
  heroBackWrap: { alignItems: "center", justifyContent: "center" },
  cardBackBig: {
    width: 78,
    height: 112,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "#0F172A",
  },
  cardBackDiag: {
    position: "absolute",
    width: "160%",
    height: 22,
    top: "50%",
    left: "-30%",
    transform: [{ rotate: "-20deg" }],
    opacity: 0.55,
  },
  cardBackEmoji: { fontSize: 44 },
  statCard: {
    flexDirection: "row",
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
  },
  statBox: { flex: 1, alignItems: "center" },
  pointsChip: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  featureCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
  },
  featureRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
  drawCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
  },
  drawRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  drawPill: {
    flex: 1,
    minHeight: 48,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  playBtn: {
    minHeight: 56,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
  },
});
