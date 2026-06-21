import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, useWindowDimensions, ActivityIndicator, Modal } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import SpeakButton from "@/src/components/SpeakButton";

type Cell = [number, number];

const HOW_TO = "Touch the first letter and drag your finger to the last letter, then lift your finger. The squares you trace will be highlighted. If you got the word right, it turns green. Words go across, down, or diagonally. You can also tap the first letter and then the last letter if you prefer not to drag. Tap the speaker to hear the remaining words. Tap Hint if you need a clue.";

function sameCell(a: Cell | null, b: Cell | null) {
  return !!a && !!b && a[0] === b[0] && a[1] === b[1];
}

/** Returns the straight-line path of cells between start & end if it's a valid
 *  horizontal/vertical/diagonal (8-directional) move, else null. */
function tracePath(start: Cell, end: Cell): Cell[] | null {
  const [r1, c1] = start;
  const [r2, c2] = end;
  const dr = r2 - r1;
  const dc = c2 - c1;
  if (dr === 0 && dc === 0) return [start];
  // Must be straight: horizontal, vertical, or 45° diagonal
  if (dr !== 0 && dc !== 0 && Math.abs(dr) !== Math.abs(dc)) return null;
  const len = Math.max(Math.abs(dr), Math.abs(dc));
  const stepR = dr === 0 ? 0 : dr / Math.abs(dr);
  const stepC = dc === 0 ? 0 : dc / Math.abs(dc);
  const path: Cell[] = [];
  for (let i = 0; i <= len; i++) path.push([r1 + stepR * i, c1 + stepC * i]);
  return path;
}

function buildPlacementFromCells(cells: number[][] | undefined): string {
  if (!cells) return "";
  return cells.map(([r, c]) => `${r},${c}`).join("|");
}

function cellsToKeySet(path: Cell[] | number[][]): Set<string> {
  const s = new Set<string>();
  for (const cell of path) s.add(`${cell[0]},${cell[1]}`);
  return s;
}

function pathsEqualForward(a: Cell[], b: number[][]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false;
  return true;
}

function pathMatchesWord(path: Cell[], placement: number[][]): boolean {
  if (path.length !== placement.length) return false;
  return pathsEqualForward(path, placement) || pathsEqualForward([...path].reverse(), placement);
}

export default function WordSearchPlayer() {
  const router = useRouter();
  const { theme, difficulty, daily } = useLocalSearchParams<{ theme: string; difficulty: string; daily?: string }>();
  const { c, scale, prefs } = useTheme();
  const { user } = useAuth();
  const { show } = useToast();
  const { width: winW } = useWindowDimensions();

  const isDaily = daily === "1";
  const [puzzle, setPuzzle] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [start, setStart] = useState<Cell | null>(null);
  const [hover, setHover] = useState<Cell | null>(null); // current finger/end
  const [found, setFound] = useState<string[]>([]);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [hintCell, setHintCell] = useState<Cell | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [showHow, setShowHow] = useState(false);
  const [showWin, setShowWin] = useState(false);
  const startedAt = useRef<number>(Date.now());

  // ---- Load puzzle (+ resume saved progress) ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const puz: any = isDaily ? await api.wsDaily() : await api.wsPuzzle(theme as string, difficulty as string);
        if (cancelled) return;
        setPuzzle(puz);
        // Try to resume
        if (user) {
          try {
            const saved: any = await api.wsGetProgress(user.id, puz.puzzle_id);
            if (saved && saved.found_words) {
              setFound(saved.found_words || []);
              setHintsUsed(saved.hints_used || 0);
              setSeconds(saved.seconds || 0);
              if (saved.completed) setCompleted(true);
              startedAt.current = Date.now() - (saved.seconds || 0) * 1000;
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

  // ---- Timer ----
  useEffect(() => {
    if (completed) return;
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [completed]);

  // ---- Auto-save (debounced) ----
  const saveTimer = useRef<any>(null);
  const persist = useCallback((nextFound: string[], nextHints: number, didFinish: boolean) => {
    if (!user || !puzzle) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const r: any = await api.wsSaveProgress(user.id, {
          puzzle_id: puzzle.puzzle_id,
          theme: puzzle.theme,
          difficulty: puzzle.difficulty,
          found_words: nextFound,
          hints_used: nextHints,
          seconds,
          completed: didFinish,
          is_daily: isDaily,
        });
        if (didFinish && r?.granted) {
          if (r.granted.includes("hard") || r.granted.includes("nightmare")) {
            show("🦋 Friends will see a celebration Flutter!");
          }
        }
      } catch {}
    }, 400);
  }, [user, puzzle, seconds, isDaily]);

  // ---- Compute board sizing ----
  const size = puzzle?.size ?? 8;
  const horizontalPad = 14 * 2;
  const boardW = Math.min(winW - horizontalPad, 520);
  const tileW = Math.floor(boardW / size);
  const realBoardW = tileW * size;

  // ---- Path being traced ----
  const currentPath: Cell[] | null = useMemo(() => {
    if (!start || !hover) return null;
    return tracePath(start, hover);
  }, [start, hover]);
  const currentPathSet = useMemo(() => currentPath ? cellsToKeySet(currentPath) : new Set<string>(), [currentPath]);

  // Cells of all already-found words (for "stays-highlighted" rendering)
  const foundCellSet = useMemo(() => {
    if (!puzzle) return new Set<string>();
    const s = new Set<string>();
    for (const w of found) {
      const place = puzzle.placements?.[w];
      if (place) for (const [r, c] of place) s.add(`${r},${c}`);
    }
    return s;
  }, [puzzle, found]);

  // Shared path-completion logic — used by both tap (2-tap mode) and drag.
  const completePath = useCallback((path: Cell[] | null) => {
    if (!puzzle || completed) return;
    if (!path || path.length < 2) { setStart(null); setHover(null); return; }
    const remaining = puzzle.words.filter((w: string) => !found.includes(w));
    let matched: string | null = null;
    for (const w of remaining) {
      const place = puzzle.placements[w];
      if (pathMatchesWord(path, place)) { matched = w; break; }
    }
    if (matched) {
      const next = [...found, matched];
      setFound(next);
      setStart(null); setHover(null);
      const didFinish = next.length === puzzle.words.length;
      if (didFinish) {
        setCompleted(true);
        setShowWin(true);
      }
      persist(next, hintsUsed, didFinish);
      show(`✅ Found ${matched}!`);
    } else {
      setStart(null); setHover(null);
      show("Not quite — try again");
    }
  }, [puzzle, completed, found, hintsUsed, persist, show]);

  const onCellTap = (r: number, c: number) => {
    if (completed || !puzzle || dragMode.current) return;
    setHintCell(null);
    if (!start) {
      setStart([r, c]);
      setHover([r, c]);
      return;
    }
    // Second tap = end of word
    const end: Cell = [r, c];
    if (sameCell(start, end)) {
      setStart(null); setHover(null); return;
    }
    const path = tracePath(start, end);
    if (!path) { show("Words go straight: across, down or diagonally"); setStart(null); setHover(null); return; }
    completePath(path);
  };

  // ---- Drag-to-select (touch a letter, slide finger across, lift) ----
  // We use the responder system on the board container so a single continuous
  // gesture can traverse multiple cells. Two gestures supported:
  //   (1) TAP-TAP: tap first letter → tap last letter (accessibility-friendly)
  //   (2) DRAG: touch first letter, slide finger to last letter, lift
  const boardLayout = useRef<{ x: number; y: number; tile: number } | null>(null);
  const dragMode = useRef<boolean>(false);
  const movedRef = useRef<boolean>(false);
  const grantCell = useRef<Cell | null>(null);
  const onBoardLayout = (e: any) => {
    e.target?.measureInWindow?.((x: number, y: number) => {
      boardLayout.current = { x: x + 6, y: y + 6, tile: tileW }; // +6 = boardWrap padding
    });
  };
  const xyToCell = useCallback((pageX: number, pageY: number): Cell | null => {
    const bl = boardLayout.current;
    if (!bl) return null;
    const col = Math.floor((pageX - bl.x) / bl.tile);
    const row = Math.floor((pageY - bl.y) / bl.tile);
    if (row < 0 || col < 0 || row >= size || col >= size) return null;
    return [row, col];
  }, [size]);
  const dragHandlers = {
    onStartShouldSetResponder: () => !completed,
    onMoveShouldSetResponder: () => !completed,
    onResponderGrant: (e: any) => {
      if (completed) return;
      const cell = xyToCell(e.nativeEvent.pageX, e.nativeEvent.pageY);
      if (!cell) return;
      setHintCell(null);
      movedRef.current = false;
      grantCell.current = cell;
      // Don't change `start` yet — wait to see if this is a drag or a tap.
      // (Touch DOWN visual feedback): show the cell as "start" temporarily if
      // we don't already have a pending tap-twice start.
      if (!start) {
        setStart(cell);
        setHover(cell);
      } else {
        // We had a pending tap-twice start from earlier — keep it visible but
        // also show the user where their finger landed.
        setHover(cell);
      }
    },
    onResponderMove: (e: any) => {
      const cell = xyToCell(e.nativeEvent.pageX, e.nativeEvent.pageY);
      if (!cell || !grantCell.current) return;
      if (!movedRef.current && !sameCell(grantCell.current, cell)) {
        // Movement detected → enter drag mode. Start is the cell we grabbed.
        movedRef.current = true;
        dragMode.current = true;
        setStart(grantCell.current);
      }
      if (movedRef.current) {
        const anchor: Cell = grantCell.current!;
        const path = tracePath(anchor, cell);
        // Snap to nearest straight line: only update hover if it's a valid line
        if (path) setHover(cell);
      }
    },
    onResponderRelease: (e: any) => {
      const wasDrag = movedRef.current;
      movedRef.current = false;
      dragMode.current = false;
      if (wasDrag) {
        // Drag complete — validate path from the cell we grabbed to current hover
        const endCell = xyToCell(e.nativeEvent.pageX, e.nativeEvent.pageY) || hover;
        const path = (grantCell.current && endCell) ? tracePath(grantCell.current, endCell) : null;
        grantCell.current = null;
        completePath(path);
        return;
      }
      // Single tap with no movement — use tap-twice behavior.
      const cell = grantCell.current;
      grantCell.current = null;
      if (!cell) { return; }
      // If `start` was just set in onResponderGrant (no prior pending), keep it as the pending start.
      // If `start` already existed from a previous gesture AND it is NOT this cell,
      // treat this as the second tap completing the selection.
      // To distinguish, compare to where `start` was BEFORE this gesture — which equals
      // the cell we set in onResponderGrant only if there was no prior start.
      // We capture the prior-start by checking if start was already set BEFORE this gesture:
      // We mirror that via a ref.
      if (priorStart.current && !sameCell(priorStart.current, cell)) {
        const path = tracePath(priorStart.current, cell);
        priorStart.current = null;
        if (!path) {
          show("Words go straight: across, down or diagonally");
          setStart(null); setHover(null);
          return;
        }
        completePath(path);
        return;
      }
      // First tap — remember the cell as pending start.
      priorStart.current = cell;
      setStart(cell);
      setHover(cell);
    },
    onResponderTerminationRequest: () => false,
    onResponderTerminate: () => {
      movedRef.current = false; dragMode.current = false; grantCell.current = null;
    },
  };
  // Mirrors the visible `start` state so we know if a previous tap left a
  // pending start when a new tap gesture begins.
  const priorStart = useRef<Cell | null>(null);
  useEffect(() => { priorStart.current = start; }, [start]);

  const onHint = () => {
    if (!puzzle || completed) return;
    const maxHints = puzzle.hint_quota ?? 3;
    if (hintsUsed >= maxHints) { show(`No hints left — ${maxHints} per puzzle`); return; }
    const remaining = puzzle.words.filter((w: string) => !found.includes(w));
    if (remaining.length === 0) return;
    const word = remaining[Math.floor(Math.random() * remaining.length)];
    const place = puzzle.placements[word];
    if (!place || place.length === 0) return;
    setHintCell([place[0][0], place[0][1]]);
    setHintsUsed(hintsUsed + 1);
    persist(found, hintsUsed + 1, false);
    show(`Look around row ${place[0][0] + 1}, column ${place[0][1] + 1} for "${word}"`);
  };

  const onClear = () => { setStart(null); setHover(null); };

  const remainingWords: string[] = useMemo(() => puzzle ? puzzle.words.filter((w: string) => !found.includes(w)) : [], [puzzle, found]);
  const readAloudText = useMemo(() => {
    if (!puzzle) return "";
    if (remainingWords.length === 0) return "All words found! Great job.";
    return `Find these words: ${remainingWords.join(", ")}.`;
  }, [remainingWords, puzzle]);

  if (loading || !puzzle) {
    return (
      <View style={{ flex: 1, backgroundColor: c.surface }}>
        <Header title="Word Search" />
        <View style={{ padding: 30 }}><ActivityIndicator color={c.brand} /></View>
      </View>
    );
  }

  const totalWords = puzzle.words.length;
  const foundCount = found.length;
  const hintsLeft = Math.max(0, (puzzle.hint_quota ?? 3) - hintsUsed);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title={`${puzzle.theme_emoji} ${puzzle.theme_label}`} />
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 60, gap: 12 }}>
        {/* Top bar */}
        <View style={[styles.topBar, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.muted, fontWeight: "800", letterSpacing: 0.4, fontSize: 11 * scale }}>
              {puzzle.difficulty_label.toUpperCase()}{isDaily ? " · DAILY" : ""}
            </Text>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 17 * scale, marginTop: 2 }}>
              {foundCount}/{totalWords} found · {minutes}:{secs.toString().padStart(2, "0")}
            </Text>
            <View style={[styles.progress, { backgroundColor: c.surfaceTertiary }]}>
              <View style={[styles.progressFill, { backgroundColor: completed ? c.success : c.brand, width: `${Math.round((foundCount / totalWords) * 100)}%` }]} />
            </View>
          </View>
          <Pressable testID="ws-how-toggle" onPress={() => setShowHow(true)} hitSlop={6} style={[styles.iconBtn, { backgroundColor: c.brandTertiary }]}>
            <Ionicons name="help-circle" size={22} color={c.brand} />
          </Pressable>
          {prefs.readMessagesAloud && (
            <SpeakButton text={readAloudText} color={c.brand} size={22} bg={c.brandTertiary} testID="ws-speak" />
          )}
        </View>

        {/* Board — drag-to-select handled at board level; tap still works on each cell */}
        <View
          onLayout={onBoardLayout}
          {...dragHandlers}
          style={[styles.boardWrap, { backgroundColor: c.surfaceSecondary, borderColor: c.border, width: realBoardW + 12, alignSelf: "center" }]}
        >
          {puzzle.grid.map((row: string[], r: number) => (
            <View key={r} style={{ flexDirection: "row" }}>
              {row.map((letter: string, ci: number) => {
                const key = `${r},${ci}`;
                const isStart = !!start && start[0] === r && start[1] === ci;
                const isOnPath = currentPathSet.has(key);
                const isFound = foundCellSet.has(key);
                const isHint = !!hintCell && hintCell[0] === r && hintCell[1] === ci;
                const bg = isFound
                  ? "#16A34A"
                  : isOnPath || isStart
                  ? c.brand
                  : isHint
                  ? "#F59E0B"
                  : c.surfaceTertiary;
                const fg = isFound || isOnPath || isStart || isHint ? "#FFFFFF" : c.onSurface;
                return (
                  <Pressable
                    key={ci}
                    testID={`ws-cell-${r}-${ci}`}
                    onPress={() => onCellTap(r, ci)}
                    hitSlop={10}
                    delayPressIn={0}
                    accessibilityRole="button"
                    accessibilityLabel={letter}
                    style={[styles.cell, { width: tileW, height: tileW, backgroundColor: bg, borderColor: isStart ? c.accent : "transparent" }]}
                  >
                    <Text style={{ color: fg, fontWeight: "900", fontSize: Math.max(13, tileW * 0.46) * scale }}>{letter}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>

        {/* Always-visible tip — explains the gesture + that diagonals work. */}
        <Text style={{ color: c.muted, fontSize: 13 * scale, textAlign: "center", marginTop: 6 }}>
          💡 <Text style={{ fontWeight: "800" }}>Drag</Text> across the letters, or tap the first letter and then the last. Words can go across, down, or <Text style={{ fontWeight: "800" }}>diagonally</Text>.
        </Text>

        {/* Selection hint */}
        {start && !dragMode.current && (
          <Text style={{ color: c.brand, fontSize: 14 * scale, textAlign: "center", fontWeight: "700", marginTop: 2 }}>
            Now tap the last letter · <Text onPress={onClear} style={{ color: c.brand, fontWeight: "800", textDecorationLine: "underline" }}>cancel</Text>
          </Text>
        )}

        {/* Action row */}
        <View style={styles.actions}>
          <Pressable
            testID="ws-hint"
            onPress={onHint}
            disabled={hintsLeft === 0 || completed}
            style={[styles.actionBtn, { backgroundColor: hintsLeft === 0 || completed ? c.surfaceTertiary : "#F59E0B" }]}
          >
            <Ionicons name="bulb" size={18} color={hintsLeft === 0 || completed ? c.muted : "#FFF"} />
            <Text style={{ color: hintsLeft === 0 || completed ? c.muted : "#FFF", fontWeight: "900", fontSize: 14 * scale }}>Hint ({hintsLeft})</Text>
          </Pressable>
          {prefs.readMessagesAloud && (
            <View style={[styles.actionBtn, { backgroundColor: c.brandTertiary }]}>
              <SpeakButton text={readAloudText} color={c.brand} size={20} testID="ws-readwords" />
              <Text style={{ color: c.brand, fontWeight: "900", fontSize: 14 * scale }}>Read words</Text>
            </View>
          )}
          <Pressable testID="ws-clear" onPress={onClear} style={[styles.actionBtn, { backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border }]}>
            <Ionicons name="close" size={18} color={c.onSurface} />
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 14 * scale }}>Clear</Text>
          </Pressable>
        </View>

        {/* Word list */}
        <View style={[styles.wordList, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 14 * scale, marginBottom: 8 }}>Find these words</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {puzzle.words.map((w: string) => {
              const done = found.includes(w);
              return (
                <View key={w} style={[styles.wordChip, { backgroundColor: done ? "#16A34A22" : c.surfaceTertiary, borderColor: done ? "#16A34A" : c.border }]}>
                  <Text style={{ color: done ? "#16A34A" : c.onSurface, fontWeight: "800", fontSize: 14 * scale, textDecorationLine: done ? "line-through" : "none" }}>
                    {w}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>

      {/* How to Play modal */}
      <Modal visible={showHow} animationType="fade" transparent onRequestClose={() => setShowHow(false)}>
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, { backgroundColor: c.surface }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 19 * scale }}>How to play</Text>
              <SpeakButton text={HOW_TO} color={c.brand} size={22} testID="ws-modal-speak" />
            </View>
            <Text style={{ color: c.onSurface, fontSize: 16 * scale, marginTop: 10, lineHeight: 24 }}>{HOW_TO}</Text>
            <Pressable testID="ws-how-close" onPress={() => setShowHow(false)} style={[styles.closeBtn, { backgroundColor: c.brand }]}>
              <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 16 * scale }}>Got it</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Win modal */}
      <Modal visible={showWin} animationType="fade" transparent onRequestClose={() => setShowWin(false)}>
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, { backgroundColor: c.surface, alignItems: "center" }]}>
            <Text style={{ fontSize: 54 }}>🎉</Text>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 22 * scale, marginTop: 8 }}>You found them all!</Text>
            <Text style={{ color: c.muted, fontSize: 15 * scale, marginTop: 8, textAlign: "center" }}>
              {puzzle.theme_label} · {puzzle.difficulty_label} · {minutes}:{secs.toString().padStart(2, "0")}{"\n"}+{puzzle.points} Belong Points
            </Text>
            {(puzzle.difficulty === "hard" || puzzle.difficulty === "nightmare") && (
              <Text style={{ color: c.brand, fontWeight: "800", fontSize: 14 * scale, marginTop: 8, textAlign: "center" }}>🦋 Friends will see a celebration Flutter</Text>
            )}
            <Pressable testID="ws-win-back" onPress={() => { setShowWin(false); router.replace("/games/wordsearch"); }} style={[styles.closeBtn, { backgroundColor: c.brand, marginTop: 16 }]}>
              <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 16 * scale }}>Pick another puzzle</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, borderWidth: 1 },
  progress: { height: 8, borderRadius: 4, marginTop: 6, overflow: "hidden" },
  progressFill: { height: 8, borderRadius: 4 },
  iconBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  boardWrap: { borderWidth: 1, borderRadius: 10, padding: 6 },
  cell: { alignItems: "center", justifyContent: "center", borderWidth: 1.5 },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999 },
  wordList: { borderRadius: 16, padding: 12, borderWidth: 1 },
  wordChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5 },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", padding: 20 },
  modalCard: { width: "100%", maxWidth: 460, borderRadius: 20, padding: 20 },
  closeBtn: { paddingVertical: 14, borderRadius: 999, alignItems: "center", marginTop: 18, width: "100%" },
});
