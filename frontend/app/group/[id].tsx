import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, Platform, Alert } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import AvatarBubble from "@/src/components/AvatarBubble";
import FounderMark from "@/src/components/FounderMark";
import VoiceInputButton from "@/src/components/VoiceInputButton";

export default function GroupDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, scale } = useTheme();
  const { user, refresh } = useAuth();
  const { show } = useToast();
  const [posts, setPosts] = useState<any[]>([]);
  const [text, setText] = useState("");
  // Real group name + emoji — the header used to say the literal word
  // "Group" which is confusing when there are dozens of groups. We fetch
  // the group's meta from /groups (there's no single-group endpoint) and
  // cache it so the banner always reflects e.g. "Gardening 🌱".
  const [group, setGroup] = useState<{ name?: string; emoji?: string; is_founder_only?: boolean } | null>(null);
  const [isMember, setIsMember] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => { if (id) setPosts(await api.groupPosts(id)); };
  useFocusEffect(useCallback(() => { load(); }, [id]));

  // Fetch the group's display name / emoji + my membership. Silent on
  // failure — if the network's flaky the header just falls back to "Group".
  const loadGroupMeta = useCallback(async () => {
    if (!id) return;
    try {
      const all: any[] = await api.listGroups();
      const g = (all || []).find((x) => x?.id === id);
      if (g) {
        setGroup({ name: g.name, emoji: g.emoji, is_founder_only: !!g.is_founder_only });
        setIsMember(!!user && (g.members || []).includes(user.id));
      }
    } catch { /* header falls back to "Group" */ }
  }, [id, user?.id]);

  useEffect(() => { void loadGroupMeta(); }, [loadGroupMeta]);

  const join = async () => {
    if (!user || !id || busy) return;
    setBusy(true);
    try {
      await api.joinGroup(id, user.id);
      setIsMember(true);
      show("You've joined the group 🦋");
      await refresh();
    } catch (e: any) {
      show(e?.message || "Couldn't join just now — try again?");
    } finally { setBusy(false); }
  };

  const doLeave = async () => {
    if (!user || !id || busy) return;
    setBusy(true);
    try {
      await api.leaveGroup(id, user.id);
      setIsMember(false);
      show("You've left the group. Your posts stay put.");
      await refresh();
    } catch {
      show("Couldn't leave just now — try again?");
    } finally { setBusy(false); }
  };

  const confirmLeave = () => {
    if (busy) return;
    const msg = "Leave this group? Your past posts stay, but you won't be able to post or comment until you rejoin.";
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(msg)) void doLeave();
      return;
    }
    Alert.alert("Leave group?", msg, [
      { text: "Cancel", style: "cancel" },
      { text: "Leave group", style: "destructive", onPress: () => { void doLeave(); } },
    ]);
  };

  const post = async () => {
    if (!user || !text.trim() || !id) return;
    try {
      await api.createGroupPost(id, { user_id: user.id, user_name: user.first_name, avatar: user.avatar, text: text.trim(), group_id: id });
      setText(""); show("Posted! +4 points 🦋"); await load(); await refresh();
    } catch (e: any) {
      // Membership gate (Garry, Sep 2026): the backend rejects non-members.
      // Re-check membership so the composer swaps to the Join card, and show
      // the friendly reason.
      await loadGroupMeta();
      show(e?.message || "Couldn't post just now — try again?");
    }
  };
  const like = async (p: any) => { if (user) { await api.likeGroupPost(p.id, user.id); await load(); } };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header
        title={group?.name || "Group"}
        emoji={group?.emoji}
        subtitle={group?.is_founder_only ? "Founders-only group" : undefined}
        backHref="/groups"
      />
      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={(
          isMember === false ? (
            <View style={[styles.composer, { backgroundColor: c.surfaceSecondary, borderColor: c.border, alignItems: "center", gap: 8 }]}>
              <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 * scale, textAlign: "center" }}>
                Join to join the conversation
              </Text>
              <Text style={{ color: c.onSurfaceSecondary, fontSize: 14 * scale, textAlign: "center" }}>
                You can read along any time. Join the group to post and comment.
              </Text>
              <Pressable testID="group-join" onPress={join} disabled={busy} style={[styles.postBtn, { backgroundColor: c.brand, opacity: busy ? 0.6 : 1, alignSelf: "center", marginTop: 4 }]}>
                <Text style={{ color: "#FFF", fontWeight: "800", fontSize: 15 * scale }}>Join group</Text>
              </Pressable>
            </View>
          ) : (
          <View style={[styles.composer, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
            <TextInput testID="group-post-input" value={text} onChangeText={setText} multiline placeholder="Share an update with the group…" placeholderTextColor={c.muted} style={{ minHeight: 60, color: c.onSurface, fontSize: 16 * scale }} />
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
              {/* TestFlight round-2 (Garry, 28 July 2026 #9): Community
                  Groups now have the same voice-to-text mic that DMs
                  and tables already offer. Same VoiceInputButton, same
                  cloud transcription. */}
              <VoiceInputButton
                testID="group-post-voice"
                value={text}
                onChangeText={setText}
                userId={user?.id}
                onError={(msg) => show(msg)}
                size={40}
              />
              <Pressable testID="group-post-submit" onPress={post} style={[styles.postBtn, { backgroundColor: c.brand }]}><Text style={{ color: "#FFF", fontWeight: "800", fontSize: 15 * scale }}>Post</Text></Pressable>
            </View>
            {isMember === true && (
              <Pressable testID="group-leave" onPress={confirmLeave} disabled={busy} hitSlop={8} style={{ marginTop: 10, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="exit-outline" size={16} color={c.muted} />
                <Text style={{ color: c.muted, fontWeight: "700", fontSize: 13 * scale }}>Leave group</Text>
              </Pressable>
            )}
          </View>
          )
        )}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        renderItem={({ item }) => {
          const liked = user && (item.likes || []).includes(user.id);
          return (
            <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <AvatarBubble value={item.avatar} size={26} fallback="🙂" />
                <Text style={{ color: c.onSurface, fontWeight: "700", marginLeft: 8, fontSize: 16 * scale }}>{item.user_name}</Text>
                <FounderMark
                  isFounder={item.user_is_founder}
                  founderNumber={item.user_founder_number}
                  size={14}
                  style={{ marginLeft: 4 }}
                  testID={`group-post-founder-${item.id}`}
                />
              </View>
              <Text style={{ color: c.onSurfaceSecondary, fontSize: 16 * scale, marginTop: 6 }}>{item.text}</Text>
              <Pressable onPress={() => like(item)} style={{ flexDirection: "row", marginTop: 8, alignItems: "center", gap: 6 }}>
                <Ionicons name={liked ? "heart" : "heart-outline"} size={20} color={liked ? c.error : c.muted} />
                <Text style={{ color: c.muted, fontSize: 14 * scale }}>{(item.likes || []).length}</Text>
              </Pressable>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  composer: { borderRadius: 16, padding: 12, borderWidth: 1, marginBottom: 8 },
  postBtn: { alignSelf: "flex-end", paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999 },
  card: { borderRadius: 16, padding: 14, borderWidth: 1 },
});
