import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import AvatarBubble from "@/src/components/AvatarBubble";

export default function Messages() {
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const [convs, setConvs] = useState<any[]>([]);

  useFocusEffect(useCallback(() => {
    if (!user) return;
    api.myConversations(user.id).then(setConvs).catch(() => {});
  }, [user?.id]));

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="My Messages" />
      <FlatList
        data={convs}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        ListEmptyComponent={<Text style={{ color: c.muted, textAlign: "center", marginTop: 40, fontSize: 16 * scale }}>No conversations yet. Say hi from "Find Friends"!</Text>}
        renderItem={({ item }) => (
          <Pressable
            testID={`conv-${item.id}`}
            onPress={() => router.push(`/dm/${item.id}?other_id=${item.other?.id}` as any)}
            style={[styles.row, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}
          >
            <View style={[styles.av, { backgroundColor: c.brandTertiary }]}><AvatarBubble value={item.other?.avatar} size={24} fallback="🙂" /></View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.n, { color: c.onSurface, fontSize: 18 * scale }]}>{item.other?.first_name || "Friend"}</Text>
              <Text numberOfLines={1} style={{ color: c.muted, marginTop: 2, fontSize: 14 * scale }}>{item.last?.text || "Start a conversation"}</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={c.muted} />
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 16, borderWidth: 1 },
  av: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  n: { fontWeight: "800" },
});
