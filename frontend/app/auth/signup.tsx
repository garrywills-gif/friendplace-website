import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, KeyboardAvoidingView, Platform, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import Button from "@/src/components/Button";
import Header from "@/src/components/Header";
import PasswordField from "@/src/components/PasswordField";
import { INTERESTS } from "@/src/lib/interests";

const SUBURBS = ["Bondi", "Manly", "Surry Hills", "Newtown", "Sydney CBD", "Parramatta"];
const AVATARS = ["🌸", "🔨", "📚", "🧓", "🧶", "🌳", "🎨", "🏏", "🌷", "🐾", "👋", "☕"];

export default function Signup() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { signup } = useAuth();
  const { show } = useToast();
  const [firstName, setFirstName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [suburb, setSuburb] = useState("");
  const [avatar, setAvatar] = useState("🌸");
  const [interests, setInterests] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const toggle = (i: string) =>
    setInterests((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]));

  const submit = async () => {
    const u = username.trim().toLowerCase();
    if (!u || u.length < 3) { show("Username must be at least 3 characters"); return; }
    if (!pw || pw.length < 6) { show("Password must be at least 6 characters"); return; }
    if (pw !== pw2) { show("Passwords do not match"); return; }
    setBusy(true);
    try {
      await signup({
        username: u,
        password: pw,
        email: email.trim() ? email.trim().toLowerCase() : undefined,
        first_name: firstName.trim() || undefined,
        suburb,
        interests,
        avatar,
      });
      show(`Welcome${firstName ? `, ${firstName.trim()}` : ""}! 🦋`);
      router.replace("/(tabs)/home");
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (msg.includes("Username already taken")) show("Username already taken");
      else if (msg.includes("Email already registered")) show("Email already registered");
      else show("Could not create account. Try again.");
    } finally { setBusy(false); }
  };

  const inputStyle = { color: c.onSurface, backgroundColor: c.surfaceSecondary, borderColor: c.border, fontSize: 17 * scale };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Create Account" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.label, { color: c.onSurface, fontSize: 16 * scale }]}>Username  <Text style={{ color: c.error, fontSize: 14 * scale }}>*</Text></Text>
          <TextInput testID="signup-username" value={username} onChangeText={setUsername} placeholder="e.g. maggie (lowercase)" autoCapitalize="none" autoCorrect={false} placeholderTextColor={c.muted} style={[styles.input, inputStyle]} />

          <Text style={[styles.label, { color: c.onSurface, fontSize: 16 * scale }]}>First name <Text style={{ color: c.muted, fontSize: 13 * scale }}>(optional)</Text></Text>
          <TextInput testID="signup-first-name" value={firstName} onChangeText={setFirstName} placeholder="Optional — shown on your profile" placeholderTextColor={c.muted} style={[styles.input, inputStyle]} />

          <Text style={[styles.label, { color: c.onSurface, fontSize: 16 * scale }]}>Email <Text style={{ color: c.muted, fontSize: 13 * scale }}>(optional — needed for password reset)</Text></Text>
          <TextInput testID="signup-email" value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" placeholderTextColor={c.muted} style={[styles.input, inputStyle]} />

          <Text style={[styles.label, { color: c.onSurface, fontSize: 16 * scale }]}>Create password <Text style={{ color: c.error, fontSize: 14 * scale }}>*</Text></Text>
          <PasswordField testID="signup-pw" value={pw} onChangeText={setPw} placeholder="At least 6 characters" placeholderTextColor={c.muted} inputStyle={[styles.input, inputStyle]} iconColor={c.brand} />

          <Text style={[styles.label, { color: c.onSurface, fontSize: 16 * scale }]}>Confirm password <Text style={{ color: c.error, fontSize: 14 * scale }}>*</Text></Text>
          <PasswordField testID="signup-pw2" value={pw2} onChangeText={setPw2} placeholder="Re-enter password" placeholderTextColor={c.muted} inputStyle={[styles.input, inputStyle]} iconColor={c.brand} />

          <Text style={[styles.label, { color: c.onSurface, fontSize: 16 * scale }]}>Pick an avatar</Text>
          <View style={styles.row}>
            {AVATARS.map((a) => (
              <Pressable key={a} testID={`signup-avatar-${a}`} onPress={() => setAvatar(a)} style={[styles.avatarBtn, { backgroundColor: avatar === a ? c.brandTertiary : c.surfaceSecondary, borderColor: avatar === a ? c.brand : c.border }]}>
                <Text style={{ fontSize: 30 }}>{a}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.label, { color: c.onSurface, fontSize: 16 * scale }]}>Suburb</Text>
          <View style={styles.row}>
            {SUBURBS.map((s) => (
              <Pressable key={s} onPress={() => setSuburb(s)} style={[styles.chip, { backgroundColor: suburb === s ? c.brand : c.surfaceSecondary, borderColor: suburb === s ? c.brand : c.border }]}>
                <Text style={{ color: suburb === s ? c.onBrandPrimary : c.onSurface, fontSize: 15 * scale, fontWeight: "600" }}>{s}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.label, { color: c.onSurface, fontSize: 16 * scale }]}>Interests</Text>
          <View style={styles.row}>
            {INTERESTS.map((i) => (
              <Pressable key={i} onPress={() => toggle(i)} style={[styles.chip, { backgroundColor: interests.includes(i) ? c.brand : c.surfaceSecondary, borderColor: interests.includes(i) ? c.brand : c.border }]}>
                <Text style={{ color: interests.includes(i) ? c.onBrandPrimary : c.onSurface, fontSize: 15 * scale, fontWeight: "600" }}>{i}</Text>
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
  content: { padding: 20, gap: 6, paddingBottom: 40 },
  label: { fontWeight: "700", marginTop: 12 },
  input: { borderWidth: 2, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, fontWeight: "600" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 2, minHeight: 40 },
  avatarBtn: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", borderWidth: 2 },
});
