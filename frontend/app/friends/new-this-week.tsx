/**
 * /friends/new-this-week
 *
 * A focused, lightweight screen that shows ONLY the members who joined
 * FriendPlace in the last 7 days. Linked from the "Say hello to N new
 * neighbour(s) this week" row on Home — that row used to dump people into
 * the full Find Friends list, which buried the new arrivals.
 *
 * Data source: `GET /api/community/today` already returns `new_members` —
 * we reuse that endpoint rather than introducing a new one, so the list
 * always stays consistent with what Home advertises.
 *
 * Rows are tappable: each takes you to the user's profile so you can say
 * hi, send a friend request, or start a DM.
 */
import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import AvatarBubble from "@/src/components/AvatarBubble";

type NewMember = {
  id: string;
  first_name?: string;
  username?: string;
  avatar?: string;
  suburb?: string;
  created_at?: string;
};

function joinedDelta(iso?: string): string {
  if (!iso) return "Joined recently";
  try {
    const t = new Date(iso).getTime();
    const hrs = Math.max(0, (Date.now() - t) / 36e5);
    if (hrs < 24) return `Joined ${Math.max(1, Math.round(hrs))}h ago`;
    const days = Math.round(hrs / 24);
    if (days === 1) return "Joined yesterday";
    if (days < 7) return `Joined ${days} days ago`;
    return "Joined this week";
  } catch { return "Joined this week"; }
}

export default function NewThisWeek() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const { show } = useToast();
  const insets = useSafeAreaInsets();
  const [members, setMembers] = useState<NewMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const c2: any = await api.communityToday(user.id);
      setMembers(((c2?.new_members as NewMember[]) || []).filter((u) => u.id !== user.id));
    } catch {
      show("Couldn't load new neighbours — please try again.");
    } finally {
      setLoading(false);
    }
  }, [user, show]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      {/* Page banner matches the consistent top-level banner pattern used
          across the rest of the app — keeps navigation predictable. */}
      <View style={[styles.header, { paddingTop: insets.top + 10, backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <Pressable testID="ntw-back" onPress={() => router.back()} hitSlop={8} style={[styles.backBtn, { borderColor: c.border, backgroundColor: c.surfaceSecondary }]}>
          <Ionicons name="chevron-back" size={22} color={c.onSurface} />
          <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 14 * scale }}>Back</Text>
        </Pressable>
        <View style={{ alignItems: "center", marginTop: 8 }}>
          <Text style={{ fontSize: 30 }}>👋</Text>
          <Text style={[styles.title, { color: c.onSurface, fontSize: 22 * scale }]}>New this week</Text>
          <Text style={[styles.sub, { color: c.muted, fontSize: 13 * scale }]}>Friendly faces who just joined FriendPlace</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 10 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
            tintColor={c.brand}
            colors={[c.brand]}
          />
        }
      >
        {loading ? (
          <Text style={{ color: c.muted, textAlign: "center", marginTop: 24, fontSize: 14 * scale }}>Loading…</Text>
        ) : members.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
            <Text style={{ fontSize: 36, textAlign: "center" }}>🦋</Text>
            <Text style={{ color: c.onSurface, fontWeight: "800", textAlign: "center", marginTop: 8, fontSize: 16 * scale }}>
              No new neighbours just yet
            </Text>
            <Text style={{ color: c.muted, textAlign: "center", marginTop: 4, fontSize: 13 * scale, lineHeight: 18 }}>
              Check back next week — or invite a friend to join FriendPlace and make their week.
            </Text>
            <Pressable
              testID="ntw-invite"
              onPress={() => router.push("/invite" as any)}
              style={[styles.inviteCta, { backgroundColor: c.brand }]}
            >
              <Ionicons name="gift" size={18} color="#FFF" />
              <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 14 * scale }}>Invite a friend</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={{ color: c.muted, fontSize: 13 * scale, marginBottom: 2 }}>
              {members.length} {members.length === 1 ? "person" : "people"} joined in the last 7 days · tap to say hi
            </Text>
            {members.map((m) => (
              <Pressable
                key={m.id}
                testID={`ntw-row-${m.id}`}
                onPress={() => router.push(`/user/${m.id}` as any)}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: c.surfaceSecondary,
                    borderColor: c.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <AvatarBubble value={m.avatar} size={48} fallback="🙂" />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: c.onSurface, fontWeight: "900", fontSize: 16 * scale }}>
                    {m.first_name || m.username || "New member"}
                  </Text>
                  <Text numberOfLines={1} style={{ color: c.muted, fontSize: 13 * scale, marginTop: 2 }}>
                    {joinedDelta(m.created_at)}
                    {m.suburb ? ` · ${m.suburb}` : ""}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={22} color={c.muted} />
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1 },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, alignSelf: "flex-start" },
  title: { fontWeight: "900", marginTop: 6 },
  sub: { fontWeight: "600", marginTop: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  emptyCard: {
    padding: 24,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    marginTop: 12,
  },
  inviteCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    marginTop: 14,
  },
});
