import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, RefreshControl, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";

const ACTION_TINT: Record<string, string> = {
  warn: "#F59E0B",
  suspend: "#DC2626",
  ban: "#7F1D1D",
  restore: "#16A34A",
  content_removed: "#475569",
  auto_hide: "#B45309",
  auto_restrict: "#DC2626",
  note: "#2563EB",
};

const ACTION_LABEL: Record<string, string> = {
  warn: "Warning",
  suspend: "Suspended",
  ban: "Banned",
  restore: "Restored",
  content_removed: "Content removed",
  auto_hide: "Profile auto-hidden",
  auto_restrict: "Auto-restricted",
  note: "Admin note",
};

function shortDate(iso?: string) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) + " · " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

export default function AdminUserReview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const { show } = useToast();
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id || !id) return;
    setLoading(true);
    try {
      const d: any = await api.adminUserModeration(String(id), user.id);
      setData(d);
    } catch (e: any) {
      show("Failed to load moderation record");
    } finally { setLoading(false); }
  }, [user?.id, id, show]);

  React.useEffect(() => { load(); }, [load]);

  if (!user?.id) return <View style={{ flex: 1, backgroundColor: c.surface }}><Header title="Moderation" /></View>;
  if (!(user as any).is_admin) return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Moderation" />
      <Text style={{ padding: 24, color: c.onSurface }}>Admin only.</Text>
    </View>
  );

  const u = data?.user || {};
  const reports = data?.reports || [];
  const log = data?.moderation_log || [];
  const counts = data?.counts || { reports_total: 0, reports_open: 0, actions_total: 0 };

  const status = u.banned ? "BANNED" : u.restricted ? "RESTRICTED" : u.profile_hidden ? "PROFILE HIDDEN" : u.flagged_for_review ? "FLAGGED" : "ACTIVE";
  const statusTint = u.banned ? "#7F1D1D" : u.restricted ? "#DC2626" : u.profile_hidden ? "#B45309" : u.flagged_for_review ? "#F59E0B" : "#16A34A";

  const confirmAction = (label: string, fn: () => Promise<void>) => {
    if (typeof window !== "undefined" && window.confirm) {
      if (window.confirm(`${label}\nProceed?`)) fn();
      return;
    }
    Alert.alert(label, "Proceed?", [
      { text: "Cancel", style: "cancel" },
      { text: "Confirm", style: "destructive", onPress: fn },
    ]);
  };

  const doWarn = async () => {
    const reason = noteDraft.trim() || "Please review our community guidelines.";
    confirmAction(`Send warning to @${u.username}`, async () => {
      setBusyAction("warn");
      try {
        await api.adminWarn({ admin_id: user.id, user_id: u.id, reason });
        setNoteDraft("");
        show("Warning sent");
        await load();
      } finally { setBusyAction(null); }
    });
  };
  const doSuspend = async (hours: number) => {
    const reason = noteDraft.trim() || `Suspended for ${hours}h pending review`;
    confirmAction(`Suspend @${u.username} for ${hours}h`, async () => {
      setBusyAction("suspend");
      try {
        await api.adminSuspend({ admin_id: user.id, user_id: u.id, reason, duration_hours: hours });
        setNoteDraft("");
        show(`Suspended ${hours}h`);
        await load();
      } finally { setBusyAction(null); }
    });
  };
  const doBan = async () => {
    const reason = noteDraft.trim() || "Banned for serious policy violations";
    confirmAction(`Ban @${u.username} permanently`, async () => {
      setBusyAction("ban");
      try {
        await api.adminBan({ admin_id: user.id, user_id: u.id, reason });
        setNoteDraft("");
        show("User banned");
        await load();
      } finally { setBusyAction(null); }
    });
  };
  const doRestore = async () => {
    confirmAction(`Restore @${u.username}`, async () => {
      setBusyAction("restore");
      try {
        await api.adminRestore({ admin_id: user.id, user_id: u.id });
        show("User restored");
        await load();
      } finally { setBusyAction(null); }
    });
  };
  const doAddNote = async () => {
    const note = noteDraft.trim();
    if (!note) return;
    setSavingNote(true);
    try {
      await api.adminAddUserNote(u.id, { admin_id: user.id, note });
      setNoteDraft("");
      show("Note added");
      await load();
    } catch { show("Failed to save note"); }
    finally { setSavingNote(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Moderation review" />
      <ScrollView
        contentContainerStyle={{ padding: 14, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        {loading ? <ActivityIndicator color={c.brand} /> : (
          <>
            {/* Header card */}
            <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
              <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                <Text style={{ fontSize: 38 }}>{u.avatar || "👤"}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 18 * scale }}>{u.first_name || "—"} <Text style={{ color: c.muted, fontWeight: "600" }}>@{u.username}</Text></Text>
                  <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 2 }}>{u.suburb || "Suburb hidden"} · joined {shortDate(u.created_at)}</Text>
                </View>
                <View style={[styles.badge, { backgroundColor: statusTint }]}>
                  <Text style={styles.badgeText}>{status}</Text>
                </View>
              </View>
              {!!(u.profile_hidden_reason || u.restricted_reason) && (
                <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 10, fontStyle: "italic" }}>{u.profile_hidden_reason || u.restricted_reason}</Text>
              )}
              {!!u.suspended_until && (
                <Text style={{ color: "#DC2626", fontSize: 12 * scale, marginTop: 6, fontWeight: "700" }}>Suspended until {shortDate(u.suspended_until)}</Text>
              )}
              <View style={{ flexDirection: "row", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                <Stat label="Reports" value={counts.reports_total} c={c} scale={scale} />
                <Stat label="Open" value={counts.reports_open} c={c} scale={scale} />
                <Stat label="Actions" value={counts.actions_total} c={c} scale={scale} />
              </View>
              <Pressable onPress={() => router.push(`/user/${u.id}` as any)} style={[styles.linkBtn, { borderColor: c.border }]}>
                <Ionicons name="person-circle-outline" size={16} color={c.brand} />
                <Text style={{ color: c.brand, fontWeight: "800", fontSize: 13 * scale, marginLeft: 6 }}>View public profile</Text>
              </Pressable>
            </View>

            {/* Note / reason input — drives the action buttons */}
            <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border, marginTop: 12 }]}>
              <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 14 * scale, marginBottom: 6 }}>Admin reason / note</Text>
              <TextInput
                testID="admin-note-input"
                value={noteDraft}
                onChangeText={setNoteDraft}
                multiline
                placeholder="Why are you taking this action? (used as the reason for warn/suspend/ban, or as a free-form note)"
                placeholderTextColor={c.muted}
                style={{
                  color: c.onSurface,
                  borderColor: c.border,
                  borderWidth: 1.5,
                  borderRadius: 12,
                  padding: 10,
                  minHeight: 80,
                  textAlignVertical: "top",
                  fontSize: 14 * scale,
                  backgroundColor: c.surfaceTertiary,
                }}
              />
              <View style={{ flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <Pressable testID="admin-add-note" onPress={doAddNote} disabled={savingNote || !noteDraft.trim()} style={[styles.pill, { backgroundColor: c.brand, opacity: !noteDraft.trim() ? 0.5 : 1 }]}>
                  {savingNote ? <ActivityIndicator color="#FFF" /> : <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 13 * scale }}>Add note</Text>}
                </Pressable>
                <Pressable testID="admin-warn" onPress={doWarn} disabled={!!busyAction} style={[styles.pill, { backgroundColor: "#F59E0B" }]}>
                  <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 13 * scale }}>Warn</Text>
                </Pressable>
                <Pressable onPress={() => doSuspend(24)} disabled={!!busyAction} style={[styles.pill, { backgroundColor: "#DC2626" }]}>
                  <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 13 * scale }}>Suspend 24h</Text>
                </Pressable>
                <Pressable onPress={() => doSuspend(72)} disabled={!!busyAction} style={[styles.pill, { backgroundColor: "#DC2626" }]}>
                  <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 13 * scale }}>Suspend 72h</Text>
                </Pressable>
                <Pressable testID="admin-ban" onPress={doBan} disabled={!!busyAction || u.banned} style={[styles.pill, { backgroundColor: "#7F1D1D", opacity: u.banned ? 0.5 : 1 }]}>
                  <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 13 * scale }}>Ban</Text>
                </Pressable>
                {(() => {
                  const needsRestore = !!(u.restricted || u.banned || u.profile_hidden);
                  return (
                    <Pressable testID="admin-restore" onPress={doRestore} disabled={!!busyAction || !needsRestore} style={[styles.pill, { backgroundColor: "#16A34A", opacity: needsRestore ? 1 : 0.4 }]}>
                      <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 13 * scale }}>Restore</Text>
                    </Pressable>
                  );
                })()}
              </View>
            </View>

            {/* Report history */}
            <Text style={[styles.section, { color: c.onSurface, fontSize: 16 * scale, marginTop: 18 }]}>Report history ({reports.length})</Text>
            {reports.length === 0 ? (
              <Text style={{ color: c.muted, padding: 10, fontSize: 14 * scale }}>No reports filed against this user.</Text>
            ) : (
              <View style={{ gap: 8 }}>
                {reports.map((r: any) => (
                  <Pressable key={r.id} onPress={() => router.push(`/admin/report/${r.id}` as any)} style={[styles.row, { backgroundColor: c.surfaceSecondary, borderColor: r.urgent ? "#DC2626" : c.border, borderWidth: r.urgent ? 2 : 1 }]}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      {r.urgent && <View style={[styles.badge, { backgroundColor: "#DC2626" }]}><Text style={styles.badgeText}>URGENT</Text></View>}
                      <View style={[styles.badge, { backgroundColor: r.status === "resolved" ? "#0F766E" : r.status === "dismissed" ? "#475569" : "#B45309" }]}>
                        <Text style={styles.badgeText}>{(r.status || "new").toUpperCase()}</Text>
                      </View>
                      <Text style={{ color: c.muted, fontSize: 11 * scale, marginLeft: "auto" }}>{shortDate(r.created_at)}</Text>
                    </View>
                    <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 14 * scale, marginTop: 4 }}>{r.reason}</Text>
                    {!!r.admin_note && <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 2, fontStyle: "italic" }}>Admin: {r.admin_note}</Text>}
                  </Pressable>
                ))}
              </View>
            )}

            {/* Moderation history (admin actions + notes) */}
            <Text style={[styles.section, { color: c.onSurface, fontSize: 16 * scale, marginTop: 18 }]}>Moderation history ({log.length})</Text>
            {log.length === 0 ? (
              <Text style={{ color: c.muted, padding: 10, fontSize: 14 * scale }}>No moderation actions yet.</Text>
            ) : (
              <View style={{ gap: 8 }}>
                {log.map((e: any) => (
                  <View key={e.id} style={[styles.row, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <View style={[styles.badge, { backgroundColor: ACTION_TINT[e.action] || c.muted }]}>
                        <Text style={styles.badgeText}>{(ACTION_LABEL[e.action] || e.action).toUpperCase()}</Text>
                      </View>
                      <Text style={{ color: c.muted, fontSize: 11 * scale, marginLeft: "auto" }}>{shortDate(e.created_at)}</Text>
                    </View>
                    {!!e.reason && <Text style={{ color: c.onSurface, fontSize: 13 * scale, marginTop: 6 }}>{e.reason}</Text>}
                    <Text style={{ color: c.muted, fontSize: 11 * scale, marginTop: 6 }}>by {e.by === "system" ? "system (auto-policy)" : (e.by_user?.first_name || e.by_user?.username || e.by)}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Stat({ label, value, c, scale }: any) {
  return (
    <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: c.surfaceTertiary }}>
      <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 13 * scale }}>{value} <Text style={{ color: c.muted, fontWeight: "600" }}>{label}</Text></Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, borderRadius: 14, borderWidth: 1 },
  section: { fontWeight: "900", marginBottom: 8 },
  row: { padding: 12, borderRadius: 12 },
  pill: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999 },
  linkBtn: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, alignSelf: "flex-start", marginTop: 12 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  badgeText: { color: "#FFF", fontWeight: "900", fontSize: 10, letterSpacing: 0.4 },
});
