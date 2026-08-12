import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "@/src/lib/theme";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Button from "@/src/components/Button";
import Header from "@/src/components/Header";

export default function Forgot() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { show } = useToast();
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);

  const submit = async () => {
    if (!identifier.trim()) { show("Enter your username or email"); return; }
    setBusy(true);
    try {
      const r: any = await api.forgot(identifier.trim());
      if (r?.dev_code) setDevCode(r.dev_code);
      show("If that account exists, we've sent a reset code to your email.");
      router.push({ pathname: "/auth/reset", params: { identifier: identifier.trim() } });
    } catch {
      show("Could not request reset. Try again.");
    } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Forgot Password" showGeorge />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.intro, { color: c.onSurfaceSecondary, fontSize: 17 * scale }]}>
            Enter your username or email. We&apos;ll send a 6-digit reset code to the email address on your account.
          </Text>
          <Text style={[styles.label, { color: c.onSurface, fontSize: 16 * scale }]}>Username or email</Text>
          <TextInput
            testID="forgot-identifier"
            value={identifier}
            onChangeText={setIdentifier}
            placeholder="e.g. maggie or maggie@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            placeholderTextColor={c.muted}
            style={[styles.input, { color: c.onSurface, backgroundColor: c.surfaceSecondary, borderColor: c.border, fontSize: 17 * scale }]}
          />
          {devCode && (
            <View style={[styles.codeBox, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
              <Text style={{ color: c.brand, fontWeight: "700", fontSize: 13 * scale }}>Development code (email delivery not yet wired)</Text>
              <Text style={{ color: c.brand, fontWeight: "900", fontSize: 28 * scale, letterSpacing: 4, marginTop: 4 }}>{devCode}</Text>
            </View>
          )}
          <Button testID="forgot-submit" label="Send reset code" onPress={submit} loading={busy} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 12 },
  intro: { fontWeight: "500", lineHeight: 24, marginBottom: 4 },
  label: { fontWeight: "700", marginTop: 8 },
  input: { borderWidth: 2, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, fontWeight: "600" },
  codeBox: { padding: 14, borderRadius: 14, borderWidth: 2, alignItems: "center", marginTop: 4 },
});
