/**
 * /admin/pending-groups — Admin-only review queue for user-suggested
 * community groups.
 *
 * Surfaces every group submitted via the "Suggest a Group" FAB on the
 * Community Groups page. Admin can approve (group goes live + the
 * requester gets an in-app notification) or reject (deleted + optional
 * reason routed back to the requester).
 *
 * Lives at a dedicated URL so it's easy to share/bookmark — there's a
 * top-row card on /admin/index linking here when there are pending
 * suggestions waiting.
 */
import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, RefreshControl, Modal, TextInput } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";

type Pending = {
  id: string;
  name: string;
  emoji?: string;
  description?: string;
  suggested_by_username?: string;
  suggested_reason?: string;
  suggested_at?: string;
};

export default function AdminPendingGroups() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user, token } = useAuth();
  const { show } = useToast();
  const [items, setItems] = useState<Pending[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const docs: any = await api.adminPendingGroups(token);
      setItems(docs || []);
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (msg.includes("403")) show("Admin access only");
    } finally {
      setLoading(false);
    }
  }, [token, show]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const approve = async (g: Pending) => {
    if (!token) return;
    setBusy(g.id);
    try {
      await api.adminApproveGroup(token, g.id);
      show(`"${g.name}" approved and live 🎉`);
      setItems(prev => prev.filter(p => p.id !== g.id));
    } catch (e: any) {
      show(`Could not approve: ${e?.message || "unknown error"}`);
    } finally {
      setBusy(null);
    }
  };

  const reject = async () => {
    if (!token || !rejecting) return;
    setBusy(rejecting.id);
    try {
      await api.adminRejectGroup(token, rejecting.id, reason.trim());
      show(`"${rejecting.name}" rejected and the requester was notified.`);
      setItems(prev => prev.filter(p => p.id !== rejecting.id));
      setRejecting(null);
      setReason("");
    } catch (e: any) {
      show(`Could not reject: ${e?.message || "unknown error"}`);
    } finally {
      setBusy(null);
    }
  };

  // Defence-in-depth — the backend already returns 403, but we also
  // gate the UI so non-admins never see the queue even briefly.
  if (user && !(user as any).is_admin) {
    return (
      <View style={{ flex: 1, backgroundColor: c.surface }}>
        <Header title="Admin only" emoji="🔒" subtitle="This area is reserved for moderators" />
        <View style={{ padding: 24, alignItems: "center" }}>
          <Text style={{ color: c.onSurface, textAlign: "center", fontSize: 16 * scale, lineHeight: 24 }}>
            You don&apos;t have admin access to this screen.
          </Text>
          <Pressable onPress={() => router.replace("/home" as any)} style={[styles.btn, { backgroundColor: c.brand, marginTop: 18 }]}>
            <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 15 * scale }}>Take me home</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header
        title="Pending Group Suggestions"
        emoji="🌟"
        subtitle={`${items.length} awaiting review`}
      />
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        {loading && items.length === 0 ? (
          <ActivityIndicator size="large" color={c.brand} style={{ marginTop: 30 }} />
        ) : items.length === 0 ? (
          <View style={{ alignItems: "center", padding: 28 }}>
            <Text style={{ fontSize: 48 }}>🎉</Text>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 17 * scale, marginTop: 8 }}>
              All clear!
            </Text>
            <Text style={{ color: c.muted, textAlign: "center", marginTop: 4, fontSize: 14 * scale }}>
              No group suggestions waiting for review.
            </Text>
          </View>
        ) : (
          items.map(g => (
            <View key={g.id} style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]} testID={`pending-group-${g.id}`}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                <View style={[styles.emoji, { backgroundColor: c.brandTertiary }]}>
                  <Text style={{ fontSize: 30 }}>{g.emoji || "🌟"}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 19 * scale }} numberOfLines={2}>
                    {g.name}
                  </Text>
                  {g.description ? (
                    <Text style={{ color: c.muted, fontSize: 14 * scale, marginTop: 4, lineHeight: 20 }}>
                      {g.description}
                    </Text>
                  ) : null}
                  <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 6, fontWeight: "700" }}>
                    Suggested by {g.suggested_by_username || "a member"}
                    {g.suggested_at ? ` · ${new Date(g.suggested_at).toLocaleDateString()}` : ""}
                  </Text>
                  {g.suggested_reason ? (
                    <View style={{ marginTop: 8, padding: 8, borderRadius: 8, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
                      <Text style={{ color: c.muted, fontSize: 11 * scale, fontWeight: "800", letterSpacing: 0.4, marginBottom: 2 }}>WHY THIS GROUP</Text>
                      <Text style={{ color: c.onSurface, fontSize: 13 * scale, lineHeight: 18 }}>{g.suggested_reason}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                <Pressable
                  testID={`pending-reject-${g.id}`}
                  disabled={busy === g.id}
                  onPress={() => { setRejecting(g); setReason(""); }}
                  style={({ pressed }) => [styles.btn, { backgroundColor: c.surface, borderWidth: 1.5, borderColor: "#C62828", flex: 1, opacity: pressed ? 0.7 : 1 }]}
                >
                  <Text style={{ color: "#C62828", fontWeight: "900", fontSize: 14 * scale }}>Reject</Text>
                </Pressable>
                <Pressable
                  testID={`pending-approve-${g.id}`}
                  disabled={busy === g.id}
                  onPress={() => approve(g)}
                  style={({ pressed }) => [styles.btn, { backgroundColor: "#0F766E", flex: 1, opacity: busy === g.id ? 0.7 : (pressed ? 0.85 : 1) }]}
                >
                  {busy === g.id
                    ? <ActivityIndicator color="#FFFFFF" />
                    : <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 14 * scale }}>Approve</Text>}
                </Pressable>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* Reject modal — collects an optional reason routed back to the
          requester so they understand why their group wasn't approved. */}
      <Modal visible={!!rejecting} animationType="fade" transparent onRequestClose={() => !busy && setRejecting(null)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 19 * scale }}>
              Reject &quot;{rejecting?.name}&quot;?
            </Text>
            <Text style={{ color: c.muted, fontSize: 14 * scale, marginTop: 6, lineHeight: 20 }}>
              The suggestion will be removed and {rejecting?.suggested_by_username || "the requester"} will get a polite notification.
            </Text>
            <Text style={{ color: c.onSurface, fontWeight: "800", marginTop: 14, fontSize: 13 * scale }}>Reason (optional)</Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="e.g. Duplicate of an existing group"
              placeholderTextColor={c.muted}
              multiline
              maxLength={500}
              style={[styles.input, { color: c.onSurface, borderColor: c.border, backgroundColor: c.surfaceSecondary, fontSize: 14 * scale }]}
            />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
              <Pressable
                onPress={() => setRejecting(null)}
                disabled={!!busy}
                style={({ pressed }) => [styles.btn, { borderWidth: 1.5, borderColor: c.border, flex: 1, opacity: pressed ? 0.7 : 1 }]}
              >
                <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 15 * scale }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={reject}
                disabled={!!busy}
                style={({ pressed }) => [styles.btn, { backgroundColor: "#C62828", flex: 1, opacity: busy ? 0.7 : (pressed ? 0.85 : 1) }]}
              >
                {busy
                  ? <ActivityIndicator color="#FFFFFF" />
                  : <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 15 * scale }}>Reject</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: 14, borderWidth: 1 },
  emoji: { width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  btn: { minHeight: 44, borderRadius: 999, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", paddingHorizontal: 22 },
  modalCard: { width: "100%", maxWidth: 460, borderRadius: 18, borderWidth: 1, padding: 20 },
  input: { borderWidth: 1, borderRadius: 12, padding: 10, marginTop: 6, minHeight: 60, textAlignVertical: "top" },
});
