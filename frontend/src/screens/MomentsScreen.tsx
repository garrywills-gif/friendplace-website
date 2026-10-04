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
  useWindowDimensions,
} from "react-native";
import { useFocusEffect, useRouter, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/lib/theme";
import { useNavHideScroll } from "@/src/lib/bottom-nav";
import AvatarBubble from "@/src/components/AvatarBubble";
import { useAuth } from "@/src/lib/auth";
import { api, resolveMediaUri } from "@/src/lib/api";
import { useToast } from "@/src/lib/toast";
import SpeakButton from "@/src/components/SpeakButton";
import ButterflyFlutter from "@/src/components/ButterflyFlutter";
import { GeorgeButterflyMark } from "@/src/components/george/GeorgeButterflyMark";
import AppHeader from "@/src/components/AppHeader";

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
  // iter226 (Garry, Oct 2026 — Moments uplift): side-by-side photo +
  // caption on wider phones (iPhone Pro Max / Plus / foldables),
  // stacked on narrow phones so nothing gets squeezed. Threshold set
  // empirically to match the primary-shortcut row on Home.
  const { width: _winW } = useWindowDimensions();
  const sideBySideMoments = _winW >= 400;
  const { user } = useAuth();
  const { show } = useToast();
  const insets = useSafeAreaInsets();
  const navScroll = useNavHideScroll();

  const [scope, setScope] = useState<"everyone" | "friends">("everyone");
  const [moments, setMoments] = useState<any[]>([]);
  const [featured, setFeatured] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Per-card flutter key — bumped when the user likes a specific card.
  // Keyed by moment.id so a like on one card doesn't fire the animation
  // on all the others.
  const [flutter, setFlutter] = useState<Record<string, number>>({});

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
    const wasLiked = !!m.liked_by_me;
    try {
      const r: any = await api.toggleMomentLike(m.id, user.id);
      setMoments((arr) =>
        arr.map((x) =>
          x.id === m.id
            ? { ...x, liked_by_me: !!r.liked, likes_count: r.count ?? x.likes_count }
            : x,
        ),
      );
      if (!wasLiked && r.liked) {
        setFlutter((prev) => ({ ...prev, [m.id]: (prev[m.id] || 0) + 1 }));
      }
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
      {/* iter226 (Garry, Oct 2026 — visual uplift): warm shared brand
          bar + centered "Share a Moment" title + big "+ Share" pill
          on the right. Back arrow, "Share" composer button and
          notifications bell all wired to their existing handlers. */}
      <View style={{ paddingTop: insets.top + 4 }}>
        <AppHeader
          testID="moments-header"
          showTagline={true}
        />
      </View>
      <View style={styles.momentsTitleRow}>
        <Pressable
          testID="moments-back"
          onPress={() => (router.canGoBack() ? router.back() : router.push("/(tabs)/home" as any))}
          accessibilityLabel="Back"
          style={styles.momentsTitleBack}
          hitSlop={10}
        >
          <Ionicons name="chevron-back" size={28} color={c.onSurface} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }} pointerEvents="none">
          <Text style={[styles.momentsTitleTxt, { color: c.onSurface, fontSize: 24 * scale }]}>
            Share a Moment
          </Text>
          <Text style={[styles.momentsTitleSub, { color: c.muted, fontSize: 13 * scale }]}>
            Little moments. Real connections.
          </Text>
        </View>
        <Pressable
          testID="moments-new"
          onPress={() => router.push("/moments/new" as any)}
          accessibilityLabel="Share a moment"
          style={[styles.momentsShareBtn, { backgroundColor: "#0D2A57" }]}
        >
          <Ionicons name="add" size={18} color="#FFFFFF" />
          <Text style={{ color: "#FFFFFF", fontWeight: "900", marginLeft: 4, fontSize: 14 * scale }}>Share</Text>
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

      {/* iter216 (Garry, Oct 2026): "For Mum ❤️" tribute strip. Slim
          clickable row between the Everyone / Friends toggle and the
          Moments feed. Shows a precision-cropped circle of Mum's face
          (not the full-image centre crop, which came out as an
          indistinct square) and the words "For Mum ❤️" with a tiny
          butterfly as a quiet FriendPlace touch. Tapping anywhere on
          the row opens the full dedication. Deliberately compact. */}
      <Pressable
        testID="moments-for-mum-strip"
        onPress={() => router.push("/moments/for-mum" as any)}
        accessibilityRole="button"
        accessibilityLabel="For Mum tribute. Tap to read the dedication."
        style={({ pressed }) => [{
          marginHorizontal: 16,
          marginTop: 8,
          marginBottom: 2,
          paddingVertical: 10,
          paddingHorizontal: 14,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: "#B6CFEA",
          backgroundColor: pressed ? "#DCE8F7" : "#EAF2FB",
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
        }]}
      >
        {/* Face-cropped circle. We display the full tribute image at a
            calibrated size inside a 54px overflow-hidden circle, offset
            so Mum's actual face (centre-top region of the composite)
            sits in the middle of the thumb. Values were sampled from
            the uploaded artwork: image ~1138×1440 with her circular
            portrait centred at roughly (560, 395). pointerEvents="none"
            so the whole strip remains the single tap target. */}
        <View
          pointerEvents="none"
          style={{
            width: 54,
            height: 54,
            borderRadius: 27,
            overflow: "hidden",
            borderWidth: 2,
            borderColor: "#FFFFFF",
            backgroundColor: "#DCE8F7",
          }}
        >
          <Image
            source={{ uri: "https://customer-assets-jai6qajn.emergentagent.net/job_a80ec07d-4f57-4c91-b9bc-efc7bf50eb01/artifacts/r51nc7rj_image.png" }}
            style={{
              // Real tribute is 1122 × 1402 with Mum's face centred at
              // roughly (360, 450) and about 360px tall. We display at
              // ~11% scale so her face fills ~40px of the 54px thumb,
              // then offset to put her face centre at the circle's
              // middle (27, 27). Values hand-sampled from the artwork.
              width: 125,
              height: 156,
              marginLeft: -13,
              marginTop: -23,
            }}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: "#0F2A4D", fontWeight: "900", fontSize: 15 * scale }} numberOfLines={1}>
            For Mum <Text style={{ color: "#E11D48" }}>❤️</Text>
            {"  "}
            <Text style={{ color: "#8AA7C7", fontSize: 13 * scale, fontWeight: "700" }}>🦋</Text>
          </Text>
          <Text style={{ color: "#4A6B8F", fontSize: 12 * scale, marginTop: 1, fontWeight: "600" }} numberOfLines={1}>
            A quiet thank you — tap to read
          </Text>
        </View>
        <Text style={{ color: "#4A6B8F", fontSize: 18 * scale, fontWeight: "800" }}>›</Text>
      </Pressable>

      <ScrollView
        {...navScroll}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 48, gap: 14 }}
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
            <GeorgeButterflyMark size={40} />
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
            return (
              <Pressable
                key={m.id}
                testID={`moment-card-${m.id}`}
                onPress={() => router.push(`/moments/${m.id}` as any)}
                style={({ pressed }) => [
                  styles.card,
                  {
                    backgroundColor: c.surfaceSecondary,
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
                    first — story-first, not photo-first.

                    Author row is a NESTED Pressable so tapping the
                    avatar or the name opens the poster's profile
                    directly (Garry, 26 June 2026 — "it feels like the
                    natural next step after enjoying someone's story").
                    Tapping the body / photo of the card still opens
                    the moment detail as before. */}
                <View style={styles.cardHead}>
                  <Pressable
                    testID={`moment-author-${m.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${m.author_name || "member"}'s profile`}
                    onPress={() => m.author_id && router.push(`/user/${m.author_id}` as any)}
                    hitSlop={6}
                    style={({ pressed }) => [
                      { flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0, opacity: pressed ? 0.6 : 1 },
                    ]}
                  >
                    <AvatarBubble value={m.author_avatar} size={36} textSize={24} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ color: c.onSurface, fontWeight: "800", fontSize: 15 * scale }}>
                        {m.author_name || "Someone"}
                      </Text>
                      <Text style={{ color: c.muted, fontSize: 12 * scale }}>
                        {formatWhen(m.created_at)}
                        {m.privacy === "friends" ? " · Friends only" : ""}
                      </Text>
                    </View>
                  </Pressable>
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

                {/* Row 2+3 (Wave B): the story and its photos.
                    • Wide phones (≥400px): Savi-style side-by-side
                      whenever there's at least one photo (iter226
                      Moments uplift — matches the mockup).
                    • Narrow phones: caption on top, responsive photo
                      grid below (2 side-by-side · 3–4 grid · +N
                      overlay for extras). */}
                {(() => {
                  const photos: string[] = Array.isArray(m.photos) ? m.photos.filter(Boolean).map(resolveMediaUri) : [];
                  const caption = m.caption ? (
                    <Text
                      numberOfLines={6}
                      style={{ color: c.onSurface, fontSize: 16 * scale, lineHeight: 24 }}
                    >
                      {m.caption}
                    </Text>
                  ) : null;
                  // iter226 — on wide phones, if there's exactly ONE
                  // photo, lay it beside the caption. Keeps the Savi
                  // behaviour for long captions on narrow phones too.
                  if (photos.length === 1 && sideBySideMoments) {
                    return (
                      <View style={styles.sideBySide}>
                        {caption ? <View style={{ flex: 1, minWidth: 0 }}>{caption}</View> : null}
                        <Image source={{ uri: photos[0] }} style={styles.sidePhoto} />
                      </View>
                    );
                  }
                  if (photos.length === 1 && m.caption && String(m.caption).trim().length > 90) {
                    return (
                      <View style={styles.sideBySide}>
                        <View style={{ flex: 1, minWidth: 0 }}>{caption}</View>
                        <Image source={{ uri: photos[0] }} style={styles.sidePhoto} />
                      </View>
                    );
                  }
                  return (
                    <View style={{ marginTop: 10, gap: 10 }}>
                      {caption}
                      <MomentMedia photos={photos} />
                    </View>
                  );
                })()}

                {/* Row 4: engagement — quiet, spelled-out counts. Not
                    social-media-y counters, just gentle indicators of
                    the conversation waiting inside. iter226 — the
                    "Comment" pill mirrors the mockup for a clearer
                    call to join the conversation; the whole card is
                    still tappable to open the detail view. */}
                <View style={styles.cardActions}>
                  <Pressable
                    testID={`moment-like-${m.id}`}
                    onPress={() => toggleLike(m)}
                    hitSlop={8}
                    style={styles.actionBtn}
                  >
                    <View style={{ position: "relative" }}>
                      <Ionicons
                        name={m.liked_by_me ? "heart" : "heart-outline"}
                        size={20}
                        color={m.liked_by_me ? "#EF4444" : c.muted}
                      />
                      <ButterflyFlutter
                        trigger={flutter[m.id] || null}
                        size={13}
                        style={{ top: -2, left: 3, right: 0 }}
                      />
                    </View>
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
                  <View style={{ flex: 1 }} />
                  <Pressable
                    testID={`moment-comment-${m.id}`}
                    onPress={() => router.push(`/moments/${m.id}` as any)}
                    accessibilityLabel="Open comments"
                    style={({ pressed }) => [styles.commentPill, { opacity: pressed ? 0.85 : 1 }]}
                    hitSlop={6}
                  >
                    <Ionicons name="chatbubble-outline" size={14} color="#0D2A57" />
                    <Text style={styles.commentPillTxt}>Comment</Text>
                  </Pressable>
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

/** Responsive photo grid for a Moment (Wave B). Rules:
 *  1 → full-width 4:3 · 2 → side-by-side squares · 3 → hero + 2 ·
 *  4 → 2×2 · 5+ → 2×2 with a "+N" overlay on the last tile. */
function MomentMedia({ photos }: { photos: string[] }) {
  const list = (photos || []).filter(Boolean);
  const n = list.length;
  if (n === 0) return null;
  const G = 6;
  if (n === 1) {
    return <Image source={{ uri: list[0] }} style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: 14, backgroundColor: "#EEE" }} />;
  }
  if (n === 2) {
    return (
      <View style={{ flexDirection: "row", gap: G }}>
        {list.map((p, i) => (
          <Image key={i} source={{ uri: p }} style={{ flex: 1, aspectRatio: 1, borderRadius: 12, backgroundColor: "#EEE" }} />
        ))}
      </View>
    );
  }
  if (n === 3) {
    return (
      <View style={{ gap: G }}>
        <Image source={{ uri: list[0] }} style={{ width: "100%", aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: "#EEE" }} />
        <View style={{ flexDirection: "row", gap: G }}>
          {list.slice(1, 3).map((p, i) => (
            <Image key={i} source={{ uri: p }} style={{ flex: 1, aspectRatio: 1, borderRadius: 12, backgroundColor: "#EEE" }} />
          ))}
        </View>
      </View>
    );
  }
  // 4+ → 2×2 grid; last tile carries a "+N" overlay when there are extras.
  const tiles = list.slice(0, 4);
  const extra = n - 4;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: G }}>
      {tiles.map((p, i) => (
        <View key={i} style={{ width: "48.5%", aspectRatio: 1, borderRadius: 12, overflow: "hidden", backgroundColor: "#EEE" }}>
          <Image source={{ uri: p }} style={{ width: "100%", height: "100%" }} />
          {i === 3 && extra > 0 ? (
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(13,42,87,0.55)", alignItems: "center", justifyContent: "center" }]}>
              <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 24 }}>+{extra}</Text>
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

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
  // iter226 — "Share a Moment" title row below the shared app header.
  momentsTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 8,
  },
  momentsTitleBack: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -4,
  },
  momentsTitleTxt: { fontWeight: "900", letterSpacing: -0.3 },
  momentsTitleSub: { fontWeight: "600", marginTop: 2 },
  momentsShareBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    minHeight: 40,
    borderRadius: 999,
  },
  // iter226 — "Comment" pill on each moment card, matching the mockup.
  commentPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#EAF2FD",
    paddingHorizontal: 12,
    minHeight: 32,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#C9DCF4",
  },
  commentPillTxt: {
    color: "#0D2A57",
    fontWeight: "900",
    fontSize: 13,
  },
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
    marginBottom: 14,
    shadowColor: "#0D2A57",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  sideBySide: { flexDirection: "row", gap: 12, marginTop: 10, alignItems: "flex-start" },
  sidePhoto: { width: 112, height: 112, borderRadius: 14, backgroundColor: "#EEE" },
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
