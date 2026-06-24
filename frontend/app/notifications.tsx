import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";

const ICON: Record<string, { name: keyof typeof Ionicons.glyphMap; tint: string }> = {
  friend_request: { name: "person-add", tint: "#2E9EE2" },
  friend_accepted: { name: "people", tint: "#16A34A" },
  dm: { name: "chatbubble", tint: "#1E3A7F" },
  event_invite: { name: "calendar", tint: "#B45309" },
  table_join: { name: "cafe", tint: "#0F766E" },
  notice_comment: { name: "newspaper", tint: "#7C3AED" },
  flutter: { name: "sparkles", tint: "#DB2777" },
  achievement: { name: "trophy", tint: "#B45309" },
  cheer: { name: "heart", tint: "#DB2777" },
};

const CHEER_OPTIONS: { kind: "well_done" | "congrats" | "coffee" | "flutter"; emoji: string; label: string }[] = [
  { kind: "well_done", emoji: "👏", label: "Well Done" },
  { kind: "congrats",  emoji: "🎉", label: "Congratulations" },
  { kind: "coffee",    emoji: "☕", label: "Join me in the Coffee Lounge" },
  { kind: "flutter",   emoji: "🦋", label: "Flutter Sent" },
];

function relTime(iso?: string) {
  if (!iso) return "";
  try {
    const d = new Date(iso); const diff = Math.max(0, (Date.now() - d.getTime()) / 1000);
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
    if (diff < 86400 * 7) return `${Math.round(diff / 86400)}d ago`;
    return d.toLocaleDateString();
  } catch { return ""; }
}

export default function Notifications() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const { show } = useToast();
  const [list, setList] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => { if (!user) return; try { setList(await api.notifications(user.id)); } catch {} };

  useFocusEffect(useCallback(() => { load(); return undefined; }, [user?.id]));

  const onItemPress = async (n: any) => {
    try { if (!n.read) { await api.readNotification(n.id); load(); } } catch {}
    if (n.type === "friend_request" || n.type === "friend_accepted") return router.push("/friends/inbox");
    if (n.type === "dm" && n.payload?.dm_id) return router.push(`/dm/${n.payload.dm_id}?other_id=${n.payload.from_id || ""}`);
    if (n.type === "table_join" && n.payload?.table_id) return router.push(`/table/${n.payload.table_id}`);
    if (n.type === "flutter") return router.push("/home");
    if (n.type === "event_invite") return router.push("/events");
    if (n.type === "notice_comment") return router.push("/notices");
    if (n.type === "recipe_comment" && n.ref_id) return router.push(`/recipes/${n.ref_id}` as any);
  };

  const dismissOne = async (n: any) => {
    try {
      if (!n.read) await api.readNotification(n.id);
      // Optimistic: mark as read locally; user can refresh to fully clear.
      setList((xs) => xs.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    } catch {}
  };

  const markAll = async () => { if (!user) return; await api.readAllNotifications(user.id); load(); show("Marked all as read"); };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Notifications" emoji="🔔" subtitle="Recent activity" />
      <View style={[styles.toolbar, { borderColor: c.border }]}>
        <Text style={{ color: c.muted, fontSize: 14 * scale, fontWeight: "700" }}>{list.filter((n) => !n.read).length} unread</Text>
        <Pressable testID="mark-all-read" onPress={markAll} hitSlop={6}>
          <Text style={{ color: c.brandSecondary, fontWeight: "800", fontSize: 15 * scale }}>Mark all as read</Text>
        </Pressable>
      </View>
      <FlatList
        data={list}
        keyExtractor={(n) => n.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        contentContainerStyle={{ padding: 14, paddingBottom: 60 }}
        ListEmptyComponent={() => (
          <View style={{ paddingTop: 60, alignItems: "center" }}>
            <Ionicons name="notifications-outline" size={48} color={c.muted} />
            <Text style={{ color: c.muted, fontWeight: "600", marginTop: 10, fontSize: 16 * scale }}>You're all caught up.</Text>
          </View>
        )}
        renderItem={({ item }) => {
          const ic = ICON[item.type] || { name: "notifications", tint: c.brand };
          const isAchievement = item.type === "achievement" && item.payload?.actor_id;
          const isDm = item.type === "dm";
          return (
            <View>
              <Pressable testID={`notif-${item.id}`} onPress={() => onItemPress(item)} style={[styles.row, { backgroundColor: item.read ? c.surfaceSecondary : c.brandTertiary, borderColor: item.read ? c.border : c.brand }]}>
                <View style={[styles.iconBox, { backgroundColor: "#FFFFFF" }]}><Ionicons name={ic.name} size={20} color={ic.tint} /></View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 * scale }}>{item.title}</Text>
                  {!!item.body && <Text style={{ color: c.muted, marginTop: 2, fontSize: 14 * scale }} numberOfLines={isDm ? 3 : 2}>{isDm ? `“${item.body}”` : item.body}</Text>}
                  <Text style={{ color: c.muted, marginTop: 4, fontSize: 12 * scale }}>{relTime(item.created_at)}</Text>
                </View>
                {!item.read && <View style={[styles.dot, { backgroundColor: c.brandSecondary }]} />}
              </Pressable>

              {/* Message preview actions — only for direct messages. Chat opens the
                  conversation; Dismiss marks the notification as read in place. */}
              {isDm && (
                <View style={[styles.cheerRow, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
                  <Pressable
                    testID={`dm-chat-${item.id}`}
                    onPress={() => onItemPress(item)}
                    style={[styles.dmActionBtn, { backgroundColor: c.brand, borderColor: c.brand, flex: 1 }]}
                  >
                    <Ionicons name="chatbubble" size={18} color="#FFF" />
                    <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 14 * scale, marginLeft: 6 }}>Chat</Text>
                  </Pressable>
                  <Pressable
                    testID={`dm-dismiss-${item.id}`}
                    onPress={() => dismissOne(item)}
                    style={[styles.dmActionBtn, { backgroundColor: c.surface, borderColor: c.border, flex: 1 }]}
                  >
                    <Ionicons name="close-circle" size={18} color={c.muted} />
                    <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 14 * scale, marginLeft: 6 }}>Dismiss</Text>
                  </Pressable>
                </View>
              )}

              {isAchievement && user && (
                <View style={[styles.cheerRow, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
                  {CHEER_OPTIONS.map((opt) => (
                    <Pressable
                      key={opt.kind}
                      testID={`cheer-${opt.kind}-${item.id}`}
                      onPress={async () => {
                        try {
                          await api.gameCheer(user.id, item.payload.actor_id, opt.kind);
                          show(`${opt.emoji} ${opt.label}`);
                        } catch {
                          show("Could not send cheer");
                        }
                      }}
                      style={[styles.cheerBtn, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}
                    >
                      <Text style={{ fontSize: 20 }}>{opt.emoji}</Text>
                      <Text style={{ color: c.brand, fontWeight: "800", fontSize: 12 * scale, textAlign: "center", marginTop: 2 }} numberOfLines={2}>{opt.label}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: 1 },
  row: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 16, borderWidth: 1 },
  iconBox: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  dot: { width: 10, height: 10, borderRadius: 5, marginLeft: 8 },
  cheerRow: { flexDirection: "row", gap: 6, padding: 8, borderTopWidth: 0, borderWidth: 1, borderRadius: 16, marginTop: -8, marginHorizontal: 4, marginBottom: 4 },
  cheerBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 10, paddingHorizontal: 4, borderRadius: 14, borderWidth: 1, minHeight: 64 },
  dmActionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 12, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5 },
});
