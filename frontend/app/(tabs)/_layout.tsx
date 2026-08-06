import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Platform, View, Text, AppState } from "react-native";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { api } from "@/src/lib/api";
import { useUserSocket } from "@/src/lib/user-socket";

/**
 * Custom tab button — replaces the default expo-router/react-navigation tab
 * button which on Web renders as an `<a href>` anchor. Anchors trigger
 * iPadOS Safari's long-press preview ("Open in New Window / Tab") and can
 * also be cmd/ctrl-clicked into a new window. We render a plain Pressable
 * so the tab is a real button, not a navigable link.
 */
const TabBtn = (props: any) => {
  const { onPress, onLongPress, accessibilityState, children, style } = props;
  return (
    <Pressable
      // strip href so the underlying RNW renderer does NOT emit <a>
      href={undefined as any}
      // RNW: disable the iOS Safari context menu + text selection on the bar
      // @ts-ignore — dataSet types
      dataSet={Platform.OS === "web" ? { tabbarbtn: "true" } : undefined}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      onPress={onPress}
      onLongPress={onLongPress}
      android_ripple={{ borderless: true }}
      style={({ pressed }) => [
        style,
        Platform.OS === "web" ? ({ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none", cursor: "pointer" } as any) : null,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      {children}
    </Pressable>
  );
};

/**
 * Icon renderer for the Chats tab. Overlays a red badge with the total
 * unread count.
 *
 * iter154 realtime — the badge now reacts to `dm_update` / `dm_read` /
 * `notification` events over the per-user inbox WebSocket, so the
 * count updates within ~100 ms of a message landing on the server.
 * Polling stays as a safety net at a slow 30 s cadence so a dropped
 * socket eventually reconciles. On AppState → "active" AND on every
 * socket "reconnect" edge we force a fresh reconciliation fetch so
 * the count is authoritative before optimistic deltas resume.
 */
function ChatsIcon({ focused, color }: { focused: boolean; color: string }) {
  const { user } = useAuth();
  const { c } = useTheme();
  const [count, setCount] = useState<number>(0);
  const timerRef = useRef<any>(null);
  const { subscribe } = useUserSocket();

  const refresh = useCallback(async () => {
    if (!user?.id) { setCount(0); return; }
    try {
      const r: any = await api.dmUnreadTotal(user.id);
      setCount(Math.max(0, Number(r?.unread) || 0));
    } catch {
      // Silent — a transient 401/network blip must not spam the console
      // for a background poll.
    }
  }, [user?.id]);

  useEffect(() => {
    refresh();
    // 30 s reconciliation — much slower than pre-iter154 because the
    // socket does the fast work; this is only a safety net.
    timerRef.current = setInterval(refresh, 30000);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refresh();
    });
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      sub.remove();
    };
  }, [refresh]);

  // Real-time reactions. We apply optimistic +/- deltas from socket
  // events and rely on the 30 s reconcile (plus the on-reconnect
  // reconcile below) to keep drift bounded.
  useEffect(() => subscribe("dm_update", (evt: any) => {
    const delta = Number(evt?.unread_delta || 1);
    setCount((n) => Math.max(0, n + delta));
  }), [subscribe]);

  useEffect(() => subscribe("dm_read", (evt: any) => {
    const delta = Number(evt?.unread_delta || 0); // negative
    setCount((n) => Math.max(0, n + delta));
  }), [subscribe]);

  // Every (re)connect edge → refetch the authoritative total so any
  // optimistic drift is cleaned up. This is the piece that guarantees
  // "no duplicate unread increments after reconnect" (Garry's spec).
  useEffect(() => subscribe("reconnect", () => { refresh(); }), [subscribe, refresh]);

  return (
    <View style={{ width: 30, height: 30, alignItems: "center", justifyContent: "center" }}>
      <Ionicons
        name={(focused ? "chatbubbles" : "chatbubbles-outline") as any}
        size={26}
        color={color}
      />
      {count > 0 && (
        <View
          testID="chats-tab-unread"
          style={{
            position: "absolute",
            top: -4,
            right: -8,
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            paddingHorizontal: 5,
            backgroundColor: c.error,
            borderWidth: 2,
            borderColor: c.surfaceSecondary,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 10, fontWeight: "900" }}>
            {count > 9 ? "9+" : count}
          </Text>
        </View>
      )}
    </View>
  );
}

export default function TabsLayout() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 8);
  const TAB_HEIGHT = 56;
  return (
    <Tabs
      // Solid scene background — without this, tab transitions on iOS can
      // flash through to the OS home screen for ~0.5 s while the next
      // screen mounts (visible bug reproduced in Expo Go). A solid
      // colour gives the transitioning frames something to render
      // against.
      sceneContainerStyle={{ backgroundColor: c.surface }}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: c.brand,
        tabBarInactiveTintColor: c.muted,
        tabBarHideOnKeyboard: true,
        tabBarButton: (props) => <TabBtn {...props} />,
        tabBarStyle: {
          backgroundColor: c.surfaceSecondary,
          borderTopColor: c.border,
          height: TAB_HEIGHT + bottomPad,
          paddingBottom: bottomPad,
          paddingTop: 6,
        },
        tabBarItemStyle: { paddingVertical: 4 },
        // Slightly smaller label so five tabs breathe comfortably on the
        // narrowest iPhone (SE 4.7") without truncating "Friends".
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700", marginTop: 2 },
        tabBarIconStyle: { marginTop: 2 },
        tabBarAccessibilityLabel: route.name,
        tabBarIcon: ({ color, focused }) => {
          if (route.name === "chats") {
            return <ChatsIcon focused={focused} color={color} />;
          }
          const map: Record<string, any> = { home: "home", lounge: "cafe", friends: "people", profile: "person" };
          return <Ionicons name={(focused ? map[route.name] : `${map[route.name]}-outline`) as any} size={26} color={color} />;
        },
      })}
    >
      {/* Tab order: Home · Chats · FP Café · Friends · Profile — Chats sits
       *  right after Home so it's within thumb reach and mirrors the
       *  messaging-first mental model users have from iMessage/WhatsApp.
       *  TestFlight round-2 v2 (Garry, 28 July 2026 #7): tab title
       *  renamed "Lounge" → "FP Café" so it matches the screen. */}
      <Tabs.Screen name="home" options={{ title: "Home" }} />
      <Tabs.Screen name="chats" options={{ title: "Chats" }} />
      <Tabs.Screen name="lounge" options={{ title: "FP Café" }} />
      <Tabs.Screen name="friends" options={{ title: "Friends" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}
