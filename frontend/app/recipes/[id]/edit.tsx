import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, Image, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";

export default function EditRecipe() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const { show } = useToast();
  const [title, setTitle] = useState("");
  const [ingredients, setIngredients] = useState("");
  const [instructions, setInstructions] = useState("");
  const [tips, setTips] = useState("");
  const [photo, setPhoto] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r: any = await api.getRecipe(String(id), user?.id);
        setTitle(r.title || "");
        setIngredients(r.ingredients || "");
        setInstructions(r.instructions || "");
        setTips(r.tips || "");
        setPhoto(r.photo || "");
      } finally { setLoading(false); }
    })();
  }, [id, user?.id]);

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { show("Photo permission needed"); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [4, 3], quality: 0.6, base64: true });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    if (a.base64) setPhoto(`data:image/jpeg;base64,${a.base64}`);
  };

  const save = async () => {
    if (!user) return;
    if (!title.trim()) { show("Title is required"); return; }
    setSaving(true);
    try {
      await api.updateRecipe(String(id), { user_id: user.id, title: title.trim(), ingredients, instructions, tips, photo });
      show("Recipe updated");
      router.replace(`/recipes/${id}` as any);
    } catch (e: any) { show(e?.message || "Couldn't save"); }
    finally { setSaving(false); }
  };

  if (loading) return <View style={{ flex: 1, backgroundColor: c.surface }}><Header title="Edit recipe" /><ActivityIndicator color={c.brand} style={{ marginTop: 30 }} /></View>;

  const inputStyle = { backgroundColor: c.surfaceSecondary, borderColor: c.border, color: c.onSurface };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Edit recipe" />
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
        <Pressable onPress={pickPhoto} style={[styles.photoWrap, { borderColor: c.border, backgroundColor: c.surfaceSecondary }]}>
          {photo ? <Image source={{ uri: photo }} style={styles.photo} resizeMode="cover" /> :
            <View style={styles.photoEmpty}><Ionicons name="camera" size={36} color={c.brand} /><Text style={{ color: c.muted, marginTop: 8 }}>Tap to add a photo</Text></View>}
        </Pressable>
        <Text style={[styles.label, { color: c.onSurface, fontSize: 15 * scale }]}>Title</Text>
        <TextInput value={title} onChangeText={setTitle} style={[styles.input, inputStyle]} />
        <Text style={[styles.label, { color: c.onSurface, fontSize: 15 * scale }]}>Ingredients</Text>
        <TextInput value={ingredients} onChangeText={setIngredients} multiline numberOfLines={6} style={[styles.input, styles.multiline, inputStyle]} />
        <Text style={[styles.label, { color: c.onSurface, fontSize: 15 * scale }]}>Method</Text>
        <TextInput value={instructions} onChangeText={setInstructions} multiline numberOfLines={8} style={[styles.input, styles.multiline, inputStyle]} />
        <Text style={[styles.label, { color: c.onSurface, fontSize: 15 * scale }]}>Tips</Text>
        <TextInput value={tips} onChangeText={setTips} multiline numberOfLines={3} style={[styles.input, styles.multiline, inputStyle]} />
        <Pressable disabled={saving} onPress={save} style={[styles.saveBtn, { backgroundColor: c.brand, opacity: saving ? 0.6 : 1 }]}>
          {saving ? <ActivityIndicator color="#FFF" /> : <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 16 * scale }}>Save changes</Text>}
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
  saveBtn: { marginTop: 22, padding: 16, borderRadius: 14, alignItems: "center" },
});
