import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Platform, RefreshControl } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import SpeakButton from "@/src/components/SpeakButton";
import ShareYouBelong from "@/src/components/ShareYouBelong";
import { getThoughtForDate, getRandomThought, loadFavourites, toggleFavourite } from "@/src/lib/thoughts";

type Tile = { key: string; title: string; icon: keyof typeof Ionicons.glyphMap; route: string; bg: string; full?: boolean };

export default function Home() {
  const router = useRouter();
  const { c, scale, prefs } = useTheme();
  const { user } = useAuth();
  const { show } = useToast();
  const insets = useSafeAreaInsets();
  const [flutters, setFlutters] = useState<any[]>([]);
  const [unread, setUnread] = useState<number>(0);
  const [refreshing, setRefreshing] = useState(false);
  const [thought, setThought] = useState<string>(() => getThoughtForDate());
  const [isFav, setIsFav] = useState<boolean>(false);
  const [community, setCommunity] = useState<any>(null);
  const [invitedCount, setInvitedCount] = useState<number>(0);

  const shuffleThought = () => setThought((t) => getRandomThought(t));

  /**
   * Switch to a sibling tab (or push a stack route). expo-router's
   * router.push/replace/navigate silently no-ops when switching between
   * sibling tabs on web (iPad Safari), so we fall back to a hard URL
   * change there. On native, router.replace works correctly.
   */
  const goTo = useCallback((href: string) => {
    if (Platform.OS === "web") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).location.assign(href);
    } else {
      router.replace(href as any);
    }
  }, [router]);

  // Gate: send brand-new users through the welcome tour first.
  useEffect(() => {
    if (user && (user as any).onboarding_completed === false) {
      router.replace("/onboarding");
    }
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await loadFavourites();
      if (!cancelled) setIsFav(list.includes(thought));
    })();
    return () => { cancelled = true; };
  }, [thought]);

  const toggleFav = async () => {
    const r = await toggleFavourite(thought);
    setIsFav(r.isFav);
  };

  const loadFlutters = async () => {
    if (!user) return;
    try { setFlutters(await api.myFlutters(user.id)); } catch {}
    try { const r: any = await api.notificationCount(user.id); setUnread(r?.unread || 0); } catch {}
    try { await api.heartbeat(user.id); } catch {}
    try { setCommunity(await api.communityToday(user.id)); } catch {}
    try {
      const s: any = await api.inviteStats(user.id);
      setInvitedCount(Number(s?.count) || 0);
    } catch {}
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
    { key: "lounge", title: "Coffee Lounge", icon: "cafe", route: "/lounge", bg: "#0F766E", full: true },
    { key: "friends", title: "Find Friends", icon: "people", route: "/friends", bg: "#0369A1" },
    { key: "events", title: "Local Events", icon: "calendar", route: "/events", bg: "#0EA5E9" },
    { key: "recipes", title: "Post Your Recipe", icon: "restaurant", route: "/recipes", bg: "#B45309" },
    { key: "groups", title: "Community Groups", icon: "earth", route: "/groups", bg: "#14B8A6" },
    { key: "notices", title: "Notice Board", icon: "newspaper", route: "/notices", bg: "#0891B2" },
    { key: "games", title: "Games", icon: "game-controller", route: "/games", bg: "#0284C7" },
    { key: "profile", title: "My Profile", icon: "person-circle", route: "/profile", bg: "#475569" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 12, paddingBottom: 24 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await loadFlutters(); setRefreshing(false); }}
            tintColor={c.brand}
            colors={[c.brand]}
          />
        }
      >
        <View style={styles.headerRow}>
          <View style={[styles.iconBtn, { backgroundColor: "transparent", borderColor: "transparent" }]} />
          <Text style={[styles.brand, { color: c.brand, fontSize: 26 * scale }]}>YouBelong</Text>
          <Pressable testID="home-notifications" onPress={() => router.push("/notifications")} style={[styles.iconBtn, { backgroundColor: c.surfaceSecondary, borderColor: c.border, marginRight: 8 }]}>
            <Ionicons name="notifications-outline" size={24} color={c.onSurface} />
            {unread > 0 && (
              <View style={[styles.bellBadge, { backgroundColor: c.error }]}>
                <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 11 }}>{unread > 9 ? "9+" : unread}</Text>
              </View>
            )}
          </Pressable>
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

        <View style={[styles.thoughtCard, { backgroundColor: c.surfaceSecondary, borderColor: c.brand }]} testID="todays-thought">
          <View style={styles.thoughtHead}>
            <View style={[styles.thoughtChip, { backgroundColor: c.brandTertiary }]}>
              <Ionicons name="sunny" size={14} color={c.brand} />
              <Text style={[styles.thoughtChipText, { color: c.brand, fontSize: 12 * scale }]}>TODAY'S THOUGHT</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              {prefs.readMessagesAloud && (
                <SpeakButton text={thought} color={c.brand} size={22} testID="thought-speak" />
              )}
              <Pressable testID="thought-fav" onPress={toggleFav} hitSlop={6} style={styles.thoughtIconBtn} accessibilityLabel={isFav ? "Remove from favourites" : "Save to favourites"}>
                <Ionicons name={isFav ? "heart" : "heart-outline"} size={22} color={isFav ? c.error : c.brand} />
              </Pressable>
              <Pressable testID="thought-shuffle" onPress={shuffleThought} hitSlop={6} style={styles.thoughtIconBtn} accessibilityLabel="Shuffle thought">
                <Ionicons name="shuffle" size={22} color={c.brand} />
              </Pressable>
            </View>
          </View>
          <Text style={[styles.thoughtText, { color: c.onSurface, fontSize: 18 * scale }]}>{thought}</Text>
        </View>

        <Pressable testID="home-points-card" onPress={() => goTo("/profile")} style={[styles.pointsCard, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
          <View style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
            <Text numberOfLines={1} style={[styles.pointsLabel, { color: c.brand, fontSize: 12 * scale }]}>COMMUNITY POINTS</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit allowFontScaling minimumFontScale={0.6} style={[styles.pointsNum, { color: c.onSurface, fontSize: 34 * scale }]}>{user?.points ?? 0}</Text>
          </View>
          {(user?.badges || []).length > 0 && (
            <View style={styles.badgesCol}>
              {(user?.badges || []).slice(0, 2).map((b) => (
                <View key={b} style={[styles.badgePill, { borderColor: c.brand, backgroundColor: c.surface }]}>
                  <Ionicons name="ribbon" size={12} color={c.brand} />
                  <Text numberOfLines={1} style={[styles.badgeText, { color: c.brand, fontSize: 11 * scale }]}>{b}</Text>
                </View>
              ))}
            </View>
          )}
        </Pressable>

        {/* Prominent invite card — sits above-the-fold so growth is one tap away. */}
        <View style={{ marginTop: 4 }}>
          <ShareYouBelong variant="highlight" testID="home-invite-highlight" invitedCount={invitedCount} />
        </View>

        {community && (community.birthdays?.length || community.new_members?.length || community.anniversaries?.length || community.milestones?.last_reached) ? (
          <View style={[styles.communityCard, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]} testID="community-card">
            <Text style={[styles.communityHead, { color: c.brand, fontSize: 12 * scale }]}>COMMUNITY TODAY</Text>
            {community.birthdays?.slice(0, 3).map((u: any) => (
              <Pressable key={`b-${u.id}`} testID={`bday-${u.id}`} onPress={() => router.push(`/user/${u.id}` as any)} style={styles.commRow}>
                <Text style={styles.commEmoji}>🎂</Text>
                <Text numberOfLines={1} style={{ flex: 1, color: c.onSurface, fontWeight: "700", fontSize: 15 * scale }}>
                  It&apos;s {u.first_name}&apos;s birthday today! Send a wave.
                </Text>
                <Ionicons name="chevron-forward" size={18} color={c.muted} />
              </Pressable>
            ))}
            {community.anniversaries?.slice(0, 2).map((u: any) => (
              <Pressable key={`a-${u.id}`} onPress={() => router.push(`/user/${u.id}` as any)} style={styles.commRow}>
                <Text style={styles.commEmoji}>🎉</Text>
                <Text numberOfLines={1} style={{ flex: 1, color: c.onSurface, fontWeight: "700", fontSize: 15 * scale }}>
                  {u.first_name} is celebrating {u.years} year{u.years > 1 ? "s" : ""} with YouBelong!
                </Text>
                <Ionicons name="chevron-forward" size={18} color={c.muted} />
              </Pressable>
            ))}
            {community.new_members?.length > 0 && (
              <Pressable testID="new-members-row" onPress={() => goTo("/friends")} style={styles.commRow}>
                <Text style={styles.commEmoji}>👋</Text>
                <Text numberOfLines={2} style={{ flex: 1, color: c.onSurface, fontWeight: "700", fontSize: 15 * scale }}>
                  Say hello to {community.new_members.length} new {community.new_members.length === 1 ? "neighbour" : "neighbours"} this week
                </Text>
                <Ionicons name="chevron-forward" size={18} color={c.muted} />
              </Pressable>
            )}
            {community.milestones?.last_reached && (
              <View style={styles.commRow}>
                <Text style={styles.commEmoji}>🏆</Text>
                <Text numberOfLines={2} style={{ flex: 1, color: c.onSurface, fontWeight: "700", fontSize: 14 * scale }}>
                  {community.milestones.last_reached.label}
                  {community.milestones.next ? ` · ${community.milestones.next.users - community.milestones.total_users} to next milestone` : ""}
                </Text>
              </View>
            )}
          </View>
        ) : null}

        <View style={styles.grid}>
          {tiles.map((t) => (
            <Pressable
              key={t.key}
              testID={`tile-${t.key}`}
              onPress={() => goTo(t.route)}
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
  brand: { fontWeight: "900", letterSpacing: 0.3 },
  hello: { fontWeight: "600", marginTop: 6 },
  name: { fontWeight: "900", marginTop: 2 },
  iconBtn: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  flutterBox: { borderWidth: 2, borderRadius: 18, padding: 14, backgroundColor: "#F5F3FF", gap: 8 },
  flutterItem: { flexDirection: "row", alignItems: "center", padding: 10, borderRadius: 12, borderWidth: 1, gap: 6 },
  replyBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  dismissBtn: { padding: 6 },
  pointsCard: { flexDirection: "row", alignItems: "center", borderRadius: 18, paddingVertical: 16, paddingHorizontal: 18, marginTop: 20, marginBottom: 8, borderWidth: 1.5 },
  pointsLabel: { fontWeight: "900", letterSpacing: 0.6 },
  pointsNum: { fontWeight: "900", marginTop: 2 },
  badgesCol: { alignItems: "flex-end", gap: 6, maxWidth: "55%" },
  badgePill: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1.5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, maxWidth: 170 },
  badgeText: { fontWeight: "800" },
  communityCard: { borderRadius: 18, padding: 14, borderWidth: 1, marginTop: 12, gap: 8 },
  communityHead: { fontWeight: "900", letterSpacing: 0.6, marginBottom: 2 },
  commRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  commEmoji: { fontSize: 22 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 4 },
  tile: { borderRadius: 22, padding: 18, justifyContent: "space-between", gap: 8 },
  tileTitle: { color: "#FFFFFF", fontWeight: "800", marginTop: "auto" },
  tileSub: { color: "rgba(255,255,255,0.85)", fontWeight: "600" },
  thoughtCard: { borderRadius: 20, padding: 16, borderWidth: 1.5, gap: 10, marginTop: 6 },
  thoughtHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  thoughtChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  thoughtChipText: { fontWeight: "800", letterSpacing: 0.6 },
  thoughtIconBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  thoughtText: { fontWeight: "700", lineHeight: 26 },
  bellBadge: { position: "absolute", top: -4, right: -4, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, alignItems: "center", justifyContent: "center" },
});
