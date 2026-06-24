import React from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../lib/theme";

/**
 * Header — the "where am I?" banner that appears at the top of every
 * screen.
 *
 * Designed to be unambiguous for the 60+ demographic:
 *   • Big bold page title in brand navy
 *   • Optional emoji/icon next to the title for instant recognition
 *   • Bordered, slightly tinted background so the banner is clearly
 *     distinct from the page body (you can tell "this is the header"
 *     at a glance, even if you've scrolled deep into the page).
 *
 * The Back pill is still there but doesn't dominate — it's deliberately
 * less prominent than the title so the eye lands on the page name first.
 */
export default function Header({
  title,
  subtitle,
  emoji,
  right,
  back = true,
  backHref,
  titleAccessory,
}: {
  title: string;
  subtitle?: string;
  emoji?: string;
  right?: React.ReactNode;
  back?: boolean;
  backHref?: string;
  titleAccessory?: React.ReactNode;
}) {
  const router = useRouter();
  const { c, scale } = useTheme();
  const insets = useSafeAreaInsets();

  /**
   * Smart Back handler — see commit history for the rationale. The TL;DR:
   * iPad Safari's `router.back()` silently no-ops when expo-router's
   * internal history is empty (e.g. hard-loaded URL). On web we first try
   * the real browser history, then fall back to a hard navigation.
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
    if (router.canGoBack && router.canGoBack()) { router.back(); return; }
    if (backHref) { router.replace(backHref as any); return; }
    router.replace("/home" as any);
  };

  return (
    <View
      style={[
        styles.wrap,
        {
          paddingTop: insets.top + 8,
          backgroundColor: c.surface,
          borderBottomColor: c.brand,
        },
      ]}
      testID="page-header"
    >
      {/* Top row — Back button + optional right slot. Title lives in the
          banner row below for prominence. */}
      <View style={styles.navRow}>
        {back ? (
          <Pressable
            testID="header-back"
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={handleBack}
            hitSlop={10}
            style={({ pressed }) => [styles.backBtn, {
              borderColor: c.border,
              backgroundColor: pressed ? c.surfaceTertiary : c.surfaceSecondary,
            }]}
          >
            <Ionicons name="chevron-back" size={20} color={c.onSurface} />
            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 15 * scale }}>Back</Text>
          </Pressable>
        ) : <View style={styles.navSpacer} />}
        {right ? <View>{right}</View> : <View style={styles.navSpacer} />}
      </View>

      {/* Banner row — big bold page title so users always know where
          they are. Optional emoji on the left + subtitle underneath. */}
      <View style={styles.bannerRow}>
        {emoji ? (
          <Text style={{ fontSize: 30, marginRight: 10 }} accessibilityRole="image" accessibilityLabel="">
            {emoji}
          </Text>
        ) : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text
              testID="header-title"
              style={[styles.title, { color: c.onSurface, fontSize: 24 * scale }]}
              numberOfLines={2}
            >
              {title}
            </Text>
            {titleAccessory}
          </View>
          {subtitle ? (
            <Text
              testID="header-subtitle"
              style={{ color: c.muted, fontSize: 13 * scale, marginTop: 2, fontWeight: "600" }}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 2,
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  navSpacer: { width: 40, height: 1 },
  backBtn: {
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1.5,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  bannerRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  title: {
    fontWeight: "900",
    letterSpacing: -0.2,
    flexShrink: 1,
  },
});
