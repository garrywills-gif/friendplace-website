import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import Button from "@/src/components/Button";
import { api } from "@/src/lib/api";

const ALL_BADGES = ["Friendly Butterfly", "Helpful Neighbour", "Social Star", "Community Builder"];

export default function Profile() {
  const { c, scale } = useTheme();
  const { user, refresh, logout } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [friends, setFriends] = useState<any[]>([]);

  useFocusEffect(useCallback(() => {
    (async () => {
      await refresh();
      if (user?.friends?.length) {
        const arr = await Promise.all(user.friends.map((id) => api.getUser(id).catch(() => null)));
        setFriends(arr.filter(Boolean));
      } else setFriends([]);
    })();
  }, [user?.id]));

  if (!user) return <View style={{ flex: 1, backgroundColor: c.surface }} />;

  return (
    <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, backgroundColor: c.surface, paddingBottom: 100 }]}>
      <Pressable testID="profile-back" onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
        <Ionicons name="chevron-back" size={22} color={c.onSurface} />
        <Text style={{ color: c.onSurface, marginLeft: 4, fontWeight: "700", fontSize: 15 * scale }}>Back</Text>
      </Pressable>
      <View style={[styles.hero, { backgroundColor: c.brandTertiary }]}>
        <View style={[styles.avatar, { backgroundColor: c.surfaceSecondary }]}><Text style={{ fontSize: 60 }}>{user.avatar || "🙂"}</Text></View>
        <Text style={[styles.name, { color: c.onSurface, fontSize: 30 * scale }]} testID="profile-name">{user.first_name}</Text>
        <Text style={[styles.user, { color: c.muted, fontSize: 16 * scale }]}>@{user.username} · 📍 {user.suburb || "—"}</Text>
        {!!user.bio && <Text style={[styles.bio, { color: c.onSurface, fontSize: 16 * scale }]}>{user.bio}</Text>}
      </View>

      <View style={[styles.statsCard, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
        <View style={styles.statBox}>
          <Text style={[styles.statNum, { color: c.brand, fontSize: 32 * scale }]}>{user.points}</Text>
          <Text style={[styles.statLab, { color: c.muted, fontSize: 14 * scale }]}>Butterfly Points</Text>
        </View>
        <View style={[styles.divider, { backgroundColor: c.border }]} />
        <View style={styles.statBox}>
          <Text style={[styles.statNum, { color: c.brand, fontSize: 32 * scale }]}>{friends.length}</Text>
          <Text style={[styles.statLab, { color: c.muted, fontSize: 14 * scale }]}>Friends</Text>
        </View>
        <View style={[styles.divider, { backgroundColor: c.border }]} />
        <View style={styles.statBox}>
          <Text style={[styles.statNum, { color: c.brand, fontSize: 32 * scale }]}>{user.badges?.length || 0}</Text>
          <Text style={[styles.statLab, { color: c.muted, fontSize: 14 * scale }]}>Badges</Text>
        </View>
      </View>

      <Text style={[styles.section, { color: c.onSurface, fontSize: 20 * scale }]}>🦋 Badges</Text>
      <View style={styles.badgeWrap}>
        {ALL_BADGES.map((b) => {
          const earned = user.badges?.includes(b);
          return (
            <View key={b} style={[styles.badgeCard, { backgroundColor: earned ? c.brandTertiary : c.surfaceTertiary, borderColor: earned ? c.brand : c.border }]}>
              <Text style={{ fontSize: 30 }}>{earned ? "🏆" : "🔒"}</Text>
              <Text style={{ color: earned ? c.onBrandTertiary : c.muted, fontWeight: "700", marginTop: 6, fontSize: 14 * scale, textAlign: "center" }}>{b}</Text>
            </View>
          );
        })}
      </View>

      <Text style={[styles.section, { color: c.onSurface, fontSize: 20 * scale }]}>🌿 Interests</Text>
      <View style={styles.row}>
        {(user.interests || []).length === 0 && <Text style={{ color: c.muted, fontSize: 15 * scale }}>No interests yet</Text>}
        {(user.interests || []).map((i) => (
          <View key={i} style={[styles.chip, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
            <Text style={{ color: c.onSurface, fontWeight: "700", fontSize: 15 * scale }}>{i}</Text>
          </View>
        ))}
      </View>

      <Text style={[styles.section, { color: c.onSurface, fontSize: 20 * scale }]}>👯 Friends</Text>
      {friends.length === 0 ? (
        <Text style={{ color: c.muted, fontSize: 15 * scale }}>No friends yet — head to "Find Friends" to say hi!</Text>
      ) : (
        <View style={styles.row}>
          {friends.map((f) => (
            <Pressable key={f.id} onPress={() => router.push(`/user/${f.id}` as any)} style={[styles.friendDot, { backgroundColor: c.brandTertiary }]}>
              <Text style={{ fontSize: 28 }}>{f.avatar || "🙂"}</Text>
              <Text style={{ color: c.onBrandTertiary, fontWeight: "700", fontSize: 13 * scale, marginTop: 4 }}>{f.first_name}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <View style={{ height: 24 }} />
      <Button label="Accessibility Settings" variant="outline" onPress={() => router.push("/settings/accessibility")} testID="profile-accessibility" />
      <View style={{ height: 12 }} />
      <Button label="Settings" variant="ghost" onPress={() => router.push("/settings")} testID="profile-settings" />
      <View style={{ height: 12 }} />
      <Button testID="logout" label="Log Out" variant="ghost" onPress={async () => { await logout(); router.replace("/"); }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, gap: 12 },
  backBtn: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1 },
  hero: { alignItems: "center", padding: 20, borderRadius: 24, gap: 8 },
  avatar: { width: 110, height: 110, borderRadius: 55, alignItems: "center", justifyContent: "center" },
  name: { fontWeight: "900", marginTop: 8 },
  user: { fontWeight: "600" },
  bio: { textAlign: "center", marginTop: 6 },
  statsCard: { borderRadius: 18, borderWidth: 1, padding: 16, flexDirection: "row", justifyContent: "space-around", alignItems: "center" },
  statBox: { alignItems: "center", flex: 1 },
  statNum: { fontWeight: "900" },
  statLab: { fontWeight: "600", marginTop: 2, textAlign: "center" },
  divider: { width: 1, height: "70%" },
  section: { fontWeight: "800", marginTop: 8 },
  badgeWrap: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  badgeCard: { width: "47%", minHeight: 110, borderRadius: 18, borderWidth: 2, padding: 10, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1 },
  friendDot: { width: 80, height: 88, borderRadius: 18, alignItems: "center", justifyContent: "center", padding: 6 },
});
