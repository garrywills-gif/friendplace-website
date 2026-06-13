import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, Modal, KeyboardAvoidingView, Platform } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import Button from "@/src/components/Button";
import SpeakButton from "@/src/components/SpeakButton";

export default function Notices() {
  const { c, scale } = useTheme();
  const { user, refresh } = useAuth();
  const { show } = useToast();
  const [notices, setNotices] = useState<any[]>([]);
  const [posting, setPosting] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("Announcement");
  const [expandedComments, setExpandedComments] = useState<Record<string, string>>({});

  const load = async () => setNotices(await api.listNotices());
  useFocusEffect(useCallback(() => { load(); }, []));

  const post = async () => {
    if (!user || !title.trim() || !body.trim()) { show("Add a title and message"); return; }
    try {
      await api.createNotice({ user_id: user.id, user_name: user.first_name, avatar: user.avatar, title, body, category });
      setPosting(false); setTitle(""); setBody(""); setCategory("Announcement");
      show("Posted! +4 Butterfly Points 🦋"); await load(); await refresh();
    } catch { show("Try again"); }
  };

  const like = async (n: any) => {
    if (!user) return;
    await api.likeNotice(n.id, user.id);
    await load();
  };

  const comment = async (n: any) => {
    const text = (expandedComments[n.id] || "").trim();
    if (!user || !text) return;
    await api.commentNotice(n.id, { user_id: user.id, user_name: user.first_name, text });
    setExpandedComments({ ...expandedComments, [n.id]: "" });
    await load();
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Notice Board" right={
        <Pressable testID="post-notice-btn" onPress={() => setPosting(true)} style={{ padding: 8 }}>
          <Ionicons name="add-circle" size={32} color={c.brand} />
        </Pressable>
      } />
      <FlatList
        data={notices}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
        renderItem={({ item }) => {
          const liked = user && (item.likes || []).includes(user.id);
          return (
            <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
              <View style={styles.head}>
                <Text style={{ fontSize: 28 }}>{item.avatar || "🙂"}</Text>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={[styles.author, { color: c.onSurface, fontSize: 16 * scale }]}>{item.user_name}</Text>
                  <Text style={[styles.cat, { color: c.brand, fontSize: 12 * scale }]}>{item.category}</Text>
                </View>
                <SpeakButton text={`${item.title}. ${item.body}`} color={c.brand} size={22} testID={`speak-notice-${item.id}`} />
              </View>
              <Text style={[styles.title, { color: c.onSurface, fontSize: 19 * scale }]}>{item.title}</Text>
              <Text style={[styles.body, { color: c.onSurfaceSecondary, fontSize: 16 * scale }]}>{item.body}</Text>
              <View style={styles.actionRow}>
                <Pressable testID={`like-${item.id}`} onPress={() => like(item)} style={styles.actBtn}>
                  <Ionicons name={liked ? "heart" : "heart-outline"} size={22} color={liked ? c.error : c.muted} />
                  <Text style={{ color: c.muted, fontWeight: "600", fontSize: 14 * scale }}>{(item.likes || []).length}</Text>
                </Pressable>
                <View style={styles.actBtn}>
                  <Ionicons name="chatbubble-outline" size={20} color={c.muted} />
                  <Text style={{ color: c.muted, fontWeight: "600", fontSize: 14 * scale }}>{(item.comments || []).length}</Text>
                </View>
              </View>
              {(item.comments || []).map((co: any) => (
                <View key={co.id} style={[styles.comment, { backgroundColor: c.surfaceTertiary }]}>
                  <Text style={{ color: c.onSurface, fontSize: 14 * scale }}><Text style={{ fontWeight: "700" }}>{co.user_name}: </Text>{co.text}</Text>
                </View>
              ))}
              <View style={styles.commentRow}>
                <TextInput
                  testID={`comment-input-${item.id}`}
                  value={expandedComments[item.id] || ""}
                  onChangeText={(v) => setExpandedComments({ ...expandedComments, [item.id]: v })}
                  placeholder="Write a comment…"
                  placeholderTextColor={c.muted}
                  style={[styles.cInput, { color: c.onSurface, backgroundColor: c.surfaceTertiary, borderColor: c.border, fontSize: 15 * scale }]}
                />
                <Pressable testID={`comment-send-${item.id}`} onPress={() => comment(item)} style={[styles.cSend, { backgroundColor: c.brand }]}><Ionicons name="send" size={16} color="#FFF" /></Pressable>
              </View>
            </View>
          );
        }}
      />

      <Modal visible={posting} transparent animationType="slide" onRequestClose={() => setPosting(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: c.surface, padding: 20, borderTopLeftRadius: 28, borderTopRightRadius: 28, gap: 12 }}>
            <Text style={{ color: c.onSurface, fontSize: 22 * scale, fontWeight: "800" }}>New Notice</Text>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {["Announcement", "Share", "Ask", "Activity"].map((cat) => (
                <Pressable key={cat} onPress={() => setCategory(cat)} style={[styles.chip, { backgroundColor: category === cat ? c.brand : c.surfaceSecondary, borderColor: category === cat ? c.brand : c.border }]}>
                  <Text style={{ color: category === cat ? "#FFF" : c.onSurface, fontWeight: "700", fontSize: 14 * scale }}>{cat}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput testID="notice-title" placeholder="Title" placeholderTextColor={c.muted} value={title} onChangeText={setTitle} style={{ borderWidth: 2, borderColor: c.border, borderRadius: 14, padding: 12, color: c.onSurface, fontSize: 17 * scale, backgroundColor: c.surfaceSecondary }} />
            <TextInput testID="notice-body" placeholder="What would you like to share?" placeholderTextColor={c.muted} value={body} onChangeText={setBody} multiline style={{ borderWidth: 2, borderColor: c.border, borderRadius: 14, padding: 12, color: c.onSurface, fontSize: 16 * scale, backgroundColor: c.surfaceSecondary, minHeight: 90 }} />
            <Button testID="notice-submit" label="Post Notice" onPress={post} />
            <Button label="Cancel" variant="ghost" onPress={() => setPosting(false)} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, padding: 14, borderWidth: 1, gap: 8 },
  head: { flexDirection: "row", alignItems: "center" },
  author: { fontWeight: "700" },
  cat: { fontWeight: "700", marginTop: 2 },
  title: { fontWeight: "800" },
  body: { fontWeight: "500" },
  actionRow: { flexDirection: "row", gap: 16, marginTop: 4 },
  actBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  comment: { padding: 10, borderRadius: 12 },
  commentRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  cInput: { flex: 1, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10 },
  cSend: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 2 },
});
