import React, { useCallback, useRef, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, Pressable, RefreshControl, Platform, Animated,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import AvatarWithBadge from "@/src/components/status/AvatarWithBadge";
import FounderMark from "@/src/components/FounderMark";

/**
 * Chats tab — a dedicated conversations list that lives in the bottom nav.
 *
 * WHY: before this, opening a DM and leaving forced the user to find the
 *   other person's profile again to resume — brutal UX for a messaging
 *   app. This gives the standard iMessage/WhatsApp inbox pattern.
 *
 * Interactions:
 *   • Tap a row → opens /dm/{id} (auto-marks the conversation read).
 *   • Swipe LEFT on a row → reveals Archive (or Unarchive if already
 *     archived) + Delete buttons, WhatsApp-style.
 *   • Delete asks for confirmation, then soft-deletes (per-user only —
 *     the peer still sees the thread). A 5-second "Undo" snackbar pops
 *     up at the bottom.
 *   • Archive is silent — instant with an Undo snackbar too.
 *   • Filter pill at the top toggles between Active ↔ Archived views.
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
  is_archived?: boolean;
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

/**
 * Inline undo snackbar — appears at the bottom of the screen with a
 * "UNDO" action button. Auto-dismisses after 5 s. We keep this local to
 * the Chats screen (rather than extending the global toast) because the
 * action button + timeout semantics differ from the generic toast.
 */
function UndoSnack({
  visible, label, onUndo, onDismiss, insetsBottom, brand, surface, onSurface, error,
}: {
  visible: boolean;
  label: string;
  onUndo: () => void;
  onDismiss: () => void;
  insetsBottom: number;
  brand: string;
  surface: string;
  onSurface: string;
  error: string;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  const timer = useRef<any>(null);

  React.useEffect(() => {
    if (visible) {
      Animated.timing(anim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => onDismiss(), 5000);
    } else {
      Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true }).start();
    }
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [visible, anim, onDismiss]);

  if (!visible) return null;
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.snack,
        {
          bottom: insetsBottom + 76, // above the tab bar
          backgroundColor: "#1F2937",
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
        },
      ]}
    >
      <Ionicons name="information-circle-outline" size={20} color="#FFFFFF" />
      <Text style={styles.snackText} numberOfLines={1}>{label}</Text>
      <Pressable
        testID="chats-undo-btn"
        onPress={() => {
          if (timer.current) clearTimeout(timer.current);
          onUndo();
        }}
        style={({ pressed }) => [
          styles.snackAction,
          { backgroundColor: pressed ? brand + "40" : "transparent" },
        ]}
      >
        <Text style={[styles.snackActionText, { color: brand }]}>UNDO</Text>
      </Pressable>
    </Animated.View>
  );
}

export default function Chats() {
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const { show, confirm } = useToast();
  const insets = useSafeAreaInsets();

  const [convs, setConvs] = useState<Conv[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<"active" | "archived">("active");
  const [archivedCount, setArchivedCount] = useState<number>(0);

  // Undo snackbar state
  const [undo, setUndo] = useState<{ visible: boolean; label: string; action: () => Promise<void> } | null>(null);

  // Refs to close any open swipeable when another opens / on navigation
  const swipeableRefs = useRef<Record<string, Swipeable | null>>({});
  const openRowKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    try {
      const [data, meta] = await Promise.all([
        api.myConversations(user.id, view),
        api.dmArchivedCount(user.id).catch(() => ({ count: 0 })),
      ]);
      setConvs(Array.isArray(data) ? data : []);
      setArchivedCount((meta as any)?.count || 0);
    } finally {
      setLoaded(true);
    }
  }, [user?.id, view]);

  useFocusEffect(useCallback(() => {
    load();
    return () => {
      // Close any open row when leaving the screen
      Object.values(swipeableRefs.current).forEach((r) => r?.close());
    };
  }, [load]));

  const closeRow = (id: string) => {
    swipeableRefs.current[id]?.close();
    openRowKey.current = null;
  };

  const handleArchive = async (conv: Conv) => {
    closeRow(conv.id);
    // Optimistic: remove from active list immediately
    setConvs((prev) => prev.filter((c) => c.id !== conv.id));
    setArchivedCount((n) => n + 1);
    try {
      await api.dmArchive(conv.id);
    } catch {
      show("Couldn't archive — try again");
      await load();
      return;
    }
    setUndo({
      visible: true,
      label: `Archived ${conv.other?.first_name || "chat"}`,
      action: async () => {
        setUndo(null);
        try {
          await api.dmUnarchive(conv.id);
          await load();
          show("Restored");
        } catch { show("Couldn't undo"); }
      },
    });
  };

  const handleUnarchive = async (conv: Conv) => {
    closeRow(conv.id);
    setConvs((prev) => prev.filter((c) => c.id !== conv.id));
    setArchivedCount((n) => Math.max(0, n - 1));
    try { await api.dmUnarchive(conv.id); } catch { show("Couldn't unarchive"); await load(); return; }
    show(`Moved back to Chats`);
  };

  const handleDelete = async (conv: Conv) => {
    closeRow(conv.id);
    const ok = await confirm({
      title: `Delete chat with ${conv.other?.first_name || "this person"}?`,
      message: "The conversation will disappear from your list. The other person can still see it and message you again.",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!ok) return;
    // Optimistic remove
    setConvs((prev) => prev.filter((c) => c.id !== conv.id));
    try {
      await api.dmHide(conv.id);
    } catch {
      show("Couldn't delete — try again");
      await load();
      return;
    }
    setUndo({
      visible: true,
      label: `Deleted chat with ${conv.other?.first_name || "friend"}`,
      action: async () => {
        setUndo(null);
        try {
          await api.dmUnhide(conv.id);
          await load();
          show("Restored");
        } catch { show("Couldn't undo"); }
      },
    });
  };

  const renderRightActions = (conv: Conv, progress: Animated.AnimatedInterpolation<number>) => {
    // Two 76pt-wide buttons with a slide-in scale on the icon so the
    // gesture feels tactile. Colours borrowed from iOS Mail:
    // Archive = amber, Delete = red.
    const isArchivedView = conv.is_archived === true;
    const scale = progress.interpolate({
      inputRange: [0, 1],
      outputRange: [0.85, 1],
      extrapolate: "clamp",
    });
    return (
      <View style={styles.actionsWrap}>
        <Animated.View style={{ transform: [{ scale }] }}>
          <Pressable
            testID={`chat-${isArchivedView ? "unarchive" : "archive"}-${conv.id}`}
            onPress={() => (isArchivedView ? handleUnarchive(conv) : handleArchive(conv))}
            style={[styles.actionBtn, { backgroundColor: isArchivedView ? "#10B981" : "#F59E0B" }]}
          >
            <Ionicons
              name={(isArchivedView ? "arrow-undo" : "archive") as any}
              size={22}
              color="#FFFFFF"
            />
            <Text style={styles.actionLabel}>
              {isArchivedView ? "Unarchive" : "Archive"}
            </Text>
          </Pressable>
        </Animated.View>
        <Animated.View style={{ transform: [{ scale }] }}>
          <Pressable
            testID={`chat-delete-${conv.id}`}
            onPress={() => handleDelete(conv)}
            style={[styles.actionBtn, { backgroundColor: "#EF4444" }]}
          >
            <Ionicons name="trash" size={22} color="#FFFFFF" />
            <Text style={styles.actionLabel}>Delete</Text>
          </Pressable>
        </Animated.View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      {/* Header — matches the visual weight of Home / Lounge headers so the
          tab bar feels consistent. Keeps the "💬 Chats" heading + a friendly
          subtitle counting how many conversations the user has. */}
      <View style={[styles.header, { paddingTop: insets.top + 12, backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ fontSize: 28 }}>💬</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.title, { color: c.onSurface, fontSize: 24 * scale }]}>
              {view === "archived" ? "Archived" : "Chats"}
            </Text>
            <Text style={[styles.subtitle, { color: c.muted, fontSize: 13 * scale }]}>
              {convs.length === 0
                ? (view === "archived" ? "Nothing archived" : "Your conversations will appear here")
                : `${convs.length} conversation${convs.length === 1 ? "" : "s"}`}
            </Text>
          </View>
          {/* View toggle: only show Archive pill when the user actually
              has archived items — otherwise it's noise. */}
          {view === "archived" ? (
            <Pressable
              testID="chats-back-to-active"
              onPress={() => setView("active")}
              style={({ pressed }) => [styles.togglePill, { borderColor: c.brand, opacity: pressed ? 0.7 : 1 }]}
            >
              <Ionicons name="arrow-back" size={14} color={c.brand} />
              <Text style={[styles.togglePillText, { color: c.brand }]}>Chats</Text>
            </Pressable>
          ) : archivedCount > 0 ? (
            <Pressable
              testID="chats-view-archived"
              onPress={() => setView("archived")}
              style={({ pressed }) => [styles.togglePill, { borderColor: c.border, backgroundColor: c.surfaceSecondary, opacity: pressed ? 0.7 : 1 }]}
            >
              <Ionicons name="archive" size={14} color={c.muted} />
              <Text style={[styles.togglePillText, { color: c.muted }]}>{archivedCount}</Text>
            </Pressable>
          ) : null}
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
              <Text style={{ fontSize: 48 }}>{view === "archived" ? "📥" : "💬"}</Text>
              <Text style={[styles.emptyTitle, { color: c.onSurface, fontSize: 18 * scale }]}>
                {view === "archived" ? "No archived chats" : "No conversations yet"}
              </Text>
              <Text style={[styles.emptyBody, { color: c.muted, fontSize: 15 * scale }]}>
                {view === "archived"
                  ? "Chats you archive will appear here so your inbox stays tidy."
                  : "Say hi to someone from Find Friends to start your first chat."}
              </Text>
              {view === "active" && (
                <Pressable
                  testID="chats-empty-find-friends"
                  onPress={() => router.push("/friends" as any)}
                  style={({ pressed }) => [styles.emptyBtn, { backgroundColor: c.brand, opacity: pressed ? 0.85 : 1 }]}
                >
                  <Ionicons name="people" size={18} color="#FFFFFF" />
                  <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 15 * scale }}>Find Friends</Text>
                </Pressable>
              )}
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const unread = Math.max(0, item.unread_count || 0);
          const preview = item.last?.text || "Start a conversation";
          const isMineLast = item.last?.user_id === user?.id;
          const previewPrefix = isMineLast && item.last?.text ? "You: " : "";
          const ts = humanTime(item.last?.created_at || item.updated_at);
          return (
            <Swipeable
              ref={(ref) => { swipeableRefs.current[item.id] = ref; }}
              renderRightActions={(progress) => renderRightActions(item, progress)}
              onSwipeableWillOpen={() => {
                // Close any previously-open row so only one is expanded at a time
                if (openRowKey.current && openRowKey.current !== item.id) {
                  swipeableRefs.current[openRowKey.current]?.close();
                }
                openRowKey.current = item.id;
              }}
              rightThreshold={40}
              overshootRight={false}
            >
              <Pressable
                testID={`chat-row-${item.id}`}
                onLongPress={() => {
                  // Long-press = accessibility fallback for swipe
                  swipeableRefs.current[item.id]?.openRight();
                }}
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
                {/* Avatar + status badge (Presence & Status v2) — the
                    corner glyph replaces the old green online dot. See
                    /app/memory/design-presence-and-status.md §5.4. */}
                <View style={styles.avatarWrap}>
                  <View style={[styles.av, { backgroundColor: c.brand + "22", overflow: "hidden" }]}>
                    <AvatarWithBadge
                      value={item.other?.avatar}
                      userId={item.other?.id}
                      size={52}
                      textSize={34}
                      fallback="🙂"
                    />
                  </View>
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
            </Swipeable>
          );
        }}
      />

      <UndoSnack
        visible={!!undo?.visible}
        label={undo?.label || ""}
        onUndo={() => undo?.action?.()}
        onDismiss={() => setUndo(null)}
        insetsBottom={insets.bottom}
        brand={c.brand}
        surface={c.surface}
        onSurface={c.onSurface}
        error={c.error}
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
  togglePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  togglePillText: { fontSize: 12, fontWeight: "800" },
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
    // Legacy — replaced by AvatarWithBadge (Presence & Status v2).
    // Kept in the stylesheet only for reference in case a follow-up
    // surface needs a pure "online" dot again. Not referenced by any
    // <View> today. Safe to delete in Commit 3 cleanup pass.
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
  // Swipe actions on the right of a row. Each button is a square-ish
  // pill so text fits underneath the icon comfortably.
  actionsWrap: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 0,
    gap: 6,
    marginLeft: 6,
  },
  actionBtn: {
    width: 76,
    height: 78,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  actionLabel: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  snack: {
    position: "absolute",
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 10,
    borderRadius: 12,
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.24, shadowRadius: 12 },
      default: { elevation: 6 },
    }),
  },
  snackText: { color: "#FFFFFF", fontSize: 14, fontWeight: "600", flex: 1 },
  snackAction: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6 },
  snackActionText: { fontSize: 13, fontWeight: "900", letterSpacing: 0.5 },
});
