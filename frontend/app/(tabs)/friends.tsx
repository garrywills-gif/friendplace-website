import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, TextInput, Pressable, ScrollView } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";

const SUBURB_FILTERS = ["All", "Bondi", "Manly", "Surry Hills", "Newtown", "Sydney CBD", "Parramatta"];

export default function Friends() {
  const { c, scale } = useTheme();
  const { user, refresh } = useAuth();
  const { show } = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState("");
  const [suburb, setSuburb] = useState("All");
  const [users, setUsers] = useState<any[]>([]);

  const load = async () => {
    try {
      const list = await api.listUsers({ q, suburb: suburb === "All" ? undefined : suburb });
      setUsers((list as any[]).filter((u) => u.id !== user?.id));
    } catch { show("Failed to load"); }
  };
  useFocusEffect(useCallback(() => { load(); }, [q, suburb]));

  const sendReq = async (other: any) => {
    if (!user) return;
    try {
      await api.sendFriendReq(user.id, other.id);
      show(`Friend request sent to ${other.first_name} 🦋`);
      await refresh();
    } catch { show("Already sent or error"); }
  };

  const sendFlutter = async (other: any) => {
    if (!user) return;
    try {
      await api.sendFlutter(user.id, other.id);
      show(`🦋 Flutter sent to ${other.first_name}!`);
      await refresh();
    } catch { show("Could not send flutter"); }
  };

  const startDm = async (other: any) => {
    if (!user) return;
    try {
      const conv = await api.startDm(user.id, other.id);
      router.push(`/dm/${conv.id}?other_id=${other.id}` as any);
    } catch { show("Could not start chat"); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <View style={[styles.head, { paddingTop: insets.top + 8 }]}>
        <Text style={[styles.title, { color: c.onSurface, fontSize: 28 * scale }]}>Find Friends</Text>
        <View style={[styles.searchRow, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <Ionicons name="search" size={22} color={c.muted} />
          <TextInput
            testID="friends-search"
            placeholder="Search by name or interest"
            value={q}
            onChangeText={setQ}
            placeholderTextColor={c.muted}
            style={{ flex: 1, marginLeft: 8, color: c.onSurface, fontSize: 16 * scale, paddingVertical: 12 }}
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {SUBURB_FILTERS.map((s) => (
            <Pressable key={s} onPress={() => setSuburb(s)} style={[styles.chip, { backgroundColor: suburb === s ? c.brand : c.surfaceSecondary, borderColor: suburb === s ? c.brand : c.border }]}>
              <Text style={{ color: suburb === s ? "#FFF" : c.onSurface, fontWeight: "700", fontSize: 14 * scale }}>{s}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <Pressable testID="messages-btn" onPress={() => router.push("/messages")} style={[styles.inboxRow, { backgroundColor: c.brandTertiary }]}>
        <Ionicons name="chatbubbles" size={22} color={c.brand} />
        <Text style={[styles.inboxText, { color: c.brand, fontSize: 16 * scale }]}>My Messages</Text>
        <Ionicons name="chevron-forward" size={20} color={c.brand} />
      </Pressable>

      <FlatList
        data={users}
        keyExtractor={(u) => u.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 100, gap: 10 }}
        renderItem={({ item }) => (
          <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
            <Pressable onPress={() => router.push(`/user/${item.id}` as any)} style={styles.userRow}>
              <View style={[styles.avatar, { backgroundColor: c.brandTertiary }]}>
                <Text style={{ fontSize: 28 }}>{item.avatar || "🙂"}</Text>
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.name, { color: c.onSurface, fontSize: 20 * scale }]}>{item.first_name}</Text>
                <Text style={[styles.metaText, { color: c.muted, fontSize: 14 * scale }]}>📍 {item.suburb || "—"}</Text>
                <Text style={[styles.metaText, { color: c.muted, fontSize: 13 * scale }]} numberOfLines={1}>{(item.interests || []).join(" · ") || "No interests yet"}</Text>
              </View>
            </Pressable>
            <View style={styles.actionRow}>
              <Pressable testID={`add-friend-${item.id}`} onPress={() => sendReq(item)} style={[styles.actionBtn, { backgroundColor: c.brand }]}>
                <Ionicons name="person-add" size={18} color="#FFF" />
                <Text style={[styles.actionText]}>Add</Text>
              </Pressable>
              <Pressable testID={`flutter-${item.id}`} onPress={() => sendFlutter(item)} style={[styles.actionBtn, { backgroundColor: "#8B5CF6" }]}>
                <Text style={{ fontSize: 16 }}>🦋</Text>
                <Text style={[styles.actionText]}>Flutter</Text>
              </Pressable>
              <Pressable testID={`msg-${item.id}`} onPress={() => startDm(item)} style={[styles.actionBtn, { backgroundColor: c.brandSecondary }]}>
                <Ionicons name="chatbubble-ellipses" size={18} color="#FFF" />
                <Text style={[styles.actionText]}>Msg</Text>
              </Pressable>
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={{ textAlign: "center", color: c.muted, marginTop: 30, fontSize: 16 * scale }}>No friends found yet. Try a different search.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: 16, paddingBottom: 8, gap: 10 },
  title: { fontWeight: "900" },
  searchRow: { flexDirection: "row", alignItems: "center", borderRadius: 16, paddingHorizontal: 14, borderWidth: 1, minHeight: 52 },
  chipRow: { gap: 8, paddingVertical: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 2, minHeight: 40, justifyContent: "center" },
  inboxRow: { marginHorizontal: 16, padding: 14, borderRadius: 16, flexDirection: "row", alignItems: "center", gap: 8 },
  inboxText: { flex: 1, fontWeight: "700" },
  card: { borderRadius: 18, padding: 14, borderWidth: 1, gap: 10 },
  userRow: { flexDirection: "row", alignItems: "center" },
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  name: { fontWeight: "800" },
  metaText: { marginTop: 2, fontWeight: "500" },
  actionRow: { flexDirection: "row", gap: 8 },
  actionBtn: { flex: 1, minHeight: 48, borderRadius: 999, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  actionText: { color: "#FFF", fontWeight: "700", fontSize: 15 },
});
