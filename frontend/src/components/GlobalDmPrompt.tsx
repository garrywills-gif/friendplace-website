/**
 * GlobalDmPrompt — the small "🦋 Kerry sent you a private message"
 * card that slides in from the top when a new DM arrives on any
 * screen. Mounted once at the app root next to `GeorgeGlobalHost`.
 *
 * Approved by Garry on 24 June 2026. Copy is deliberately compact:
 *   • Single: "🦋 Kerry sent you a private message" (per Garry's
 *     shorter phrasing — was "has sent you", now the natural verb).
 *   • Group:  "🦋 You have N new private chats"
 *
 * Design notes (respecting the UI freeze):
 *   • Uses ONLY existing brand tokens (c.surface, c.brand, c.muted,
 *     c.onSurface, c.border). No new palette entries.
 *   • Buttons follow the existing Chat Alert modal action pattern
 *     (filled brand primary + outlined secondary).
 *   • Sits ABOVE the tab bar and George butterfly using a high
 *     zIndex on iOS/Android and a fixed `elevation`. Sits BELOW
 *     modals so it can't overlay a full-screen sheet.
 *   • Uses SafeAreaInsets so it clears the notch / dynamic island.
 *   • Never appears on `/`, `/auth/*`, `/onboarding`, `/waitlist` —
 *     the same routes George itself hides on.
 */
import React, { useEffect } from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useDmNotify } from "@/src/lib/dm-notify-context";
import AvatarBubble from "@/src/components/AvatarBubble";

// Routes on which the prompt is NOT rendered — mirrors George's
// HIDDEN_SCREENS list so we behave consistently. Home is added to
// this list because the Home screen renders its own INLINE version
// of the prompt in the notification zone below George's welcome
// (Garry, 1 Aug 2026 — "George owns the top of the Home screen; app
// notifications should feel like messages from the app and sit in
// their own zone, not overlaid on George").
const _isHiddenPath = (p: string | null): boolean => {
  if (!p) return true;
  if (p === "/" || p === "") return true;
  if (p.startsWith("/auth")) return true;
  if (p.startsWith("/onboarding")) return true;
  if (p.startsWith("/waitlist")) return true;
  // Home is now handled by an inline instance rendered in the Home
  // screen tree itself (see `app/(tabs)/home.tsx` → HomeDmPrompt).
  if (p === "/(tabs)/home" || p === "/home" || p === "/(tabs)") return true;
  return false;
};

/**
 * Renders the DM prompt UI. When `inline` is true, the prompt sits
 * in the normal document flow (used inside Home between George's
 * welcome and the first content card) instead of floating at the
 * top of the viewport. In inline mode we still animate in/out, but
 * without an absolute-position wrapper or safe-area top inset.
 */
export function GlobalDmPromptInline() {
  return <DmPromptBody inline />;
}

export default function GlobalDmPrompt() {
  return <DmPromptBody />;
}

function DmPromptBody({ inline = false }: { inline?: boolean }) {
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { prompt, openTarget, dismiss } = useDmNotify();

  // The floating instance hides on Home (handled inline). The inline
  // instance ignores the pathname guard because it is only mounted
  // on Home by design.
  const visible = !!prompt && !!user && (inline || !_isHiddenPath(pathname));

  // Slide-in animation — subtle, matches the pace of George's
  // header flutter (~380ms). Native driver-friendly.
  const translateY = useSharedValue(-120);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      translateY.value = withTiming(0, {
        duration: 340,
        easing: Easing.out(Easing.cubic),
      });
      opacity.value = withTiming(1, { duration: 260 });
    } else {
      translateY.value = withTiming(-120, {
        duration: 220,
        easing: Easing.in(Easing.cubic),
      });
      opacity.value = withTiming(0, { duration: 180 });
    }
  }, [visible, translateY, opacity]);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  if (!prompt || !user || _isHiddenPath(pathname)) {
    // Still render the animated container so a fade-out can play,
    // but bail early if we don't need it. Keeping this outside the
    // main return would break the shared-value continuity.
    return null;
  }

  const isSingle = prompt.kind === "single";
  const title = isSingle
    ? `${prompt.name} sent you a private message`
    : `You have ${prompt.count} new private chats`;

  return (
    <Reanimated.View
      pointerEvents="box-none"
      style={[
        inline ? styles.inlineWrap : styles.wrap,
        inline ? null : { top: insets.top + 6 },
        cardStyle,
      ]}
      testID={inline ? "home-dm-prompt" : "global-dm-prompt"}
    >
      <View
        style={[
          styles.card,
          {
            backgroundColor: c.surface,
            borderColor: c.brand,
            shadowColor: "#000",
          },
        ]}
      >
        <View style={styles.headerRow}>
          {isSingle ? (
            <AvatarBubble value={prompt.avatar} size={36} fallback="🙂" />
          ) : (
            <View
              style={[
                styles.groupIcon,
                { backgroundColor: c.brandTertiary },
              ]}
            >
              <Ionicons name="chatbubbles" size={20} color={c.brand} />
            </View>
          )}
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text
              style={{
                color: c.muted,
                fontSize: 11 * scale,
                fontWeight: "800",
                letterSpacing: 0.4,
              }}
            >
              🦋 GEORGE
            </Text>
            <Text
              numberOfLines={2}
              style={{
                color: c.onSurface,
                fontSize: 15 * scale,
                fontWeight: "800",
                marginTop: 2,
              }}
            >
              {title}
            </Text>
          </View>
        </View>
        <View style={styles.actions}>
          <Pressable
            testID="global-dm-prompt-dismiss"
            onPress={dismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss George's prompt"
            style={({ pressed }) => [
              styles.secondaryBtn,
              {
                backgroundColor: pressed ? c.brandTertiary : c.surface,
                borderColor: c.border,
              },
            ]}
          >
            <Text
              style={{
                color: c.onSurface,
                fontWeight: "800",
                fontSize: 14 * scale,
              }}
            >
              Not now
            </Text>
          </Pressable>
          <Pressable
            testID="global-dm-prompt-open"
            onPress={openTarget}
            accessibilityRole="button"
            accessibilityLabel={
              isSingle ? "Open the private message" : "View private chats"
            }
            style={({ pressed }) => [
              styles.primaryBtn,
              {
                backgroundColor: c.brand,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Text
              style={{
                color: "#FFFFFF",
                fontWeight: "900",
                fontSize: 14 * scale,
              }}
            >
              {isSingle ? "Open chat" : "View chats"}
            </Text>
          </Pressable>
        </View>
      </View>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 12,
    right: 12,
    // Sit above the tab bar / George butterfly, but below full-screen
    // Modals (which use their own portal). Values chosen to match
    // the existing header shadow z on iOS.
    zIndex: 999,
    // Android needs explicit elevation for the same effect.
    ...Platform.select({ android: { elevation: 12 }, default: {} }),
  },
  // Inline variant — flows in the normal document, no floating z-index,
  // used on Home so app-notifications sit in their own zone beneath
  // George's welcome. Same card visual, no absolute wrapper.
  inlineWrap: {
    marginHorizontal: 0,
    marginTop: 4,
    marginBottom: 12,
  },
  card: {
    padding: 14,
    borderRadius: 18,
    borderWidth: 2,
    // Soft drop shadow so the card lifts off any background —
    // matches the FP Café "Looking for a chat" banner shadow depth
    // so we stay visually consistent without introducing new tokens.
    ...Platform.select({
      ios: {
        shadowOpacity: 0.16,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
      },
      android: {},
      default: {},
    }),
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  groupIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 12,
  },
  secondaryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
  },
});
