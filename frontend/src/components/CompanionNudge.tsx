/**
 * CompanionNudge — a brief, self-dismissing in-app nudge from the
 * member's chosen companion (George / Georgia) when a new private
 * message or Flutter arrives while the app is foregrounded.
 *
 * Why: while a member is online the small unread badge is easy to miss
 * (Garry, TestFlight Jun 2026). This slides a gentle companion card in
 * from the top for a few seconds, then leaves. It is strictly additive:
 *   • It NEVER touches the unread badge — that stays until the item is
 *     opened (handled by the existing DM/notification read flows).
 *   • NO voice autoplay.
 *   • No route changes — tapping just navigates to the existing target.
 *
 * Driven by the real-time `notification` socket event (server-side
 * push_notification fan-out), so it needs no polling of its own.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePathname, useRouter } from "expo-router";
import { useInboxEvent } from "@/src/lib/user-socket";
import { useGeorgeVoice, VOICE_LABELS } from "@/src/lib/george-voice";
import { GeorgeButterflyMark } from "@/src/components/george/GeorgeButterflyMark";
import { useTheme } from "@/src/lib/theme";

// Notification types we nudge for: private messages, Flutters, and
// Play Together invites — all things a member wants to see right away.
const NUDGE_TYPES = new Set(["dm", "dm_request", "flutter", "game_invite"]);

// Routes where the companion stays quiet (mirrors GeorgeGlobalHost).
const HIDDEN_PREFIXES = ["/auth", "/onboarding", "/waitlist"];

const VISIBLE_MS = 5500;

type Nudge = {
  key: string;
  title: string;
  body: string;
  route: string;
};

export default function CompanionNudge() {
  const { c, scale } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname() || "";
  const { voice } = useGeorgeVoice();
  const companionName = VOICE_LABELS[voice]?.short || "George";

  const [nudge, setNudge] = useState<Nudge | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
    Animated.timing(anim, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => {
      setNudge(null);
    });
  }, [anim]);

  const routeFor = (n: any): string => {
    const type = n?.type;
    const payload = n?.payload || {};
    if (type === "game_invite") {
      return payload.session_id ? `/games/play/${payload.session_id}` : "/games/play";
    }
    if (type === "flutter") return "/notifications";
    // dm / dm_request → open the exact conversation when we have it.
    const convId = payload.dm_id || payload.conv_id;
    const fromId = payload.from_id;
    if (convId) return `/dm/${convId}${fromId ? `?other_id=${fromId}` : ""}`;
    return "/messages";
  };

  useInboxEvent("notification", (evt: any) => {
    const n = evt?.notification;
    if (!n || !NUDGE_TYPES.has(n.type)) return;
    // Stay quiet on auth/onboarding/welcome, and if already viewing the
    // exact target conversation (nothing to nudge about).
    if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p)) || pathname === "/") return;
    const route = routeFor(n);
    if (route.startsWith("/dm/") && pathname.startsWith(route.split("?")[0])) return;
    setNudge({
      key: n.id || String(Date.now()),
      title: n.title || (n.type === "flutter" ? "New Flutter" : "New message"),
      body: n.body || "",
      route,
    });
  });

  // Animate in + arm auto-hide whenever a new nudge is set.
  useEffect(() => {
    if (!nudge) return;
    anim.setValue(0);
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 8, tension: 80 }).start();
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(hide, VISIBLE_MS);
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [nudge, anim, hide]);

  if (!nudge) return null;

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [-140, 0] });

  const open = () => {
    const target = nudge.route;
    hide();
    // Navigate on the next tick so the hide animation isn't cut short.
    setTimeout(() => { try { router.push(target as any); } catch { /* noop */ } }, 40);
  };

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { top: insets.top + 8, opacity: anim, transform: [{ translateY }] }]}
    >
      <Pressable
        testID="companion-nudge"
        accessibilityRole="button"
        accessibilityLabel={`${nudge.title}. Tap to open.`}
        onPress={open}
        style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, shadowColor: "#0D2A57" }]}
      >
        <GeorgeButterflyMark size={34} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.name, { color: c.accent, fontSize: 11 * scale }]}>{companionName.toUpperCase()}</Text>
          <Text numberOfLines={1} style={[styles.title, { color: c.onSurface, fontSize: 14.5 * scale }]}>
            {nudge.title}
          </Text>
          {nudge.body ? (
            <Text numberOfLines={1} style={[styles.body, { color: c.muted, fontSize: 12.5 * scale }]}>
              {nudge.body}
            </Text>
          ) : null}
        </View>
        <Pressable
          testID="companion-nudge-dismiss"
          onPress={hide}
          hitSlop={10}
          accessibilityLabel="Dismiss"
          style={styles.close}
        >
          <Text style={{ color: c.muted, fontSize: 20 * scale, fontWeight: "700" }}>×</Text>
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 9999,
    ...Platform.select({ web: { position: "fixed" as any }, default: {} }),
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  name: { fontWeight: "900", letterSpacing: 0.8, marginBottom: 1 },
  title: { fontWeight: "800", lineHeight: 19 },
  body: { fontWeight: "600", lineHeight: 16, marginTop: 1 },
  close: { padding: 4, marginLeft: 2 },
});
