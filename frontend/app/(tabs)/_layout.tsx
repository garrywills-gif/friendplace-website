import React from "react";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/lib/theme";

export default function TabsLayout() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  // Reserve room for the home-indicator on iPhone/iPad so touch targets aren't
  // hidden under the system gesture zone. Min 8px on devices without an inset.
  const bottomPad = Math.max(insets.bottom, 8);
  const TAB_HEIGHT = 56;
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: c.brand,
        tabBarInactiveTintColor: c.muted,
        tabBarHideOnKeyboard: true,
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
