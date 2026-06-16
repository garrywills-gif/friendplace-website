import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Image, ActivityIndicator, TextInput } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import SpeakButton from "@/src/components/SpeakButton";
import AvatarBubble from "@/src/components/AvatarBubble";

type Comment = { id: string; user_id: string; user_name: string; user_avatar: string; body: string; created_at: string };

export default function RecipeView() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const { show, confirm } = useToast();
  const [rec, setRec] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.getRecipe(String(id), user?.id);
      setRec(r);
    } finally {
      setLoading(false);
    }
  }, [id, user?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleLike = async () => {
    if (!user || !rec || likeBusy) return;
    setLikeBusy(true);
    const optimistic = !rec.liked_by_me;
    setRec((r: any) => r ? { ...r, liked_by_me: optimistic, likes: optimistic ? [...(r.likes||[]), user.id] : (r.likes||[]).filter((x: string) => x !== user.id) } : r);
    try { await api.toggleRecipeLike(rec.id, user.id); }
    catch { load(); }
    finally { setLikeBusy(false); }
  };

  const addComment = async () => {
    if (!user || !text.trim()) return;
    setPosting(true);
    try {
      const cm = await api.addRecipeComment(rec.id, user.id, text.trim());
      setRec((r: any) => ({ ...r, comments: [...(r.comments||[]), cm] }));
      setText("");
    } catch (e: any) { show(e?.message || "Couldn't post comment"); }
    finally { setPosting(false); }
  };

  const removeComment = async (cid: string) => {
    if (!user) return;
    const ok = await confirm({ title: "Delete comment?", message: "This cannot be undone.", confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    try {
      await api.deleteRecipeComment(rec.id, cid, user.id);
      setRec((r: any) => ({ ...r, comments: (r.comments||[]).filter((x: any) => x.id !== cid) }));
    } catch (e: any) { show(e?.message || "Couldn't delete"); }
  };

  const deleteRecipe = async () => {
    if (!user) return;
    const ok = await confirm({ title: "Delete recipe?", message: "This recipe and its comments will be removed.", confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    try {
      await api.deleteRecipe(rec.id, user.id);
      router.replace("/recipes" as any);
    } catch (e: any) { show(e?.message || "Couldn't delete"); }
  };

  if (loading) return <View style={{ flex: 1, backgroundColor: c.surface }}><Header title="Recipe" /><ActivityIndicator color={c.brand} style={{ marginTop: 30 }} /></View>;
  if (!rec) return <View style={{ flex: 1, backgroundColor: c.surface }}><Header title="Recipe" /><Text style={{ padding: 16, color: c.onSurface }}>Recipe not found.</Text></View>;

  const isAuthor = user?.id === rec.author_id;
  const isAdmin = (user as any)?.is_admin;
  const speakText = `${rec.title}. By ${rec.author_name}. Ingredients: ${rec.ingredients}. Method: ${rec.instructions}. ${rec.tips ? "Tips: " + rec.tips : ""}`;

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Recipe" backHref="/recipes" right={<SpeakButton text={speakText} color={c.brand} size={24} testID="recipe-speak" />} />
      <ScrollView contentContainerStyle={{ paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
        {rec.photo ? (
          <Image source={{ uri: rec.photo }} style={{ width: "100%", height: 260 }} resizeMode="cover" />
        ) : (
          <View style={{ width: "100%", height: 200, backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 72 }}>🍲</Text>
          </View>
        )}
        <View style={{ padding: 16 }}>
          <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 24 * scale }}>{rec.title}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 8, gap: 8 }}>
            <AvatarBubble value={rec.author_avatar} size={24} />
            <Text style={{ color: c.muted, fontSize: 14 * scale }}>by {rec.author_name}</Text>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
            <Pressable testID="recipe-like" onPress={toggleLike} style={[styles.actionBtn, { backgroundColor: rec.liked_by_me ? "#FEE2E2" : c.surfaceSecondary, borderColor: rec.liked_by_me ? "#DC2626" : c.border }]}>
              <Ionicons name={rec.liked_by_me ? "heart" : "heart-outline"} size={20} color={rec.liked_by_me ? "#DC2626" : c.muted} />
              <Text style={{ color: rec.liked_by_me ? "#B91C1C" : c.onSurface, fontWeight: "800", marginLeft: 6, fontSize: 14 * scale }}>{(rec.likes||[]).length} Like</Text>
            </Pressable>
            {(isAuthor || isAdmin) && (
              <>
                <Pressable testID="recipe-edit" onPress={() => router.push(`/recipes/${rec.id}/edit` as any)} style={[styles.actionBtn, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
                  <Ionicons name="create" size={18} color={c.brand} />
                  <Text style={{ color: c.brand, fontWeight: "800", marginLeft: 6, fontSize: 14 * scale }}>Edit</Text>
                </Pressable>
                <Pressable testID="recipe-delete" onPress={deleteRecipe} style={[styles.actionBtn, { backgroundColor: "#FEE2E2", borderColor: "#DC2626" }]}>
                  <Ionicons name="trash" size={18} color="#DC2626" />
                  <Text style={{ color: "#B91C1C", fontWeight: "800", marginLeft: 6, fontSize: 14 * scale }}>Delete</Text>
                </Pressable>
              </>
            )}
          </View>

          {!!rec.ingredients && (
            <View style={[styles.section, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
              <Text style={[styles.h2, { color: c.brand, fontSize: 17 * scale }]}>Ingredients</Text>
              <Text style={{ color: c.onSurface, fontSize: 15 * scale, lineHeight: 22 * scale }}>{rec.ingredients}</Text>
            </View>
          )}
          {!!rec.instructions && (
            <View style={[styles.section, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
              <Text style={[styles.h2, { color: c.brand, fontSize: 17 * scale }]}>Method</Text>
              <Text style={{ color: c.onSurface, fontSize: 15 * scale, lineHeight: 22 * scale }}>{rec.instructions}</Text>
            </View>
          )}
          {!!rec.tips && (
            <View style={[styles.section, { backgroundColor: "#FEF3C7", borderColor: "#FBBF24" }]}>
              <Text style={[styles.h2, { color: "#92400E", fontSize: 17 * scale }]}>💡 Tips & tricks</Text>
              <Text style={{ color: "#78350F", fontSize: 15 * scale, lineHeight: 22 * scale }}>{rec.tips}</Text>
            </View>
          )}

          {/* Comments */}
          <Text style={[styles.h2, { color: c.onSurface, fontSize: 17 * scale, marginTop: 18 }]}>Comments ({(rec.comments||[]).length})</Text>
          <View style={{ gap: 8, marginTop: 8 }}>
            {(rec.comments||[]).map((cm: Comment) => (
              <View key={cm.id} style={[styles.comment, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
                <AvatarBubble value={cm.user_avatar} size={22} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 14 * scale }}>{cm.user_name}</Text>
                  <Text style={{ color: c.onSurface, fontSize: 14 * scale, marginTop: 2 }}>{cm.body}</Text>
                </View>
                {(cm.user_id === user?.id || isAuthor || isAdmin) && (
                  <Pressable onPress={() => removeComment(cm.id)} hitSlop={8}>
                    <Ionicons name="close" size={18} color={c.muted} />
                  </Pressable>
                )}
              </View>
            ))}
          </View>

          {user && (
            <View style={{ marginTop: 12, flexDirection: "row", gap: 8 }}>
              <TextInput
                testID="recipe-comment-input"
                value={text}
                onChangeText={setText}
                placeholder="Leave a comment…"
                placeholderTextColor={c.muted}
                multiline
                style={{ flex: 1, borderWidth: 1.5, borderRadius: 12, padding: 12, backgroundColor: c.surfaceSecondary, borderColor: c.border, color: c.onSurface, fontSize: 15 * scale, minHeight: 48 }}
              />
              <Pressable testID="recipe-comment-send" disabled={!text.trim() || posting} onPress={addComment} style={[styles.sendBtn, { backgroundColor: c.brand, opacity: !text.trim() || posting ? 0.5 : 1 }]}>
                {posting ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name="send" size={20} color="#FFF" />}
              </Pressable>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  actionBtn: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1.5 },
  section: { padding: 14, borderRadius: 14, borderWidth: 1, marginTop: 14 },
  h2: { fontWeight: "900", marginBottom: 6 },
  comment: { flexDirection: "row", alignItems: "flex-start", padding: 12, borderRadius: 14, borderWidth: 1 },
  sendBtn: { width: 48, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
