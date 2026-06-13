import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import SpeakButton from "@/src/components/SpeakButton";

type Theme = { key: string; label: string; emoji: string; word_count: number };
type Difficulty = { key: string; label: string; size: number; num_words: number; points: number; hints: number };

const HOW_TO_PLAY = "Welcome to Word Search. Tap the first letter of a word, then tap the last letter. The word will be highlighted if you got it right. Find every word on the list. Tap the speaker to hear the words read aloud. Tap Hint if you need help. Your progress saves automatically, so you can come back any time.";

const DIFFICULTY_TINT: Record<string, string> = {
  easy: "#16A34A",
  moderate: "#0EA5E9",
  hard: "#B45309",
  nightmare: "#7C3AED",
};

export default function WordSearchHub() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const [themes, setThemes] = useState<Theme[]>([]);
  const [difficulties, setDifficulties] = useState<Difficulty[]>([]);
  const [daily, setDaily] = useState<any>(null);
  const [pickedDifficulty, setPickedDifficulty] = useState<string>("easy");
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const cat: any = await api.wsCatalog();
      setThemes(cat.themes || []);
      setDifficulties(cat.difficulties || []);
    } catch {}
    try { setDaily(await api.wsDaily()); } catch {}
  };
  useFocusEffect(useCallback(() => { load(); }, [user?.id]));

  const openTheme = (theme: Theme) => {
    router.push(`/games/wordsearch/play?theme=${theme.key}&difficulty=${pickedDifficulty}` as any);
  };

  const openDaily = () => {
    if (!daily) return;
    router.push(`/games/wordsearch/play?theme=${daily.theme}&difficulty=${daily.difficulty}&daily=1` as any);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Word Search" />
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        contentContainerStyle={{ padding: 14, paddingBottom: 60, gap: 14 }}
      >
        {/* How to play */}
        <View style={[styles.intro, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <Text style={{ color: c.brand, fontWeight: "900", letterSpacing: 0.6, fontSize: 12 * scale }}>HOW TO PLAY</Text>
            <SpeakButton text={HOW_TO_PLAY} color={c.brand} size={22} testID="ws-how-speak" />
          </View>
          <Text style={{ color: c.onSurface, fontSize: 15 * scale, lineHeight: 22 }}>
            Tap the first letter, then the last letter. Words can run left-right, top-down, diagonally, or in reverse on harder levels. Hints, Speak and auto-save are all included.
          </Text>
        </View>

        {/* Daily Word Search */}
        {daily && (
          <Pressable testID="ws-daily" onPress={openDaily} style={[styles.dailyCard, { backgroundColor: c.brand }]}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <View style={[styles.dailyEmoji, { backgroundColor: "#FFFFFF22" }]}>
                <Text style={{ fontSize: 30 }}>{daily.theme_emoji || "🧩"}</Text>
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ color: "#FFFFFFCC", fontWeight: "800", fontSize: 11 * scale, letterSpacing: 0.6 }}>TODAY&apos;S DAILY</Text>
                <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 19 * scale, marginTop: 2 }}>{daily.theme_label}</Text>
                <Text style={{ color: "#FFFFFFCC", fontSize: 13 * scale, marginTop: 2 }}>{daily.difficulty_label} · {daily.words.length} words · keeps your streak going</Text>
              </View>
              <Ionicons name="chevron-forward" size={24} color="#FFF" />
            </View>
          </Pressable>
        )}

        {/* Difficulty picker */}
        <Text style={[styles.section, { color: c.onSurface, fontSize: 17 * scale }]}>Choose difficulty</Text>
        <View style={styles.diffRow}>
          {difficulties.map((d) => {
            const on = pickedDifficulty === d.key;
            const tint = DIFFICULTY_TINT[d.key] || c.brand;
            return (
              <Pressable
                key={d.key}
                testID={`ws-diff-${d.key}`}
                onPress={() => setPickedDifficulty(d.key)}
                style={[styles.diffChip, { backgroundColor: on ? tint : c.surfaceSecondary, borderColor: on ? tint : c.border }]}
              >
                <Text style={{ color: on ? "#FFF" : c.onSurface, fontWeight: "900", fontSize: 14 * scale }}>{d.label}</Text>
                <Text style={{ color: on ? "#FFFFFFCC" : c.muted, fontSize: 11 * scale, marginTop: 2 }}>{d.size}×{d.size} · {d.num_words} words · {d.points} pts</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Themes */}
        <Text style={[styles.section, { color: c.onSurface, fontSize: 17 * scale, marginTop: 4 }]}>Pick a theme</Text>
        <View style={styles.grid}>
          {themes.map((t) => (
            <Pressable
              key={t.key}
              testID={`ws-theme-${t.key}`}
              onPress={() => openTheme(t)}
              style={[styles.themeTile, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}
            >
              <Text style={{ fontSize: 30 }}>{t.emoji}</Text>
              <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 14 * scale, marginTop: 8, textAlign: "center" }} numberOfLines={2}>{t.label}</Text>
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
