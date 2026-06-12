import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useTheme } from "@/src/lib/theme";
import { useToast } from "@/src/lib/toast";
import Header from "@/src/components/Header";
import Button from "@/src/components/Button";

function buildCard(): number[][] {
  const cols: number[][] = [];
  const ranges = [[1, 15], [16, 30], [31, 45], [46, 60], [61, 75]];
  for (const [lo, hi] of ranges) {
    const pool: number[] = [];
    for (let i = lo; i <= hi; i++) pool.push(i);
    const picks: number[] = [];
    for (let i = 0; i < 5; i++) picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    cols.push(picks);
  }
  // center free
  cols[2][2] = 0;
  return cols;
}

export default function Bingo() {
  const { c, scale } = useTheme();
  const { show } = useToast();
  const [card, setCard] = useState(buildCard());
  const [marked, setMarked] = useState<Record<string, boolean>>({ "2,2": true });
  const [called, setCalled] = useState<number[]>([]);

  const callNext = () => {
    const remaining: number[] = [];
    for (let i = 1; i <= 75; i++) if (!called.includes(i)) remaining.push(i);
    if (!remaining.length) { show("All numbers called!"); return; }
    const next = remaining[Math.floor(Math.random() * remaining.length)];
    setCalled([next, ...called]);
  };

  const toggle = (col: number, row: number) => {
    const n = card[col][row];
    if (n === 0) return;
    if (!called.includes(n)) { show("Not called yet!"); return; }
    setMarked({ ...marked, [`${col},${row}`]: !marked[`${col},${row}`] });
  };

  const isBingo = useMemo(() => {
    const m = (col: number, row: number) => marked[`${col},${row}`];
    for (let r = 0; r < 5; r++) if ([0,1,2,3,4].every((co) => m(co, r))) return true;
    for (let co = 0; co < 5; co++) if ([0,1,2,3,4].every((r) => m(co, r))) return true;
    if ([0,1,2,3,4].every((i) => m(i, i))) return true;
    if ([0,1,2,3,4].every((i) => m(i, 4 - i))) return true;
    return false;
  }, [marked]);

  const reset = () => { setCard(buildCard()); setMarked({ "2,2": true }); setCalled([]); };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Bingo" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        {isBingo && <Text testID="bingo-win" style={{ color: c.brand, fontSize: 28 * scale, fontWeight: "900", textAlign: "center" }}>🦋 BINGO! 🦋</Text>}
        <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-around", marginBottom: 8 }}>
            {["B", "I", "N", "G", "O"].map((l) => (
              <Text key={l} style={{ fontSize: 24 * scale, fontWeight: "900", color: c.brand, width: 50, textAlign: "center" }}>{l}</Text>
            ))}
          </View>
          {[0,1,2,3,4].map((r) => (
            <View key={r} style={{ flexDirection: "row", justifyContent: "space-around" }}>
              {[0,1,2,3,4].map((co) => {
                const v = card[co][r];
                const isMarked = marked[`${co},${r}`];
                return (
                  <Pressable key={co} testID={`bingo-${co}-${r}`} onPress={() => toggle(co, r)} style={[styles.cell, { backgroundColor: isMarked ? c.brand : c.surfaceTertiary, borderColor: c.border }]}>
                    <Text style={{ color: isMarked ? "#FFF" : c.onSurface, fontWeight: "800", fontSize: 18 * scale }}>{v === 0 ? "★" : v}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
        <View style={[styles.calledBox, { backgroundColor: c.brandTertiary }]}>
          <Text style={{ color: c.brand, fontWeight: "800", fontSize: 16 * scale, marginBottom: 6 }}>Called {called.length}</Text>
          <Text style={{ color: c.onBrandTertiary, fontSize: 14 * scale }}>{called.slice(0, 20).join(" · ") || "—"}</Text>
        </View>
        <Button testID="bingo-call" label={called.length ? `Call next (${called[0]} just called)` : "Call first number"} onPress={callNext} />
        <Button testID="bingo-reset" label="New card" variant="outline" onPress={reset} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, padding: 12, borderWidth: 1 },
  cell: { width: 54, height: 54, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, margin: 2 },
  calledBox: { padding: 12, borderRadius: 14 },
});
