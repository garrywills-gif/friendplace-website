import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import SpeakButton from "@/src/components/SpeakButton";
import { useToast } from "@/src/lib/toast";
import { ButterflyCardBack } from "@/src/components/ButterflyCardBack";
import { getCurrentSeason } from "@/src/lib/seasons";
import { GeorgeButterflyMark } from "@/src/components/george/GeorgeButterflyMark";

/**
 * Games Hub — restructured per June 2026 launch spec.
 *
 * Sections in order:
 *   1. Signature Game: Solitaire — never resets, prominent seasonal
 *      hero at the top of the hub.
 *   2. Daily Challenges: Puzzle · Word Search · Trivia
 *   3. All Games (with schedule chips):
 *      Solitaire (Signature), Bingo (Tue/Thu/Sun 6pm AEST),
 *      Crossword, Sudoku, Word Search, Puzzle Centre, Trivia,
 *      Memory Match (Weekly)
 *   Spot the Difference has been retired.
 */

type Schedule = "daily" | "weekly" | "signature" | { label: string };
type GameTile = {
  key: string;
  title: string;
  sub: string;
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  route: string;
  ready: boolean;
  schedule?: Schedule;
};

const GAMES: GameTile[] = [
  { key: "solitaire",  title: "Solitaire",          sub: "Signature · Klondike Draw 3", icon: "sparkles",     tint: "#7C3AED", route: "/games/solitaire",  ready: true, schedule: "signature" },
  { key: "bingo",      title: "Bingo",              sub: "75-ball · live events",       icon: "apps",         tint: "#2E9EE2", route: "/games/bingo",      ready: true, schedule: { label: "Tue/Thu/Sun 6pm AEST" } },
  { key: "crossword",  title: "Crossword",          sub: "Daily + 4 levels",            icon: "newspaper",    tint: "#0E7490", route: "/games/crossword",  ready: true, schedule: "daily" },
  { key: "sudoku",     title: "Sudoku",             sub: "4 levels · pencil notes",     icon: "grid-outline", tint: "#1E3A7F", route: "/games/sudoku",     ready: true, schedule: "daily" },
  { key: "wordsearch", title: "Word Search",        sub: "20 themes · 4 levels",        icon: "search",       tint: "#B45309", route: "/games/wordsearch", ready: true, schedule: "daily" },
  { key: "jigsaw",     title: "Puzzle Centre",      sub: "8 categories · 4 levels",     icon: "grid",         tint: "#0F766E", route: "/games/jigsaw",     ready: true, schedule: "daily" },
  { key: "trivia",     title: "Trivia",             sub: "7 categories · 4 levels",     icon: "help-circle",  tint: "#DB2777", route: "/games/trivia",     ready: true, schedule: "daily" },
  { key: "memory",     title: "Memory Match",       sub: "12 themes · 4 levels",        icon: "square",       tint: "#0891B2", route: "/games/memory",     ready: true, schedule: "weekly" },
];

const INSTRUCTIONS = "Welcome to the Games Hub. Solitaire is your signature game — play any time. Daily challenges give a little Butterfly Points bonus if you'd like one. Bingo runs live on Tuesday, Thursday and Sunday at six PM. Every game earns Butterfly Points.";

function ScheduleChip({ sched, tint }: { sched: Schedule | undefined; tint: string }) {
  if (!sched) return null;
  let label = "";
  let icon: keyof typeof Ionicons.glyphMap = "time";
  if (sched === "daily") { label = "Daily"; icon = "sunny"; }
  else if (sched === "weekly") { label = "Weekly"; icon = "calendar"; }
  else if (sched === "signature") { label = "Signature"; icon = "sparkles"; }
  else { label = sched.label; icon = "time"; }
  return (
    <View style={[styles.schedChip, { backgroundColor: `${tint}22`, borderColor: tint }]}>
      <Ionicons name={icon} size={11} color={tint} />
      <Text style={[styles.schedChipText, { color: tint }]}>{label}</Text>
    </View>
  );
}

export default function GamesHub() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const { show } = useToast();
  const [stats, setStats] = useState<any>(null);
  const [dailies, setDailies] = useState<any>(null);
  const [bonus, setBonus] = useState<{ claimed_today: boolean; streak_days: number; points: number; streak_target: number } | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const season = getCurrentSeason();

  const load = async () => {
    if (user) {
      try { setStats(await api.gamesStats(user.id)); } catch { /* ignore */ }
      try { setBonus(await api.dailyBonusStatus(user.id) as any); } catch { /* ignore */ }
    }
    try { setDailies(await api.gamesDailies()); } catch { /* ignore */ }
  };
  useFocusEffect(useCallback(() => { load(); }, [user?.id]));

  const claimBonus = async () => {
    if (!user || claiming) return;
    setClaiming(true);
    try {
      const r: any = await api.dailyBonusClaim(user.id);
      if (r.claimed) {
        setBonus((b) => (b ? { ...b, claimed_today: true, streak_days: r.streak_days } : b));
        // Note: we intentionally do NOT call auth `refresh()` here.
        // It kicks off an /api/users/{id} round-trip that can throw
        // 401 mid-session and trigger the global unauthorized handler,
        // which used to bounce the player back to Home immediately
        // after claiming their bonus. Local state update above is
        // enough — the fresh point total shows next time the page
        // refetches (pull-to-refresh, tab switch, etc).
        const pts = r.points_awarded ?? bonus?.points ?? 5;
        // Warm, guilt-free toasts (locked with Garry, 31 July 2026 —
        // "No guilt. Ever."). Never mentions runs to protect, streaks
        // to keep alive, or coming back tomorrow. Just celebrates
        // what happened today.
        if (r.badge_earned) {
          show(`+${pts} Butterfly Points 🦋 Lovely to see you today.`);
        } else {
          show(`+${pts} Butterfly Points 🦋 Lovely to see you today.`);
        }
      } else {
        show("Today's bonus is all done — enjoy the games any time.");
      }
    } catch { show("Couldn't claim right now — please try again."); }
    finally { setClaiming(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header
        title="Games Hub"
        backHref="/home"
        subtitle={`${season.emoji} ${season.label} · ${season.tagline}`}
      />
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        contentContainerStyle={{ padding: 14, paddingBottom: 60 }}
      >
        {/* Signature seasonal hero — Solitaire */}
        <Pressable
          testID="games-signature-solitaire"
          onPress={() => router.push("/games/solitaire" as any)}
          style={({ pressed }) => [styles.signatureHero, { backgroundColor: season.felt, borderColor: season.outline, opacity: pressed ? 0.9 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Play Solitaire — the signature game"
        >
          <View style={styles.heroBackPreview}>
            <ButterflyCardBack width={60} height={84} season={season} showCorners={false} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: season.outline, fontWeight: "900", letterSpacing: 0.6, fontSize: 11 * scale }}>
              {season.emoji} {season.label.toUpperCase()} · SIGNATURE GAME
            </Text>
            <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 22 * scale, marginTop: 4 }}>Solitaire</Text>
            <Text style={{ color: "#E2E8F0", fontSize: 13 * scale, marginTop: 2 }}>Klondike · Draw 3 · Never resets</Text>
          </View>
          <Ionicons name="chevron-forward" size={24} color="#FFFFFF" />
        </Pressable>

        {/* Daily Butterfly Bonus banner — a small "if you'd like a
            little bonus today" invitation. Locked with Garry, 31 July
            2026 (No guilt. Ever.): the "already claimed" state
            celebrates today's visit — never references streaks, runs,
            or how many days in a row. Total-days-played remains an
            internal number the server tracks; the UI simply says
            "Lovely to see you today." */}
        {bonus && (
          bonus.claimed_today ? (
            <View testID="daily-bonus-claimed" style={[styles.bonusChip, { backgroundColor: c.brandTertiary, borderColor: c.brand, marginTop: 12 }]}>
              <GeorgeButterflyMark size={22} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 15 * scale }}>
                  Today&apos;s bonus is yours
                </Text>
                <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 2 }}>
                  Lovely to see you today. Enjoy the games any time.
                </Text>
              </View>
            </View>
          ) : (
            <Pressable
              testID="daily-bonus-claim"
              onPress={claimBonus}
              disabled={claiming}
              style={({ pressed }) => [styles.bonusCard, { backgroundColor: "#FBBF24", borderColor: "#F59E0B", marginTop: 12, opacity: (pressed || claiming) ? 0.85 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel={`Claim daily butterfly bonus for ${bonus.points} points`}
            >
              <GeorgeButterflyMark size={32} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#78350F", fontWeight: "900", fontSize: 16 * scale }}>
                  Daily Butterfly Bonus
                </Text>
                <Text style={{ color: "#78350F", fontSize: 13 * scale, marginTop: 2 }}>
                  Play any game today to earn +{bonus.points} pts · 7 days = Daily Devotee badge
                </Text>
              </View>
              <View style={[styles.claimBtn, { backgroundColor: "#78350F" }]}>
                <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 13 * scale }}>{claiming ? "…" : "Claim"}</Text>
              </View>
            </Pressable>
          )
        )}

        <View style={[styles.intro, { backgroundColor: c.brandTertiary, borderColor: c.brand, marginTop: 12 }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ color: c.brand, fontWeight: "900", letterSpacing: 0.6, fontSize: 12 * scale }}>WELCOME TO THE GAMES HUB</Text>
            <SpeakButton text={INSTRUCTIONS} color={c.brand} size={22} />
          </View>
          <Text style={{ color: c.onSurface, fontSize: 15 * scale, lineHeight: 22, marginTop: 6 }}>
            Play at your own pace. Every game saves automatically and rewards you with Butterfly Points.
          </Text>
        </View>

        {/* Stats card — cumulative "games done" celebrates lifetime
            play. Removed the "Day streak" tile (locked with Garry,
            31 July 2026 — no run-to-protect metrics). Achievements
            stay because they celebrate what's already happened. */}
        <View style={[styles.statsCard, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={styles.statBox}>
              <Text style={{ color: c.brand, fontWeight: "900", fontSize: 24 * scale }}>{stats?.total_completed ?? 0}</Text>
              <Text style={{ color: c.muted, fontSize: 12 * scale }}>Games enjoyed</Text>
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
            <Pressable testID="daily-jigsaw" onPress={() => router.push(`/games/jigsaw/${dailies.jigsaw.puzzle.id}?d=${dailies.jigsaw.difficulty}` as any)} style={[styles.dailyRow, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
              <View style={[styles.dailyIcon, { backgroundColor: "#0F766E22" }]}><Ionicons name="grid" size={20} color={"#0F766E"} /></View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 * scale }}>Daily Puzzle</Text>
                <Text style={{ color: c.muted, fontSize: 13 * scale }}>{dailies.jigsaw.puzzle.title} · {dailies.jigsaw.difficulty}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={c.muted} />
            </Pressable>
          )}
          {dailies?.wordsearch?.available ? (
            <Pressable testID="daily-wordsearch" onPress={() => router.push(`/games/wordsearch/play?theme=${dailies.wordsearch.theme}&difficulty=${dailies.wordsearch.difficulty}&daily=1` as any)} style={[styles.dailyRow, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
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
          <Pressable testID="daily-trivia" onPress={() => router.push("/games/trivia?daily=1" as any)} style={[styles.dailyRow, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
            <View style={[styles.dailyIcon, { backgroundColor: "#DB277722" }]}><Ionicons name="help-circle" size={20} color={"#DB2777"} /></View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 * scale }}>Daily Trivia</Text>
              <Text style={{ color: c.muted, fontSize: 13 * scale }}>10 mixed questions · 15 pts</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={c.muted} />
          </Pressable>
        </View>

        {/* Games grid */}
        <Text style={[styles.section, { color: c.onSurface, fontSize: 18 * scale, marginTop: 18 }]}>All games</Text>
        <View style={styles.grid}>
          {GAMES.map((g) => (
            <Pressable
              key={g.key}
              testID={`game-${g.key}`}
              onPress={() => g.ready ? router.push(g.route as any) : router.push(`/games/coming-soon?name=${encodeURIComponent(g.title)}` as any)}
              style={[styles.tile, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}
            >
              <View style={[styles.tileIcon, { backgroundColor: `${g.tint}22` }]}>
                <Ionicons name={g.icon} size={26} color={g.tint} />
              </View>
              <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 * scale, marginTop: 8 }}>{g.title}</Text>
              <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 2 }}>{g.sub}</Text>
              <View style={{ marginTop: 6 }}>
                <ScheduleChip sched={g.schedule} tint={g.tint} />
              </View>
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
  signatureHero: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 14,
    borderRadius: 22,
    borderWidth: 1.5,
    minHeight: 96,
  },
  heroBackPreview: { alignItems: "center", justifyContent: "center" },
  cardBackSmall: {
    width: 60,
    height: 84,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "#0F172A",
  },
  cardBackDiag: {
    position: "absolute",
    width: "160%",
    height: 16,
    top: "50%",
    left: "-30%",
    transform: [{ rotate: "-20deg" }],
    opacity: 0.55,
  },
  intro: { borderRadius: 18, padding: 14, borderWidth: 1.5 },
  statsCard: { marginTop: 12, padding: 14, borderRadius: 18, borderWidth: 1 },
  statBox: { flex: 1, alignItems: "center" },
  achChip: { flexDirection: "row", gap: 6, alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  section: { fontWeight: "900", marginBottom: 8 },
  dailyRow: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 14, borderWidth: 1 },
  dailyDisabled: { opacity: 0.7 },
  dailyIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: { width: "48%", minHeight: 150, borderRadius: 18, borderWidth: 1, padding: 14, justifyContent: "flex-start" },
  tileIcon: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  soon: { position: "absolute", top: 10, right: 10, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  schedChip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  schedChipText: { fontWeight: "800", fontSize: 10 },
  // Daily Butterfly Bonus
  bonusCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 18,
    borderWidth: 2,
  },
  bonusChip: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  claimBtn: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  streakDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
