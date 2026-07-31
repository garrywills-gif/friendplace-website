import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import SpeakButton from "@/src/components/SpeakButton";
import VoiceInputButton from "@/src/components/VoiceInputButton";
import ButterflyFlutter from "@/src/components/ButterflyFlutter";

type Comment = {
  id: string;
  user_id: string;
  user_name: string;
  user_avatar: string;
  body: string;
  created_at: string;
};

type Moment = {
  id: string;
  caption: string;
  photos: string[];
  privacy: "everyone" | "friends";
  author_id: string;
  author_name: string;
  author_avatar: string;
  created_at: string;
  likes_count: number;
  liked_by_me: boolean;
  comments_count: number;
  comments: Comment[];
  featured?: boolean;
};

const REPORT_REASONS: { key: string; label: string }[] = [
  { key: "inappropriate", label: "Inappropriate content" },
  { key: "spam", label: "Spam or advertising" },
  { key: "not_respectful", label: "Not respectful" },
  { key: "other", label: "Something else" },
];

export default function MomentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const { show } = useToast();
  const insets = useSafeAreaInsets();

  const [moment, setMoment] = useState<Moment | null>(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  // Fires the tiny butterfly flutter animation over the heart when a
  // member goes from unliked → liked. Locked with Garry 31 July 2026:
  // "Don't make it pop. Make the butterfly flutter once. Tiny.
  //  Elegant. Almost unnoticed."
  const [flutterKey, setFlutterKey] = useState(0);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const r = (await api.getMoment(id as string, user?.id)) as Moment;
      setMoment(r);
    } catch (e: any) {
      show(e?.message || "Couldn't load this moment.");
      setMoment(null);
    } finally {
      setLoading(false);
    }
  }, [id, user?.id, show]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleLike = async () => {
    if (!moment || !user) return;
    const wasLiked = moment.liked_by_me;
    try {
      const r: any = await api.toggleMomentLike(moment.id, user.id);
      setMoment({ ...moment, liked_by_me: !!r.liked, likes_count: r.count ?? moment.likes_count });
      // Only flutter on the UNLIKE → LIKE transition — quiet on un-like.
      if (!wasLiked && r.liked) {
        setFlutterKey((k) => k + 1);
      }
    } catch (e: any) {
      show(e?.message || "Couldn't update like.");
    }
  };

  const sendComment = async () => {
    if (!moment || !user) return;
    const body = comment.trim();
    if (!body) return;
    setSendingComment(true);
    try {
      const cm: any = await api.addMomentComment(moment.id, user.id, body);
      setMoment({
        ...moment,
        comments: [...(moment.comments || []), cm],
        comments_count: (moment.comments_count || 0) + 1,
      });
      setComment("");
      // Culture-reinforcing toast (Garry, 31 Jul 2026): tiny thanks
      // when THIS is the first warm word left on the moment. Never
      // when it's the second, third, etc — that would nag.
      if (cm?.first_comment_on_moment) {
        show("🦋 Thanks for leaving a warm word.");
      }
    } catch (e: any) {
      show(e?.message || "Couldn't send comment.");
    } finally {
      setSendingComment(false);
    }
  };

  const deleteMoment = async () => {
    if (!moment || !user) return;
    Alert.alert(
      "Delete this moment?",
      "This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await api.deleteMoment(moment.id, user.id);
              show("Moment removed");
              router.replace("/moments" as any);
            } catch (e: any) {
              show(e?.message || "Couldn't delete this moment.");
            }
          },
        },
      ],
    );
  };

  const deleteComment = async (cm: Comment) => {
    if (!moment || !user) return;
    Alert.alert(
      "Delete this comment?",
      undefined,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await api.deleteMomentComment(moment.id, cm.id, user.id);
              setMoment({
                ...moment,
                comments: (moment.comments || []).filter((x) => x.id !== cm.id),
                comments_count: Math.max(0, (moment.comments_count || 0) - 1),
              });
            } catch (e: any) {
              show(e?.message || "Couldn't delete.");
            }
          },
        },
      ],
    );
  };

  const submitReport = async (reason: string) => {
    if (!moment || !user) return;
    setReporting(true);
    try {
      const r: any = await api.reportMoment(moment.id, { user_id: user.id, reason: reason as any });
      setReportOpen(false);
      if (r?.already_reported) {
        show("You've already reported this moment. Thanks — a moderator will take a look.");
      } else {
        show("Thanks — a moderator will take a look shortly.");
      }
    } catch (e: any) {
      show(e?.message || "Couldn't submit report.");
    } finally {
      setReporting(false);
    }
  };

  const isMine = !!(moment && user && moment.author_id === user.id);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: c.surface, alignItems: "center", justifyContent: "center" }}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={c.brand} />
      </View>
    );
  }

  if (!moment) {
    return (
      <View style={{ flex: 1, backgroundColor: c.surface, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 * scale }}>Moment not found</Text>
        <Pressable
          onPress={() => router.replace("/moments" as any)}
          style={{ marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 999, backgroundColor: c.brand }}
        >
          <Text style={{ color: "#FFFFFF", fontWeight: "800" }}>Back to Moments</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: c.border }]}>
        <Pressable
          testID="moment-detail-back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/moments" as any))}
          hitSlop={10}
          style={styles.headerBtn}
        >
          <Ionicons name="chevron-back" size={26} color={c.onSurface} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.onSurface, fontSize: 17 * scale }]}>Moment</Text>
        {isMine ? (
          <Pressable
            testID="moment-detail-delete"
            onPress={deleteMoment}
            hitSlop={8}
            style={styles.headerBtn}
          >
            <Ionicons name="trash-outline" size={22} color="#B45309" />
          </Pressable>
        ) : (
          <Pressable
            testID="moment-detail-report"
            onPress={() => setReportOpen(true)}
            hitSlop={8}
            style={styles.headerBtn}
          >
            <Ionicons name="flag-outline" size={22} color={c.muted} />
          </Pressable>
        )}
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 14 }}>
          <View style={styles.head}>
            <Pressable
              onPress={() => router.push(`/user/${moment.author_id}` as any)}
              hitSlop={6}
              style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}
            >
              <Text style={{ fontSize: 32 }}>{moment.author_avatar || "👤"}</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 * scale }}>
                  {moment.author_name || "Someone"}
                </Text>
                <Text style={{ color: c.muted, fontSize: 12 * scale }}>
                  {formatWhen(moment.created_at)}
                  {moment.privacy === "friends" ? " · Friends only" : ""}
                </Text>
              </View>
            </Pressable>
            {moment.featured ? (
              <View style={styles.featureBadge}>
                <Ionicons name="sparkles" size={12} color="#92400E" />
                <Text style={{ color: "#92400E", fontWeight: "900", fontSize: 11 * scale, letterSpacing: 0.4, marginLeft: 4 }}>
                  MOMENT OF THE WEEK
                </Text>
              </View>
            ) : null}
            {/* Read-aloud in George's voice — locked with Garry 31 July
                2026 as an accessibility win for members with poorer
                eyesight (and for anyone who just prefers listening). */}
            {moment.caption ? (
              <SpeakButton
                text={`${moment.author_name || "Someone"} says. ${moment.caption}`}
                size={22}
                color={c.muted}
                testID="moment-detail-speak"
              />
            ) : null}
          </View>

          {moment.featured ? (
            <View style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              backgroundColor: "#FEF9E4",
              borderColor: "#F59E0B",
              borderWidth: 1,
              borderRadius: 12,
              paddingHorizontal: 12,
              paddingVertical: 8,
              marginTop: 2,
            }}>
              <Text style={{ fontSize: 16 }}>🌟</Text>
              <Text style={{ color: "#78350F", fontSize: 13 * scale, fontWeight: "700", flex: 1, lineHeight: 18, fontStyle: "italic" }}>
                Chosen by the FriendPlace team because it made us smile.
              </Text>
            </View>
          ) : null}

          {moment.caption ? (
            <Text style={{ color: c.onSurface, fontSize: 16 * scale, lineHeight: 24 }}>{moment.caption}</Text>
          ) : null}

          {Array.isArray(moment.photos) && moment.photos.length > 0 ? (
            <View style={{ gap: 8 }}>
              {moment.photos.map((p, i) => (
                <Image
                  key={i}
                  source={{ uri: p }}
                  style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: 16, backgroundColor: "#F3F4F6" }}
                />
              ))}
            </View>
          ) : null}

          {/* Story-first summary — spelled-out counts (Garry, 31 Jul 2026):
              "❤️ 3 Likes  ·  💬 2 Comments". When counts are 0 we
              swap in a warm invitation instead of "0" — reinforces
              the culture, encourages the first tap. */}
          <View style={[styles.likeRow, { borderColor: c.border }]}>
            <Pressable
              testID="moment-detail-like"
              onPress={toggleLike}
              hitSlop={8}
              style={styles.likeBtn}
            >
              <View style={{ position: "relative" }}>
                <Ionicons
                  name={moment.liked_by_me ? "heart" : "heart-outline"}
                  size={22}
                  color={moment.liked_by_me ? "#EF4444" : c.onSurface}
                />
                {/* Butterfly flutter — quiet, plays once per like tap. */}
                <ButterflyFlutter
                  trigger={flutterKey || null}
                  size={16}
                  style={{ top: -4, left: 4, right: 0 }}
                />
              </View>
              <Text style={{ color: c.onSurface, fontWeight: "800", marginLeft: 8, fontSize: 15 * scale }}>
                {(moment.likes_count || 0) === 0
                  ? "Be the first to like this"
                  : `${moment.likes_count} ${moment.likes_count === 1 ? "Like" : "Likes"}`}
              </Text>
            </Pressable>
            <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 1 }}>
              <Ionicons name="chatbubble-ellipses-outline" size={20} color={c.onSurface} />
              <Text
                numberOfLines={1}
                style={{ color: c.onSurface, fontWeight: "800", marginLeft: 8, fontSize: 15 * scale }}
              >
                {(moment.comments_count || 0) === 0
                  ? "Be the first to leave a warm word"
                  : `${moment.comments_count} ${moment.comments_count === 1 ? "Comment" : "Comments"}`}
              </Text>
            </View>
          </View>

          {/* Comments */}
          {(moment.comments || []).length === 0 ? (
            <Text style={{ color: c.muted, fontSize: 14 * scale, textAlign: "center", paddingVertical: 16 }}>
              Be the first to leave a warm word.
            </Text>
          ) : (
            <View style={{ gap: 10 }}>
              {(moment.comments || []).map((cm) => {
                const canDelete = !!(user && (cm.user_id === user.id || moment.author_id === user.id));
                return (
                  <View
                    key={cm.id}
                    style={[styles.commentRow, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}
                  >
                    {/* Commenter avatar + name are their own Pressable so
                        tapping either opens their profile. Enables the
                        "I want to say hi to the person who left this
                        warm word" moment. (Garry, 26 June 2026.) */}
                    <Pressable
                      testID={`comment-author-${cm.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${cm.user_name || "member"}'s profile`}
                      onPress={() => cm.user_id && router.push(`/user/${cm.user_id}` as any)}
                      hitSlop={6}
                      style={({ pressed }) => [
                        { flexDirection: "row", alignItems: "center", gap: 8, flex: 1, minWidth: 0, opacity: pressed ? 0.6 : 1 },
                      ]}
                    >
                      <Text style={{ fontSize: 22 }}>{cm.user_avatar || "👤"}</Text>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 13 * scale }}>
                            {cm.user_name || "Someone"}
                          </Text>
                          <Text style={{ color: c.muted, fontSize: 11 * scale }}>{formatWhen(cm.created_at)}</Text>
                        </View>
                        <Text style={{ color: c.onSurface, fontSize: 14 * scale, marginTop: 2, lineHeight: 20 }}>
                          {cm.body}
                        </Text>
                      </View>
                    </Pressable>
                    {canDelete ? (
                      <Pressable onPress={() => deleteComment(cm)} hitSlop={8}>
                        <Ionicons name="close" size={18} color={c.muted} />
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>

        {/* Composer — text OR voice. FriendPlace members find dictating
            far easier than typing on a phone keyboard, so a mic button
            sits inline with the input; tap → speak → transcribed text
            drops into the field → tap Send. Reuses the app-wide
            VoiceInputButton (whisper-1). */}
        <View style={[styles.composer, { backgroundColor: c.surface, borderTopColor: c.border, paddingBottom: Math.max(insets.bottom, 8) }]}>
          <TextInput
            testID="moment-comment-input"
            value={comment}
            onChangeText={setComment}
            placeholder="Say something kind"
            placeholderTextColor={c.muted}
            style={{
              flex: 1,
              backgroundColor: c.surfaceSecondary,
              borderColor: c.border,
              borderWidth: 1,
              borderRadius: 22,
              paddingHorizontal: 14,
              paddingVertical: 10,
              color: c.onSurface,
              fontSize: 15 * scale,
              maxHeight: 100,
            }}
            multiline
          />
          <VoiceInputButton
            value={comment}
            onChangeText={setComment}
            userId={user?.id}
            appendMode="append"
            size={42}
            testID="moment-comment-mic"
          />
          <Pressable
            testID="moment-comment-send"
            onPress={sendComment}
            disabled={sendingComment || comment.trim().length === 0}
            style={[
              styles.sendBtn,
              {
                backgroundColor:
                  sendingComment || comment.trim().length === 0 ? c.border : c.brand,
              },
            ]}
          >
            {sendingComment ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Ionicons name="paper-plane" size={18} color="#FFFFFF" />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* Report modal */}
      <Modal visible={reportOpen} transparent animationType="fade" onRequestClose={() => setReportOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => (!reporting ? setReportOpen(false) : null)}>
          <Pressable
            onPress={(e: any) => e.stopPropagation && e.stopPropagation()}
            style={[styles.modalCard, { backgroundColor: c.surface, borderColor: c.border }]}
          >
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 17 * scale }}>Report this moment</Text>
            <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 6, lineHeight: 19 }}>
              Choose a reason. A moderator will review it quietly — the member won&apos;t know it was you.
            </Text>
            <View style={{ marginTop: 14, gap: 8 }}>
              {REPORT_REASONS.map((r) => (
                <Pressable
                  key={r.key}
                  testID={`report-reason-${r.key}`}
                  onPress={() => submitReport(r.key)}
                  disabled={reporting}
                  style={({ pressed }) => [
                    styles.reasonRow,
                    { borderColor: c.border, backgroundColor: pressed ? c.surfaceSecondary : c.surface },
                  ]}
                >
                  <Text style={{ color: c.onSurface, fontWeight: "700", fontSize: 15 * scale }}>{r.label}</Text>
                  <Ionicons name="chevron-forward" size={18} color={c.muted} />
                </Pressable>
              ))}
            </View>
            <Pressable
              testID="report-cancel"
              onPress={() => setReportOpen(false)}
              disabled={reporting}
              style={{ marginTop: 12, alignSelf: "center", paddingVertical: 8, paddingHorizontal: 18 }}
            >
              <Text style={{ color: c.muted, fontWeight: "700" }}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
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
  },
  headerBtn: { padding: 6, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontWeight: "900", letterSpacing: 0.2 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
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
  likeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingVertical: 12,
  },
  likeBtn: { flexDirection: "row", alignItems: "center" },
  commentRow: {
    flexDirection: "row",
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "flex-start",
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 22,
    borderWidth: 1.5,
    padding: 20,
  },
  reasonRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    borderWidth: 1,
    borderRadius: 12,
  },
});
