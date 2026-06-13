import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";

type Req = { id: string; from_id: string; to_id: string; status: string; created_at: string; other?: { id: string; first_name: string; username: string; avatar: string; suburb: string } };

export default function FriendsInbox() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const { show } = useToast();
  const [tab, setTab] = useState<"incoming" | "outgoing">("incoming");
  const [incoming, setIncoming] = useState<Req[]>([]);
  const [outgoing, setOutgoing] = useState<Req[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    if (!user) return;
    try { const r: any = await api.friendsInbox(user.id); setIncoming(r.incoming || []); setOutgoing(r.outgoing || []); } catch {}
  };
  useFocusEffect(useCallback(() => { load(); return undefined; }, [user?.id]));

  const accept = async (r: Req) => { await api.acceptReq(r.id); show(`You and ${r.other?.first_name || "they"} are now friends 🦋`); load(); };
  const decline = async (r: Req) => { await api.declineReq(r.id); show("Request declined"); load(); };
  const cancel = async (r: Req) => { await api.cancelReq(r.id); show("Request cancelled"); load(); };

  const data = tab === "incoming" ? incoming : outgoing;

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Friend Requests" />
      <View style={styles.tabs}>
        {(["incoming", "outgoing"] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, { backgroundColor: tab === t ? c.brand : c.surfaceSecondary, borderColor: tab === t ? c.brand : c.border }]} testID={`tab-${t}`}>
            <Text style={{ color: tab === t ? "#FFFFFF" : c.onSurface, fontWeight: "800", fontSize: 15 * scale }}>
              {t === "incoming" ? `Incoming (${incoming.length})` : `Sent (${outgoing.length})`}
            </Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={data}
        keyExtractor={(r) => r.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 60 }}
        ListEmptyComponent={() => (
          <View style={{ paddingTop: 60, alignItems: "center" }}>
            <Ionicons name="happy-outline" size={48} color={c.muted} />
            <Text style={{ color: c.muted, fontWeight: "600", marginTop: 10, fontSize: 16 * scale }}>
              {tab === "incoming" ? "No new requests. Make the first move!" : "You haven't sent any requests yet."}
            </Text>
          </View>
        )}
        renderItem={({ item }) => (
          <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
            <View style={styles.cardHead}>
              <Text style={{ fontSize: 40 }}>{item.other?.avatar || "🙂"}</Text>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 18 * scale }}>{item.other?.first_name || item.other?.username || "Someone"}</Text>
                <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 2 }}>@{item.other?.username}{item.other?.suburb ? `  ·  ${item.other.suburb}` : ""}</Text>
              </View>
              {item.other?.id && (
                <Pressable onPress={() => router.push(`/user/${item.other!.id}` as any)} hitSlop={6} style={{ padding: 6 }}>
                  <Ionicons name="chevron-forward" size={22} color={c.muted} />
                </Pressable>
              )}
            </View>
            <View style={styles.cardActions}>
              {tab === "incoming" ? (
                <>
                  <Pressable testID={`accept-${item.id}`} onPress={() => accept(item)} style={[styles.btn, { backgroundColor: c.brand }]}>
                    <Ionicons name="checkmark" size={18} color="#FFF" />
                    <Text style={{ color: "#FFF", fontWeight: "800", fontSize: 15 * scale }}>Accept</Text>
                  </Pressable>
                  <Pressable testID={`decline-${item.id}`} onPress={() => decline(item)} style={[styles.btn, styles.btnOutline, { borderColor: c.border }]}>
                    <Ionicons name="close" size={18} color={c.onSurface} />
                    <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 15 * scale }}>Decline</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable testID={`cancel-${item.id}`} onPress={() => cancel(item)} style={[styles.btn, styles.btnOutline, { borderColor: c.border }]}>
                  <Ionicons name="trash-outline" size={18} color={c.onSurface} />
                  <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 15 * scale }}>Cancel request</Text>
                </Pressable>
              )}
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: "row", gap: 8, paddingHorizontal: 14, paddingVertical: 10 },
  tab: { flex: 1, paddingVertical: 12, borderRadius: 999, borderWidth: 2, alignItems: "center" },
  card: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 12 },
  cardHead: { flexDirection: "row", alignItems: "center" },
  cardActions: { flexDirection: "row", gap: 10 },
  btn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 999 },
  btnOutline: { backgroundColor: "transparent", borderWidth: 2 },
});
