/**
 * GlobalDmPrompt — the iOS-style bottom notification sheet that
 * announces a waiting private message.
 *
 * Locked with Garry on 1 August 2026 as George's private-message
 * companion:
 *
 *   "While you were away…
 *    Margaret has sent you a private message."
 *          [💬 Open chat]   [⏰ Not now]
 *
 * Behaviour principles (all TestFlight feedback):
 *   • Slides UP from the bottom (not down from the top).
 *   • Appears a couple of seconds AFTER George has finished greeting
 *     — never at the same moment. See `POST_GREET_DELAY_MS`.
 *   • Sits BELOW George; never overlays his speech bubble.
 *   • "Not now" genuinely means not now — snoozes the same message
 *     for `SNOOZE_MS` (7 min). A newer message re-arms it earlier
 *     via the existing `dm-notify-context` timestamp-keyed dismissal.
 *   • Mounted once at the app root. Hidden on `/`, `/auth/*`,
 *     `/onboarding`, `/waitlist` (same as George).
 */

import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePathname } from "expo-router";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useDmNotify } from "@/src/lib/dm-notify-context";
import AvatarBubble from "@/src/components/AvatarBubble";

// Delay between app-boot and the first DM notification appearing.
// Chosen so George's arrival + greeting bubble comes first, and the
// notification only slides in once George is settled. See George's
// arrival timing in `GeorgeButterfly.tsx`.
const POST_GREET_DELAY_MS = 4200;

// "Not now" snooze duration. Bumped from 7 min → 30 min on 4 Aug 2026
// after Garry reported the prompt reappearing every ~2 min. This
// duration now matches the context-level `DISMISS_COOLDOWN_MS` so both
// layers agree: a "Not now" tap suppresses this prompt for a solid
// half-hour unless a genuinely new message arrives first (in which
// case the context re-arms it via fresh-message detection).
const SNOOZE_MS = 30 * 60 * 1000;

// Routes on which the prompt is NOT rendered — mirrors George's
// HIDDEN_SCREENS list so we behave consistently.
const _isHiddenPath = (p: string | null): boolean => {
  if (!p) return true;
  if (p === "/" || p === "") return true;
  if (p.startsWith("/auth")) return true;
  if (p.startsWith("/onboarding")) return true;
  if (p.startsWith("/waitlist")) return true;
  return false;
};

export default function GlobalDmPrompt() {
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { prompt, openTarget, dismiss } = useDmNotify();

  // ─── Post-greet delay ─────────────────────────────────────────────
  // The prompt starts hidden and unlocks after POST_GREET_DELAY_MS so
  // George gets his arrival + hello without a competing notification.
  const [postGreetOK, setPostGreetOK] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setPostGreetOK(true), POST_GREET_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  // ─── Snooze state ─────────────────────────────────────────────────
  // The dismissed-set in `dm-notify-context` handles per-message
  // dismissal. Here we add a soft timed snooze on top: "Not now" hides
  // the CURRENT prompt for SNOOZE_MS even if it's technically still
  // eligible. If a NEW message arrives the timestamp-keyed dismissal
  // set (in context) re-arms the prompt earlier — that's desirable.
  const [snoozedUntil, setSnoozedUntil] = useState<number>(0);
  const [now, setNow] = useState<number>(() => Date.now());
  // Tick the local clock every 30s while snoozed so we naturally
  // re-render when the snooze expires. Cheap; only runs while there
  // is a live snooze in effect.
  useEffect(() => {
    if (!snoozedUntil || snoozedUntil <= Date.now()) return;
    const iv = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(iv);
  }, [snoozedUntil]);

  const snoozeActive = snoozedUntil > now;

  const visible =
    !!prompt &&
    !!user &&
    !_isHiddenPath(pathname) &&
    postGreetOK &&
    !snoozeActive;

  // ─── Slide-up animation ───────────────────────────────────────────
  // Starts off-screen below and slides up when a prompt arrives.
  const translateY = useSharedValue(160);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      translateY.value = withTiming(0, {
        duration: 380,
        easing: Easing.out(Easing.cubic),
      });
      opacity.value = withTiming(1, { duration: 300 });
    } else {
      translateY.value = withTiming(160, {
        duration: 240,
        easing: Easing.in(Easing.cubic),
      });
      opacity.value = withTiming(0, { duration: 220 });
    }
  }, [visible, translateY, opacity]);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  if (!prompt || !user || _isHiddenPath(pathname) || !postGreetOK) {
    return null;
  }
  if (snoozeActive) return null;

  const isSingle = prompt.kind === "single";

  const handleSnooze = () => {
    // Two-layer dismissal (Garry, 4 Aug 2026 fix): the LOCAL snooze
    // hides the sheet instantly so the animation doesn't wait on a
    // context recompute; the CONTEXT `dismiss()` records the 30-minute
    // cooldown that persists across component remounts and route
    // changes. Prior version relied only on the local snooze, which
    // reset the moment the provider re-rendered (~ every 2 minutes on
    // an active screen), causing Garry's "keeps coming back" report.
    setSnoozedUntil(Date.now() + SNOOZE_MS);
    try { dismiss(); } catch {}
  };

  // ── Copy ──────────────────────────────────────────────────────────
  const headline = "While you were away…";
  const body = isSingle
    ? `${prompt.name} has sent you a private message.`
    : `You have ${prompt.count} new private chats.`;

  // Bottom offset — sit above the tab bar (~64pt on most devices)
  // plus the home indicator inset. Enough breathing room from the
  // resting butterfly's landing spot too.
  const bottomOffset = insets.bottom + 76;

  return (
    <Reanimated.View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: bottomOffset }, cardStyle]}
      testID="global-dm-prompt"
    >
      <View
        style={[
          styles.card,
          {
            backgroundColor: c.surface,
            borderColor: c.border,
            shadowColor: "#000",
          },
        ]}
      >
        <View style={styles.headerRow}>
          {isSingle ? (
            <AvatarBubble value={prompt.avatar} size={40} fallback="🙂" />
          ) : (
            <View
              style={[
                styles.groupIcon,
                { backgroundColor: c.brandTertiary },
              ]}
            >
              <Text style={{ fontSize: 20 }}>💬</Text>
            </View>
          )}
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text
              testID="global-dm-prompt-headline"
              style={{
                color: c.muted,
                fontSize: 12 * scale,
                fontWeight: "700",
                marginBottom: 2,
              }}
            >
              {headline}
            </Text>
            <Text
              numberOfLines={2}
              testID="global-dm-prompt-body"
              style={{
                color: c.onSurface,
                fontSize: 15 * scale,
                fontWeight: "700",
                lineHeight: 20 * scale,
              }}
            >
              {body}
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
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
              numberOfLines={1}
              style={{
                color: "#FFFFFF",
                fontWeight: "900",
                fontSize: 15 * scale,
                letterSpacing: 0.2,
              }}
            >
              💬  Open chat
            </Text>
          </Pressable>
          <Pressable
            testID="global-dm-prompt-dismiss"
            onPress={handleSnooze}
            accessibilityRole="button"
            accessibilityLabel="Snooze George's prompt for a few minutes"
            style={({ pressed }) => [
              styles.secondaryBtn,
              {
                backgroundColor: pressed ? c.brandTertiary : c.surface,
                borderColor: c.border,
              },
            ]}
          >
            <Text
              numberOfLines={1}
              style={{
                color: c.onSurface,
                fontWeight: "800",
                fontSize: 15 * scale,
                letterSpacing: 0.2,
              }}
            >
              ⏰  Not now
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
    // Modals (which use their own portal).
    zIndex: 999,
    ...Platform.select({ android: { elevation: 12 }, default: {} }),
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    // Soft iOS-style shadow — familiar territory for members used
    // to native iOS notifications.
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -6 },
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  groupIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  primaryBtn: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  secondaryBtn: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
});
