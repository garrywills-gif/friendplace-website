import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  Image,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect, useRouter, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { api } from "@/src/lib/api";
import { useToast } from "@/src/lib/toast";
import SpeakButton from "@/src/components/SpeakButton";

/**
 * Share a Moment — feed screen.
 *
 * Replaces the old Recipes list. Members see recent moments from the
 * community; a Friends / Everyone toggle sits at the top so they can
 * narrow the feed to just their circle. A big "+" pill in the header
 * jumps into the composer.
 *
 * Design intent (Garry, 31 July 2026):
 *   "Small moments, not another social feed. Warm, quiet, unhurried."
 */
export default function MomentsScreen() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const { show } = useToast();
  const insets = useSafeAreaInsets();

  const [scope, setScope] = useState<"everyone" | "friends">("everyone");
  const [moments, setMoments] = useState<any[]>([]);
  const [featured, setFeatured] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const [list, feat] = await Promise.all([
          api.listMoments({ viewer_id: user?.id, scope }),
          api.getFeaturedMoment(user?.id),
        ]);
        setMoments((list as any)?.moments || []);
        setFeatured((feat as any)?.moment || null);
      } catch (e: any) {
        show(e?.message || "Couldn't load moments — please try again.");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [user?.id, scope, show],
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  };

  const toggleLike = async (m: any) => {
    if (!user) return;
    try {
      const r: any = await api.toggleMomentLike(m.id, user.id);
      setMoments((arr) =>
        arr.map((x) =>
          x.id === m.id
            ? { ...x, liked_by_me: !!r.liked, likes_count: r.count ?? x.likes_count }
            : x,
        ),
      );
    } catch (e: any) {
      show(e?.message || "Couldn't update like.");
    }
  };

  const emptyCopy = useMemo(() => {
    if (scope === "friends") {
      return "None of your friends have shared a moment yet. Try Everyone, or share the first one yourself.";
    }
    return "No moments yet. Be the first to share something from your day.";
  }, [scope]);

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* Header — matches Home's chrome (back arrow left, title centred,
          composer button on the right). */}
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: c.border }]}>
        <Pressable
          testID="moments-back"
          onPress={() => (router.canGoBack() ? router.back() : router.push("/(tabs)/home" as any))}
          accessibilityLabel="Back"
          style={styles.headerBtn}
          hitSlop={10}
        >
          <Ionicons name="chevron-back" size={26} color={c.onSurface} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.onSurface, fontSize: 18 * scale }]}>
          Share a Moment
        </Text>
        <Pressable
          testID="moments-new"
          onPress={() => router.push("/moments/new" as any)}
          accessibilityLabel="Share a moment"
          style={[styles.headerBtn, { backgroundColor: c.brand, borderRadius: 999, paddingHorizontal: 14 }]}
        >
          <Ionicons name="add" size={20} color="#FFFFFF" />
          <Text style={{ color: "#FFFFFF", fontWeight: "800", marginLeft: 4, fontSize: 14 * scale }}>Share</Text>
        </Pressable>
      </View>

      {/* Scope pills — Everyone / Friends. Kept as pills (not tabs) so
          scrolling doesn't feel like two separate pages. */}
      <View style={styles.scopeRow}>
        <Pressable
          testID="scope-everyone"
          onPress={() => setScope("everyone")}
          style={[
            styles.scopePill,
            {
              backgroundColor: scope === "everyone" ? c.brand : c.surfaceSecondary,
              borderColor: scope === "everyone" ? c.brand : c.border,
            },
          ]}
        >
          <Ionicons name="earth" size={14} color={scope === "everyone" ? "#FFFFFF" : c.onSurface} />
          <Text
            style={{
              color: scope === "everyone" ? "#FFFFFF" : c.onSurface,
              fontWeight: "800",
              marginLeft: 6,
              fontSize: 13 * scale,
            }}
          >
            Everyone
          </Text>
        </Pressable>
        <Pressable
          testID="scope-friends"
          onPress={() => setScope("friends")}
          style={[
            styles.scopePill,
            {
              backgroundColor: scope === "friends" ? c.brand : c.surfaceSecondary,
              borderColor: scope === "friends" ? c.brand : c.border,
            },
          ]}
        >
          <Ionicons name="people" size={14} color={scope === "friends" ? "#FFFFFF" : c.onSurface} />
          <Text
            style={{
              color: scope === "friends" ? "#FFFFFF" : c.onSurface,
              fontWeight: "800",
              marginLeft: 6,
              fontSize: 13 * scale,
            }}
          >
            Friends
          </Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 14 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={c.brand}
            colors={[c.brand]}
          />
        }
      >
        {loading ? (
          <View style={{ paddingTop: 60, alignItems: "center" }}>
            <ActivityIndicator color={c.brand} />
          </View>
        ) : moments.length === 0 ? (
          <View style={[styles.empty, { borderColor: c.border, backgroundColor: c.surfaceSecondary }]}>
            <Text style={{ fontSize: 40 }}>🦋</Text>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 17 * scale, textAlign: "center", marginTop: 8 }}>
              A quiet moment
            </Text>
            <Text style={{ color: c.muted, fontSize: 14 * scale, textAlign: "center", marginTop: 6, lineHeight: 20 }}>
              {emptyCopy}
            </Text>
            <Pressable
              testID="moments-empty-share"
              onPress={() => router.push("/moments/new" as any)}
              style={{
                marginTop: 14,
                backgroundColor: c.brand,
                paddingHorizontal: 18,
                paddingVertical: 10,
                borderRadius: 999,
              }}
            >
              <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 14 * scale }}>Share a moment</Text>
            </Pressable>
          </View>
        ) : (
          moments.map((m) => {
            const isFeatured = featured?.id === m.id;
            const firstPhoto = Array.isArray(m.photos) && m.photos.length > 0 ? m.photos[0] : null;
            const extraPhotos = Math.max(0, (m.photos?.length || 0) - 1);
            return (
              <Pressable
                key={m.id}
                testID={`moment-card-${m.id}`}
                onPress={() => router.push(`/moments/${m.id}` as any)}
                style={({ pressed }) => [
                  styles.card,
                  {
                    backgroundColor: c.surface,
                    borderColor: c.border,
                    opacity: pressed ? 0.94 : 1,
                    ...(isFeatured
                      ? { borderColor: "#F59E0B", backgroundColor: "#FEFCE8" }
                      : null),
                  },
                ]}
              >
                {/* Row 1: author + timestamp + featured badge + read-aloud.
                    Kept compact so the STORY is what the eye lands on
                    first — story-first, not photo-first. */}
                <View style={styles.cardHead}>
                  <Text style={{ fontSize: 28 }}>{m.author_avatar || "👤"}</Text>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: c.onSurface, fontWeight: "800", fontSize: 15 * scale }}>
                      {m.author_name || "Someone"}
                    </Text>
                    <Text style={{ color: c.muted, fontSize: 12 * scale }}>
                      {formatWhen(m.created_at)}
                      {m.privacy === "friends" ? " · Friends only" : ""}
                    </Text>
                  </View>
                  {isFeatured ? (
                    <View style={styles.featureBadge}>
                      <Ionicons name="sparkles" size={12} color="#92400E" />
                      <Text style={{ color: "#92400E", fontWeight: "900", fontSize: 11 * scale, letterSpacing: 0.4, marginLeft: 4 }}>
                        FEATURED
                      </Text>
                    </View>
                  ) : null}
                  {/* SpeakButton reads the caption aloud in George's voice.
                      Wrapped in a stopPropagation-y View so tapping it
                      doesn't also open the moment. */}
                  {m.caption ? (
                    <View onStartShouldSetResponder={() => true}>
                      <SpeakButton
                        text={`${m.author_name || "Someone"} says. ${m.caption}`}
                        size={20}
                        color={c.muted}
                        testID={`moment-speak-${m.id}`}
                      />
                    </View>
                  ) : null}
                </View>

                {/* Row 2: the story itself. Larger type, no truncation
                    (up to 6 lines) so members can read enough to decide
                    whether to open. */}
                {m.caption ? (
                  <Text
                    numberOfLines={6}
                    style={{
                      color: c.onSurface,
                      fontSize: 16 * scale,
                      lineHeight: 24,
                      marginTop: 10,
                    }}
                  >
                    {m.caption}
                  </Text>
                ) : null}

                {/* Row 3: small photo preview (story-first, not photo-
                    first). A single ~90px thumb on the left; if there
                    are more, a small "+N" chip nudges the reader to
                    open the moment for the full gallery. */}
                {firstPhoto ? (
                  <View style={styles.thumbRow}>
                    <Image source={{ uri: firstPhoto }} style={styles.thumb} />
                    {extraPhotos > 0 ? (
                      <View style={styles.thumbMore}>
                        <Ionicons name="images" size={12} color={c.muted} />
                        <Text style={{ color: c.muted, fontWeight: "800", fontSize: 12 * scale, marginLeft: 4 }}>
                          +{extraPhotos} more
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}

                {/* Row 4: engagement — quiet, spelled-out counts. Not
                    social-media-y counters, just gentle indicators of
                    the conversation waiting inside. */}
                <View style={styles.cardActions}>
                  <Pressable
                    testID={`moment-like-${m.id}`}
                    onPress={() => toggleLike(m)}
                    hitSlop={8}
                    style={styles.actionBtn}
                  >
                    <Ionicons
                      name={m.liked_by_me ? "heart" : "heart-outline"}
                      size={20}
                      color={m.liked_by_me ? "#EF4444" : c.muted}
                    />
                    <Text style={{ color: c.muted, fontWeight: "700", marginLeft: 6, fontSize: 13 * scale }}>
                      {m.likes_count || 0}
                    </Text>
                  </Pressable>
                  <View style={styles.actionBtn}>
                    <Ionicons name="chatbubble-ellipses-outline" size={19} color={c.muted} />
                    <Text style={{ color: c.muted, fontWeight: "700", marginLeft: 6, fontSize: 13 * scale }}>
                      {m.comments_count || 0}
                    </Text>
                  </View>
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

/** Small photo strip used in some list-only contexts. The feed
 *  itself now uses a compact thumbnail (story-first). Kept here for
 *  future reuse. */
function MomentPhotos({ photos }: { photos: string[] }) {
  const safe = photos.slice(0, 6);
  if (safe.length === 1) {
    return (
      <Image
        source={{ uri: safe[0] }}
        style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: 14, marginTop: 10, backgroundColor: "#F3F4F6" }}
      />
    );
  }
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
      {safe.map((p, i) => (
        <Image
          key={i}
          source={{ uri: p }}
          style={{ width: "49%", aspectRatio: 1, borderRadius: 12, backgroundColor: "#F3F4F6" }}
        />
      ))}
    </View>
  );
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _keep_MomentPhotos = MomentPhotos;

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    const mins = Math.floor((now.getTime() - d.getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  } catch {
    return "";
  }
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    gap: 6,
  },
  headerBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    height: 40,
  },
  headerTitle: { fontWeight: "900", letterSpacing: 0.2 },
  scopeRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  scopePill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 14,
    gap: 4,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  featureBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "#FEF3C7",
    borderColor: "#F59E0B",
    borderWidth: 1,
    borderRadius: 999,
  },
  cardActions: { flexDirection: "row", alignItems: "center", gap: 20, marginTop: 12 },
  actionBtn: { flexDirection: "row", alignItems: "center" },
  // Story-first: small photo preview under the caption, not a hero.
  // Locked with Garry 31 July 2026 — "the photo supports the story
  // rather than dominating it".
  thumbRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
  },
  thumb: {
    width: 92,
    height: 92,
    borderRadius: 12,
    backgroundColor: "#F3F4F6",
  },
  thumbMore: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#F1F5F9",
  },
  empty: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    marginTop: 24,
  },
});
