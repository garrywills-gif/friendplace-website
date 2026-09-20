import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/lib/theme";

/**
 * More — Wave B. The 6-tab bottom bar surfaces Home · My Friends · FP Café ·
 * Moments · Events; every OTHER area of FriendPlace remains reachable here so
 * nothing became inaccessible when the bar was slimmed down. Grouped, large
 * (56pt) rows with icon + label + chevron for easy reading/tapping.
 */
type Row = { key: string; label: string; icon: any; route: string };
type Group = { title: string; rows: Row[] };

const GROUPS: Group[] = [
  {
    title: "Messages & people",
    rows: [
      { key: "friends", label: "My Friends", icon: "people-outline", route: "/friends" },
      { key: "notifications", label: "Notifications", icon: "notifications-outline", route: "/notifications" },
      { key: "founders", label: "Founding Members", icon: "ribbon-outline", route: "/founders" },
    ],
  },
  {
    title: "Community",
    rows: [
      { key: "events", label: "Events", icon: "calendar-outline", route: "/events" },
      { key: "notices", label: "Notice Board", icon: "reader-outline", route: "/notices" },
      { key: "groups", label: "Community Groups", icon: "people-circle-outline", route: "/groups" },
      { key: "games", label: "Games", icon: "game-controller-outline", route: "/games" },
    ],
  },
  {
    title: "You",
    rows: [
      { key: "profile", label: "My Profile", icon: "person-outline", route: "/profile" },
      { key: "settings", label: "Settings", icon: "settings-outline", route: "/settings" },
      { key: "help", label: "Help & Support", icon: "help-circle-outline", route: "/help" },
    ],
  },
];

export default function MoreScreen() {
  const { c, scale } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: c.surface, paddingTop: insets.top }}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Text style={[styles.headerTitle, { color: c.onSurface, fontSize: 22 * scale }]}>More</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
        {GROUPS.map((g) => (
          <View key={g.title} style={{ marginBottom: 22 }}>
            <Text style={[styles.groupTitle, { color: c.muted, fontSize: 13 * scale }]}>{g.title.toUpperCase()}</Text>
            <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
              {g.rows.map((r, i) => (
                <Pressable
                  key={r.key}
                  testID={`more-${r.key}`}
                  accessibilityRole="button"
                  accessibilityLabel={r.label}
                  onPress={() => router.push(r.route as any)}
                  style={({ pressed }) => [
                    styles.row,
                    i > 0 ? { borderTopWidth: 1, borderTopColor: c.border } : null,
                    pressed ? { backgroundColor: c.brandTertiary } : null,
                  ]}
                >
                  <View style={[styles.iconWrap, { backgroundColor: c.brandTertiary }]}>
                    <Ionicons name={r.icon} size={22} color={c.brand} />
                  </View>
                  <Text style={[styles.rowLabel, { color: c.onSurface, fontSize: 17 * scale }]} numberOfLines={1}>
                    {r.label}
                  </Text>
                  <Ionicons name="chevron-forward" size={20} color={c.muted} />
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    paddingTop: 6,
    borderBottomWidth: 1,
  },
  headerTitle: { fontWeight: "900", letterSpacing: 0.2 },
  groupTitle: { fontWeight: "800", letterSpacing: 0.6, marginBottom: 8, marginLeft: 4 },
  card: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 60,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  iconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rowLabel: { flex: 1, fontWeight: "700" },
});
