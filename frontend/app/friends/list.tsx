import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl, ActivityIndicator, Alert } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import AvatarWithBadge from "@/src/components/status/AvatarWithBadge";

/**
 * My Friends — the member's accepted friends list.
 *
 * Batch B iter156 (Garry, Aug 2026 — P1 #4): Home now surfaces a
 * dedicated "My Friends" tile that lands here. Kept small and warm:
 * avatar with online badge, first name, suburb, and quick actions to
 * message or view profile. Distinct from "Find Friends" (discovery).
 */

type Friend = {
  id: string;
  first_name?: string;
  username?: string;
  avatar?: string;
  suburb?: string;
};

export default function MyFriends() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user, refresh } = useAuth();
  const { show } = useToast();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Canonical endpoint — returns already-hydrated + filtered
      // friends so /friends/list and the Home tile share the SAME
      // count/list. No more per-id GET loop that could silently drop
      // entries (Batch B iter158 real-iPhone fix).
      const res: any = await api.myFriends(user.id);
      const list: Friend[] = Array.isArray(res?.friends) ? res.friends : [];
      setFriends(list);
    } catch (e: any) {
      show(e?.message || "Could not load your friends.");
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { load(); return undefined; }, [user?.id]));

  const startDm = async (f: Friend) => {
    if (!user) return;
    try {
      const r: any = await api.startDm(user.id, f.id);
      if (r?.id) router.push(`/dm/${r.id}` as any);
    } catch (e: any) {
      show(e?.message || "Could not start chat");
    }
  };

  const confirmRemove = (f: Friend) => {
    if (!user) return;
    Alert.alert(
      `Remove ${f.first_name}?`,
      "You'll still be able to send them a new friend request later.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              await api.removeFriend(user.id, f.id);
              show(`Removed ${f.first_name} from your friends.`);
              setFriends((arr) => arr.filter((x) => x.id !== f.id));
              try { await refresh(); } catch { /* noop */ }
            } catch (e: any) {
              show(e?.message || "Could not remove friend");
            }
          },
        },
      ],
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="My Friends" />
      {loading && friends.length === 0 ? (
        <View style={{ paddingTop: 60, alignItems: "center" }}>
          <ActivityIndicator color={c.brand} />
        </View>
      ) : (
        <FlatList
          data={friends}
          keyExtractor={(f) => f.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
              tintColor={c.brand}
              colors={[c.brand]}
            />
          }
          contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 60 }}
          ListEmptyComponent={() => (
            <View style={{ paddingTop: 60, alignItems: "center", paddingHorizontal: 24 }}>
              <Ionicons name="heart-outline" size={48} color={c.muted} />
              <Text style={{ color: c.onSurface, fontWeight: "800", marginTop: 12, fontSize: 18 * scale, textAlign: "center" }}>
                No friends yet
              </Text>
              <Text style={{ color: c.muted, marginTop: 6, fontSize: 15 * scale, textAlign: "center", lineHeight: 22 }}>
                Head to Find Friends to send your first flutter and start making connections.
              </Text>
              <Pressable
                onPress={() => router.push("/friends" as any)}
                style={[styles.cta, { backgroundColor: c.brand }]}
                testID="empty-find-friends"
              >
                <Ionicons name="people" size={18} color="#FFF" />
                <Text style={{ color: "#FFF", fontWeight: "800", fontSize: 15 * scale }}>Find Friends</Text>
              </Pressable>
            </View>
          )}
          renderItem={({ item }) => (
            <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
              <Pressable
                onPress={() => router.push(`/user/${item.id}` as any)}
                style={styles.cardHead}
                testID={`friend-${item.id}`}
              >
                <AvatarWithBadge value={item.avatar} userId={item.id} size={44} fallback="🙂" />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 18 * scale }}>
                    {item.first_name}
                  </Text>
                  <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 2 }}>
                    @{item.username}{item.suburb ? `  ·  ${item.suburb}` : ""}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={22} color={c.muted} />
              </Pressable>
              <View style={styles.actionRow}>
                <Pressable
                  testID={`msg-${item.id}`}
                  onPress={() => startDm(item)}
                  style={[styles.actionBtn, { backgroundColor: c.brand }]}
                >
                  <Ionicons name="chatbubble-ellipses" size={18} color="#FFF" />
                  <Text style={styles.actionText}>Message</Text>
                </Pressable>
                <Pressable
                  testID={`remove-${item.id}`}
                  onPress={() => confirmRemove(item)}
                  style={[styles.actionBtn, styles.outline, { borderColor: c.border }]}
                >
                  <Ionicons name="person-remove-outline" size={18} color={c.onSurface} />
                  <Text style={[styles.actionText, { color: c.onSurface }]}>Remove</Text>
                </Pressable>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 12, gap: 10 },
  cardHead: { flexDirection: "row", alignItems: "center" },
  actionRow: { flexDirection: "row", gap: 10 },
  actionBtn: {
    flex: 1, minHeight: 44, borderRadius: 999,
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6,
  },
  outline: { backgroundColor: "transparent", borderWidth: 2 },
  actionText: { color: "#FFF", fontWeight: "800", fontSize: 15 },
  cta: {
    marginTop: 18, paddingHorizontal: 20, paddingVertical: 12,
    borderRadius: 999, flexDirection: "row", alignItems: "center", gap: 8,
  },
});
