import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, Image, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";

export default function NewRecipe() {
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const { show } = useToast();
  const [title, setTitle] = useState("");
  const [ingredients, setIngredients] = useState("");
  const [instructions, setInstructions] = useState("");
  const [tips, setTips] = useState("");
  const [photo, setPhoto] = useState("");
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);

  const pickPhoto = async () => {
    setPicking(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { show("Photo permission needed"); return; }
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.6,
        base64: true,
      });
      if (r.canceled || !r.assets?.[0]) return;
      const a = r.assets[0];
      if (a.base64) setPhoto(`data:image/jpeg;base64,${a.base64}`);
      else if (a.uri) setPhoto(a.uri);
    } catch {
      show("Couldn't pick a photo");
    } finally {
      setPicking(false);
    }
  };

  const save = async () => {
    if (!user) return;
    const t = title.trim();
    if (!t) { show("Please give your recipe a title"); return; }
    setSaving(true);
    try {
      const r: any = await api.createRecipe({ user_id: user.id, title: t, ingredients, instructions, tips, photo });
      show("Recipe shared! 🍲");
      router.replace(`/recipes/${r.id}` as any);
    } catch (e: any) {
      show(e?.message || "Couldn't save — try again");
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = { backgroundColor: c.surfaceSecondary, borderColor: c.border, color: c.onSurface };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Post your recipe" />
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
        {/* Photo */}
        <Text style={[styles.label, { color: c.onSurface, fontSize: 15 * scale }]}>Photo</Text>
        <Pressable testID="recipe-photo-pick" onPress={pickPhoto} style={[styles.photoWrap, { borderColor: c.border, backgroundColor: c.surfaceSecondary }]}>
          {photo ? (
            <Image source={{ uri: photo }} style={styles.photo} resizeMode="cover" />
          ) : (
            <View style={styles.photoEmpty}>
              {picking ? <ActivityIndicator color={c.brand} /> : (
                <>
                  <Ionicons name="camera" size={36} color={c.brand} />
                  <Text style={{ color: c.muted, marginTop: 8, fontSize: 14 * scale }}>Tap to add a photo</Text>
                </>
              )}
            </View>
          )}
        </Pressable>
        {photo && (
          <Pressable onPress={() => setPhoto("")} style={[styles.removeBtn, { borderColor: c.border, backgroundColor: c.surfaceSecondary }]}>
            <Ionicons name="trash" size={14} color={c.error} />
            <Text style={{ color: c.error, fontWeight: "800", marginLeft: 4, fontSize: 13 * scale }}>Remove photo</Text>
          </Pressable>
        )}

        <Text style={[styles.label, { color: c.onSurface, fontSize: 15 * scale }]}>Title <Text style={{ color: c.error }}>*</Text></Text>
        <TextInput testID="recipe-title" value={title} onChangeText={setTitle} placeholder="e.g. Grandma's lemon slice" placeholderTextColor={c.muted} style={[styles.input, inputStyle]} />

        <Text style={[styles.label, { color: c.onSurface, fontSize: 15 * scale }]}>Ingredients</Text>
        <TextInput testID="recipe-ingredients" value={ingredients} onChangeText={setIngredients} placeholder={"1 cup flour\n200g butter\n1/2 cup sugar…"} placeholderTextColor={c.muted} multiline numberOfLines={6} style={[styles.input, styles.multiline, inputStyle]} />

        <Text style={[styles.label, { color: c.onSurface, fontSize: 15 * scale }]}>Method</Text>
        <TextInput testID="recipe-instructions" value={instructions} onChangeText={setInstructions} placeholder={"1. Preheat oven to 180°C\n2. Mix dry ingredients…\n3. Bake for 25 minutes…"} placeholderTextColor={c.muted} multiline numberOfLines={8} style={[styles.input, styles.multiline, inputStyle]} />

        <Text style={[styles.label, { color: c.onSurface, fontSize: 15 * scale }]}>Tips & tricks</Text>
        <TextInput testID="recipe-tips" value={tips} onChangeText={setTips} placeholder="Best with a cuppa. Keeps for 5 days…" placeholderTextColor={c.muted} multiline numberOfLines={3} style={[styles.input, styles.multiline, inputStyle]} />

        <Pressable testID="recipe-save" disabled={saving} onPress={save} style={[styles.saveBtn, { backgroundColor: c.brand, opacity: saving ? 0.6 : 1 }]}>
          {saving ? <ActivityIndicator color="#FFF" /> : <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 16 * scale }}>Share recipe</Text>}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontWeight: "800", marginTop: 14, marginBottom: 6 },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, minHeight: 48 },
  multiline: { minHeight: 100, textAlignVertical: "top" },
  photoWrap: { borderWidth: 1.5, borderStyle: "dashed", borderRadius: 14, height: 200, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  photo: { width: "100%", height: "100%" },
  photoEmpty: { alignItems: "center", justifyContent: "center" },
  removeBtn: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, marginTop: 8 },
  saveBtn: { marginTop: 22, padding: 16, borderRadius: 14, alignItems: "center" },
});
