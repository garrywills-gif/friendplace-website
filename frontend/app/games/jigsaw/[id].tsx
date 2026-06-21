import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import SpeakButton from "@/src/components/SpeakButton";

type Puzzle = { id: string; category: string; title: string; url: string };
type Difficulty = { cols: number; rows: number; pieces: number; label: string };

const INSTRUCTIONS = "Tap a piece to pick it up, then tap another piece to swap them. Match the picture to win. Your progress saves automatically.";

function shuffleArray<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function JigsawPlayer() {
  const router = useRouter();
  const { id, d } = useLocalSearchParams<{ id: string; d?: string }>();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const { show, confirm } = useToast();
  const { width: winW } = useWindowDimensions();

  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [diffs, setDiffs] = useState<Record<string, Difficulty>>({});
  const [difficulty, setDifficulty] = useState<string>(typeof d === "string" ? d : "easy");
  const [order, setOrder] = useState<number[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [completed, setCompleted] = useState(false);
  const [showRef, setShowRef] = useState(true);

  // ---- load catalog + existing progress ----
  const startFresh = useCallback((diff: string, cols: number, rows: number) => {
    const total = cols * rows;
    let next = shuffleArray(Array.from({ length: total }, (_, i) => i));
    // ensure the puzzle isn't already solved
    if (next.every((v, i) => v === i)) next = shuffleArray(next);
    setOrder(next);
    setCompleted(false);
    setSelected(null);
  }, []);

  const load = useCallback(async (diff: string, puz: Puzzle, allDiffs: Record<string, Difficulty>) => {
    if (!user) return;
    try {
      const saved: any = await api.jigsawProgressOne(user.id, puz.id, diff);
      const g = allDiffs[diff];
      if (saved && Array.isArray(saved.order) && g && saved.order.length === g.cols * g.rows) {
        setOrder(saved.order);
        setCompleted(!!saved.completed);
        setSelected(null);
        return;
      }
    } catch {}
    if (allDiffs[diff]) startFresh(diff, allDiffs[diff].cols, allDiffs[diff].rows);
  }, [user, startFresh]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cat: any = await api.jigsawCatalog();
      const puz: Puzzle | undefined = (cat.puzzles || []).find((x: Puzzle) => x.id === id);
      if (!cancelled && puz) {
        setPuzzle(puz);
        setDiffs(cat.difficulties || {});
        await load(difficulty, puz, cat.difficulties || {});
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // ---- helpers ----
  const grid = diffs[difficulty];
  const total = grid ? grid.cols * grid.rows : 0;
  const percent = useMemo(() => {
    if (!order.length) return 0;
    const correct = order.reduce((s, v, i) => s + (v === i ? 1 : 0), 0);
    return (correct / order.length) * 100;
  }, [order]);

  // ---- persistence (debounced via useEffect on order) ----
  useEffect(() => {
    if (!user || !puzzle || !grid || order.length !== total) return;
    const done = order.every((v, i) => v === i);
    const handler = setTimeout(() => {
      api.jigsawSaveProgress(user.id, {
        puzzle_id: puzzle.id, difficulty, order, percent, completed: done,
      }).catch(() => {});
      if (done && !completed) {
        setCompleted(true);
        show("🎉 Puzzle complete! +15 Belong Points");
      }
    }, 350);
    return () => clearTimeout(handler);
  }, [order]);

  // ---- actions ----
  const changeDifficulty = (newDiff: string) => {
    if (!puzzle) return;
    setDifficulty(newDiff);
    load(newDiff, puzzle, diffs);
  };

  const tapTile = (i: number) => {
    if (completed) return;
    if (selected == null) { setSelected(i); return; }
    if (selected === i) { setSelected(null); return; }
    const next = order.slice();
    [next[selected], next[i]] = [next[i], next[selected]];
    setOrder(next);
    setSelected(null);
  };

  const restart = async () => {
    const ok = await confirm({ title: "Restart puzzle?", message: "Your current progress on this difficulty will be lost.", confirmLabel: "Restart", destructive: true });
    if (ok && grid) startFresh(difficulty, grid.cols, grid.rows);
  };

  if (!puzzle || !grid) {
    return (
      <View style={{ flex: 1, backgroundColor: c.surface }}>
        <Header title="Jigsaw" />
        <Text style={{ color: c.muted, padding: 20 }}>Loading puzzle…</Text>
      </View>
    );
  }

  // ---- board sizing: keep the board square-ish, max 92% width, minimum tile ~38px ----
  const horizontalPadding = 14 * 2;
  const boardW = Math.min(winW - horizontalPadding, 700);
  const tileW = boardW / grid.cols;
  const tileH = tileW * 0.78; // slightly shorter, looks like landscape puzzle
  const boardH = tileH * grid.rows;

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title={puzzle.title} />
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 60 }}>
        {/* Top toolbar */}
        <View style={[styles.toolbar, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.muted, fontWeight: "800", letterSpacing: 0.4, fontSize: 11 * scale }}>{puzzle.category.toUpperCase()}</Text>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 18 * scale, marginTop: 2 }}>{Math.round(percent)}% complete</Text>
            <View style={[styles.progress, { backgroundColor: c.surfaceTertiary }]}>
              <View style={[styles.progressFill, { backgroundColor: completed ? c.success : c.brand, width: `${Math.round(percent)}%` }]} />
            </View>
          </View>
          <SpeakButton text={INSTRUCTIONS} color={c.brand} size={22} bg={c.brandTertiary} testID="jigsaw-speak" />
        </View>

        {/* Difficulty chips */}
        <View style={styles.diffsRow}>
          {Object.entries(diffs).map(([k, v]) => {
            const active = k === difficulty;
            return (
              <Pressable key={k} testID={`diff-${k}`} onPress={() => changeDifficulty(k)} style={[styles.diffChip, { backgroundColor: active ? c.brand : c.surfaceSecondary, borderColor: active ? c.brand : c.border }]}>
                <Text style={{ color: active ? "#FFF" : c.onSurface, fontWeight: "800", fontSize: 13 * scale }}>{v.label}</Text>
                <Text style={{ color: active ? "rgba(255,255,255,0.85)" : c.muted, fontSize: 11 * scale, marginTop: 2 }}>{v.pieces} pcs</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Reference image toggle */}
        <View style={styles.refRow}>
          <Pressable testID="toggle-ref" onPress={() => setShowRef((v) => !v)} hitSlop={6}>
            <Text style={{ color: c.brandSecondary, fontWeight: "800", fontSize: 14 * scale }}>{showRef ? "Hide reference" : "Show reference"}</Text>
          </Pressable>
          <Pressable testID="restart" onPress={restart} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Ionicons name="refresh" size={16} color={c.muted} />
            <Text style={{ color: c.muted, fontWeight: "700", fontSize: 13 * scale }}>Restart</Text>
          </Pressable>
        </View>
        {showRef && (
          <Image source={puzzle.url} style={[styles.ref, { width: boardW, height: boardW * 0.45 }]} contentFit="cover" />
        )}

        {/* The board: each tile shows a portion of the image at its CORRECT location.
            order[i] is the piece currently in slot i. Tile renders the piece's image with negative offsets.
            Touch targets are large (>=44px) for older users. */}
        <View style={[styles.board, { width: boardW, height: boardH }]}>
          {order.map((pieceIndex, slotIndex) => {
            const correct = pieceIndex === slotIndex;
            const px = pieceIndex % grid.cols;
            const py = Math.floor(pieceIndex / grid.cols);
            const isSelected = selected === slotIndex;
            return (
              <Pressable
                key={slotIndex}
                testID={`tile-${slotIndex}`}
                onPress={() => tapTile(slotIndex)}
                accessibilityRole="button"
                accessibilityLabel={`Piece in row ${Math.floor(slotIndex / grid.cols) + 1}, column ${slotIndex % grid.cols + 1}${correct ? " — in place" : ""}`}
                style={[
                  styles.tile,
                  {
                    width: tileW,
                    height: tileH,
                    borderColor: isSelected ? c.accent : correct ? "rgba(22,163,74,0.65)" : "rgba(255,255,255,0.65)",
                    borderWidth: isSelected ? 4 : 1.5,
                  },
                ]}
              >
                <Image
                  source={puzzle.url}
                  style={{
                    width: tileW * grid.cols,
                    height: tileH * grid.rows,
                    marginLeft: -px * tileW,
                    marginTop: -py * tileH,
                  }}
                  contentFit="cover"
                />
              </Pressable>
            );
          })}
        </View>

        {completed && (
          <View style={[styles.doneCard, { backgroundColor: c.success }]}>
            <Ionicons name="trophy" size={26} color="#FFF" />
            <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 18 * scale, marginLeft: 10 }}>Puzzle complete! +15 ⚜︎</Text>
          </View>
        )}

        <Pressable testID="back-to-hub" onPress={() => router.push("/games/jigsaw")} style={[styles.hubBtn, { borderColor: c.border, backgroundColor: c.surfaceSecondary }]}>
          <Ionicons name="grid" size={20} color={c.brand} />
          <Text style={{ color: c.brand, fontWeight: "800", fontSize: 16 * scale }}>Back to all puzzles</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 16, borderWidth: 1 },
  progress: { height: 8, borderRadius: 4, marginTop: 6, overflow: "hidden" },
  progressFill: { height: 8, borderRadius: 4 },
  diffsRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  diffChip: { flex: 1, borderRadius: 14, borderWidth: 2, paddingVertical: 10, paddingHorizontal: 8, alignItems: "center", minHeight: 56 },
  refRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 12 },
  ref: { alignSelf: "center", borderRadius: 14, marginTop: 6 },
  board: { alignSelf: "center", marginTop: 14, flexDirection: "row", flexWrap: "wrap", borderRadius: 6, overflow: "hidden", backgroundColor: "#000" },
  tile: { overflow: "hidden" },
  doneCard: { flexDirection: "row", alignItems: "center", padding: 16, borderRadius: 16, marginTop: 16 },
  hubBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 16, borderWidth: 1, marginTop: 14 },
});
