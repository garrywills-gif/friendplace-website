import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl, Modal, TextInput, KeyboardAvoidingView, Platform, Image } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Button from "@/src/components/Button";
import AvatarBubble from "@/src/components/AvatarBubble";
import FounderMark from "@/src/components/FounderMark";

// The primary FriendPlace butterfly logo — surfaces on every page header
// so the brand mark stays consistent across the app.
const BUTTERFLY_LOGO = require("../../assets/brand/friendplace-app-icon-v5.png");

function occupancyLabel(seated: number): { label: string; color: string; icon: keyof typeof Ionicons.glyphMap } {
  if (seated === 0) return { label: "Empty Table", color: "#94A3B8", icon: "ellipse-outline" };
  if (seated === 1) return { label: "1 Person", color: "#0EA5E9", icon: "person" };
  if (seated <= 7) return { label: `${seated} People`, color: "#0F766E", icon: "people" };
  return { label: "Full Table", color: "#B45309", icon: "people-circle" };
}

/** Lightweight relative-time label — small enough to feel like polish without
 *  pulling in date-fns. Always rounds toward the most useful unit. */
function timeAgo(iso?: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!then) return "";
  const mins = Math.max(0, Math.floor((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
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
  const [showHelp, setShowHelp] = useState(false);
  // "Founders Lounge — Founding Members only" gate. Opens when a
  // non-founder taps a founder-only table; never shown to founders.
  const [showFounderGate, setShowFounderGate] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("☕");
  const [desc, setDesc] = useState("");
  const [visibility, setVisibility] = useState<"public" | "friends">("public");

  const load = async () => {
    try { setTables(await api.listTables(user?.id)); } catch (e) { show("Failed to load lounge"); }
  };
  // Refresh on focus AND every 30s while the screen is in view so presence
  // (active-now, friends-here) feels live without a manual pull-to-refresh.
  useFocusEffect(useCallback(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [user?.id]));

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
        <View style={styles.headRow}>
          <Pressable
            testID="lounge-back"
            onPress={() => {
              // Coffee Lounge is a top-level tab, so "back" always means
              // Home. router.back() silently no-ops on iPad Safari from a
              // hard-loaded tab route (history is empty) and could take
              // the user off the app entirely; a hard URL change on web +
              // router.replace on native are both deterministic and never
              // strand the user on a login-looking screen.
              if (Platform.OS === "web") {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (window as any).location.assign("/home");
              } else {
                router.replace("/home" as any);
              }
            }}
            hitSlop={12}
            accessibilityLabel="Back to Home"
            style={({ pressed }) => [styles.backBtn, { backgroundColor: c.surfaceSecondary, borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}
          >
            <Ionicons name="chevron-back" size={26} color={c.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={[styles.title, { color: c.onSurface, fontSize: 28 * scale }]}>Coffee Lounge ☕</Text>
              <Pressable
                testID="lounge-info-btn"
                onPress={() => setShowHelp(true)}
                hitSlop={12}
                accessibilityLabel="How Coffee Lounge works"
                style={({ pressed }) => [styles.infoBtn, { backgroundColor: c.brandTertiary, opacity: pressed ? 0.7 : 1 }]}
              >
                <Ionicons name="information-circle" size={26} color={c.brand} />
              </Pressable>
            </View>
            <Pressable testID="lounge-how-link" onPress={() => setShowHelp(true)} hitSlop={6}>
              <Text style={[styles.sub, { color: c.muted, fontSize: 16 * scale }]}>
                Pull up a chair and join a chat ·{" "}
                <Text style={{ color: c.brand, fontWeight: "800", textDecorationLine: "underline" }}>How it works</Text>
              </Text>
            </Pressable>
          </View>
          <Image source={BUTTERFLY_LOGO} style={styles.brandMark} resizeMode="contain" accessibilityLabel="FriendPlace" />
        </View>
        {/* Top-of-screen "Start a new table" CTA, in teal/butterfly green
            (the brand accent). Placed here — above the table list — so
            users see it before scrolling, and styled deliberately
            differently from the navy "Take a Seat" join buttons so the
            two distinct actions (join vs. host) are visually separated. */}
        <Pressable
          testID="create-table-top"
          onPress={() => setCreating(true)}
          accessibilityRole="button"
          accessibilityLabel="Start your own table"
          style={({ pressed }) => [
            styles.createTopBtn,
            { backgroundColor: c.accent, opacity: pressed ? 0.88 : 1 },
          ]}
        >
          <Ionicons name="add-circle" size={22} color="#FFFFFF" />
          <Text style={[styles.createTopBtnText, { fontSize: 17 * scale }]}>
            Start your own table
          </Text>
        </Pressable>
      </View>

      <FlatList
        data={tables}
        keyExtractor={(t) => t.id}
        contentContainerStyle={[{ padding: 16, paddingBottom: 110, gap: 12 }, tables.length === 0 && { flexGrow: 1, justifyContent: "center" }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListEmptyComponent={() => (
          <View style={styles.emptyState} testID="lounge-empty">
            <Text style={styles.emptyEmoji}>☕</Text>
            <Text style={[styles.emptyTitle, { color: c.onSurface, fontSize: 22 * scale }]}>Be the first to pull up a chair</Text>
            <Text style={[styles.emptyBody, { color: c.muted, fontSize: 15 * scale }]}>
              The Coffee Lounge is quiet right now. Start a table and we&apos;ll let your friends know.
            </Text>
            <Pressable
              testID="lounge-empty-create"
              onPress={() => setCreating(true)}
              style={({ pressed }) => [styles.emptyBtn, { backgroundColor: c.brand, opacity: pressed ? 0.85 : 1 }]}
              accessibilityLabel="Create a new table"
            >
              <Text style={{ color: c.onBrandPrimary, fontWeight: "800", fontSize: 16 * scale }}>+ Start a Table</Text>
            </Pressable>
          </View>
        )}
        renderItem={({ item }) => {
          const seatedCount = (item.seated || []).length;
          const occ = occupancyLabel(seatedCount);
          const active = seatedCount >= 2;
          const ago = timeAgo(item.last_activity_at || item.created_at);
          return (
            <Pressable
              testID={`table-${item.id}`}
              onPress={() => {
                // Gate non-founders from the Founders Lounge with a kind
                // explainer modal instead of a hard 403 on the chat page.
                if (item.founder_only && !(user as any)?.is_founder) {
                  setShowFounderGate(true);
                  return;
                }
                router.push(`/table/${item.id}` as any);
              }}
              style={({ pressed }) => [styles.card, { backgroundColor: c.surfaceSecondary, borderColor: item.founder_only ? "#D4A017" : (active ? "#10B981" : c.border), borderWidth: (item.founder_only || active) ? 2 : 1, opacity: pressed ? 0.85 : 1 }]}
            >
              <View style={styles.topRow}>
                <Text style={{ fontSize: 44 }}>{item.emoji}</Text>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                    <Text style={[styles.cardTitle, { color: c.onSurface, fontSize: 22 * scale }]}>{item.name}</Text>
                    {item.founder_only && (
                      <View style={[styles.founderBadge]} testID={`founder-badge-${item.id}`}>
                        <Text style={styles.founderBadgeText}>🦋 FOUNDERS</Text>
                      </View>
                    )}
                    {active && (
                      <View style={[styles.activeBadge, { backgroundColor: "#10B981" }]} testID={`active-${item.id}`}>
                        <View style={styles.activeDot} />
                        <Text style={[styles.activeText, { fontSize: 12 * scale }]}>Active Now</Text>
                      </View>
                    )}
                  </View>
                  {!!item.description && <Text style={[styles.cardDesc, { color: c.muted, fontSize: 15 * scale }]} numberOfLines={2}>{item.description}</Text>}
                  {/* Host attribution + relative time — gives the card a human signature. */}
                  {(item.host_display || ago) && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
                      {item.host_display && <AvatarBubble value={item.host_display.avatar} size={16} />}
                      <Text style={[styles.agoText, { color: c.muted, fontSize: 12 * scale }]} numberOfLines={1}>
                        {item.host_display ? `Started by ${item.host_display.first_name}` : "Started"}
                        {ago ? ` · ${active ? "active now" : ago}` : ""}
                      </Text>
                      {item.host_display?.is_founder && (
                        <FounderMark
                          isFounder
                          founderNumber={item.host_display.founder_number}
                          size={13}
                          testID={`lounge-host-founder-${item.id}`}
                        />
                      )}
                    </View>
                  )}
                  {/* Friends-at-table chip — strongest reason to tap in. */}
                  {Array.isArray(item.friends_seated) && item.friends_seated.length > 0 && (
                    <View style={[styles.friendChip, { backgroundColor: c.brandTertiary }]} testID={`friends-here-${item.id}`}>
                      <View style={{ flexDirection: "row" }}>
                        {item.friends_seated.slice(0, 3).map((f: any, i: number) => (
                          <View
                            key={f.id}
                            style={{
                              width: 22, height: 22, borderRadius: 11,
                              backgroundColor: c.surface, borderWidth: 2, borderColor: c.brandTertiary,
                              marginLeft: i === 0 ? 0 : -6,
                              overflow: "hidden",
                              alignItems: "center", justifyContent: "center",
                            }}
                          >
                            <AvatarBubble value={f.avatar} size={18} textSize={13} />
                          </View>
                        ))}
                      </View>
                      <Text style={[styles.friendChipText, { color: c.brand, fontSize: 12 * scale }]} numberOfLines={1}>
                        {item.friends_seated.length === 1
                          ? `${item.friends_seated[0].first_name} is here`
                          : item.friends_seated.length === 2
                            ? `${item.friends_seated[0].first_name} & ${item.friends_seated[1].first_name} are here`
                            : `${item.friends_seated[0].first_name} +${item.friends_seated.length - 1} friends are here`}
                      </Text>
                    </View>
                  )}
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
                <View style={[styles.joinBtn, { backgroundColor: (item.founder_only && !(user as any)?.is_founder) ? "#D4A017" : c.brand }]}>
                  <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 16 * scale }}>
                    {item.founder_only && !(user as any)?.is_founder
                      ? "🦋 Founders Only"
                      : (seatedCount === 0 ? "Start a Chat" : "Take a Seat")}
                  </Text>
                </View>
              </View>
            </Pressable>
          );
        }}
      />

      {/* Floating FAB removed — replaced by the prominent teal "Start your
          own table" CTA at the top of the screen so users see the host
          action above the list, not floating over it. The empty-state and
          modal still provide secondary entry points. */}

      {/* How-it-works modal — single, dismissible. Mirrors the user-approved
          wording. Pre-existing tables stay; only inactive ones get pruned. */}
      <Modal visible={showHelp} animationType="fade" transparent onRequestClose={() => setShowHelp(false)}>
        <Pressable style={styles.helpBackdrop} onPress={() => setShowHelp(false)}>
          <Pressable style={[styles.helpSheet, { backgroundColor: c.surface }]} onPress={(e: any) => e.stopPropagation && e.stopPropagation()}>
            <View style={[styles.helpIconWrap, { backgroundColor: c.brandTertiary }]}>
              <Ionicons name="information-circle" size={40} color={c.brand} />
            </View>
            <Text style={[styles.helpTitle, { color: c.onSurface, fontSize: 22 * scale }]}>How Coffee Lounge Works</Text>
            <Text style={[styles.helpBody, { color: c.onSurface, fontSize: 16 * scale }]}>
              Coffee Lounge is designed for casual conversations.{"\n\n"}
              <Text style={{ fontWeight: "700" }}>Tables and chat history that remain inactive for 24 hours are automatically removed.</Text>{"\n\n"}
              Active conversations stay near the top, so you&apos;ll always find what&apos;s lively first.
            </Text>
            <Pressable testID="lounge-help-close" onPress={() => setShowHelp(false)} style={[styles.helpBtn, { backgroundColor: c.brand }]}>
              <Text style={{ color: c.onBrandPrimary, fontWeight: "800", fontSize: 17 * scale }}>Got it</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Founder-only access gate — shown when a non-founder taps the
          Founders Lounge table. Routes them to the public Founders Wall
          so they can still see who's already inside. */}
      <Modal visible={showFounderGate} animationType="fade" transparent onRequestClose={() => setShowFounderGate(false)}>
        <Pressable style={styles.helpBackdrop} onPress={() => setShowFounderGate(false)}>
          <Pressable style={[styles.helpSheet, { backgroundColor: c.surface }]} onPress={(e: any) => e.stopPropagation && e.stopPropagation()}>
            <Text style={{ fontSize: 56 }}>🦋</Text>
            <Text style={[styles.helpTitle, { color: c.onSurface, fontSize: 22 * scale }]}>Founders Lounge</Text>
            <Text style={[styles.helpBody, { color: c.onSurface, fontSize: 16 * scale }]}>
              This table is just for Founding Members — the first 500 people to join FriendPlace.
              {"\n\n"}
              <Text style={{ fontWeight: "700" }}>Spots are still open.</Text> Take a peek at the Wall to see who&apos;s already inside.
            </Text>
            <Pressable
              testID="founder-gate-view-wall"
              onPress={() => { setShowFounderGate(false); router.push("/founders"); }}
              style={[styles.helpBtn, { backgroundColor: c.brand }]}
            >
              <Text style={{ color: c.onBrandPrimary, fontWeight: "800", fontSize: 17 * scale }}>See the Founders Wall</Text>
            </Pressable>
            <Pressable
              testID="founder-gate-close"
              onPress={() => setShowFounderGate(false)}
              style={[styles.helpBtn, { backgroundColor: c.surfaceSecondary, marginTop: 0 }]}
            >
              <Text style={{ color: c.onSurface, fontWeight: "700", fontSize: 16 * scale }}>Maybe later</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

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
  head: { paddingHorizontal: 16, paddingBottom: 8 },
  headRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { fontWeight: "900" },
  sub: { fontWeight: "600", marginTop: 4 },
  infoBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  backBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  brandMark: { width: 40, height: 40, borderRadius: 10, marginLeft: 8 },
  card: { borderRadius: 20, padding: 16, shadowColor: "#0F172A", shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2, gap: 10 },
  topRow: { flexDirection: "row", alignItems: "center" },
  cardTitle: { fontWeight: "800" },
  cardDesc: { marginTop: 2, fontWeight: "500" },
  agoText: { marginTop: 4, fontWeight: "600" },
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
  createTopBtn: {
    // Slice 3 v7 (Garry, 22 July 2026): left-aligned and only as wide
    // as its content so George's inline header butterfly (mounted
    // top-right) never overlaps it. Original padding + font size kept
    // — only the layout was changed.
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    gap: 8,
    marginTop: 14,
    marginLeft: 16,
    marginRight: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 999,
    minHeight: 52,
    shadowColor: "#0F172A",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  createTopBtnText: { color: "#FFFFFF", fontWeight: "900", letterSpacing: 0.2 },
  fabText: { color: "#FFFFFF", fontWeight: "800", fontSize: 16 },
  helpBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 24 },
  helpSheet: { width: "100%", maxWidth: 460, borderRadius: 24, padding: 24, alignItems: "center", gap: 14 },
  helpIconWrap: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  helpTitle: { fontWeight: "900", textAlign: "center" },
  helpBody: { lineHeight: 24, textAlign: "center" },
  helpBtn: { marginTop: 4, alignSelf: "stretch", alignItems: "center", paddingVertical: 14, borderRadius: 999, minHeight: 48 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, gap: 12 },
  modalHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { fontWeight: "800" },
  modalClose: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  emojiPick: { width: 48, height: 48, borderRadius: 24, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  input: { borderWidth: 2, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontWeight: "600" },
  chip: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999, borderWidth: 2, minHeight: 44 },
  friendChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    marginTop: 6,
    alignSelf: "flex-start",
  },
  friendChipText: { fontWeight: "800", flexShrink: 1 },
  emptyState: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 48,
    gap: 12,
  },
  emptyEmoji: { fontSize: 56 },
  emptyTitle: { fontWeight: "900", textAlign: "center" },
  emptyBody: { fontWeight: "600", textAlign: "center", lineHeight: 22 },
  emptyBtn: { paddingHorizontal: 24, paddingVertical: 14, borderRadius: 999, marginTop: 6 },
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
