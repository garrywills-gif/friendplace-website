import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import Button from "@/src/components/Button";

export default function UserView() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, scale } = useTheme();
  const { user, refresh } = useAuth();
  const { show } = useToast();
  const router = useRouter();
  const [u, setU] = useState<any>(null);

  useEffect(() => { if (id) api.getUser(id).then(setU).catch(() => {}); }, [id]);
  if (!u) return <View style={{ flex: 1, backgroundColor: c.surface }}><Header title="Profile" /></View>;

  const send = async () => { if (!user) return; await api.sendFriendReq(user.id, u.id); show("Friend request sent 🦋"); await refresh(); };
  const flutter = async () => { if (!user) return; await api.sendFlutter(user.id, u.id); show(`🦋 Flutter sent to ${u.first_name}!`); };
  const message = async () => { if (!user) return; const conv = await api.startDm(user.id, u.id); router.push(`/dm/${conv.id}?other_id=${u.id}` as any); };
  const block = async () => { if (!user) return; await api.blockUser(user.id, u.id); show("User blocked"); router.back(); };
  const report = async () => { if (!user) return; await api.reportUser(user.id, u.id, "inappropriate"); show("Report sent to moderators"); };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title={u.first_name} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <View style={[styles.hero, { backgroundColor: c.brandTertiary }]}>
          <View style={[styles.av, { backgroundColor: c.surfaceSecondary }]}><Text style={{ fontSize: 60 }}>{u.avatar || "🙂"}</Text></View>
          <Text style={[styles.name, { color: c.onSurface, fontSize: 28 * scale }]}>{u.first_name}</Text>
          <Text style={{ color: c.muted, fontSize: 16 * scale }}>@{u.username} · 📍 {u.suburb || "—"}</Text>
          {!!u.bio && <Text style={{ color: c.onBrandTertiary, fontSize: 16 * scale, marginTop: 8, textAlign: "center" }}>{u.bio}</Text>}
        </View>
        <View style={styles.actions}>
          <Button testID="user-add" label="Add Friend" onPress={send} />
          <Button testID="user-flutter" label="🦋 Flutter" variant="outline" onPress={flutter} />
          <Button testID="user-message" label="Message" variant="secondary" onPress={message} />
        </View>
        <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <Text style={[styles.h, { color: c.onSurface, fontSize: 18 * scale }]}>🦋 {u.points} Butterfly Points</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {(u.badges || []).map((b: string) => <Text key={b} style={{ color: c.brand, borderColor: c.brand, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, fontWeight: "700", fontSize: 13 * scale }}>{b}</Text>)}
          </View>
        </View>
        <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <Text style={[styles.h, { color: c.onSurface, fontSize: 18 * scale }]}>🌿 Interests</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {(u.interests || []).map((i: string) => <Text key={i} style={{ backgroundColor: c.brandTertiary, color: c.brand, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, fontWeight: "700", fontSize: 13 * scale }}>{i}</Text>)}
          </View>
        </View>
        <Pressable testID="user-report" onPress={report} style={[styles.danger, { borderColor: c.warning }]}><Ionicons name="flag" size={18} color={c.warning} /><Text style={{ color: c.warning, fontWeight: "700", fontSize: 16 * scale }}>Report user</Text></Pressable>
        <Pressable testID="user-block" onPress={block} style={[styles.danger, { borderColor: c.error }]}><Ionicons name="ban" size={18} color={c.error} /><Text style={{ color: c.error, fontWeight: "700", fontSize: 16 * scale }}>Block user</Text></Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { padding: 20, borderRadius: 22, alignItems: "center", gap: 8 },
  av: { width: 110, height: 110, borderRadius: 55, alignItems: "center", justifyContent: "center" },
  name: { fontWeight: "900", marginTop: 6 },
  actions: { flexDirection: "row", gap: 10 },
  card: { borderRadius: 18, padding: 14, borderWidth: 1 },
  h: { fontWeight: "800" },
  danger: { padding: 16, borderRadius: 14, borderWidth: 2, flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center" },
});
