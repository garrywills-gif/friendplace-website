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

const HOW_TO = "Sudoku. Fill every row, column, and 3 by 3 box with the digits 1 through 9. Tap a cell, then tap a number. Tap the pencil to write small candidate notes. You have 3 mistakes before the puzzle ends. Use a hint if you get stuck. Auto-save is on.";

type Grid = number[][];
type Notes = number[][][];

const make9x9 = (): Grid => Array.from({ length: 9 }, () => Array(9).fill(0));
const makeNotes = (): Notes => Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => [] as number[]));

export default function SudokuPlayer() {
  const router = useRouter();
  const { difficulty, daily } = useLocalSearchParams<{ difficulty: string; daily?: string }>();
  const { c, scale, prefs } = useTheme();
  const { user } = useAuth();
  const { show } = useToast();
  const { width: winW } = useWindowDimensions();
  const isDaily = daily === "1";

  const [puzzle, setPuzzle] = useState<any>(null);  // {puzzle, seed, difficulty, ...}
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<Grid>(make9x9());
  const [notes, setNotes] = useState<Notes>(makeNotes());
  const [sel, setSel] = useState<[number, number] | null>(null);
  const [pencil, setPencil] = useState(true);     // pencil mode ON by default
  const [hintsUsed, setHintsUsed] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [showHow, setShowHow] = useState(false);
  const [showWin, setShowWin] = useState(false);
  const [showLose, setShowLose] = useState(false);
  const [wrongCell, setWrongCell] = useState<[number, number] | null>(null);
  const startedAt = useRef<number>(Date.now());

  // Load + resume
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const puz: any = isDaily ? await api.sdDaily() : await api.sdPuzzle(difficulty as string);
        if (cancelled) return;
        setPuzzle(puz);
        let init = (puz.puzzle as Grid).map((r) => r.slice());
        let initNotes = makeNotes();
        if (user) {
          try {
            const saved: any = await api.sdGetProgress(user.id, puz.puzzle_id);
            if (saved && Array.isArray(saved.entries)) {
              init = saved.entries;
              initNotes = (saved.notes && saved.notes.length === 9) ? saved.notes : makeNotes();
              setHintsUsed(saved.hints_used || 0);
              setMistakes(saved.mistakes || 0);
              setSeconds(saved.seconds || 0);
              startedAt.current = Date.now() - (saved.seconds || 0) * 1000;
              if (saved.completed) setCompleted(true);
            }
          } catch {}
        }
        setEntries(init);
        setNotes(initNotes);
      } catch {
        show("Could not load puzzle");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [difficulty, isDaily, user?.id]);

  // Timer
  useEffect(() => {
    if (completed) return;
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [completed]);

  // Auto-save (debounced)
  const saveTimer = useRef<any>(null);
  const persist = useCallback((nextEntries: Grid, nextNotes: Notes, nextHints: number, nextMistakes: number, didFinish: boolean) => {
    if (!user || !puzzle) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const r: any = await api.sdSaveProgress(user.id, {
          puzzle_id: puzzle.puzzle_id,
          difficulty: puzzle.difficulty,
          entries: nextEntries,
          notes: nextNotes,
          hints_used: nextHints,
          mistakes: nextMistakes,
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

  // Helpers
  const isGiven = (r: number, ci: number) => puzzle && puzzle.puzzle[r][ci] !== 0;
  const isComplete = (g: Grid) => g.every((row) => row.every((v) => v !== 0));

  const onCellTap = (r: number, ci: number) => {
    if (completed) return;
    setSel([r, ci]);
  };

  const eraseSel = () => {
    if (!sel || !puzzle) return;
    const [r, ci] = sel;
    if (isGiven(r, ci)) return;
    const next = entries.map((row) => row.slice());
    next[r][ci] = 0;
    const nn = notes.map((row) => row.map((arr) => arr.slice()));
    nn[r][ci] = [];
    setEntries(next); setNotes(nn);
    persist(next, nn, hintsUsed, mistakes, false);
  };

  const onNumber = async (v: number) => {
    if (!sel || !puzzle || completed) return;
    const [r, ci] = sel;
    if (isGiven(r, ci)) return;
    if (pencil) {
      // Toggle in notes
      const nn = notes.map((row) => row.map((arr) => arr.slice()));
      const arr = nn[r][ci];
      const idx = arr.indexOf(v);
      if (idx >= 0) arr.splice(idx, 1); else arr.push(v);
      setNotes(nn);
      persist(entries, nn, hintsUsed, mistakes, false);
      return;
    }
    // Hard place — validate via API
    try {
      const r2: any = await api.sdCheck(puzzle.difficulty, puzzle.seed, r, ci, v);
      if (r2.correct) {
        const next = entries.map((row) => row.slice());
        next[r][ci] = v;
        // Clear notes for this cell + remove v from peers' notes
        const nn = notes.map((row) => row.map((arr) => arr.slice()));
        nn[r][ci] = [];
        for (let i = 0; i < 9; i++) {
          if (i !== ci) nn[r][i] = nn[r][i].filter((x) => x !== v);
          if (i !== r)  nn[i][ci] = nn[i][ci].filter((x) => x !== v);
        }
        const br = Math.floor(r / 3) * 3;
        const bc = Math.floor(ci / 3) * 3;
        for (let rr = br; rr < br + 3; rr++) {
          for (let cc = bc; cc < bc + 3; cc++) {
            if (rr !== r || cc !== ci) nn[rr][cc] = nn[rr][cc].filter((x) => x !== v);
          }
        }
        setEntries(next);
        setNotes(nn);
        const done = isComplete(next);
        if (done) { setCompleted(true); setShowWin(true); }
        persist(next, nn, hintsUsed, mistakes, done);
      } else {
        const m = mistakes + 1;
        setMistakes(m);
        setWrongCell([r, ci]);
        setTimeout(() => setWrongCell(null), 600);
        show(`Not quite — mistake ${m} of ${puzzle.max_mistakes}`);
        const maxMistakes = puzzle.max_mistakes ?? 3;
        if (m >= maxMistakes) {
          setShowLose(true);
        }
        persist(entries, notes, hintsUsed, m, false);
      }
    } catch {
      show("Connection issue — try again");
    }
  };

  const onHint = async () => {
    if (!puzzle || !sel || completed) return;
    const maxHints = puzzle.hint_quota ?? 3;
    if (hintsUsed >= maxHints) { show(`No hints left — ${maxHints} per puzzle`); return; }
    const [r, ci] = sel;
    if (isGiven(r, ci)) { show("Pick an empty cell first"); return; }
    try {
      const res: any = await api.sdHint(puzzle.difficulty, puzzle.seed, r, ci);
      const v = res.value;
      const next = entries.map((row) => row.slice());
      next[r][ci] = v;
      const nn = notes.map((row) => row.map((arr) => arr.slice()));
      nn[r][ci] = [];
      setEntries(next); setNotes(nn);
      const h = hintsUsed + 1;
      setHintsUsed(h);
      const done = isComplete(next);
      if (done) { setCompleted(true); setShowWin(true); }
      persist(next, nn, h, mistakes, done);
      show(`Hint placed: ${v}`);
    } catch {
      show("Hint unavailable");
    }
  };

  // Sizing
  if (loading || !puzzle) {
    return (
      <View style={{ flex: 1, backgroundColor: c.surface }}>
        <Header title="Sudoku" />
        <View style={{ padding: 30 }}><ActivityIndicator color={c.brand} /></View>
      </View>
    );
  }

  const horizontalPad = 14 * 2;
  const boardW = Math.min(winW - horizontalPad, 460);
  const tile = Math.floor(boardW / 9);
  const realBoardW = tile * 9;

  const [selR, selC] = sel || [-1, -1];
  const selVal = sel && entries[selR][selC] !== 0 ? entries[selR][selC] : (sel && puzzle.puzzle[selR][selC] !== 0 ? puzzle.puzzle[selR][selC] : 0);

  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const filledCount = entries.flat().filter((v) => v !== 0).length;

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Sudoku" />
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 60, gap: 12 }}>
        {/* Top bar */}
        <View style={[styles.topBar, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.muted, fontWeight: "800", letterSpacing: 0.4, fontSize: 11 * scale }}>
              {puzzle.difficulty_label.toUpperCase()}{isDaily ? " · DAILY" : ""}
            </Text>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 16 * scale, marginTop: 2 }}>
              {filledCount}/81 · {m}:{s.toString().padStart(2, "0")} · ❌ {mistakes}/{puzzle.max_mistakes}
            </Text>
          </View>
          <Pressable onPress={() => setShowHow(true)} hitSlop={6} style={[styles.iconBtn, { backgroundColor: c.brandTertiary }]} testID="sd-how-toggle">
            <Ionicons name="help-circle" size={22} color={c.brand} />
          </Pressable>
          {prefs.readMessagesAloud && (<SpeakButton text={HOW_TO} color={c.brand} size={22} bg={c.brandTertiary} testID="sd-speak" />)}
        </View>

        {/* Board */}
        <View style={[styles.boardWrap, { backgroundColor: c.surfaceSecondary, borderColor: c.onSurface, width: realBoardW + 2, alignSelf: "center" }]}>
          {entries.map((row, r) => (
            <View key={r} style={{ flexDirection: "row" }}>
              {row.map((v, ci) => {
                const given = isGiven(r, ci);
                const shownVal = v || (given ? puzzle.puzzle[r][ci] : 0);
                const isSelected = sel && sel[0] === r && sel[1] === ci;
                const inSelRowCol = sel && (sel[0] === r || sel[1] === ci);
                const inSelBox = sel && Math.floor(sel[0] / 3) === Math.floor(r / 3) && Math.floor(sel[1] / 3) === Math.floor(ci / 3);
                const sameDigit = selVal !== 0 && shownVal === selVal;
                const isWrong = wrongCell && wrongCell[0] === r && wrongCell[1] === ci;

                let bg = c.surface;
                if (isSelected) bg = c.brandTertiary;
                else if (sameDigit) bg = "#FACC1533";
                else if (inSelRowCol || inSelBox) bg = c.surfaceTertiary;
                if (isWrong) bg = "#EF444466";

                const fg = given ? c.onSurface : c.brand;
                const cellNotes = notes[r]?.[ci] || [];

                // Thick borders for 3×3 boxes
                const borderTopColor = r % 3 === 0 ? c.onSurface : c.border;
                const borderLeftColor = ci % 3 === 0 ? c.onSurface : c.border;
                const borderTopWidth = r % 3 === 0 ? 2 : 0.5;
                const borderLeftWidth = ci % 3 === 0 ? 2 : 0.5;
                const borderBottomWidth = r === 8 ? 2 : 0;
                const borderRightWidth = ci === 8 ? 2 : 0;

                return (
                  <Pressable
                    key={ci}
                    testID={`sd-cell-${r}-${ci}`}
                    onPress={() => onCellTap(r, ci)}
                    style={{
                      width: tile, height: tile, backgroundColor: bg, alignItems: "center", justifyContent: "center",
                      borderTopColor, borderLeftColor, borderBottomColor: c.onSurface, borderRightColor: c.onSurface,
                      borderTopWidth, borderLeftWidth, borderBottomWidth, borderRightWidth,
                    }}
                  >
                    {shownVal !== 0 ? (
                      <Text style={{ color: fg, fontWeight: given ? "900" : "700", fontSize: Math.max(15, tile * 0.55) * scale }}>{shownVal}</Text>
                    ) : (
                      <View style={{ width: "100%", height: "100%", flexDirection: "row", flexWrap: "wrap", padding: 2 }}>
                        {[1,2,3,4,5,6,7,8,9].map((n) => (
                          <View key={n} style={{ width: "33%", height: "33%", alignItems: "center", justifyContent: "center" }}>
                            {cellNotes.includes(n) && <Text style={{ color: c.muted, fontSize: Math.max(8, tile * 0.22) }}>{n}</Text>}
                          </View>
                        ))}
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>

        {/* Pencil + Erase + Hint */}
        <View style={styles.actions}>
          <Pressable testID="sd-pencil" onPress={() => setPencil(!pencil)} style={[styles.actionBtn, { backgroundColor: pencil ? c.brand : c.surfaceSecondary, borderWidth: 1, borderColor: pencil ? c.brand : c.border }]}>
            <Ionicons name="pencil" size={18} color={pencil ? "#FFF" : c.onSurface} />
            <Text style={{ color: pencil ? "#FFF" : c.onSurface, fontWeight: "900", fontSize: 14 * scale }}>Pencil {pencil ? "ON" : "off"}</Text>
          </Pressable>
          <Pressable testID="sd-erase" onPress={eraseSel} style={[styles.actionBtn, { backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border }]}>
            <Ionicons name="backspace" size={18} color={c.onSurface} />
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 14 * scale }}>Erase</Text>
          </Pressable>
          <Pressable testID="sd-hint" onPress={onHint} disabled={hintsUsed >= (puzzle.hint_quota ?? 3)} style={[styles.actionBtn, { backgroundColor: hintsUsed >= (puzzle.hint_quota ?? 3) ? c.surfaceTertiary : "#F59E0B" }]}>
            <Ionicons name="bulb" size={18} color={hintsUsed >= (puzzle.hint_quota ?? 3) ? c.muted : "#FFF"} />
            <Text style={{ color: hintsUsed >= (puzzle.hint_quota ?? 3) ? c.muted : "#FFF", fontWeight: "900", fontSize: 14 * scale }}>Hint ({(puzzle.hint_quota ?? 3) - hintsUsed})</Text>
          </Pressable>
        </View>

        {/* Number pad */}
        <View style={[styles.pad, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          {[1,2,3,4,5,6,7,8,9].map((n) => (
            <Pressable key={n} testID={`sd-num-${n}`} onPress={() => onNumber(n)} style={[styles.numBtn, { backgroundColor: c.brand }]}>
              <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 22 * scale }}>{n}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      {/* How to Play */}
      <Modal visible={showHow} animationType="fade" transparent onRequestClose={() => setShowHow(false)}>
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, { backgroundColor: c.surface }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 19 * scale }}>How to play</Text>
              <SpeakButton text={HOW_TO} color={c.brand} size={22} />
            </View>
            <Text style={{ color: c.onSurface, fontSize: 16 * scale, marginTop: 10, lineHeight: 24 }}>{HOW_TO}</Text>
            <Pressable testID="sd-how-close" onPress={() => setShowHow(false)} style={[styles.closeBtn, { backgroundColor: c.brand }]}>
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
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 22 * scale, marginTop: 8 }}>Solved!</Text>
            <Text style={{ color: c.muted, fontSize: 15 * scale, marginTop: 8, textAlign: "center" }}>
              {puzzle.difficulty_label} · {m}:{s.toString().padStart(2, "0")} · {mistakes} mistakes{"\n"}+{puzzle.points} Butterfly Points
            </Text>
            {(puzzle.difficulty === "hard" || puzzle.difficulty === "nightmare") && (
              <Text style={{ color: c.brand, fontWeight: "800", fontSize: 14 * scale, marginTop: 8, textAlign: "center" }}>🦋 Friends will see a celebration Flutter</Text>
            )}
            <Pressable testID="sd-win-back" onPress={() => { setShowWin(false); router.replace("/games/sudoku"); }} style={[styles.closeBtn, { backgroundColor: c.brand, marginTop: 16 }]}>
              <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 16 * scale }}>Pick another puzzle</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Lose modal */}
      <Modal visible={showLose} animationType="fade" transparent onRequestClose={() => setShowLose(false)}>
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, { backgroundColor: c.surface, alignItems: "center" }]}>
            <Text style={{ fontSize: 54 }}>😅</Text>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 22 * scale, marginTop: 8 }}>That&apos;s 3 mistakes</Text>
            <Text style={{ color: c.muted, fontSize: 15 * scale, marginTop: 8, textAlign: "center" }}>No worries — give it another go.{"\n"}Your progress so far has been saved.</Text>
            <Pressable testID="sd-lose-back" onPress={() => { setShowLose(false); router.replace("/games/sudoku"); }} style={[styles.closeBtn, { backgroundColor: c.brand, marginTop: 16 }]}>
              <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 16 * scale }}>Try another</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, borderWidth: 1 },
  iconBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  boardWrap: { borderWidth: 2, borderRadius: 4 },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap", justifyContent: "center" },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999 },
  pad: { flexDirection: "row", flexWrap: "wrap", gap: 6, padding: 10, borderRadius: 14, borderWidth: 1, justifyContent: "center" },
  numBtn: { width: 56, height: 56, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", padding: 20 },
  modalCard: { width: "100%", maxWidth: 460, borderRadius: 20, padding: 20 },
  closeBtn: { paddingVertical: 14, borderRadius: 999, alignItems: "center", width: "100%" },
});
