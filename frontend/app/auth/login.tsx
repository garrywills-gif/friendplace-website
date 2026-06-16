import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, KeyboardAvoidingView, Platform, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Button from "@/src/components/Button";
import Header from "@/src/components/Header";
import PasswordField from "@/src/components/PasswordField";
import AvatarBubble from "@/src/components/AvatarBubble";

type DemoAccount = { username: string; first_name: string; avatar: string; suburb: string };

// expo-router's router.replace("/home") silently no-ops on iPad Safari when
// the destination is a tab screen. Use a hard URL change there, fall back to
// router.replace on native.
function goHome(router: ReturnType<typeof useRouter>) {
  if (Platform.OS === "web") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).location.assign("/home");
  } else {
    router.replace("/home" as any);
  }
}

export default function Login() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { login, demoLogin } = useAuth();
  const { show } = useToast();
  const [identifier, setIdentifier] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [demos, setDemos] = useState<DemoAccount[]>([]);
  const [showDemos, setShowDemos] = useState(false);

  useEffect(() => {
    (async () => {
      try { setDemos(await api.demoAccounts() as DemoAccount[]); } catch {}
    })();
  }, []);

  const submit = async () => {
    const id = identifier.trim();
    if (!id) { show("Enter your username or email"); return; }
    if (!pw) { show("Enter your password"); return; }
    setBusy(true);
    try {
      await login(id, pw);
      goHome(router);
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (msg.includes("429")) show("Too many attempts. Please wait a few minutes.");
      else if (msg.includes("Demo accounts")) show("Use 'Try a demo account' below");
      else if (msg.includes("403") && (msg.toLowerCase().includes("banned") || msg.toLowerCase().includes("suspend"))) show("Your account is restricted. Please contact support.");
      else show("Invalid username or password");
    } finally { setBusy(false); }
  };

  const useDemo = async (u: string) => {
    setBusy(true);
    try {
      await demoLogin(u);
      goHome(router);
    } catch {
      show("Demo unavailable. Try again.");
    } finally { setBusy(false); }
  };

  const inputStyle = { color: c.onSurface, backgroundColor: c.surfaceSecondary, borderColor: c.border, fontSize: 17 * scale };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Log In" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.intro, { color: c.onSurfaceSecondary, fontSize: 17 * scale }]}>Welcome back!</Text>

          <Text style={[styles.label, { color: c.onSurface, fontSize: 16 * scale }]}>Username or email</Text>
          <TextInput
            testID="login-identifier"
            value={identifier}
            onChangeText={setIdentifier}
            placeholder="username or email"
            autoCapitalize="none"
            autoCorrect={false}
            placeholderTextColor={c.muted}
            style={[styles.input, inputStyle]}
          />

          <Text style={[styles.label, { color: c.onSurface, fontSize: 16 * scale }]}>Password</Text>
          <PasswordField testID="login-pw" value={pw} onChangeText={setPw} placeholder="Your password" placeholderTextColor={c.muted} inputStyle={[styles.input, inputStyle]} iconColor={c.brand} />

          <Pressable testID="login-forgot" onPress={() => router.push("/auth/forgot")} hitSlop={8} style={{ alignSelf: "flex-end", paddingVertical: 6 }}>
            <Text style={{ color: c.brandSecondary, fontWeight: "700", fontSize: 15 * scale }}>Forgot password?</Text>
          </Pressable>

          <Button testID="login-submit" label="Log in" onPress={submit} loading={busy} />

          <Pressable testID="login-toggle-demos" onPress={() => setShowDemos((v) => !v)} hitSlop={8} style={{ marginTop: 18, alignSelf: "center" }}>
            <Text style={{ color: c.brand, fontWeight: "800", fontSize: 16 * scale }}>{showDemos ? "Hide demo accounts" : "Try a demo account"}</Text>
          </Pressable>

          {showDemos && (
            <View>
              <Text style={[styles.demoIntro, { color: c.muted, fontSize: 13 * scale }]}>
                Demo accounts are kept separate from real signups. Tap one to explore.
              </Text>
              <View style={styles.demoRow}>
                {demos.map((d) => (
                  <Pressable key={d.username} testID={`demo-${d.username}`} onPress={() => useDemo(d.username)} style={[styles.demoBtn, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
                    <AvatarBubble value={d.avatar} size={28} fallback="🙂" />
                    <Text style={{ color: c.onBrandTertiary, fontSize: 15 * scale, fontWeight: "800", marginTop: 4 }}>{d.first_name || d.username}</Text>
                    <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 2 }}>@{d.username}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 8 },
  intro: { fontWeight: "600", marginBottom: 8 },
  label: { fontWeight: "700", marginTop: 10 },
  input: { borderWidth: 2, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, fontWeight: "600" },
  demoIntro: { fontWeight: "500", marginTop: 10, textAlign: "center" },
  demoRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 10 },
  demoBtn: { width: "47%", borderRadius: 20, padding: 14, borderWidth: 2, alignItems: "center", minHeight: 110, justifyContent: "center" },
});
