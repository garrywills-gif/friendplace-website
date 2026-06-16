import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Image, TextInput, RefreshControl } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import AvatarBubble from "@/src/components/AvatarBubble";

type Recipe = {
  id: string;
  title: string;
  ingredients: string;
  instructions: string;
  tips: string;
  photo: string;
  author_id: string;
  author_name: string;
  author_avatar: string;
  created_at: string;
  comments_count: number;
  likes: string[];
  liked_by_me: boolean;
};

export default function RecipesList() {
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r: any = await api.listRecipes(user?.id, q || undefined);
      setRecipes(r?.recipes || []);
    } catch (e) {
      // soft fail
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id, q]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { load(); }, 300);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Recipes" backHref="/home" right={(
        <Pressable testID="new-recipe" onPress={() => router.push("/recipes/new" as any)} style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: c.brand, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 }}>
          <Ionicons name="add" size={20} color="#FFF" />
          <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 14 * scale }}>Post Recipe</Text>
        </Pressable>
      )} />

      <View style={{ paddingHorizontal: 14, paddingTop: 10 }}>
        <View style={[styles.search, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <Ionicons name="search" size={18} color={c.muted} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search recipes, ingredients, cooks…"
            placeholderTextColor={c.muted}
            style={{ flex: 1, marginLeft: 8, color: c.onSurface, fontSize: 16 * scale, paddingVertical: 8 }}
          />
          {q.length > 0 && (
            <Pressable onPress={() => setQ("")} hitSlop={8}><Ionicons name="close-circle" size={20} color={c.muted} /></Pressable>
          )}
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={c.brand} style={{ marginTop: 24 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 14, paddingBottom: 80 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.brand} />}
        >
          {recipes.length === 0 ? (
            <View style={[styles.empty, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
              <Text style={{ fontSize: 36 }}>🍳</Text>
              <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 18 * scale, marginTop: 8, textAlign: "center" }}>No recipes yet</Text>
              <Text style={{ color: c.muted, fontSize: 14 * scale, marginTop: 6, textAlign: "center" }}>Be the first to share your favourite dish, biscuits, soup or family secret.</Text>
              <Pressable onPress={() => router.push("/recipes/new" as any)} style={[styles.cta, { backgroundColor: c.brand, marginTop: 14 }]}>
                <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 15 * scale }}>Post your first recipe</Text>
              </Pressable>
            </View>
          ) : recipes.map((r) => (
            <Pressable
              key={r.id}
              testID={`recipe-${r.id}`}
              onPress={() => router.push(`/recipes/${r.id}` as any)}
              style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}
            >
              {r.photo ? (
                <Image source={{ uri: r.photo }} style={styles.cover} resizeMode="cover" />
              ) : (
                <View style={[styles.cover, { backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center" }]}>
                  <Text style={{ fontSize: 56 }}>🍲</Text>
                </View>
              )}
              <View style={{ padding: 12 }}>
                <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 18 * scale }}>{r.title}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6, gap: 6 }}>
                  <AvatarBubble value={r.author_avatar} size={20} />
                  <Text style={{ color: c.muted, fontSize: 13 * scale }}>by {r.author_name}</Text>
                </View>
                {!!r.ingredients && (
                  <Text numberOfLines={2} style={{ color: c.onSurfaceSecondary, fontSize: 13 * scale, marginTop: 6 }}>
                    {r.ingredients}
                  </Text>
                )}
                <View style={{ flexDirection: "row", marginTop: 10, gap: 14 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Ionicons name="heart" size={14} color={r.liked_by_me ? "#DC2626" : c.muted} />
                    <Text style={{ color: c.muted, fontSize: 12 * scale, fontWeight: "700" }}>{r.likes.length}</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Ionicons name="chatbubble" size={14} color={c.muted} />
                    <Text style={{ color: c.muted, fontSize: 12 * scale, fontWeight: "700" }}>{r.comments_count}</Text>
                  </View>
                </View>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, borderRadius: 999, borderWidth: 1 },
  empty: { padding: 28, borderRadius: 16, borderWidth: 1, alignItems: "center", marginTop: 24 },
  cta: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999 },
  card: { borderRadius: 14, borderWidth: 1, marginBottom: 14, overflow: "hidden" },
  cover: { width: "100%", height: 180 },
});
