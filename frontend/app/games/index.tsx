import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import SpeakButton from "@/src/components/SpeakButton";

type GameTile = { key: string; title: string; sub: string; icon: keyof typeof Ionicons.glyphMap; tint: string; route: string; ready: boolean };
const GAMES: GameTile[] = [
  { key: "jigsaw",     title: "Puzzle Centre",      sub: "8 categories · 4 levels",  icon: "grid",           tint: "#0F766E", route: "/games/jigsaw",     ready: true },
  { key: "trivia",     title: "Trivia",             sub: "7 categories · 4 levels", icon: "help-circle",    tint: "#7C3AED", route: "/games/trivia",     ready: true },
  { key: "wordsearch", title: "Word Search",        sub: "20 themes · 4 levels",     icon: "search",         tint: "#B45309", route: "/games/wordsearch", ready: true },
  { key: "memory",     title: "Memory Match",       sub: "12 themes · 4 levels",    icon: "sparkles",       tint: "#DB2777", route: "/games/memory",     ready: true },
  { key: "bingo",      title: "Bingo",              sub: "75-ball · 4 levels · live events",   icon: "apps",           tint: "#2E9EE2", route: "/games/bingo",      ready: true },
  { key: "sudoku",     title: "Sudoku",             sub: "4 levels",                icon: "grid-outline",   tint: "#1E3A7F", route: "/games/sudoku",     ready: false },
  { key: "spot",       title: "Spot the Difference",sub: "Find what's changed",     icon: "eye",            tint: "#16A34A", route: "/games/spot",       ready: false },
];

const INSTRUCTIONS = "Welcome to the Games Hub. Pick a game, choose your difficulty and play at your own pace. Your progress and personal bests are saved automatically. Complete a daily challenge to keep your streak alive. Every game you finish earns Community Points and may unlock an achievement.";

export default function GamesHub() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [dailies, setDailies] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    if (user) { try { setStats(await api.gamesStats(user.id)); } catch {} }
    try { setDailies(await api.gamesDailies()); } catch {}
  };
  useFocusEffect(useCallback(() => { load(); }, [user?.id]));

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Games Hub" />
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        contentContainerStyle={{ padding: 14, paddingBottom: 60 }}
      >
        <View style={[styles.intro, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ color: c.brand, fontWeight: "900", letterSpacing: 0.6, fontSize: 12 * scale }}>WELCOME TO THE GAMES HUB</Text>
            <SpeakButton text={INSTRUCTIONS} color={c.brand} size={22} />
          </View>
          <Text style={{ color: c.onSurface, fontSize: 15 * scale, lineHeight: 22, marginTop: 6 }}>
            Play at your own pace. Every game saves automatically and rewards you with Community Points.
          </Text>
        </View>

        {/* Streak + total + achievements */}
        <View style={[styles.statsCard, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={styles.statBox}>
              <Text style={{ color: c.brand, fontWeight: "900", fontSize: 24 * scale }}>{stats?.streak ?? 0}</Text>
              <Text style={{ color: c.muted, fontSize: 12 * scale }}>Day streak</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={{ color: c.brand, fontWeight: "900", fontSize: 24 * scale }}>{stats?.total_completed ?? 0}</Text>
              <Text style={{ color: c.muted, fontSize: 12 * scale }}>Games done</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={{ color: c.brand, fontWeight: "900", fontSize: 24 * scale }}>{stats?.achievements?.length ?? 0}</Text>
              <Text style={{ color: c.muted, fontSize: 12 * scale }}>Achievements</Text>
            </View>
          </View>
          {!!stats?.achievements?.length && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 10 }}>
              {stats.achievements.slice(0, 8).map((a: any) => (
                <View key={a.id} style={[styles.achChip, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
                  <Ionicons name="trophy" size={14} color={c.brand} />
                  <Text style={{ color: c.brand, fontWeight: "800", fontSize: 12 * scale }}>{a.title}</Text>
                </View>
              ))}
            </ScrollView>
          )}
        </View>

        {/* Daily Challenges */}
        <Text style={[styles.section, { color: c.onSurface, fontSize: 18 * scale, marginTop: 16 }]}>Daily Challenges</Text>
        <View style={{ gap: 8 }}>
          {dailies?.jigsaw?.puzzle && (
            <Pressable testID="daily-jigsaw" onPress={() => router.push(`/games/jigsaw/${dailies.jigsaw.puzzle.id}?d=${dailies.jigsaw.difficulty}`)} style={[styles.dailyRow, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
              <View style={[styles.dailyIcon, { backgroundColor: "#0F766E22" }]}><Ionicons name="grid" size={20} color={"#0F766E"} /></View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 * scale }}>Daily Puzzle</Text>
                <Text style={{ color: c.muted, fontSize: 13 * scale }}>{dailies.jigsaw.puzzle.title} · {dailies.jigsaw.difficulty}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={c.muted} />
            </Pressable>
          )}
          <Pressable testID="daily-trivia" onPress={() => router.push("/games/trivia?daily=1")} style={[styles.dailyRow, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
            <View style={[styles.dailyIcon, { backgroundColor: "#7C3AED22" }]}><Ionicons name="help-circle" size={20} color={"#7C3AED"} /></View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 * scale }}>Daily Trivia</Text>
              <Text style={{ color: c.muted, fontSize: 13 * scale }}>10 mixed questions · 15 pts</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={c.muted} />
          </Pressable>
          {dailies?.wordsearch?.available ? (
            <Pressable testID="daily-wordsearch" onPress={() => router.push(`/games/wordsearch/play?theme=${dailies.wordsearch.theme}&difficulty=${dailies.wordsearch.difficulty}&daily=1`)} style={[styles.dailyRow, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
              <View style={[styles.dailyIcon, { backgroundColor: "#B4530922" }]}><Ionicons name="search" size={20} color={"#B45309"} /></View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 * scale }}>Daily Word Search</Text>
                <Text style={{ color: c.muted, fontSize: 13 * scale }}>{dailies.wordsearch.title?.replace(/^Daily Word Search · /, "") || "Today's theme"} · {dailies.wordsearch.difficulty}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={c.muted} />
            </Pressable>
          ) : (
            <View style={[styles.dailyRow, styles.dailyDisabled, { borderColor: c.border, backgroundColor: c.surfaceTertiary }]}>
              <View style={[styles.dailyIcon, { backgroundColor: "#B4530922" }]}><Ionicons name="search" size={20} color={"#B45309"} /></View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 * scale }}>Daily Word Search</Text>
                <Text style={{ color: c.muted, fontSize: 13 * scale }}>Coming soon</Text>
              </View>
            </View>
          )}
        </View>

        {/* Games grid */}
        <Text style={[styles.section, { color: c.onSurface, fontSize: 18 * scale, marginTop: 18 }]}>All games</Text>
        <View style={styles.grid}>
          {GAMES.map((g) => (
            <Pressable
              key={g.key}
              testID={`game-${g.key}`}
              onPress={() => g.ready ? router.push(g.route as any) : router.push(`/games/coming-soon?name=${encodeURIComponent(g.title)}`)}
              style={[styles.tile, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}
            >
              <View style={[styles.tileIcon, { backgroundColor: `${g.tint}22` }]}>
                <Ionicons name={g.icon} size={26} color={g.tint} />
              </View>
              <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 * scale, marginTop: 8 }}>{g.title}</Text>
              <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 2 }}>{g.sub}</Text>
              {!g.ready && (
                <View style={[styles.soon, { backgroundColor: c.warning }]}>
                  <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 10 * scale, letterSpacing: 0.4 }}>SOON</Text>
                </View>
              )}
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { borderRadius: 18, padding: 14, borderWidth: 1.5 },
  statsCard: { marginTop: 12, padding: 14, borderRadius: 18, borderWidth: 1 },
  statBox: { flex: 1, alignItems: "center" },
  achChip: { flexDirection: "row", gap: 6, alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  section: { fontWeight: "900", marginBottom: 8 },
  dailyRow: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 14, borderWidth: 1 },
  dailyDisabled: { opacity: 0.7 },
  dailyIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: { width: "48%", minHeight: 130, borderRadius: 18, borderWidth: 1, padding: 14, justifyContent: "flex-start" },
  tileIcon: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  soon: { position: "absolute", top: 10, right: 10, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
});
