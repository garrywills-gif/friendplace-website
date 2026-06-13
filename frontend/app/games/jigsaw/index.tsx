import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import SpeakButton from "@/src/components/SpeakButton";

type Puzzle = { id: string; category: string; title: string; url: string };
type Progress = { puzzle_id: string; difficulty: string; percent: number; completed?: boolean };

const INSTRUCTIONS = "Pick a category, choose your puzzle and difficulty. Tap a piece, then tap another to swap them. Match the picture to win. Your progress saves automatically — leave any time and come back later.";

export default function JigsawHub() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const [puzzles, setPuzzles] = useState<Puzzle[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [activeCat, setActiveCat] = useState<string>("All");
  const [daily, setDaily] = useState<{ puzzle: Puzzle; difficulty: string } | null>(null);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [completed, setCompleted] = useState<Progress[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try { const cat: any = await api.jigsawCatalog(); setPuzzles(cat.puzzles || []); setCategories(cat.categories || []); } catch {}
    try { setDaily(await api.jigsawDaily() as any); } catch {}
    if (user) {
      try { const list: Progress[] = await api.jigsawProgress(user.id) as any; const map: Record<string, Progress> = {}; list.forEach((p) => { map[`${p.puzzle_id}_${p.difficulty}`] = p; }); setProgress(map); } catch {}
      try { setCompleted(await api.jigsawCompleted(user.id) as any); } catch {}
      try { setStats(await api.jigsawStats(user.id)); } catch {}
    }
  };

  useFocusEffect(useCallback(() => { load(); }, [user?.id]));

  const surprise = async () => {
    try { const r: any = await api.jigsawRandom(); router.push(`/games/jigsaw/${r.puzzle.id}?d=${r.difficulty}`); } catch {}
  };

  const fmtTime = (s?: number) => {
    if (!s) return "—";
    const m = Math.floor(s / 60); const r = s % 60;
    if (m === 0) return `${r}s`;
    if (m < 60) return `${m}m ${r}s`;
    const h = Math.floor(m / 60); const mm = m % 60;
    return `${h}h ${mm}m`;
  };

  const inProgress = useMemo(() => Object.values(progress).filter((p) => !p.completed && p.percent > 0).sort((a, b) => b.percent - a.percent), [progress]);

  const visiblePuzzles = useMemo(
    () => (activeCat === "All" ? puzzles : puzzles.filter((p) => p.category === activeCat)),
    [activeCat, puzzles]
  );

  const open = (p: Puzzle, diff = "easy") => router.push(`/games/jigsaw/${p.id}?d=${diff}`);

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Jigsaw Puzzles" />
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        contentContainerStyle={{ padding: 14, paddingBottom: 60 }}
      >
        {/* Instructions card with speaker */}
        <View style={[styles.instructions, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <Text style={{ color: c.brand, fontWeight: "900", letterSpacing: 0.6, fontSize: 12 * scale }}>HOW TO PLAY</Text>
            <SpeakButton text={INSTRUCTIONS} color={c.brand} size={22} testID="jigsaw-speak-instructions" />
          </View>
          <Text style={{ color: c.onSurface, fontSize: 15 * scale, lineHeight: 22 }}>{INSTRUCTIONS}</Text>
        </View>

        {/* Daily challenge */}
        {daily && (
          <Pressable testID="jigsaw-daily" onPress={() => open(daily.puzzle, daily.difficulty)} style={[styles.daily, { borderColor: c.brand }]}>
            <Image source={daily.puzzle.url} style={styles.dailyImg} contentFit="cover" />
            <View style={[styles.dailyOverlay, { backgroundColor: "rgba(13,42,87,0.55)" }]}>
              <View style={[styles.dailyPill, { backgroundColor: c.accent }]}>
                <Ionicons name="sparkles" size={14} color={"#0D2A57"} />
                <Text style={{ color: "#0D2A57", fontWeight: "900", letterSpacing: 0.6, fontSize: 11 * scale }}>DAILY PUZZLE</Text>
              </View>
              <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 22 * scale, marginTop: 6 }}>{daily.puzzle.title}</Text>
              <Text style={{ color: "#FFF", fontWeight: "700", fontSize: 14 * scale, opacity: 0.9 }}>{daily.puzzle.category} · {daily.difficulty.toUpperCase()}</Text>
            </View>
          </Pressable>
        )}

        {/* Quick actions: Surprise me */}
        <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
          <Pressable testID="jigsaw-surprise" onPress={surprise} style={[styles.surpriseBtn, { backgroundColor: c.brand }]}>
            <Ionicons name="dice" size={18} color="#FFFFFF" />
            <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 16 * scale }}>Surprise me</Text>
          </Pressable>
        </View>

        {/* Stats panel */}
        {stats && stats.total_completed > 0 && (
          <View style={[styles.statsCard, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
            <Text style={[styles.section, { color: c.onSurface, fontSize: 16 * scale }]}>Your puzzle stats</Text>
            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Text style={{ color: c.brand, fontWeight: "900", fontSize: 22 * scale }}>{stats.total_completed}</Text>
                <Text style={{ color: c.muted, fontSize: 12 * scale }}>Completed</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={{ color: c.brand, fontWeight: "900", fontSize: 22 * scale }}>{stats.total_points}</Text>
                <Text style={{ color: c.muted, fontSize: 12 * scale }}>Points</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={{ color: c.brand, fontWeight: "900", fontSize: 22 * scale }}>{fmtTime(stats.total_seconds)}</Text>
                <Text style={{ color: c.muted, fontSize: 12 * scale }}>Total time</Text>
              </View>
            </View>
            {stats.fastest && (
              <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 4 }}>
                🏆 Fastest: {fmtTime(stats.fastest.duration_seconds)} on {stats.fastest.difficulty}
              </Text>
            )}
          </View>
        )}

        {/* In progress */}
        {inProgress.length > 0 && (
          <View style={{ marginTop: 16 }}>
            <Text style={[styles.section, { color: c.onSurface, fontSize: 18 * scale }]}>Continue playing</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 6 }}>
              {inProgress.map((p) => {
                const puz = puzzles.find((x) => x.id === p.puzzle_id);
                if (!puz) return null;
                return (
                  <Pressable key={`${p.puzzle_id}_${p.difficulty}`} testID={`jigsaw-resume-${p.puzzle_id}`} onPress={() => open(puz, p.difficulty)} style={[styles.resumeCard, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
                    <Image source={puz.url} style={styles.resumeImg} contentFit="cover" />
                    <Text numberOfLines={1} style={{ color: c.onSurface, fontWeight: "800", fontSize: 14 * scale, marginTop: 6 }}>{puz.title}</Text>
                    <View style={[styles.progressBar, { backgroundColor: c.surfaceTertiary }]}>
                      <View style={[styles.progressFill, { backgroundColor: c.brand, width: `${Math.round(p.percent)}%` }]} />
                    </View>
                    <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 2 }}>{Math.round(p.percent)}% · {p.difficulty}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Category filter */}
        <Text style={[styles.section, { color: c.onSurface, fontSize: 18 * scale, marginTop: 16 }]}>Categories</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catsRow}>
          {["All", ...categories].map((cat) => {
            const active = cat === activeCat;
            return (
              <Pressable key={cat} onPress={() => setActiveCat(cat)} style={[styles.catChip, { backgroundColor: active ? c.brand : c.surfaceSecondary, borderColor: active ? c.brand : c.border }]} testID={`cat-${cat}`}>
                <Text style={{ color: active ? "#FFF" : c.onSurface, fontWeight: "800", fontSize: 14 * scale }}>{cat}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Puzzle grid */}
        <View style={styles.grid}>
          {visiblePuzzles.map((p) => {
            const isDone = completed.some((cd) => cd.puzzle_id === p.id);
            return (
              <Pressable key={p.id} testID={`puzzle-${p.id}`} onPress={() => open(p)} style={[styles.gridCard, { borderColor: c.border, backgroundColor: c.surfaceSecondary }]}>
                <Image source={p.url} style={styles.gridImg} contentFit="cover" />
                {isDone && (
                  <View style={[styles.doneBadge, { backgroundColor: c.success }]}>
                    <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                  </View>
                )}
                <View style={{ padding: 10 }}>
                  <Text numberOfLines={1} style={{ color: c.onSurface, fontWeight: "800", fontSize: 14 * scale }}>{p.title}</Text>
                  <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 2 }}>{p.category}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* Completed strip */}
        {completed.length > 0 && (
          <View style={{ marginTop: 18 }}>
            <Text style={[styles.section, { color: c.onSurface, fontSize: 18 * scale }]}>Completed ({completed.length})</Text>
            <Text style={{ color: c.muted, fontSize: 13 * scale }}>Each completed puzzle is worth 15 ⚜︎ Butterfly Points.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  instructions: { borderRadius: 18, padding: 14, borderWidth: 1.5 },
  daily: { marginTop: 12, borderRadius: 22, overflow: "hidden", borderWidth: 2, height: 180, justifyContent: "flex-end" },
  dailyImg: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
  dailyOverlay: { padding: 16 },
  dailyPill: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  section: { fontWeight: "900", marginBottom: 6 },
  resumeCard: { width: 160, borderRadius: 16, padding: 8, borderWidth: 1 },
  resumeImg: { width: "100%", height: 90, borderRadius: 10 },
  progressBar: { height: 6, borderRadius: 3, marginTop: 6, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3 },
  catsRow: { gap: 8, paddingVertical: 6 },
  catChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 2, minHeight: 40 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 8 },
  gridCard: { width: "48%", borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  gridImg: { width: "100%", height: 120 },
  doneBadge: { position: "absolute", top: 8, right: 8, width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  surpriseBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 999 },
  statsCard: { marginTop: 12, padding: 14, borderRadius: 18, borderWidth: 1 },
  statsRow: { flexDirection: "row", gap: 12, marginTop: 8 },
  statBox: { flex: 1, alignItems: "center" },
});
