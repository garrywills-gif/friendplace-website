import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, KeyboardAvoidingView, Platform, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import Button from "@/src/components/Button";
import Header from "@/src/components/Header";

const SUBURBS = ["Bondi", "Manly", "Surry Hills", "Newtown", "Sydney CBD", "Parramatta"];
const INTERESTS = ["Gardening", "Books", "Cats", "Dogs", "Cricket", "Cooking", "Art", "Travel", "Walking", "Trivia", "Knitting", "Coffee"];
const AVATARS = ["🌸", "🔨", "📚", "🧓", "🧶", "🌳", "🎨", "🏏", "🌷", "🐾", "👋", "☕"];

export default function Signup() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { signup } = useAuth();
  const { show } = useToast();
  const [firstName, setFirstName] = useState("");
  const [username, setUsername] = useState("");
  const [suburb, setSuburb] = useState("");
  const [avatar, setAvatar] = useState("🌸");
  const [interests, setInterests] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const toggle = (i: string) =>
    setInterests((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]));

  const submit = async () => {
    if (!firstName.trim() || !username.trim()) {
      show("Please enter a name and username");
      return;
    }
    setBusy(true);
    try {
      await signup({ first_name: firstName.trim(), username: username.trim().toLowerCase(), suburb, interests, avatar });
      show(`Welcome, ${firstName}! 🦋`);
      router.replace("/(tabs)/home");
    } catch (e: any) {
      show(e.message?.includes("400") ? "Username taken — try another" : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Create Account" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.label, { color: c.onSurface, fontSize: 18 * scale }]}>First name</Text>
          <TextInput testID="signup-first-name" value={firstName} onChangeText={setFirstName} placeholder="Margaret" placeholderTextColor={c.muted} style={[styles.input, { color: c.onSurface, backgroundColor: c.surfaceSecondary, borderColor: c.border, fontSize: 18 * scale }]} />

          <Text style={[styles.label, { color: c.onSurface, fontSize: 18 * scale }]}>Username</Text>
          <TextInput testID="signup-username" value={username} onChangeText={setUsername} placeholder="maggie" autoCapitalize="none" placeholderTextColor={c.muted} style={[styles.input, { color: c.onSurface, backgroundColor: c.surfaceSecondary, borderColor: c.border, fontSize: 18 * scale }]} />

          <Text style={[styles.label, { color: c.onSurface, fontSize: 18 * scale }]}>Pick an avatar</Text>
          <View style={styles.row}>
            {AVATARS.map((a) => (
              <Pressable key={a} testID={`signup-avatar-${a}`} onPress={() => setAvatar(a)} style={[styles.avatarBtn, { backgroundColor: avatar === a ? c.brandTertiary : c.surfaceSecondary, borderColor: avatar === a ? c.brand : c.border }]}>
                <Text style={{ fontSize: 30 }}>{a}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.label, { color: c.onSurface, fontSize: 18 * scale }]}>Suburb</Text>
          <View style={styles.row}>
            {SUBURBS.map((s) => (
              <Pressable key={s} onPress={() => setSuburb(s)} style={[styles.chip, { backgroundColor: suburb === s ? c.brand : c.surfaceSecondary, borderColor: suburb === s ? c.brand : c.border }]}>
                <Text style={{ color: suburb === s ? c.onBrandPrimary : c.onSurface, fontSize: 16 * scale, fontWeight: "600" }}>{s}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.label, { color: c.onSurface, fontSize: 18 * scale }]}>Interests</Text>
          <View style={styles.row}>
            {INTERESTS.map((i) => (
              <Pressable key={i} onPress={() => toggle(i)} style={[styles.chip, { backgroundColor: interests.includes(i) ? c.brand : c.surfaceSecondary, borderColor: interests.includes(i) ? c.brand : c.border }]}>
                <Text style={{ color: interests.includes(i) ? c.onBrandPrimary : c.onSurface, fontSize: 16 * scale, fontWeight: "600" }}>{i}</Text>
              </Pressable>
            ))}
          </View>

          <View style={{ height: 16 }} />
          <Button testID="signup-submit" label="Create my account" onPress={submit} loading={busy} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 8, paddingBottom: 40 },
  label: { fontWeight: "700", marginTop: 12 },
  input: { borderWidth: 2, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, fontWeight: "600" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999, borderWidth: 2, minHeight: 44 },
  avatarBtn: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", borderWidth: 2 },
});
