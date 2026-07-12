import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, RefreshControl, ActivityIndicator } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import SpeakButton from "@/src/components/SpeakButton";
import SeasonBanner from "@/src/components/SeasonBanner";
import { getCurrentSeason } from "@/src/lib/seasons";

const INSTRUCTIONS = "Welcome to Bingo. Pick a difficulty and tap Start. Each number gets called one at a time \u2014 tap it on your card to mark it. Hard and Nightmare auto-call every few seconds. When you spot a winning pattern, tap Call Bingo. Your progress saves automatically.";

export default function BingoHub() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const [catalog, setCatalog] = useState<any>(null);
  const [sessions, setSessions] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [diff, setDiff] = useState("easy");
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);

  const load = async () => {
    try { setCatalog(await api.bingoCatalog()); } catch {}
    try { const e: any = await api.bingoCommunityEvents(); setEvents(e.events || []); } catch {}
    if (user) {
      try { setSessions(await api.bingoSessions(user.id)); } catch {}
      try { setStats(await api.bingoStats(user.id)); } catch {}
    }
  };
  useFocusEffect(useCallback(() => { load(); }, [user?.id]));

  const start = async (opts?: { daily?: boolean; event_id?: string }) => {
    if (!user || starting) return;
    setStarting(true);
    try {
      const body: any = opts?.event_id ? { event_id: opts.event_id, difficulty: diff } : opts?.daily ? { daily: true, difficulty: "moderate" } : { difficulty: diff };
      const s: any = await api.bingoStart(user.id, body);
      router.push(`/games/bingo/player?sid=${s.session_id}`);
    } catch (e) { console.warn("bingo start failed", e); }
    finally { setStarting(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Bingo" />
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />} contentContainerStyle={{ padding: 14, paddingBottom: 60, gap: 12 }}>
        <SeasonBanner season={getCurrentSeason()} prefix="Bingo" c={c} scale={scale} />
        <View style={[styles.intro, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <Text style={{ color: c.brand, fontWeight: "900", letterSpacing: 0.6, fontSize: 12 * scale }}>HOW TO PLAY</Text>
            <SpeakButton text={INSTRUCTIONS} color={c.brand} size={22} />
          </View>
          <Text style={{ color: c.onSurface, fontSize: 15 * scale, lineHeight: 22 }}>{INSTRUCTIONS}</Text>
        </View>

        <Pressable testID="bingo-daily" onPress={() => start({ daily: true })} style={[styles.daily, { backgroundColor: "#1E3A7F", borderColor: c.brand }]}>
          <View style={[styles.pill, { backgroundColor: "#FCC656" }]}><Ionicons name="sparkles" size={14} color={"#0D2A57"} /><Text style={{ color: "#0D2A57", fontWeight: "900", fontSize: 11 * scale }}>DAILY BINGO</Text></View>
          <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 22 * scale, marginTop: 8 }}>Today&apos;s shared card</Text>
          <Text style={{ color: "#FFFFFFCC", fontSize: 14 * scale, marginTop: 2 }}>Same call sequence for everyone &middot; 15 Butterfly Points</Text>
        </Pressable>

        {events.length > 0 && (
          <View style={{ marginTop: 16 }}>
            <Text style={[styles.section, { color: c.onSurface, fontSize: 18 * scale }]}>Community Bingo Events</Text>
            <View style={{ gap: 10 }}>
              {events.map((e) => (
                <Pressable key={e.id} testID={`bingo-event-${e.id}`} onPress={() => start({ event_id: e.id })} style={[styles.eventCard, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={{ color: c.brand, fontWeight: "900", fontSize: 13 * scale }}>{e.difficulty?.toUpperCase()} &middot; {e.points_on_complete} PTS</Text>
                    {(e.winners || []).length > 0 && <Text style={{ color: c.muted, fontSize: 11 * scale }}>{e.winners.length} finished</Text>}
                  </View>
                  <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 18 * scale, marginTop: 4 }}>{e.title}</Text>
                  <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 2 }}>{e.subtitle}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {sessions?.active?.length > 0 && (
          <View style={{ marginTop: 16 }}>
            <Text style={[styles.section, { color: c.onSurface, fontSize: 18 * scale }]}>Continue playing</Text>
            <View style={{ gap: 8 }}>
              {sessions.active.map((s: any) => (
                <Pressable key={s.id} onPress={() => router.push(`/games/bingo/player?sid=${s.id}`)} style={[styles.resumeRow, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
                  <Ionicons name="play-circle" size={28} color={c.brand} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 * scale }}>{(s.difficulty || "").charAt(0).toUpperCase() + (s.difficulty || "").slice(1)} game</Text>
                    <Text style={{ color: c.muted, fontSize: 12 * scale }}>{s.call_index || 0} calls so far</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={c.muted} />
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {stats && stats.total_completed > 0 && (
          <View style={[styles.statsCard, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
            <Text style={[styles.section, { color: c.onSurface, fontSize: 16 * scale }]}>Your bingo stats</Text>
            <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
              <View style={{ flex: 1, alignItems: "center" }}><Text style={{ color: c.brand, fontWeight: "900", fontSize: 22 * scale }}>{stats.total_completed}</Text><Text style={{ color: c.muted, fontSize: 12 * scale }}>Games</Text></View>
              <View style={{ flex: 1, alignItems: "center" }}><Text style={{ color: c.brand, fontWeight: "900", fontSize: 22 * scale }}>{stats.total_points}</Text><Text style={{ color: c.muted, fontSize: 12 * scale }}>Points</Text></View>
              <View style={{ flex: 1, alignItems: "center" }}><Text style={{ color: c.brand, fontWeight: "900", fontSize: 22 * scale }}>{stats.fastest_seconds ? `${stats.fastest_seconds}s` : "\u2014"}</Text><Text style={{ color: c.muted, fontSize: 12 * scale }}>Fastest</Text></View>
            </View>
          </View>
        )}

        <Text style={[styles.section, { color: c.onSurface, fontSize: 18 * scale, marginTop: 16 }]}>Choose a difficulty</Text>
        <View style={{ gap: 10 }}>
          {(catalog?.difficulty_meta || []).map((d: any) => {
            const active = d.key === diff;
            const detail = d.pattern === "any_line" ? "Win on any line" : d.pattern === "two_lines_corners" ? "Two lines + four corners" : d.pattern === "full_house" ? "Full house \u2014 every cell" : d.pattern;
            const sub = `${d.cols}\u00D7${d.rows}${d.cards > 1 ? ` \u00B7 ${d.cards} cards` : ""} \u00B7 ${detail}${d.auto_call_ms ? ` \u00B7 auto-call ${Math.round(d.auto_call_ms/1000)}s` : " \u00B7 player-paced"}`;
            return (
              <Pressable key={d.key} testID={`bingo-diff-${d.key}`} onPress={() => setDiff(d.key)} style={[styles.diffRow, { backgroundColor: active ? `${d.color}22` : c.surfaceSecondary, borderColor: active ? d.color : c.border, borderWidth: active ? 2.5 : 1 }]}>
                <View style={[styles.diffIcon, { backgroundColor: `${d.color}33` }]}><Ionicons name={"apps" as any} size={22} color={d.color} /></View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 17 * scale }}>{d.label}</Text>
                  <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 2 }}>{sub}</Text>
                  <Text style={{ color: d.color, fontWeight: "800", fontSize: 12 * scale, marginTop: 2 }}>{d.points} Butterfly Points</Text>
                </View>
                {active && <Ionicons name="checkmark-circle" size={26} color={d.color} />}
              </Pressable>
            );
          })}
        </View>

        <Pressable testID="bingo-start" disabled={!user || starting} onPress={() => start()} style={[styles.startBtn, { backgroundColor: c.brand, opacity: starting ? 0.7 : 1 }]}>
          {starting ? <ActivityIndicator color="#FFF" /> : (<><Ionicons name="play" size={22} color="#FFF" /><Text style={{ color: "#FFF", fontWeight: "900", fontSize: 18 * scale }}>Start {diff.charAt(0).toUpperCase() + diff.slice(1)} Bingo</Text></>)}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { borderRadius: 18, padding: 14, borderWidth: 1.5 },
  daily: { marginTop: 12, borderRadius: 22, padding: 18, borderWidth: 2 },
  pill: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  section: { fontWeight: "900", marginBottom: 8 },
  eventCard: { padding: 14, borderRadius: 16, borderWidth: 1 },
  resumeRow: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 14, borderWidth: 1 },
  statsCard: { marginTop: 12, padding: 14, borderRadius: 18, borderWidth: 1 },
  diffRow: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 16 },
  diffIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  startBtn: { marginTop: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 16, borderRadius: 999 },
});
