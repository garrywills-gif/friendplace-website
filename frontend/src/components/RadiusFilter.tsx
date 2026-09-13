import React from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";

/**
 * Local Discovery radius selector — Notice Board / Local Events /
 * Community Groups. Options are 5/10/25/50 km plus "All". `value` is the
 * chosen radius in km, or null for "All". Default across the app is 25 km.
 */
export const RADIUS_OPTIONS: { label: string; km: number | null }[] = [
  { label: "5 km", km: 5 },
  { label: "10 km", km: 10 },
  { label: "25 km", km: 25 },
  { label: "50 km", km: 50 },
  { label: "All", km: null },
];

export const DEFAULT_RADIUS_KM: number | null = 25;

export default function RadiusFilter({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (km: number | null) => void;
}) {
  const { c, scale } = useTheme();
  return (
    <View style={styles.wrap}>
      <Ionicons name="location-outline" size={16} color={c.muted} style={{ marginLeft: 4, marginRight: 2 }} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {RADIUS_OPTIONS.map((opt) => {
          const active = opt.km === value;
          return (
            <Pressable
              key={opt.label}
              testID={`radius-${opt.km ?? "all"}`}
              onPress={() => onChange(opt.km)}
              hitSlop={4}
              style={[
                styles.chip,
                { backgroundColor: active ? c.brand : c.surfaceSecondary, borderColor: active ? c.brand : c.border },
              ]}
            >
              <Text style={{ color: active ? "#FFF" : c.onSurface, fontWeight: "800", fontSize: 12 * scale }}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", paddingRight: 8 },
  row: { gap: 8, paddingHorizontal: 6, paddingVertical: 8 },
  chip: {
    paddingHorizontal: 14,
    minHeight: 34,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
