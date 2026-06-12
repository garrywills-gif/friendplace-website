import React from "react";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";

export default function TabsLayout() {
  const { c } = useTheme();
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: c.brand,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: { backgroundColor: c.surfaceSecondary, borderTopColor: c.border, height: 72, paddingBottom: 12, paddingTop: 8 },
        tabBarLabelStyle: { fontSize: 13, fontWeight: "700" },
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
