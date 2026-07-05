import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, TextInput } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import AvatarBubble from "@/src/components/AvatarBubble";
import FounderMark from "@/src/components/FounderMark";

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

  const load = async () => { if (id) setPosts(await api.groupPosts(id)); };
  useFocusEffect(useCallback(() => { load(); }, [id]));

  // Fetch the group's display name / emoji once on mount. Silent on failure
  // — if the network's flaky the header just falls back to "Group" rather
  // than blocking the whole screen.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!id) return;
      try {
        const all: any[] = await api.listGroups();
        const g = (all || []).find((x) => x?.id === id);
        if (!cancelled && g) setGroup({ name: g.name, emoji: g.emoji, is_founder_only: !!g.is_founder_only });
      } catch { /* header falls back to "Group" */ }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const post = async () => {
    if (!user || !text.trim() || !id) return;
    await api.createGroupPost(id, { user_id: user.id, user_name: user.first_name, avatar: user.avatar, text: text.trim(), group_id: id });
    setText(""); show("Posted! +4 points 🦋"); await load(); await refresh();
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
          <View style={[styles.composer, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
            <TextInput testID="group-post-input" value={text} onChangeText={setText} multiline placeholder="Share an update with the group…" placeholderTextColor={c.muted} style={{ minHeight: 60, color: c.onSurface, fontSize: 16 * scale }} />
            <Pressable testID="group-post-submit" onPress={post} style={[styles.postBtn, { backgroundColor: c.brand }]}><Text style={{ color: "#FFF", fontWeight: "800", fontSize: 15 * scale }}>Post</Text></Pressable>
          </View>
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
