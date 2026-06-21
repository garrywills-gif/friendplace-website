/**
 * Crossword Hub — picker showing the 3 puzzles currently active per
 * difficulty level. The set rotates every 14 days on the server, so
 * the same level shows a fresh trio each fortnight.
 *
 * Why MVP-first?
 *   The play screen (grid input, virtual keyboard, reveal letter, check
 *   answers) is a meaty UI of its own. Shipping the hub + the backend
 *   first lets you preview the rotation, theme variety, and clue copy
 *   before we invest in the play surface.
 */
import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import Header from "@/src/components/Header";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

type LevelRow = {
  level: string;
  label: string;
  size: number;
  active_count: number;
  library_total: number;
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
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const lvlRes = await fetch(`${BASE}/api/games/crossword/levels`);
      const lvlData = await lvlRes.json();
      setLevels(lvlData?.levels || []);
      // Fetch active puzzles for each level in parallel so the picker
      // can render the three card-tiles per level immediately.
      const buckets = await Promise.all(
        (lvlData?.levels || []).map(async (l: LevelRow) => {
          const r = await fetch(`${BASE}/api/games/crossword/active/${l.level}`);
          const d = await r.json();
          return [l.level, d?.puzzles || []] as const;
        })
      );
      setPuzzlesByLevel(Object.fromEntries(buckets));
    } catch (e) {
      // Hub falls back to "Loading…" silently; nothing destructive here.
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Crossword" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 16 }}>
        <View style={[styles.intro, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
          <Text style={{ color: c.brand, fontWeight: "900", letterSpacing: 0.6, fontSize: 12 * scale }}>
            ✏️  CROSSWORDS
          </Text>
          <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 18 * scale, marginTop: 4 }}>
            New puzzles every 2 weeks
          </Text>
          <Text style={{ color: c.onSurface, fontSize: 14 * scale, marginTop: 4, lineHeight: 20 }}>
            Pick a difficulty — three fresh themed puzzles per level. Earn 5 Community Points each time you finish one.
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
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={[styles.levelChip, { backgroundColor: tint }]}>
                    <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 13 * scale, letterSpacing: 0.4 }}>
                      {lvl.label.toUpperCase()}
                    </Text>
                  </View>
                  <Text style={{ color: c.muted, fontSize: 13 * scale }}>
                    {lvl.size}×{lvl.size} · {lvl.active_count} active
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
