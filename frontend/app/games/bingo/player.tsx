import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Speech from "expo-speech";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import SpeakButton from "@/src/components/SpeakButton";
import Button from "@/src/components/Button";
import GameZoomControls, { useGameZoom } from "@/src/components/GameZoomControls";

type Session = {
  id: string; difficulty: string; cards: number[][][]; marked: boolean[][][];
  sequence: number[]; call_index: number; completed: boolean; is_daily?: boolean;
  event_id?: string; meta: any; pool_max: number;
};

function letterFor(n: number): string {
  if (n <= 15) return "B";
  if (n <= 30) return "I";
  if (n <= 45) return "N";
  if (n <= 60) return "G";
  return "O";
}

export default function BingoPlayer() {
  const router = useRouter();
  const { c, scale, prefs } = useTheme();
  const { user } = useAuth();
  const { show } = useToast();
  const params = useLocalSearchParams<{ sid?: string }>();
  const sid = String(params.sid || "");
  const [s, setS] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [completion, setCompletion] = useState<any>(null);
  const saveTimer = useRef<any>(null);
  // Hoisted to top so it's not called conditionally after the early returns.
  const { zoom, zoomIn, zoomOut, resetZoom } = useGameZoom(1);

  const load = useCallback(async () => {
    if (!user || !sid) return;
    try { const data: any = await api.bingoGetSession(user.id, sid); setS(data); } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  }, [user?.id, sid]);
  useEffect(() => { load(); }, [load]);

  // Auto-call timer for Hard / Nightmare
  useEffect(() => {
    if (!s || s.completed || !s.meta?.auto_call_ms) return;
    const t = setInterval(() => callNext(), s.meta.auto_call_ms);
    return () => clearInterval(t);
  }, [s?.id, s?.call_index, s?.completed, s?.meta?.auto_call_ms]);

  // Auto-save (debounced) when marked/call_index change
  const queueSave = (patch: any) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { api.bingoUpdate(user!.id, sid, patch).catch(() => {}); }, 350);
  };

  const lastCall = s && s.call_index > 0 ? s.sequence[s.call_index - 1] : null;
  const calledSet = useMemo(() => new Set((s?.sequence || []).slice(0, s?.call_index || 0)), [s?.sequence, s?.call_index]);

  const callNext = () => {
    setS((cur) => {
      if (!cur || cur.completed) return cur;
      if (cur.call_index >= cur.sequence.length) return cur;
      const newIndex = cur.call_index + 1;
      const callNum = cur.sequence[cur.call_index];
      if (prefs.readMessagesAloud) {
        try { Speech.stop(); Speech.speak(`${letterFor(callNum)} ${callNum}`, { rate: 0.85, pitch: 1.0 }); } catch {}
      }
      queueSave({ call_index: newIndex });
      return { ...cur, call_index: newIndex };
    });
  };

  const toggleMark = (cardIdx: number, col: number, row: number) => {
    if (!s || s.completed) return;
    const val = s.cards[cardIdx][col][row];
    if (val === 0) return;
    if (!calledSet.has(val)) { show("Not called yet"); return; }
    setS((cur) => {
      if (!cur) return cur;
      const next = cur.marked.map((cm) => cm.map((r) => r.slice()));
      next[cardIdx][row][col] = !next[cardIdx][row][col];
      queueSave({ marked: next });
      return { ...cur, marked: next };
    });
  };

  const callBingo = async () => {
    if (!s) return;
    try {
      const r: any = await api.bingoComplete(user!.id, sid);
      setCompletion(r); setS((cur) => cur ? { ...cur, completed: true } : cur);
      try { Speech.stop(); if (prefs.readMessagesAloud) Speech.speak("Bingo! Well done!", { rate: 0.95, pitch: 1.1 }); } catch {}
    } catch (e: any) {
      show("No winning pattern yet \u2014 keep going!");
    }
  };

  if (loading || !s) return <View style={{ flex: 1, backgroundColor: c.surface }}><Header title="Bingo" /><View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator size="large" color={c.brand} /></View></View>;

  if (completion || s.completed) {
    return (
      <View style={{ flex: 1, backgroundColor: c.surface }}>
        <Header title="Bingo" />
        <ScrollView contentContainerStyle={{ padding: 18, alignItems: "center", gap: 12 }}>
          <Text style={{ fontSize: 80 }}>\uD83C\uDF89</Text>
          <Text style={{ color: c.brand, fontWeight: "900", fontSize: 42 * scale }}>BINGO!</Text>
          {!!completion && <>
            <Text style={{ color: c.onSurface, fontSize: 18 * scale }}>You earned +{completion.points_earned} Butterfly Points</Text>
            <Text style={{ color: c.muted, fontSize: 14 * scale }}>{completion.calls_used} calls \u00B7 {completion.duration_seconds}s</Text>
            {(completion.granted || []).length > 0 && (
              <View style={{ gap: 4, marginTop: 6 }}>
                {completion.granted.map((g: string) => (
                  <Text key={g} style={{ color: c.brand, fontWeight: "800", fontSize: 14 * scale }}>{"\u2728"} New achievement: {g}</Text>
                ))}
              </View>
            )}
          </>}
          <View style={{ width: "100%", gap: 10, marginTop: 20 }}>
            <Button label="Play again" onPress={() => router.replace("/games/bingo")} />
            <Button label="Back to Games Hub" variant="outline" onPress={() => router.replace("/games")} />
          </View>
        </ScrollView>
      </View>
    );
  }

  const cols = s.meta.cols;
  const rows = s.meta.rows;
  const letters = cols === 5 ? ["B", "I", "N", "G", "O"] : ["B", "I", "N", "G"];
  // Auto-fit base cell size + user-controlled zoom (hook hoisted to top).
  const baseCellSize = cols === 5 ? 56 : 64;
  const cellSize = Math.round(baseCellSize * zoom);

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Bingo" />
      <ScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 100 }}>
        {/* Last call banner */}
        <View style={[styles.callBox, { backgroundColor: "#1E3A7F", borderColor: c.brand }]}>
          <Text style={{ color: "#FFFFFFCC", fontWeight: "800", fontSize: 12 * scale, letterSpacing: 0.6 }}>LAST CALL</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            {lastCall ? (
              <>
                <Text style={{ color: "#FCC656", fontWeight: "900", fontSize: 56 * scale }}>{letterFor(lastCall)}{lastCall}</Text>
                <SpeakButton text={`${letterFor(lastCall)} ${lastCall}`} color="#FCC656" bg="transparent" size={28} />
              </>
            ) : (
              <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 24 * scale }}>Tap Call to start</Text>
            )}
          </View>
          <Text style={{ color: "#FFFFFFCC", fontSize: 12 * scale, marginTop: 4 }}>{s.call_index} / {s.sequence.length} calls {s.meta.auto_call_ms ? "\u00B7 auto" : ""}</Text>
        </View>

        {/* Card size controls — bingo cards print numbers at the same
            size regardless of difficulty, so the +/- pills let players
            choose chunkier or compact daubing to taste. */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
          <Text style={{ color: c.muted, fontWeight: "800", fontSize: 12 * scale, marginRight: 4 }}>Card size</Text>
          <GameZoomControls
            zoom={zoom}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onReset={resetZoom}
            c={c}
            scale={scale}
            testID="bingo-zoom"
          />
        </View>

        {/* Cards — wrapped in a horizontal ScrollView so zooming past
            the screen width leaves cards pannable. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 4, justifyContent: "center", flexGrow: 1 }}
        >
        <View style={{ gap: 12, alignSelf: "center" }}>
        {/* Cards */}
        {s.cards.map((card, ci) => (
          <View key={ci} style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
            {s.cards.length > 1 && <Text style={{ color: c.muted, fontWeight: "800", fontSize: 12 * scale, textAlign: "center", marginBottom: 4 }}>CARD {ci + 1}</Text>}
            <View style={{ flexDirection: "row", justifyContent: "center", marginBottom: 6 }}>
              {letters.map((l) => <Text key={l} style={{ width: cellSize, textAlign: "center", color: c.brand, fontWeight: "900", fontSize: 22 * scale }}>{l}</Text>)}
            </View>
            {Array.from({ length: rows }).map((_, r) => (
              <View key={r} style={{ flexDirection: "row", justifyContent: "center" }}>
                {Array.from({ length: cols }).map((__, co) => {
                  const val = card[co][r];
                  const isCalled = val === 0 || calledSet.has(val);
                  const isMarked = s.marked[ci][r][co];
                  return (
                    <Pressable key={co} testID={`bingo-cell-${ci}-${co}-${r}`} onPress={() => toggleMark(ci, co, r)}
                      style={[styles.cell, { width: cellSize, height: cellSize, backgroundColor: isMarked ? c.brand : isCalled ? c.brandTertiary : c.surfaceTertiary, borderColor: isMarked ? c.brand : c.border }]}>
                      <Text style={{ color: isMarked ? "#FFF" : c.onSurface, fontWeight: "800", fontSize: 20 * scale }}>{val === 0 ? "\u2605" : val}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        ))}
        </View>
        </ScrollView>

        {/* Controls */}
        {!s.meta.auto_call_ms && (
          <Pressable testID="bingo-call-next" onPress={callNext} style={[styles.bigBtn, { backgroundColor: c.brand }]}>
            <Ionicons name="megaphone" size={22} color="#FFF" />
            <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 18 * scale }}>Call next number</Text>
          </Pressable>
        )}
        <Pressable testID="bingo-call-bingo" onPress={callBingo} style={[styles.bigBtn, { backgroundColor: "#16A34A" }]}>
          <Text style={{ fontSize: 22 }}>{"\uD83E\uDD8B"}</Text>
          <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 18 * scale }}>Call BINGO!</Text>
        </Pressable>

        {/* Recently called */}
        <View style={[styles.recent, { backgroundColor: c.brandTertiary }]}>
          <Text style={{ color: c.brand, fontWeight: "800", fontSize: 13 * scale, letterSpacing: 0.4, marginBottom: 6 }}>RECENT CALLS</Text>
          <Text style={{ color: c.onSurface, fontSize: 15 * scale }}>{(s.sequence || []).slice(0, s.call_index).reverse().slice(0, 12).map((n) => `${letterFor(n)}${n}`).join("  \u00B7  ") || "\u2014"}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  callBox: { padding: 16, borderRadius: 20, borderWidth: 2, alignItems: "center" },
  card: { padding: 10, borderRadius: 16, borderWidth: 1 },
  cell: { borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center", margin: 2 },
  bigBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 16, borderRadius: 999 },
  recent: { padding: 12, borderRadius: 14 },
});
