import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, KeyboardAvoidingView, Platform, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import Button from "@/src/components/Button";
import Header from "@/src/components/Header";

const DEMO = [
  { name: "Margaret", u: "maggie", a: "🌸" },
  { name: "Frank", u: "frankie", a: "🔨" },
  { name: "Joyce", u: "joycey", a: "📚" },
  { name: "Eileen", u: "eil", a: "🎨" },
];

export default function Login() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { login } = useAuth();
  const { show } = useToast();
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (u?: string) => {
    const name = (u || username).trim().toLowerCase();
    if (!name) { show("Enter a username"); return; }
    setBusy(true);
    try {
      await login(name);
      router.replace("/(tabs)/home");
    } catch {
      show("Username not found");
    } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Log In" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.intro, { color: c.onSurfaceSecondary, fontSize: 18 * scale }]}>Welcome back! Enter your username to continue.</Text>
          <TextInput
            testID="login-username"
            value={username}
            onChangeText={setUsername}
            placeholder="username"
            autoCapitalize="none"
            placeholderTextColor={c.muted}
            style={[styles.input, { color: c.onSurface, backgroundColor: c.surfaceSecondary, borderColor: c.border, fontSize: 18 * scale }]}
          />
          <Button testID="login-submit" label="Log in" onPress={() => submit()} loading={busy} />

          <Text style={[styles.demoTitle, { color: c.onSurfaceSecondary, fontSize: 18 * scale }]}>Or try a demo account:</Text>
          <View style={styles.demoRow}>
            {DEMO.map((d) => (
              <Pressable key={d.u} testID={`demo-${d.u}`} onPress={() => submit(d.u)} style={[styles.demoBtn, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
                <Text style={{ fontSize: 28 }}>{d.a}</Text>
                <Text style={{ color: c.onBrandTertiary, fontSize: 16 * scale, fontWeight: "700", marginTop: 4 }}>{d.name}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 14 },
  intro: { fontWeight: "600", marginBottom: 8 },
  input: { borderWidth: 2, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, fontWeight: "600" },
  demoTitle: { fontWeight: "700", marginTop: 24 },
  demoRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  demoBtn: { width: "47%", borderRadius: 20, padding: 16, borderWidth: 2, alignItems: "center", minHeight: 100, justifyContent: "center" },
});
