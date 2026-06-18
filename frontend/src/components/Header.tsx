import React from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../lib/theme";

export default function Header({ title, right, back = true, backHref, titleAccessory }: { title: string; right?: React.ReactNode; back?: boolean; backHref?: string; titleAccessory?: React.ReactNode }) {
  const router = useRouter();
  const { c, scale } = useTheme();
  const insets = useSafeAreaInsets();

  /**
   * Smart Back handler.
   *
   * On iPad Safari (web) `router.back()` silently no-ops when expo-router's
   * internal history is empty — which happens any time we reached the current
   * screen via `window.location.assign(...)`. So on web we first try the real
   * browser history (which always remembers), and only fall back to a hard
   * navigation to the explicit `backHref` (or `/home`) when there is genuinely
   * nothing to go back to.
   */
  const handleBack = () => {
    if (Platform.OS === "web") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w: any = (typeof window !== "undefined" ? window : null);
      if (w && w.history && w.history.length > 1) {
        try { w.history.back(); return; } catch {}
      }
      if (w && backHref) { w.location.assign(backHref); return; }
      if (w) { w.location.assign("/home"); return; }
    }
    // Native: prefer expo-router back; if not possible, use backHref or /home.
    if (router.canGoBack && router.canGoBack()) { router.back(); return; }
    if (backHref) { router.replace(backHref as any); return; }
    router.replace("/home" as any);
  };

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 8, backgroundColor: c.surface, borderBottomColor: c.border }]}>
      <View style={styles.row}>
        {back ? (
          <Pressable
            testID="header-back"
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={handleBack}
            hitSlop={10}
            style={({ pressed }) => [styles.backBtn, { borderColor: c.border, backgroundColor: pressed ? c.surfaceTertiary : c.surfaceSecondary }]}
          >
            <Ionicons name="chevron-back" size={22} color={c.onSurface} />
            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 * scale, marginLeft: 2 }}>Back</Text>
          </Pressable>
        ) : <View style={styles.spacer} />}
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 }}>
          <Text style={[styles.title, { color: c.onSurface, fontSize: 20 * scale, flex: 0, textAlign: "center" }]} numberOfLines={1}>{title}</Text>
          {titleAccessory}
        </View>
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
