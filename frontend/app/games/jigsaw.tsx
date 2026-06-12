import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Dimensions } from "react-native";
import { useTheme } from "@/src/lib/theme";
import Header from "@/src/components/Header";
import Button from "@/src/components/Button";

const SIZE = 3; // 3x3 sliding puzzle

function shuffled(): number[] {
  const arr = [1,2,3,4,5,6,7,8,0];
  // do random valid moves to keep it solvable
  let blank = 8;
  for (let i = 0; i < 60; i++) {
    const neighbours: number[] = [];
    const r = Math.floor(blank / SIZE), co = blank % SIZE;
    if (r > 0) neighbours.push(blank - SIZE);
    if (r < SIZE - 1) neighbours.push(blank + SIZE);
    if (co > 0) neighbours.push(blank - 1);
    if (co < SIZE - 1) neighbours.push(blank + 1);
    const swap = neighbours[Math.floor(Math.random() * neighbours.length)];
    [arr[blank], arr[swap]] = [arr[swap], arr[blank]];
    blank = swap;
  }
  return arr;
}

export default function Jigsaw() {
  const { c, scale } = useTheme();
  const [tiles, setTiles] = useState<number[]>(shuffled);
  const tileSize = Math.min(96, (Dimensions.get("window").width - 40) / SIZE - 8);

  const solved = useMemo(() => tiles.every((v, i) => v === (i + 1) % 9), [tiles]);

  const tap = (i: number) => {
    const blank = tiles.indexOf(0);
    const r1 = Math.floor(i / SIZE), c1 = i % SIZE;
    const r2 = Math.floor(blank / SIZE), c2 = blank % SIZE;
    if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) return;
    const next = tiles.slice();
    [next[i], next[blank]] = [next[blank], next[i]];
    setTiles(next);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Jigsaw" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, alignItems: "center" }}>
        <Text style={{ color: c.muted, fontSize: 16 * scale, fontWeight: "600", textAlign: "center" }}>Slide tiles to put them in order 1→8</Text>
        {solved && <Text testID="jigsaw-win" style={{ color: c.brand, fontSize: 28 * scale, fontWeight: "900" }}>🎉 Solved!</Text>}
        <View style={[styles.board, { backgroundColor: c.surfaceTertiary, borderColor: c.border, width: tileSize * SIZE + 16 }]}>
          {tiles.map((v, i) => (
            <Pressable key={i} testID={`jigsaw-${i}`} onPress={() => tap(i)} style={[styles.tile, { width: tileSize, height: tileSize, backgroundColor: v === 0 ? "transparent" : c.brand }]}>
              {v !== 0 && <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 34 * scale }}>{v}</Text>}
            </Pressable>
          ))}
        </View>
        <Button testID="jigsaw-reset" label="Shuffle" variant="outline" onPress={() => setTiles(shuffled())} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  board: { flexDirection: "row", flexWrap: "wrap", padding: 8, borderRadius: 18, borderWidth: 1, gap: 4, justifyContent: "center" },
  tile: { borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
