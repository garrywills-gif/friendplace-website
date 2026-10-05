/**
 * AppHeader — the warm, left-aligned FriendPlace brand bar used at the
 * top of Home and the Moments feed (iter226 visual uplift, Garry
 * Oct 2026).
 *
 * Layout:
 *   [butterfly tile]   FriendPlace          [bell + optional actions]
 *                     Because you belong too
 *
 * Uses the SAME butterfly asset BrandLockup uses — no new artwork and
 * Mum's tribute remains untouched. Pure visual wrapper: callers pass
 * their own bell handler + unread count so no notification plumbing
 * is duplicated here.
 */
import React from "react";
import { View, Text, StyleSheet, Pressable, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import AnimatedTagline from "@/src/components/AnimatedTagline";

const BUTTERFLY_LOGO = require("../../assets/brand/friendplace-app-icon-v5.png");

type Props = {
  /** Optional back arrow handler. When supplied, replaces the butterfly
   *  tile on the far left (used on sub-screens like Moments). */
  onBack?: () => void;
  /** Right-hand bell / notifications handler. When omitted the bell is
   *  not rendered — screens that don't surface notifications simply
   *  pass nothing. */
  onBell?: () => void;
  bellRef?: React.Ref<View>;
  unread?: number;
  /** Optional right-side action node (e.g. the Moments "+ Share"
   *  button). Rendered to the right of the bell. */
  rightAction?: React.ReactNode;
  /** Centered title shown instead of the butterfly tile on sub-screens
   *  (Moments). When set, we show back-arrow + centered title row. */
  title?: string;
  /** Sub-tagline below the wordmark/title. Defaults to the FriendPlace
   *  wordmark tagline on Home. */
  showTagline?: boolean;
  testID?: string;
};

export default function AppHeader({
  onBack,
  onBell,
  bellRef,
  unread = 0,
  rightAction,
  title,
  showTagline = true,
  testID,
}: Props) {
  const { c, scale } = useTheme();
  const isSubScreen = !!onBack || !!title;

  return (
    <View style={styles.wrap} testID={testID}>
      {isSubScreen ? (
        <Pressable
          testID={`${testID || "app-header"}-back`}
          onPress={onBack}
          hitSlop={10}
          style={styles.backBtn}
          accessibilityLabel="Back"
          accessibilityRole="button"
        >
          <Ionicons name="chevron-back" size={28} color={c.onSurface} />
        </Pressable>
      ) : (
        <View style={[styles.tile, { backgroundColor: "#0D2A57" }]}>
          <Image
            source={BUTTERFLY_LOGO}
            style={styles.tileImg}
            resizeMode="contain"
            accessibilityLabel="FriendPlace butterfly"
          />
        </View>
      )}
      <View style={styles.textCol} pointerEvents="none">
        {title ? (
          <Text
            style={[styles.title, { color: c.onSurface, fontSize: 24 * scale }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {title}
          </Text>
        ) : (
          <Text
            style={[styles.wordmark, { fontSize: 30 * scale }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            accessibilityRole="header"
            accessibilityLabel="FriendPlace"
          >
            <Text style={{ color: "#0D2A57" }}>Friend</Text>
            <Text style={{ color: "#14B8A6" }}>Place</Text>
          </Text>
        )}
        {showTagline && !title ? (
          <AnimatedTagline fontSize={14 * scale} />
        ) : null}
      </View>
      <View style={styles.rightCol}>
        {rightAction}
        {onBell ? (
          <Pressable
            ref={bellRef as any}
            testID={`${testID || "app-header"}-bell`}
            onPress={onBell}
            hitSlop={6}
            style={styles.bellBtn}
            accessibilityLabel={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
            accessibilityRole="button"
          >
            <Ionicons name="notifications-outline" size={26} color="#0D2A57" />
            {unread > 0 ? (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeTxt}>{unread > 9 ? "9+" : String(unread)}</Text>
              </View>
            ) : null}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 12,
  },
  tile: {
    width: 54,
    height: 54,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  tileImg: {
    width: "88%",
    height: "88%",
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -8,
  },
  textCol: {
    flex: 1,
    minWidth: 0,
  },
  wordmark: {
    fontWeight: "900",
    letterSpacing: -0.5,
    includeFontPadding: false,
  },
  title: {
    fontWeight: "900",
    letterSpacing: -0.3,
    textAlign: "center",
  },
  tagline: {
    fontWeight: "700",
    marginTop: 2,
  },
  rightCol: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  bellBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  bellBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#DC2626",
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  bellBadgeTxt: {
    color: "#FFF",
    fontWeight: "900",
    fontSize: 11,
    lineHeight: 13,
  },
});
