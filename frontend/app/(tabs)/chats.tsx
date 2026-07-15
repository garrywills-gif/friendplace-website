import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl, Platform } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { api } from "@/src/lib/api";
import AvatarBubble from "@/src/components/AvatarBubble";
import FounderMark from "@/src/components/FounderMark";

/**
 * Chats tab — a dedicated conversations list that lives in the bottom nav.
 *
 * WHY: before this, opening a DM and leaving forced the user to find the
 *   other person's profile again to resume — brutal UX for a messaging
 *   app. This gives the standard iMessage/WhatsApp inbox pattern.
 *
 * Row anatomy (left → right):
 *   • Avatar with a live "online now" green dot overlay (auto-hidden if
 *     the peer's privacy is "invisible" or they've been idle > 2 min).
 *   • First name + Founder crest.
 *   • Last message preview (1-line ellipsis) OR italic "Start a
 *     conversation" hint if the thread has no messages yet.
 *   • Right column: human timestamp ("2 min ago" / "Yesterday" / "Mon 3
 *     Jun" / a full date for anything older than a week) + a red pill
 *     unread badge showing the count from the backend.
 *
 * The whole row is a Pressable → opens /dm/{id} which auto-calls
 * /dm/{id}/mark-read on mount, so the badges drop to zero as soon as
 * the user enters the chat.
 */

type Conv = {
  id: string;
  participants: string[];
  updated_at: string;
  other?: {
    id?: string;
    first_name?: string;
    avatar?: string;
    is_founder?: boolean;
    founder_number?: number;
    status?: { code?: string; emoji?: string; label?: string };
  } | null;
  last?: { text?: string; created_at?: string; user_id?: string } | null;
  unread_count?: number;
};

function humanTime(iso?: string): string {
  if (!iso) return "";
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const secs = Math.max(0, Math.floor((now - then) / 1000));
    if (secs < 60) return "just now";
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins} min`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} h`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return "Yesterday";
    if (days < 7) {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { weekday: "short" });
    }
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  } catch {
    return "";
  }
}

export default function Chats() {
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [convs, setConvs] = useState<Conv[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    try {
      const data = await api.myConversations(user.id);
      setConvs(Array.isArray(data) ? data : []);
    } finally {
      setLoaded(true);
    }
  }, [user?.id]);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      {/* Header — matches the visual weight of Home / Lounge headers so the
          tab bar feels consistent. Keeps the "💬 Chats" heading + a friendly
          subtitle counting how many conversations the user has. */}
      <View style={[styles.header, { paddingTop: insets.top + 12, backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ fontSize: 28 }}>💬</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.title, { color: c.onSurface, fontSize: 24 * scale }]}>Chats</Text>
            <Text style={[styles.subtitle, { color: c.muted, fontSize: 13 * scale }]}>
              {convs.length === 0
                ? "Your conversations will appear here"
                : `${convs.length} conversation${convs.length === 1 ? "" : "s"}`}
            </Text>
          </View>
        </View>
      </View>

      <FlatList
        data={convs}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24, gap: 10 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            tintColor={c.brand}
            colors={[c.brand]}
          />
        }
        ListEmptyComponent={
          loaded ? (
            <View style={styles.empty}>
              <Text style={{ fontSize: 48 }}>💬</Text>
              <Text style={[styles.emptyTitle, { color: c.onSurface, fontSize: 18 * scale }]}>No conversations yet</Text>
              <Text style={[styles.emptyBody, { color: c.muted, fontSize: 15 * scale }]}>
                Say hi to someone from Find Friends to start your first chat.
              </Text>
              <Pressable
                testID="chats-empty-find-friends"
                onPress={() => router.push("/friends" as any)}
                style={({ pressed }) => [styles.emptyBtn, { backgroundColor: c.brand, opacity: pressed ? 0.85 : 1 }]}
              >
                <Ionicons name="people" size={18} color="#FFFFFF" />
                <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 15 * scale }}>Find Friends</Text>
              </Pressable>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const online = item.other?.status?.code === "online";
          const unread = Math.max(0, item.unread_count || 0);
          const preview = item.last?.text || "Start a conversation";
          const isMineLast = item.last?.user_id === user?.id;
          const previewPrefix = isMineLast && item.last?.text ? "You: " : "";
          const ts = humanTime(item.last?.created_at || item.updated_at);
          return (
            <Pressable
              testID={`chat-row-${item.id}`}
              onPress={() => router.push(`/dm/${item.id}?other_id=${item.other?.id || ""}` as any)}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: unread > 0 ? c.brandTertiary : c.surfaceSecondary,
                  borderColor: unread > 0 ? c.brand : c.border,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              {/* Avatar + online dot overlay */}
              <View style={styles.avatarWrap}>
                <View style={[styles.av, { backgroundColor: c.brand + "22", overflow: "hidden" }]}>
                  <AvatarBubble value={item.other?.avatar} size={52} textSize={34} fallback="🙂" />
                </View>
                {online && (
                  <View
                    style={[styles.onlineDot, { backgroundColor: "#10B981", borderColor: c.surface }]}
                    testID={`chat-online-${item.id}`}
                  />
                )}
              </View>

              {/* Name + preview */}
              <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Text
                    numberOfLines={1}
                    style={[styles.name, { color: c.onSurface, fontSize: 17 * scale, fontWeight: unread > 0 ? "900" : "800" }]}
                  >
                    {item.other?.first_name || "Friend"}
                  </Text>
                  <FounderMark user={item.other as any} size={14} testID={`chat-founder-${item.id}`} />
                </View>
                <Text
                  numberOfLines={1}
                  style={{
                    color: unread > 0 ? c.onSurface : c.muted,
                    marginTop: 2,
                    fontSize: 14 * scale,
                    fontWeight: unread > 0 ? "700" : "500",
                    fontStyle: item.last?.text ? "normal" : "italic",
                  }}
                >
                  {previewPrefix}
                  {preview}
                </Text>
              </View>

              {/* Right: timestamp + unread pill */}
              <View style={styles.right}>
                <Text style={[styles.ts, { color: unread > 0 ? c.brand : c.muted, fontSize: 12 * scale, fontWeight: unread > 0 ? "800" : "600" }]}>
                  {ts}
                </Text>
                {unread > 0 ? (
                  <View style={[styles.unreadPill, { backgroundColor: c.brand }]}>
                    <Text style={styles.unreadText}>{unread > 99 ? "99+" : unread}</Text>
                  </View>
                ) : (
                  <Ionicons name="chevron-forward" size={18} color={c.muted} style={{ marginTop: 6 }} />
                )}
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    // A soft shadow underneath the header on iOS so the list feels
    // anchored below a "sticky" section. Android's elevation is subtle
    // enough that we skip it to avoid double-outline against the border.
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3 },
      default: {},
    }),
  },
  title: { fontWeight: "900" },
  subtitle: { fontWeight: "600", marginTop: 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  avatarWrap: { position: "relative" },
  av: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  onlineDot: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
  },
  name: { flexShrink: 1 },
  right: { alignItems: "flex-end", justifyContent: "center", marginLeft: 8, minWidth: 44 },
  ts: { marginBottom: 4 },
  unreadPill: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  unreadText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  empty: {
    alignItems: "center",
    marginTop: 60,
    gap: 12,
    paddingHorizontal: 24,
  },
  emptyTitle: { fontWeight: "900", textAlign: "center" },
  emptyBody: { fontWeight: "600", textAlign: "center", lineHeight: 20 },
  emptyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 999,
    marginTop: 8,
  },
});
