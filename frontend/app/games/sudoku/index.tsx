import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import SpeakButton from "@/src/components/SpeakButton";

type Difficulty = { key: string; label: string; clues: number; points: number; hints: number; max_mistakes: number };

const HOW_TO = "Sudoku. Fill the 9 by 9 grid so every row, column, and 3 by 3 box contains the digits 1 through 9. Tap a cell, then tap a number. Use the pencil mode to jot down candidates. You have 3 mistakes before the game ends.";
const DIFF_TINT: Record<string, string> = { easy: "#16A34A", moderate: "#0EA5E9", hard: "#B45309", nightmare: "#7C3AED" };

export default function SudokuHub() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const [diffs, setDiffs] = useState<Difficulty[]>([]);
  const [daily, setDaily] = useState<any>(null);

  const load = async () => {
    try { const cat: any = await api.sdCatalog(); setDiffs(cat.difficulties || []); } catch {}
    try { setDaily(await api.sdDaily()); } catch {}
  };
  useFocusEffect(useCallback(() => { load(); }, []));

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Sudoku" />
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 60, gap: 14 }}>
        <View style={[styles.intro, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <Text style={{ color: c.brand, fontWeight: "900", letterSpacing: 0.6, fontSize: 12 * scale }}>HOW TO PLAY</Text>
            <SpeakButton text={HOW_TO} color={c.brand} size={22} testID="sd-how-speak" />
          </View>
          <Text style={{ color: c.onSurface, fontSize: 15 * scale, lineHeight: 22 }}>Tap a cell, then tap a number. Use pencil mode to note down options. You have 3 mistakes per puzzle, plus a few hints. Auto-save and TTS included.</Text>
        </View>

        {daily && (
          <Pressable testID="sd-daily" onPress={() => router.push(`/games/sudoku/play?difficulty=${daily.difficulty}&daily=1` as any)} style={[styles.dailyCard, { backgroundColor: c.brand }]}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <View style={[styles.dailyEmoji, { backgroundColor: "#FFFFFF22" }]}><Text style={{ fontSize: 30 }}>🔢</Text></View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ color: "#FFFFFFCC", fontWeight: "800", fontSize: 11 * scale, letterSpacing: 0.6 }}>TODAY&apos;S DAILY</Text>
                <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 19 * scale, marginTop: 2 }}>Daily Sudoku</Text>
                <Text style={{ color: "#FFFFFFCC", fontSize: 13 * scale, marginTop: 2 }}>{daily.difficulty_label} · {daily.clues} clues · keeps your streak going</Text>
              </View>
              <Ionicons name="chevron-forward" size={24} color="#FFF" />
            </View>
          </Pressable>
        )}

        <Text style={[styles.section, { color: c.onSurface, fontSize: 17 * scale }]}>Choose difficulty</Text>
        <View style={styles.diffCol}>
          {diffs.map((d) => {
            const tint = DIFF_TINT[d.key] || c.brand;
            return (
              <Pressable key={d.key} testID={`sd-diff-${d.key}`} onPress={() => router.push(`/games/sudoku/play?difficulty=${d.key}` as any)} style={[styles.diffRow, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
                <View style={[styles.tag, { backgroundColor: tint }]}><Text style={{ color: "#FFF", fontWeight: "900", fontSize: 13 * scale }}>{d.label}</Text></View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 * scale }}>{d.clues} clues · {d.points} points</Text>
                  <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 2 }}>{d.hints} hints · max {d.max_mistakes} mistakes</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={c.muted} />
              </Pressable>
            );
          })}
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
  diffCol: { gap: 10 },
  diffRow: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 16, borderWidth: 1 },
  tag: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
});
