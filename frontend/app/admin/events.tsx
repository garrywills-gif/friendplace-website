import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, Platform, Alert } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import { parseAvatar } from "@/src/components/AvatarBubble";

type Status = "all" | "active" | "cancelled" | "archived";

const TABS: { key: Status; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "cancelled", label: "Cancelled" },
  { key: "archived", label: "Archived" },
  { key: "all", label: "All" },
];

function prompt(message: string, def = ""): string | null {
  if (Platform.OS === "web" && typeof window !== "undefined") return window.prompt(message, def);
  return def || null;
}
function confirm(message: string): boolean {
  if (Platform.OS === "web" && typeof window !== "undefined") return window.confirm(message);
  return true;
}

export default function AdminEvents() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const { show } = useToast();
  const [status, setStatus] = useState<Status>("active");
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try { setData(await api.adminListEvents(user.id, status)); }
    catch { show("Could not load events"); }
    finally { setLoading(false); }
  }, [user?.id, status, show]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!user?.id) return <View style={{ flex: 1, backgroundColor: c.surface }}><Header title="Admin · Events" /></View>;
  if (!(user as any).is_admin) return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Admin · Events" />
      <Text style={{ padding: 24, color: c.onSurface, fontSize: 15 * scale }}>Admin only.</Text>
    </View>
  );

  const events = (data?.events as any[]) || [];
  const counts = data?.counts || { active: 0, cancelled: 0, archived: 0, total: 0 };

  const wrapBusy = async (id: string, fn: () => Promise<any>) => {
    setBusyId(id);
    try { await fn(); await load(); }
    finally { setBusyId(null); }
  };

  const onCancel = (e: any) => {
    const reason = prompt("Cancel this event? Optional reason for the host & RSVPs:", "");
    if (reason === null) return;
    wrapBusy(e.id, async () => { await api.cancelEvent(e.id, { actor_id: user.id, reason: reason || undefined }); show("Cancelled — RSVPs notified"); });
  };
  const onRestore = (e: any) => wrapBusy(e.id, async () => { await api.restoreEvent(e.id, { actor_id: user.id }); show("Event restored"); });
  const onArchive = (e: any) => {
    const reason = prompt("Archive this event? Removed from public list but kept for audit.", "");
    if (reason === null) return;
    wrapBusy(e.id, async () => { await api.adminArchiveEvent(e.id, user.id, reason || undefined); show("Archived"); });
  };
  const onUnarchive = (e: any) => wrapBusy(e.id, async () => { await api.adminUnarchiveEvent(e.id, user.id); show("Restored to public list"); });
  const onHardDelete = (e: any) => {
    if (!confirm(`PERMANENTLY delete "${e.title}"?\nThis cannot be undone.`)) return;
    const reason = prompt("Optional reason for the audit log:", "Inappropriate content");
    if (reason === null) return;
    wrapBusy(e.id, async () => {
      try { await api.adminHardDeleteEvent(e.id, user.id, reason || undefined); show("Permanently deleted"); }
      catch (err: any) { show(err?.message || "Delete failed"); }
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Admin · Events" />
      <View style={{ flexDirection: "row", gap: 6, padding: 12, flexWrap: "wrap" }}>
        {TABS.map((t) => {
          const on = status === t.key;
          const count = (counts as any)[t.key === "all" ? "total" : t.key] || 0;
          return (
            <Pressable key={t.key} testID={`tab-${t.key}`} onPress={() => setStatus(t.key)} style={[styles.tab, { backgroundColor: on ? c.brand : c.surfaceSecondary, borderColor: on ? c.brand : c.border }]}>
              <Text style={{ color: on ? "#FFF" : c.onSurface, fontWeight: "800", fontSize: 13 * scale }}>{t.label} · {count}</Text>
            </Pressable>
          );
        })}
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 14, paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        {loading ? <ActivityIndicator color={c.brand} /> : events.length === 0 ? (
          <Text style={{ color: c.muted, padding: 12, fontSize: 14 * scale }}>No events in this view.</Text>
        ) : events.map((e: any) => {
          const tint = e.cancelled ? "#DC2626" : e.archived ? "#475569" : "#16A34A";
          const tintLabel = e.cancelled ? "CANCELLED" : e.archived ? "ARCHIVED" : "ACTIVE";
          return (
            <View key={e.id} style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Text style={{ fontSize: 36 }}>{e.emoji || "🎉"}</Text>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <View style={[styles.badge, { backgroundColor: tint }]}><Text style={styles.badgeText}>{tintLabel}</Text></View>
                    <Text style={{ color: c.muted, fontSize: 11 * scale, marginLeft: "auto" }}>{e.date} · {e.time}</Text>
                  </View>
                  <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 16 * scale, marginTop: 4, textDecorationLine: e.cancelled ? "line-through" : "none" }}>{e.title}</Text>
                  <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 2 }}>📍 {e.location || "—"}</Text>
                  <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 4 }}>
                    Host: {e.host ? `${parseAvatar(e.host.avatar).base || ""} ${e.host.first_name || e.host.username}` : "—"} ·
                    {" "}👥 {e.going_count}{e.capacity != null ? `/${e.capacity}` : ""} going
                    {e.waitlist_count ? ` · 🕒 ${e.waitlist_count} waitlist` : ""}
                    {e.maybe_count ? ` · 🤔 ${e.maybe_count} maybe` : ""}
                  </Text>
                  {!!e.cancelled_reason && <Text style={{ color: "#7F1D1D", fontSize: 12 * scale, marginTop: 4, fontStyle: "italic" }}>Cancelled: {e.cancelled_reason}</Text>}
                  {!!e.archived_reason && <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 4, fontStyle: "italic" }}>Archived: {e.archived_reason}</Text>}
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <Pressable disabled={busyId === e.id} testID={`event-edit-${e.id}`} onPress={() => router.push(`/events/edit/${e.id}` as any)} style={[styles.pill, { backgroundColor: c.brand }]}>
                  <Text style={styles.pillText}>Edit</Text>
                </Pressable>
                {!e.cancelled ? (
                  <Pressable disabled={busyId === e.id} testID={`event-cancel-${e.id}`} onPress={() => onCancel(e)} style={[styles.pill, { backgroundColor: "#DC2626" }]}>
                    <Text style={styles.pillText}>Cancel</Text>
                  </Pressable>
                ) : (
                  <Pressable disabled={busyId === e.id} testID={`event-restore-${e.id}`} onPress={() => onRestore(e)} style={[styles.pill, { backgroundColor: "#16A34A" }]}>
                    <Text style={styles.pillText}>Restore</Text>
                  </Pressable>
                )}
                {!e.archived ? (
                  <Pressable disabled={busyId === e.id} testID={`event-archive-${e.id}`} onPress={() => onArchive(e)} style={[styles.pill, { backgroundColor: "#475569" }]}>
                    <Text style={styles.pillText}>Archive</Text>
                  </Pressable>
                ) : (
                  <Pressable disabled={busyId === e.id} testID={`event-unarchive-${e.id}`} onPress={() => onUnarchive(e)} style={[styles.pill, { backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border }]}>
                    <Text style={[styles.pillText, { color: c.onSurface }]}>Unarchive</Text>
                  </Pressable>
                )}
                <Pressable disabled={busyId === e.id} testID={`event-delete-${e.id}`} onPress={() => onHardDelete(e)} style={[styles.pill, { backgroundColor: "#7F1D1D" }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Ionicons name="trash" size={12} color="#FFF" />
                    <Text style={styles.pillText}>Delete</Text>
                  </View>
                </Pressable>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  tab: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5 },
  card: { padding: 12, borderRadius: 14, borderWidth: 1, marginBottom: 10 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  badgeText: { color: "#FFF", fontWeight: "900", fontSize: 10, letterSpacing: 0.4 },
  pill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  pillText: { color: "#FFF", fontWeight: "900", fontSize: 13 },
});
