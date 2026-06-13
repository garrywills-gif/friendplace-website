import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, useWindowDimensions, ActivityIndicator, Modal, Image } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import SpeakButton from "@/src/components/SpeakButton";

const HOW_TO = "Two pictures, almost the same. Tap on a difference in either picture to mark it. Use the Zoom in/out buttons or tap Magnify to make everything bigger so the small details are easier to see. When zoomed in, drag the picture to look at the edges. Tap the hint button if you get stuck. Take your time.";

type Elem = { id: string; emoji: string; x: number; y: number; size: number };
type Diff = { id: string; target: string; type: string; x: number; y: number; radius: number };

function Scene({ elements, sceneW, sceneH, zoom, onTap, foundDiffs, hintCircle, testIDPrefix, backgroundUrl }: any) {
  // When zoom > 1 we expand the inner content to (sceneW*zoom, sceneH*zoom)
  // and wrap it in nested horizontal+vertical ScrollViews so the user can
  // drag/pan to inspect parts of the picture that fall outside the viewport.
  // The visible viewport remains sceneW × sceneH so layout doesn't jump.
  const innerW = sceneW * zoom;
  const innerH = sceneH * zoom;
  const pannable = zoom > 1.02;

  const innerRef = React.useRef<View>(null);
  const offsetRef = React.useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const measure = React.useCallback(() => {
    const node: any = innerRef.current;
    if (!node) return;
    if (typeof node.measureInWindow === "function") {
      node.measureInWindow((x: number, y: number) => { offsetRef.current = { x, y }; });
    } else if (typeof node.getBoundingClientRect === "function") {
      const r = node.getBoundingClientRect();
      offsetRef.current = { x: r.left, y: r.top };
    }
  }, []);

  const handlePress = (e: any) => {
    measure();
    const ne = e.nativeEvent || {};
    let lx = ne.locationX;
    let ly = ne.locationY;
    if (typeof lx !== "number" || typeof ly !== "number" || Number.isNaN(lx)) {
      // Web fallback — `getBoundingClientRect()` already accounts for the
      // ScrollView's current scroll position, so pageX − rect.left gives
      // coordinates inside the (scaled) inner content.
      lx = (ne.pageX ?? 0) - offsetRef.current.x;
      ly = (ne.pageY ?? 0) - offsetRef.current.y;
    }
    const x = (lx / innerW) * 100;
    const y = (ly / innerH) * 100;
    onTap(x, y);
  };

  // The Pressable below holds everything that should pan + scale together:
  // backdrop image, emoji elements, found markers, hint circle.
  const Inner = (
    <Pressable
      ref={innerRef as any}
      testID={`${testIDPrefix}-scene`}
      onLayout={measure}
      onPress={handlePress}
      style={{ width: innerW, height: innerH }}
    >
      {backgroundUrl ? (
        <Image
          source={{ uri: backgroundUrl }}
          pointerEvents="none"
          style={{ position: "absolute", left: 0, top: 0, width: innerW, height: innerH }}
          resizeMode="cover"
        />
      ) : null}
      {elements.map((el: Elem) => (
        <Text
          key={el.id}
          pointerEvents="none"
          style={{
            position: "absolute",
            left: (el.x / 100) * innerW - (el.size * zoom) / 2,
            top: (el.y / 100) * innerH - (el.size * zoom) / 2,
            fontSize: el.size * zoom,
            textShadowColor: "rgba(255,255,255,0.85)",
            textShadowOffset: { width: 0, height: 0 },
            textShadowRadius: 6,
          }}
        >
          {el.emoji}
        </Text>
      ))}
      {foundDiffs.map((d: Diff) => {
        const r = 20 * zoom;
        return (
          <View
            key={d.id}
            pointerEvents="none"
            style={{
              position: "absolute",
              left: (d.x / 100) * innerW - r,
              top: (d.y / 100) * innerH - r,
              width: r * 2,
              height: r * 2,
              borderRadius: r,
              borderWidth: 3,
              borderColor: "#16A34A",
              backgroundColor: "#16A34A22",
            }}
          >
            <Ionicons
              name="checkmark"
              size={Math.max(20, 28 * zoom)}
              color="#16A34A"
              style={{ position: "absolute", top: r - 14 * zoom, left: r - 13 * zoom }}
            />
          </View>
        );
      })}
      {hintCircle && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: (hintCircle.x / 100) * innerW - 30 * zoom,
            top: (hintCircle.y / 100) * innerH - 30 * zoom,
            width: 60 * zoom,
            height: 60 * zoom,
            borderRadius: 30 * zoom,
            borderWidth: 3,
            borderColor: "#F59E0B",
            backgroundColor: "#F59E0B22",
          }}
        />
      )}
    </Pressable>
  );

  return (
    <ScrollView
      testID={`${testIDPrefix}-scroll-h`}
      horizontal
      bounces={false}
      scrollEnabled={pannable}
      showsHorizontalScrollIndicator={pannable}
      showsVerticalScrollIndicator={false}
      onScroll={measure}
      scrollEventThrottle={32}
      style={{
        width: sceneW,
        height: sceneH,
        backgroundColor: "#EFF6FF",
        borderRadius: 14,
        borderWidth: 2,
        borderColor: "#1E3A7F",
      }}
      contentContainerStyle={{ width: innerW, height: innerH }}
    >
      <ScrollView
        testID={`${testIDPrefix}-scroll-v`}
        bounces={false}
        scrollEnabled={pannable}
        showsVerticalScrollIndicator={pannable}
        onScroll={measure}
        scrollEventThrottle={32}
        style={{ width: innerW, height: innerH }}
        contentContainerStyle={{ width: innerW, height: innerH }}
        nestedScrollEnabled
      >
        {Inner}
      </ScrollView>
    </ScrollView>
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

  // Given Scene B (the "broken" picture), apply each FOUND difference so the
  // bottom picture progressively becomes identical to Scene A (the master).
  // Diff types from the backend: add | remove | resize | swap | move | color.
  const applyFixes = useCallback((sceneA: Elem[], sceneB: Elem[], foundDiffIds: string[], diffs: Diff[]): Elem[] => {
    let result = sceneB.map((e) => ({ ...e }));
    for (const fid of foundDiffIds) {
      const diff: any = diffs.find((d) => d.id === fid);
      if (!diff) continue;
      const targetA = sceneA.find((e) => e.id === diff.target);
      const type = diff.type;
      if (type === "add" && targetA) {
        if (!result.find((e) => e.id === targetA.id)) result.push({ ...targetA });
      } else if (type === "remove") {
        result = result.filter((e) => e.id !== diff.target);
      } else if (type === "resize" && targetA) {
        result = result.map((e) => (e.id === diff.target ? { ...e, size: targetA.size } : e));
      } else if (type === "swap" && targetA) {
        result = result.map((e) => (e.id === diff.target ? { ...e, emoji: targetA.emoji } : e));
      } else if (type === "move" && targetA) {
        result = result.map((e) => (e.id === diff.target ? { ...e, x: targetA.x, y: targetA.y } : e));
      } else if (type === "color" && targetA) {
        // Color/style diffs swap the emoji to match (emoji-based palettes encode colour)
        result = result.map((e) => (e.id === diff.target ? { ...e, emoji: targetA.emoji } : e));
      }
    }
    return result;
  }, []);

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
  // Lifelike backdrop served by backend at /api/static/spot_bg/<theme>.jpg.
  // Prefix with the public backend host so the browser can load it through ingress.
  const backendBase = process.env.EXPO_PUBLIC_BACKEND_URL || "";
  const backgroundUrl = puzzle.background_url ? `${backendBase}${puzzle.background_url}` : null;

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

        {/* Top scene = MASTER (the correct version) — taps here mark differences */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
          <View style={{ backgroundColor: "#1E3A7F", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 }}>
            <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 12 * scale, letterSpacing: 0.5 }}>MASTER ★</Text>
          </View>
          <Text style={{ color: c.muted, fontSize: 12 * scale }}>Tap where you spot a difference</Text>
          {(magnify || zoom > 1.02) && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#FEF3C7", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 }}>
              <Ionicons name="hand-left" size={14} color="#92400E" />
              <Text style={{ color: "#92400E", fontWeight: "800", fontSize: 11 * scale }}>Drag to look around</Text>
            </View>
          )}
        </View>
        <Scene elements={puzzle.scene_a} found={foundIds} sceneW={sceneW} sceneH={sceneH} zoom={magnify ? Math.max(zoom, 1.8) : zoom} onTap={onTapScene} foundDiffs={foundDiffs} hintCircle={hintCircle} testIDPrefix="std-a" backgroundUrl={backgroundUrl} />
        {/* Bottom scene = WORKSPACE — auto-repairs to match the master as you find each difference */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8, marginBottom: 4 }}>
          <View style={{ backgroundColor: completed ? "#16A34A" : "#B45309", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 }}>
            <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 12 * scale, letterSpacing: 0.5 }}>{completed ? "MATCHED ✓" : "FOUND"}</Text>
          </View>
          <Text style={{ color: c.muted, fontSize: 12 * scale }}>{foundIds.length}/{puzzle.diff_count} pieces repaired</Text>
        </View>
        <Scene elements={applyFixes(puzzle.scene_a, puzzle.scene_b, foundIds, puzzle.differences)} found={foundIds} sceneW={sceneW} sceneH={sceneH} zoom={magnify ? Math.max(zoom, 1.8) : zoom} onTap={onTapScene} foundDiffs={foundDiffs} hintCircle={hintCircle} testIDPrefix="std-b" backgroundUrl={backgroundUrl} />

        <View style={styles.actions}>
          <Pressable testID="std-zoom-out" onPress={() => setZoom(Math.max(1, zoom - 0.25))} style={[styles.actionBtn, { backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border }]}>
            <Ionicons name="remove" size={18} color={c.onSurface} /><Text style={{ color: c.onSurface, fontWeight: "900" }}>Zoom out</Text>
          </Pressable>
          <Pressable testID="std-zoom-in" onPress={() => setZoom(Math.min(2.5, zoom + 0.25))} style={[styles.actionBtn, { backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border }]}>
            <Ionicons name="add" size={18} color={c.onSurface} /><Text style={{ color: c.onSurface, fontWeight: "900" }}>Zoom in</Text>
          </Pressable>
          <Pressable
            testID="std-magnify"
            accessibilityRole="button"
            accessibilityLabel={magnify ? "Turn off magnifier" : "Turn on magnifier"}
            onPress={() => setMagnify(!magnify)}
            style={[styles.actionBtn, { backgroundColor: magnify ? c.brand : c.surfaceSecondary, borderWidth: 1, borderColor: magnify ? c.brand : c.border }]}
          >
            <Ionicons name="search" size={18} color={magnify ? "#FFF" : c.onSurface} />
            <Text style={{ color: magnify ? "#FFF" : c.onSurface, fontWeight: "900" }}>Magnify {magnify ? "ON" : "off"}</Text>
          </Pressable>
          <Pressable testID="std-hint" onPress={onHint} disabled={hintsUsed >= (puzzle.hint_quota ?? 3) || completed} style={[styles.actionBtn, { backgroundColor: hintsUsed >= (puzzle.hint_quota ?? 3) || completed ? c.surfaceTertiary : "#F59E0B" }]}>
            <Ionicons name="bulb" size={18} color={hintsUsed >= (puzzle.hint_quota ?? 3) || completed ? c.muted : "#FFF"} /><Text style={{ color: hintsUsed >= (puzzle.hint_quota ?? 3) || completed ? c.muted : "#FFF", fontWeight: "900" }}>Hint ({(puzzle.hint_quota ?? 3) - hintsUsed})</Text>
          </Pressable>
        </View>
      </ScrollView>

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
