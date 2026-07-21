/**
 * Crossword Hub — Daily Crossword card up top, then level picker with the
 * three puzzles currently rotating per difficulty. The set rotates every
 * 14 days on the server, so the same level shows a fresh trio each
 * fortnight.
 */
import React, { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import Header from "@/src/components/Header";
import SeasonBanner from "@/src/components/SeasonBanner";
import { getCurrentSeason } from "@/src/lib/seasons";
import { api } from "@/src/lib/api";

type LevelRow = {
  level: string;
  label: string;
  size: number;
  active_count: number;
  library_total: number;
  points: number;
};

type Puzzle = {
  id: string;
  level: string;
  theme: string;
  size: number;
  grid: (string | null)[][];
  clues: any;
};

const LEVEL_TINTS: Record<string, string> = {
  easy: "#16A34A",
  medium: "#0E7490",
  hard: "#7C3AED",
  expert: "#B45309",
};

export default function CrosswordHub() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const [levels, setLevels] = useState<LevelRow[]>([]);
  const [puzzlesByLevel, setPuzzlesByLevel] = useState<Record<string, Puzzle[]>>({});
  const [daily, setDaily] = useState<{ date: string; puzzle: Puzzle; points: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [lvlData, dailyData] = await Promise.all([
        api.xwLevels() as Promise<{ levels: LevelRow[] }>,
        api.xwDaily().catch(() => null) as Promise<any>,
      ]);
      setLevels(lvlData?.levels || []);
      if (dailyData) {
        setDaily({ date: dailyData.date, puzzle: dailyData.puzzle, points: dailyData.points });
      }
      const buckets = await Promise.all(
        (lvlData?.levels || []).map(async (l: LevelRow) => {
          const d: any = await api.xwActive(l.level);
          return [l.level, d?.puzzles || []] as const;
        })
      );
      setPuzzlesByLevel(Object.fromEntries(buckets));
    } catch {
      // Silent failure — the hub falls back to a loading state.
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Crossword" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 16 }}>
        <SeasonBanner season={getCurrentSeason()} prefix="Crossword" c={c} scale={scale} />
        {/* Daily — featured at top */}
        {daily && (
          <Pressable
            testID="crossword-daily-card"
            onPress={() => router.push("/games/crossword/play?daily=1" as any)}
            style={({ pressed }) => [styles.dailyCard, {
              backgroundColor: c.brand,
              opacity: pressed ? 0.92 : 1,
            }]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={styles.dailyBadge}>
                <Ionicons name="calendar" size={14} color={c.brand} />
                <Text style={{ color: c.brand, fontWeight: "900", fontSize: 11 * scale, letterSpacing: 0.6 }}>
                  DAILY · TODAY
                </Text>
              </View>
              <View style={[styles.dailyBadge, { backgroundColor: "rgba(255,255,255,0.18)" }]}>
                <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 11 * scale }}>
                  +{daily.points} pts
                </Text>
              </View>
            </View>
            <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 22 * scale, marginTop: 8 }}>
              {daily.puzzle.theme}
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.93)", fontSize: 14 * scale, marginTop: 4, lineHeight: 20 }}>
              Same medium puzzle for everyone today. Solve it, then chat about it in the FP Café {"\u2615"}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 14, gap: 8 }}>
              <View style={[styles.cta, { backgroundColor: "#FFF" }]}>
                <Text style={{ color: c.brand, fontWeight: "900", fontSize: 14 * scale }}>{"Play today\u2019s puzzle"}</Text>
                <Ionicons name="arrow-forward" size={16} color={c.brand} />
              </View>
            </View>
          </Pressable>
        )}

        {/* Intro banner */}
        <View style={[styles.intro, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
          <Text style={{ color: c.brand, fontWeight: "900", letterSpacing: 0.6, fontSize: 12 * scale }}>
            ✏️  PICK A LEVEL
          </Text>
          <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 * scale, marginTop: 4 }}>
            Three fresh themed puzzles per level, every fortnight
          </Text>
          <Text style={{ color: c.onSurface, fontSize: 13 * scale, marginTop: 4, lineHeight: 19 }}>
            Earn points for each puzzle you finish: Easy 5 · Medium 10 · Hard 15 · Expert 25.
          </Text>
        </View>

        {loading && levels.length === 0 ? (
          <View style={{ alignItems: "center", padding: 24 }}>
            <ActivityIndicator color={c.brand} />
          </View>
        ) : (
          levels.map((lvl) => {
            const tint = LEVEL_TINTS[lvl.level] || c.brand;
            const list = puzzlesByLevel[lvl.level] || [];
            return (
              <View key={lvl.level} style={{ gap: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <View style={[styles.levelChip, { backgroundColor: tint }]}>
                    <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 13 * scale, letterSpacing: 0.4 }}>
                      {lvl.label.toUpperCase()}
                    </Text>
                  </View>
                  <Text style={{ color: c.muted, fontSize: 13 * scale }}>
                    {lvl.size}×{lvl.size} · +{lvl.points} pts
                  </Text>
                </View>
                {list.length === 0 ? (
                  <Text style={{ color: c.muted, fontSize: 14 * scale, fontStyle: "italic", paddingHorizontal: 4 }}>
                    Fresh puzzles coming soon.
                  </Text>
                ) : (
                  list.map((p) => (
                    <Pressable
                      key={p.id}
                      testID={`crossword-${p.id}`}
                      onPress={() => router.push(`/games/crossword/play?id=${p.id}` as any)}
                      style={({ pressed }) => [
                        styles.puzzleCard,
                        {
                          backgroundColor: c.surfaceSecondary,
                          borderColor: c.border,
                          opacity: pressed ? 0.88 : 1,
                        },
                      ]}
                    >
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 * scale }} numberOfLines={1}>
                          {p.theme}
                        </Text>
                        <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 2 }}>
                          {p.size}×{p.size} grid · {(p.clues?.across?.length || 0) + (p.clues?.down?.length || 0)} clues
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color={c.muted} />
                    </Pressable>
                  ))
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  dailyCard: { padding: 18, borderRadius: 18 },
  dailyBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#FFF", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
  },
  cta: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
  },
  intro: { padding: 14, borderRadius: 16, borderWidth: 1 },
  levelChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  puzzleCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 56,
  },
});
