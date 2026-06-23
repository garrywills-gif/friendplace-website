/**
 * Crossword — interactive play screen.
 *
 * UX overview (designed for everyone, soft visuals, big touch targets):
 *   • Soft slate blocked cells (not harsh black), strong teal/yellow
 *     highlight for the active word so it's always obvious where you
 *     are typing.
 *   • Tap a cell → highlights the active word. Tap again → flips
 *     across↔down direction.
 *   • Big on-screen keyboard with auto-advance.
 *   • Action row: Check · Hint (one letter) · Clear answer (current word).
 *   • Clue banner has ◀ Previous / Next ▶ buttons for keyboard-free
 *     navigation between clues, plus the speak-aloud button.
 *   • Wrong letters tint red until typed over.
 *   • Progress auto-saves: every keystroke (debounced), on unmount,
 *     and when the app goes to the background.
 *   • Win flow: confetti + Butterfly Points toast + Coffee Lounge CTA on
 *     the daily.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator,
  useWindowDimensions, Modal, AppState,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import SpeakButton from "@/src/components/SpeakButton";

// ────────────────────────────────────────────────────────────────────
type Clue = { num: number; row: number; col: number; len: number; clue: string; dir?: "A" | "D" };
type Puzzle = {
  id: string;
  level: string;
  theme: string;
  size: number;
  grid: (string | null)[][];
  clues: { across: Clue[]; down: Clue[] };
};
type Cell = string;   // single letter or "" for empty (or null for blocked)
type Direction = "A" | "D";

// On-screen keyboard — QWERTY layout (universal muscle memory). Three
// rows with the classic offset; backspace lives at the right end of the
// bottom row so it's where typists already reach for it on their phones.
const KB_ROW_1 = "QWERTYUIOP".split("");
const KB_ROW_2 = "ASDFGHJKL".split("");
const KB_ROW_3 = "ZXCVBNM".split("");

// Cell-cell adjacency along a direction.
function stepCell(r: number, c: number, dir: Direction, delta: number): [number, number] {
  return dir === "A" ? [r, c + delta] : [r + delta, c];
}

export default function CrosswordPlay() {
  const router = useRouter();
  const { id, daily } = useLocalSearchParams<{ id?: string; daily?: string }>();
  const isDaily = daily === "1";
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const { show } = useToast();
  const { width: winW, height: winH } = useWindowDimensions();

  // ── data
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [discussionTableId, setDiscussionTableId] = useState<string | null>(null);
  const [dailyDate, setDailyDate] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // ── player state
  const [letters, setLetters] = useState<Cell[][]>([]);     // 2-D letters ('' = empty)
  const [revealed, setRevealed] = useState<boolean[][]>([]);// revealed cells (locked)
  const [statusGrid, setStatusGrid] = useState<("wrong" | "correct" | null)[][]>([]);
  const [sel, setSel] = useState<[number, number] | null>(null);
  const [dir, setDir] = useState<Direction>("A");
  const [seconds, setSeconds] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [showWin, setShowWin] = useState(false);
  const [winPoints, setWinPoints] = useState(0);
  const [showHowTo, setShowHowTo] = useState(false);
  // ── Hint allowance — one hint per CLUE per puzzle. Stops players
  // from solving the whole grid by mashing Hint. Stored as a Set of
  // clue keys ("A-3", "D-5") and persisted to AsyncStorage so the
  // allowance survives back-out/re-enter (and across days for the
  // daily puzzle — since the daily puzzle id changes each day the
  // namespace is naturally per-day).
  const [hintedClues, setHintedClues] = useState<Set<string>>(new Set());
  const hintStorageKey = puzzle ? `xword.hints.${puzzle.id}` : "";
  // Timer visibility — newspaper-style toggle. Some users love racing
  // against the clock, others find it stressful. Default ON for the
  // "real crossword" feel; one tap on the pill hides it (and the icon
  // remains so they can re-enable). Persisted to AsyncStorage so the
  // preference sticks across sessions.
  const [showTimer, setShowTimer] = useState(true);
  const startedAt = useRef<number>(Date.now());

  // ── load puzzle (daily or by id) + saved progress
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        let p: Puzzle | null = null;
        if (isDaily) {
          const d: any = await api.xwDaily();
          p = d.puzzle as Puzzle;
          setDiscussionTableId(d.discussion_table_id || null);
          setDailyDate(d.date || "");
        } else if (id) {
          p = (await api.xwPuzzle(id)) as Puzzle;
        }
        if (!p || cancelled) return;
        setPuzzle(p);
        // Initialise blank letter + revealed grids
        const blank: Cell[][] = p.grid.map(row => row.map(cell => (cell === null ? "" : "")));
        const blankR: boolean[][] = p.grid.map(row => row.map(() => false));
        const blankS: (null)[][] = p.grid.map(row => row.map(() => null));
        let lt = blank, rv = blankR;
        // Resume from server if available — but only if the saved
        // grid shape matches the current puzzle. If a puzzle was
        // resized between sessions (as happened in the iter38 grid
        // expansion), we discard the stale snapshot rather than feed
        // a 5×5 array into a 9×9 puzzle (which would break Check).
        if (user) {
          try {
            const saved: any = await api.xwGetProgress(user.id, p.id);
            const shapeOk =
              saved &&
              Array.isArray(saved.guesses) &&
              saved.guesses.length === p.size &&
              saved.guesses.every((r: any[]) => Array.isArray(r) && r.length === p.size);
            if (shapeOk) {
              lt = saved.guesses.map((r: any[], ri: number) =>
                r.map((v, ci) => (p!.grid[ri][ci] === null ? "" : (v || "")))
              );
              const revShape =
                Array.isArray(saved.revealed) &&
                saved.revealed.length === p.size &&
                saved.revealed.every((r: any[]) => Array.isArray(r) && r.length === p.size);
              rv = revShape ? saved.revealed : blankR;
              if (typeof saved.seconds === "number") setSeconds(saved.seconds);
              startedAt.current = Date.now() - (saved.seconds || 0) * 1000;
              if (saved.completed) setCompleted(true);
            }
          } catch {}
        }
        setLetters(lt);
        setRevealed(rv);
        setStatusGrid(blankS as any);
        // Restore the hint-allowance set for this puzzle (one hint per
        // clue). Stored as a JSON string array of clue keys.
        try {
          const raw = await AsyncStorage.getItem(`xword.hints.${p.id}`);
          if (raw) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) setHintedClues(new Set(arr));
          }
        } catch {}
        // Initial selection: first across clue's first cell
        const first = p.clues.across[0] || p.clues.down[0];
        if (first) setSel([first.row, first.col]);
      } catch {
        show("Could not load puzzle. Pull back to try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, isDaily, user?.id]);

  // ── timer
  useEffect(() => {
    if (completed) return;
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [completed]);

  // ── derived: active clue based on selection + direction
  const activeClue = useMemo<Clue | null>(() => {
    if (!puzzle || !sel) return null;
    const [r, c] = sel;
    const list = dir === "A" ? puzzle.clues.across : puzzle.clues.down;
    return list.find(cl => {
      const [er, ec] = stepCell(cl.row, cl.col, dir, cl.len - 1);
      if (dir === "A") return r === cl.row && c >= cl.col && c <= ec;
      return c === cl.col && r >= cl.row && r <= er;
    }) || null;
  }, [puzzle, sel, dir]);

  // ── helpers
  const isBlocked = useCallback((r: number, c: number) => !puzzle || puzzle.grid[r][c] === null, [puzzle]);

  const startCellNum = useMemo<Record<string, number>>(() => {
    if (!puzzle) return {};
    const m: Record<string, number> = {};
    for (const cl of puzzle.clues.across) m[`${cl.row},${cl.col}`] = cl.num;
    for (const cl of puzzle.clues.down) m[`${cl.row},${cl.col}`] = cl.num;
    return m;
  }, [puzzle]);

  // ── interactions
  const onCellPress = useCallback((r: number, c: number) => {
    if (!puzzle || isBlocked(r, c)) return;
    if (sel && sel[0] === r && sel[1] === c) {
      // tap-toggle direction
      setDir(prev => (prev === "A" ? "D" : "A"));
      return;
    }
    setSel([r, c]);
  }, [puzzle, isBlocked, sel]);

  const moveCursor = useCallback((delta: 1 | -1) => {
    if (!puzzle || !sel) return;
    let [r, c] = sel;
    while (true) {
      [r, c] = stepCell(r, c, dir, delta);
      if (r < 0 || c < 0 || r >= puzzle.size || c >= puzzle.size) break;
      if (!isBlocked(r, c)) { setSel([r, c]); return; }
    }
  }, [puzzle, sel, dir, isBlocked]);

  const onKeyPress = useCallback((letter: string) => {
    if (!puzzle || !sel) return;
    const [r, c] = sel;
    if (isBlocked(r, c)) return;
    // Don't overwrite a "Reveal letter" cell
    if (revealed[r]?.[c]) { moveCursor(1); return; }
    setLetters(prev => {
      const next = prev.map(row => row.slice());
      next[r][c] = letter;
      return next;
    });
    setStatusGrid(prev => {
      const next = prev.map(row => row.slice());
      // typing clears any wrong-flag on that cell
      next[r][c] = null;
      return next;
    });
    moveCursor(1);
  }, [puzzle, sel, isBlocked, revealed, moveCursor]);

  const onBackspace = useCallback(() => {
    if (!puzzle || !sel) return;
    const [r, c] = sel;
    if (revealed[r]?.[c]) { moveCursor(-1); return; }
    setLetters(prev => {
      const next = prev.map(row => row.slice());
      if (next[r][c]) {
        next[r][c] = "";
      } else {
        // step back and clear that one
        const [pr, pc] = stepCell(r, c, dir, -1);
        if (pr >= 0 && pc >= 0 && pr < puzzle.size && pc < puzzle.size && !isBlocked(pr, pc) && !revealed[pr]?.[pc]) {
          next[pr][pc] = "";
          setSel([pr, pc]);
        }
      }
      return next;
    });
  }, [puzzle, sel, dir, revealed, isBlocked, moveCursor]);

  const onNextClue = useCallback(() => {
    if (!puzzle || !activeClue) return;
    const list = dir === "A" ? puzzle.clues.across : puzzle.clues.down;
    const i = list.findIndex(cl => cl.num === activeClue.num);
    if (i < 0) return;
    let nx = list[(i + 1) % list.length];
    // if no clues in this dir, switch dir
    if (!nx) {
      const other = dir === "A" ? "D" : "A";
      const otherList = other === "A" ? puzzle.clues.across : puzzle.clues.down;
      if (otherList.length) {
        nx = otherList[0];
        setDir(other);
      } else return;
    }
    setSel([nx.row, nx.col]);
  }, [puzzle, activeClue, dir]);

  const onPrevClue = useCallback(() => {
    if (!puzzle || !activeClue) return;
    const list = dir === "A" ? puzzle.clues.across : puzzle.clues.down;
    const i = list.findIndex(cl => cl.num === activeClue.num);
    if (i < 0) return;
    const prev = list[(i - 1 + list.length) % list.length];
    if (prev) setSel([prev.row, prev.col]);
  }, [puzzle, activeClue, dir]);

  // ── server-side check
  const doCheck = useCallback(async () => {
    if (!puzzle) return;
    try {
      const guesses = letters.map(row => row.map(v => (v ? v : "")));
      const res: any = await api.xwCheck(puzzle.id, guesses as any, user?.id);
      const next = (res.status as string[][]).map(row => row.map(s => (s === "wrong" ? "wrong" : (s === "correct" ? "correct" : null))));
      setStatusGrid(next as any);
      if (res.solved) {
        setCompleted(true);
        setShowWin(true);
        setWinPoints(res.points || 0);
        if (res.points_awarded) show(`+${res.points} Butterfly Points 🎉`);
        else show("Solved! Nice work.");
      } else {
        const wrong = next.flat().filter(s => s === "wrong").length;
        if (wrong > 0) show(`${wrong} letter${wrong === 1 ? "" : "s"} incorrect — try again.`);
        else show("Looking good — keep going!");
      }
    } catch {
      show("Could not check answers right now.");
    }
  }, [puzzle, letters, user?.id, show]);

  // ── reveal a single letter
  // ── activeClueKey — stable key for the currently selected clue,
  // used to track which clues have already received their one hint.
  const activeClueKey = activeClue ? `${dir}-${activeClue.num}` : null;
  const hintAlreadyUsed = !!(activeClueKey && hintedClues.has(activeClueKey));

  const doRevealLetter = useCallback(async () => {
    if (!puzzle || !activeClue || !activeClueKey) return;
    // Enforce "one hint per clue" — once used, the player must work it
    // out (or move to another clue and ask the table for help). This is
    // the difference between a brain-teaser and a free fill-in.
    if (hintedClues.has(activeClueKey)) {
      show("You've already used your hint for this clue. Try another!");
      return;
    }
    // Collect every cell in this clue and partition them. Best UX is to
    // hint a cell that's currently EMPTY — that's where the player is
    // stuck. If they've filled the whole word (correctly or not) we
    // fall back to any unrevealed cell so the hint still does
    // something useful.
    const cells: [number, number][] = [];
    for (let i = 0; i < activeClue.len; i++) {
      const [r, col] = dir === "A"
        ? [activeClue.row, activeClue.col + i]
        : [activeClue.row + i, activeClue.col];
      cells.push([r, col]);
    }
    const emptyUnrevealed = cells.filter(([r, col]) => !revealed[r]?.[col] && !letters[r]?.[col]);
    const anyUnrevealed   = cells.filter(([r, col]) => !revealed[r]?.[col]);
    const pool = emptyUnrevealed.length > 0 ? emptyUnrevealed : anyUnrevealed;
    if (pool.length === 0) {
      // Nothing left to reveal — the clue is already fully locked.
      show("This clue is already solved!");
      return;
    }
    const [r, col] = pool[Math.floor(Math.random() * pool.length)];
    try {
      const res: any = await api.xwReveal(puzzle.id, r, col);
      if (!res?.letter) {
        show("Could not reveal letter.");
        return;
      }
      setLetters(prev => {
        const next = prev.map(row => row.slice());
        next[r][col] = res.letter;
        return next;
      });
      setRevealed(prev => {
        const next = prev.map(row => row.slice());
        next[r][col] = true;
        return next;
      });
      setStatusGrid(prev => {
        const next = prev.map(row => row.slice());
        next[r][col] = "correct";
        return next;
      });
      // Move the cursor onto the hinted cell so the player visually
      // anchors to the new letter.
      setSel([r, col]);
      // Mark this clue as hinted (in-memory + persisted).
      setHintedClues(prev => {
        const next = new Set(prev);
        next.add(activeClueKey);
        // Persist asynchronously — fire-and-forget is fine, worst case
        // is the user gets one extra hint after a hard crash.
        AsyncStorage.setItem(hintStorageKey, JSON.stringify(Array.from(next))).catch(() => {});
        return next;
      });
    } catch {
      show("Could not reveal letter.");
    }
  }, [puzzle, activeClue, activeClueKey, dir, hintedClues, hintStorageKey, letters, revealed, show]);

  // ── Clear answer: wipes letters in the active word ONLY (not the whole
  // grid). Revealed/hinted cells stay locked. This matches what most
  // crossword apps do when you tap a "Clear" affordance from a clue.
  const doClear = useCallback(() => {
    if (!puzzle || !activeClue) return;
    setLetters(prev => {
      const next = prev.map(row => row.slice());
      for (let i = 0; i < activeClue.len; i++) {
        const [r, col] = dir === "A"
          ? [activeClue.row, activeClue.col + i]
          : [activeClue.row + i, activeClue.col];
        if (!revealed[r]?.[col]) next[r][col] = "";
      }
      return next;
    });
    setStatusGrid(prev => {
      const next = prev.map(row => row.slice());
      for (let i = 0; i < activeClue.len; i++) {
        const [r, col] = dir === "A"
          ? [activeClue.row, activeClue.col + i]
          : [activeClue.row + i, activeClue.col];
        // Keep "correct" status for revealed cells; clear others.
        if (next[r][col] !== "correct") next[r][col] = null;
      }
      return next;
    });
    // Move cursor back to the first cell of the cleared word.
    setSel([activeClue.row, activeClue.col]);
  }, [puzzle, activeClue, dir, revealed]);

  // ── Persist progress immediately. Used by debounced effect AND by
  // the "save on the way out" hooks (unmount, focus loss, app background).
  const saveNow = useCallback(() => {
    if (!puzzle || !user || !letters.length) return Promise.resolve();
    const guesses = letters.map(row => row.map(v => (v ? v : null)));
    return api.xwSaveProgress(user.id, {
      puzzle_id: puzzle.id,
      guesses: guesses as any,
      revealed,
      seconds,
      completed,
    }).catch(() => {});
  }, [puzzle, user, letters, revealed, seconds, completed]);

  // ── debounced save (opportunistic on letter change)
  useEffect(() => {
    if (!puzzle || !user || !letters.length) return;
    const handle = setTimeout(() => { saveNow(); }, 1500);
    return () => clearTimeout(handle);
  }, [letters, revealed, seconds, completed, puzzle?.id, user?.id, saveNow]);

  // ── Save on the way out: when the user navigates away, swipes back,
  // closes the app, or backgrounds it. Critical for the "I'll come back
  // tomorrow" promise — no lost letters.
  useFocusEffect(useCallback(() => {
    return () => { saveNow(); };
  }, [saveNow]));
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background" || s === "inactive") saveNow();
    });
    return () => sub.remove();
  }, [saveNow]);

  // ── grid dims — responsive. Switches to a "newspaper" two-pane layout
  // on tablets / wide screens (>= 768px): grid on the left, full
  // scrollable clue list on the right, just like the reference. On
  // phones we keep the stacked vertical flow.
  const isWide = winW >= 768;
  const CLUE_PANEL_W = isWide ? Math.min(Math.max(260, winW * 0.36), 380) : 0;
  // Available width for the grid area. On tablet, leave space for the
  // clue panel + a small gutter; on phone the grid gets full width.
  const GRID_AREA_W = isWide ? Math.max(280, winW - CLUE_PANEL_W - 36) : Math.min(winW - 12, 720);
  const cellSize = puzzle ? Math.max(28, Math.min(56, Math.floor(GRID_AREA_W / puzzle.size))) : 40;

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: c.surface }}>
        <Header title="Crossword" />
        <View style={{ flex: 1, justifyContent: "center" }}>
          <ActivityIndicator color={c.brand} />
        </View>
      </View>
    );
  }
  if (!puzzle) {
    return (
      <View style={{ flex: 1, backgroundColor: c.surface }}>
        <Header title="Crossword" />
        <View style={{ padding: 20 }}>
          <Text style={{ color: c.onSurface, fontSize: 16 * scale }}>Puzzle not found.</Text>
        </View>
      </View>
    );
  }

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const ttsClue = activeClue ? `${activeClue.num} ${dir === "A" ? "across" : "down"}: ${activeClue.clue}` : "";

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title={isDaily ? "Daily Crossword" : puzzle.theme} />

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {/* Top meta strip — toggleable timer (tap to hide so users who
            find the clock stressful can play without it). */}
        <View style={styles.metaStrip}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.muted, fontSize: 12 * scale, letterSpacing: 0.6, fontWeight: "900" }}>
              {isDaily ? `DAILY · ${dailyDate}` : puzzle.level.toUpperCase()}
            </Text>
            <Text style={{ color: c.onSurface, fontSize: 18 * scale, fontWeight: "900" }} numberOfLines={1}>
              {puzzle.theme}
            </Text>
          </View>
          <Pressable
            onPress={() => setShowTimer(s => !s)}
            accessibilityRole="button"
            accessibilityLabel={showTimer ? "Hide timer" : "Show timer"}
            hitSlop={8}
            style={({ pressed }) => [styles.timerPill, {
              backgroundColor: showTimer ? c.brandTertiary : c.surfaceSecondary,
              borderColor: showTimer ? c.brand : c.border,
              opacity: pressed ? 0.8 : 1,
            }]}
          >
            <Ionicons
              name={showTimer ? "time-outline" : "eye-off-outline"}
              size={14}
              color={showTimer ? c.brand : c.muted}
            />
            <Text style={{
              color: showTimer ? c.brand : c.muted,
              fontWeight: "900",
              fontSize: 13 * scale,
            }}>
              {showTimer ? formatTime(seconds) : "Timer"}
            </Text>
          </Pressable>
          <Pressable onPress={() => setShowHowTo(true)} accessibilityRole="button" hitSlop={10} style={{ marginLeft: 8 }}>
            <Ionicons name="help-circle-outline" size={26} color={c.brand} />
          </Pressable>
        </View>

        {/* Daily — discuss in Coffee Lounge */}
        {isDaily && discussionTableId && (
          <Pressable
            onPress={() => router.push(`/table/${discussionTableId}` as any)}
            style={({ pressed }) => [styles.discussCard, {
              backgroundColor: c.brand,
              opacity: pressed ? 0.92 : 1,
            }]}
          >
            <Ionicons name="cafe" size={20} color="#FFF" />
            <View style={{ flex: 1 }}>
              <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 15 * scale }}>
                {"Discuss today\u2019s puzzle \u2615"}
              </Text>
              <Text style={{ color: "rgba(255,255,255,0.92)", fontSize: 12 * scale, marginTop: 2 }}>
                {"Coffee Lounge table is open \u2014 everyone\u2019s solving the same puzzle."}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#FFF" />
          </Pressable>
        )}

        {/* Grid + clue panels — newspaper-style layout. On phone the
            clue list stacks directly under the grid (and active-clue
            banner) so users see lots of clues without scrolling far.
            On tablet/landscape we flip to a side-by-side row: grid on
            the left, scrollable clue panel on the right — matching the
            classic newspaper feel of the reference design. */}
        <View
          style={[
            isWide
              ? { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 12, gap: 14, marginTop: 8 }
              : { marginTop: 8 },
          ]}
        >
          {/* LEFT column (or full width on phone): the grid + active clue
              banner. Action row sits at the very bottom of the page so the
              clue list gets prime real estate above the keyboard. */}
          <View style={isWide ? { width: GRID_AREA_W + 24 } : undefined}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 6, alignItems: "center", justifyContent: "center", flexGrow: 1 }}
            >
              <View style={{
                width: cellSize * puzzle.size,
                borderWidth: 2.5, borderColor: c.brand, borderRadius: 6,
                backgroundColor: "#E7EAF0",
                padding: 2,
              }}>
                {puzzle.grid.map((row, r) => (
                  <View key={r} style={{ flexDirection: "row" }}>
                    {row.map((cell, col) => {
                      const blocked = cell === null;
                      const selected = sel && sel[0] === r && sel[1] === col;
                      const inActive = !blocked && activeClue && (
                        (dir === "A" && r === activeClue.row && col >= activeClue.col && col < activeClue.col + activeClue.len) ||
                        (dir === "D" && col === activeClue.col && r >= activeClue.row && r < activeClue.row + activeClue.len)
                      );
                      const num = startCellNum[`${r},${col}`];
                      const userLetter = letters[r]?.[col] || "";
                      const cellStatus = statusGrid[r]?.[col] || null;
                      const isRevealed = revealed[r]?.[col];
                      const bg = blocked
                        ? "#94A3B8"
                        : (selected ? "#FCD34D" : (inActive ? "#DBEAFE" : "#FFFDF7"));
                      const fg = cellStatus === "wrong"
                        ? "#C62828"
                        : (isRevealed ? c.brand : "#0F172A");
                      return (
                        <Pressable
                          key={`${r}-${col}`}
                          onPress={() => onCellPress(r, col)}
                          disabled={blocked}
                          style={{
                            width: cellSize, height: cellSize,
                            borderWidth: 1, borderColor: blocked ? "#94A3B8" : "#94A3B8",
                            backgroundColor: bg,
                            alignItems: "center", justifyContent: "center",
                          }}
                        >
                          {!blocked && num !== undefined && (
                            <Text style={{ position: "absolute", top: 1, left: 2, fontSize: Math.max(9, cellSize * 0.24), color: "#475569", fontWeight: "700" }}>
                              {num}
                            </Text>
                          )}
                          {!blocked && (
                            <Text style={{ fontSize: cellSize * 0.5, color: fg, fontWeight: "800" }}>
                              {userLetter}
                            </Text>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>

            {/* Active clue banner — sits directly under the grid so the
                current clue is always visible alongside the puzzle. The
                Prev/Next buttons let users skip clues without scrolling
                the clue list (still nice for thumb navigation). */}
            <View style={[styles.clueBanner, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
                <Text style={{ color: c.brand, fontWeight: "900", fontSize: 14 * scale, letterSpacing: 0.6, flex: 1 }}>
                  {activeClue ? `${activeClue.num} ${dir === "A" ? "ACROSS" : "DOWN"} · ${activeClue.len} letters` : (dir === "A" ? "ACROSS" : "DOWN")}
                </Text>
                {!!ttsClue && <SpeakButton text={ttsClue} size={28} />}
              </View>
              <Text style={{ color: c.onSurface, fontSize: 21 * scale, fontWeight: "700", lineHeight: 28 * scale }}>
                {activeClue?.clue || "Tap a cell to begin."}
              </Text>
              <View style={styles.navRow}>
                <Pressable
                  onPress={onPrevClue}
                  style={({ pressed }) => [styles.navBtn, {
                    backgroundColor: pressed ? c.brand : "#FFFFFF",
                    borderColor: c.brand,
                  }]}
                  accessibilityLabel="Previous clue"
                >
                  <Ionicons name="chevron-back" size={20} color={c.brand} />
                  <Text style={{ color: c.brand, fontWeight: "900", fontSize: 15 * scale }}>Previous</Text>
                </Pressable>
                <Pressable
                  onPress={onNextClue}
                  style={({ pressed }) => [styles.navBtn, {
                    backgroundColor: pressed ? c.brand : "#FFFFFF",
                    borderColor: c.brand,
                  }]}
                  accessibilityLabel="Next clue"
                >
                  <Text style={{ color: c.brand, fontWeight: "900", fontSize: 15 * scale }}>Next</Text>
                  <Ionicons name="chevron-forward" size={20} color={c.brand} />
                </Pressable>
              </View>
            </View>
          </View>

          {/* RIGHT column on tablet OR continuation below grid on phone:
              the full Across/Down clue lists. Active clue auto-scrolls
              into view so users never lose their place after typing a
              long word that flips them to a new section. */}
          <CluePanel
            puzzle={puzzle}
            activeClue={activeClue}
            dir={dir}
            onPick={(cl, d) => { setDir(d); setSel([cl.row, cl.col]); }}
            c={c}
            scale={scale}
            isWide={isWide}
            panelWidth={CLUE_PANEL_W}
            panelMaxHeight={Math.max(360, winH - 360)}
          />
        </View>

        {/* Action row — Hint (one letter free), Check (validate),
            Clear answer (wipe current word only). Sits below both
            columns on tablet for thumb-reachable consistency. */}
        <View style={styles.actionRow}>
          <ActionBtn label="Check" icon="checkmark-circle-outline" onPress={doCheck} c={c} scale={scale} />
          {/* Hint — one per clue. Once used, the button visually dims
              and the label changes so players can see at a glance that
              they need to crack the rest themselves (or ask the table
              for help). Tapping again surfaces a friendly toast. */}
          <ActionBtn
            label={hintAlreadyUsed ? "Hint used" : "Hint"}
            icon={hintAlreadyUsed ? "bulb" : "bulb-outline"}
            onPress={doRevealLetter}
            c={c}
            scale={scale}
            dimmed={hintAlreadyUsed}
          />
          <ActionBtn label="Clear answer" icon="refresh-outline" onPress={doClear} c={c} scale={scale} />
        </View>
      </ScrollView>

      {/* Bottom keyboard — QWERTY (3 rows). The middle row is offset
          by half a key on each side and the bottom row has a wider
          backspace on the right, matching the universal phone-keyboard
          layout people already know by feel. */}
      <View style={[styles.kb, { backgroundColor: c.surfaceSecondary, borderTopColor: c.border }]}>
        <KbRow letters={KB_ROW_1} onPress={onKeyPress} c={c} scale={scale} />
        <View style={{ marginTop: 4, paddingHorizontal: 14 }}>
          <KbRow letters={KB_ROW_2} onPress={onKeyPress} c={c} scale={scale} />
        </View>
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 4, marginTop: 4 }}>
          {KB_ROW_3.map(l => (
            <KeyButton key={l} label={l} onPress={() => onKeyPress(l)} c={c} scale={scale} />
          ))}
          <KeyButton label="⌫" wide onPress={onBackspace} c={c} scale={scale} />
        </View>
      </View>

      {/* Win modal */}
      <Modal transparent visible={showWin} animationType="fade" onRequestClose={() => setShowWin(false)}>
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, { backgroundColor: c.surface, borderColor: c.brand }]}>
            <Text style={{ fontSize: 52, textAlign: "center" }}>🎉</Text>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 22 * scale, textAlign: "center" }}>
              You solved it!
            </Text>
            <Text style={{ color: c.muted, textAlign: "center", marginTop: 6, fontSize: 14 * scale }}>
              {puzzle.theme} · {formatTime(seconds)}
            </Text>
            {winPoints > 0 && (
              <View style={[styles.pointsPill, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
                <Text style={{ color: c.brand, fontWeight: "900", fontSize: 16 * scale }}>+{winPoints} points</Text>
              </View>
            )}
            {isDaily && discussionTableId && (
              <Pressable
                style={[styles.modalBtn, { backgroundColor: c.brand }]}
                onPress={() => { setShowWin(false); router.push(`/table/${discussionTableId}` as any); }}
              >
                <Ionicons name="cafe" size={18} color="#FFF" />
                <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 15 * scale }}>Brag in the Coffee Lounge ☕</Text>
              </Pressable>
            )}
            <Pressable
              style={[styles.modalBtn, { backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border }]}
              onPress={() => setShowWin(false)}
            >
              <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 15 * scale }}>Stay on puzzle</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* How-to modal */}
      <Modal transparent visible={showHowTo} animationType="fade" onRequestClose={() => setShowHowTo(false)}>
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 18 * scale, marginBottom: 6 }}>
              How to play
            </Text>
            <Text style={{ color: c.onSurface, fontSize: 14 * scale, lineHeight: 22 }}>
              {`• Tap a cell to start — the highlighted word shows in the clue bar.\n• Tap the same cell again to flip between Across and Down.\n• Type with the on-screen keyboard. The cursor moves automatically.\n• Stuck on a letter? Tap "Hint" to fill in just that one cell.\n• Tap "Check" any time — red letters mean try again.\n• Tap "Clear answer" to wipe the current word and start it over.\n• Your progress saves automatically — come back anytime.`}
            </Text>
            <Pressable
              style={[styles.modalBtn, { backgroundColor: c.brand }]}
              onPress={() => setShowHowTo(false)}
            >
              <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 15 * scale }}>Got it</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Small components ────────────────────────────────────────────────
function ActionBtn({ label, icon, onPress, c, scale, dimmed = false }: any) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityState={{ disabled: !!dimmed }}
      style={({ pressed }) => [styles.actionBtn, {
        backgroundColor: dimmed ? c.surfaceTertiary : c.surfaceSecondary,
        borderColor: dimmed ? c.border : c.border,
        opacity: pressed ? 0.85 : (dimmed ? 0.65 : 1),
      }]}
    >
      <Ionicons name={icon} size={20} color={dimmed ? c.muted : c.brand} />
      <Text style={{ color: dimmed ? c.muted : c.onSurface, fontWeight: "800", fontSize: 13 * scale }}>{label}</Text>
    </Pressable>
  );
}

function CluePanel({
  puzzle,
  activeClue,
  dir,
  onPick,
  c,
  scale,
  isWide,
  panelWidth,
  panelMaxHeight,
}: {
  puzzle: Puzzle;
  activeClue: Clue | null;
  dir: Direction;
  onPick: (cl: Clue, d: Direction) => void;
  c: any;
  scale: number;
  isWide: boolean;
  panelWidth: number;
  panelMaxHeight: number;
}) {
  // Auto-scroll the active clue into view so users never lose their
  // place — especially helpful on phones where the list lives below
  // the grid and on tablets where Down clues might sit further down
  // the side panel. We capture the y-offset of each row via onLayout
  // (the row knows its own height + position) and scroll the panel
  // there with a tiny vertical buffer so the active row is centered
  // rather than hugging the top edge.
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<Map<string, number>>(new Map());

  // Compose a stable key for the active row that survives Across/Down
  // collisions (same number can exist in both lists).
  const activeKey = activeClue ? `${dir}-${activeClue.num}` : null;

  useEffect(() => {
    if (!activeKey) return;
    const y = offsets.current.get(activeKey);
    if (typeof y !== "number") return;
    // Subtract a small offset so the active clue isn't flush against
    // the top — feels more readable with breathing room above.
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 28), animated: true });
  }, [activeKey]);

  const Section = ({ title, clues, d }: { title: string; clues: Clue[]; d: Direction }) => (
    <View style={{ marginBottom: 14 }}>
      <Text
        style={{
          color: c.muted,
          fontWeight: "900",
          fontSize: 12 * scale,
          letterSpacing: 0.8,
          marginBottom: 6,
          paddingLeft: 4,
        }}
      >
        {title.toUpperCase()}
      </Text>
      {clues.map((cl) => {
        const key = `${d}-${cl.num}`;
        const isActive = activeKey === key;
        return (
          <Pressable
            key={key}
            onPress={() => onPick(cl, d)}
            onLayout={(e) => { offsets.current.set(key, e.nativeEvent.layout.y); }}
            style={({ pressed }) => [
              styles.clueRow,
              {
                backgroundColor: isActive ? c.brandTertiary : "transparent",
                borderColor: isActive ? c.brand : c.border,
                borderLeftWidth: isActive ? 4 : 1,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={`${d === "A" ? "Across" : "Down"} ${cl.num}: ${cl.clue}`}
          >
            <Text style={{ color: c.brand, fontWeight: "900", width: 28, fontSize: 14 * scale }}>
              {cl.num}.
            </Text>
            <Text
              style={{
                color: c.onSurface,
                flex: 1,
                fontSize: 14 * scale,
                lineHeight: 20,
                fontWeight: isActive ? "800" : "500",
              }}
            >
              {cl.clue}
            </Text>
            <Text style={{ color: c.muted, fontSize: 12 * scale, marginLeft: 6 }}>({cl.len})</Text>
          </Pressable>
        );
      })}
    </View>
  );

  // On tablet — fixed-width column with its OWN scroll so the grid
  // stays anchored while users browse the clues. On phone — inline
  // with the outer page scroll (no nested ScrollView so flick gestures
  // don't fight each other).
  if (isWide) {
    return (
      <View
        style={{
          width: panelWidth,
          maxHeight: panelMaxHeight,
          borderWidth: 1,
          borderColor: c.border,
          borderRadius: 14,
          backgroundColor: c.surface,
          padding: 12,
        }}
        testID="crossword-clue-panel-wide"
      >
        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 8 }}
        >
          <Section title={`Across (${puzzle.clues.across.length})`} clues={puzzle.clues.across} d="A" />
          {!!puzzle.clues.down.length && (
            <Section title={`Down (${puzzle.clues.down.length})`} clues={puzzle.clues.down} d="D" />
          )}
        </ScrollView>
      </View>
    );
  }
  return (
    <View
      style={{ paddingHorizontal: 16, marginTop: 14 }}
      testID="crossword-clue-panel-stacked"
    >
      <Section title={`Across (${puzzle.clues.across.length})`} clues={puzzle.clues.across} d="A" />
      {!!puzzle.clues.down.length && (
        <Section title={`Down (${puzzle.clues.down.length})`} clues={puzzle.clues.down} d="D" />
      )}
    </View>
  );
}

function KbRow({ letters, onPress, c, scale }: any) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "center", gap: 4 }}>
      {letters.map((l: string) => (
        <KeyButton key={l} label={l} onPress={() => onPress(l)} c={c} scale={scale} />
      ))}
    </View>
  );
}

function KeyButton({ label, onPress, c, scale, wide = false }: any) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.key, {
        backgroundColor: pressed ? c.brandTertiary : "#FFFFFF",
        borderColor: c.border,
        minWidth: wide ? 56 : 26,
        flexGrow: wide ? 0 : 1,
      }]}
    >
      <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 * scale }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  metaStrip: { flexDirection: "row", alignItems: "center", padding: 12, gap: 10 },
  timerPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 4 },
  discussCard: { marginHorizontal: 12, padding: 12, borderRadius: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  clueBanner: { marginHorizontal: 12, marginTop: 14, padding: 16, borderRadius: 16, borderWidth: 1.5 },
  navRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  navBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, minHeight: 48, gap: 4,
  },
  actionRow: { flexDirection: "row", paddingHorizontal: 12, marginTop: 12, gap: 8 },
  actionBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, alignItems: "center", gap: 4 },
  kb: { borderTopWidth: 1, paddingVertical: 8, paddingHorizontal: 4 },
  key: { paddingVertical: 12, paddingHorizontal: 6, borderRadius: 8, borderWidth: 1, alignItems: "center", minHeight: 44 },
  clueRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, marginBottom: 6 },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 24 },
  modalCard: { padding: 24, borderRadius: 18, borderWidth: 2, gap: 12 },
  pointsPill: { alignSelf: "center", paddingHorizontal: 16, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  modalBtn: { paddingVertical: 14, borderRadius: 12, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 },
});
