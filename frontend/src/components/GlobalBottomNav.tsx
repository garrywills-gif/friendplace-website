import React, { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, AppState, Platform } from "react-native";
import { useSegments, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/lib/auth";
import { api } from "@/src/lib/api";
import { useUserSocket } from "@/src/lib/user-socket";
import { useTheme } from "@/src/lib/theme";

/**
 * GlobalBottomNav — the 5-tab navy bar, mirrored onto every MAIN screen that
 * lives OUTSIDE the (tabs) group (Notice Board, Groups, Games hub, Recipes,
 * Notifications, a Moment detail, Settings, Profile edit, etc.). On real tab
 * screens the native expo-router tab bar already renders, so this hides
 * itself there to avoid a double bar. It also hides on auth/onboarding and
 * on immersive full-screen surfaces (a game in play, a table, a DM thread,
 * media viewers) — those always have their own back navigation, so the user
 * is never stranded. Active tab + My Chats unread badge mirror the real bar.
 */
const NAVY = "#0D2A57";
const TEAL_PILL = "rgba(45,212,191,0.26)";

const TABS: { key: string; label: string; icon: any; route: string }[] = [
  { key: "home", label: "Home", icon: "home", route: "/home" },
  { key: "chats", label: "My Chats", icon: "chatbubbles", route: "/chats" },
  { key: "lounge", label: "FP Café", icon: "cafe", route: "/lounge" },
  { key: "moments", label: "Moments", icon: "images", route: "/moments" },
  { key: "more", label: "More", icon: "ellipsis-horizontal", route: "/more" },
];

// Top-level route segments for immersive / pre-auth surfaces where the bar
// should stay out of the way (each has its own back navigation).
const HIDE_TOP = new Set(["auth", "onboarding", "welcome", "waitlist", "table", "dm", "preview", "legal", "invite"]);

export default function GlobalBottomNav() {
  const { c, scale } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const segments = useSegments() as string[];
  const top = segments[0] || "";
  const { user } = useAuth();
  const { subscribe } = useUserSocket();
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    if (!user?.id) { setUnread(0); return; }
    try {
      const r: any = await api.dmUnreadTotal(user.id);
      setUnread(Math.max(0, Number(r?.unread) || 0));
    } catch { /* transient */ }
  }, [user?.id]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30000);
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") refresh(); });
    return () => { clearInterval(t); sub.remove(); };
  }, [refresh]);
  useEffect(() => subscribe("dm_update", () => setUnread((n) => n + 1)), [subscribe]);
  useEffect(() => subscribe("dm_read", (e: any) => setUnread((n) => Math.max(0, n + (Number(e?.unread_delta) || 0)))), [subscribe]);
  useEffect(() => subscribe("reconnect", () => refresh()), [subscribe, refresh]);

  if (!user) return null;
  // On real tab screens the native bar already renders (first segment is the
  // (tabs) group). Also hide on pre-auth / immersive full-screen surfaces.
  if (top === "" || top === "(tabs)") return null;
  if (HIDE_TOP.has(top)) return null;
  if (top === "games" && segments[1] === "play") return null;

  const bottomPad = Math.max(insets.bottom, 10);

  return (
    <View style={[styles.bar, { paddingBottom: bottomPad, backgroundColor: NAVY, pointerEvents: "box-none" }]}>
      {TABS.map((t) => {
        const active = t.key === "moments" && top === "moments";
        const color = active ? "#FFFFFF" : "rgba(255,255,255,0.72)";
        return (
          <Pressable
            key={t.key}
            testID={`global-tab-${t.key}`}
            accessibilityRole="button"
            accessibilityLabel={t.label}
            onPress={() => router.navigate(t.route as any)}
            style={styles.item}
            android_ripple={{ borderless: true }}
          >
            <View style={[styles.pill, active ? { backgroundColor: TEAL_PILL } : null]}>
              <Ionicons name={(t.key === "more" ? t.icon : (active ? t.icon : `${t.icon}-outline`)) as any} size={24} color={color} />
              {t.key === "chats" && unread > 0 ? (
                <View style={[styles.badge, { backgroundColor: c.error, borderColor: NAVY }]}>
                  <Text style={styles.badgeTxt}>{unread > 9 ? "9+" : unread}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.label, { color, fontSize: 12 * scale }]} numberOfLines={1}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.10)",
    ...(Platform.OS === "web" ? { zIndex: 40 } : {}),
    elevation: 12,
  },
  item: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 2 },
  pill: { paddingHorizontal: 16, paddingVertical: 3, borderRadius: 999 },
  label: { fontWeight: "800", marginTop: 2 },
  badge: {
    position: "absolute",
    top: -2,
    right: 6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeTxt: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
});
