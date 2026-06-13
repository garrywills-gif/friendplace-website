import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import SpeakButton from "@/src/components/SpeakButton";

type Theme = { key: string; label: string; emoji: string; card_count: number };
type Difficulty = { key: string; label: string; cols: number; rows: number; pairs: number; points: number };

const HOW_TO = "Welcome to Memory Match. Tap a card to flip it, then tap a second card. If they match, they stay open. If not, they flip back. Find every pair to win. Tap the speaker for an audio guide. Your progress saves automatically.";
const DIFF_TINT: Record<string, string> = { easy: "#16A34A", moderate: "#0EA5E9", hard: "#B45309", nightmare: "#7C3AED" };

export default function MemoryHub() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const [themes, setThemes] = useState<Theme[]>([]);
  const [diffs, setDiffs] = useState<Difficulty[]>([]);
  const [daily, setDaily] = useState<any>(null);
  const [picked, setPicked] = useState("easy");
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try { const cat: any = await api.mmCatalog(); setThemes(cat.themes || []); setDiffs(cat.difficulties || []); } catch {}
    try { setDaily(await api.mmDaily()); } catch {}
  };
  useFocusEffect(useCallback(() => { load(); }, [user?.id]));

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Memory Match" />
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />} contentContainerStyle={{ padding: 14, paddingBottom: 60, gap: 14 }}>
        <View style={[styles.intro, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <Text style={{ color: c.brand, fontWeight: "900", letterSpacing: 0.6, fontSize: 12 * scale }}>HOW TO PLAY</Text>
            <SpeakButton text={HOW_TO} color={c.brand} size={22} testID="mm-how-speak" />
          </View>
          <Text style={{ color: c.onSurface, fontSize: 15 * scale, lineHeight: 22 }}>Tap two cards. Find the matching pairs. Cards are previewed at the start so you can spot them. Auto-save and TTS included.</Text>
        </View>

        {daily && (
          <Pressable testID="mm-daily" onPress={() => router.push(`/games/memory/play?theme=${daily.theme}&difficulty=${daily.difficulty}&daily=1` as any)} style={[styles.dailyCard, { backgroundColor: c.brand }]}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <View style={[styles.dailyEmoji, { backgroundColor: "#FFFFFF22" }]}><Text style={{ fontSize: 30 }}>{daily.theme_emoji || "🧠"}</Text></View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ color: "#FFFFFFCC", fontWeight: "800", fontSize: 11 * scale, letterSpacing: 0.6 }}>TODAY&apos;S DAILY</Text>
                <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 19 * scale, marginTop: 2 }}>{daily.theme_label}</Text>
                <Text style={{ color: "#FFFFFFCC", fontSize: 13 * scale, marginTop: 2 }}>{daily.difficulty_label} · {daily.pairs} pairs · keeps your streak going</Text>
              </View>
              <Ionicons name="chevron-forward" size={24} color="#FFF" />
            </View>
          </Pressable>
        )}

        <Text style={[styles.section, { color: c.onSurface, fontSize: 17 * scale }]}>Choose difficulty</Text>
        <View style={styles.diffRow}>
          {diffs.map((d) => {
            const on = picked === d.key;
            const tint = DIFF_TINT[d.key] || c.brand;
            return (
              <Pressable key={d.key} testID={`mm-diff-${d.key}`} onPress={() => setPicked(d.key)} style={[styles.diffChip, { backgroundColor: on ? tint : c.surfaceSecondary, borderColor: on ? tint : c.border }]}>
                <Text style={{ color: on ? "#FFF" : c.onSurface, fontWeight: "900", fontSize: 14 * scale }}>{d.label}</Text>
                <Text style={{ color: on ? "#FFFFFFCC" : c.muted, fontSize: 11 * scale, marginTop: 2 }}>{d.cols}×{d.rows} · {d.pairs} pairs · {d.points} pts</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.section, { color: c.onSurface, fontSize: 17 * scale, marginTop: 4 }]}>Pick a theme</Text>
        <View style={styles.grid}>
          {themes.map((t) => (
            <Pressable key={t.key} testID={`mm-theme-${t.key}`} onPress={() => router.push(`/games/memory/play?theme=${t.key}&difficulty=${picked}` as any)} style={[styles.themeTile, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
              <Text style={{ fontSize: 30 }}>{t.emoji}</Text>
              <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 13 * scale, marginTop: 6, textAlign: "center" }} numberOfLines={2}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { borderRadius: 18, padding: 14, borderWidth: 1.5 },
  dailyCard: { borderRadius: 18, padding: 14 },
  dailyEmoji: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  section: { fontWeight: "900", marginTop: 6 },
  diffRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  diffChip: { flexGrow: 1, minWidth: "47%", borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 12, alignItems: "flex-start" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  themeTile: { width: "31%", aspectRatio: 1, borderRadius: 16, borderWidth: 1, padding: 8, alignItems: "center", justifyContent: "center" },
});
