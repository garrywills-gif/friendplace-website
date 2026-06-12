import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl, Modal, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Button from "@/src/components/Button";

function occupancyLabel(seated: number): { label: string; color: string; icon: keyof typeof Ionicons.glyphMap } {
  if (seated === 0) return { label: "Empty Table", color: "#94A3B8", icon: "ellipse-outline" };
  if (seated === 1) return { label: "1 Person", color: "#0EA5E9", icon: "person" };
  if (seated <= 4) return { label: `${seated} People`, color: "#0F766E", icon: "people" };
  if (seated <= 7) return { label: `${seated} People`, color: "#0F766E", icon: "people" };
  return { label: "Full Table", color: "#B45309", icon: "people-circle" };
}

export default function Lounge() {
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const { show } = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tables, setTables] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("☕");
  const [desc, setDesc] = useState("");
  const [visibility, setVisibility] = useState<"public" | "friends">("public");

  const load = async () => {
    try { setTables(await api.listTables()); } catch (e) { show("Failed to load lounge"); }
  };
  useFocusEffect(useCallback(() => { load(); }, []));

  const create = async () => {
    if (!user || !name.trim()) { show("Give your table a name"); return; }
    try {
      const t = await api.createTable({ name: name.trim(), emoji, description: desc, visibility, host_id: user.id });
      setCreating(false); setName(""); setDesc(""); setEmoji("☕"); setVisibility("public");
      router.push(`/table/${t.id}` as any);
    } catch { show("Could not create"); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <View style={[styles.head, { paddingTop: insets.top + 8 }]}>
        <Text style={[styles.title, { color: c.onSurface, fontSize: 28 * scale }]}>Coffee Lounge ☕</Text>
        <Text style={[styles.sub, { color: c.muted, fontSize: 16 * scale }]}>Pull up a chair and join a chat</Text>
      </View>
      <FlatList
        data={tables}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 110, gap: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        renderItem={({ item }) => {
          const seatedCount = (item.seated || []).length;
          const occ = occupancyLabel(seatedCount);
          const active = seatedCount >= 2;
          return (
            <Pressable
              testID={`table-${item.id}`}
              onPress={() => router.push(`/table/${item.id}` as any)}
              style={({ pressed }) => [styles.card, { backgroundColor: c.surfaceSecondary, borderColor: active ? "#10B981" : c.border, borderWidth: active ? 2 : 1, opacity: pressed ? 0.85 : 1 }]}
            >
              <View style={styles.topRow}>
                <Text style={{ fontSize: 44 }}>{item.emoji}</Text>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                    <Text style={[styles.cardTitle, { color: c.onSurface, fontSize: 22 * scale }]}>{item.name}</Text>
                    {active && (
                      <View style={[styles.activeBadge, { backgroundColor: "#10B981" }]} testID={`active-${item.id}`}>
                        <View style={styles.activeDot} />
                        <Text style={[styles.activeText, { fontSize: 12 * scale }]}>Active Now</Text>
                      </View>
                    )}
                  </View>
                  {!!item.description && <Text style={[styles.cardDesc, { color: c.muted, fontSize: 15 * scale }]} numberOfLines={2}>{item.description}</Text>}
                </View>
                {item.visibility === "friends" && (
                  <View style={[styles.lock, { backgroundColor: c.brandTertiary }]}>
                    <Ionicons name="lock-closed" size={16} color={c.brand} />
                  </View>
                )}
              </View>

              <View style={[styles.occRow, { backgroundColor: c.surfaceTertiary }]}>
                <Ionicons name={occ.icon} size={18} color={occ.color} />
                <Text style={[styles.occLabel, { color: occ.color, fontSize: 14 * scale }]}>{occ.label}</Text>
                <View style={{ flex: 1, flexDirection: "row", justifyContent: "flex-end" }}>
                  {(item.seated || []).slice(0, 5).map((id: string, i: number) => (
                    <View key={id} style={[styles.dot, { backgroundColor: c.brandTertiary, marginLeft: i === 0 ? 0 : -8, borderColor: c.surfaceSecondary }]}>
                      <Ionicons name="person" size={14} color={c.brand} />
                    </View>
                  ))}
                </View>
              </View>

              <View style={styles.bottom}>
                <View style={[styles.joinBtn, { backgroundColor: c.brand }]}>
                  <Text style={{ color: c.onBrandPrimary, fontWeight: "800", fontSize: 16 * scale }}>{seatedCount === 0 ? "Start a Chat" : "Join Table"}</Text>
                </View>
              </View>
            </Pressable>
          );
        }}
      />
      <Pressable testID="create-table-fab" onPress={() => setCreating(true)} style={[styles.fab, { backgroundColor: c.brand, bottom: 96 + insets.bottom }]}>
        <Ionicons name="add" size={28} color="#FFF" />
        <Text style={[styles.fabText]}>Create Table</Text>
      </Pressable>

      <Modal visible={creating} animationType="slide" transparent onRequestClose={() => setCreating(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <View style={[styles.modalSheet, { backgroundColor: c.surface }]}>
            <View style={styles.modalHead}>
              <Text style={[styles.modalTitle, { color: c.onSurface, fontSize: 22 * scale }]}>Create a Table</Text>
              <Pressable onPress={() => setCreating(false)} style={styles.modalClose}><Ionicons name="close" size={24} color={c.onSurface} /></Pressable>
            </View>
            <View style={styles.emojiRow}>
              {["☕", "🌱", "📚", "🐾", "🎨", "🔨", "🏠", "👋"].map((e) => (
                <Pressable key={e} onPress={() => setEmoji(e)} style={[styles.emojiPick, { backgroundColor: emoji === e ? c.brandTertiary : c.surfaceSecondary, borderColor: emoji === e ? c.brand : c.border }]}>
                  <Text style={{ fontSize: 26 }}>{e}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput testID="new-table-name" placeholder="Table name" placeholderTextColor={c.muted} value={name} onChangeText={setName} style={[styles.input, { color: c.onSurface, backgroundColor: c.surfaceSecondary, borderColor: c.border, fontSize: 18 * scale }]} />
            <TextInput placeholder="Short description" placeholderTextColor={c.muted} value={desc} onChangeText={setDesc} style={[styles.input, { color: c.onSurface, backgroundColor: c.surfaceSecondary, borderColor: c.border, fontSize: 16 * scale, height: 80 }]} multiline />
            <View style={[styles.emojiRow, { marginTop: 8 }]}>
              {(["public", "friends"] as const).map((v) => (
                <Pressable key={v} onPress={() => setVisibility(v)} style={[styles.chip, { backgroundColor: visibility === v ? c.brand : c.surfaceSecondary, borderColor: visibility === v ? c.brand : c.border }]}>
                  <Text style={{ color: visibility === v ? "#FFF" : c.onSurface, fontWeight: "700", fontSize: 15 * scale }}>{v === "public" ? "🌍 Public" : "👯 Friends only"}</Text>
                </Pressable>
              ))}
            </View>
            <View style={{ marginTop: 12 }}>
              <Button testID="new-table-submit" label="Open my table" onPress={create} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: 20, paddingBottom: 8 },
  title: { fontWeight: "900" },
  sub: { fontWeight: "600", marginTop: 2 },
  card: { borderRadius: 20, padding: 16, shadowColor: "#0F172A", shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2, gap: 10 },
  topRow: { flexDirection: "row", alignItems: "center" },
  cardTitle: { fontWeight: "800" },
  cardDesc: { marginTop: 2, fontWeight: "500" },
  lock: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  activeBadge: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, gap: 5 },
  activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#FFFFFF" },
  activeText: { color: "#FFFFFF", fontWeight: "800" },
  occRow: { flexDirection: "row", alignItems: "center", padding: 10, borderRadius: 14, gap: 6 },
  occLabel: { fontWeight: "800" },
  dot: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  bottom: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end" },
  joinBtn: { paddingHorizontal: 22, paddingVertical: 12, borderRadius: 999 },
  emojiRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  fab: { position: "absolute", right: 16, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 999, shadowColor: "#0F172A", shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  fabText: { color: "#FFFFFF", fontWeight: "800", fontSize: 16 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, gap: 12 },
  modalHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { fontWeight: "800" },
  modalClose: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  emojiPick: { width: 48, height: 48, borderRadius: 24, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  input: { borderWidth: 2, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontWeight: "600" },
  chip: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999, borderWidth: 2, minHeight: 44 },
});
