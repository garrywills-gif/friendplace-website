import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, RefreshControl, ActivityIndicator } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import SpeakButton from "@/src/components/SpeakButton";

type DifficultyMeta = { key: string; label: string; icon: string; color: string; points: number; questions: number };
type Catalog = { categories: string[]; difficulties: string[]; difficulty_meta: DifficultyMeta[]; counts: Record<string, any> };
type Daily = { date: string; difficulty: string; count: number; points_on_complete: number };
type Sessions = { active: any[]; recent: any[] };
type Stats = { total_completed: number; total_points: number; total_correct: number; total_questions: number; accuracy: number; by_difficulty: Record<string, number> };

const INSTRUCTIONS =
  "Welcome to Trivia. Pick a category and difficulty, then tap your answer. Each question can be read aloud — use the speaker button. Two lifelines help if you get stuck: Fifty-fifty removes two wrong answers, and Skip moves to the next question. Your progress saves automatically.";

export default function TriviaHub() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [daily, setDaily] = useState<Daily | null>(null);
  const [sessions, setSessions] = useState<Sessions | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [activeCat, setActiveCat] = useState<string>("Mixed");
  const [activeDiff, setActiveDiff] = useState<string>("easy");
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);

  const load = async () => {
    try { setCatalog(await api.triviaCatalog() as any); } catch {}
    try { setDaily(await api.triviaDaily() as any); } catch {}
    if (user) {
      try { setSessions(await api.triviaSessions(user.id) as any); } catch {}
      try { setStats(await api.triviaStats(user.id) as any); } catch {}
    }
  };
  useFocusEffect(useCallback(() => { load(); }, [user?.id]));

  const activeMeta = useMemo(
    () => catalog?.difficulty_meta.find((d) => d.key === activeDiff) || null,
    [catalog, activeDiff]
  );

  const startSession = async (opts?: { daily?: boolean }) => {
    if (!user || starting) return;
    setStarting(true);
    try {
      const body: any = opts?.daily
        ? { daily: true, difficulty: "moderate" }
        : { category: activeCat, difficulty: activeDiff };
      const s: any = await api.triviaStart(user.id, body);
      router.push(`/games/trivia/player?sid=${s.session_id}`);
    } catch (e) {
      console.warn("trivia start failed", e);
    } finally {
      setStarting(false);
    }
  };

  const resume = (sid: string) => router.push(`/games/trivia/player?sid=${sid}`);

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Trivia" />
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        contentContainerStyle={{ padding: 14, paddingBottom: 60 }}
      >
        {/* Instructions */}
        <View style={[styles.instructions, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <Text style={{ color: c.brand, fontWeight: "900", letterSpacing: 0.6, fontSize: 12 * scale }}>HOW TO PLAY</Text>
            <SpeakButton text={INSTRUCTIONS} color={c.brand} size={22} testID="trivia-speak-instructions" />
          </View>
          <Text style={{ color: c.onSurface, fontSize: 15 * scale, lineHeight: 22 }}>{INSTRUCTIONS}</Text>
        </View>

        {/* Daily Trivia card */}
        {daily && (
          <Pressable
            testID="trivia-daily"
            onPress={() => startSession({ daily: true })}
            style={[styles.daily, { backgroundColor: "#1E3A7F", borderColor: c.brand }]}
          >
            <View style={[styles.dailyPill, { backgroundColor: "#FCC656" }]}>
              <Ionicons name="sparkles" size={14} color={"#0D2A57"} />
              <Text style={{ color: "#0D2A57", fontWeight: "900", letterSpacing: 0.6, fontSize: 11 * scale }}>DAILY TRIVIA</Text>
            </View>
            <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 22 * scale, marginTop: 8 }}>Today&apos;s 10 questions</Text>
            <Text style={{ color: "#FFFFFFCC", fontWeight: "700", fontSize: 14 * scale, marginTop: 2 }}>
              Mixed categories · Earn {daily.points_on_complete} Community Points
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}>
              <Ionicons name="play-circle" size={20} color="#FCC656" />
              <Text style={{ color: "#FCC656", fontWeight: "900", fontSize: 14 * scale }}>Tap to play</Text>
            </View>
          </Pressable>
        )}

        {/* Resume in-progress */}
        {(sessions?.active?.length || 0) > 0 && (
          <View style={{ marginTop: 16 }}>
            <Text style={[styles.section, { color: c.onSurface, fontSize: 18 * scale }]}>Continue playing</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 6 }}>
              {sessions!.active.map((s: any) => {
                const total = (s.question_ids || []).length;
                const idx = s.current_index || 0;
                const pct = total ? Math.round((idx / total) * 100) : 0;
                return (
                  <Pressable key={s.id} testID={`trivia-resume-${s.id}`} onPress={() => resume(s.id)} style={[styles.resumeCard, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
                    <Text style={{ color: c.brand, fontWeight: "900", fontSize: 13 * scale }}>{(s.category || "Mixed").toUpperCase()}</Text>
                    <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 * scale, marginTop: 4 }}>
                      {s.difficulty?.charAt(0).toUpperCase() + s.difficulty?.slice(1)}
                    </Text>
                    <View style={[styles.progressBar, { backgroundColor: c.surfaceTertiary }]}>
                      <View style={[styles.progressFill, { backgroundColor: c.brand, width: `${pct}%` }]} />
                    </View>
                    <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 4 }}>{idx} / {total} questions</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Stats */}
        {stats && stats.total_completed > 0 && (
          <View style={[styles.statsCard, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
            <Text style={[styles.section, { color: c.onSurface, fontSize: 16 * scale }]}>Your trivia stats</Text>
            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Text style={{ color: c.brand, fontWeight: "900", fontSize: 22 * scale }}>{stats.total_completed}</Text>
                <Text style={{ color: c.muted, fontSize: 12 * scale }}>Played</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={{ color: c.brand, fontWeight: "900", fontSize: 22 * scale }}>{stats.accuracy}%</Text>
                <Text style={{ color: c.muted, fontSize: 12 * scale }}>Accuracy</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={{ color: c.brand, fontWeight: "900", fontSize: 22 * scale }}>{stats.total_points}</Text>
                <Text style={{ color: c.muted, fontSize: 12 * scale }}>Points</Text>
              </View>
            </View>
          </View>
        )}

        {/* Category picker */}
        <Text style={[styles.section, { color: c.onSurface, fontSize: 18 * scale, marginTop: 16 }]}>Choose a category</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catsRow}>
          {["Mixed", ...(catalog?.categories || [])].map((cat) => {
            const active = cat === activeCat;
            return (
              <Pressable key={cat} testID={`trivia-cat-${cat}`} onPress={() => setActiveCat(cat)} style={[styles.catChip, { backgroundColor: active ? c.brand : c.surfaceSecondary, borderColor: active ? c.brand : c.border }]}>
                <Text style={{ color: active ? "#FFF" : c.onSurface, fontWeight: "800", fontSize: 14 * scale }}>{cat}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Difficulty picker */}
        <Text style={[styles.section, { color: c.onSurface, fontSize: 18 * scale, marginTop: 16 }]}>Choose a difficulty</Text>
        <View style={{ gap: 10 }}>
          {(catalog?.difficulty_meta || []).map((d) => {
            const active = d.key === activeDiff;
            return (
              <Pressable
                key={d.key}
                testID={`trivia-diff-${d.key}`}
                onPress={() => setActiveDiff(d.key)}
                style={[styles.diffRow, { backgroundColor: active ? `${d.color}22` : c.surfaceSecondary, borderColor: active ? d.color : c.border, borderWidth: active ? 2.5 : 1 }]}
              >
                <View style={[styles.diffIcon, { backgroundColor: `${d.color}33` }]}>
                  <Ionicons name={d.icon as any} size={22} color={d.color} />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 17 * scale }}>{d.label}</Text>
                  <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 2 }}>
                    {d.questions} questions · {d.points} Community Points
                  </Text>
                </View>
                {active && <Ionicons name="checkmark-circle" size={26} color={d.color} />}
              </Pressable>
            );
          })}
        </View>

        {/* CTA */}
        <Pressable
          testID="trivia-start"
          disabled={starting || !user || !activeMeta}
          onPress={() => startSession()}
          style={[styles.startBtn, { backgroundColor: c.brand, opacity: starting ? 0.7 : 1 }]}
        >
          {starting ? <ActivityIndicator color="#FFF" /> : (
            <>
              <Ionicons name="play" size={22} color="#FFF" />
              <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 18 * scale }}>
                Start {activeMeta?.label || ""} · {activeCat}
              </Text>
            </>
          )}
        </Pressable>

        {/* Recent sessions */}
        {(sessions?.recent?.length || 0) > 0 && (
          <View style={{ marginTop: 18 }}>
            <Text style={[styles.section, { color: c.onSurface, fontSize: 18 * scale }]}>Recent games</Text>
            <View style={{ gap: 8 }}>
              {sessions!.recent.slice(0, 6).map((s: any) => (
                <View key={s.id} style={[styles.recentRow, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
                  <Ionicons name="trophy" size={20} color={c.brand} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 15 * scale }}>
                      {s.category} · {s.difficulty?.charAt(0).toUpperCase() + s.difficulty?.slice(1)}
                    </Text>
                    <Text style={{ color: c.muted, fontSize: 12 * scale }}>
                      {s.final_score}/{s.total_questions} correct · +{s.points_earned} pts
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  instructions: { borderRadius: 18, padding: 14, borderWidth: 1.5 },
  daily: { marginTop: 12, borderRadius: 22, padding: 18, borderWidth: 2 },
  dailyPill: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  section: { fontWeight: "900", marginBottom: 8 },
  resumeCard: { width: 180, borderRadius: 16, padding: 12, borderWidth: 1 },
  progressBar: { height: 6, borderRadius: 3, marginTop: 10, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3 },
  statsCard: { marginTop: 12, padding: 14, borderRadius: 18, borderWidth: 1 },
  statsRow: { flexDirection: "row", gap: 12, marginTop: 8 },
  statBox: { flex: 1, alignItems: "center" },
  catsRow: { gap: 8, paddingVertical: 6 },
  catChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 2, minHeight: 40 },
  diffRow: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 16 },
  diffIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  startBtn: { marginTop: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 16, borderRadius: 999 },
  recentRow: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 14, borderWidth: 1 },
});
