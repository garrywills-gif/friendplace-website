import React from "react";
import { Pressable, Platform } from "react-native";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/lib/theme";

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Platform.OS === "web" ? ({ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none", cursor: "pointer" } as any) : null,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      {children}
    </Pressable>
  );
};

export default function TabsLayout() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 8);
  const TAB_HEIGHT = 56;
  return (
    <Tabs
      // "history" keeps the previously-visited tab as the back destination,
      // NEVER falling back to the first tab (Home) when a focus effect
      // briefly re-renders. This prevents the "Profile flickers on then
      // bounces to Home" bug that hits when a background refresh
      // temporarily sets user to null.
      backBehavior="history"
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
        tabBarLabelStyle: { fontSize: 13, fontWeight: "700", marginTop: 2 },
        tabBarIconStyle: { marginTop: 2 },
        tabBarAccessibilityLabel: route.name,
        tabBarIcon: ({ color, focused }) => {
          const map: Record<string, any> = { home: "home", lounge: "cafe", friends: "people", profile: "person" };
          return <Ionicons name={(focused ? map[route.name] : `${map[route.name]}-outline`) as any} size={26} color={color} />;
        },
      })}
    >
      <Tabs.Screen name="home" options={{ title: "Home" }} />
      <Tabs.Screen name="lounge" options={{ title: "Lounge" }} />
      <Tabs.Screen name="friends" options={{ title: "Friends" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}
