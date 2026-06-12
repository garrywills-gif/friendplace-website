import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";

export default function Groups() {
  const { c, scale } = useTheme();
  const { user, refresh } = useAuth();
  const { show } = useToast();
  const router = useRouter();
  const [groups, setGroups] = useState<any[]>([]);

  const load = async () => setGroups(await api.listGroups());
  useFocusEffect(useCallback(() => { load(); }, []));

  const join = async (g: any) => {
    if (!user) return;
    await api.joinGroup(g.id, user.id);
    show(`Joined ${g.name} 🤝`); await load(); await refresh();
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Community Groups" />
      <FlatList
        data={groups}
        keyExtractor={(g) => g.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        renderItem={({ item }) => {
          const joined = user && (item.members || []).includes(user.id);
          return (
            <Pressable testID={`group-${item.id}`} onPress={() => router.push(`/group/${item.id}` as any)} style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
              <View style={styles.row}>
                <View style={[styles.emoji, { backgroundColor: c.brandTertiary }]}><Text style={{ fontSize: 32 }}>{item.emoji}</Text></View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[styles.title, { color: c.onSurface, fontSize: 20 * scale }]}>{item.name}</Text>
                  <Text style={[styles.desc, { color: c.muted, fontSize: 14 * scale }]} numberOfLines={2}>{item.description}</Text>
                  <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 4 }}>👥 {(item.members || []).length} members</Text>
                </View>
                <Pressable testID={`join-${item.id}`} onPress={() => joined ? router.push(`/group/${item.id}` as any) : join(item)} style={[styles.btn, { backgroundColor: joined ? c.brandTertiary : c.brand }]}>
                  <Text style={{ color: joined ? c.brand : "#FFF", fontWeight: "800", fontSize: 14 * scale }}>{joined ? "Open" : "Join"}</Text>
                </Pressable>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, padding: 14, borderWidth: 1 },
  row: { flexDirection: "row", alignItems: "center" },
  emoji: { width: 60, height: 60, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  title: { fontWeight: "800" },
  desc: { marginTop: 2 },
  btn: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999, minHeight: 44, justifyContent: "center" },
});
