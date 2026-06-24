import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, Modal, TextInput, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";

export default function Groups() {
  const { c, scale } = useTheme();
  const { user, token, refresh } = useAuth();
  const { show } = useToast();
  const router = useRouter();
  const [groups, setGroups] = useState<any[]>([]);
  // Suggest-a-group modal state. Anyone signed-in can submit; admin
  // approves via the Admin tab before the group goes live to others.
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [sName, setSName] = useState("");
  const [sEmoji, setSEmoji] = useState("🌟");
  const [sDesc, setSDesc] = useState("");
  const [sReason, setSReason] = useState("");
  const [sBusy, setSBusy] = useState(false);

  const load = async () => setGroups(await api.listGroups());
  useFocusEffect(useCallback(() => { load(); }, []));

  const join = async (g: any) => {
    if (!user) return;
    // Founder-only groups get a soft client-side gate before the API call
    // so non-founders get a friendly redirect to the Founders Wall instead
    // of a 403 toast.
    if (g.is_founder_only && !(user as any)?.is_founder) {
      router.push("/founders");
      return;
    }
    try {
      await api.joinGroup(g.id, user.id);
      show(`Joined ${g.name} 🤝`); await load(); await refresh();
    } catch (e: any) {
      // Backend defence-in-depth — if a non-founder somehow gets through
      // the client gate, redirect them to the Wall too.
      const msg = e?.message || "Couldn't join group";
      if (typeof msg === "string" && msg.toLowerCase().includes("founding")) {
        router.push("/founders");
      } else {
        show(msg);
      }
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header
        title="Community Groups"
        subtitle="Find your people · Join interest-based groups"
        emoji="🤝"
      />
      <FlatList
        data={groups}
        keyExtractor={(g) => g.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 12 }}
        renderItem={({ item }) => {
          const joined = user && (item.members || []).includes(user.id);
          const founderLocked = item.is_founder_only && !(user as any)?.is_founder;
          return (
            <Pressable
              testID={`group-${item.id}`}
              onPress={() => {
                if (founderLocked) { router.push("/founders"); return; }
                router.push(`/group/${item.id}` as any);
              }}
              style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: item.is_founder_only ? "#D4A017" : c.border, borderWidth: item.is_founder_only ? 2 : 1 }]}
            >
              <View style={styles.row}>
                <View style={[styles.emoji, { backgroundColor: c.brandTertiary }]}><Text style={{ fontSize: 32 }}>{item.emoji}</Text></View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                    <Text style={[styles.title, { color: c.onSurface, fontSize: 20 * scale }]}>{item.name}</Text>
                    {item.is_founder_only && (
                      <View style={styles.founderBadge}>
                        <Text style={styles.founderBadgeText}>🦋 FOUNDERS</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.desc, { color: c.muted, fontSize: 14 * scale }]} numberOfLines={2}>{item.description}</Text>
                  <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 4 }}>👥 {(item.members || []).length} members</Text>
                </View>
                <Pressable
                  testID={`join-${item.id}`}
                  onPress={() => {
                    if (founderLocked) { router.push("/founders"); return; }
                    return joined ? router.push(`/group/${item.id}` as any) : join(item);
                  }}
                  style={[styles.btn, { backgroundColor: founderLocked ? "#D4A017" : (joined ? c.brandTertiary : c.brand) }]}
                >
                  <Text style={{ color: founderLocked ? "#FFFFFF" : (joined ? c.brand : "#FFF"), fontWeight: "800", fontSize: 14 * scale }}>
                    {founderLocked ? "Founders" : (joined ? "Open" : "Join")}
                  </Text>
                </Pressable>
              </View>
            </Pressable>
          );
        }}
      />

      {/* Floating "Suggest a Group" button — bottom-right, thumb reach.
          Anyone signed-in can suggest; the submission is hidden from
          the public list until an admin approves it. */}
      <Pressable
        testID="suggest-group-fab"
        onPress={() => { if (!user) { router.push("/auth/welcome" as any); return; } setSuggestOpen(true); }}
        accessibilityRole="button"
        accessibilityLabel="Suggest a new community group"
        style={({ pressed }) => [styles.fab, { backgroundColor: c.brand, opacity: pressed ? 0.85 : 1 }]}
      >
        <Ionicons name="add" size={22} color="#FFFFFF" />
        <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 15 * scale }}>Suggest a Group</Text>
      </Pressable>

      {/* Suggestion modal. The form is intentionally short — name +
          emoji + description + optional "why" — so the friction to
          contribute is low for our demographic. */}
      <Modal
        visible={suggestOpen}
        animationType="slide"
        transparent
        onRequestClose={() => !sBusy && setSuggestOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={() => !sBusy && setSuggestOpen(false)}
          />
          <View style={[styles.modalCard, { backgroundColor: c.surface, borderColor: c.border }]}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 8 }}
              style={{ flexGrow: 0, flexShrink: 1 }}
            >
              <Text style={{ fontSize: 36, textAlign: "center" }}>🌟</Text>
              <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 22 * scale, textAlign: "center", marginTop: 6 }}>
                Suggest a Group
              </Text>
              <Text style={{ color: c.muted, fontSize: 14 * scale, textAlign: "center", marginTop: 6, lineHeight: 20 }}>
                Tell us about a community you&apos;d love to see. We&apos;ll review and add it to the list once it&apos;s approved.
              </Text>

              <Text style={[styles.label, { color: c.onSurface, fontSize: 14 * scale }]}>Group name</Text>
              <TextInput
                testID="suggest-name"
                value={sName}
                onChangeText={setSName}
                placeholder="e.g. Lawn Bowls Club"
                placeholderTextColor={c.muted}
                maxLength={60}
                style={[styles.input, { color: c.onSurface, borderColor: c.border, backgroundColor: c.surfaceSecondary, fontSize: 16 * scale }]}
              />

              <Text style={[styles.label, { color: c.onSurface, fontSize: 14 * scale }]}>Emoji</Text>
              <TextInput
                testID="suggest-emoji"
                value={sEmoji}
                onChangeText={setSEmoji}
                placeholder="🌟"
                placeholderTextColor={c.muted}
                maxLength={4}
                style={[styles.input, { color: c.onSurface, borderColor: c.border, backgroundColor: c.surfaceSecondary, fontSize: 18 * scale, width: 90 }]}
              />

              <Text style={[styles.label, { color: c.onSurface, fontSize: 14 * scale }]}>Description</Text>
              <TextInput
                testID="suggest-desc"
                value={sDesc}
                onChangeText={setSDesc}
                placeholder="What's the group about? Who would enjoy it?"
                placeholderTextColor={c.muted}
                multiline
                maxLength={500}
                style={[styles.input, { color: c.onSurface, borderColor: c.border, backgroundColor: c.surfaceSecondary, fontSize: 15 * scale, minHeight: 80, textAlignVertical: "top" }]}
              />

              <Text style={[styles.label, { color: c.onSurface, fontSize: 14 * scale }]}>Why this group? (optional)</Text>
              <TextInput
                testID="suggest-reason"
                value={sReason}
                onChangeText={setSReason}
                placeholder="A note for the admin reviewing your suggestion."
                placeholderTextColor={c.muted}
                multiline
                maxLength={500}
                style={[styles.input, { color: c.onSurface, borderColor: c.border, backgroundColor: c.surfaceSecondary, fontSize: 14 * scale, minHeight: 60, textAlignVertical: "top" }]}
              />

              <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
                <Pressable
                  testID="suggest-cancel"
                  disabled={sBusy}
                  onPress={() => setSuggestOpen(false)}
                  style={({ pressed }) => [styles.modalBtn, { borderWidth: 1.5, borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}
                >
                  <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 * scale }}>Cancel</Text>
                </Pressable>
                <Pressable
                  testID="suggest-submit"
                  disabled={sBusy || !sName.trim()}
                  onPress={async () => {
                    if (!token) { show("Sign in to suggest a group"); return; }
                    setSBusy(true);
                    try {
                      await api.suggestGroup(token, {
                        name: sName.trim(),
                        emoji: sEmoji.trim() || "🌟",
                        description: sDesc.trim(),
                        reason: sReason.trim(),
                      });
                      show("Thanks! Your group is awaiting admin approval 🌟");
                      setSuggestOpen(false);
                      setSName(""); setSEmoji("🌟"); setSDesc(""); setSReason("");
                    } catch (e: any) {
                      const msg = String(e?.message || "Could not submit suggestion");
                      show(msg.includes("409") ? "A group with that name already exists." : "Could not submit suggestion.");
                    } finally {
                      setSBusy(false);
                    }
                  }}
                  style={({ pressed }) => [styles.modalBtn, {
                    backgroundColor: !sName.trim() ? c.surfaceTertiary : c.brand,
                    opacity: (sBusy || !sName.trim()) ? 0.65 : (pressed ? 0.85 : 1),
                  }]}
                >
                  {sBusy ? <ActivityIndicator color="#FFFFFF" /> : (
                    <Text style={{ color: !sName.trim() ? c.muted : "#FFFFFF", fontWeight: "900", fontSize: 16 * scale }}>Send for review</Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, padding: 14, borderWidth: 1 },
  row: { flexDirection: "row", alignItems: "center" },
  emoji: { width: 60, height: 60, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  title: { fontWeight: "800" },
  desc: { marginTop: 2 },
  btn: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999, minHeight: 44, justifyContent: "center" },
  founderBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#D4A017",
  },
  founderBadgeText: {
    color: "#7C5300",
    fontWeight: "900",
    fontSize: 11,
    letterSpacing: 0.4,
  },
  fab: {
    position: "absolute",
    right: 16,
    bottom: 22,
    minHeight: 52,
    paddingHorizontal: 18,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  modalCard: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    padding: 20,
    maxHeight: "92%",
  },
  label: { fontWeight: "800", marginTop: 14, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 46,
  },
  modalBtn: {
    flex: 1,
    minHeight: 52,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
});
