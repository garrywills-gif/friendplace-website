import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import AvatarBubble from "@/src/components/AvatarBubble";

type Admin = { id: string; username: string; first_name?: string; avatar?: string; suburb?: string };
type Result = Admin & { last_name?: string; is_admin?: boolean; restricted?: boolean; banned?: boolean };

/**
 * Admin → Moderators screen.
 *
 * Lets an existing admin (currently only `maggie` by default) promote any
 * user to a moderator or demote an existing moderator. Search is debounced
 * across username + first/last name; the API enforces "no self demote" and
 * "at least one admin must remain". A small confirmation step prevents
 * accidental clicks.
 */
export default function AdminPromote() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const { show, confirm } = useToast();

  const [admins, setAdmins] = useState<Admin[]>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reloadAdmins = useCallback(async () => {
    if (!user?.id) return;
    try {
      const r: any = await api.adminListAdmins(user.id);
      setAdmins(r?.admins || []);
    } catch (e: any) {
      // Most likely: not actually an admin. The render guard below will catch it.
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { reloadAdmins(); }, [reloadAdmins]);

  // Debounce the search input so we don't hammer the API on every keystroke.
  useEffect(() => {
    if (!user?.id) return;
    const term = q.trim();
    if (!term) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r: any = await api.adminSearchUsers(user.id, term, 25);
        setResults(r?.results || []);
      } catch (e) {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 280);
    return () => clearTimeout(t);
  }, [q, user?.id]);

  // Set of admin IDs for fast lookup so the search result rows can show the
  // correct toggle even if the user just promoted/demoted someone.
  const adminIdSet = useMemo(() => new Set(admins.map((a) => a.id)), [admins]);

  const confirmAndToggle = async (target: Result, makeAdmin: boolean) => {
    const niceName = `${target.first_name || ""} @${target.username}`.trim();
    const verb = makeAdmin ? "Promote" : "Remove admin from";
    const longBody = makeAdmin
      ? `Give ${niceName} full moderator access? They will be able to view reports, warn / suspend / ban users, and manage events.`
      : `Remove moderator access from ${niceName}? They will lose access to the Admin section immediately.`;
    const ok = await confirm({
      title: `${verb}?`,
      message: longBody,
      confirmLabel: makeAdmin ? "Promote" : "Remove",
      cancelLabel: "Cancel",
      destructive: !makeAdmin,
    });
    if (!ok) return;
    await doToggle(target, makeAdmin);
  };

  const doToggle = async (target: Result, makeAdmin: boolean) => {
    if (!user?.id) return;
    setBusyId(target.id);
    try {
      await api.adminSetAdminFlag({ admin_id: user.id, target_user_id: target.id, make_admin: makeAdmin });
      show(makeAdmin ? `${target.first_name || target.username} is now a moderator` : `${target.first_name || target.username} is no longer a moderator`);
      // Update local lists.
      setResults((rs) => rs.map((r) => (r.id === target.id ? { ...r, is_admin: makeAdmin } : r)));
      await reloadAdmins();
    } catch (e: any) {
      const msg = (e?.message || "").includes("own admin access")
        ? "You can't remove your own admin access."
        : (e?.message || "").includes("At least one admin")
        ? "At least one admin must remain. Promote someone else first."
        : e?.message || "Couldn't update. Please try again.";
      show(msg);
    } finally {
      setBusyId(null);
    }
  };

  if (!user) {
    return (
      <View style={{ flex: 1, backgroundColor: c.surface }}>
        <Header title="Moderators" />
        <Text style={{ padding: 16, color: c.onSurface }}>Please log in.</Text>
      </View>
    );
  }
  if (!(user as any).is_admin) {
    return (
      <View style={{ flex: 1, backgroundColor: c.surface }}>
        <Header title="Moderators" />
        <View style={{ padding: 24, alignItems: "center" }}>
          <Ionicons name="lock-closed" size={48} color={c.muted} />
          <Text style={{ color: c.onSurface, fontSize: 18 * scale, marginTop: 12, textAlign: "center" }}>
            Moderator management is only available to FriendPlace admins.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Moderators" />
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
        {/* Current admins */}
        <Text style={[styles.section, { color: c.onSurface, fontSize: 18 * scale }]}>Current moderators</Text>
        {loading ? (
          <ActivityIndicator color={c.brand} />
        ) : admins.length === 0 ? (
          <Text style={{ color: c.muted, fontSize: 14 * scale }}>No moderators found.</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {admins.map((a) => (
              <View key={a.id} style={[styles.row, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
                <AvatarBubble value={a.avatar} size={28} fallback="👤" />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 15 * scale }}>
                    {a.first_name || ""} <Text style={{ color: c.muted, fontWeight: "600" }}>@{a.username}</Text>
                  </Text>
                  <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 2 }}>{a.suburb || ""}</Text>
                </View>
                <View style={[styles.adminBadge, { backgroundColor: c.brand }]}>
                  <Ionicons name="shield-checkmark" size={14} color="#FFF" />
                  <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 11, marginLeft: 4, letterSpacing: 0.4 }}>ADMIN</Text>
                </View>
                {a.id === user.id ? (
                  <Text style={{ color: c.muted, fontSize: 11 * scale, marginLeft: 8 }}>You</Text>
                ) : (
                  <Pressable
                    testID={`demote-${a.username}`}
                    disabled={busyId === a.id}
                    onPress={() => confirmAndToggle(a as Result, false)}
                    style={[styles.actionBtn, { backgroundColor: "#FEE2E2", borderColor: "#DC2626", marginLeft: 8 }]}
                  >
                    {busyId === a.id ? <ActivityIndicator color="#DC2626" size="small" /> : <Text style={{ color: "#B91C1C", fontWeight: "900", fontSize: 12 * scale }}>Remove</Text>}
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        )}

        {/* Add a moderator */}
        <Text style={[styles.section, { color: c.onSurface, fontSize: 18 * scale, marginTop: 22 }]}>Add a moderator</Text>
        <Text style={{ color: c.muted, fontSize: 13 * scale, marginBottom: 8 }}>
          Search by username or first name. Tap "Promote" to give them moderator access.
        </Text>
        <View style={[styles.searchWrap, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <Ionicons name="search" size={18} color={c.muted} />
          <TextInput
            testID="promote-search"
            value={q}
            onChangeText={setQ}
            placeholder="e.g. frankie, joyce, bill…"
            placeholderTextColor={c.muted}
            autoCorrect={false}
            autoCapitalize="none"
            style={{ flex: 1, marginLeft: 8, color: c.onSurface, fontSize: 16 * scale, paddingVertical: 8 }}
          />
          {q.length > 0 && (
            <Pressable onPress={() => setQ("")} hitSlop={8}>
              <Ionicons name="close-circle" size={20} color={c.muted} />
            </Pressable>
          )}
        </View>

        {searching && <ActivityIndicator color={c.brand} style={{ marginTop: 12 }} />}

        {q.trim().length > 0 && !searching && results.length === 0 && (
          <Text style={{ color: c.muted, fontSize: 14 * scale, padding: 18, textAlign: "center" }}>
            No users match "{q.trim()}".
          </Text>
        )}

        <View style={{ gap: 8, marginTop: 10 }}>
          {results.map((r) => {
            const isAdmin = r.is_admin || adminIdSet.has(r.id);
            return (
              <View key={r.id} style={[styles.row, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
                <AvatarBubble value={r.avatar} size={28} fallback="👤" />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 15 * scale }}>
                    {r.first_name || ""} {r.last_name || ""} <Text style={{ color: c.muted, fontWeight: "600" }}>@{r.username}</Text>
                  </Text>
                  <View style={{ flexDirection: "row", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                    {!!r.suburb && <Text style={{ color: c.muted, fontSize: 12 * scale }}>{r.suburb}</Text>}
                    {isAdmin && <View style={[styles.adminBadge, { backgroundColor: c.brand }]}><Ionicons name="shield-checkmark" size={12} color="#FFF" /><Text style={{ color: "#FFF", fontWeight: "900", fontSize: 10, marginLeft: 3 }}>ADMIN</Text></View>}
                    {r.restricted && <Text style={{ color: "#DC2626", fontWeight: "800", fontSize: 11 * scale }}>RESTRICTED</Text>}
                    {r.banned && <Text style={{ color: "#7F1D1D", fontWeight: "900", fontSize: 11 * scale }}>BANNED</Text>}
                  </View>
                </View>
                {r.id === user.id ? (
                  <Text style={{ color: c.muted, fontSize: 11 * scale, marginLeft: 8 }}>You</Text>
                ) : isAdmin ? (
                  <Pressable
                    testID={`promote-toggle-${r.username}`}
                    disabled={busyId === r.id}
                    onPress={() => confirmAndToggle(r, false)}
                    style={[styles.actionBtn, { backgroundColor: "#FEE2E2", borderColor: "#DC2626" }]}
                  >
                    {busyId === r.id ? <ActivityIndicator color="#DC2626" size="small" /> : <Text style={{ color: "#B91C1C", fontWeight: "900", fontSize: 12 * scale }}>Remove</Text>}
                  </Pressable>
                ) : (
                  <Pressable
                    testID={`promote-toggle-${r.username}`}
                    disabled={busyId === r.id || r.banned}
                    onPress={() => confirmAndToggle(r, true)}
                    style={[styles.actionBtn, { backgroundColor: c.brand, borderColor: c.brand, opacity: r.banned ? 0.4 : 1 }]}
                  >
                    {busyId === r.id ? <ActivityIndicator color="#FFF" size="small" /> : <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 12 * scale }}>Promote</Text>}
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>

        <View style={[styles.tip, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
          <Ionicons name="information-circle" size={20} color={c.brand} />
          <Text style={{ color: c.onSurface, fontSize: 13 * scale, marginLeft: 8, flex: 1, lineHeight: 18 }}>
            Moderators can view reports, warn/suspend/ban users, manage events and promote others. You cannot remove your own admin access — get another admin to do that for you.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { fontWeight: "900", marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 14, borderWidth: 1, gap: 10 },
  adminBadge: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  searchWrap: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, borderRadius: 14, borderWidth: 1 },
  actionBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1.5, minWidth: 88, alignItems: "center" },
  tip: { flexDirection: "row", alignItems: "flex-start", padding: 12, borderRadius: 14, borderWidth: 1, marginTop: 22 },
});
