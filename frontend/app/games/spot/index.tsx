import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Switch } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import SpeakButton from "@/src/components/SpeakButton";

type Theme = { key: string; label: string; emoji: string };
type Difficulty = { key: string; label: string; diffs: number; points: number; hints: number; ribbon: boolean };

const HOW_TO = "Spot the Difference. Two pictures, almost the same. Tap on the differences. Use the magnifying glass to zoom in. Take your time, or turn on Beat the Clock for bonus points on Hard and Nightmare puzzles.";
const DIFF_TINT: Record<string, string> = { easy: "#16A34A", moderate: "#0EA5E9", hard: "#B45309", nightmare: "#7C3AED" };

export default function SpotHub() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const [themes, setThemes] = useState<Theme[]>([]);
  const [diffs, setDiffs] = useState<Difficulty[]>([]);
  const [daily, setDaily] = useState<any>(null);
  const [picked, setPicked] = useState("easy");
  const [beatClock, setBeatClock] = useState(false);
  const [bests, setBests] = useState<any>({});

  const load = async () => {
    try { const cat: any = await api.stdCatalog(); setThemes(cat.themes || []); setDiffs(cat.difficulties || []); } catch {}
    try { setDaily(await api.stdDaily()); } catch {}
    if (user) { try { setBests((await api.stdBests(user.id)) as any); } catch {} }
  };
  useFocusEffect(useCallback(() => { load(); }, [user?.id]));

  const openTheme = (t: Theme) => {
    router.push(`/games/spot/play?theme=${t.key}&difficulty=${picked}&btc=${beatClock ? 1 : 0}` as any);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Spot the Difference" />
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 60, gap: 14 }}>
        <View style={[styles.intro, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <Text style={{ color: c.brand, fontWeight: "900", letterSpacing: 0.6, fontSize: 12 * scale }}>HOW TO PLAY</Text>
            <SpeakButton text={HOW_TO} color={c.brand} size={22} testID="std-how-speak" />
          </View>
          <Text style={{ color: c.onSurface, fontSize: 15 * scale, lineHeight: 22 }}>Tap on the differences between the two pictures. Magnifying glass and zoom included. No timer by default — enjoy at your own pace. Community Points awarded on Hard and Nightmare only.</Text>
        </View>

        {daily && (
          <Pressable testID="std-daily" onPress={() => router.push(`/games/spot/play?theme=${daily.theme}&difficulty=${daily.difficulty}&daily=1&btc=${beatClock ? 1 : 0}` as any)} style={[styles.dailyCard, { backgroundColor: c.brand }]}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <View style={[styles.dailyEmoji, { backgroundColor: "#FFFFFF22" }]}><Text style={{ fontSize: 30 }}>{daily.theme_emoji}</Text></View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ color: "#FFFFFFCC", fontWeight: "800", fontSize: 11 * scale, letterSpacing: 0.6 }}>TODAY&apos;S DAILY</Text>
                <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 19 * scale, marginTop: 2 }}>{daily.theme_label}</Text>
                <Text style={{ color: "#FFFFFFCC", fontSize: 13 * scale, marginTop: 2 }}>{daily.difficulty_label} · {daily.diff_count} differences</Text>
              </View>
              <Ionicons name="chevron-forward" size={24} color="#FFF" />
            </View>
          </Pressable>
        )}

        <View style={[styles.btcRow, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 15 * scale }}>⏱️ Beat the Clock</Text>
            <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 2 }}>Optional. Finish under the time bonus for extra points (Hard/Nightmare).</Text>
          </View>
          <Switch testID="std-btc" value={beatClock} onValueChange={setBeatClock} thumbColor={beatClock ? c.brand : "#fff"} />
        </View>

        <Text style={[styles.section, { color: c.onSurface, fontSize: 17 * scale }]}>Choose difficulty</Text>
        <View style={styles.diffRow}>
          {diffs.map((d) => {
            const on = picked === d.key;
            const tint = DIFF_TINT[d.key] || c.brand;
            return (
              <Pressable key={d.key} testID={`std-diff-${d.key}`} onPress={() => setPicked(d.key)} style={[styles.diffChip, { backgroundColor: on ? tint : c.surfaceSecondary, borderColor: on ? tint : c.border }]}>
                <Text style={{ color: on ? "#FFF" : c.onSurface, fontWeight: "900", fontSize: 14 * scale }}>{d.label}</Text>
                <Text style={{ color: on ? "#FFFFFFCC" : c.muted, fontSize: 11 * scale, marginTop: 2 }}>{d.diffs} diffs · {d.points} pts · {d.hints} hints</Text>
              </Pressable>
            );
          })}
        </View>

        {bests && (bests as any).total_completed > 0 && (
          <View style={[styles.bests, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 14 * scale, marginBottom: 6 }}>🏆 Your best times</Text>
            {Object.entries((bests as any).bests || {}).map(([key, v]: any) => (
              <Text key={key} style={{ color: c.muted, fontSize: 13 * scale }}>{key} · {Math.floor((v?.seconds||0)/60)}m {(v?.seconds||0) % 60}s</Text>
            ))}
          </View>
        )}

        <Text style={[styles.section, { color: c.onSurface, fontSize: 17 * scale, marginTop: 4 }]}>Pick a theme</Text>
        <View style={styles.grid}>
          {themes.map((t) => (
            <Pressable key={t.key} testID={`std-theme-${t.key}`} onPress={() => openTheme(t)} style={[styles.themeTile, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
              <Text style={{ fontSize: 32 }}>{t.emoji}</Text>
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
  btcRow: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 14, borderWidth: 1 },
  diffRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  diffChip: { flexGrow: 1, minWidth: "47%", borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 12, alignItems: "flex-start" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  themeTile: { width: "31%", aspectRatio: 1, borderRadius: 16, borderWidth: 1, padding: 8, alignItems: "center", justifyContent: "center" },
  bests: { padding: 12, borderRadius: 14, borderWidth: 1 },
});
