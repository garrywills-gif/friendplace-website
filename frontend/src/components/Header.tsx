import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../lib/theme";

export default function Header({ title, right, back = true }: { title: string; right?: React.ReactNode; back?: boolean }) {
  const router = useRouter();
  const { c, scale } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 8, backgroundColor: c.surface, borderBottomColor: c.border }]}>
      <View style={styles.row}>
        {back ? (
          <Pressable
            testID="header-back"
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.back()}
            hitSlop={10}
            style={({ pressed }) => [styles.backBtn, { borderColor: c.border, backgroundColor: pressed ? c.surfaceTertiary : c.surfaceSecondary }]}
          >
            <Ionicons name="chevron-back" size={22} color={c.onSurface} />
            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 * scale, marginLeft: 2 }}>Back</Text>
          </Pressable>
        ) : <View style={styles.spacer} />}
        <Text style={[styles.title, { color: c.onSurface, fontSize: 20 * scale }]} numberOfLines={1}>{title}</Text>
        <View style={styles.spacer}>{right}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  backBtn: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    flexDirection: "row",
    alignItems: "center",
  },
  spacer: { minWidth: 88, alignItems: "flex-end" },
  title: { fontWeight: "800", flex: 1, textAlign: "center" },
});
