import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";

export default function Groups() {
  const { c, scale } = useTheme();
  const { user, refresh } = useAuth();
  const { show } = useToast();
  const router = useRouter();
  const [groups, setGroups] = useState<any[]>([]);

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
      <Header title="Community Groups" />
      <FlatList
        data={groups}
        keyExtractor={(g) => g.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
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
});
