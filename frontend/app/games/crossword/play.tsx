/**
 * Crossword "Coming soon — play screen" placeholder.
 *
 * The full play UI (grid input, virtual keyboard, Reveal letter, Check
 * answers) is meaty enough to merit its own iteration. This stub lets
 * us ship the hub + backend + rotation right now so the user can:
 *   1. preview the rotation logic
 *   2. review puzzle themes and difficulty distribution
 *   3. proof-read clue copy before the play UI is wired
 *
 * Replace this file in the next iteration with the real play surface.
 */
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useTheme } from "@/src/lib/theme";
import Header from "@/src/components/Header";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

export default function CrosswordPlay() {
  const { c, scale } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [puzzle, setPuzzle] = useState<any>(null);

  useEffect(() => {
    if (!id) return;
    fetch(`${BASE}/api/games/crossword/${id}`).then(r => r.json()).then(setPuzzle).catch(() => {});
  }, [id]);

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title={puzzle?.theme || "Crossword"} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
        <View style={[styles.banner, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
          <Text style={{ color: c.brand, fontWeight: "900", letterSpacing: 0.6, fontSize: 12 * scale }}>
            ✏️  PLAY SCREEN — COMING SOON
          </Text>
          <Text style={{ color: c.onSurface, fontSize: 15 * scale, marginTop: 6, lineHeight: 22 }}>
            The play surface is on the way. In the meantime, here&apos;s a preview of the puzzle that will load when it&apos;s ready.
          </Text>
        </View>

        {puzzle && (
          <>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 20 * scale }}>{puzzle.theme}</Text>
            <Text style={{ color: c.muted, fontSize: 14 * scale }}>{puzzle.size}×{puzzle.size} grid</Text>

            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 * scale, marginTop: 12 }}>Across</Text>
            {(puzzle.clues?.across || []).map((cl: any) => (
              <Text key={`a-${cl.num}`} style={{ color: c.onSurface, fontSize: 14 * scale, lineHeight: 22 }}>
                <Text style={{ fontWeight: "900" }}>{cl.num}.</Text> {cl.clue} ({cl.len})
              </Text>
            ))}

            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 * scale, marginTop: 12 }}>Down</Text>
            {(puzzle.clues?.down || []).map((cl: any) => (
              <Text key={`d-${cl.num}`} style={{ color: c.onSurface, fontSize: 14 * scale, lineHeight: 22 }}>
                <Text style={{ fontWeight: "900" }}>{cl.num}.</Text> {cl.clue} ({cl.len})
              </Text>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { padding: 14, borderRadius: 16, borderWidth: 1 },
});
