/**
 * GameZoomControls — small +/- pill row used across every game with a
 * board (Crossword, Sudoku, Word Search, Bingo, Memory). Renders three
 * tappable pills:
 *
 *   [ − ] [ 100% ] [ + ]
 *
 *   • −     → shrink one step (default 15%, min 70%)
 *   • 100%  → tap to reset back to auto-fit
 *   • +     → enlarge one step (max 250%)
 *
 * Auto-fit means the board fills the phone screen on first open with
 * no horizontal scroll. Players can then bump cells up for chunkier
 * letters / numbers — invaluable for older eyes & fingers.
 *
 * Using big plain buttons (instead of pinch gestures) so the controls
 * are friendly for the 60+ demographic — no two-finger trickery
 * required, large tap targets that survive shaky hands.
 */
import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export const ZOOM_MIN = 0.7;
export const ZOOM_MAX = 2.5;
export const ZOOM_STEP = 0.15;

export function useGameZoom(initial = 1) {
  const [zoom, setZoom] = React.useState(initial);
  const zoomIn = React.useCallback(
    () => setZoom(z => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2))),
    []
  );
  const zoomOut = React.useCallback(
    () => setZoom(z => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2))),
    []
  );
  const resetZoom = React.useCallback(() => setZoom(1), []);
  return { zoom, setZoom, zoomIn, zoomOut, resetZoom };
}

export default function GameZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
  c,
  scale = 1,
  testID,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset?: () => void;
  c: any;        // theme colors object
  scale?: number;
  testID?: string;
}) {
  const canZoomOut = zoom > ZOOM_MIN + 0.005;
  const canZoomIn  = zoom < ZOOM_MAX - 0.005;
  const pct = Math.round(zoom * 100);
  return (
    <View style={styles.group} testID={testID || "game-zoom"}>
      <Pressable
        onPress={() => canZoomOut && onZoomOut()}
        accessibilityRole="button"
        accessibilityLabel="Zoom out"
        hitSlop={6}
        disabled={!canZoomOut}
        style={({ pressed }) => [styles.btn, {
          backgroundColor: c.surfaceSecondary,
          borderColor: c.border,
          opacity: !canZoomOut ? 0.4 : (pressed ? 0.7 : 1),
        }]}
      >
        <Ionicons name="remove" size={16} color={c.brand} />
      </Pressable>
      <Pressable
        onPress={() => onReset?.()}
        accessibilityRole="button"
        accessibilityLabel={`Reset zoom (currently ${pct} percent)`}
        hitSlop={6}
        style={({ pressed }) => [styles.label, {
          backgroundColor: c.surfaceSecondary,
          borderColor: c.border,
          opacity: pressed ? 0.7 : 1,
        }]}
      >
        <Text style={{ color: c.brand, fontWeight: "900", fontSize: 11 * scale }}>{pct}%</Text>
      </Pressable>
      <Pressable
        onPress={() => canZoomIn && onZoomIn()}
        accessibilityRole="button"
        accessibilityLabel="Zoom in"
        hitSlop={6}
        disabled={!canZoomIn}
        style={({ pressed }) => [styles.btn, {
          backgroundColor: c.surfaceSecondary,
          borderColor: c.border,
          opacity: !canZoomIn ? 0.4 : (pressed ? 0.7 : 1),
        }]}
      >
        <Ionicons name="add" size={16} color={c.brand} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: "row", gap: 4, alignItems: "center" },
  btn: {
    width: 32, height: 32, borderRadius: 8, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  label: {
    paddingHorizontal: 8, height: 32, minWidth: 44, borderRadius: 8, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
});
