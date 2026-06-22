import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Switch, Image, useWindowDimensions } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import SpeakButton from "@/src/components/SpeakButton";

type Theme = { key: string; label: string; emoji: string };
type Difficulty = { key: string; label: string; diffs: number; points: number; hints: number; ribbon: boolean };
type LibPuzzle = { id: string; title: string; photo_url: string; theme: string; difficulty: string; season?: string | null };

const HOW_TO = "Spot the Difference. Two pictures, almost the same. Tap on the differences. Use the magnifying glass to zoom in. Take your time, or turn on Beat the Clock for bonus points on Hard and Nightmare puzzles.";
const DIFF_TINT: Record<string, string> = { easy: "#16A34A", moderate: "#0EA5E9", hard: "#B45309", nightmare: "#7C3AED" };
const DIFF_LABEL: Record<string, string> = { easy: "Easy", moderate: "Moderate", hard: "Hard", nightmare: "Nightmare" };

const SEASON_BADGE: Record<string, { label: string; bg: string; fg: string }> = {
  christmas:     { label: "🎄 Christmas",      bg: "#DC2626", fg: "#FFFFFF" },
  easter:        { label: "🐣 Easter",         bg: "#F59E0B", fg: "#78350F" },
  spring:        { label: "🌸 Spring",         bg: "#FBCFE8", fg: "#9D174D" },
  autumn:        { label: "🍂 Autumn",         bg: "#FED7AA", fg: "#9A3412" },
  australia_day: { label: "🇦🇺 Australia Day", bg: "#1E3A7F", fg: "#FFFFFF" },
  mothers_day:   { label: "💐 Mother's Day",   bg: "#F472B6", fg: "#831843" },
  fathers_day:   { label: "🎩 Father's Day",   bg: "#1F2937", fg: "#FFFFFF" },
};

export default function SpotHub() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const { width: winW } = useWindowDimensions();
  const [themes, setThemes] = useState<Theme[]>([]);
  const [diffs, setDiffs] = useState<Difficulty[]>([]);
  const [daily, setDaily] = useState<any>(null);
  const [library, setLibrary] = useState<LibPuzzle[]>([]);
  const [picked, setPicked] = useState("easy");
  const [beatClock, setBeatClock] = useState(false);
  const [bests, setBests] = useState<any>({});

  const load = async () => {
    try { const cat: any = await api.stdCatalog(); setThemes(cat.themes || []); setDiffs(cat.difficulties || []); } catch {}
    try { setDaily(await api.stdDaily()); } catch {}
    try { const r: any = await api.stdLibrary(); setLibrary(r.puzzles || []); } catch {}
    if (user) { try { setBests((await api.stdBests(user.id)) as any); } catch {} }
  };
  useFocusEffect(useCallback(() => { load(); }, [user?.id]));

  const openLibrary = (p: LibPuzzle) => {
    router.push(`/games/spot/play?lib=${encodeURIComponent(p.id)}&btc=${beatClock ? 1 : 0}` as any);
  };
  const openTheme = (t: Theme) => {
    router.push(`/games/spot/play?theme=${t.key}&difficulty=${picked}&btc=${beatClock ? 1 : 0}` as any);
  };

  const backendBase = process.env.EXPO_PUBLIC_BACKEND_URL || "";
  // Two-column thumbnails on phones, three on iPad/wider screens.
  const cols = winW >= 700 ? 3 : 2;
  const gap = 10;
  const thumbW = Math.floor((Math.min(winW, 900) - 14 * 2 - gap * (cols - 1)) / cols);

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Spot the Difference" />
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 60, gap: 14 }}>
        <View style={[styles.intro, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <Text style={{ color: c.brand, fontWeight: "900", letterSpacing: 0.6, fontSize: 12 * scale }}>HOW TO PLAY</Text>
            <SpeakButton text={HOW_TO} color={c.brand} size={22} testID="std-how-speak" />
          </View>
          <Text style={{ color: c.onSurface, fontSize: 15 * scale, lineHeight: 22 }}>Tap on the differences between the two pictures. Magnifying glass and zoom included. No timer by default — enjoy at your own pace. Butterfly Points awarded on Hard and Nightmare only.</Text>
        </View>

        {daily && (
          <Pressable
            testID="std-daily"
            onPress={() => {
              // Daily puzzle is preferred from the curated library — pass `lib` so the
              // player loads with the exact curated photo and title.
              if (daily.puzzle_id?.startsWith("lib:")) {
                // puzzle_id format: lib:<id>:daily-<date>
                const libId = String(daily.puzzle_id).split(":")[1];
                router.push(`/games/spot/play?lib=${encodeURIComponent(libId)}&daily=1&btc=${beatClock ? 1 : 0}` as any);
              } else {
                router.push(`/games/spot/play?theme=${daily.theme}&difficulty=${daily.difficulty}&daily=1&btc=${beatClock ? 1 : 0}` as any);
              }
            }}
            style={[styles.dailyCard, { backgroundColor: c.brand }]}
          >
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              {daily.background_url ? (
                <Image source={{ uri: `${backendBase}${daily.background_url}` }} style={styles.dailyThumb} resizeMode="cover" />
              ) : (
                <View style={[styles.dailyThumb, { backgroundColor: "#FFFFFF22", alignItems: "center", justifyContent: "center" }]}>
                  <Text style={{ fontSize: 30 }}>{daily.theme_emoji}</Text>
                </View>
              )}
              <View style={{ flex: 1, marginLeft: 12 }}>
                <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                  <Text style={{ color: "#FFFFFFCC", fontWeight: "800", fontSize: 11 * scale, letterSpacing: 0.6 }}>TODAY&apos;S DAILY</Text>
                  {daily.season && SEASON_BADGE[daily.season] && (
                    <View style={{ backgroundColor: SEASON_BADGE[daily.season].bg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>
                      <Text style={{ color: SEASON_BADGE[daily.season].fg, fontWeight: "900", fontSize: 10 * scale }}>{SEASON_BADGE[daily.season].label}</Text>
                    </View>
                  )}
                </View>
                <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 19 * scale, marginTop: 4 }} numberOfLines={2}>
                  {daily.title || daily.theme_label}
                </Text>
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

        {library.length > 0 && (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
              <Text style={[styles.section, { color: c.onSurface, fontSize: 17 * scale }]}>Pick a puzzle</Text>
              <Text style={{ color: c.muted, fontSize: 12 * scale, fontWeight: "700" }}>{library.length} available</Text>
            </View>
            <View style={[styles.grid, { gap }]}>
              {library.map((p) => {
                const tint = DIFF_TINT[p.difficulty] || c.brand;
                const badge = p.season ? SEASON_BADGE[p.season] : null;
                return (
                  <Pressable
                    key={p.id}
                    testID={`std-lib-${p.id}`}
                    onPress={() => openLibrary(p)}
                    style={[styles.libCard, { width: thumbW, backgroundColor: c.surfaceSecondary, borderColor: c.border }]}
                  >
                    <View style={{ width: "100%", height: Math.round(thumbW * 0.66), borderTopLeftRadius: 14, borderTopRightRadius: 14, overflow: "hidden", backgroundColor: c.surfaceTertiary }}>
                      <Image source={{ uri: `${backendBase}${p.photo_url}` }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                      {badge && (
                        <View style={[styles.seasonBadge, { backgroundColor: badge.bg }]}>
                          <Text style={{ color: badge.fg, fontWeight: "900", fontSize: 10 * scale }}>{badge.label}</Text>
                        </View>
                      )}
                      <View style={[styles.diffBadge, { backgroundColor: tint }]}>
                        <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 10 * scale, letterSpacing: 0.4 }}>{(DIFF_LABEL[p.difficulty] || p.difficulty).toUpperCase()}</Text>
                      </View>
                    </View>
                    <View style={{ padding: 10 }}>
                      <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 14 * scale, lineHeight: 19 }} numberOfLines={2}>{p.title}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        {bests && (bests as any).total_completed > 0 && (
          <View style={[styles.bests, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 14 * scale, marginBottom: 6 }}>🏆 Your best times</Text>
            {Object.entries((bests as any).bests || {}).map(([key, v]: any) => (
              <Text key={key} style={{ color: c.muted, fontSize: 13 * scale }}>{key} · {Math.floor((v?.seconds||0)/60)}m {(v?.seconds||0) % 60}s</Text>
            ))}
          </View>
        )}

        {/* Surprise me — random theme picker. Stays below the curated library so
            the curated experience leads, with a random generator for variety. */}
        <Text style={[styles.section, { color: c.onSurface, fontSize: 17 * scale, marginTop: 4 }]}>Or generate a random puzzle</Text>
        <Text style={{ color: c.muted, fontSize: 13 * scale }}>Choose a difficulty and theme — every puzzle is freshly generated.</Text>
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
        <View style={styles.themeGrid}>
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
  dailyCard: { borderRadius: 18, padding: 12 },
  dailyThumb: { width: 64, height: 64, borderRadius: 14, overflow: "hidden" },
  section: { fontWeight: "900", marginTop: 6 },
  btcRow: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 14, borderWidth: 1 },
  diffRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  diffChip: { flexGrow: 1, minWidth: "47%", borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 12, alignItems: "flex-start" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  libCard: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  seasonBadge: { position: "absolute", top: 8, left: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  diffBadge: { position: "absolute", top: 8, right: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  themeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  themeTile: { width: "31%", aspectRatio: 1, borderRadius: 16, borderWidth: 1, padding: 8, alignItems: "center", justifyContent: "center" },
  bests: { padding: 12, borderRadius: 14, borderWidth: 1 },
});
