import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useTheme } from "@/src/lib/theme";
import Header from "@/src/components/Header";
import Button from "@/src/components/Button";

const WORDS = ["FRIEND", "COFFEE", "GARDEN", "BOOK", "WALK", "TEA"];
const SIZE = 10;

function build(): { grid: string[][]; placements: Record<string, [number, number][]> } {
  const grid: string[][] = Array.from({ length: SIZE }, () => Array(SIZE).fill(""));
  const placements: Record<string, [number, number][]> = {};
  for (const w of WORDS) {
    let placed = false;
    for (let attempt = 0; attempt < 80 && !placed; attempt++) {
      const horiz = Math.random() < 0.5;
      const r = Math.floor(Math.random() * SIZE);
      const co = Math.floor(Math.random() * SIZE);
      if (horiz && co + w.length > SIZE) continue;
      if (!horiz && r + w.length > SIZE) continue;
      let ok = true;
      for (let k = 0; k < w.length; k++) {
        const rr = horiz ? r : r + k; const cc = horiz ? co + k : co;
        if (grid[rr][cc] && grid[rr][cc] !== w[k]) { ok = false; break; }
      }
      if (!ok) continue;
      const cells: [number, number][] = [];
      for (let k = 0; k < w.length; k++) {
        const rr = horiz ? r : r + k; const cc = horiz ? co + k : co;
        grid[rr][cc] = w[k]; cells.push([rr, cc]);
      }
      placements[w] = cells; placed = true;
    }
  }
  for (let r = 0; r < SIZE; r++) for (let co = 0; co < SIZE; co++) if (!grid[r][co]) grid[r][co] = String.fromCharCode(65 + Math.floor(Math.random() * 26));
  return { grid, placements };
}

export default function WordSearch() {
  const { c, scale } = useTheme();
  const [{ grid, placements }, setBoard] = useState(build);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [found, setFound] = useState<string[]>([]);

  const cellKey = (r: number, co: number) => `${r},${co}`;

  const tap = (r: number, co: number) => {
    const key = cellKey(r, co);
    const next = new Set(selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    setSelected(next);
    for (const [w, cells] of Object.entries(placements)) {
      if (found.includes(w)) continue;
      if (cells.every(([rr, cc]) => next.has(cellKey(rr, cc)))) {
        setFound([...found, w]);
      }
    }
  };

  const reset = () => { const b = build(); setBoard(b); setSelected(new Set()); setFound([]); };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Word Search" />
      <ScrollView contentContainerStyle={{ padding: 12, gap: 12 }}>
        <View style={[styles.grid, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          {grid.map((row, r) => (
            <View key={r} style={{ flexDirection: "row" }}>
              {row.map((l, co) => {
                const isSel = selected.has(cellKey(r, co));
                const isFound = Object.entries(placements).some(([w, cells]) => found.includes(w) && cells.some(([rr, cc]) => rr === r && cc === co));
                return (
                  <Pressable key={co} testID={`ws-${r}-${co}`} onPress={() => tap(r, co)} style={[styles.cell, { backgroundColor: isFound ? c.success : isSel ? c.brand : c.surfaceTertiary, borderColor: c.border }]}>
                    <Text style={{ color: isSel || isFound ? "#FFF" : c.onSurface, fontWeight: "700", fontSize: 14 * scale }}>{l}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
        <View style={[styles.list, { backgroundColor: c.brandTertiary }]}>
          <Text style={{ color: c.brand, fontWeight: "800", fontSize: 16 * scale, marginBottom: 6 }}>Find these words:</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {WORDS.map((w) => (
              <Text key={w} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: "#FFF", color: found.includes(w) ? c.success : c.brand, fontWeight: "800", textDecorationLine: found.includes(w) ? "line-through" : "none", fontSize: 14 * scale }}>{w}</Text>
            ))}
          </View>
        </View>
        {found.length === WORDS.length && <Text testID="ws-win" style={{ color: c.brand, fontSize: 24 * scale, fontWeight: "900", textAlign: "center" }}>🎉 You found them all!</Text>}
        <Button testID="ws-reset" label="New puzzle" variant="outline" onPress={reset} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { borderRadius: 14, padding: 6, borderWidth: 1, alignSelf: "center" },
  cell: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderWidth: 1, margin: 1, borderRadius: 6 },
  list: { padding: 12, borderRadius: 14 },
});
