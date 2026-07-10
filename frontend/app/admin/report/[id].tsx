import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";

export default function AdminReportDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const { show, confirm } = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id || !id) return;
    setLoading(true);
    try { setData(await api.adminReport(String(id), user.id)); }
    finally { setLoading(false); }
  }, [user?.id, id]);
  useEffect(() => { load(); }, [load]);

  if (!user || !(user as any).is_admin) {
    return <View style={{ flex: 1, backgroundColor: c.surface }}><Header title="Report" /><Text style={{ padding: 20, color: c.onSurface }}>Admins only.</Text></View>;
  }
  if (loading || !data) return <View style={{ flex: 1, backgroundColor: c.surface }}><Header title="Report" /><ActivityIndicator color={c.brand} style={{ marginTop: 30 }} /></View>;

  const r = data.report; const reporter = data.reporter; const tgt = data.target_user; const related = data.related; const history = data.target_history || [];

  const setStatus = async (status: string) => {
    setSubmitting("status");
    try {
      await api.adminSetReportStatus(r.id, status, { admin_id: user.id, note });
      show(`Marked ${status}`); load();
    } catch { show("Could not update status"); }
    finally { setSubmitting(null); }
  };

  const warn = async () => {
    if (!tgt) return;
    const ok = await confirm({ title: "Send warning?", message: `${tgt.first_name || tgt.username} will receive an in-app notification with this reason.`, confirmLabel: "Warn" });
    if (!ok) return;
    setSubmitting("warn");
    try { await api.adminWarn({ admin_id: user.id, user_id: tgt.id, reason: note || "Please review the community guidelines", report_id: r.id }); show("Warning sent"); load(); }
    finally { setSubmitting(null); }
  };
  const suspend = async (hours: number) => {
    if (!tgt) return;
    const ok = await confirm({ title: `Suspend for ${hours}h?`, message: `${tgt.first_name || tgt.username} will be unable to log in for ${hours} hours.`, confirmLabel: "Suspend", destructive: true });
    if (!ok) return;
    setSubmitting("suspend");
    try { await api.adminSuspend({ admin_id: user.id, user_id: tgt.id, reason: note || "Suspended by moderator", duration_hours: hours, report_id: r.id }); show("User suspended"); load(); }
    finally { setSubmitting(null); }
  };
  const ban = async () => {
    if (!tgt) return;
    const ok = await confirm({ title: "Ban user?", message: `${tgt.first_name || tgt.username} will lose access to FriendPlace. This is reversible from the user's profile.`, confirmLabel: "Ban", destructive: true });
    if (!ok) return;
    setSubmitting("ban");
    try { await api.adminBan({ admin_id: user.id, user_id: tgt.id, reason: note || "Banned by moderator", report_id: r.id }); show("User banned"); load(); }
    finally { setSubmitting(null); }
  };
  const restore = async () => {
    if (!tgt) return;
    const ok = await confirm({ title: "Restore access?", message: `${tgt.first_name || tgt.username} will regain full access.`, confirmLabel: "Restore" });
    if (!ok) return;
    setSubmitting("restore");
    try { await api.adminRestore({ admin_id: user.id, user_id: tgt.id }); show("User restored"); load(); }
    finally { setSubmitting(null); }
  };
  const removeContent = async () => {
    if (!r.target_id || !(r.target_type === "notice" || r.target_type === "message" || r.target_type === "dm")) return;
    const ok = await confirm({ title: "Remove this content?", message: "It will be hidden from public view and marked as removed by a moderator.", confirmLabel: "Remove", destructive: true });
    if (!ok) return;
    setSubmitting("remove");
    try { await api.adminRemoveContent({ admin_id: user.id, target_type: r.target_type, target_id: r.target_id, reason: note, report_id: r.id }); show("Content removed"); load(); }
    finally { setSubmitting(null); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Report" />
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 80, gap: 12 }}>
        {/* Status + urgency */}
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          {r.urgent && <View style={[styles.badge, { backgroundColor: "#DC2626" }]}><Text style={styles.badgeText}>URGENT</Text></View>}
          <View style={[styles.badge, { backgroundColor: c.brand }]}><Text style={styles.badgeText}>{(r.status || "new").toUpperCase()}</Text></View>
          <Text style={{ color: c.muted, fontSize: 12 * scale, marginLeft: "auto" }}>{shortDate(r.created_at)}</Text>
        </View>

        {/* Reported user card */}
        <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <Text style={{ color: c.muted, fontSize: 12 * scale, fontWeight: "800", letterSpacing: 0.4 }}>REPORTED USER</Text>
          {tgt ? <>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 20 * scale, marginTop: 4 }}>{tgt.first_name || tgt.username}</Text>
            <Text style={{ color: c.muted, fontSize: 13 * scale }}>@{tgt.username} {tgt.is_admin ? "\u2022 Admin" : ""}</Text>
            <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 4 }}>Status: <Text style={{ color: tgt.banned ? "#DC2626" : tgt.restricted ? "#B45309" : c.onSurface, fontWeight: "800" }}>{tgt.banned ? "Banned" : tgt.restricted ? "Restricted" : "Active"}</Text></Text>
            {!!tgt.restricted_reason && <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 2, fontStyle: "italic" }}>{tgt.restricted_reason}</Text>}
            {history.length > 0 && (
              <Pressable
                testID="report-history-open"
                onPress={() => router.push(`/admin/user/${tgt.id}` as any)}
                hitSlop={6}
                accessibilityRole="link"
                accessibilityLabel={`View ${history.length} other report${history.length === 1 ? "" : "s"} for this user`}
              >
                <Text style={{ color: "#B45309", fontWeight: "800", fontSize: 12 * scale, marginTop: 4, textDecorationLine: "underline" }}>
                  {"\u26A0\uFE0F"} {history.length} other report{history.length === 1 ? "" : "s"} on file — view history
                </Text>
              </Pressable>
            )}
          </> : <Text style={{ color: c.muted, fontSize: 14 * scale }}>Unknown / not specified</Text>}
        </View>

        {/* Report details */}
        <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <Text style={{ color: c.muted, fontSize: 12 * scale, fontWeight: "800", letterSpacing: 0.4 }}>REASON</Text>
          <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 18 * scale, marginTop: 4 }}>{r.reason}</Text>
          {!!r.notes && <Text style={{ color: c.onSurface, fontSize: 14 * scale, marginTop: 6 }}>{r.notes}</Text>}
          <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 8 }}>Reported by <Text style={{ fontWeight: "700" }}>{reporter?.first_name || reporter?.username || "Unknown"}</Text></Text>
        </View>

        {/* Related content */}
        {related && (
          <View style={[styles.card, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
            <Text style={{ color: c.brand, fontSize: 12 * scale, fontWeight: "800", letterSpacing: 0.4 }}>RELATED {(r.target_type || "").toUpperCase()}</Text>
            {r.target_type === "notice" ? <>
              <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 17 * scale, marginTop: 4 }}>{related.title}</Text>
              <Text style={{ color: c.onSurface, fontSize: 14 * scale, marginTop: 4 }}>{related.body}</Text>
              {related.removed && <Text style={{ color: "#DC2626", fontWeight: "800", fontSize: 12 * scale, marginTop: 4 }}>Already removed</Text>}
            </> : <Text style={{ color: c.onSurface, fontSize: 15 * scale }}>{related.text}</Text>}
          </View>
        )}

        {/* Admin note */}
        <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <Text style={{ color: c.muted, fontSize: 12 * scale, fontWeight: "800", letterSpacing: 0.4 }}>ADMIN NOTE (optional)</Text>
          <TextInput value={note} onChangeText={setNote} placeholder="Why are you taking this action?" placeholderTextColor={c.muted} multiline style={{ color: c.onSurface, fontSize: 15 * scale, marginTop: 6, minHeight: 60 }} />
        </View>

        {/* Actions */}
        <Text style={[styles.section, { color: c.onSurface, fontSize: 16 * scale, marginTop: 8 }]}>Status</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <ActBtn label="Mark reviewing" onPress={() => setStatus("reviewing")} disabled={submitting !== null} c={c} scale={scale} tint="#2563EB" />
          <ActBtn label="Dismiss" onPress={() => setStatus("dismissed")} disabled={submitting !== null} c={c} scale={scale} tint="#475569" />
          <ActBtn label="Mark resolved" onPress={() => setStatus("resolved")} disabled={submitting !== null} c={c} scale={scale} tint="#0F766E" />
        </View>

        <Text style={[styles.section, { color: c.onSurface, fontSize: 16 * scale, marginTop: 14 }]}>User actions</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <ActBtn label="Warn user" onPress={warn} disabled={!tgt || submitting !== null} c={c} scale={scale} tint="#B45309" />
          <ActBtn label="Suspend 24h" onPress={() => suspend(24)} disabled={!tgt || submitting !== null} c={c} scale={scale} tint="#DC2626" />
          <ActBtn label="Suspend 7 days" onPress={() => suspend(24 * 7)} disabled={!tgt || submitting !== null} c={c} scale={scale} tint="#DC2626" />
          <ActBtn label="Ban user" onPress={ban} disabled={!tgt || submitting !== null} c={c} scale={scale} tint="#7F1D1D" />
          {tgt && (tgt.restricted || tgt.banned) && <ActBtn label="Restore access" onPress={restore} disabled={submitting !== null} c={c} scale={scale} tint="#0F766E" />}
        </View>

        {r.target_id && (r.target_type === "notice" || r.target_type === "message" || r.target_type === "dm") && (
          <>
            <Text style={[styles.section, { color: c.onSurface, fontSize: 16 * scale, marginTop: 14 }]}>Content actions</Text>
            <ActBtn label={`Remove ${r.target_type}`} onPress={removeContent} disabled={submitting !== null} c={c} scale={scale} tint="#7C3AED" />
          </>
        )}
      </ScrollView>
    </View>
  );
}

function ActBtn({ label, onPress, disabled, c, scale, tint }: any) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={{ paddingHorizontal: 14, paddingVertical: 12, borderRadius: 999, backgroundColor: disabled ? c.surfaceTertiary : tint, opacity: disabled ? 0.55 : 1 }}>
      <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 14 * scale }}>{label}</Text>
    </Pressable>
  );
}

function shortDate(iso: string) {
  try { const d = new Date(iso); return d.toLocaleString(); } catch { return iso; }
}

const styles = StyleSheet.create({
  card: { padding: 14, borderRadius: 16, borderWidth: 1 },
  section: { fontWeight: "900" },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  badgeText: { color: "#FFF", fontWeight: "900", fontSize: 10, letterSpacing: 0.4 },
});
