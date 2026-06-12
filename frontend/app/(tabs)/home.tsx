import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Image } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";

const LOGO = "https://customer-assets.emergentagent.com/job_c6e73a4e-7434-496a-a98e-aa042fe1d5e5/artifacts/k75xx68h_image.png";

type Tile = { key: string; title: string; icon: keyof typeof Ionicons.glyphMap; route: string; bg: string; full?: boolean };

export default function Home() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const { show } = useToast();
  const insets = useSafeAreaInsets();
  const [flutters, setFlutters] = useState<any[]>([]);

  const loadFlutters = async () => {
    if (!user) return;
    try { setFlutters(await api.myFlutters(user.id)); } catch {}
  };
  useFocusEffect(useCallback(() => { loadFlutters(); }, [user?.id]));

  const replyFlutter = async (f: any) => {
    await api.markFlutterRead(f.id);
    const conv = await api.startDm(user!.id, f.from_id);
    router.push(`/dm/${conv.id}?other_id=${f.from_id}` as any);
    await loadFlutters();
  };
  const dismissFlutter = async (f: any) => {
    await api.markFlutterRead(f.id);
    setFlutters((arr) => arr.filter((x) => x.id !== f.id));
    show("Flutter dismissed");
  };

  const tiles: Tile[] = [
    { key: "lounge", title: "Coffee Lounge", icon: "cafe", route: "/(tabs)/lounge", bg: "#0F766E", full: true },
    { key: "friends", title: "Find Friends", icon: "people", route: "/(tabs)/friends", bg: "#0369A1" },
    { key: "events", title: "Local Events", icon: "calendar", route: "/events", bg: "#0EA5E9" },
    { key: "groups", title: "Community Groups", icon: "earth", route: "/groups", bg: "#14B8A6" },
    { key: "notices", title: "Notice Board", icon: "newspaper", route: "/notices", bg: "#0891B2" },
    { key: "games", title: "Games", icon: "game-controller", route: "/games", bg: "#0284C7" },
    { key: "profile", title: "My Profile", icon: "person-circle", route: "/(tabs)/profile", bg: "#475569" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 12, paddingBottom: 24 }]}>
        <View style={styles.headerRow}>
          <Image source={{ uri: LOGO }} style={styles.brandLogo} resizeMode="contain" />
          <Pressable testID="home-settings" onPress={() => router.push("/settings")} style={[styles.iconBtn, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
            <Ionicons name="settings-outline" size={26} color={c.onSurface} />
          </Pressable>
        </View>
        <Text style={[styles.hello, { color: c.muted, fontSize: 16 * scale }]}>Welcome back</Text>
        <Text style={[styles.name, { color: c.onSurface, fontSize: 28 * scale }]}>{user?.first_name || "Friend"} 🦋</Text>

        {flutters.length > 0 && (
          <View style={[styles.flutterBox, { borderColor: "#8B5CF6" }]}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
              <Text style={{ fontSize: 24 }}>🦋</Text>
              <Text style={{ color: "#6D28D9", fontWeight: "900", fontSize: 17 * scale, marginLeft: 6 }}>You've got Flutters!</Text>
            </View>
            {flutters.slice(0, 3).map((f) => (
              <View key={f.id} style={[styles.flutterItem, { backgroundColor: "#FFFFFF", borderColor: "#EDE9FE" }]}>
                <Text style={{ fontSize: 22 }}>{f.from_avatar || "🙂"}</Text>
                <Text style={{ color: "#1E293B", flex: 1, marginLeft: 8, fontSize: 15 * scale }} numberOfLines={2}>
                  <Text style={{ fontWeight: "800" }}>{f.from_name}</Text> {f.message}
                </Text>
                <Pressable testID={`flutter-reply-${f.id}`} onPress={() => replyFlutter(f)} style={[styles.replyBtn, { backgroundColor: "#8B5CF6" }]}>
                  <Text style={{ color: "#FFF", fontWeight: "800", fontSize: 13 * scale }}>Reply</Text>
                </Pressable>
                <Pressable testID={`flutter-dismiss-${f.id}`} onPress={() => dismissFlutter(f)} style={styles.dismissBtn}>
                  <Ionicons name="close" size={18} color="#94A3B8" />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <Pressable testID="home-points-card" onPress={() => router.push("/(tabs)/profile")} style={[styles.pointsCard, { backgroundColor: c.brandTertiary }]}>
          <View style={styles.pointsRow}>
            <Text style={{ fontSize: 40 }}>🦋</Text>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={[styles.pointsLabel, { color: c.onBrandTertiary, fontSize: 16 * scale }]}>Butterfly Points</Text>
              <Text style={[styles.pointsNum, { color: c.onBrandTertiary, fontSize: 32 * scale }]}>{user?.points ?? 0}</Text>
            </View>
            <View style={styles.badgesWrap}>
              {(user?.badges || []).slice(0, 2).map((b) => (
                <Text key={b} style={[styles.badge, { color: c.brand, fontSize: 12 * scale, borderColor: c.brand }]}>{b}</Text>
              ))}
            </View>
          </View>
        </Pressable>

        <View style={styles.grid}>
          {tiles.map((t) => (
            <Pressable
              key={t.key}
              testID={`tile-${t.key}`}
              onPress={() => router.push(t.route as any)}
              style={({ pressed }) => [
                styles.tile,
                { backgroundColor: t.bg, width: t.full ? "100%" : "48%", minHeight: t.full ? 130 : 150, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Ionicons name={t.icon} size={t.full ? 48 : 40} color="#FFFFFF" />
              <Text style={[styles.tileTitle, { fontSize: (t.full ? 24 : 20) * scale }]}>{t.title}</Text>
              {t.full && <Text style={[styles.tileSub, { fontSize: 14 * scale }]}>Pull up a chair & join a chat</Text>}
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, gap: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brandLogo: { width: 170, height: 48 },
  hello: { fontWeight: "600", marginTop: 6 },
  name: { fontWeight: "900", marginTop: 2 },
  iconBtn: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  flutterBox: { borderWidth: 2, borderRadius: 18, padding: 14, backgroundColor: "#F5F3FF", gap: 8 },
  flutterItem: { flexDirection: "row", alignItems: "center", padding: 10, borderRadius: 12, borderWidth: 1, gap: 6 },
  replyBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  dismissBtn: { padding: 6 },
  pointsCard: { borderRadius: 20, padding: 18, marginTop: 4 },
  pointsRow: { flexDirection: "row", alignItems: "center" },
  pointsLabel: { fontWeight: "700" },
  pointsNum: { fontWeight: "900", marginTop: 2 },
  badgesWrap: { gap: 4, alignItems: "flex-end" },
  badge: { borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 4 },
  tile: { borderRadius: 22, padding: 18, justifyContent: "space-between", gap: 8 },
  tileTitle: { color: "#FFFFFF", fontWeight: "800", marginTop: "auto" },
  tileSub: { color: "rgba(255,255,255,0.85)", fontWeight: "600" },
});
