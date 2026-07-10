import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import AvatarBubble from "@/src/components/AvatarBubble";

type Summary = { reports: { new: number; reviewing: number; urgent: number; resolved: number }; support: { open: number; resolved: number }; users: { total: number; flagged?: number; auto_hidden?: number; restricted: number; banned: number }; policy?: { flag_threshold: number; restrict_threshold: number; window_days: number; auto_ban: boolean } };

export default function AdminHome() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);
  const [repeats, setRepeats] = useState<any[]>([]);
  const [tab, setTab] = useState<"reports" | "tickets" | "repeats">("reports");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const [s, r, t, ro]: any = await Promise.all([
        api.adminSummary(user.id).catch(() => null),
        api.adminReports(user.id, statusFilter).catch(() => ({ reports: [] })),
        api.adminTickets(user.id, "open").catch(() => ({ tickets: [] })),
        api.adminRepeatOffenders(user.id, 2, 30).catch(() => ({ users: [] })),
      ]);
      setSummary(s);
      setReports(r?.reports || []);
      setTickets(t?.tickets || []);
      setRepeats(ro?.users || []);
    } finally { setLoading(false); }
  }, [user?.id, statusFilter]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Hide for non-admins
  if (!user) return <View style={{ flex: 1, backgroundColor: c.surface }}><Header title="Admin" /><Text style={{ padding: 16, color: c.onSurface }}>Please log in.</Text></View>;
  if (!(user as any).is_admin) return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Admin" />
      <View style={{ padding: 24, alignItems: "center" }}>
        <Ionicons name="lock-closed" size={48} color={c.muted} />
        <Text style={{ color: c.onSurface, fontSize: 18 * scale, marginTop: 12, textAlign: "center" }}>Admin tools are only available to FriendPlace moderators.</Text>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Admin" emoji="🛡️" subtitle="Moderation · Reports · Tickets" />
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 60 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        {loading && !summary ? <ActivityIndicator color={c.brand} /> : null}

        {/* Quick-link row — shortcut to the user-suggested group queue
            so reviewing pending submissions doesn't get buried inside
            the reports/tickets tabs. */}
        <Pressable
          testID="admin-pending-groups-link"
          onPress={() => router.push("/admin/pending-groups" as any)}
          style={({ pressed }) => [{
            backgroundColor: c.brandTertiary,
            borderColor: c.brand,
            borderWidth: 1.5,
            borderRadius: 16,
            padding: 14,
            marginBottom: 14,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            opacity: pressed ? 0.85 : 1,
          }]}
        >
          <Text style={{ fontSize: 26 }}>🌟</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.brand, fontWeight: "900", fontSize: 16 * scale }}>Pending Group Suggestions</Text>
            <Text style={{ color: c.onSurface, fontSize: 13 * scale, marginTop: 2 }}>Review user-submitted community groups</Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color={c.brand} />
        </Pressable>

        {/* Summary tiles */}
        {summary && (
          <View>
            <Text style={[styles.section, { color: c.onSurface, fontSize: 18 * scale }]}>Moderation overview</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <Tile label="Urgent" value={summary.reports.urgent} icon="warning" tint="#DC2626" c={c} scale={scale} />
              <Tile label="New reports" value={summary.reports.new} icon="flag" tint="#B45309" c={c} scale={scale} />
              <Tile label="Reviewing" value={summary.reports.reviewing} icon="eye" tint="#2563EB" c={c} scale={scale} />
              <Tile label="Flagged" value={summary.users.flagged || 0} icon="alert-circle" tint="#F59E0B" c={c} scale={scale} />
              <Tile label="Auto-hidden" value={summary.users.auto_hidden || 0} icon="eye-off" tint="#B45309" c={c} scale={scale} />
              <Tile label="Restricted" value={summary.users.restricted} icon="hand-left" tint="#DC2626" c={c} scale={scale} />
              <Tile label="Resolved" value={summary.reports.resolved} icon="checkmark-done" tint="#0F766E" c={c} scale={scale} />
              <Tile label="Support open" value={summary.support.open} icon="help-buoy" tint="#7C3AED" c={c} scale={scale} />
            </View>
            {summary.policy && (
              <View style={[styles.policyCard, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
                <Text style={{ color: c.brand, fontWeight: "900", fontSize: 11 * scale, letterSpacing: 0.6 }}>POLICY</Text>
                <Text style={{ color: c.onSurface, fontSize: 13 * scale, marginTop: 4, lineHeight: 18 }}>
                  1 report → in queue · <Text style={{ fontWeight: "900" }}>{summary.policy.flag_threshold} unique</Text> in {summary.policy.window_days} days → flagged for review · <Text style={{ fontWeight: "900" }}>{summary.policy.restrict_threshold} unique</Text> → temporary restriction. Accounts are <Text style={{ fontWeight: "900" }}>never auto-banned</Text>.
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Quick links */}
        <View style={{ flexDirection: "row", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <Pressable testID="admin-manage-events" onPress={() => router.push("/admin/events" as any)} style={[styles.quickLink, { backgroundColor: c.brand }]}>
            <Ionicons name="calendar" size={16} color="#FFF" />
            <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 13 * scale, marginLeft: 6 }}>Manage events</Text>
          </Pressable>
          <Pressable testID="admin-invite-flyer" onPress={() => router.push("/admin/flyer" as any)} style={[styles.quickLink, { backgroundColor: "#7C3AED" }]}>
            <Ionicons name="print" size={16} color="#FFF" />
            <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 13 * scale, marginLeft: 6 }}>Invite flyer</Text>
          </Pressable>
          <Pressable testID="admin-manage-mods" onPress={() => router.push("/admin/promote" as any)} style={[styles.quickLink, { backgroundColor: c.brand }]}>
            <Ionicons name="shield-checkmark" size={16} color="#FFF" />
            <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 13 * scale, marginLeft: 6 }}>Moderators</Text>
          </Pressable>
        </View>

        {/* Tabs */}
        <View style={{ flexDirection: "row", marginTop: 18, gap: 8, flexWrap: "wrap" }}>
          <TabBtn label={`Reports${summary?.reports.urgent ? " ⚠️" : ""}`} active={tab === "reports"} onPress={() => setTab("reports")} c={c} scale={scale} />
          <TabBtn label={`Repeat (${repeats.length})`} active={tab === "repeats"} onPress={() => setTab("repeats")} c={c} scale={scale} />
          <TabBtn label={`Support (${summary?.support.open || 0})`} active={tab === "tickets"} onPress={() => setTab("tickets")} c={c} scale={scale} />
        </View>

        {tab === "reports" && (
          <View style={{ marginTop: 12 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 6 }}>
              {["all", "new", "reviewing", "resolved", "dismissed"].map((s) => (
                <Pressable key={s} onPress={() => setStatusFilter(s)} style={[styles.filterChip, { backgroundColor: statusFilter === s ? c.brand : c.surfaceSecondary, borderColor: statusFilter === s ? c.brand : c.border }]}>
                  <Text style={{ color: statusFilter === s ? "#FFF" : c.onSurface, fontWeight: "800", fontSize: 13 * scale }}>{s.charAt(0).toUpperCase() + s.slice(1)}</Text>
                </Pressable>
              ))}
            </ScrollView>

            {reports.length === 0 ? (
              <Text style={{ color: c.muted, fontSize: 15 * scale, padding: 24, textAlign: "center" }}>No reports here. {"\u{1F389}"}</Text>
            ) : (
              <View style={{ gap: 10, marginTop: 6 }}>
                {reports.map((r) => (
                  <Pressable key={r.id} testID={`admin-report-${r.id}`} onPress={() => router.push(`/admin/report/${r.id}`)} style={[styles.row, { backgroundColor: c.surfaceSecondary, borderColor: r.urgent ? "#DC2626" : c.border, borderWidth: r.urgent ? 2 : 1 }]}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      {r.urgent && <View style={[styles.badge, { backgroundColor: "#DC2626" }]}><Text style={styles.badgeText}>URGENT</Text></View>}
                      <View style={[styles.badge, { backgroundColor: STATUS_TINT[r.status] || c.muted }]}><Text style={styles.badgeText}>{(r.status || "new").toUpperCase()}</Text></View>
                      <Text style={{ color: c.muted, fontSize: 11 * scale, marginLeft: "auto" }}>{shortDate(r.created_at)}</Text>
                    </View>
                    <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 16 * scale, marginTop: 6 }}>{r.reason}</Text>
                    <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 2 }}>
                      <Text style={{ fontWeight: "700" }}>{r.target_user?.username || "\u2014"}</Text>
                      {" "}reported by{" "}
                      <Text style={{ fontWeight: "700" }}>{r.reporter?.username || "\u2014"}</Text>
                    </Text>
                    {!!r.related_text && <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 4, fontStyle: "italic" }} numberOfLines={2}>&ldquo;{r.related_text}&rdquo;</Text>}
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}

        {tab === "repeats" && (
          <View style={{ marginTop: 12, gap: 10 }}>
            {repeats.length === 0 ? (
              <Text style={{ color: c.muted, fontSize: 15 * scale, padding: 24, textAlign: "center" }}>No repeat-reported users in the last 30 days. 🎉</Text>
            ) : repeats.map((u: any) => {
              const status = u.banned ? "BANNED" : u.restricted ? "RESTRICTED" : u.flagged_for_review ? "FLAGGED" : "WATCHING";
              const tint = u.banned ? "#7F1D1D" : u.restricted ? "#DC2626" : u.flagged_for_review ? "#F59E0B" : "#2563EB";
              return (
                <View key={u.user_id} style={[styles.row, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <AvatarBubble value={u.avatar} size={24} fallback="👤" />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 15 * scale }}>{u.first_name || "—"} <Text style={{ color: c.muted, fontWeight: "600" }}>@{u.username}</Text></Text>
                      <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 2 }}>{u.unique_reporters} unique reporters · {u.total_reports} reports · last {shortDate(u.last_reported_at)}</Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: tint }]}><Text style={styles.badgeText}>{status}</Text></View>
                  </View>
                  {!!(u.reasons || []).length && (
                    <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 6, fontStyle: "italic" }} numberOfLines={2}>Reasons: {(u.reasons || []).join(" · ")}</Text>
                  )}
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    <Pressable testID={`admin-review-${u.user_id}`} onPress={() => router.push(`/admin/user/${u.user_id}` as any)} style={[styles.pillBtn, { backgroundColor: c.brand }]}>
                      <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 13 * scale }}>Review</Text>
                    </Pressable>
                    <Pressable onPress={() => router.push(`/user/${u.user_id}` as any)} style={[styles.pillBtn, { backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border }]}>
                      <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 13 * scale }}>View profile</Text>
                    </Pressable>
                    {u.restricted && (
                      <Pressable testID={`admin-clear-${u.user_id}`} onPress={async () => { await api.adminClearRestriction(user.id, u.user_id, true, "Cleared via repeat-offender review"); load(); }} style={[styles.pillBtn, { backgroundColor: "#16A34A" }]}>
                        <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 13 * scale }}>Clear restriction</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {tab === "tickets" && (
          <View style={{ marginTop: 12, gap: 10 }}>
            {tickets.length === 0 ? (
              <Text style={{ color: c.muted, fontSize: 15 * scale, padding: 24, textAlign: "center" }}>No open tickets.</Text>
            ) : tickets.map((t: any) => (
              <View key={t.id} style={[styles.row, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ color: c.brand, fontWeight: "900", fontSize: 12 * scale }}>{(t.category || "").toUpperCase()}</Text>
                  <Text style={{ color: c.muted, fontSize: 11 * scale }}>{shortDate(t.created_at)}</Text>
                </View>
                <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 16 * scale, marginTop: 4 }}>{t.subject}</Text>
                <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 2 }} numberOfLines={3}>{t.message}</Text>
                <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 6 }}>From: {t.user?.first_name || t.user?.username || t.user_email || "Anonymous"}</Text>
                <Pressable onPress={async () => { await api.adminResolveTicket(t.id, { admin_id: user.id }); load(); }} style={[styles.pillBtn, { backgroundColor: c.brand, marginTop: 10 }]}>
                  <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 13 * scale }}>Mark resolved</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const STATUS_TINT: Record<string, string> = { new: "#B45309", reviewing: "#2563EB", resolved: "#0F766E", dismissed: "#475569" };

function Tile({ label, value, icon, tint, c, scale }: any) {
  return (
    <View style={[styles.tile, { backgroundColor: `${tint}22`, borderColor: tint }]}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Ionicons name={icon} size={18} color={tint} />
        <Text style={{ color: tint, fontWeight: "900", fontSize: 26 * scale }}>{value}</Text>
      </View>
      <Text style={{ color: c.onSurface, fontSize: 12 * scale, marginTop: 4, fontWeight: "700" }}>{label}</Text>
    </View>
  );
}

function TabBtn({ label, active, onPress, c, scale }: any) {
  return (
    <Pressable onPress={onPress} style={{ paddingVertical: 10, paddingHorizontal: 14, borderRadius: 999, backgroundColor: active ? c.brand : c.surfaceSecondary, borderWidth: 1, borderColor: active ? c.brand : c.border }}>
      <Text style={{ color: active ? "#FFF" : c.onSurface, fontWeight: "800", fontSize: 14 * scale }}>{label}</Text>
    </Pressable>
  );
}

function shortDate(iso: string) {
  try { const d = new Date(iso); return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }); } catch { return iso; }
}

const styles = StyleSheet.create({
  section: { fontWeight: "900", marginBottom: 8 },
  tile: { width: "31%", padding: 12, borderRadius: 14, borderWidth: 1.5, minWidth: 110 },
  policyCard: { marginTop: 10, padding: 12, borderRadius: 14, borderWidth: 1.5 },
  row: { padding: 12, borderRadius: 14, borderWidth: 1 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  badgeText: { color: "#FFF", fontWeight: "900", fontSize: 10, letterSpacing: 0.4 },
  pillBtn: { alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  quickLink: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999 },
});
