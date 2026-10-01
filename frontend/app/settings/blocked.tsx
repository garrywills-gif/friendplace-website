import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl, ActivityIndicator, Alert } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import AvatarBubble from "@/src/components/AvatarBubble";

/**
 * iter210 (Garry, Oct 2026 — FEATURE #14): Blocked members management.
 *
 * Members had no way to review or undo a block before this. The screen
 * lists everyone the signed-in user has blocked (name, avatar, suburb if
 * public), with an Unblock button beside each row. We confirm before
 * unblocking so a stray tap can't quietly undo a block.
 */
type BlockedUser = { id: string; first_name: string; avatar: string; suburb: string };

export default function BlockedMembers() {
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const { show } = useToast();
  const router = useRouter();
  const [list, setList] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const r: any = await api.listBlocked(user.id);
      setList(Array.isArray(r?.blocked) ? r.blocked : []);
    } catch {
      show("Couldn't load your blocked list — please try again.");
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { load(); return undefined; }, [user?.id]));

  const unblock = (u: BlockedUser) => {
    if (!user) return;
    Alert.alert(
      `Unblock ${u.first_name}?`,
      "They'll be able to see your posts and reach out to you again.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unblock",
          style: "default",
          onPress: async () => {
            setUnblockingId(u.id);
            try {
              await api.unblockUser(user.id, u.id);
              setList((xs) => xs.filter((x) => x.id !== u.id));
              show(`Unblocked ${u.first_name}`);
            } catch {
              show("Couldn't unblock — please try again.");
            } finally {
              setUnblockingId(null);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Blocked members" showGeorge={false} />
      {loading && list.length === 0 ? (
        <View style={{ paddingTop: 60, alignItems: "center" }}>
          <ActivityIndicator color={c.brand} />
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(u) => u.id}
          contentContainerStyle={{ padding: 14, paddingBottom: 60, gap: 10 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
              tintColor={c.brand}
              colors={[c.brand]}
            />
          }
          ListHeaderComponent={() => (
            <Text style={{ color: c.muted, fontSize: 13 * scale, lineHeight: 19, marginBottom: 8 }}>
              Members you've blocked. They can't see your posts or contact you. Tap Unblock to let them back in.
            </Text>
          )}
          ListEmptyComponent={() => (
            <View style={{ paddingTop: 60, alignItems: "center", paddingHorizontal: 24 }}>
              <Ionicons name="shield-checkmark-outline" size={48} color={c.muted} />
              <Text style={{ color: c.onSurface, fontWeight: "800", marginTop: 12, fontSize: 17 * scale, textAlign: "center" }}>
                No one blocked
              </Text>
              <Text style={{ color: c.muted, marginTop: 6, fontSize: 14 * scale, textAlign: "center", lineHeight: 20 }}>
                You can block any member from their profile if they're bothering you.
              </Text>
              <Pressable
                onPress={() => router.back()}
                style={{ marginTop: 20, paddingHorizontal: 22, paddingVertical: 11, borderRadius: 999, backgroundColor: c.brand }}
              >
                <Text style={{ color: "#FFF", fontWeight: "800", fontSize: 15 * scale }}>Back</Text>
              </Pressable>
            </View>
          )}
          renderItem={({ item }) => {
            const busy = unblockingId === item.id;
            return (
              <View style={[styles.row, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
                <AvatarBubble value={item.avatar} size={44} textSize={28} />
                <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 * scale }}>
                    {item.first_name}
                  </Text>
                  {item.suburb ? (
                    <Text numberOfLines={1} style={{ color: c.muted, fontSize: 13 * scale, marginTop: 2 }}>
                      {item.suburb}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  testID={`unblock-${item.id}`}
                  disabled={busy}
                  onPress={() => unblock(item)}
                  style={[styles.unblockBtn, { backgroundColor: busy ? c.surfaceTertiary : c.brand, opacity: busy ? 0.7 : 1 }]}
                >
                  {busy ? (
                    <ActivityIndicator color="#FFF" size="small" />
                  ) : (
                    <>
                      <Ionicons name="lock-open-outline" size={16} color="#FFF" />
                      <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 14 * scale, marginLeft: 6 }}>Unblock</Text>
                    </>
                  )}
                </Pressable>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  unblockBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    minHeight: 40,
    minWidth: 100,
  },
});
