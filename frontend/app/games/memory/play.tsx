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

const HOW_TO = "Memory Match. Tap a card to flip it, then tap another card. If the two cards match, they stay face up. Try to find every pair in as few moves as you can. Cards are previewed for a moment at the start to help you remember.";

export default function MemoryPlayer() {
  const router = useRouter();
  const { theme, difficulty, daily } = useLocalSearchParams<{ theme: string; difficulty: string; daily?: string }>();
  const { c, scale, prefs } = useTheme();
  const { user } = useAuth();
  const { show } = useToast();
  const { width: winW } = useWindowDimensions();
  const isDaily = daily === "1";

  const [puzzle, setPuzzle] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [flipped, setFlipped] = useState<number[]>([]);   // currently selected (max 2)
  const [matchedIdx, setMatchedIdx] = useState<Set<number>>(new Set());
  const [matchedPairs, setMatchedPairs] = useState<string[]>([]);
  const [moves, setMoves] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [showHow, setShowHow] = useState(false);
  const [showWin, setShowWin] = useState(false);
  const [previewing, setPreviewing] = useState(true);
  const startedAt = useRef<number>(Date.now());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const puz: any = isDaily ? await api.mmDaily() : await api.mmPuzzle(theme as string, difficulty as string);
        if (cancelled) return;
        setPuzzle(puz);
        // Resume
        if (user) {
          try {
            const saved: any = await api.mmGetProgress(user.id, puz.puzzle_id);
            if (saved && Array.isArray(saved.matched_pairs)) {
              setMatchedPairs(saved.matched_pairs);
              setMoves(saved.moves || 0);
              setSeconds(saved.seconds || 0);
              const set = new Set<number>();
              puz.cards.forEach((card: string, i: number) => { if (saved.matched_pairs.includes(card)) set.add(i); });
              setMatchedIdx(set);
              if (saved.completed) setCompleted(true);
              startedAt.current = Date.now() - (saved.seconds || 0) * 1000;
              if (saved.matched_pairs.length > 0) setPreviewing(false);
            }
          } catch {}
        }
        // Preview countdown
        const preview = (puz.preview_seconds ?? 3) * 1000;
        setTimeout(() => { if (!cancelled) setPreviewing(false); }, preview);
      } catch {
        show("Could not load puzzle");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [theme, difficulty, isDaily, user?.id]);

  // Timer
  useEffect(() => {
    if (completed || previewing) return;
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [completed, previewing]);

  // Auto-save
  const saveTimer = useRef<any>(null);
  const persist = useCallback((next: string[], nextMoves: number, didFinish: boolean) => {
    if (!user || !puzzle) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const r: any = await api.mmSaveProgress(user.id, {
          puzzle_id: puzzle.puzzle_id, theme: puzzle.theme, difficulty: puzzle.difficulty,
          matched_pairs: next, moves: nextMoves, seconds, completed: didFinish, is_daily: isDaily,
        });
        if (didFinish && r?.granted) {
          if (r.granted.includes("hard") || r.granted.includes("nightmare")) {
            show("🦋 Friends will see a celebration Flutter!");
          }
        }
      } catch {}
    }, 400);
  }, [user, puzzle, seconds, isDaily]);

  // Auto-flip-back logic on second flip
  useEffect(() => {
    if (flipped.length !== 2 || !puzzle) return;
    const [a, b] = flipped;
    const cardA = puzzle.cards[a];
    const cardB = puzzle.cards[b];
    setMoves((m) => m + 1);
    if (cardA === cardB) {
      const nextSet = new Set(matchedIdx); nextSet.add(a); nextSet.add(b);
      setMatchedIdx(nextSet);
      const nextPairs = [...matchedPairs, cardA];
      setMatchedPairs(nextPairs);
      setFlipped([]);
      const didFinish = nextPairs.length === puzzle.pairs;
      if (didFinish) { setCompleted(true); setShowWin(true); }
      persist(nextPairs, moves + 1, didFinish);
      show(`✅ Matched ${cardA}`);
    } else {
      // Mismatch — wait 0.8s then flip back
      const t = setTimeout(() => setFlipped([]), 800);
      return () => clearTimeout(t);
    }
  }, [flipped]);

  if (loading || !puzzle) {
    return (
      <View style={{ flex: 1, backgroundColor: c.surface }}>
        <Header title="Memory Match" />
        <View style={{ padding: 30 }}><ActivityIndicator color={c.brand} /></View>
      </View>
    );
  }

  const cols = puzzle.cols;
  const rows = puzzle.rows;
  const horizontalPad = 14 * 2;
  const gap = 6;
  const boardW = Math.min(winW - horizontalPad, 520);
  const tileW = Math.floor((boardW - gap * (cols - 1)) / cols);

  const onTap = (i: number) => {
    if (completed || previewing) return;
    if (matchedIdx.has(i)) return;
    if (flipped.includes(i)) return;
    if (flipped.length >= 2) return;
    setFlipped([...flipped, i]);
  };

  const totalPairs = puzzle.pairs;
  const foundPairs = matchedPairs.length;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title={`${puzzle.theme_emoji} ${puzzle.theme_label}`} />
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 60, gap: 12 }}>
        <View style={[styles.topBar, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.muted, fontWeight: "800", letterSpacing: 0.4, fontSize: 11 * scale }}>{puzzle.difficulty_label.toUpperCase()}{isDaily ? " · DAILY" : ""}</Text>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 17 * scale, marginTop: 2 }}>{foundPairs}/{totalPairs} pairs · {moves} moves · {m}:{s.toString().padStart(2, "0")}</Text>
            <View style={[styles.progress, { backgroundColor: c.surfaceTertiary }]}>
              <View style={[styles.progressFill, { backgroundColor: completed ? c.success : c.brand, width: `${Math.round((foundPairs / totalPairs) * 100)}%` }]} />
            </View>
          </View>
          <Pressable testID="mm-how-toggle" onPress={() => setShowHow(true)} hitSlop={6} style={[styles.iconBtn, { backgroundColor: c.brandTertiary }]}>
            <Ionicons name="help-circle" size={22} color={c.brand} />
          </Pressable>
          {prefs.readMessagesAloud && (<SpeakButton text={HOW_TO} color={c.brand} size={22} bg={c.brandTertiary} testID="mm-speak" />)}
        </View>

        {previewing && (
          <Text style={{ textAlign: "center", color: c.brand, fontSize: 15 * scale, fontWeight: "800" }}>
            Take a look! Cards will flip face-down in a moment…
          </Text>
        )}

        <View style={[styles.board, { width: boardW, alignSelf: "center", gap }]}> 
          {Array.from({ length: rows }).map((_, r) => (
            <View key={r} style={{ flexDirection: "row", gap }}>
              {Array.from({ length: cols }).map((_2, ci) => {
                const i = r * cols + ci;
                const card = puzzle.cards[i];
                const isMatched = matchedIdx.has(i);
                const isFlipped = flipped.includes(i) || previewing || isMatched;
                const faceBg = isMatched ? "#16A34A" : c.brand;
                return (
                  <Pressable key={ci} testID={`mm-card-${i}`} onPress={() => onTap(i)} style={[styles.card, { width: tileW, height: tileW, backgroundColor: isFlipped ? faceBg : c.surfaceSecondary, borderColor: isFlipped ? faceBg : c.border }]}>
                    {isFlipped ? (
                      <Text style={{ fontSize: Math.max(20, tileW * 0.55) * scale }}>{card}</Text>
                    ) : (
                      <Ionicons name="help" size={Math.max(18, tileW * 0.42)} color={c.muted} />
                    )}
                  </Pressable>
                );
              })}
            </View>
          ))}
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
            <Pressable testID="mm-how-close" onPress={() => setShowHow(false)} style={[styles.closeBtn, { backgroundColor: c.brand }]}>
              <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 16 * scale }}>Got it</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={showWin} animationType="fade" transparent onRequestClose={() => setShowWin(false)}>
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, { backgroundColor: c.surface, alignItems: "center" }]}>
            <Text style={{ fontSize: 54 }}>🎉</Text>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 22 * scale, marginTop: 8 }}>You found every pair!</Text>
            <Text style={{ color: c.muted, fontSize: 15 * scale, marginTop: 8, textAlign: "center" }}>{puzzle.theme_label} · {puzzle.difficulty_label} · {moves} moves · {m}:{s.toString().padStart(2, "0")}{"\n"}+{puzzle.points} Butterfly Points</Text>
            {(puzzle.difficulty === "hard" || puzzle.difficulty === "nightmare") && (
              <Text style={{ color: c.brand, fontWeight: "800", fontSize: 14 * scale, marginTop: 8, textAlign: "center" }}>🦋 Friends will see a celebration Flutter</Text>
            )}
            <Pressable testID="mm-win-back" onPress={() => { setShowWin(false); router.replace("/games/memory"); }} style={[styles.closeBtn, { backgroundColor: c.brand, marginTop: 16 }]}>
              <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 16 * scale }}>Pick another theme</Text>
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
  board: { },
  card: { alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderRadius: 12 },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", padding: 20 },
  modalCard: { width: "100%", maxWidth: 460, borderRadius: 20, padding: 20 },
  closeBtn: { paddingVertical: 14, borderRadius: 999, alignItems: "center", marginTop: 18, width: "100%" },
});
