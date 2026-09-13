import React, { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTheme } from "@/src/lib/theme";

/** Local Discovery radius selector (item 1).
 *  Choices: 5 | 10 | 25 | 50 km | All. `null` means "All" (no distance limit). */
export const RADIUS_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: "5 km", value: 5 },
  { label: "10 km", value: 10 },
  { label: "25 km", value: 25 },
  { label: "50 km", value: 50 },
  { label: "All", value: null },
];

export const DEFAULT_RADIUS_KM = 25;

/** Persists the member's most recent radius choice per area (notices,
 *  groups, events) so each screen remembers what they last picked. */
export function useRadius(areaKey: string) {
  const [radius, setRadiusState] = useState<number | null>(DEFAULT_RADIUS_KM);
  const [ready, setReady] = useState(false);
  const storageKey = `friendplace.radius.${areaKey}`;

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (raw === "all") setRadiusState(null);
        else if (raw != null) setRadiusState(Number(raw) || DEFAULT_RADIUS_KM);
      } catch { /* keep default */ }
      finally { setReady(true); }
    })();
  }, [storageKey]);

  const setRadius = (v: number | null) => {
    setRadiusState(v);
    AsyncStorage.setItem(storageKey, v == null ? "all" : String(v)).catch(() => {});
  };

  return { radius, setRadius, ready };
}

export default function RadiusFilter({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const { c, scale } = useTheme();
  return (
    <View>
      <Text style={[styles.caption, { color: c.muted, fontSize: 12 * scale }]}>Show within</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {RADIUS_OPTIONS.map((opt) => {
          const on = value === opt.value;
          return (
            <Pressable
              key={opt.label}
              testID={`radius-${opt.value ?? "all"}`}
              onPress={() => onChange(opt.value)}
              style={[styles.chip, { backgroundColor: on ? c.brand : c.surfaceSecondary, borderColor: on ? c.brand : c.border }]}
            >
              <Text style={{ color: on ? "#FFFFFF" : c.onSurface, fontWeight: "800", fontSize: 14 * scale }}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  caption: { fontWeight: "700", marginBottom: 6, marginLeft: 2 },
  row: { flexDirection: "row", gap: 8, paddingRight: 8 },
  chip: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, borderWidth: 2, minHeight: 40, alignItems: "center", justifyContent: "center" },
});
