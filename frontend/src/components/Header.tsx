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
          <Pressable testID="header-back" onPress={() => router.back()} style={({ pressed }) => [styles.iconBtn, { backgroundColor: c.surfaceTertiary, opacity: pressed ? 0.7 : 1 }]}>
            <Ionicons name="chevron-back" size={26} color={c.onSurface} />
          </Pressable>
        ) : <View style={styles.iconBtn} />}
        <Text style={[styles.title, { color: c.onSurface, fontSize: 22 * scale }]} numberOfLines={1}>{title}</Text>
        <View style={styles.iconBtn}>{right}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  iconBtn: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  title: { fontWeight: "800", flex: 1, textAlign: "center" },
});
