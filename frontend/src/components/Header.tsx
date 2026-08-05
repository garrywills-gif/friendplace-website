import React, { useEffect } from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Reanimated, {
  Easing, useAnimatedStyle, useSharedValue,
  withRepeat, withSequence, withTiming,
} from "react-native-reanimated";
import { useTheme } from "../lib/theme";
import { useGeorge } from "../lib/george-context";
import { GeorgeButterflyMark } from "./george/GeorgeButterflyMark";

// Teal FriendPlace butterfly — REPLACED with George in C1 Slice 3 v5
// (Garry, 22 July 2026). George is the FriendPlace brand mark AND the
// member's companion; having both was redundant. He now lives inline
// in every secondary header via `<GeorgeHeaderMark />` below. The
// static image is retained for the (unused) BUTTERFLY_LOGO reference
// so nothing that imports it breaks.
// const BUTTERFLY_LOGO = require("../../assets/brand/friendplace-app-icon-v5.png");

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
  showGeorge = true,
}: {
  title: string;
  subtitle?: string;
  emoji?: string;
  right?: React.ReactNode;
  back?: boolean;
  backHref?: string;
  titleAccessory?: React.ReactNode;
  /** When false, hides the inline George butterfly on the right of
   * the banner row. Use on tab screens where the global floating
   * butterfly is already visible, to avoid rendering two Georges
   * (Garry, 8 Aug 2026 TestFlight polish). */
  showGeorge?: boolean;
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
          they are. Optional emoji on the left + subtitle underneath.
          The FriendPlace butterfly sits on the far right so the brand
          mark is present on every page (screens without a full lockup
          still carry the logo). */}
      <View style={styles.bannerRow}>
        {emoji ? (
          // If the emoji IS the FriendPlace butterfly, render the master
          // butterfly mark so the header carries the same butterfly as
          // every other surface. Any other emoji stays as text — those
          // are just navigational icons (☕ 🎲 🌷 etc).
          emoji === "🦋" ? (
            <View style={{ width: 34, height: 34, marginRight: 10, alignItems: "center", justifyContent: "center" }}>
              <GeorgeButterflyMark size={30} />
            </View>
          ) : (
            <Text style={{ fontSize: 30, marginRight: 10 }} accessibilityRole="image" accessibilityLabel="">
              {emoji}
            </Text>
          )
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
        <GeorgeHeaderMark hidden={!showGeorge} />
      </View>
    </View>
  );
}

/**
 * GeorgeHeaderMark — George living inline in the header of every
 * secondary screen (C1 Slice 3 v5, Garry 22 July 2026). Replaces the
 * previous static FriendPlace butterfly icon so the brand mark and
 * the companion are one and the same.
 *
 * Tapping fires `openGeorge()` from the George context, which the
 * globally-mounted `<GeorgeButterfly />` picks up and opens the
 * chat modal for. Landing after a George-led navigation plays a
 * short flutter-in (~800ms) triggered by the `landedFrom` context
 * flag matching the current screen.
 */
function GeorgeHeaderMark({ hidden = false }: { hidden?: boolean }) {
  const { openGeorge, landedFrom, currentScreen, consumeLanded } = useGeorge();
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const wingFlap = useSharedValue(1);
  const rot = useSharedValue(0);

  useEffect(() => {
    if (!landedFrom) return;
    if (currentScreen !== landedFrom) return;
    // Flutter into place — small scale + fade + wing flap, ~800ms.
    scale.value = 0.35;
    opacity.value = 0;
    rot.value = -8;
    wingFlap.value = withRepeat(
      withSequence(
        withTiming(0.72, { duration: 150, easing: Easing.inOut(Easing.quad) }),
        withTiming(1,    { duration: 150, easing: Easing.inOut(Easing.quad) }),
      ),
      5, // ~1.5s of flapping, tapering out
      false,
    );
    opacity.value = withTiming(1, { duration: 380, easing: Easing.out(Easing.quad) });
    scale.value = withSequence(
      withTiming(1.15, { duration: 500, easing: Easing.out(Easing.cubic) }),
      withTiming(1,    { duration: 260, easing: Easing.inOut(Easing.cubic) }),
    );
    rot.value = withSequence(
      withTiming(6,  { duration: 400 }),
      withTiming(0,  { duration: 380, easing: Easing.out(Easing.cubic) }),
    );
    const t = setTimeout(() => consumeLanded(), 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landedFrom, currentScreen]);

  // TestFlight feedback #6 (Garry, 27 July 2026): subtle bob every
  // ~10s so the inline George in header feels alive too — matches
  // the floating butterfly on tab screens.
  useEffect(() => {
    const tick = () => {
      wingFlap.value = withSequence(
        withTiming(0.82, { duration: 130, easing: Easing.inOut(Easing.quad) }),
        withTiming(1.08, { duration: 150, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.9,  { duration: 130, easing: Easing.inOut(Easing.quad) }),
        withTiming(1,    { duration: 180, easing: Easing.out(Easing.quad) }),
      );
      scale.value = withSequence(
        withTiming(1.05, { duration: 220, easing: Easing.out(Easing.quad) }),
        withTiming(1,    { duration: 300, easing: Easing.inOut(Easing.quad) }),
      );
    };
    const timer = setInterval(tick, 10000);
    return () => clearInterval(timer);
  }, [wingFlap, scale]);

  const markStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { scale: scale.value },
      { rotate: `${rot.value}deg` },
    ],
  }));
  const wingStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: wingFlap.value }],
  }));

  return (
    <Pressable
      onPress={openGeorge}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel="Chat to George"
      testID="george-butterfly-header"
      style={[styles.brandMark, hidden && { opacity: 0, pointerEvents: 'none' as const, width: 0, height: 0, overflow: 'hidden' }]}
    >
      {hidden ? null : (
        <Reanimated.View style={markStyle}>
          <Reanimated.View style={wingStyle}>
            <GeorgeButterflyMark size={40} />
          </Reanimated.View>
        </Reanimated.View>
      )}
    </Pressable>
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
  brandMark: {
    width: 40,
    height: 40,
    marginLeft: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
