import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, useWindowDimensions, ActivityIndicator, Modal, PanResponder, Animated } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import SpeakButton from "@/src/components/SpeakButton";

const HOW_TO = "Two pictures, almost the same. Tap on a difference in either picture to mark it. Use the magnifying glass to zoom in by dragging it around. Tap the hint button if you get stuck. Take your time.";

type Elem = { id: string; emoji: string; x: number; y: number; size: number };
type Diff = { id: string; target: string; type: string; x: number; y: number; radius: number };

function Scene({ elements, found, sceneW, sceneH, zoom, onTap, foundDiffs, hintCircle, testIDPrefix }: any) {
  return (
    <Pressable testID={`${testIDPrefix}-scene`} onPress={(e: any) => {
      const x = (e.nativeEvent.locationX / sceneW) * 100;
      const y = (e.nativeEvent.locationY / sceneH) * 100;
      onTap(x, y);
    }} style={{ width: sceneW, height: sceneH, backgroundColor: "#EFF6FF", borderRadius: 14, overflow: "hidden", borderWidth: 2, borderColor: "#1E3A7F" }}>
      <View style={{ width: sceneW, height: sceneH, transform: [{ scale: zoom }] }}>
        {elements.map((el: Elem) => (
          <Text key={el.id} style={{ position: "absolute", left: (el.x / 100) * sceneW - el.size / 2, top: (el.y / 100) * sceneH - el.size / 2, fontSize: el.size }}>{el.emoji}</Text>
        ))}
      </View>
      {/* Found markers (green circles) */}
      {foundDiffs.map((d: Diff) => (
        <View key={d.id} pointerEvents="none" style={{ position: "absolute", left: (d.x / 100) * sceneW - 20, top: (d.y / 100) * sceneH - 20, width: 40, height: 40, borderRadius: 20, borderWidth: 3, borderColor: "#16A34A", backgroundColor: "#16A34A22" }}>
          <Ionicons name="checkmark" size={28} color="#16A34A" style={{ position: "absolute", top: 4, left: 5 }} />
        </View>
      ))}
      {hintCircle && (
        <View pointerEvents="none" style={{ position: "absolute", left: (hintCircle.x / 100) * sceneW - 30, top: (hintCircle.y / 100) * sceneH - 30, width: 60, height: 60, borderRadius: 30, borderWidth: 3, borderColor: "#F59E0B", backgroundColor: "#F59E0B22" }} />
      )}
    </Pressable>
  );
}

export default function SpotPlayer() {
  const router = useRouter();
  const { theme, difficulty, daily, btc } = useLocalSearchParams<{ theme: string; difficulty: string; daily?: string; btc?: string }>();
  const { c, scale, prefs } = useTheme();
  const { user } = useAuth();
  const { show } = useToast();
  const { width: winW } = useWindowDimensions();
  const isDaily = daily === "1";
  const beatClock = btc === "1";

  const [puzzle, setPuzzle] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [foundIds, setFoundIds] = useState<string[]>([]);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [hintCircle, setHintCircle] = useState<{x:number;y:number}|null>(null);
  const [seconds, setSeconds] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [showHow, setShowHow] = useState(false);
  const [showWin, setShowWin] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [magnify, setMagnify] = useState(false);
  const startedAt = useRef<number>(Date.now());

  // Magnifying-glass position (Animated for smoothness)
  const lensPos = useRef(new Animated.ValueXY({ x: 80, y: 80 })).current;
  const lensResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (_, g) => {
        lensPos.setValue({ x: Math.max(0, g.moveX - 50), y: Math.max(0, g.moveY - 200) });
      },
    })
  ).current;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const puz: any = isDaily ? await api.stdDaily() : await api.stdPuzzle(theme as string, difficulty as string);
        if (cancelled) return;
        setPuzzle(puz);
        if (user) {
          try {
            const saved: any = await api.stdGetProgress(user.id, puz.puzzle_id);
            if (saved && saved.found_ids) {
              setFoundIds(saved.found_ids);
              setHintsUsed(saved.hints_used || 0);
              setSeconds(saved.seconds || 0);
              startedAt.current = Date.now() - (saved.seconds || 0) * 1000;
              if (saved.completed) setCompleted(true);
            }
          } catch {}
        }
      } catch {
        show("Could not load puzzle");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [theme, difficulty, isDaily, user?.id]);

  useEffect(() => {
    if (completed) return;
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [completed]);

  // Auto-save
  const saveTimer = useRef<any>(null);
  const persist = useCallback((nextFound: string[], nextHints: number, didFinish: boolean) => {
    if (!user || !puzzle) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const r: any = await api.stdSaveProgress(user.id, {
          puzzle_id: puzzle.puzzle_id, theme: puzzle.theme, difficulty: puzzle.difficulty,
          found_ids: nextFound, hints_used: nextHints, seconds, completed: didFinish, is_daily: isDaily, beat_the_clock: beatClock,
        });
        if (didFinish && r?.granted) {
          if (r.granted.includes("hard") || r.granted.includes("nightmare")) {
            show("🦋 Friends will see a celebration Flutter!");
          }
          if (r.new_personal_best) show("🏆 New personal best!");
        }
      } catch {}
    }, 400);
  }, [user, puzzle, seconds, isDaily, beatClock]);

  if (loading || !puzzle) {
    return (
      <View style={{ flex: 1, backgroundColor: c.surface }}><Header title="Spot the Difference" />
        <View style={{ padding: 30 }}><ActivityIndicator color={c.brand} /></View>
      </View>
    );
  }

  const horizontalPad = 14 * 2;
  const sceneW = Math.min(winW - horizontalPad, 460);
  const sceneH = Math.round(sceneW * 0.7);

  const onTapScene = (x: number, y: number) => {
    if (completed) return;
    setHintCircle(null);
    // Find any unfound difference where (x,y) is within radius
    const unfound = (puzzle.differences as Diff[]).filter((d) => !foundIds.includes(d.id));
    const hit = unfound.find((d) => Math.hypot(d.x - x, d.y - y) <= d.radius);
    if (hit) {
      const next = [...foundIds, hit.id];
      setFoundIds(next);
      const done = next.length >= puzzle.diff_count;
      if (done) { setCompleted(true); setShowWin(true); }
      persist(next, hintsUsed, done);
      show(`✅ ${next.length}/${puzzle.diff_count} found`);
    } else {
      show("Look again — try another spot");
    }
  };

  const onHint = () => {
    const max = puzzle.hint_quota ?? 3;
    if (hintsUsed >= max) { show(`No hints left — ${max} per puzzle`); return; }
    const unfound = (puzzle.differences as Diff[]).filter((d) => !foundIds.includes(d.id));
    if (unfound.length === 0) return;
    const pick = unfound[Math.floor(Math.random() * unfound.length)];
    setHintCircle({ x: pick.x, y: pick.y });
    setHintsUsed(hintsUsed + 1);
    persist(foundIds, hintsUsed + 1, false);
    setTimeout(() => setHintCircle(null), 3500);
  };

  const foundDiffs = (puzzle.differences as Diff[]).filter((d) => foundIds.includes(d.id));
  const m = Math.floor(seconds / 60), s = seconds % 60;
  const btcDef = puzzle.beat_the_clock;

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title={`${puzzle.theme_emoji} ${puzzle.theme_label}`} />
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 60, gap: 10 }}>
        <View style={[styles.topBar, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.muted, fontWeight: "800", letterSpacing: 0.4, fontSize: 11 * scale }}>{puzzle.difficulty_label.toUpperCase()}{isDaily ? " · DAILY" : ""}{beatClock ? " · ⏱️ BTC" : ""}</Text>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 16 * scale, marginTop: 2 }}>{foundIds.length}/{puzzle.diff_count} found · {m}:{s.toString().padStart(2, "0")}{beatClock && btcDef ? ` / ${Math.floor(btcDef.seconds/60)}:00` : ""}</Text>
          </View>
          <Pressable onPress={() => setShowHow(true)} hitSlop={6} style={[styles.iconBtn, { backgroundColor: c.brandTertiary }]} testID="std-how-toggle"><Ionicons name="help-circle" size={22} color={c.brand} /></Pressable>
          {prefs.readMessagesAloud && (<SpeakButton text={HOW_TO} color={c.brand} size={22} bg={c.brandTertiary} testID="std-speak" />)}
        </View>

        <Scene elements={puzzle.scene_a} found={foundIds} sceneW={sceneW} sceneH={sceneH} zoom={zoom} onTap={onTapScene} foundDiffs={foundDiffs} hintCircle={hintCircle} testIDPrefix="std-a" />
        <Scene elements={puzzle.scene_b} found={foundIds} sceneW={sceneW} sceneH={sceneH} zoom={zoom} onTap={onTapScene} foundDiffs={foundDiffs} hintCircle={hintCircle} testIDPrefix="std-b" />

        <View style={styles.actions}>
          <Pressable testID="std-zoom-out" onPress={() => setZoom(Math.max(1, zoom - 0.25))} style={[styles.actionBtn, { backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border }]}>
            <Ionicons name="remove" size={18} color={c.onSurface} /><Text style={{ color: c.onSurface, fontWeight: "900" }}>Zoom out</Text>
          </Pressable>
          <Pressable testID="std-zoom-in" onPress={() => setZoom(Math.min(2.5, zoom + 0.25))} style={[styles.actionBtn, { backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border }]}>
            <Ionicons name="add" size={18} color={c.onSurface} /><Text style={{ color: c.onSurface, fontWeight: "900" }}>Zoom in</Text>
          </Pressable>
          <Pressable testID="std-magnify" onPress={() => setMagnify(!magnify)} style={[styles.actionBtn, { backgroundColor: magnify ? c.brand : c.surfaceSecondary, borderWidth: 1, borderColor: magnify ? c.brand : c.border }]}>
            <Ionicons name="search" size={18} color={magnify ? "#FFF" : c.onSurface} /><Text style={{ color: magnify ? "#FFF" : c.onSurface, fontWeight: "900" }}>Magnify {magnify ? "ON" : "off"}</Text>
          </Pressable>
          <Pressable testID="std-hint" onPress={onHint} disabled={hintsUsed >= (puzzle.hint_quota ?? 3) || completed} style={[styles.actionBtn, { backgroundColor: hintsUsed >= (puzzle.hint_quota ?? 3) || completed ? c.surfaceTertiary : "#F59E0B" }]}>
            <Ionicons name="bulb" size={18} color={hintsUsed >= (puzzle.hint_quota ?? 3) || completed ? c.muted : "#FFF"} /><Text style={{ color: hintsUsed >= (puzzle.hint_quota ?? 3) || completed ? c.muted : "#FFF", fontWeight: "900" }}>Hint ({(puzzle.hint_quota ?? 3) - hintsUsed})</Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Magnifying glass lens */}
      {magnify && (
        <Animated.View {...lensResponder.panHandlers} style={[styles.lens, { transform: lensPos.getTranslateTransform() }]}>
          <Ionicons name="search" size={48} color="#1E3A7F" />
        </Animated.View>
      )}

      <Modal visible={showHow} animationType="fade" transparent onRequestClose={() => setShowHow(false)}>
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, { backgroundColor: c.surface }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 19 * scale }}>How to play</Text>
              <SpeakButton text={HOW_TO} color={c.brand} size={22} />
            </View>
            <Text style={{ color: c.onSurface, fontSize: 16 * scale, marginTop: 10, lineHeight: 24 }}>{HOW_TO}</Text>
            <Pressable onPress={() => setShowHow(false)} style={[styles.closeBtn, { backgroundColor: c.brand }]}><Text style={{ color: "#FFF", fontWeight: "900", fontSize: 16 * scale }}>Got it</Text></Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={showWin} animationType="fade" transparent onRequestClose={() => setShowWin(false)}>
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, { backgroundColor: c.surface, alignItems: "center" }]}>
            <Text style={{ fontSize: 54 }}>🎉</Text>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 22 * scale, marginTop: 8 }}>You found them all!</Text>
            <Text style={{ color: c.muted, fontSize: 15 * scale, marginTop: 8, textAlign: "center" }}>{puzzle.theme_label} · {puzzle.difficulty_label} · {m}:{s.toString().padStart(2, "0")}{puzzle.points > 0 ? `\n+${puzzle.points} Community Points` : ""}{beatClock && btcDef && seconds <= btcDef.seconds && puzzle.points > 0 ? `\n+${btcDef.bonus} Beat the Clock bonus!` : ""}</Text>
            {(puzzle.difficulty === "hard" || puzzle.difficulty === "nightmare") && (
              <Text style={{ color: c.brand, fontWeight: "800", fontSize: 14 * scale, marginTop: 8, textAlign: "center" }}>🦋 Friends will see a celebration Flutter</Text>
            )}
            <Pressable onPress={() => { setShowWin(false); router.replace("/games/spot"); }} style={[styles.closeBtn, { backgroundColor: c.brand, marginTop: 16 }]}><Text style={{ color: "#FFF", fontWeight: "900", fontSize: 16 * scale }}>Pick another puzzle</Text></Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, borderWidth: 1 },
  iconBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap", justifyContent: "center" },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999 },
  lens: { position: "absolute", width: 100, height: 100, borderRadius: 50, backgroundColor: "#FFFFFFEE", borderWidth: 3, borderColor: "#1E3A7F", alignItems: "center", justifyContent: "center", zIndex: 100 },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", padding: 20 },
  modalCard: { width: "100%", maxWidth: 460, borderRadius: 20, padding: 20 },
  closeBtn: { paddingVertical: 14, borderRadius: 999, alignItems: "center", width: "100%" },
});
